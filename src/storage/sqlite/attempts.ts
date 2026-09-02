/**
 * `AttemptLog` over SQLite.
 *
 * The mechanism is the commit boundary, not the table. `begin` writes the row
 * and returns only once it is durable, and the caller makes its external call
 * afterwards. So a process that dies mid-call leaves a row with no `settled_at`,
 * and that row means precisely one thing: **the call may have happened and we
 * cannot tell.**
 *
 * That is not a retry signal. It is the exact case where retrying might send a
 * second email or create a second record, and the difference between "it failed"
 * and "we do not know" is the difference between an automatic recovery and a
 * question for a person. `unsettled` exists so the question can be asked.
 *
 * Each attempt is written on its own connection-level transaction rather than
 * being folded into a run checkpoint, deliberately: it has to be durable
 * *before* the call, and a checkpoint that also carried it would not commit
 * until the step finished — which is after the call it was supposed to precede.
 */

import type { Attempt, AttemptLog, AttemptOutcome } from '../../contracts/index.js';
import type { Db } from './open.js';
import { packJson, unpackJson } from './rows.js';

type AttemptRow = {
  id: string;
  run_id: string | null;
  step: string | null;
  effect: string;
  idempotency_key: string;
  request: string;
  outcome: string | null;
  response: string | null;
  started_at: number;
  settled_at: number | null;
};

const toAttempt = (row: AttemptRow): Attempt => ({
  id: row.id,
  runId: row.run_id ?? undefined,
  step: row.step ?? undefined,
  effect: row.effect,
  idempotencyKey: row.idempotency_key,
  request: JSON.parse(row.request) as Record<string, unknown>,
  outcome: (row.outcome ?? undefined) as AttemptOutcome | undefined,
  response: unpackJson(row.response),
  startedAt: row.started_at,
  settledAt: row.settled_at ?? undefined
});

export const createAttemptLog = (db: Db): AttemptLog => {
  const insert = db.prepare<[
    string, string | null, string | null, string, string, string, number
  ]>(
    `INSERT INTO effect_attempts
       (id, run_id, step, effect, idempotency_key, request, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const byKey = db.prepare<[string]>(
    'SELECT * FROM effect_attempts WHERE idempotency_key = ?'
  );

  const settle = db.prepare<[string, string | null, number, string]>(
    `UPDATE effect_attempts SET outcome = ?, response = ?, settled_at = ?
      WHERE id = ? AND settled_at IS NULL`
  );

  const unsettled = db.prepare<[string]>(
    `SELECT * FROM effect_attempts
      WHERE run_id = ? AND settled_at IS NULL
      ORDER BY started_at`
  );

  return {
    begin(attempt) {
      try {
        insert.run(
          attempt.id,
          attempt.runId ?? null,
          attempt.step ?? null,
          attempt.effect,
          attempt.idempotencyKey,
          JSON.stringify(attempt.request),
          attempt.startedAt
        );
      } catch (error) {
        // The unique index on idempotency_key is the second half of the
        // guarantee. A key that already exists means this exact call was
        // already begun — hand back what is on record instead of starting a
        // parallel one, which is what makes a re-entrant step safe to re-run.
        const existing = byKey.get(attempt.idempotencyKey) as AttemptRow | undefined;
        if (existing) return { ...toAttempt(existing), existing: true };
        throw error;
      }

      return { ...attempt, existing: false };
    },

    settle(id, outcome, response) {
      settle.run(outcome, packJson(response), Date.now(), id);
    },

    unsettled(runId) {
      return (unsettled.all(runId) as AttemptRow[]).map(toAttempt);
    }
  };
};
