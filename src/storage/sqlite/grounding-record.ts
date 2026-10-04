/**
 * `RecordStore` over SQLite, and the two writes the run store makes inside its
 * own transactions.
 *
 * A record is opened and settled by the run store and by nothing that calls it,
 * because the run store is where every ending of a run is written: success,
 * failure, cancellation, the parking for an approval, and the recovery of a run
 * whose process died. A hook anywhere above it has to be remembered by each of
 * those paths. A hook in the transaction that writes the status cannot be
 * skipped by any of them, and it lands or fails together with the status it
 * follows, so a run never reads "succeeded" next to a record that says "open".
 */

import { PROCESS_INTERRUPTED, RECORD_VERSION } from '../../contracts/index.js';
import type {
  EntryOrigin,
  EntryStatus,
  GroundingRecord,
  RecordEntry,
  RecordOutcome,
  RecordState,
  RecordStore,
  RunFields,
  RunStatus
} from '../../contracts/index.js';
import type { Db } from './open.js';

type Settlement = {
  readonly state: RecordState;
  readonly outcome: RecordOutcome | null;
  /** Whether the run has ended, which is when the record gets a closing time. */
  readonly ended: boolean;
};

/**
 * What a run's new status says about its record.
 *
 * `interrupted` is its own state and not a flavour of failure: a run that
 * failed knows what it was given, and a run whose process died knows only what
 * was written before it did. The record has to say which of the two it is.
 */
export const settlementOf = (status: RunStatus, errorCode: string | undefined): Settlement => {
  switch (status) {
    case 'queued':
    case 'running':
      return { state: 'open', outcome: null, ended: false };
    case 'suspended':
      return { state: 'suspended', outcome: null, ended: false };
    case 'succeeded':
      return { state: 'closed', outcome: 'succeeded', ended: true };
    case 'cancelled':
      return { state: 'closed', outcome: 'cancelled', ended: true };
    case 'failed':
      return errorCode === PROCESS_INTERRUPTED
        ? { state: 'interrupted', outcome: null, ended: true }
        : { state: 'closed', outcome: 'failed', ended: true };
  }
};

export type RecordWrites = {
  /** Opens the record of a run that belongs to a conversation. */
  open(runId: string, conversationId: string, openedAt: number): void;
  /** Follows a status change. Does nothing for a run with no record. */
  settle(runId: string, fields: RunFields): void;
};

/**
 * Statements for the run store to call from inside its transactions.
 *
 * `settle` leaves a record alone once it is closed or interrupted. The run state
 * table already gives a terminal run no way out; this is the same rule in the
 * place the record lives, so a record that says a run ended stays that way even
 * if a caller confusedly writes a second status.
 */
export const recordWrites = (db: Db): RecordWrites => {
  const insert = db.prepare<[string, string, number, number]>(
    `INSERT INTO grounding_record (run_id, conversation_id, v, state, opened_at)
     VALUES (?, ?, ?, 'open', ?)`
  );

  const settle = db.prepare<[string, string | null, number | null, string]>(
    `UPDATE grounding_record
        SET state = ?, outcome = ?, closed_at = ?
      WHERE run_id = ? AND state IN ('open', 'suspended')`
  );

  return {
    open(runId, conversationId, openedAt) {
      insert.run(runId, conversationId, RECORD_VERSION, openedAt);
    },

    settle(runId, fields) {
      if (fields.status === undefined) return;
      const next = settlementOf(fields.status, fields.errorCode);
      const closedAt = next.ended ? (fields.endedAt ?? null) : null;
      settle.run(next.state, next.outcome, closedAt, runId);
    }
  };
};

type RecordRow = {
  run_id: string;
  conversation_id: string;
  v: number;
  state: string;
  outcome: string | null;
  opened_at: number;
  closed_at: number | null;
};

type EntryRow = {
  ref: string;
  version: string | null;
  digest: string;
  shown: string | null;
  status: string;
  origin: string;
  via: string;
};

const toEntry = (row: EntryRow): RecordEntry => ({
  ref: row.ref,
  ...(row.version === null ? {} : { version: row.version }),
  digest: row.digest,
  ...(row.shown === null ? {} : { shown: row.shown }),
  status: row.status as EntryStatus,
  origin: row.origin as EntryOrigin,
  via: row.via
});

export const createRecordStore = (db: Db): RecordStore => {
  /**
   * The state check is part of the insert, not a read before it. A statement
   * that tests "is the record open" and writes in one step cannot be overtaken
   * by the status change that closes the record between the two.
   *
   * `ON CONFLICT DO NOTHING` without a target applies to the unique index on the
   * entry's whole identity, which is what makes an equal entry one entry.
   */
  const insert = db.prepare<[string, string, string | null, string, string | null, string, string, string, string]>(
    `INSERT INTO grounding_entry (run_id, ref, version, digest, shown, status, origin, via)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM grounding_record WHERE run_id = ? AND state = 'open')
     ON CONFLICT DO NOTHING`
  );

  const selectRecord = db.prepare<[string]>('SELECT * FROM grounding_record WHERE run_id = ?');
  const selectEntries = db.prepare<[string]>(
    `SELECT ref, version, digest, shown, status, origin, via
       FROM grounding_entry WHERE run_id = ? ORDER BY id`
  );

  const appendAll = db.transaction((runId: string, entries: readonly RecordEntry[]): number => {
    let added = 0;
    for (const entry of entries) {
      added += insert.run(
        runId,
        entry.ref,
        entry.version ?? null,
        entry.digest,
        entry.shown ?? null,
        entry.status,
        entry.origin,
        entry.via,
        runId
      ).changes;
    }
    return added;
  }).immediate;

  // One transaction so the record and its entries come from one moment, even
  // when another connection is writing to the file.
  const readAll = db.transaction((runId: string): GroundingRecord | undefined => {
    const row = selectRecord.get(runId) as RecordRow | undefined;
    if (!row) return undefined;

    return {
      v: row.v as typeof RECORD_VERSION,
      runId: row.run_id,
      conversationId: row.conversation_id,
      state: row.state as RecordState,
      ...(row.outcome === null ? {} : { outcome: row.outcome as RecordOutcome }),
      openedAt: row.opened_at,
      ...(row.closed_at === null ? {} : { closedAt: row.closed_at }),
      entries: (selectEntries.all(runId) as EntryRow[]).map(toEntry)
    };
  });

  return {
    append: (runId, entries) => (entries.length === 0 ? 0 : appendAll(runId, entries)),
    read: (runId) => readAll(runId)
  };
};
