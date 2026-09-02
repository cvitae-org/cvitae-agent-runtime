/**
 * Widens `offers` from "a posting someone handed us" to "a posting a standing
 * search found, scored, and may have to re-score tomorrow".
 *
 * The table was written for `analyze_offer`, which is given a URL by a person.
 * Discovery inverts that: the machine proposes offers, so the row has to carry
 * how far the round got with it, what the person decided about it, and a score
 * that is only meaningful relative to the CV and criteria it was computed
 * against. None of that is derivable from the columns that were here.
 *
 * `imported_at` is renamed rather than kept beside a new column. It never
 * answered the question a standing search asks, and it failed in both
 * directions: restamped on every upsert, an offer seen daily for a month looks
 * new every morning; never restamped — which is what the `ON CONFLICT` clause
 * actually did — "is this still posted?" has no answer at all. Two timestamps
 * is the fix, and leaving the old name on one of them would leave the
 * ambiguity that caused it.
 *
 * Every other change is `ADD COLUMN`, which SQLite does in constant time
 * without rewriting the table. The `CHECK` constraints ride along on the new
 * columns; no existing constraint is altered, so none of this needs the
 * twelve-step table rebuild that `0002` did.
 */

export const offerDiscovery0003 = /* sql */ `

-- The index is dropped and recreated by hand. Modern SQLite carries an index
-- through a RENAME COLUMN on its own, but the index name would then outlive
-- the column it was named for, and a stale name in a schema is a trap set for
-- whoever reads it next.
DROP INDEX offers_imported;
ALTER TABLE offers RENAME COLUMN imported_at TO first_seen_at;
CREATE INDEX offers_first_seen ON offers(first_seen_at DESC);

-- Backfilled from first_seen_at rather than from the current clock. Every row
-- that exists was seen at least once, at a time we know; stamping "now" would
-- assert that a search which never ran had just confirmed them.
ALTER TABLE offers ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
UPDATE offers SET last_seen_at = first_seen_at;
CREATE INDEX offers_last_seen ON offers(last_seen_at DESC);

-- Facts a board states that the original table had no column for. All nullable:
-- a posting is free to omit any of them, and '' would claim it said something.
ALTER TABLE offers ADD COLUMN seniority       TEXT;
ALTER TABLE offers ADD COLUMN contract_type   TEXT;
ALTER TABLE offers ADD COLUMN salary          TEXT;
ALTER TABLE offers ADD COLUMN salary_min      REAL;
ALTER TABLE offers ADD COLUMN salary_max      REAL;
ALTER TABLE offers ADD COLUMN salary_currency TEXT;
ALTER TABLE offers ADD COLUMN salary_period   TEXT
  CHECK (salary_period IS NULL OR salary_period IN ('','hour','day','month','year'));
ALTER TABLE offers ADD COLUMN skills          TEXT;

-- How far the machine got, and what the person decided. Two columns because
-- two authors: a re-scrape that could write the second one would silently
-- un-dismiss everything the user had already said no to.
ALTER TABLE offers ADD COLUMN processing TEXT NOT NULL DEFAULT 'candidate'
  CHECK (processing IN ('candidate','fetched','rated','unreadable'));
ALTER TABLE offers ADD COLUMN disposition TEXT NOT NULL DEFAULT 'active'
  CHECK (disposition IN ('active','dismissed','applied','expired'));

-- The score, and the inputs it was computed against.
ALTER TABLE offers ADD COLUMN eligibility TEXT NOT NULL DEFAULT 'unrated'
  CHECK (eligibility IN ('unrated','eligible','provisional','ineligible'));
ALTER TABLE offers ADD COLUMN fit               REAL;
ALTER TABLE offers ADD COLUMN completeness      REAL;
ALTER TABLE offers ADD COLUMN score_detail      TEXT;
ALTER TABLE offers ADD COLUMN rated_at          INTEGER;
ALTER TABLE offers ADD COLUMN scorer_version    TEXT;
ALTER TABLE offers ADD COLUMN cv_fingerprint    TEXT;
ALTER TABLE offers ADD COLUMN prefs_fingerprint TEXT;

-- The shortlist's query: live offers, best fit first. Partial, because
-- everything the shortlist shows is 'active' and the dismissed pile is the one
-- that grows without bound.
CREATE INDEX offers_shortlist ON offers(eligibility, fit DESC, last_seen_at DESC)
  WHERE disposition = 'active';

-- The rescore query. Both fingerprints are compared, so both are in the index,
-- and rated_at orders the oldest score to the front of the queue.
CREATE INDEX offers_rating_inputs
  ON offers(cv_fingerprint, prefs_fingerprint, rated_at);
`;
