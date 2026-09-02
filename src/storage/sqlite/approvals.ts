/**
 * The approvals table, seen from both sides.
 *
 * `ApprovalStore` is what an adapter holds: it can list what is waiting and
 * record an answer. `createApprovalGate` builds what a *step* holds: it can ask,
 * and asking may suspend the run. Neither can do the other's job, which is what
 * stops a step from approving itself.
 *
 * The gate is bound to one run and one step because that is the scope in which
 * an answer means anything — the unique index on `(run_id, step, ask_key)` is
 * what lets a resumed step find its own answer rather than asking again.
 */

import { randomUUID } from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalRequest,
  ApprovalStore
} from '../../contracts/index.js';
import { RunSuspension } from '../../contracts/index.js';
import type { Db } from './open.js';

type ApprovalRow = {
  id: string;
  run_id: string;
  step: string;
  ask_key: string;
  kind: string;
  question: string;
  payload: string;
  status: string;
  decision: string | null;
  requested_at: number;
  decided_at: number | null;
  expires_at: number | null;
};

export const createApprovalStore = (
  db: Db,
  now: () => number = Date.now
): ApprovalStore => {
  const insert = db.prepare<[
    string, string, string, string, string, string, string, number, number | null
  ]>(
    `INSERT INTO approvals
       (id, run_id, step, ask_key, kind, question, payload, status, requested_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT (run_id, step, ask_key) DO NOTHING`
  );

  const find = db.prepare<[string, string, string]>(
    'SELECT * FROM approvals WHERE run_id = ? AND step = ? AND ask_key = ?'
  );

  const pending = db.prepare<[string]>(
    `SELECT * FROM approvals WHERE run_id = ? AND status = 'pending' ORDER BY requested_at`
  );

  const decide = db.prepare<[string, string, number, string]>(
    `UPDATE approvals SET status = ?, decision = ?, decided_at = ?
      WHERE id = ? AND status = 'pending'`
  );

  return {
    open(runId, step, ask) {
      const id = randomUUID();
      insert.run(
        id,
        runId,
        step,
        ask.key,
        ask.kind,
        ask.question,
        JSON.stringify(ask.payload),
        now(),
        ask.expiresAt ?? null
      );

      // DO NOTHING on conflict, so an existing row wins and keeps its id. A
      // step asking the same question twice is asking one question.
      const row = find.get(runId, step, ask.key) as ApprovalRow | undefined;
      return row?.id ?? id;
    },

    find(runId, step, key) {
      const row = find.get(runId, step, key) as ApprovalRow | undefined;
      if (!row || row.decision === null) return undefined;
      if (row.status !== 'granted' && row.status !== 'denied') return undefined;

      return {
        status: row.status,
        decision: JSON.parse(row.decision) as Record<string, unknown>,
        decidedAt: row.decided_at ?? 0
      };
    },

    pending(runId) {
      return (pending.all(runId) as ApprovalRow[]).map((row) => ({
        id: row.id,
        key: row.ask_key,
        kind: row.kind,
        question: row.question,
        payload: JSON.parse(row.payload) as Record<string, unknown>,
        expiresAt: row.expires_at ?? undefined
      }));
    },

    decide(id, decision) {
      decide.run(
        decision.status,
        JSON.stringify(decision.decision),
        decision.decidedAt,
        id
      );
    }
  };
};

/**
 * The step-facing gate, bound to one run and one step.
 *
 * Two exits and only one of them is a return. See the note on `ApprovalGate` in
 * `contracts/run.ts` for what that costs a capability author: on resume the step
 * runs again from the top, so everything before the ask has to be safe to do
 * twice.
 */
export const createApprovalGate = (
  store: ApprovalStore,
  runId: string,
  step: string
): ApprovalGate => ({
  request(ask: ApprovalRequest): ApprovalDecision {
    const existing = store.find(runId, step, ask.key);
    if (existing) return existing;

    const id = store.open(runId, step, ask);
    throw new RunSuspension(runId, step, id);
  }
});
