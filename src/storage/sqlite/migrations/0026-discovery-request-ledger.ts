/** A durable shared request ledger for listing acquisition and automatic detail reads. */
export const discoveryRequestLedger0026 = /* sql */ `
CREATE TABLE discovery_search_request_usage (
  search_id TEXT PRIMARY KEY REFERENCES discovery_searches(id) ON DELETE CASCADE,
  search_requests INTEGER NOT NULL DEFAULT 0 CHECK(search_requests >= 0),
  detail_requests INTEGER NOT NULL DEFAULT 0 CHECK(detail_requests >= 0),
  updated_at INTEGER NOT NULL
);
INSERT INTO discovery_search_request_usage(search_id,updated_at)
  SELECT id,updated_at FROM discovery_searches;

ALTER TABLE discovery_detail_queue ADD COLUMN search_id TEXT REFERENCES discovery_searches(id) ON DELETE CASCADE;
ALTER TABLE discovery_detail_queue ADD COLUMN stop_reason TEXT;
CREATE INDEX discovery_detail_queue_search ON discovery_detail_queue(search_id,status,revision);
`;
