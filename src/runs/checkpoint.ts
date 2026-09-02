/**
 * Every write a run makes about itself, in one object.
 *
 * The orchestrator, the executor and the runtime all need to record progress,
 * and each of them writing its own `checkpoint(patch, events)` call would mean
 * three places that have to remember to pair a state change with the events
 * announcing it — and to check the transition is legal first. Here it is paired
 * once per method, and the method names read as the thing that happened.
 *
 * The state change and its events go to `RunStore.checkpoint` together, which
 * is the whole of the atomicity story: one `BEGIN IMMEDIATE`, the run row, its
 * steps, and the events, or none of it.
 */

import type {
  NewEvent,
  Plan,
  RunFields,
  RunRecord,
  RunStatus,
  RunStore,
  StepPatch,
  StepRef
} from '../contracts/index.js';
import { RuntimeError } from '../contracts/index.js';
import * as emit from '../events/emit.js';
import { assertTransition } from './state.js';

export type Checkpointer = {
  readonly runId: string;
  /** The run as last read. Useful to a caller deciding whether to act at all. */
  current(): RunRecord;
  started(model?: { providerId: string; modelId: string }): void;
  planned(plan: Plan, steps: readonly StepRef[]): void;
  stepStarted(step: StepRef): void;
  stepSucceeded(step: StepRef, value: Readonly<Record<string, unknown>>, elapsedMs: number): void;
  stepDegraded(
    step: StepRef,
    reason: string,
    value: Readonly<Record<string, unknown>>,
    elapsedMs: number
  ): void;
  stepFailed(step: StepRef, reason: string, elapsedMs: number): void;
  /** Started and then told to stop, with no outcome either way. */
  stepStopped(step: StepRef, elapsedMs: number): void;
  /** Marks steps that never ran, so a stalled run reads honestly afterwards. */
  skipped(steps: readonly StepRef[]): void;
  suspended(step: StepRef, approvalId: string): void;
  resumed(approvalId?: string): void;
  succeeded(result: Readonly<Record<string, unknown>>, degraded: readonly string[], elapsedMs: number): void;
  failed(error: { code: string; message: string; step?: string }): void;
  cancelled(step?: string): void;
};

export const createCheckpointer = (
  runs: RunStore,
  runId: string,
  now: () => number = Date.now
): Checkpointer => {
  const current = (): RunRecord => {
    const record = runs.get(runId);
    if (!record) throw new RuntimeError(`No such run: ${runId}.`, 'unknown_capability');
    return record;
  };

  /**
   * Reads the current status and checks the edge before writing. The read and
   * the write are not in one transaction, which is deliberate: this is a guard
   * against a caller's own confused sequencing, not against a second process
   * racing us. Two processes driving the same run is not a case this system
   * has — a run belongs to whoever picked it up.
   */
  const move = (to: RunStatus, fields: Omit<RunFields, 'status'>, events: NewEvent[]): void => {
    assertTransition(runId, current().status, to);
    runs.checkpoint({ runId, run: { status: to, ...fields } }, events);
  };

  const step = (patch: StepPatch, events: NewEvent[]): void => {
    runs.checkpoint({ runId, steps: [patch] }, events);
  };

  return {
    runId,
    current,

    started(model) {
      move('running', { startedAt: now(), ...(model ?? {}) }, [emit.runStarted(model, now())]);
    },

    planned(plan, steps) {
      // No run-status change: the run is already `running`. The declaration and
      // the event still travel together, so a caller cannot see `run.planned`
      // and then find no steps to render.
      runs.checkpoint({ runId, declare: steps }, [
        emit.runPlanned(
          {
            source: plan.source,
            stages: plan.stages.map((stage) => ({ name: stage.name, steps: stage.steps.length }))
          },
          now()
        )
      ]);
    },

    stepStarted(ref) {
      step({ name: ref.name, status: 'running', startedAt: now() }, [emit.stepStarted(ref, now())]);
    },

    stepSucceeded(ref, value, elapsedMs) {
      step({ name: ref.name, status: 'ok', value, endedAt: now() }, [
        emit.stepSucceeded(ref, elapsedMs, now())
      ]);
    },

    stepDegraded(ref, reason, value, elapsedMs) {
      step({ name: ref.name, status: 'degraded', value, reason, endedAt: now() }, [
        emit.stepDegraded(ref, reason, elapsedMs, now())
      ]);
    },

    stepFailed(ref, reason, elapsedMs) {
      step({ name: ref.name, status: 'failed', reason, endedAt: now() }, [
        emit.stepFailed(ref, reason, elapsedMs, now())
      ]);
    },

    stepStopped(ref, elapsedMs) {
      step({ name: ref.name, status: 'stopped', endedAt: now() }, [
        emit.stepStopped(ref, elapsedMs, now())
      ]);
    },

    skipped(steps) {
      if (steps.length === 0) return;
      runs.checkpoint(
        {
          runId,
          steps: steps.map((ref) => ({ name: ref.name, status: 'skipped' as const, endedAt: now() }))
        },
        []
      );
    },

    suspended(ref, approvalId) {
      // The step goes back to `pending`, not `failed`. When the run resumes the
      // step runs again from the top — see the note on `ApprovalGate` — so
      // leaving it `running` would describe a step that no process is running.
      assertTransition(runId, current().status, 'suspended');
      runs.checkpoint(
        {
          runId,
          run: { status: 'suspended' },
          steps: [{ name: ref.name, status: 'pending' }]
        },
        [emit.runSuspended(ref.name, approvalId, now())]
      );
    },

    resumed(approvalId) {
      move('running', {}, [emit.runResumed(approvalId, now())]);
    },

    succeeded(result, degraded, elapsedMs) {
      move('succeeded', { result, degraded, endedAt: now() }, [
        emit.runSucceeded({ degraded, elapsedMs }, now())
      ]);
    },

    failed(error) {
      move('failed', { errorCode: error.code, errorMessage: error.message, endedAt: now() }, [
        emit.runFailed(error, now())
      ]);
    },

    cancelled(stepName) {
      move('cancelled', { endedAt: now() }, [emit.runCancelled(stepName, now())]);
    }
  };
};
