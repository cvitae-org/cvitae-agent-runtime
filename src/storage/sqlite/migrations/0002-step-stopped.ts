/**
 * Widens `run_steps.status` to admit `'stopped'`, and repairs the rows the
 * missing state produced.
 *
 * A step interrupted mid-flight — by a cancellation, the deadline, or a
 * critical sibling failing — used to be left at whatever it was last written
 * as, which was `'running'`. The run then went terminal around it, so a
 * finished run reported a step still in progress. See `StepStatus` for why
 * none of the states that existed could be used instead.
 *
 * SQLite cannot alter a `CHECK` constraint, so the table is rebuilt. This is
 * the documented twelve-step procedure minus the parts that do not apply:
 * nothing has a foreign key pointing *at* `run_steps`, so dropping it triggers
 * no cascade and leaves no dangling reference, and the one key it holds — to
 * `runs(id)` — is re-declared below and satisfied by the copied rows. That is
 * what makes this safe to run with `foreign_keys = ON`, which matters because
 * the pragma is a no-op inside the transaction `migrate` opens.
 */

export const stepStopped0002 = /* sql */ `

CREATE TABLE run_steps_new (
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('extract','generate','tool_loop','transform')),
  critical   INTEGER NOT NULL CHECK (critical IN (0,1)),
  status     TEXT NOT NULL CHECK (status IN
               ('pending','running','ok','degraded','failed','skipped','stopped')),
  ordinal    INTEGER NOT NULL,
  value      TEXT,
  reason     TEXT,
  started_at INTEGER,
  ended_at   INTEGER,
  PRIMARY KEY (run_id, name)
);

INSERT INTO run_steps_new
  SELECT run_id, name, kind, critical, status, ordinal,
         value, reason, started_at, ended_at
    FROM run_steps;

DROP TABLE run_steps;
ALTER TABLE run_steps_new RENAME TO run_steps;

CREATE INDEX run_steps_run_ordinal ON run_steps(run_id, ordinal);

-- The rows already written wrong. Both repairs are scoped to terminal runs,
-- where the stored value is provably false rather than merely suspicious: the
-- run is over, so nothing is executing anything and nothing is waiting to.
--
-- A 'running' step under a 'running' run is a different case — a process that
-- died — and belongs to \`RunStore.interrupted()\`, which finds it by exactly
-- this shape. A 'pending' step under a 'suspended' run is a third: the step
-- that asked for approval, deliberately put back so it re-runs on resume.
-- Neither run status appears below.
UPDATE run_steps
   SET status = 'stopped',
       ended_at = coalesce(ended_at, (SELECT ended_at FROM runs WHERE runs.id = run_id))
 WHERE status = 'running'
   AND run_id IN (SELECT id FROM runs WHERE status IN ('succeeded','failed','cancelled'));

-- Declared and never reached, because the stage loop threw before its stage got
-- a turn. 'pending' reads as "still to do"; on a run that is over the honest
-- word is the one the same loop already writes for the steps it does reach.
UPDATE run_steps
   SET status = 'skipped',
       ended_at = coalesce(ended_at, (SELECT ended_at FROM runs WHERE runs.id = run_id))
 WHERE status = 'pending'
   AND run_id IN (SELECT id FROM runs WHERE status IN ('succeeded','failed','cancelled'));

-- What is deliberately not repaired: the runs themselves. A deadline used to be
-- filed as status 'cancelled' with no error code, which is indistinguishable on
-- the row from a real cancellation — also 'cancelled', also no code. Rewriting
-- those would be guessing, and a wrong guess here is worse than the gap.
`;
