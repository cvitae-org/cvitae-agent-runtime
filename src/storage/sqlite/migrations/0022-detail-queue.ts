export const detailQueue0022 = /* sql */ `
CREATE TABLE discovery_detail_queue (
 offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 revision INTEGER NOT NULL
);
CREATE INDEX discovery_detail_queue_revision ON discovery_detail_queue(revision);
CREATE INDEX discovery_detail_queue_status ON discovery_detail_queue(status,revision);
CREATE TABLE discovery_detail_queue_state (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO discovery_detail_queue_state(id,paused) VALUES(1,0);
`;
