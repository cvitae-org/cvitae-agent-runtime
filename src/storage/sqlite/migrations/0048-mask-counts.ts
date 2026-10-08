/**
 * What masking did, in numbers: per model call in `ai_calls`, and per run in its
 * record (`contracts/mask.ts`).
 *
 * `ai_calls.masked` is how many placeholders of each kind a call sent, as JSON
 * (`{"name":1,"email":1}`); NULL is a call sent as it was, which is also what
 * every row from before this column says, since none of them was counted.
 * `grounding_record.masking` is a run's calls counted together, as JSON; NULL is
 * a run none of whose calls was counted.
 *
 * JSON and not a column a kind: the kinds grow with the detectors, and a count is
 * read whole and never searched. Counts only, never a value.
 *
 * Additive: two nullable columns, and nothing existing is touched.
 */
export const maskCounts0048 = /* sql */ `
ALTER TABLE ai_calls ADD COLUMN masked TEXT;
ALTER TABLE grounding_record ADD COLUMN masking TEXT;
`;
