export const browserCompanion0033 = `
CREATE TABLE browser_captures(id TEXT PRIMARY KEY,offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,value TEXT NOT NULL,content_hash TEXT NOT NULL,captured_at INTEGER NOT NULL,completeness TEXT NOT NULL,source_url TEXT NOT NULL,parser TEXT NOT NULL,capture_method TEXT NOT NULL);
CREATE INDEX browser_capture_offer ON browser_captures(offer_id,captured_at);
CREATE TABLE browser_import_receipts(seq INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,value TEXT NOT NULL,created_at INTEGER NOT NULL);
`;
