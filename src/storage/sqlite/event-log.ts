/**
 * `EventLog` over SQLite. Reads only.
 *
 * There is no append method here and there is no private one either. Events
 * reach the table through `RunStore.checkpoint` and by no other route, which is
 * what stops the log from ever describing a step whose state was not saved.
 */

import type { EventLog, RunEvent, RunEventType } from '../../contracts/index.js';
import type { Db } from './open.js';

type EventRow = {
  run_id: string;
  seq: number;
  at: number;
  type: string;
  step: string | null;
  data: string;
};

const toEvent = (row: EventRow): RunEvent => ({
  runId: row.run_id,
  seq: row.seq,
  at: row.at,
  type: row.type as RunEventType,
  step: row.step ?? undefined,
  data: JSON.parse(row.data) as Record<string, unknown>
});

export const createEventLog = (db: Db): EventLog => {
  // One B-tree walk: the table is WITHOUT ROWID on exactly this key, so the
  // rows for a run sit together in sequence order and the range is a seek.
  const since = db.prepare<[string, number, number]>(
    `SELECT * FROM events
      WHERE run_id = ? AND seq > ?
      ORDER BY seq
      LIMIT ?`
  );

  const latest = db.prepare<[string]>(
    'SELECT coalesce(max(seq), 0) AS seq FROM events WHERE run_id = ?'
  );

  return {
    since(runId, afterSeq, limit = 500) {
      return (since.all(runId, afterSeq, limit) as EventRow[]).map(toEvent);
    },

    latest(runId) {
      return (latest.get(runId) as { seq: number }).seq;
    }
  };
};
