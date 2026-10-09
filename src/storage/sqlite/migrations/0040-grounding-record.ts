/**
 * What a chat run was given, kept per run.
 *
 * `grounding_record` is one row per run that belongs to a conversation, opened
 * when the run is created and settled by the run store when its status changes.
 * `grounding_entry` is what was recorded against it, one row per distinct thing
 * in the order it was first recorded.
 *
 * Both are additive: nothing existing is touched, and a run made before this
 * migration simply has no record, which is what the rows say.
 *
 * What is deliberately absent:
 *
 *   - No `CHECK` on an entry's `status` or `origin`. Later versions add values,
 *     and a reader that meets one it does not know treats it as not reaching
 *     the model; a constraint here would make that a failed write instead.
 *   - No foreign key from `conversation_id`. A run's own `conversation_id` has
 *     none either (migration 0010), and a record outlives the thing it names:
 *     it holds addresses and digests, never the text.
 *
 * The unique index is what makes "equal entries are one entry" true in the file
 * and not only in the code that writes it. It spells the optional columns with
 * `coalesce` because two NULLs are never equal to a unique index, and an entry
 * with no version recorded twice must still be one entry.
 */
export const groundingRecord0040 = /* sql */ `
CREATE TABLE grounding_record (
  run_id          TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  v               INTEGER NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('open', 'suspended', 'closed', 'interrupted')),
  outcome         TEXT CHECK (outcome IN ('succeeded', 'failed', 'cancelled')),
  opened_at       INTEGER NOT NULL,
  closed_at       INTEGER,
  CHECK ((state = 'closed') = (outcome IS NOT NULL))
);

CREATE INDEX grounding_record_conversation ON grounding_record (conversation_id, opened_at);

CREATE TABLE grounding_entry (
  id      INTEGER PRIMARY KEY,
  run_id  TEXT NOT NULL REFERENCES grounding_record(run_id) ON DELETE CASCADE,
  ref     TEXT NOT NULL,
  version TEXT,
  digest  TEXT NOT NULL,
  shown   TEXT,
  status  TEXT NOT NULL,
  origin  TEXT NOT NULL,
  via     TEXT NOT NULL
);

CREATE UNIQUE INDEX grounding_entry_once
  ON grounding_entry (run_id, ref, coalesce(version, ''), digest, coalesce(shown, ''), status, origin, via);
`;
