/**
 * What a run is: its states, its steps, and the context a step is handed.
 *
 * The run-state vocabulary lives here rather than in `capability.ts` because
 * the database needs it as much as the executor does — `runs.status`,
 * `run_steps.kind` and `run_steps.status` are columns, and a capability's
 * declaration of work is a separate thing from the record of that work being
 * done.
 */

import type { AiLogger, EffectSet } from './effects.js';
import type { ToolRegistry } from './tools.js';
import type { DocumentStore } from './document-store.js';
import type { ChunkIndex, Retriever } from './chunk-index.js';

/* ------------------------------------------------------------------ states */

/**
 * `'suspended'` is the one worth arguing about, so here is the argument.
 *
 * A run that needs a person — a recipient to confirm, an ambiguous match to
 * resolve — has three possible designs. It can block on a promise, which means
 * the process has to stay alive and a laptop closing loses the work. It can
 * fail and be started again, which throws away everything already computed and
 * re-runs every effect. Or the state can be first-class, and the run parks with
 * its progress on disk until someone answers.
 *
 * Only the third survives a restart, and it is very hard to retrofit: adding it
 * later means every step boundary that already exists has to learn how to be
 * interrupted. So it is here in the first cut even though the first capability
 * never uses it.
 *
 * `'cancelled'` is distinct from `'failed'` because nothing went wrong — the
 * caller asked to stop, and a run history that files those next to real
 * failures becomes useless for spotting real failures.
 */
/**
 * A list rather than a bare union, because two places need these at runtime:
 * the SQLite `CHECK` constraint's sibling in TypeScript, and the payload schema
 * an adapter validates against before a value from outside becomes a filter.
 */
export const runStatuses = [
  'queued',
  'running',
  'suspended',
  'succeeded',
  'failed',
  'cancelled'
] as const;

export type RunStatus = (typeof runStatuses)[number];

export type StepStatus =
  | 'pending'
  | 'running'
  | 'ok'
  /** Failed, but not critically: its fallback was applied and its name recorded. */
  | 'degraded'
  | 'failed'
  /** Never started, because something before it made it pointless. */
  | 'skipped'
  /**
   * Started, then told to stop before it produced anything — by a caller
   * cancelling, by the deadline, or by a critical sibling failing.
   *
   * The three states that already existed all say something this one cannot.
   * `ok` and `failed` both claim the step reached a conclusion; it did not, and
   * recording either would put a verdict in the row that nothing arrived at.
   * `skipped` claims it never began, which loses the fact that a call went out
   * and was paid for. And `running` — what this was, before — claims a process
   * is executing it *now*, which is false the moment the run is terminal: a
   * finished run reading as though work were still in flight is the one thing a
   * run history must not say.
   *
   * `suspended` in `runs/checkpoint.ts` already refuses to leave a step
   * `running` for this reason; it can use `pending` because a suspended step
   * really will run again. A stopped step will not, so `pending` would be a
   * different lie.
   */
  | 'stopped';

/**
 * How a step is carried out.
 *
 *   extract   — one structured call against a narrow schema. No tool calling,
 *               so it works on models that cannot do it. Most work is this.
 *   generate  — one text call. Prose out, no schema, for the case where the
 *               answer *is* the text rather than fields carved out of it.
 *   tool_loop — the model drives, calling tools until it stops. For work whose
 *               shape is not known in advance.
 *   transform — plain TypeScript, no model. Fetching, parsing, merging.
 */
export type StepKind = 'extract' | 'generate' | 'tool_loop' | 'transform';

/** Where a step sits in a run, as the orchestrator and the database see it. */
export type StepRef = {
  readonly name: string;
  readonly kind: StepKind;
  readonly ordinal: number;
  readonly critical: boolean;
};

/* ----------------------------------------------------------------- records */

export type RunRecord = {
  readonly offerSnapshotId?: string;
  readonly contextId?: string;
  readonly contextGeneration?: number;
  readonly contextRevision?: number;
  readonly conversationId?: string;
  readonly id: string;
  readonly capability: string;
  readonly status: RunStatus;
  readonly input: Readonly<Record<string, unknown>>;
  readonly result?: Readonly<Record<string, unknown>>;
  /** Names of non-critical steps that failed. Empty on a clean run. */
  readonly degraded: readonly string[];
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly traceId: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly deadlineAt?: number;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly endedAt?: number;
};

export type RunStepRecord = StepRef & {
  readonly runId: string;
  readonly status: StepStatus;
  readonly value?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly startedAt?: number;
  readonly endedAt?: number;
};

/* --------------------------------------------------------------- approvals */

export type ApprovalRequest = {
  /** Stable for a given question within a step, so a resume finds the answer. */
  readonly key: string;
  readonly kind: string;
  readonly question: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly expiresAt?: number;
};

export type ApprovalDecision = {
  readonly status: 'granted' | 'denied';
  readonly decision: Readonly<Record<string, unknown>>;
  readonly decidedAt: number;
};

/**
 * How a step asks a person something.
 *
 * `request` is synchronous and has two outcomes, only one of which is a return.
 * If a decision already exists for this `(step, key)` it comes back immediately.
 * If it does not, the gate records a pending approval and throws
 * `RunSuspension`; the orchestrator catches it, parks the run as `'suspended'`,
 * and the process is free to exit.
 *
 * **The consequence for capability authors is real and worth stating plainly:
 * when the run resumes, the step runs again from the top.** Everything before
 * the `request` call happens twice. That is fine for reading, computing and
 * merging, and it is not fine for anything that changes the outside world —
 * which is exactly why every external call is fronted by a committed attempt
 * record. A step whose effects are keyed by an idempotency key is re-entrant;
 * one that fires and forgets is not.
 *
 * The alternative — a promise that resolves when a human answers — only works
 * while the process lives, which is the case this design exists to survive.
 */
export interface ApprovalGate {
  request(ask: ApprovalRequest): ApprovalDecision;
}

/** Thrown by `ApprovalGate.request`. Not an error; a control-flow signal. */
export class RunSuspension {
  readonly name = 'RunSuspension';
  constructor(
    readonly runId: string,
    readonly step: string,
    readonly approvalId: string
  ) {}
}

export const isRunSuspension = (value: unknown): value is RunSuspension =>
  value instanceof RunSuspension;

/* ------------------------------------------------------------------ context */

/**
 * Everything a run may reach. Nothing in this codebase reads a global.
 *
 * Two shapes rather than one, because a plan is produced before any step exists
 * and a step needs to know which step it is. `RunContext` is what planning sees;
 * `StepContext` adds the step and the frozen snapshot of what finished before
 * it. `context/build.ts` produces the second from the first and freezes it, so a
 * step cannot observe a value changing underneath it mid-execution.
 */
/**
 * A fragment of prose, as it is being written.
 *
 * The reason this is a callback and not an event: an event is written in the
 * same transaction as the state change it announces, and a token announces no
 * state change. Persisting one row per fragment would put thousands of rows in
 * a log whose `seq` exists so a caller can follow what a run *did*, and bury
 * the six rows that say it under the ten thousand that say it is still typing.
 *
 * So a delta is heard or it is missed, and missing one costs nothing: the
 * finished text is canonical, lives in the run's result, and is what a caller
 * that arrived late reads. Streaming is how an answer feels; the result is what
 * an answer is.
 */
export type StepDelta = {
  readonly step: string;
  readonly text: string;
};

/**
 * Where a run's deltas go.
 *
 * Required on the context rather than optional, for the same reason `signal`
 * is: a sink some call sites remember is a sink that works intermittently, and
 * intermittent streaming is harder to diagnose than none. `buildRunContext`
 * supplies a no-op when nobody is listening, so a step never checks.
 *
 * A sink is a notification, so it must not be able to fail the work it is
 * reporting on — see how `effects/ai.ts` calls it.
 */
export type DeltaSink = (delta: StepDelta) => void;

export type RunContext = {
  readonly offerSnapshotId?: string;
  readonly contextId?: string;
  readonly contextGeneration?: number;
  readonly contextRevision?: number;
  readonly conversationId?: string;
  readonly runId: string;
  readonly traceId: string;
  readonly capability: string;

  /**
   * Not optional, anywhere, ever.
   *
   * An `AbortSignal | undefined` is a signal that some call sites honour, and a
   * cancellation that works most of the time is worse than none — it looks like
   * it works. Making it required means a new effect cannot be written without
   * confronting it, because there is no shape of the code where it is absent.
   */
  readonly signal: AbortSignal;

  /** Epoch ms. The wall-clock ceiling for the whole run, not per step. */
  readonly deadlineAt: number;

  readonly input: Readonly<Record<string, unknown>>;

  /**
   * The narrow ports, not a store god-object.
   *
   * A capability gets exactly the handles its steps need and nothing that can
   * open a database. That is what keeps `capabilities/` from ever importing
   * `storage/`, which is a rule the boundary checker enforces but which the
   * shape of this type makes uninteresting to break.
   *
   * Two of them write. `documents` is one and `index` is the other, and the
   * invariant that survives is narrower than "steps cannot write": it is that
   * the *search* path cannot. `retrieval` is a `Retriever` built over a
   * `ChunkReader`, with no cast that recovers `replace` from it, so answering a
   * query can never alter what the next query sees.
   */
  readonly effects: EffectSet;
  readonly tools: ToolRegistry;
  readonly documents: DocumentStore;
  readonly retrieval: Retriever;

  /**
   * The write half of retrieval, held by steps rather than by the runtime.
   *
   * Indexing is an embedding call, and an embedding call made outside a step is
   * outside the run's timing, its failure policy, its events and its elapsed
   * time — the same reason reading the sources is a step rather than something
   * `plan()` does. A post-write hook in `runtime/` would re-index every writer
   * without any of them remembering to, which is the real argument for it, and
   * would pay for that by making a slow or failing embed invisible.
   *
   * So it is a port, and a capability that changes a document's searchable
   * content is responsible for saying so.
   */
  readonly index: ChunkIndex;
  readonly approvals: ApprovalGate;
  readonly logger: AiLogger;

  /**
   * Prose leaving the run as it is produced, for whoever is watching.
   *
   * A no-op when nobody is, which is the common case — a CLI run, a test, a
   * scheduled job. Nothing downstream branches on whether anyone is listening.
   */
  readonly deltas: DeltaSink;
};

export type StepContext = RunContext & {
  readonly step: StepRef;
  /** Results of steps that already finished, keyed by step name. Frozen. */
  readonly completed: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

/* ------------------------------------------------------------------- errors */

export type RuntimeErrorCode =
  | 'unknown_capability'
  | 'invalid_input'
  | 'step_failed'
  /**
   * The source could not be read at all: a board that blocked us, one that
   * renders client-side, one robots.txt forbids.
   *
   * Distinct from `step_failed` because nothing failed — there was simply
   * nothing to analyse, and the only way forward is for a person to supply the
   * text. Collapsing it into a generic failure costs the user the one action
   * that actually works.
   */
  | 'unreadable_source'
  | 'aborted'
  | 'deadline_exceeded'
  /** The process ended while the run was active. Recovery records this and never retries. */
  | 'process_interrupted'
  /** A run was resumed with an attempt still open. Ask a person; never retry. */
  | 'unsettled_attempt'
  | 'invalid_transition'
  /**
   * The runtime is set up wrongly: an unknown provider, a missing credential,
   * a local server URL pointing somewhere that is not loopback.
   *
   * Separate from `step_failed` because no work was attempted and retrying
   * changes nothing — a person has to edit a setting. It is also the reason
   * this is a `RuntimeErrorCode` rather than the dedicated error class the
   * previous runtime had: a configuration problem surfacing as its own type
   * meant every layer that caught runtime errors had to learn about a second
   * one, and one of them didn't.
   */
  | 'misconfigured'
  /**
   * The model server refused, timed out, or answered with something unusable.
   *
   * The message on these is always constructed here, never copied from the
   * provider's error — see the redaction note in `effects/ai.ts`.
   */
  | 'model_call_failed';

export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly code: RuntimeErrorCode,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'RuntimeError';
  }
}
