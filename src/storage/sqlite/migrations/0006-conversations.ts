/**
 * Somewhere for a conversation to survive a restart.
 *
 * The client has had a transcript since it was written, held in memory and
 * gone the moment the window closed. That is fine for a demo and wrong for the
 * product: the questions someone asks about their own CV are worth as much on
 * the second day as on the first, and an offer conversation is specifically an
 * answer you go back and read a week later.
 *
 * **One conversation per subject**, enforced by a unique index rather than by
 * whoever opens one remembering to look first. The client keys chat by a sealed
 * `ChatSubject` — the profile, or one offer — so two rows for the same subject
 * are not a feature the UI could show; they are a split transcript, half of
 * which is invisible. "Start over" is a delete, which is honest about what it
 * does.
 *
 * The profile's subject id is the empty string rather than NULL. A unique index
 * over a nullable column does not constrain NULLs in SQLite — every row with a
 * NULL id would be distinct from every other — so the constraint that matters
 * would silently not apply to the one conversation that always exists.
 *
 * **`seq` is per conversation and gapless**, assigned the same way a run's
 * events are: read the maximum and add one, inside the write transaction that
 * inserts. It exists so a client can tell "I have everything up to here" from
 * "something did not arrive", and both of those are questions about one
 * transcript, which is why it does not restart per role or count globally.
 *
 * What is deliberately not a column:
 *
 *   The timeline. A run's steps are already in `events`, keyed by the `run_id`
 *   this table carries, and storing a second rendering of them would be a copy
 *   that can disagree with the log. State is canonical; the display is derived.
 *
 *   A notice. "The run failed" is a fact about a run, readable from its row.
 *   Writing it here would mean a transcript that still says a run failed after
 *   the run was retried and succeeded.
 *
 *   Anything about streaming. A delta is not a message and was never stored;
 *   what lands here is the finished text, which is the only version of an
 *   answer that is worth reading twice.
 */

export const conversations0006 = /* sql */ `

CREATE TABLE conversations (
  id           TEXT PRIMARY KEY,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('profile', 'offer')),
  -- Empty for the profile. See the note above about NULL and uniqueness.
  subject_id   TEXT NOT NULL,
  title        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX conversations_subject ON conversations(subject_kind, subject_id);

-- Newest first, which is how a list of conversations is read.
CREATE INDEX conversations_updated ON conversations(updated_at DESC);

CREATE TABLE messages (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  -- The client's own id, so an optimistically rendered message can be
  -- reconciled with the row it became rather than appearing twice.
  id              TEXT NOT NULL UNIQUE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text            TEXT NOT NULL,
  -- The run this message belongs to, on both halves of the exchange. It is what
  -- lets a reloaded transcript find the steps, the degradations and the failure
  -- of a run whose result is not repeated here.
  run_id          TEXT REFERENCES runs(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, seq)
) WITHOUT ROWID;
`;
