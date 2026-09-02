/**
 * Events: the derived, append-only account of what a run did.
 *
 * The relationship between this file and `run-store.ts` is the whole
 * persistence story in one sentence — **run state is canonical and events are
 * derived, and both are written in the same transaction.** Neither is a queue
 * feeding the other.
 *
 * That is why there is no `write` method here. `EventLog` reads. The only way
 * an event reaches the database is as the second argument to
 * `RunStore.checkpoint`, alongside the state change it announces. An event log
 * that could be appended to on its own would eventually claim a step whose
 * state was never saved, and a caller tailing it would see work that did not
 * happen.
 */

export type RunEventType =
  | 'run.queued'
  | 'run.started'
  | 'run.planned'
  | 'run.suspended'
  | 'run.resumed'
  | 'run.succeeded'
  | 'run.failed'
  | 'run.cancelled'
  | 'step.started'
  | 'step.succeeded'
  | 'step.degraded'
  | 'step.failed'
  /** Started, then stopped with no outcome. See `StepStatus`. */
  | 'step.stopped'
  /** Declared but never started before its owning process ended. */
  | 'step.skipped'
  | 'effect.attempted'
  | 'effect.settled'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied';

/**
 * An event that has been written, and therefore has a sequence number.
 *
 * `seq` is per run, starts at 1, and is gapless. It is assigned inside the
 * write transaction from `max(seq) + 1` for that run, never by the caller and
 * never from a global counter.
 *
 * Per-run rather than global because of what a caller actually does with it:
 * follow one run's progress and reconnect without missing anything. `since(runId,
 * seq)` answers that exactly. A global sequence would make the same query a scan
 * with a filter, and would leak how busy the process is into every run's numbers.
 *
 * Gapless rather than a timestamp because two events written in the same
 * millisecond are common — a step succeeding and the run succeeding after it —
 * and a caller that resumes from a timestamp either replays them or drops one.
 */
export type RunEvent = {
  readonly runId: string;
  readonly seq: number;
  readonly at: number;
  readonly type: RunEventType;
  readonly step?: string;
  readonly data: Readonly<Record<string, unknown>>;
};

/**
 * An event on its way to being written. It has no `seq` yet, because assigning
 * one outside the transaction is how duplicates happen.
 */
export type NewEvent = {
  readonly at: number;
  readonly type: RunEventType;
  readonly step?: string;
  readonly data?: Readonly<Record<string, unknown>>;
};
