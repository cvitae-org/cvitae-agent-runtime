/**
 * What a person has excluded from a conversation.
 *
 * `grounding_selection` is one row per excluded piece, named by its canonical
 * ref with no version, and `grounding_selection_revision` is the number a change
 * is checked against. Both go with the conversation they belong to.
 *
 * Additive: nothing existing is touched, and a conversation made before this
 * migration reads as having excluded nothing, which is what its absence of rows
 * says.
 *
 * What is deliberately absent:
 *
 *   - No `CHECK` on `kind`. A later step adds a value, and a reader that meets
 *     one it does not know must not build a wall from it; the reader says
 *     `kind = 'exclude'` and a constraint here would turn a new value into a
 *     failed write.
 *   - No foreign key from `ref` to anything. It is an address, and what it
 *     names can be renamed or deleted while the exclusion stays, which is the
 *     point of a selection that follows the live revision.
 *
 * `ordinal` counts upward from the largest one still in the conversation, which
 * is what keeps the refs in the order they were excluded in a table that has no
 * rowid. A ref excluded again after it was cleared goes last.
 */
export const groundingSelection0041 = /* sql */ `
CREATE TABLE grounding_selection (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ref             TEXT NOT NULL,
  kind            TEXT NOT NULL,
  ordinal         INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, ref)
) WITHOUT ROWID;

CREATE TABLE grounding_selection_revision (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  revision        INTEGER NOT NULL
) WITHOUT ROWID;
`;
