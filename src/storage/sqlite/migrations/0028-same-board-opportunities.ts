/** Re-evaluate saved evidence under opportunity-v2 without fetching any pages.
 * Existing memberships, aliases, exclusions, and query snapshots stay intact.
 */
export const sameBoardOpportunities0028 = /* sql */ `
INSERT OR IGNORE INTO opportunity_dirty(offer_id) SELECT id FROM offers;
`;
