/**
 * What a proposal changes, kept with the proposal (`capabilities/cv/diff.ts`).
 *
 * `target` is the ref of the section an edit was aimed at, and `changes` is the
 * list of what is different about the proposed document: what a person is shown,
 * and what an accept writes. Both are absent from a proposal made before they
 * were kept, which is accepted as the document it holds, as it always was.
 *
 * Additive: two nullable columns, and nothing existing is touched.
 */
export const cvProposalChanges0045 = /* sql */ `
ALTER TABLE cv_proposals ADD COLUMN target TEXT;
ALTER TABLE cv_proposals ADD COLUMN changes TEXT;
`;
