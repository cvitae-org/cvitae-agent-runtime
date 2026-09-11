/**
 * Driving a run from a request to a result.
 *
 * This is the one place that knows the *shape* of a run's life: create the row,
 * mark it running, plan, walk the plan, and record how it ended. Everything it
 * needs is passed in — it opens nothing, resolves nothing and reads no global.
 * `create.ts` is where those things are built and handed over.
 *
 * The error mapping at the bottom is the interesting part, because it is where
 * the run-status vocabulary earns its keep. A cancelled run is not a failed
 * one, a suspended run has not ended at all, and both were, in the previous
 * runtime, indistinguishable from a step throwing.
 */

import { executePlan } from '../core/orchestrator.js';
import { plan as makePlan } from '../core/planner.js';
import { route, validateInput } from '../core/router.js';
import { createCheckpointer } from '../runs/checkpoint.js';
import * as emit from '../events/emit.js';
import { CvContextError, OperationError, RuntimeError, isRunSuspension } from '../contracts/index.js';
import type {
  AiLogger,
  ApprovalGate,
  CapabilityMap,
  ChunkIndex,
  DocumentStore,
  EffectSet,
  Retriever,
  RunContext,
  RunResult,
  RunStore,
  StepDelta,
  StepOutcome,
  ToolRegistry
} from '../contracts/index.js';

/**
 * Everything a run reaches, assembled once at startup.
 *
 * The approval gate arrives as a factory rather than an instance because a gate
 * is bound to a `(run, step)` pair — that pair is the key a person's answer is
 * filed under, and a gate that did not know it could not find one.
 */
export type RuntimeDeps = {
  /** Resolves and validates captured context ownership before creating a run. */
  readonly scopeLegacy?: () => void;
  readonly scopeOffer?: (snapshotId: string, conversationId: string) => Pick<RuntimeDeps, 'documents' | 'retrieval' | 'index' | 'effects'> & { readonly contextGeneration: number; readonly contextRevision: number };
  readonly offerInput?: (snapshotId: string, capability: string, input: unknown) => unknown;
  readonly scopeCv?: (contextId: string, conversationId?: string, generation?: number, revision?: number) => Pick<RuntimeDeps, 'documents' | 'retrieval' | 'index'> & { readonly contextGeneration: number; readonly contextRevision: number };
  readonly contextGeneration?: number;
  readonly contextRevision?: number;
  readonly finish?: (runId: string, result: RunResult, commit: (result: RunResult) => void) => RunResult;
  readonly capabilities: CapabilityMap;
  readonly runs: RunStore;
  readonly gate: (runId: string, step: string) => ApprovalGate;
  readonly effects: EffectSet;
  readonly tools: ToolRegistry;
  readonly documents: DocumentStore;
  readonly retrieval: Retriever;
  readonly index: ChunkIndex;
  readonly logger: AiLogger;
  /**
   * Where every run's deltas go, if anywhere.
   *
   * Process-wide and keyed by `runId` rather than registered per run, because
   * the one caller that wants deltas — a host with a window attached — is
   * already routing by run id for events. Absent means nobody is listening,
   * which is the ordinary case.
   */
  readonly deltas?: (delta: StepDelta & { readonly runId: string }) => void;
  readonly newRunId: () => string;
  readonly now?: () => number;
  /** Wall-clock ceiling applied when a caller names no deadline. */
  readonly timeoutMs?: number;
};

export type RunRequest = {
  readonly offerSnapshotId?: string;
  readonly contextId?: string;
  readonly contextGeneration?: number;
  readonly contextRevision?: number;
  readonly conversationId?: string;
  readonly capability: string;
  readonly input: unknown;
  readonly signal?: AbortSignal;
  readonly deadlineAt?: number;
  /** Supplied by a caller that needs to know the id before the run finishes. */
  readonly runId?: string;
  readonly traceId?: string;
};

export const scopedDeps = (deps: RuntimeDeps, contextId?: string, conversationId?: string, generation?: number, revision?: number, offerSnapshotId?: string): RuntimeDeps => {
  if (offerSnapshotId !== undefined) {
    if (!deps.scopeOffer || !conversationId) throw new CvContextError('invalid_input', 'Snapshot runs require a conversation.');
    return { ...deps, ...deps.scopeOffer(offerSnapshotId, conversationId) };
  }
  if ((conversationId !== undefined || generation !== undefined || revision !== undefined) && contextId === undefined) {
    throw new CvContextError('invalid_input', 'A conversation-bound run requires a context ID.');
  }
  if (contextId === undefined) {
    deps.scopeLegacy?.();
    return deps;
  }
  if (!deps.scopeCv) throw new CvContextError('invalid_input', 'This runtime does not support CV context binding.');
  return { ...deps, ...deps.scopeCv(contextId, conversationId, generation, revision) };
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export const buildRunContext = (
  deps: RuntimeDeps,
  fields: {
    offerSnapshotId?: string;
    contextId?: string;
    contextGeneration?: number;
    contextRevision?: number;
    conversationId?: string;
    runId: string;
    traceId: string;
    capability: string;
    input: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
    deadlineAt: number;
  }
): RunContext => ({
  ...fields,
  effects: deps.effects,
  tools: deps.tools,
  documents: deps.documents,
  retrieval: deps.retrieval,
  index: deps.index,
  approvals: deps.gate(fields.runId, 'plan'),
  logger: deps.logger,
  // The run id is added here rather than passed by the step, because a step
  // that had to name the run it belongs to could name the wrong one.
  deltas: (delta) => deps.deltas?.({ ...delta, runId: fields.runId })
});

/**
 * Records how a run ended and rethrows.
 *
 * Shared with `resume.ts`, because the endings are a property of a run rather
 * than of how it was started, and having two copies is how they drift.
 */
export const settleFailure = (
  checkpoint: ReturnType<typeof createCheckpointer>,
  error: unknown
): never => {
  // Already parked, atomically, by the orchestrator: the run is `suspended` and
  // the step is back to `pending`. There is nothing to record here, and marking
  // it failed would destroy a run that is merely waiting for a person.
  if (isRunSuspension(error)) throw error;

  if (error instanceof RuntimeError && error.code === 'aborted') {
    checkpoint.cancelled();
    throw error;
  }

  const code = error instanceof RuntimeError || error instanceof OperationError ? error.code : 'step_failed';
  const message = String((error as Error)?.message ?? error).slice(0, 500);
  checkpoint.failed({ code, message });
  throw error;
};

/**
 * A run that has been created and is now executing.
 *
 * The id exists before the work does, and that is the whole point. `run.cancel`
 * and `runs.events` need something to name while the run is still going: a
 * front door that answers only once the run is over turns its event log into a
 * transcript nobody could subscribe to, and makes an approval answerable only
 * after the run that asked for it has already returned.
 *
 * `settled` is exactly the promise `startRun` returns. Whoever holds a handle
 * must attach a handler to it — a run failing is an ordinary outcome here, and
 * an unwatched rejection is a process-level warning about something that is not
 * a defect.
 */
export type RunHandle = {
  readonly runId: string;
  readonly settled: Promise<RunResult>;
};

/**
 * Creates the run, sets it going, and returns its id without waiting for it.
 *
 * Everything before the first `await` is deliberately synchronous, so that by
 * the time this returns the row exists, the run is `running`, and `run.queued`
 * and `run.started` are already in the log. A caller that turns round and asks
 * for events finds them; one that cancels finds a run to cancel.
 *
 * Routing and validation throw *to this caller* rather than into `settled`, for
 * the reason the original comment gave: a request naming a capability that does
 * not exist never became a run. There is no id to hand out for it, and burying
 * the refusal in a promise would leave the caller holding an id for nothing.
 */
export const beginRun = (deps: RuntimeDeps, request: RunRequest): RunHandle => {
  const now = deps.now ?? Date.now;

  // Both of these throw before a run row exists, and that is correct: a request
  // naming a capability that does not exist, or carrying input that capability
  // cannot accept, never became a run. Recording it as a failed one would fill
  // the history with rows that describe a caller's bug rather than any work.
  const capability = route(deps.capabilities, request.capability);
  const input = validateInput(capability, request.offerSnapshotId ? deps.offerInput?.(request.offerSnapshotId, request.capability, request.input) : request.input);
  const bound = scopedDeps(deps, request.contextId, request.conversationId, request.contextGeneration, request.contextRevision, request.offerSnapshotId);

  const runId = request.runId ?? deps.newRunId();
  const traceId = request.traceId ?? runId;
  const deadlineAt = request.deadlineAt ?? now() + (deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const createdAt = now();

  deps.runs.create(
    { id: runId, capability: capability.name, input, traceId, deadlineAt, createdAt,
      ...(request.offerSnapshotId === undefined ? {} : { offerSnapshotId: request.offerSnapshotId }),
      ...(request.contextId === undefined ? {} : { contextId: request.contextId }),
      ...(bound.contextGeneration === undefined ? {} : { contextGeneration: bound.contextGeneration }),
      ...(bound.contextRevision === undefined ? {} : { contextRevision: bound.contextRevision }),
      ...(request.conversationId === undefined ? {} : { conversationId: request.conversationId }) },
    [emit.runQueued(capability.name, createdAt)]
  );

  const checkpoint = createCheckpointer(deps.runs, runId, now);
  checkpoint.started(deps.effects.ai.describe());

  const context = buildRunContext(bound, {
    ...(request.offerSnapshotId === undefined ? {} : { offerSnapshotId: request.offerSnapshotId }),
      ...(request.contextId === undefined ? {} : { contextId: request.contextId }),
      ...(bound.contextGeneration === undefined ? {} : { contextGeneration: bound.contextGeneration }),
      ...(bound.contextRevision === undefined ? {} : { contextRevision: bound.contextRevision }),
    ...(request.conversationId === undefined ? {} : { conversationId: request.conversationId }),
    runId,
    traceId,
    capability: capability.name,
    input,
    signal: request.signal ?? new AbortController().signal,
    deadlineAt
  });

  const settled = (async (): Promise<RunResult> => {
    try {
      const plan = await makePlan(capability, input, context);

      const result = await executePlan(plan, context, {
        checkpoint,
        aggregate: capability.aggregate?.bind(capability),
        approvalsFor: (step) => deps.gate(runId, step),
        now
      });

      const commit = (value: RunResult) => checkpoint.succeeded(value.data, value.degraded, value.elapsedMs);
      if (deps.finish) return deps.finish(runId, result, commit);
      commit(result);
      return result;
    } catch (error) {
      return settleFailure(checkpoint, error);
    }
  })();

  return { runId, settled };
};

/**
 * The blocking form: begin a run and wait for it.
 *
 * Kept because it is the honest shape for a CLI and for a test, both of which
 * have nothing to do between the two halves. A UI wants `beginRun`.
 */
export const startRun = async (
  deps: RuntimeDeps,
  request: RunRequest
): Promise<RunResult> => beginRun(deps, request).settled;

/** The outcomes of steps that already finished, for a resumed run. */
export const recordedOutcomes = (deps: RuntimeDeps, runId: string): StepOutcome[] =>
  deps.runs
    .steps(runId)
    .filter((step) => step.status === 'ok' || step.status === 'degraded')
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((step) => ({
      step: step.name,
      status: step.status === 'ok' ? ('ok' as const) : ('degraded' as const),
      ...(step.reason === undefined ? {} : { reason: step.reason }),
      value: step.value ?? {}
    }));
