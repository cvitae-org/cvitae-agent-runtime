/**
 * Stopping a run, and what "stopped" has to mean.
 *
 * Two properties, and the second is the one that costs money if it is missing.
 *
 * A cancelled run must end `cancelled`, not `failed`. Nothing went wrong — a
 * caller asked to stop — and a run history that files those next to genuine
 * failures stops being usable for spotting genuine failures.
 *
 * And the steps that had not started must never start. The previous runtime
 * examined a pool's results only once every task in it had settled, so a run
 * abandoned after its first step went on paying for the rest against a busy
 * local GPU, and the next run queued behind work whose result nobody wanted.
 *
 * Both properties were confirmed by breaking them. Removing the pool's
 * abort check before it claims a slot turns the two queued steps from
 * `skipped` into `running` — they start, issue their call, and have the result
 * thrown away, which is precisely the waste being prevented. Removing the
 * `stop.abort` that a critical failure raises does not fail the test at all: it
 * hangs, because the sibling waiting on the stage signal is never told to stop.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { startRun } from '../src/runtime/run.js';
import { noop, spine, stage, timeline, transform, untilAborted } from './support/spine.js';

test('cancelling mid-plan stops the queued steps and ends the run cancelled', async () => {
  const started: string[] = [];
  const cancel = new AbortController();

  const s = spine({
    probe: noop('probe', [
      stage(
        'work',
        [
          transform('first', async () => {
            started.push('first');
            return { first: true };
          }),
          transform('second', async (context) => {
            started.push('second');
            cancel.abort(new Error('the user closed the window'));
            await untilAborted(context.signal);
            return {};
          }),
          transform('third', async () => {
            started.push('third');
            return { third: true };
          })
        ],
        1
      )
    ])
  });

  try {
    await assert.rejects(
      () => startRun(s.deps, { capability: 'probe', input: {}, signal: cancel.signal }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, 'aborted');
        assert.match(error.message, /cancelled during step "second"/);
        return true;
      }
    );

    assert.deepEqual(started, ['first', 'second'], 'the third step must never have begun');

    const [run] = s.runs.list({ limit: 1 });
    assert.equal(run?.status, 'cancelled');
    assert.equal(run?.errorCode, undefined, 'a cancellation is not an error');

    const steps = Object.fromEntries(s.runs.steps(run?.id ?? '').map((step) => [step.name, step]));
    assert.equal(steps.first?.status, 'ok');
    assert.equal(steps.third?.status, 'skipped');

    // The second step is `stopped`: it was interrupted, not failed and not
    // finished, and recording either would be a claim the runtime cannot make.
    //
    // It used to be left at `running`, on the same argument. That argument
    // rules out `ok` and `failed` and it does not reach `running`, which claims
    // a process is executing the step at the moment you read the row — false
    // for every run on this list, all of which are over. `runs show` printed a
    // cancelled run with a step in flight underneath it.
    assert.equal(steps.second?.status, 'stopped');

    const types = timeline(s, run?.id ?? '');
    assert.equal(types.at(-1), 'run.cancelled');
    assert.ok(!types.includes('step.failed'), 'an abort is not a step failing');

    // A caller tailing the events must be able to see the step end. Without
    // this it reads `step.started` and then nothing, for ever.
    assert.ok(types.includes('step.stopped'));
  } finally {
    s.dispose();
  }
});

test('a critical failure aborts its siblings as it settles, not after', async () => {
  const started: string[] = [];

  const s = spine({
    probe: noop('probe', [
      stage(
        'work',
        [
          transform('doomed', async () => {
            started.push('doomed');
            throw new Error('nothing to analyse');
          }),
          transform('slow', async (context) => {
            started.push('slow');
            await untilAborted(context.signal);
            return {};
          }),
          transform('queued-a', async () => {
            started.push('queued-a');
            return {};
          }),
          transform('queued-b', async () => {
            started.push('queued-b');
            return {};
          })
        ],
        // Two workers and four steps, so two of them are genuinely queued
        // behind the failure rather than merely last in a serial walk.
        2
      )
    ])
  });

  try {
    await assert.rejects(
      () => startRun(s.deps, { capability: 'probe', input: {} }),
      /nothing to analyse/
    );

    assert.deepEqual(
      started.sort(),
      ['doomed', 'slow'],
      'the two queued steps must never have begun'
    );

    const [run] = s.runs.list({ limit: 1 });
    const steps = Object.fromEntries(s.runs.steps(run?.id ?? '').map((step) => [step.name, step]));
    assert.equal(steps.doomed?.status, 'failed');
    assert.equal(steps['queued-a']?.status, 'skipped');
    assert.equal(steps['queued-b']?.status, 'skipped');

    // `slow` is the sibling that was already in flight when `doomed` threw. It
    // is the same interruption as a cancellation — different cause, same
    // absence of a result — and it is not the step whose rejection the
    // orchestrator classifies, so it is the one a fix applied only to the
    // classified failure would miss.
    assert.equal(steps.slow?.status, 'stopped');
  } finally {
    s.dispose();
  }
});
