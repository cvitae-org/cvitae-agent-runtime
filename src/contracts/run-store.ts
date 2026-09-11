/**
 * Run state: canonical, and the only place a write to the event log can
 * originate.
 *
 * `checkpoint` is a single method rather than a pair of them, and that is the
 * design. The guarantee this system rests on — that a state change and the
 * events announcing it either both land or neither does — is either a signature
 * or it is a convention two modules are asked to honour. As a convention it
 * survives until the first person who writes the state, returns early on an
 * error, and never reaches the append. As a signature there is no such shape:
 * you cannot express the state change without also handing over its events.
 *
 * There is no outbox and no event sourcing here, and the reason is worth stating
 * so it is not added later out of habit. An outbox exists to bridge two systems
 * that cannot share a transaction. These are two tables in one file. The problem
 * an outbox solves does not exist, and the machinery it costs is real.
 */

import type { NewEvent } from './event.js';
import type {
  ApprovalDecision,
  ApprovalRequest,
  RunRecord,
  RunStatus,
  RunStepRecord,
  StepRef,
  StepStatus
} from './run.js';

export type NewRun = {
  readonly offerSnapshotId?: string;
  readonly contextId?: string;
  readonly contextGeneration?: number;
  readonly contextRevision?: number;
  readonly conversationId?: string;
  readonly id: string;
  readonly capability: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly traceId: string;
  readonly deadlineAt?: number;
  readonly createdAt: number;
};

export type StepPatch = {
  readonly name: string;
  readonly status: StepStatus;
  readonly value?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly startedAt?: number;
  readonly endedAt?: number;
};

export type RunFields = {
  readonly status?: RunStatus;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly degraded?: readonly string[];
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly startedAt?: number;
  readonly endedAt?: number;
};

export type RunPatch = {
  readonly runId: string;
  readonly run?: RunFields;
  /**
   * Written when the plan is known. Separate from `steps` because these are
   * inserts and those are updates, and folding both into one shape would hide
   * which is which at the call site.
   */
  readonly declare?: readonly StepRef[];
  readonly steps?: readonly StepPatch[];
};

export type RunFilter = {
  readonly status?: RunStatus;
  readonly capability?: string;
  readonly limit?: number;
  /** Epoch ms; returns runs created strictly before this. For paging. */
  readonly before?: number;
};

export interface RunStore {
  /** Inserts the run and its opening events in one transaction. */
  create(run: NewRun, events: readonly NewEvent[]): RunRecord;

  get(id: string): RunRecord | undefined;
  list(filter: RunFilter): RunRecord[];
  steps(runId: string): RunStepRecord[];

  /**
   * Writes the state change and the events announcing it in ONE transaction,
   * assigning each event the next `seq` for the run inside that transaction.
   *
   * Nothing else in the codebase may write to `events`.
   */
  checkpoint(patch: RunPatch, events: readonly NewEvent[]): void;

  /**
   * Runs left mid-flight by a process that died: `'queued'` or `'running'` rows with nothing
   * newer than their last checkpoint. Read at startup so a caller can be shown
   * what is stale rather than discovering it later.
   */
  interrupted(): RunRecord[];
}

/**
 * The other side of `ApprovalGate`.
 *
 * The gate is what a *step* holds — it can ask, and asking may suspend the run.
 * This is what an *adapter* holds: it can see what is waiting and record an
 * answer. Neither can do the other's job, which is what stops a step from
 * approving itself.
 */
export interface ApprovalStore {
  pending(runId: string): (ApprovalRequest & { readonly id: string })[];
  find(runId: string, step: string, key: string): ApprovalDecision | undefined;
  /** Records the request. Called by the gate immediately before it suspends. */
  open(runId: string, step: string, ask: ApprovalRequest): string;
  /** Records a person's answer. Does not resume the run; a caller does that. */
  decide(id: string, decision: ApprovalDecision): void;
}
