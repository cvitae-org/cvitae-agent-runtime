export const contextContracts0015 = /* sql */ `
ALTER TABLE runs ADD COLUMN offer_snapshot_id TEXT REFERENCES offer_snapshots(id);
CREATE INDEX runs_offer_snapshot ON runs(offer_snapshot_id);
CREATE TABLE cv_write_receipts (
  operation_id TEXT PRIMARY KEY NOT NULL,
  request TEXT NOT NULL,
  result TEXT NOT NULL
);
CREATE TABLE cv_copy_receipts (
  context_id TEXT PRIMARY KEY NOT NULL REFERENCES cv_contexts(id),
  request TEXT NOT NULL,
  result TEXT NOT NULL
);
`;
