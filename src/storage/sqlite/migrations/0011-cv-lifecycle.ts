export const cvLifecycle0011 = /* sql */ `
ALTER TABLE cv_contexts ADD COLUMN generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0);
ALTER TABLE runs ADD COLUMN context_generation INTEGER;
ALTER TABLE runs ADD COLUMN context_revision INTEGER;
UPDATE runs SET context_generation = 0 WHERE context_id IS NOT NULL;

CREATE TABLE cv_proposals (
  id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id),
  context_id TEXT NOT NULL REFERENCES cv_contexts(id),
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  generation INTEGER NOT NULL CHECK (generation >= 0),
  document TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'discarded', 'invalidated')),
  accepted_record TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX cv_proposals_context ON cv_proposals(context_id, created_at);
CREATE TABLE cv_clear_receipts (
  operation_id TEXT PRIMARY KEY NOT NULL,
  context_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  result TEXT NOT NULL
);
`;
