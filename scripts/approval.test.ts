/**
 * A run that stops to ask a person, and picks itself back up afterwards.
 *
 * Suspension is a run state rather than a blocked promise, and that is the
 * whole design. A step that needs a human answer throws `RunSuspension`; the
 * orchestrator parks the run, puts the asking step back to `pending`, and
 * returns. Nothing is held open — no timer, no awaited callback, no process
 * that has to survive until the answer arrives. The run's entire progress is
 * rows in a file, so the answer can come an hour later or after a restart.
 *
 * What that costs, and what these tests pin down: **the asking step runs again
 * from the top**, and every step before it does not. Re-running the whole plan
 * would re-pay for finished work and, worse, re-perform it. So the resumed walk
 * reads the recorded outcomes back out of `run_steps` and skips what they name.
 *
 * The counter here goes through the real `DocumentStore` rather than a variable,
 * because a variable would be re-created along with the second runtime and
 * could not tell "the step did not re-run" from "the closure is new". Dropping
 * the `completedSteps` seam from `resumeRun` takes it to 2, which is the whole
 * point: without it, resuming means redoing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { isRunSuspension } from '../src/contracts/index.js';
import { resumeRun } from '../src/runtime/resume.js';
import { startRun } from '../src/runtime/run.js';
import { noop, spine, stage, timeline, transform, type Spine } from './support/spine.js';

const COUNTER = 'prepare-counter';

/** Rebuilt per runtime, so nothing but the database carries between the two. */
const capabilities = () => ({
  deploy: noop('deploy', [
    stage('prepare', [
      transform('prepare', async (context) => {
        const record = context.documents.update(COUNTER, 'counter', (body) => ({
          runs: typeof body?.runs === 'number' ? body.runs + 1 : 1
        }));
        return { ran: record.body.runs };
      })
    ]),
    stage('send', [
      transform('send', async (context) => {
        const decision = context.approvals.request({
          key: 'send-it',
          kind: 'confirm',
          question: 'Send this to the address shown?',
          payload: { to: 'someone@example.test' }
        });
        return { sent: decision.status };
      })
    ])
  ])
});

const countOf = (s: Spine): number => Number(s.deps.documents.read(COUNTER)?.body.runs ?? 0);

test('a step asking for approval parks the run instead of blocking it', async () => {
  const s = spine(capabilities());

  try {
    await assert.rejects(
      () => startRun(s.deps, { capability: 'deploy', input: {} }),
      (error: unknown) => {
        assert.ok(isRunSuspension(error), 'a suspension is control flow, not an error');
        assert.equal(error.step, 'send');
        return true;
      }
    );

    const [run] = s.runs.list({ limit: 1 });
    assert.equal(run?.status, 'suspended');
    assert.equal(run?.errorCode, undefined, 'parking a run is not failing it');

    const steps = Object.fromEntries(s.runs.steps(run?.id ?? '').map((step) => [step.name, step]));
    assert.equal(steps.prepare?.status, 'ok');
    // Back to pending, not left running: no process is running it.
    assert.equal(steps.send?.status, 'pending');

    const waiting = s.approvals.pending(run?.id ?? '');
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0]?.question, 'Send this to the address shown?');
    assert.deepEqual(waiting[0]?.payload, { to: 'someone@example.test' });

    assert.equal(timeline(s, run?.id ?? '').at(-1), 'run.suspended');
  } finally {
    s.dispose();
  }
});

/**
 * Resuming into a signal that is already aborted, which is the case where the
 * run's own bookkeeping can destroy the work it was resumed to keep.
 *
 * A stopped run marks the steps it never reached `skipped`, and the walk starts
 * at the first stage — including the stages whose steps this resume just
 * restored as `ok`. Writing `skipped` over one of those does not merely
 * misreport it: `recordedOutcomes` reads `ok` and `degraded` and nothing else,
 * so the record of the finished step is gone and the next resume pays for it
 * again. Which is precisely what `resumeRun` exists to avoid.
 */
test('a resume that is cancelled before it starts keeps the finished steps', async () => {
  const first = spine(capabilities());

  try {
    await assert.rejects(() => startRun(first.deps, { capability: 'deploy', input: {} }));

    const runId = first.runs.list({ limit: 1 })[0]?.id ?? '';
    assert.equal(countOf(first), 1);

    const waiting = first.approvals.pending(runId);
    first.approvals.decide(waiting[0]?.id ?? '', {
      status: 'granted',
      decision: { confirmed: true },
      decidedAt: Date.now()
    });

    const second = spine(capabilities(), { on: first.scratch });
    const cancel = new AbortController();
    cancel.abort(new Error('the user closed the window'));

    await assert.rejects(() => resumeRun(second.deps, { runId, signal: cancel.signal }));

    const steps = Object.fromEntries(second.runs.steps(runId).map((step) => [step.name, step]));
    assert.equal(steps.prepare?.status, 'ok', 'a finished step was overwritten as skipped');
    assert.deepEqual(steps.prepare?.value, { ran: 1 }, 'and it still carries its result');
    assert.equal(steps.send?.status, 'skipped');

    second.dispose();
  } finally {
    first.dispose();
  }
});

test('a second runtime over the same file resumes without re-running finished steps', async () => {
  const first = spine(capabilities());

  try {
    await assert.rejects(() => startRun(first.deps, { capability: 'deploy', input: {} }));

    const runId = first.runs.list({ limit: 1 })[0]?.id ?? '';
    assert.equal(countOf(first), 1, 'the prepare step ran once before the run parked');

    const waiting = first.approvals.pending(runId);
    first.approvals.decide(waiting[0]?.id ?? '', {
      status: 'granted',
      decision: { confirmed: true },
      decidedAt: Date.now()
    });

    // A second runtime over the same file: fresh capabilities, fresh
    // checkpointer, fresh connection. Everything it knows about this run it
    // reads back off disk.
    const second = spine(capabilities(), { on: first.scratch });

    const result = await resumeRun(second.deps, { runId });

    assert.equal(result.data.sent, 'granted', 'the asking step re-ran and found its answer');
    assert.equal(result.data.ran, 1, 'and carries the value the first attempt produced');
    assert.equal(countOf(second), 1, 'the finished step did not run a second time');

    const run = second.runs.get(runId);
    assert.equal(run?.status, 'succeeded');

    const steps = Object.fromEntries(second.runs.steps(runId).map((step) => [step.name, step]));
    assert.equal(steps.prepare?.status, 'ok');
    assert.equal(steps.send?.status, 'ok');
    assert.equal(second.approvals.pending(runId).length, 0);

    // One continuous history across the two runtimes, not two runs stitched
    // together: the second connection carries on from the seq the first left.
    const events = second.events.since(runId, 0, 500);
    assert.deepEqual(
      events.map((event) => event.seq),
      events.map((_, index) => index + 1)
    );

    const types = events.map((event) => event.type);
    assert.ok(
      types.indexOf('run.suspended') < types.indexOf('run.resumed'),
      'suspended then resumed'
    );
    assert.equal(types.at(-1), 'run.succeeded');
  } finally {
    first.dispose();
  }
});
