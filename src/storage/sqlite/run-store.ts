/**
 * `RunStore` over SQLite, and the transaction the whole design rests on.
 *
 * Everything else in this file is bookkeeping around `checkpoint`. What that
 * method guarantees is that a state change and the events announcing it either
 * both land or neither does — and it guarantees it by being the only way to do
 * either, rather than by asking callers to remember.
 */

import { randomUUID } from 'node:crypto';
import type {
  NewEvent,
  NewRun,
  RunFilter,
  RunPatch,
  RunRecord,
  RunStatus,
  RunStepRecord,
  RunStore,
  StepKind,
  StepStatus
} from '../../contracts/index.js';
import { CvContextError } from '../../contracts/index.js';
import { requireConversationContext } from './context-ownership.js';
import { recordWrites } from './grounding-record.js';
import type { Db } from './open.js';
import { packBool, packJson, unpackBool, unpackJson, unpackStrings } from './rows.js';

type RunRow = {
  offer_snapshot_id: string | null;
  context_id: string | null;
  context_generation: number | null;
  context_revision: number | null;
  conversation_id: string | null;
  id: string;
  capability: string;
  status: string;
  input: string;
  result: string | null;
  degraded: string;
  error_code: string | null;
  error_message: string | null;
  trace_id: string;
  provider_id: string | null;
  model_id: string | null;
  deadline_at: number | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
};

type StepRow = {
  run_id: string;
  name: string;
  kind: string;
  critical: number;
  status: string;
  ordinal: number;
  value: string | null;
  reason: string | null;
  started_at: number | null;
  ended_at: number | null;
};

const toRun = (row: RunRow): RunRecord => ({
  ...(row.offer_snapshot_id == null ? {} : { offerSnapshotId: row.offer_snapshot_id }),
  ...(row.context_revision == null ? {} : { contextRevision: row.context_revision }),
  ...(row.context_generation == null ? {} : { contextGeneration: row.context_generation }),
  ...(row.context_id === null ? {} : { contextId: row.context_id }),
  ...(row.conversation_id === null ? {} : { conversationId: row.conversation_id }),
  id: row.id,
  capability: row.capability,
  status: row.status as RunStatus,
  input: JSON.parse(row.input) as Record<string, unknown>,
  result: unpackJson(row.result),
  degraded: unpackStrings(row.degraded),
  errorCode: row.error_code ?? undefined,
  errorMessage: row.error_message ?? undefined,
  traceId: row.trace_id,
  providerId: row.provider_id ?? undefined,
  modelId: row.model_id ?? undefined,
  deadlineAt: row.deadline_at ?? undefined,
  createdAt: row.created_at,
  startedAt: row.started_at ?? undefined,
  endedAt: row.ended_at ?? undefined
});

const toStep = (row: StepRow): RunStepRecord => ({
  runId: row.run_id,
  name: row.name,
  kind: row.kind as StepKind,
  critical: unpackBool(row.critical),
  status: row.status as StepStatus,
  ordinal: row.ordinal,
  value: unpackJson(row.value),
  reason: row.reason ?? undefined,
  startedAt: row.started_at ?? undefined,
  endedAt: row.ended_at ?? undefined
});

export const createRunStore = (db: Db): RunStore => {
  const records = recordWrites(db);

  const insertRun = db.prepare<[
    string, string, string, string, number | null, number, string | null, string | null, number | null, number | null, string | null
  ]>(
    `INSERT INTO runs (id, capability, status, input, trace_id, deadline_at, created_at, context_id, conversation_id, context_generation, context_revision, offer_snapshot_id)
     VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const selectRun = db.prepare<[string]>('SELECT * FROM runs WHERE id = ?');

  const selectSteps = db.prepare<[string]>(
    'SELECT * FROM run_steps WHERE run_id = ? ORDER BY ordinal'
  );

  const selectRunning = db.prepare(
    `SELECT * FROM runs WHERE status IN ('queued', 'running') ORDER BY created_at DESC`
  );

  const insertStep = db.prepare<[string, string, string, number, number]>(
    `INSERT INTO run_steps (run_id, name, kind, critical, ordinal, status)
     VALUES (?, ?, ?, ?, ?, 'pending')
     ON CONFLICT (run_id, name) DO NOTHING`
  );

  /**
   * `coalesce(?, column)` rather than assembling SQL per patch.
   *
   * One prepared statement covers every shape of update, and no code path
   * builds a query string from a caller's keys. The cost is that a field can be
   * set but never cleared — which is exactly right for these columns: a run
   * that has recorded an error keeps it, and a step does not un-degrade.
   */
  const updateRun = db.prepare<[
    string | null, string | null, string | null, string | null, string | null,
    string | null, string | null, number | null, number | null, string
  ]>(
    `UPDATE runs SET
       status        = coalesce(?, status),
       result        = coalesce(?, result),
       degraded      = coalesce(?, degraded),
       error_code    = coalesce(?, error_code),
       error_message = coalesce(?, error_message),
       provider_id   = coalesce(?, provider_id),
       model_id      = coalesce(?, model_id),
       started_at    = coalesce(?, started_at),
       ended_at      = coalesce(?, ended_at)
     WHERE id = ?`
  );

  const updateStep = db.prepare<[
    string, string | null, string | null, number | null, number | null, string, string
  ]>(
    `UPDATE run_steps SET
       status     = ?,
       value      = coalesce(?, value),
       reason     = coalesce(?, reason),
       started_at = coalesce(?, started_at),
       ended_at   = coalesce(?, ended_at)
     WHERE run_id = ? AND name = ?`
  );

  const nextSeq = db.prepare<[string]>(
    'SELECT coalesce(max(seq), 0) + 1 AS seq FROM events WHERE run_id = ?'
  );

  const insertEvent = db.prepare<[
    string, number, number, string, string | null, string
  ]>(
    `INSERT INTO events (run_id, seq, at, type, step, data)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  /**
   * Assigns sequence numbers and writes.
   *
   * Only ever called from inside a transaction, which is what makes the
   * read-then-increment safe: the write lock is already held, so no second
   * connection can slip a row in between reading `max(seq)` and inserting.
   */
  const appendEvents = (runId: string, events: readonly NewEvent[]): void => {
    if (events.length === 0) return;

    let seq = (nextSeq.get(runId) as { seq: number }).seq;

    for (const event of events) {
      insertEvent.run(
        runId,
        seq,
        event.at,
        event.type,
        event.step ?? null,
        JSON.stringify(event.data ?? {})
      );
      seq += 1;
    }
  };

  /**
   * `.immediate` emits `BEGIN IMMEDIATE`, taking the write lock up front rather
   * than starting as a reader and upgrading on the first write. The upgrade is
   * what produces SQLITE_BUSY under WAL when another connection is reading, and
   * it cannot be waited out — `busy_timeout` does not apply to a deadlock the
   * upgrade creates.
   */
  const runCreate = db.transaction((run: NewRun, events: readonly NewEvent[]) => {
    // Discover has its own durable owner, created in the same transaction by
    // discovery-chat.start. A capability name alone must not bypass CV checks.
    const discovery = run.capability === 'ask_discovery';
    const boardOwner = db.prepare('SELECT i.body,a.input FROM board_run_inputs i JOIN board_run_authorizations a ON a.run_id=i.run_id JOIN board_entries e ON e.id=i.entry_id WHERE i.run_id=?').get(run.id) as {body:string;input:string}|undefined;
    const board = boardOwner !== undefined;
    if (boardOwner && (JSON.parse(boardOwner.body).capability !== run.capability || boardOwner.input !== JSON.stringify(run.input) || run.contextId !== undefined || run.conversationId !== undefined || run.offerSnapshotId !== undefined)) {
      throw new CvContextError('context_conflict','Board run inputs do not match their captured owner.');
    }
    if (discovery) {
      const owner = db.prepare(`SELECT json_extract(t.request,'$.question') AS question
        FROM discovery_chat_turns t
        JOIN discovery_searches s ON s.id=t.search_id AND s.status='ready'
        JOIN conversations c ON c.id=t.conversation_id
          AND c.subject_kind='discovery' AND c.subject_id=t.search_id
        WHERE t.run_id=?`).get(run.id) as { question: string } | undefined;
      if (!owner || owner.question !== run.input.question ||
          run.contextId !== undefined || run.contextGeneration !== undefined ||
          run.contextRevision !== undefined || run.conversationId !== undefined ||
          run.offerSnapshotId !== undefined) {
        throw new CvContextError('invalid_input', 'A Discover run requires its own saved-search turn and cannot bind a CV.');
      }
    }
    if (run.offerSnapshotId !== undefined) {
      const snapshot = db.prepare('SELECT context_id, conversation_id, snapshot FROM offer_snapshots WHERE id = ?').get(run.offerSnapshotId) as
        { context_id: string; conversation_id: string; snapshot: string } | undefined;
      if (!snapshot || snapshot.context_id !== run.contextId || snapshot.conversation_id !== run.conversationId ||
          !db.prepare('SELECT id FROM conversations WHERE id = ?').get(snapshot.conversation_id)) {
        throw new CvContextError('context_conflict', 'Snapshot, context and conversation do not match.');
      }
      const saved = JSON.parse(snapshot.snapshot) as { context: { generation: number }; document: { revision: number } };
      if (run.contextGeneration !== saved.context.generation || run.contextRevision !== saved.document.revision) {
        throw new CvContextError('context_conflict', 'Run does not match captured inputs.');
      }
    } else if (run.contextId !== undefined) {
      const context = db.prepare('SELECT generation FROM cv_contexts WHERE id = ?').get(run.contextId) as { generation: number } | undefined;
      const document = db.prepare('SELECT revision FROM documents WHERE id = ?').get(run.contextId) as { revision: number } | undefined;
      if (!context || context.generation !== run.contextGeneration || (document?.revision ?? 0) !== run.contextRevision) {
        throw new CvContextError('context_conflict', 'CV changed before the run could start.');
      }
    }
    if (!discovery && !board && run.contextId === undefined && db.prepare("SELECT id FROM cv_contexts WHERE id != 'cv' OR language IS NOT NULL LIMIT 1").get()) {
      throw new CvContextError('invalid_input', 'An explicit CV context is required.');
    }
    if (run.conversationId !== undefined && run.offerSnapshotId === undefined) {
      if (run.contextId === undefined) throw new CvContextError('invalid_input', 'A conversation-bound run requires a context ID.');
      requireConversationContext(db, run.conversationId, run.contextId);
    }
    insertRun.run(
      run.id,
      run.capability,
      JSON.stringify(run.input),
      run.traceId,
      run.deadlineAt ?? null,
      run.createdAt,
      run.contextId ?? null,
      run.conversationId ?? null,
      run.contextGeneration ?? null,
      run.contextRevision ?? null,
      run.offerSnapshotId ?? null
    );
    // A run in a conversation gets a record in the same transaction that makes
    // the run, so there is never a moment a conversation run has none.
    if (run.conversationId !== undefined) records.open(run.id, run.conversationId, run.createdAt);
    appendEvents(run.id, events);
  }).immediate;

  const runCheckpoint = db.transaction((patch: RunPatch, events: readonly NewEvent[]) => {
    for (const step of patch.declare ?? []) {
      insertStep.run(patch.runId, step.name, step.kind, packBool(step.critical), step.ordinal);
    }

    for (const step of patch.steps ?? []) {
      updateStep.run(
        step.status,
        packJson(step.value),
        step.reason ?? null,
        step.startedAt ?? null,
        step.endedAt ?? null,
        patch.runId,
        step.name
      );
    }

    if (patch.run) {
      const fields = patch.run;
      updateRun.run(
        fields.status ?? null,
        packJson(fields.result),
        fields.degraded ? JSON.stringify(fields.degraded) : null,
        fields.errorCode ?? null,
        fields.errorMessage ?? null,
        fields.providerId ?? null,
        fields.modelId ?? null,
        fields.startedAt ?? null,
        fields.endedAt ?? null,
        patch.runId
      );
      // Every ending of a run, and every pause, is a status written here. The
      // record follows in the same transaction, so no path that ends a run can
      // forget to settle it.
      records.settle(patch.runId, fields);
    }

    appendEvents(patch.runId, events);
  }).immediate;

  return {
    create(run, events) {
      runCreate(run, events);
      const created = selectRun.get(run.id) as RunRow | undefined;
      if (!created) throw new Error(`run ${run.id} vanished immediately after insert`);
      return toRun(created);
    },

    get(id) {
      const row = selectRun.get(id) as RunRow | undefined;
      return row ? toRun(row) : undefined;
    },

    list(filter: RunFilter) {
      // Two optional equality filters and one cursor. Written as a fixed
      // statement with `(? IS NULL OR column = ?)` so nothing assembles SQL.
      const rows = db
        .prepare(
          `SELECT * FROM runs
            WHERE (:status IS NULL OR status = :status)
              AND (:capability IS NULL OR capability = :capability)
              AND (:before IS NULL OR created_at < :before)
            ORDER BY created_at DESC
            LIMIT :limit`
        )
        .all({
          status: filter.status ?? null,
          capability: filter.capability ?? null,
          before: filter.before ?? null,
          limit: filter.limit ?? 50
        }) as RunRow[];

      return rows.map(toRun);
    },

    steps(runId) {
      return (selectSteps.all(runId) as StepRow[]).map(toStep);
    },

    checkpoint(patch, events) {
      runCheckpoint(patch, events);
    },

    interrupted() {
      return (selectRunning.all() as RunRow[]).map(toRun);
    }
  };
};

/** Ids are made here so a caller never has to invent one that collides. */
export const newRunId = (): string => randomUUID();
