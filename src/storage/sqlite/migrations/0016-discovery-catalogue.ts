export const discoveryCatalogue0016 = /* sql */ `
CREATE TABLE discovery_sources (
  source_key TEXT PRIMARY KEY NOT NULL,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  board TEXT NOT NULL,
  url TEXT NOT NULL,
  listing TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX discovery_sources_offer ON discovery_sources(offer_id, seen_at DESC);
CREATE UNIQUE INDEX discovery_sources_url ON discovery_sources(board, url);

-- A derived index over canonical offers, including ones imported before Discover.
-- Technical tokens remain distinct: C, C++, C#, and .NET are different searches.
CREATE VIRTUAL TABLE discovery_fts USING fts5(
  position, skills, company, location, text, analysis,
  content='offers', content_rowid='rowid',
  tokenize="unicode61 remove_diacritics 2 tokenchars '+#.'"
);
INSERT INTO discovery_fts(discovery_fts) VALUES('rebuild');
CREATE TRIGGER discovery_fts_insert AFTER INSERT ON offers BEGIN
  INSERT INTO discovery_fts(rowid, position, skills, company, location, text, analysis)
  VALUES(new.rowid, new.position, new.skills, new.company, new.location, new.text, new.analysis);
END;
CREATE TRIGGER discovery_fts_delete AFTER DELETE ON offers BEGIN
  INSERT INTO discovery_fts(discovery_fts, rowid, position, skills, company, location, text, analysis)
  VALUES('delete', old.rowid, old.position, old.skills, old.company, old.location, old.text, old.analysis);
END;
CREATE TRIGGER discovery_fts_update AFTER UPDATE OF position, skills, company, location, text, analysis ON offers BEGIN
  INSERT INTO discovery_fts(discovery_fts, rowid, position, skills, company, location, text, analysis)
  VALUES('delete', old.rowid, old.position, old.skills, old.company, old.location, old.text, old.analysis);
  INSERT INTO discovery_fts(rowid, position, skills, company, location, text, analysis)
  VALUES(new.rowid, new.position, new.skills, new.company, new.location, new.text, new.analysis);
END;
`;
