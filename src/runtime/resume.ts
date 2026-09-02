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
import { RuntimeError } from '../contracts/index.js';
import type { RunResult } from '../contracts/index.js';
import {
  buildRunContext,
  recordedOutcomes,
  settleFailure,
  type RuntimeDeps
} from './run.js';

export type ResumeRequest = {
  readonly runId: string;
  readonly signal?: AbortSignal;
  /** Extends the wall-clock ceiling; a run parked overnight has passed its old one. */
  readonly deadlineAt?: number;
};

export const resumeRun = async (
  deps: RuntimeDeps,
  request: ResumeRequest
): Promise<RunResult> => {
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

  const checkpoint = createCheckpointer(deps.runs, record.id, now);
  checkpoint.resumed();

  const context = buildRunContext(deps, {
    runId: record.id,
    traceId: record.traceId,
    capability: capability.name,
    input,
    signal: request.signal ?? new AbortController().signal,
    deadlineAt:
      request.deadlineAt ?? now() + (deps.timeoutMs ?? 10 * 60 * 1000)
  });

  try {
    const plan = await makePlan(capability, input, context);

    const result = await executePlan(plan, context, {
      checkpoint,
      aggregate: capability.aggregate?.bind(capability),
      approvalsFor: (step) => deps.gate(record.id, step),
      completedSteps: recordedOutcomes(deps, record.id),
      now
    });

    checkpoint.succeeded(result.data, result.degraded, result.elapsedMs);
    return result;
  } catch (error) {
    return settleFailure(checkpoint, error);
  }
};
