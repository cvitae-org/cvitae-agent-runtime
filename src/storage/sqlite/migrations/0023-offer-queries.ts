export const offerQueries0023 = /* sql */ `
CREATE TABLE offer_query_evidence_sequence(seq INTEGER PRIMARY KEY AUTOINCREMENT,evidence_id TEXT UNIQUE NOT NULL REFERENCES discovery_offer_evidence(id) ON DELETE CASCADE);
INSERT INTO offer_query_evidence_sequence(evidence_id) SELECT id FROM discovery_offer_evidence ORDER BY rowid;
CREATE TRIGGER offer_query_evidence_added AFTER INSERT ON discovery_offer_evidence BEGIN
 INSERT INTO offer_query_evidence_sequence(evidence_id) VALUES(new.id);
END;
CREATE TABLE offer_query_snapshots(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES discovery_searches(id) ON DELETE CASCADE,scope TEXT NOT NULL,source_key TEXT NOT NULL,fingerprint TEXT,bytes INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
CREATE INDEX offer_query_snapshot_source ON offer_query_snapshots(owner_id,source_key);
CREATE TABLE offer_query_projection(cache_key TEXT PRIMARY KEY,evidence_id TEXT NOT NULL REFERENCES discovery_offer_evidence(id) ON DELETE CASCADE,value TEXT NOT NULL,hash TEXT NOT NULL,bytes INTEGER NOT NULL);
CREATE TABLE offer_query_members(snapshot_id TEXT NOT NULL REFERENCES offer_query_snapshots(id) ON DELETE CASCADE,offer_id TEXT NOT NULL,evidence_id TEXT NOT NULL,metadata TEXT NOT NULL,projection_key TEXT,PRIMARY KEY(snapshot_id,offer_id),FOREIGN KEY(evidence_id,offer_id) REFERENCES discovery_offer_evidence(id,offer_id));
CREATE INDEX offer_query_members_evidence ON offer_query_members(evidence_id);
CREATE INDEX offer_query_members_projection ON offer_query_members(projection_key);
CREATE TABLE offer_query_executions(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES discovery_searches(id) ON DELETE CASCADE,request_id TEXT NOT NULL,request TEXT NOT NULL,request_hash TEXT NOT NULL,validation_only INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL,snapshot_id TEXT REFERENCES offer_query_snapshots(id) ON DELETE SET NULL,result TEXT,error TEXT,timing TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,bytes INTEGER NOT NULL DEFAULT 0,row_count INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL,UNIQUE(owner_id,request_id));
CREATE INDEX offer_query_execution_cache ON offer_query_executions(owner_id,snapshot_id,state);
CREATE INDEX offer_query_execution_snapshot ON offer_query_executions(snapshot_id);
CREATE TABLE offer_query_pages(execution_id TEXT NOT NULL REFERENCES offer_query_executions(id) ON DELETE CASCADE,page INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(execution_id,page));
CREATE TABLE offer_query_result_members(execution_id TEXT NOT NULL REFERENCES offer_query_executions(id) ON DELETE CASCADE,offer_id TEXT NOT NULL,PRIMARY KEY(execution_id,offer_id));
CREATE TABLE offer_query_documents(search_id TEXT PRIMARY KEY REFERENCES discovery_searches(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 0,draft TEXT NOT NULL,original_filters TEXT,applied_id TEXT REFERENCES offer_query_executions(id) ON DELETE SET NULL);
CREATE TABLE offer_query_pins(execution_id TEXT NOT NULL REFERENCES offer_query_executions(id) ON DELETE CASCADE,pin TEXT NOT NULL,PRIMARY KEY(execution_id,pin));
`;
