/** Source observation history and uncertain search membership.
 * Existing accepted membership remains untouched and therefore keeps its
 * historical meaning. Backfilled source activity is unknown: prior sightings
 * are not fabricated into availability checks.
 */
export const discoveryDecisions0025 = /* sql */ `
ALTER TABLE discovery_sources ADD COLUMN first_observed_at INTEGER;
ALTER TABLE discovery_sources ADD COLUMN latest_observed_at INTEGER;
ALTER TABLE discovery_sources ADD COLUMN publication_date TEXT;
ALTER TABLE discovery_sources ADD COLUMN publication_precision TEXT NOT NULL DEFAULT 'unknown'
  CHECK(publication_precision IN ('instant','date','unknown'));
ALTER TABLE discovery_sources ADD COLUMN activity TEXT NOT NULL DEFAULT 'unknown'
  CHECK(activity IN ('active','inactive','unknown'));
ALTER TABLE discovery_sources ADD COLUMN activity_reason TEXT NOT NULL DEFAULT 'No source activity evidence is available.';
ALTER TABLE discovery_sources ADD COLUMN activity_checked_at INTEGER;
UPDATE discovery_sources SET first_observed_at=seen_at, latest_observed_at=seen_at;

CREATE TABLE discovery_search_review_members (
  search_id TEXT NOT NULL REFERENCES discovery_searches(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES offers(id),
  ordinal INTEGER NOT NULL,
  evidence_id TEXT NOT NULL,
  PRIMARY KEY(search_id, offer_id),
  UNIQUE(search_id, ordinal),
  FOREIGN KEY(evidence_id, offer_id) REFERENCES discovery_offer_evidence(id, offer_id)
);
CREATE INDEX discovery_review_members_evidence ON discovery_search_review_members(evidence_id);
`;
