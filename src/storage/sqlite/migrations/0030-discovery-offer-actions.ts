/** Discover visibility never deletes canonical offers used by Board. */
export const discoveryOfferActions0030 = `
CREATE TABLE discovery_blacklist (offer_id TEXT PRIMARY KEY REFERENCES offers(id), created_at INTEGER NOT NULL);
CREATE TABLE discovery_offer_visibility (
 search_id TEXT NOT NULL REFERENCES discovery_searches(id) ON DELETE CASCADE,
 offer_id TEXT NOT NULL REFERENCES offers(id),
 action TEXT NOT NULL CHECK(action IN ('hide','delete')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(search_id,offer_id)
);
`;
