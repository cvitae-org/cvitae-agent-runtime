/**
 * A rebuild that cannot succeed on its own stops, and says why.
 *
 * Before this every failure was retried with the backoff capped at five
 * minutes and no limit, so a refused key was sent again twelve times an hour
 * for as long as the app was open, and nothing recorded which kind of failure
 * it was. `parked` stops the job; `error_code` is what the app shows.
 *
 * The triggers are recreated because a new CV revision has to clear both, as
 * it already clears the attempts and the last error.
 */
export const indexParking0038 = /* sql */ `
ALTER TABLE cv_index_jobs ADD COLUMN error_code TEXT;
ALTER TABLE cv_index_jobs ADD COLUMN parked INTEGER NOT NULL DEFAULT 0;

DROP TRIGGER cv_index_document_insert;
DROP TRIGGER cv_index_document_update;
CREATE TRIGGER cv_index_document_insert AFTER INSERT ON documents WHEN new.kind = 'cv'
BEGIN
  INSERT INTO cv_index_jobs (document_id, revision) VALUES (new.id, new.revision)
  ON CONFLICT(document_id) DO UPDATE SET revision = excluded.revision, attempts = 0,
    token = NULL, lease_until = 0, next_attempt_at = 0, last_error = NULL,
    error_code = NULL, parked = 0;
END;
CREATE TRIGGER cv_index_document_update AFTER UPDATE ON documents WHEN new.kind = 'cv'
BEGIN
  INSERT INTO cv_index_jobs (document_id, revision) VALUES (new.id, new.revision)
  ON CONFLICT(document_id) DO UPDATE SET revision = excluded.revision, attempts = 0,
    token = NULL, lease_until = 0, next_attempt_at = 0, last_error = NULL,
    error_code = NULL, parked = 0;
END;
`;
