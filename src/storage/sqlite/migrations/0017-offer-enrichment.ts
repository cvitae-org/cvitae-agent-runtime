export const offerEnrichment0017 = /* sql */ `
CREATE TABLE offer_enrichments (
  offer_id TEXT PRIMARY KEY NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  value TEXT NOT NULL
);
`;
