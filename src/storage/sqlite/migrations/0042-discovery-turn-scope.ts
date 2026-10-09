/**
 * Whether a discovery turn says what its model was given.
 *
 * Two things reach a discovery model besides the question: the offers its scope
 * held, and the earlier answers of the conversation. A turn made after this
 * migration records both: `discovery_turn_members` names every offer its queries
 * could read (including the ones it collected from the job boards while it ran,
 * which until now nothing wrote down), and the turn's stored context names the
 * runs whose messages it was given as history. Such a turn has `traced = 1`.
 * One made before it has `0`.
 *
 * That matters to an exclusion. An earlier answer is withheld from the history
 * of a conversation when an offer it was built from is excluded now
 * (`discovery-walls.ts`), and that needs to know which offers and which answers
 * each turn was built from. For a turn that cannot say, a conservative reading
 * is used.
 *
 * Additive: a column with a default, nothing existing is touched.
 */
export const discoveryTurnScope0042 = /* sql */ `
ALTER TABLE discovery_chat_turns ADD COLUMN traced INTEGER NOT NULL DEFAULT 0;
`;
