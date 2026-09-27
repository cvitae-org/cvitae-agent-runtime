/** Re-evaluate saved headlines under the user-selected role/company policy.
 * Manual exclusions and frozen query memberships remain intact. No network work.
 */
export const headlineOpportunities0029 = /* sql */ `
INSERT OR IGNORE INTO opportunity_dirty(offer_id) SELECT id FROM offers;
`;
