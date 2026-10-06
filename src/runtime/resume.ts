/**
 * Picking a suspended run back up.
 *
 * The run's progress is on disk, so resuming is not "start again": the plan is
 * rebuilt from the same input, the steps that already finished are read back
 * out of `run_steps`, and the walk skips them. What actually re-runs is the
 * step that asked the question, from the top — which is the cost that the note
 * on `ApprovalGate` warns capability authors about, and the reason every
 * external call is fronted by a committed attempt record.
 *
 * The check for unsettled attempts is the other half of that. An attempt row
 * with no `settled_at` means a call may have been made and we do not know; the
 * only safe answer is to stop and ask a person. Resuming past it would be the
 * design's one unforced way to send a second email.
 */

import { executePlan } from '../core/orchestrator.js';
import { plan as makePlan } from '../core/planner.js';
import { route, validateInput } from '../core/router.js';
import { createCheckpointer } from '../runs/checkpoint.js';
import { staleGrounding } from './stale.js';
import { checkNeeds, withoutNeeds } from './needs.js';
import { CvContextError, RuntimeError } from '../contracts/index.js';
import type { RunResult } from '../contracts/index.js';
import {
  buildRunContext,
  givenInput,
  scopedDeps,
  recordedOutcomes,
  settleFailure,
  type RunHandle,
  type RuntimeDeps
} from './run.js';

export type ResumeRequest = {
  readonly runId: string;
  readonly signal?: AbortSignal;
  /** Extends the wall-clock ceiling; a run parked overnight has passed its old one. */
  readonly deadlineAt?: number;
};

/**
 * Picks a suspended run up and returns before it finishes.
 *
 * The same split as `beginRun`, for the same reason and one more: every check
 * below — the run exists, it is suspended, no attempt is unsettled — is a
 * refusal a caller has to *see*. Deferring "this run has an unsettled attempt
 * against mail" into a promise would turn the one answer that means *stop and
 * ask a person* into something a caller could forget to await.
 */
export const beginResume = (
  deps: RuntimeDeps,
  request: ResumeRequest
): RunHandle => {
  const now = deps.now ?? Date.now;
  const record = deps.runs.get(request.runId);

  if (!record) {
    throw new RuntimeError(`No such run: ${request.runId}.`, 'unknown_capability');
  }

  if (record.status !== 'suspended') {
    throw new RuntimeError(
      `Run ${record.id} is "${record.status}"; only a suspended run can be resumed.`,
      'invalid_transition'
    );
  }

  const open = deps.effects.attempts.unsettled(record.id);
  if (open.length > 0) {
    const names = [...new Set(open.map((attempt) => attempt.effect))].join(', ');
    throw new RuntimeError(
      `Run ${record.id} has ${open.length} unsettled attempt(s) against ${names}. `
        + 'Whether those calls happened is unknown, so this needs a person rather than a retry.',
      'unsettled_attempt'
    );
  }

  const capability = route(deps.capabilities, record.capability);
  const input = validateInput(capability, record.input);

  if (record.contextId && record.capability === 'extract_cv' && record.contextRevision === undefined) {
    throw new CvContextError('context_conflict', 'This legacy import has no original base revision; start a new import.');
  }
  const bound = scopedDeps(deps, record.contextId, record.conversationId, record.contextGeneration, record.contextRevision, record.offerSnapshotId);
  const checkpoint = createCheckpointer(deps.runs, record.id, now);
  checkpoint.resumed();

  const settled = (async (): Promise<RunResult> => {
    try {
      const given = givenInput(bound, capability.name, record.conversationId, record.id, input);

      const context = buildRunContext(bound, {
        ...(record.offerSnapshotId === undefined ? {} : { offerSnapshotId: record.offerSnapshotId }),
        ...(record.contextId === undefined ? {} : { contextId: record.contextId }),
        ...(bound.contextGeneration === undefined ? {} : { contextGeneration: bound.contextGeneration }),
        ...(bound.contextRevision === undefined ? {} : { contextRevision: bound.contextRevision }),
        ...(record.conversationId === undefined ? {} : { conversationId: record.conversationId }),
        runId: record.id,
        traceId: record.traceId,
        capability: capability.name,
        input: given.input,
        signal: request.signal ?? new AbortController().signal,
        deadlineAt:
          request.deadlineAt ?? now() + (deps.timeoutMs ?? 10 * 60 * 1000)
      }, given.supplied);

      const went = checkNeeds(capability, given.input, context);

      // What an earlier step assembled is read back as it was. A piece that has
      // changed since, or has been left out, is not sent as it was.
      const completed = recordedOutcomes(deps, record.id);
      staleGrounding(context, completed);

      const plan = await makePlan(capability, given.input, context);

      const result = withoutNeeds(
        await executePlan(plan, context, {
          checkpoint,
          aggregate: capability.aggregate?.bind(capability),
          approvalsFor: (step) => deps.gate(record.id, step),
          completedSteps: completed,
          now
        }),
        went
      );

      const commit = (value: RunResult) => checkpoint.succeeded(value.data, value.degraded, value.elapsedMs);
      if (deps.finish) return deps.finish(record.id, result, commit);
      commit(result);
      return result;
    } catch (error) {
      return settleFailure(checkpoint, error);
    }
  })();

  return { runId: record.id, settled };
};

/** The blocking form. See the note on `startRun`. */
export const resumeRun = async (
  deps: RuntimeDeps,
  request: ResumeRequest
): Promise<RunResult> => beginResume(deps, request).settled;
