export const discoveryRegistry0032 = /* sql */ `
CREATE TABLE discovery_board_metadata (id TEXT PRIMARY KEY, descriptor TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE discovery_source_aliases (
 board TEXT NOT NULL, url TEXT NOT NULL, offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
 PRIMARY KEY(board,url)
);
INSERT INTO discovery_source_aliases(board,url,offer_id) SELECT board,url,offer_id FROM discovery_sources;
`;
