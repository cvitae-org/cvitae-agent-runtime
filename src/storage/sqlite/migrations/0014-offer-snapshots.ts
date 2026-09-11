export const offerSnapshots0014 = /* sql */ `
CREATE TABLE offer_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  offer_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL UNIQUE,
  request TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX offer_snapshots_owner ON offer_snapshots (offer_id, context_id, created_at);
CREATE TRIGGER offer_snapshots_immutable BEFORE UPDATE ON offer_snapshots
BEGIN SELECT RAISE(ABORT, 'Offer snapshots are immutable'); END;
`;
