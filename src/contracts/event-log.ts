/**
 * The read side of the event log.
 *
 * There is no write side. See the note in `event.ts`: events are written only
 * by `RunStore.checkpoint`, in the same transaction as the state they describe.
 */

import type { RunEvent } from './event.js';

export interface EventLog {
  /**
   * Events for a run after `afterSeq`, in order. `afterSeq` of 0 returns all of
   * them, which is what a caller attaching to a finished run wants.
   */
  since(runId: string, afterSeq: number, limit?: number): RunEvent[];

  /** The highest `seq` written for a run, or 0 if it has none yet. */
  latest(runId: string): number;
}
