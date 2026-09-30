export const integrationAcquisitions0035 = /* sql */ `
CREATE TABLE discovery_integration_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  provenance TEXT NOT NULL,
  recipe TEXT NOT NULL
);
CREATE TABLE discovery_integration_acquisitions (
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL REFERENCES discovery_integration_definitions(id),
  first_retrieved_at TEXT NOT NULL,
  last_retrieved_at TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(offer_id, definition_id)
);
-- Historical rows remain unchanged and have no invented provider provenance.
`;
