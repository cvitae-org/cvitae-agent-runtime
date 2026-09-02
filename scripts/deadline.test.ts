/**
 * A run that runs out of time, and what it must be filed as.
 *
 * There was no test here at all, which is how the bug below shipped: the
 * deadline is the one stop condition with no caller on the other end to notice
 * it went unreported.
 *
 * The distinction it protects is the same one `cancellation.test.ts` protects
 * from the other side. A cancelled run is nothing going wrong — someone asked
 * to stop — and a timeout is something going wrong. Collapsing the two makes
 * the run history useless in both directions at once: real timeouts hide among
 * cancellations, and the count of cancellations stops meaning anything.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeError } from '../src/contracts/index.js';
import { startRun } from '../src/runtime/run.js';
import { noop, spine, stage, transform, untilAborted } from './support/spine.js';

/**
 * A step that waits to be stopped and then throws what the AI gateway throws.
 *
 * That detail is the whole point. The gateway's abort error is a `RuntimeError`
 * with code `aborted` and the message `The call was cancelled.`, and the
 * orchestrator's `classify` rethrows an unrecognised `RuntimeError` as-is — so
 * whenever the deadline check fails to fire, this is the error that reaches the
 * caller, and `settleFailure` maps its code to run status `cancelled`. A step
 * throwing a plain `Error` would be classified correctly by accident.
 */
const waits = (name: string) =>
  transform(name, async (context) => {
    try {
      await untilAborted(context.signal);
    } catch {
      throw new RuntimeError('The call was cancelled.', 'aborted');
    }
    return {};
  });

const expired = async (s: ReturnType<typeof spine>, deadlineAt: number): Promise<void> => {
  await assert.rejects(
    () => startRun(s.deps, { capability: 'probe', input: {}, deadlineAt }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'deadline_exceeded');
      assert.match(error.message, /passed its deadline during step "slow"/);
      return true;
    }
  );

  const [run] = s.runs.list({ limit: 1 });
  assert.equal(run?.status, 'failed', 'a run that ran out of time did not end cancelled');
  assert.equal(run?.errorCode, 'deadline_exceeded');
};

test('a run past its deadline is reported as a deadline', async () => {
  const s = spine({ probe: noop('probe', [stage('work', [waits('slow')], 1)]) });

  try {
    await expired(s, Date.now() + 40);
  } finally {
    s.dispose();
  }
});

/**
 * The same run with the clock held still, which is the case that was broken.
 *
 * `classify` used to answer "was this the deadline?" by comparing `now()` to
 * `deadlineAt`. The timer that actually stops the run is a separate mechanism,
 * and the two disagree whenever `setTimeout` fires against a clock that has not
 * visibly advanced — a coarse clock, or an injected one, as here. The check
 * then read false and the run was filed as a cancellation with no error code:
 * a timeout recorded as though a person had pressed ctrl-c.
 *
 * Freezing the clock does not invent the disagreement, it makes it certain. The
 * test above passes either way, which is why it is not enough on its own.
 */
test('the deadline is read from the signal that fired, not from the clock', async () => {
  const frozen = Date.now();
  const s = spine({ probe: noop('probe', [stage('work', [waits('slow')], 1)]) }, {
    now: () => frozen
  });

  try {
    await expired(s, frozen + 30);
  } finally {
    s.dispose();
  }
});

test('the steps a deadline caught are recorded as stopped and skipped', async () => {
  const started: string[] = [];
  const frozen = Date.now();

  const s = spine(
    {
      probe: noop('probe', [
        stage(
          'work',
          [
            waits('slow'),
            transform('queued', async () => {
              started.push('queued');
              return {};
            })
          ],
          1
        )
      ])
    },
    { now: () => frozen }
  );

  try {
    await assert.rejects(() =>
      startRun(s.deps, { capability: 'probe', input: {}, deadlineAt: frozen + 30 })
    );

    assert.deepEqual(started, [], 'the queued step must never have begun');

    const [run] = s.runs.list({ limit: 1 });
    const steps = Object.fromEntries(s.runs.steps(run?.id ?? '').map((step) => [step.name, step]));

    assert.equal(steps.slow?.status, 'stopped');
    assert.equal(steps.queued?.status, 'skipped');
  } finally {
    s.dispose();
  }
});

/**
 * The shape the bug was actually found in, which needs two stages to show.
 *
 * `translate_cv` translates its sections in one stage and assembles them in the
 * next. The deadline caught the section stage, and `assemble` — a stage that
 * never got its turn — kept the `pending` it was declared with. `runs show`
 * then printed a terminal run with work apparently still outstanding.
 *
 * The orchestrator already skipped the steps a failure prevented *within* a
 * stage, for exactly this reason. `classify` throws out of the stage loop, so
 * everything past it was never visited at all.
 */
test('a stage that never got its turn is skipped, not left pending', async () => {
  const frozen = Date.now();

  const s = spine(
    {
      probe: noop('probe', [
        stage('sections', [waits('slow')], 1),
        stage('assemble', [transform('assemble', async () => ({}))], 1)
      ])
    },
    { now: () => frozen }
  );

  try {
    await assert.rejects(() =>
      startRun(s.deps, { capability: 'probe', input: {}, deadlineAt: frozen + 30 })
    );

    const [run] = s.runs.list({ limit: 1 });
    const steps = Object.fromEntries(s.runs.steps(run?.id ?? '').map((step) => [step.name, step]));

    assert.equal(steps.slow?.status, 'stopped');
    assert.equal(steps.assemble?.status, 'skipped');
  } finally {
    s.dispose();
  }
});

/**
 * The inverse, and the reason the fix is a signal check rather than a wider
 * clock comparison: a step that fails on its own before the deadline is a step
 * failing. Nothing about the run being on a timer makes it a timeout.
 */
test('a step failing well inside the deadline is not blamed on the deadline', async () => {
  const s = spine({
    probe: noop('probe', [
      stage('work', [transform('slow', async () => { throw new Error('nothing to analyse'); })], 1)
    ])
  });

  try {
    await assert.rejects(
      () => startRun(s.deps, { capability: 'probe', input: {}, deadlineAt: Date.now() + 60_000 }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, 'step_failed');
        assert.match(error.message, /nothing to analyse/);
        return true;
      }
    );

    const [run] = s.runs.list({ limit: 1 });
    assert.equal(run?.status, 'failed');
    assert.equal(run?.errorCode, 'step_failed');
  } finally {
    s.dispose();
  }
});
