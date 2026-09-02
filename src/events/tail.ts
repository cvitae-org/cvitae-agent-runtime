/**
 * Following a run's progress.
 *
 * The read side, and the reason `seq` is per run and gapless: a caller holds
 * the last number it saw and asks for what came after. Reconnecting is the same
 * call with the same number, so a dropped websocket or a closed window costs
 * nothing — no replay, no gap.
 *
 * There is no subscribe here and no polling loop either. This process is not
 * the only writer of the database and a poll interval is a policy belonging to
 * whoever is displaying the run; an adapter that wants a stream builds one on
 * `page`, and one that wants a single answer calls it once.
 */

import type { EventLog, RunEvent } from '../contracts/index.js';

export type Page = {
  readonly events: readonly RunEvent[];
  /** Pass back as `after` to continue. Unchanged when nothing new arrived. */
  readonly cursor: number;
  /** False when the page filled, meaning there is more without waiting. */
  readonly caughtUp: boolean;
};

export const page = (
  log: EventLog,
  runId: string,
  after = 0,
  limit = 200
): Page => {
  const events = log.since(runId, after, limit);
  const last = events[events.length - 1];

  return {
    events,
    cursor: last ? last.seq : after,
    caughtUp: events.length < limit
  };
};

/** The whole log for a run, in order. For a CLI or a bug report, not a UI. */
export const all = (log: EventLog, runId: string): RunEvent[] => {
  const collected: RunEvent[] = [];
  let cursor = 0;

  for (;;) {
    const next = page(log, runId, cursor, 500);
    collected.push(...next.events);
    if (next.caughtUp) return collected;
    cursor = next.cursor;
  }
};
