export const indexRecovery0012 = /* sql */ `
CREATE TABLE cv_index_jobs (
  document_id TEXT PRIMARY KEY NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
INSERT INTO cv_index_jobs (document_id, revision)
SELECT d.id, d.revision FROM documents d WHERE d.kind = 'cv'
AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id AND c.source_revision = d.revision);

CREATE TRIGGER cv_index_document_insert AFTER INSERT ON documents WHEN new.kind = 'cv'
BEGIN
  INSERT INTO cv_index_jobs (document_id, revision) VALUES (new.id, new.revision)
  ON CONFLICT(document_id) DO UPDATE SET revision = excluded.revision, attempts = 0,
    token = NULL, lease_until = 0, next_attempt_at = 0, last_error = NULL;
END;
CREATE TRIGGER cv_index_document_update AFTER UPDATE ON documents WHEN new.kind = 'cv'
BEGIN
  INSERT INTO cv_index_jobs (document_id, revision) VALUES (new.id, new.revision)
  ON CONFLICT(document_id) DO UPDATE SET revision = excluded.revision, attempts = 0,
    token = NULL, lease_until = 0, next_attempt_at = 0, last_error = NULL;
END;
`;
