/**
 * What a person has pinned to a conversation.
 *
 * `grounding_pin` is one row per pinned piece, named by its canonical ref with no
 * version, and goes with its conversation. The revision a change is checked
 * against is the selection's own (`grounding_selection_revision`): pins and
 * exclusions are one selection, so one change that touches both is one revision.
 *
 * A table of its own and not a `kind` of `grounding_selection`, because that
 * table is keyed by conversation and ref. A piece can be pinned and excluded at
 * once, and has to stay both: the exclusion beats the pin, and when it is lifted
 * the pin is still there.
 *
 * Additive: nothing existing is touched, and a conversation made before this
 * migration reads as having pinned nothing.
 */
export const groundingPins0043 = /* sql */ `
CREATE TABLE grounding_pin (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ref             TEXT NOT NULL,
  ordinal         INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, ref)
) WITHOUT ROWID;
`;
