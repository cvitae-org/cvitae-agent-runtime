/**
 * When a model call is masked (`contracts/mask.ts`), kept with the other settings.
 *
 * NULL is the default, `hosted`, so a database from before this column reads as
 * it always did and a person who never opens the setting has chosen nothing.
 *
 * Additive: one nullable column, and nothing existing is touched.
 */
export const maskMode0046 = /* sql */ `
ALTER TABLE settings ADD COLUMN mask_mode TEXT;
`;
