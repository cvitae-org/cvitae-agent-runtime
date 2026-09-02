/**
 * Offers, stored as canonical rows.
 *
 * Not a search index that happens to hold the only copy. In the previous
 * runtime an offer's text and its analysis existed nowhere but inside the
 * vector store, while the rebuild path regenerated CV chunks and not offers —
 * so "the index is derived and can be rebuilt at any time" was true of half the
 * data and quietly false of the rest. The FTS table beside this one is derived,
 * is populated by triggers, and can be dropped and rebuilt from these rows.
 *
 * `sight` and `rate` are separate writes from `save` for a reason that only
 * shows up under a standing search. `save` is what a person's `analyze_offer`
 * does: here is a posting, store it. `sight` is what a round does forty times a
 * minute: here is a posting you may already have, keep whichever facts about it
 * are older than this sighting. A caller that had to assemble the second out of
 * the first would read the row, merge, and write — and two rounds doing that at
 * once is the lost update the JSONL store had, where nothing was ever corrupt
 * and writes disappeared anyway.
 */

import type {
  Disposition,
  Eligibility,
  OfferRating,
  OfferRecord,
  OfferSighting,
  OfferStore,
  ProcessingState,
  SalaryPeriod,
  SalaryReading,
  SightingResult,
  StatedFacts,
  WorkMode
} from '../../contracts/index.js';
import { isWorkMode } from '../../contracts/index.js';
import type { Db } from './open.js';
import { foldForSearch, packJson, unpackJson } from './rows.js';

type OfferRow = {
  id: string;
  url: string | null;
  final_url: string | null;
  board: string | null;
  company: string | null;
  position: string | null;
  location: string | null;
  work_mode: string | null;
  seniority: string | null;
  contract_type: string | null;
  salary: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  skills: string | null;
  text: string;
  stated: string | null;
  analysis: string | null;
  run_id: string | null;
  first_seen_at: number;
  last_seen_at: number;
  processing: string;
  disposition: string;
  eligibility: string;
  fit: number | null;
  completeness: number | null;
  score_detail: string | null;
  rated_at: number | null;
  scorer_version: string | null;
  cv_fingerprint: string | null;
  prefs_fingerprint: string | null;
};

/**
 * A salary reading is present only when the posting stated a period.
 *
 * The alternative — always returning an object with nulls in it — makes "we
 * parsed nothing" and "we parsed a bare number off a page that never said per
 * what" the same value, and the second one is the dangerous one.
 */
const toSalary = (row: OfferRow): SalaryReading | undefined =>
  row.salary_period === null
    ? undefined
    : {
        min: row.salary_min,
        max: row.salary_max,
        currency: row.salary_currency ?? '',
        period: row.salary_period as SalaryPeriod
      };

const toRating = (row: OfferRow): OfferRating | undefined =>
  row.rated_at === null
    ? undefined
    : {
        eligibility: row.eligibility as Eligibility,
        fit: row.fit,
        completeness: row.completeness,
        detail: unpackJson(row.score_detail),
        ratedAt: row.rated_at,
        scorerVersion: row.scorer_version ?? '',
        cvFingerprint: row.cv_fingerprint ?? '',
        prefsFingerprint: row.prefs_fingerprint ?? ''
      };

const toOffer = (row: OfferRow): OfferRecord => ({
  id: row.id,
  url: row.url ?? undefined,
  finalUrl: row.final_url ?? undefined,
  board: row.board ?? undefined,
  company: row.company ?? undefined,
  position: row.position ?? undefined,
  location: row.location ?? undefined,
  workMode: isWorkMode(row.work_mode) ? (row.work_mode as WorkMode) : undefined,
  seniority: row.seniority ?? undefined,
  contractType: row.contract_type ?? undefined,
  salary: row.salary ?? undefined,
  salaryReading: toSalary(row),
  skills: row.skills === null ? undefined : (JSON.parse(row.skills) as string[]),
  text: row.text,
  stated: unpackJson(row.stated) as StatedFacts | undefined,
  analysis: unpackJson(row.analysis),
  runId: row.run_id ?? undefined,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  processing: row.processing as ProcessingState,
  disposition: row.disposition as Disposition,
  rating: toRating(row)
});

/** The columns `save` and `sight` both write, named once. */
const factsOf = (offer: OfferSighting) => ({
  id: offer.id,
  url: offer.url ?? null,
  finalUrl: offer.finalUrl ?? null,
  board: offer.board ?? null,
  company: offer.company ?? null,
  position: offer.position ?? null,
  location: offer.location ?? null,
  workMode: offer.workMode ?? null,
  seniority: offer.seniority ?? null,
  contractType: offer.contractType ?? null,
  salary: offer.salary ?? null,
  salaryMin: offer.salaryReading?.min ?? null,
  salaryMax: offer.salaryReading?.max ?? null,
  salaryCurrency: offer.salaryReading?.currency ?? null,
  salaryPeriod: offer.salaryReading?.period ?? null,
  skills: offer.skills === undefined ? null : JSON.stringify(offer.skills),
  stated: packJson(offer.stated),
  analysis: packJson(offer.analysis),
  runId: offer.runId ?? null
});

const FACT_COLUMNS = `url, final_url, board, company, position, location, work_mode,
   seniority, contract_type, salary, salary_min, salary_max, salary_currency,
   salary_period, skills, stated, analysis, run_id`;

const FACT_VALUES = `:url, :finalUrl, :board, :company, :position, :location, :workMode,
   :seniority, :contractType, :salary, :salaryMin, :salaryMax, :salaryCurrency,
   :salaryPeriod, :skills, :stated, :analysis, :runId`;

export const createOfferStore = (db: Db): OfferStore => {
  const upsert = db.prepare(
    `INSERT INTO offers
       (id, ${FACT_COLUMNS}, text, search_text,
        first_seen_at, last_seen_at, processing, disposition)
     VALUES
       (:id, ${FACT_VALUES}, :text, :searchText,
        :firstSeenAt, :lastSeenAt, :processing, :disposition)
     ON CONFLICT (id) DO UPDATE SET
       url = excluded.url, final_url = excluded.final_url, board = excluded.board,
       company = excluded.company, position = excluded.position,
       location = excluded.location, work_mode = excluded.work_mode,
       seniority = excluded.seniority, contract_type = excluded.contract_type,
       salary = excluded.salary, salary_min = excluded.salary_min,
       salary_max = excluded.salary_max, salary_currency = excluded.salary_currency,
       salary_period = excluded.salary_period, skills = excluded.skills,
       text = excluded.text, search_text = excluded.search_text,
       stated = excluded.stated, analysis = excluded.analysis,
       run_id = excluded.run_id, last_seen_at = excluded.last_seen_at,
       processing = excluded.processing, disposition = excluded.disposition`
  );

  /**
   * A sighting's upsert, which differs from `save` in what it refuses to touch.
   *
   * `first_seen_at` is never overwritten — that is the whole point of the
   * column. `disposition` is never overwritten either, because a person wrote
   * it and a re-scrape must not un-dismiss anything. `text` is coalesced: a
   * board search yields a title and a URL and no body, and letting that
   * overwrite a posting we had already fetched in full would lose the only copy
   * of it.
   */
  const sightOne = db.prepare(
    `INSERT INTO offers
       (id, ${FACT_COLUMNS}, text, search_text,
        first_seen_at, last_seen_at, processing, disposition)
     VALUES
       (:id, ${FACT_VALUES}, :text, :searchText,
        :at, :at, :processing, 'active')
     ON CONFLICT (id) DO UPDATE SET
       url = coalesce(excluded.url, url),
       final_url = coalesce(excluded.final_url, final_url),
       board = coalesce(excluded.board, board),
       company = coalesce(excluded.company, company),
       position = coalesce(excluded.position, position),
       location = coalesce(excluded.location, location),
       work_mode = coalesce(excluded.work_mode, work_mode),
       seniority = coalesce(excluded.seniority, seniority),
       contract_type = coalesce(excluded.contract_type, contract_type),
       salary = coalesce(excluded.salary, salary),
       salary_min = coalesce(excluded.salary_min, salary_min),
       salary_max = coalesce(excluded.salary_max, salary_max),
       salary_currency = coalesce(excluded.salary_currency, salary_currency),
       salary_period = coalesce(excluded.salary_period, salary_period),
       skills = coalesce(excluded.skills, skills),
       stated = coalesce(excluded.stated, stated),
       analysis = coalesce(excluded.analysis, analysis),
       run_id = coalesce(excluded.run_id, run_id),
       text = CASE WHEN length(excluded.text) > length(text)
                   THEN excluded.text ELSE text END,
       search_text = CASE WHEN length(excluded.text) > length(text)
                   THEN excluded.search_text ELSE search_text END,
       last_seen_at = excluded.last_seen_at,
       processing = excluded.processing`
  );

  const byId = db.prepare<[string]>('SELECT * FROM offers WHERE id = ?');
  const byUrl = db.prepare<[string]>('SELECT * FROM offers WHERE url = ?');
  const recent = db.prepare<[number]>(
    'SELECT * FROM offers ORDER BY last_seen_at DESC LIMIT ?'
  );
  const existing = db.prepare<[string]>('SELECT 1 FROM offers WHERE id = ?');

  const applyRating = db.prepare(
    `UPDATE offers SET
       eligibility = :eligibility, fit = :fit, completeness = :completeness,
       score_detail = :detail, rated_at = :ratedAt,
       scorer_version = :scorerVersion, cv_fingerprint = :cvFingerprint,
       prefs_fingerprint = :prefsFingerprint,
       processing = CASE WHEN processing = 'unreadable' THEN processing ELSE 'rated' END
     WHERE id = :id`
  );

  const applyDisposition = db.prepare<[string, string]>(
    'UPDATE offers SET disposition = ? WHERE id = ?'
  );

  // `IS NOT` rather than `<>`, because a never-rated row holds NULL in both
  // fingerprints and `NULL <> 'abc'` is NULL, which is not true, which would
  // filter out exactly the offers that most need a score.
  // `rated_at IS NOT NULL` in the WHERE and not a `processing = 'rated'` test:
  // the two agree, and this one is the column the index is built on. An offer
  // that was rated and later found unreadable keeps its score and its staleness
  // — `processing` moved on, the numbers did not.
  const stale = db.prepare<[string, string, string, number]>(
    `SELECT * FROM offers
      WHERE rated_at IS NOT NULL
        AND (scorer_version IS NOT ? OR cv_fingerprint IS NOT ? OR prefs_fingerprint IS NOT ?)
      ORDER BY rated_at ASC
      LIMIT ?`
  );

  const everyRated = db.prepare<[number]>(
    `SELECT * FROM offers WHERE rated_at IS NOT NULL ORDER BY rated_at ASC LIMIT ?`
  );

  const ratedCount = db.prepare(`SELECT count(*) AS n FROM offers WHERE rated_at IS NOT NULL`);

  const identity = db.prepare<[string, number]>(
    `SELECT o.* FROM offers_fts
       JOIN offers o ON o.rowid = offers_fts.rowid
      WHERE offers_fts MATCH ?
      ORDER BY bm25(offers_fts)
      LIMIT ?`
  );

  const search = db.prepare<[string, number]>(
    `SELECT o.* FROM offers_fts
       JOIN offers o ON o.rowid = offers_fts.rowid
      WHERE offers_fts MATCH ?
      ORDER BY bm25(offers_fts)
      LIMIT ?`
  );

  /** Folded, quoted terms — the only form the FTS query ever takes. */
  const terms = (text: string): string[] =>
    foldForSearch(text)
      .split(/\s+/u)
      .map((token) => token.replace(/["]/gu, ''))
      .filter((token) => token.length > 0)
      .map((token) => `"${token}"`);

  const sightAll = db.transaction(
    (sightings: readonly OfferSighting[], at: number): SightingResult[] =>
      sightings.map((offer) => {
        const isNew = existing.get(offer.id) === undefined;
        const text = offer.text ?? '';
        sightOne.run({
          ...factsOf(offer),
          text,
          searchText: foldForSearch(text),
          at,
          processing: offer.processing ?? 'candidate'
        });
        return { id: offer.id, isNew };
      })
  ).immediate;

  return {
    get(id) {
      const row = byId.get(id) as OfferRow | undefined;
      return row ? toOffer(row) : undefined;
    },

    byUrl(url) {
      const row = byUrl.get(url) as OfferRow | undefined;
      return row ? toOffer(row) : undefined;
    },

    recent(limit) {
      return (recent.all(limit) as OfferRow[]).map(toOffer);
    },

    save(offer) {
      upsert.run({
        ...factsOf(offer),
        text: offer.text,
        searchText: foldForSearch(offer.text),
        firstSeenAt: offer.firstSeenAt,
        lastSeenAt: offer.lastSeenAt,
        processing: offer.processing,
        disposition: offer.disposition
      });
      return offer;
    },

    search(text, limit) {
      const match = terms(text).join(' OR ');
      if (match.length === 0) return [];
      return (search.all(match, limit) as OfferRow[]).map(toOffer);
    },

    sight(sightings, at) {
      if (sightings.length === 0) return [];
      return sightAll(sightings, at);
    },

    rate(id, rating) {
      applyRating.run({
        id,
        eligibility: rating.eligibility,
        fit: rating.fit,
        completeness: rating.completeness,
        detail: packJson(rating.detail),
        ratedAt: rating.ratedAt,
        scorerVersion: rating.scorerVersion,
        cvFingerprint: rating.cvFingerprint,
        prefsFingerprint: rating.prefsFingerprint
      });
    },

    setDisposition(id, disposition) {
      applyDisposition.run(disposition, id);
    },

    staleRatings(limit, staleAgainst) {
      const rows = staleAgainst
        ? stale.all(
            staleAgainst.scorerVersion,
            staleAgainst.cvFingerprint,
            staleAgainst.prefsFingerprint,
            limit
          )
        : everyRated.all(limit);
      return (rows as OfferRow[]).map(toOffer);
    },

    countRated() {
      return (ratedCount.get() as { n: number }).n;
    },

    byIdentity(company, position) {
      // Both halves are required, and an empty half means "no such offer"
      // rather than "every offer": a blank company matching everything is how
      // a deduplicator silently collapses an entire board into one row.
      const left = terms(company).map((t) => `company : ${t}`);
      const right = terms(position).map((t) => `position : ${t}`);
      if (left.length === 0 || right.length === 0) return [];
      const match = `(${left.join(' AND ')}) AND (${right.join(' AND ')})`;
      return (identity.all(match, 20) as OfferRow[]).map(toOffer);
    }
  };
};
