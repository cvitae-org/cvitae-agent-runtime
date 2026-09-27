export const discoveryChat0020 = /* sql */ `
-- Rebuild both sides of the sole conversation FK before dropping the parent.
-- This preserves messages under foreign_keys=ON without disabling enforcement.
CREATE TABLE conversations_new (
 id TEXT PRIMARY KEY, subject_kind TEXT NOT NULL CHECK(subject_kind IN ('profile','offer','discovery')),
 subject_id TEXT NOT NULL, title TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 summary TEXT, summarised_through INTEGER NOT NULL DEFAULT 0
);
INSERT INTO conversations_new SELECT * FROM conversations;
CREATE TABLE messages_new (
 conversation_id TEXT NOT NULL REFERENCES conversations_new(id) ON DELETE CASCADE,
 seq INTEGER NOT NULL, id TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
 text TEXT NOT NULL, run_id TEXT REFERENCES runs(id) ON DELETE SET NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(conversation_id,seq)
) WITHOUT ROWID;
INSERT INTO messages_new SELECT * FROM messages;
DROP TABLE messages;
DROP TABLE conversations;
ALTER TABLE conversations_new RENAME TO conversations;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX conversations_subject ON conversations(subject_kind,subject_id,updated_at DESC);
CREATE INDEX conversations_updated ON conversations(updated_at DESC);
CREATE UNIQUE INDEX discovery_conversation_subject ON conversations(subject_id) WHERE subject_kind='discovery';
CREATE TRIGGER cv_context_legacy_conversation AFTER INSERT ON conversations
WHEN new.subject_kind='profile' AND new.subject_id=''
BEGIN
 INSERT INTO cv_contexts(id,language,include_photo,created_at,updated_at)
 VALUES('cv',NULL,1,new.created_at,new.updated_at) ON CONFLICT(id) DO NOTHING;
END;
CREATE TRIGGER discovery_conversation_owner BEFORE INSERT ON conversations
WHEN new.subject_kind='discovery' AND NOT EXISTS(SELECT 1 FROM discovery_searches WHERE id=new.subject_id AND status='ready')
BEGIN SELECT RAISE(ABORT,'Discovery search is not ready'); END;
CREATE TRIGGER discovery_search_conversation_delete AFTER DELETE ON discovery_searches
BEGIN DELETE FROM conversations WHERE subject_kind='discovery' AND subject_id=old.id; END;
ALTER TABLE discovery_searches ADD COLUMN filter_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_searches ADD COLUMN current_filters TEXT;
CREATE TABLE discovery_chat_turns (
 run_id TEXT PRIMARY KEY, search_id TEXT NOT NULL REFERENCES discovery_searches(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 request TEXT NOT NULL, scope_count INTEGER NOT NULL DEFAULT 0, evidence TEXT NOT NULL DEFAULT '[]',
 created_at INTEGER NOT NULL
);
CREATE INDEX discovery_chat_search ON discovery_chat_turns(search_id,created_at);
CREATE TABLE discovery_turn_members (
 run_id TEXT NOT NULL REFERENCES discovery_chat_turns(run_id) ON DELETE CASCADE,
 offer_id TEXT NOT NULL, evidence_id TEXT NOT NULL REFERENCES discovery_offer_evidence(id),
 ordinal INTEGER NOT NULL, PRIMARY KEY(run_id,offer_id)
);
CREATE INDEX discovery_turn_evidence ON discovery_turn_members(evidence_id);
`;
