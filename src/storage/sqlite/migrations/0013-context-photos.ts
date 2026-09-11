export const contextPhotos0013 = /* sql */ `
ALTER TABLE cv_contexts ADD COLUMN include_photo INTEGER NOT NULL DEFAULT 0 CHECK (include_photo IN (0, 1));
UPDATE cv_contexts SET include_photo = 1 WHERE id = 'cv';
CREATE TABLE cv_photo_receipts (
  operation_id TEXT PRIMARY KEY NOT NULL,
  request TEXT NOT NULL,
  result TEXT NOT NULL
);
DROP TRIGGER cv_context_legacy_document;
CREATE TRIGGER cv_context_legacy_document AFTER INSERT ON documents
WHEN new.id = 'cv' OR (new.id = 'cv_photo' AND NOT EXISTS (SELECT 1 FROM cv_contexts))
BEGIN
  INSERT INTO cv_contexts (id, language, include_photo, created_at, updated_at)
  VALUES ('cv', NULL, 1, new.created_at, new.updated_at)
  ON CONFLICT(id) DO NOTHING;
END;
DROP TRIGGER cv_context_legacy_conversation;
CREATE TRIGGER cv_context_legacy_conversation AFTER INSERT ON conversations
WHEN new.subject_kind = 'profile' AND new.subject_id = ''
BEGIN
  INSERT INTO cv_contexts (id, language, include_photo, created_at, updated_at)
  VALUES ('cv', NULL, 1, new.created_at, new.updated_at)
  ON CONFLICT(id) DO NOTHING;
END;
`;
