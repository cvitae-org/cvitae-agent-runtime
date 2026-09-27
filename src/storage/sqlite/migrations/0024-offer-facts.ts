export const offerFacts0024 = /* sql */ `
CREATE TABLE offer_targeted_facts(
 cache_key TEXT PRIMARY KEY,offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
 source_hash TEXT NOT NULL,criterion_hash TEXT NOT NULL,model_version TEXT NOT NULL,
 value TEXT NOT NULL,source_text TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX offer_targeted_fact_offer ON offer_targeted_facts(offer_id,criterion_hash,source_hash);
`;
