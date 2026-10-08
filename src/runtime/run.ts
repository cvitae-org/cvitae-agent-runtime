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
import { CvContextError, OperationError, RuntimeError, defaultMaskScope, isRunSuspension } from '../contracts/index.js';
import { maskedGateway } from '../effects/masking.js';
import { cvSeeds } from '../capabilities/cv/seeds.js';
import { createRecorder, recordingDocuments, recordingRetrieval } from './grounding.js';
import type { Grounding } from './grounding.js';
import type { HistorySupplier } from './history.js';
import { checkNeeds, withoutNeeds } from './needs.js';
import { wallPorts } from './walls.js';
import type {
  AiLogger,
  ApprovalGate,
  CapabilityMap,
  ChunkIndex,
  DocumentStore,
  EffectSet,
  LimitStore,
  Limits,
  MaskMode,
  MaskScope,
  MaskSeed,
  OfferShelf,
  Retriever,
  RunContext,
  RunResult,
  RunStore,
  SelectionStore,
  StepDelta,
  StepOutcome,
  SuppliedHistory,
  ToolRegistry,
  Pins,
  Walls
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
  readonly scopeOffer?: (snapshotId: string, conversationId: string) => Pick<RuntimeDeps, 'documents' | 'retrieval' | 'index' | 'effects' | 'offerId'> & { readonly contextGeneration: number; readonly contextRevision: number };
  readonly offerInput?: (snapshotId: string, capability: string, input: unknown) => unknown;
  readonly scopeCv?: (contextId: string, conversationId?: string, generation?: number, revision?: number) => Pick<RuntimeDeps, 'documents' | 'retrieval' | 'index'> & { readonly contextGeneration: number; readonly contextRevision: number };
  readonly contextGeneration?: number;
  readonly contextRevision?: number;
  /**
   * The saved offer a snapshot run is about, set by `scopeOffer` and by nothing
   * else, so it exists only on the deps of a run bound to a snapshot.
   */
  readonly offerId?: string;
  /**
   * What lets a chat run say what the model was given and what it read.
   *
   * The run store opens and settles a record for every run that has a
   * conversation, whether or not this is set. Absent means nothing writes into
   * it: the record is still there, closed, with no entries, and the runtime
   * behaves as it did before records existed. A record that is empty because
   * nothing was recorded is not a statement that the model was given nothing,
   * so a host that shows records must set this.
   */
  readonly grounding?: Grounding;
  /**
   * What each conversation has excluded. A run that belongs to a conversation
   * reads the CV through ports with those pieces taken out, asked again at every
   * read. Absent means nothing is excluded from any run, as before selections.
   * `pins` are what the same conversation keeps in every message; absent means
   * nothing is pinned, as before assembly.
   */
  readonly selection?: Pick<SelectionStore, 'walls'> & Partial<Pick<SelectionStore, 'pins'>>;
  /**
   * What a person has set as the most the material of a message may come to.
   * Absent means nothing is set and each part is held to its own baseline only,
   * as before limits.
   */
  readonly limits?: Pick<LimitStore, 'effective'>;
  /**
   * The saved offers a message may compare. Absent means the runtime keeps no
   * offers a chat run can read, and a message that names some is refused.
   */
  readonly offerShelf?: OfferShelf;
  /**
   * When a model call of a run is masked and which of a person's values are:
   * what a person has set, asked at the start of every run. Absent means no call
   * is masked, as before masking.
   */
  readonly masking?: { readonly mode: () => MaskMode; readonly scope?: () => MaskScope };
  /**
   * Keeps the conversation of a run whose host sent none. Absent means a run is
   * given the history and summary it was sent, and nothing else, as before.
   */
  readonly history?: HistorySupplier;
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

/**
 * What a run's model is not to be told, read from the CV the run is bound to.
 *
 * From the store the run was handed and not from the walled ports: a piece a
 * person has left out of a message is a piece to keep from the model twice over,
 * and a name that is excluded from the CV is still a name. A run that is not
 * allowed to read the CV at all — discovery is not — has nothing of the person's
 * to keep out of its calls, and says so by refusing the read; that refusal is
 * the one thing not passed on.
 */
const seedsOf = (documents: DocumentStore, scope: MaskScope): readonly MaskSeed[] => {
  try {
    return cvSeeds(documents, scope);
  } catch (error) {
    if (error instanceof OperationError && error.code === 'search_scope') return [];
    throw error;
  }
};

/**
 * The effects a run is handed: the same, with the gateway that masks. The mode and
 * the scope are asked once, here, so a run is held to what a person had set when
 * it began and not to whatever they have set since. A host that gives no scope
 * is held to the default.
 */
const maskedEffects = (
  effects: EffectSet,
  masking: NonNullable<RuntimeDeps['masking']>,
  documents: DocumentStore
): EffectSet => {
  const scope = masking.scope?.() ?? defaultMaskScope;

  return {
    ...effects,
    ai: maskedGateway(effects.ai, {
      mode: masking.mode(),
      seeds: () => seedsOf(documents, scope),
      detect: true
    })
  };
};

/**
 * The input a run is planned and run from: the one it was validated to, with the
 * conversation put in when the runtime keeps it (`history.ts`).
 *
 * The stored input is never this one. A run's identity is its input as validated,
 * and a retry of the same request has to find the same run whatever the
 * conversation has grown by since. Shared with `resume.ts`, which reads the
 * conversation again: a run that waited for a person is given what the
 * conversation holds now, exclusions made while it waited included.
 */
export const givenInput = (
  deps: Pick<RuntimeDeps, 'history'>,
  capability: string,
  conversationId: string | undefined,
  runId: string,
  input: Readonly<Record<string, unknown>>
): { readonly input: Readonly<Record<string, unknown>>; readonly supplied?: SuppliedHistory } => {
  const made =
    conversationId === undefined ? undefined : deps.history?.supply({ capability, conversationId, runId, input });
  return made === undefined ? { input } : made;
};

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
    /** A context made for a preview, which calls no model (`preview.ts`). */
    preview?: true;
  },
  /** What `fields.input` holds as the conversation, when the runtime put it there. */
  supplied?: SuppliedHistory
): RunContext => {
  // Only a run that belongs to a conversation has a record, and building the
  // sink reads nothing: the record is first touched by the first step that has
  // something to say, which is inside the run's own failure handling.
  const record =
    deps.grounding === undefined || fields.conversationId === undefined
      ? undefined
      : createRecorder(deps.grounding, {
          runId: fields.runId,
          conversationId: fields.conversationId,
          ...(fields.contextId === undefined ? {} : { contextId: fields.contextId }),
          ...(deps.offerId === undefined ? {} : { offerId: deps.offerId }),
          input: fields.input,
          ...(supplied === undefined ? {} : { supplied })
        });

  // What the conversation has excluded, read at every access. Only a run that is
  // about a CV of the person's own has anything to cut: a run about a saved offer
  // reads a copy the offer was captured with, and no selection names that.
  const { selection } = deps;
  const { conversationId, contextId } = fields;
  const walls: Walls | undefined =
    selection === undefined || conversationId === undefined || contextId === undefined || deps.offerId !== undefined
      ? undefined
      : { pieces: () => selection.walls(conversationId) };

  // What the conversation keeps in every message, on the runs that have walls and
  // no others: a pin is a piece of the CV a run is about.
  const pins: Pins | undefined =
    walls === undefined || selection?.pins === undefined
      ? undefined
      : { pieces: () => selection.pins!(conversationId!) };

  // What the person has set as the most a message's material may come to, on every
  // run that belongs to a conversation, asked again at every message. A saved
  // offer's conversation has a limit too: it is the amount of text that is
  // bounded, and not what the text is about.
  const limits: Limits | undefined =
    conversationId === undefined || deps.limits === undefined
      ? undefined
      : { context: () => deps.limits!.effective(conversationId!) };

  // Cut first and recorded after, so the record sees the stored document through
  // the cut one and can say what of it the model was shown.
  const ports =
    walls === undefined || contextId === undefined
      ? { documents: deps.documents, retrieval: deps.retrieval, index: deps.index }
      : wallPorts({ documents: deps.documents, retrieval: deps.retrieval, index: deps.index }, walls, contextId);

  // The one place a model is reached from a run, so the one place it is masked:
  // every capability, step and tool is handed this gateway. A preview calls no
  // model and is left as it was.
  const effects: EffectSet =
    deps.masking === undefined || fields.preview === true
      ? deps.effects
      : maskedEffects(deps.effects, deps.masking, deps.documents);

  return {
    ...fields,
    effects,
    tools: deps.tools,
    // The ports say what they were asked for. Wrapped only when there is a
    // record to say it to, so every other run holds the ports it always did.
    documents: record === undefined ? ports.documents : recordingDocuments(ports.documents, record),
    retrieval:
      record === undefined ? ports.retrieval : recordingRetrieval(ports.retrieval, ports.documents, record),
    index: ports.index,
    ...(record === undefined ? {} : { record }),
    ...(walls === undefined ? {} : { walls }),
    ...(pins === undefined ? {} : { pins }),
    ...(limits === undefined ? {} : { limits }),
    // On the runs that have walls and no others: an offer is left out by the same
    // conversation that leaves a piece of its CV out.
    ...(walls === undefined || deps.offerShelf === undefined ? {} : { offers: deps.offerShelf }),
    approvals: deps.gate(fields.runId, 'plan'),
    logger: deps.logger,
    // The run id is added here rather than passed by the step, because a step
    // that had to name the run it belongs to could name the wrong one.
    deltas: (delta) => deps.deltas?.({ ...delta, runId: fields.runId })
  };
};

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

  const settled = (async (): Promise<RunResult> => {
    try {
      // Read here and not before the run row exists: a conversation that cannot
      // be read is a failure of this run, which has an id by now to say so with.
      const given = givenInput(bound, capability.name, request.conversationId, runId, input);

      const context = buildRunContext(bound, {
        ...(request.offerSnapshotId === undefined ? {} : { offerSnapshotId: request.offerSnapshotId }),
        ...(request.contextId === undefined ? {} : { contextId: request.contextId }),
        ...(bound.contextGeneration === undefined ? {} : { contextGeneration: bound.contextGeneration }),
        ...(bound.contextRevision === undefined ? {} : { contextRevision: bound.contextRevision }),
        ...(request.conversationId === undefined ? {} : { conversationId: request.conversationId }),
        runId,
        traceId,
        capability: capability.name,
        input: given.input,
        signal: request.signal ?? new AbortController().signal,
        deadlineAt
      }, given.supplied);

      // Before the plan, which may call a model: a run that cannot be answered
      // has cost nothing yet.
      const went = checkNeeds(capability, given.input, context);
      const plan = await makePlan(capability, given.input, context);

      const result = withoutNeeds(
        await executePlan(plan, context, {
          checkpoint,
          aggregate: capability.aggregate?.bind(capability),
          approvalsFor: (step) => deps.gate(runId, step),
          now
        }),
        went
      );

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
