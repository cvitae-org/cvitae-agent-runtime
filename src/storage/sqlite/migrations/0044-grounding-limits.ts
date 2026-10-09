/**
 * The most the material of one message may come to (`context/limits.ts`).
 *
 * `grounding_limit` is the setting for everything: one row, and no row is no
 * setting. `grounding_conversation_limit` is a conversation's own, goes with its
 * conversation, and wins over the global one while it exists. The amount is in
 * characters, and the store refuses what is outside the floor and the ceiling
 * before it gets here; the CHECK is the same bounds said a second time, so a row
 * that would be refused by the store cannot be written around it.
 *
 * Additive: nothing existing is touched, and a database from before this reads as
 * having set nothing, which is the limit it always lived under.
 */
export const groundingLimits0044 = /* sql */ `
CREATE TABLE grounding_limit (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  context INTEGER NOT NULL CHECK (context BETWEEN 2000 AND 60000)
);

CREATE TABLE grounding_conversation_limit (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  context         INTEGER NOT NULL CHECK (context BETWEEN 2000 AND 60000)
) WITHOUT ROWID;
`;
