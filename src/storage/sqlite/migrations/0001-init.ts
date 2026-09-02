/**
 * The initial schema.
 *
 * Shipped as a template literal rather than a `.sql` file because `tsc` is the
 * entire build and copies no assets. A `.sql` file would mean adding a copy
 * step, a path that differs between `src` and `dist`, and a new way for the
 * build to be subtly wrong — for one file's sake.
 *
 * Pragmas are deliberately absent. `journal_mode` is persistent and belongs
 * with the connection, and the rest are per-connection settings that a
 * migration has no business owning. They live in `open.ts`.
 */

export const init0001 = /* sql */ `
-- ---------------------------------------------------------------- runs

CREATE TABLE runs (
  id            TEXT PRIMARY KEY,
  capability    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN
                  ('queued','running','suspended','succeeded','failed','cancelled')),
  input         TEXT NOT NULL,
  result        TEXT,
  degraded      TEXT NOT NULL DEFAULT '[]',
  error_code    TEXT,
  error_message TEXT,
  trace_id      TEXT NOT NULL,
  provider_id   TEXT,
  model_id      TEXT,
  deadline_at   INTEGER,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  ended_at      INTEGER
);

CREATE INDEX runs_status_created ON runs(status, created_at DESC);
CREATE INDEX runs_capability_created ON runs(capability, created_at DESC);

CREATE TABLE run_steps (
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('extract','generate','tool_loop','transform')),
  critical   INTEGER NOT NULL CHECK (critical IN (0,1)),
  status     TEXT NOT NULL CHECK (status IN
               ('pending','running','ok','degraded','failed','skipped')),
  ordinal    INTEGER NOT NULL,
  value      TEXT,
  reason     TEXT,
  started_at INTEGER,
  ended_at   INTEGER,
  PRIMARY KEY (run_id, name)
);

CREATE INDEX run_steps_run_ordinal ON run_steps(run_id, ordinal);

-- Clustered on (run_id, seq), which is exactly how a caller tails it: give me
-- everything for this run after this point. WITHOUT ROWID puts the row in the
-- index rather than beside it, so that read is one B-tree walk.
CREATE TABLE events (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq    INTEGER NOT NULL,
  at     INTEGER NOT NULL,
  type   TEXT NOT NULL,
  step   TEXT,
  data   TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (run_id, seq)
) WITHOUT ROWID;

-- ------------------------------------------------------------ attempts

-- Written and COMMITTED before the call it describes. A row with no settled_at
-- after a crash means the call may have happened and we do not know — which is
-- a question for a person, never grounds for a retry.
CREATE TABLE effect_attempts (
  id              TEXT PRIMARY KEY,
  run_id          TEXT REFERENCES runs(id) ON DELETE CASCADE,
  step            TEXT,
  effect          TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request         TEXT NOT NULL,
  outcome         TEXT CHECK (outcome IN ('ok','failed')),
  response        TEXT,
  started_at      INTEGER NOT NULL,
  settled_at      INTEGER
);

-- Partial: the only question ever asked of this table is "what is still open
-- for this run", and the index is then the size of the answer rather than the
-- size of the history.
CREATE INDEX effect_attempts_unsettled
  ON effect_attempts(run_id) WHERE settled_at IS NULL;

-- ----------------------------------------------------------- approvals

CREATE TABLE approvals (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step         TEXT NOT NULL,
  ask_key      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  question     TEXT NOT NULL,
  payload      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending','granted','denied','expired')),
  decision     TEXT,
  requested_at INTEGER NOT NULL,
  decided_at   INTEGER,
  expires_at   INTEGER
);

-- One open question per (run, step, key). This is what makes a resumed step
-- find its own answer instead of asking again.
CREATE UNIQUE INDEX approvals_ask ON approvals(run_id, step, ask_key);
CREATE INDEX approvals_pending ON approvals(run_id) WHERE status = 'pending';

-- ----------------------------------------------------------- documents

CREATE TABLE documents (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  -- Compare-and-swap, not a version log. update() reads it, applies the
  -- mutator, and writes back only if it has not moved.
  revision   INTEGER NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- -------------------------------------------------------------- chunks

CREATE TABLE chunks (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL,
  -- Folded for search: diacritics stripped and Polish crossed-l mapped to l.
  -- FTS5 indexes this column; the text column is what gets returned.
  search_text TEXT NOT NULL,
  meta        TEXT NOT NULL DEFAULT '{}',
  position    INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  dim         INTEGER NOT NULL,
  vector      BLOB NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX chunks_document ON chunks(document_id);
CREATE INDEX chunks_fingerprint ON chunks(fingerprint);

-- remove_diacritics 2 matters because the CVs are Polish. It folds every
-- Polish letter that is a base plus a combining mark — a, c, e, n, o, s, z with
-- their marks all fold. It does NOT fold crossed-l: U+0142 is a distinct
-- letter, not a decomposable one, so there is no diacritic to remove. Measured:
-- with only this tokenizer, "zolw" fails to match a document containing the
-- crossed-l spelling. The fold applied to search_text closes that.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  search_text,
  content='chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
END;

CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO chunks_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

-- -------------------------------------------------------------- offers

-- Canonical rows, not a derived index. In the previous runtime an offer's text
-- and its analysis existed only inside the search index, while the rebuild path
-- regenerated CV chunks and not offers — so "the index is derived and can be
-- rebuilt" was true of half of it and quietly false of the rest.
CREATE TABLE offers (
  id          TEXT PRIMARY KEY,
  url         TEXT UNIQUE,
  final_url   TEXT,
  board       TEXT,
  company     TEXT,
  position    TEXT,
  location    TEXT,
  work_mode   TEXT,
  text        TEXT NOT NULL,
  search_text TEXT NOT NULL,
  stated      TEXT,
  analysis    TEXT,
  run_id      TEXT REFERENCES runs(id) ON DELETE SET NULL,
  imported_at INTEGER NOT NULL
);

CREATE INDEX offers_imported ON offers(imported_at DESC);

CREATE VIRTUAL TABLE offers_fts USING fts5(
  search_text, company, position,
  content='offers',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER offers_ai AFTER INSERT ON offers BEGIN
  INSERT INTO offers_fts(rowid, search_text, company, position)
    VALUES (new.rowid, new.search_text, new.company, new.position);
END;

CREATE TRIGGER offers_ad AFTER DELETE ON offers BEGIN
  INSERT INTO offers_fts(offers_fts, rowid, search_text, company, position)
    VALUES ('delete', old.rowid, old.search_text, old.company, old.position);
END;

CREATE TRIGGER offers_au AFTER UPDATE ON offers BEGIN
  INSERT INTO offers_fts(offers_fts, rowid, search_text, company, position)
    VALUES ('delete', old.rowid, old.search_text, old.company, old.position);
  INSERT INTO offers_fts(rowid, search_text, company, position)
    VALUES (new.rowid, new.search_text, new.company, new.position);
END;
`;
