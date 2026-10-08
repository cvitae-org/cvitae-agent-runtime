/**
 * Which of a person's own values are masked (`contracts/mask.ts`), kept with the
 * other settings.
 *
 * NULL is the default, `personal`, so a database from before this column reads as
 * it always did and a person who never opens the setting has chosen nothing.
 *
 * Additive: one nullable column, and nothing existing is touched.
 */
export const maskScope0047 = /* sql */ `
ALTER TABLE settings ADD COLUMN mask_scope TEXT;
`;
