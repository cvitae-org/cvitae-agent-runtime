/** Unknown legacy index revisions are excluded until rebuilt. Existing content is preserved. */
export const contextIsolation0010 = /* sql */ `
ALTER TABLE chunks ADD COLUMN source_revision INTEGER CHECK (source_revision IS NULL OR source_revision > 0);
ALTER TABLE chunks ADD COLUMN local_id TEXT;
UPDATE chunks SET local_id = id;

-- Reinsert through the existing FTS triggers. Replacing all IDs in one UPDATE
-- can encounter temporary primary-key collisions with an old unscoped ID.
CREATE TEMP TABLE cv_context_chunks AS SELECT * FROM chunks;
DELETE FROM chunks;
INSERT INTO chunks (id, document_id, kind, text, search_text, meta, position,
  fingerprint, dim, vector, created_at, source_revision, local_id)
SELECT json_array(document_id, local_id), document_id, kind, text, search_text,
  meta, position, fingerprint, dim, vector, created_at, source_revision, local_id
FROM cv_context_chunks;
DROP TABLE cv_context_chunks;

ALTER TABLE runs ADD COLUMN context_id TEXT REFERENCES cv_contexts(id);
-- Historical ownership survives deletion of the conversation itself. New
-- bindings are validated transactionally in the store, not by a cascading FK.
ALTER TABLE runs ADD COLUMN conversation_id TEXT;
CREATE INDEX runs_context ON runs(context_id, created_at);
`;
