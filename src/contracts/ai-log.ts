/**
 * The read side of the model-call log.
 *
 * `AiLogger` in `effects.ts` is the write side, and it is deliberately the
 * narrower thing: it is handed to the gateway, which should be able to append a
 * line and nothing else. This is what a host reads back — an accounting record,
 * not a debugging channel — and it is the reason the log has to land somewhere
 * durable rather than on a stream.
 *
 * The two questions it answers are the two that get asked about a local model:
 * what did this run spend, and why was it slow. Both are per-run, which is why
 * `forRun` exists at all when `since` could express it — a caller with a run in
 * hand should not have to know when it started.
 */

import type { AiLogEntry, AiLogger } from './effects.js';

/** A logged call as it comes back: the entry, plus the order it was written in. */
export type AiCall = AiLogEntry & { readonly id: number };

export interface AiLog extends AiLogger {
  /** Every call made under a run, oldest first. */
  forRun(runId: string): AiCall[];

  /** The most recent calls across every run, newest first. */
  recent(limit?: number): AiCall[];

  /**
   * Drops calls logged before `at`, and returns how many went.
   *
   * A metadata log is small — a few hundred bytes a call — but it is append
   * only and nothing else in this runtime ever deletes from it, so without this
   * the table is unbounded. Retention is the host's policy to set, not this
   * layer's to assume.
   */
  prune(at: number): number;
}
