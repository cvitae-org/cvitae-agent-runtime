export const offerNotes0018 = `
CREATE TABLE offer_notes (
 offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
 text TEXT NOT NULL CHECK(length(text) <= 10000),
 revision INTEGER NOT NULL CHECK(revision > 0),
 updated_at INTEGER NOT NULL
);
`;
