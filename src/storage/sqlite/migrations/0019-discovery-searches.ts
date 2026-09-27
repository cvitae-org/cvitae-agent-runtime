/** Staged legacy imports are invisible until every bounded batch is durable. */
export const discoverySearches0019 = /* sql */ `
CREATE TABLE discovery_searches (
  id TEXT PRIMARY KEY,
  import_key TEXT NOT NULL,
  manifest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('importing', 'ready')),
  received INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL CHECK(row_count >= 0),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX discovery_searches_updated ON discovery_searches(status, updated_at DESC, id);
CREATE TABLE discovery_offer_evidence (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id),
  value TEXT NOT NULL,
  UNIQUE(id, offer_id)
);
CREATE TABLE discovery_search_members (
  search_id TEXT NOT NULL REFERENCES discovery_searches(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES offers(id),
  ordinal INTEGER NOT NULL,
  evidence_id TEXT NOT NULL,
  PRIMARY KEY(search_id, offer_id),
  UNIQUE(search_id, ordinal),
  FOREIGN KEY(evidence_id, offer_id) REFERENCES discovery_offer_evidence(id, offer_id)
);
CREATE INDEX discovery_members_evidence ON discovery_search_members(evidence_id);
CREATE TABLE discovery_import_batches (
  search_id TEXT NOT NULL REFERENCES discovery_searches(id) ON DELETE CASCADE,
  offset INTEGER NOT NULL,
  digest TEXT NOT NULL,
  PRIMARY KEY(search_id, offset)
);
-- A delayed/replayed import must not resurrect a deleted search.
CREATE TABLE discovery_search_tombstones (id TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL);
`;
