export const boardWorkspaces0031 = /* sql */ `
CREATE TABLE board_entries (id TEXT PRIMARY KEY, offer_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL, change_seq INTEGER NOT NULL);
CREATE INDEX board_preparation_queue ON board_entries(json_extract(body,'$.preparation.status'), json_extract(body,'$.archived'));
CREATE TABLE board_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL);
CREATE TABLE board_operations (id TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE board_artifacts (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, content BLOB NOT NULL);
CREATE TABLE board_run_inputs (run_id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, body TEXT NOT NULL);
CREATE TRIGGER board_run_inputs_immutable BEFORE UPDATE ON board_run_inputs BEGIN SELECT RAISE(ABORT, 'Board run inputs are immutable'); END;
CREATE TABLE board_run_authorizations (run_id TEXT PRIMARY KEY, input TEXT NOT NULL);
CREATE TABLE board_chat_messages (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, run_id TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(run_id, role));
CREATE INDEX board_chat_owner ON board_chat_messages(entry_id);
`;
