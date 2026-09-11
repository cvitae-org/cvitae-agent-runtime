/**
 * Add metadata without rewriting CVs, photos, conversations, or run history.
 * Language assignment is a later user action, never a locale inference.
 * Legacy writers remain active during rollout, so inserts after this migration
 * must register the same legacy context too. A fresh database stays empty.
 */
export const cvContexts0009 = /* sql */ `
CREATE TABLE cv_contexts (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  language TEXT UNIQUE CHECK (language IN ('pl', 'en')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (language IS NOT NULL OR id = 'cv')
);

INSERT INTO cv_contexts (id, language, created_at, updated_at)
SELECT 'cv', NULL, min(created_at), max(updated_at)
FROM (
  SELECT created_at, updated_at FROM documents WHERE id IN ('cv', 'cv_photo')
  UNION ALL
  SELECT created_at, updated_at FROM conversations
    WHERE subject_kind = 'profile' AND subject_id = ''
) HAVING count(*) > 0;

CREATE TRIGGER cv_context_legacy_document AFTER INSERT ON documents
WHEN new.id IN ('cv', 'cv_photo')
BEGIN
  INSERT INTO cv_contexts (id, language, created_at, updated_at)
  VALUES ('cv', NULL, new.created_at, new.updated_at)
  ON CONFLICT(id) DO NOTHING;
END;

CREATE TRIGGER cv_context_legacy_conversation AFTER INSERT ON conversations
WHEN new.subject_kind = 'profile' AND new.subject_id = ''
BEGIN
  INSERT INTO cv_contexts (id, language, created_at, updated_at)
  VALUES ('cv', NULL, new.created_at, new.updated_at)
  ON CONFLICT(id) DO NOTHING;
END;
`;
