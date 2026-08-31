/**
 * One complete pass of offer discovery: search, dedupe, read, verify, score.
 *
 * A round is the smallest unit of work that leaves the store in a state worth
 * keeping. It searches, removes what it has seen before, reads what looks worth
 * reading, grounds every extracted fact in the posting it came from, scores
 * against `preferences.json`, and persists — all of it, or it reports what it
 * could not do. Nothing is buffered for a later round to finish.
 *
 * That is the whole reason the round exists as a thing rather than as a loop
 * body. How many rounds to run is an orchestration choice: an interactive
 * search runs several, a nightly job runs one, and both use exactly this. A
 * crash costs the unfinished round and nothing else, and a round that runs
 * again tomorrow recognises everything it saw today.
 *
 * ## Three dedupes, cheapest first
 *
 * URL first, in `identity.ts`, because it costs nothing and runs before the
 * fetch. Then the record on file, which decides whether an offer is fetched
 * again at all. Identity last — the same job syndicated to three boards under
 * one company and title — because it needs a company name, which a URL does not
 * carry, so it can only run once something has been read.
 *
 * The third one is *reported* and not acted on. Collapsing two records into one
 * would need a column saying which absorbed which, and inventing that column to
 * make a round tidier is the wrong order to do it in: the report names the
 * collision, the user decides, and `disposition` already exists for saying so.
 *
 * ## The trust boundary, in order
 *
 * Search hits are pointers. Their titles and snippets order the fetch queue and
 * are never written to a record: they are page-authored text, and a candidate
 * row carrying an unread posting's own description of itself would be a claim
 * nothing checked. The posting is then read, extracted by a model, and every
 * extracted fact that could move a verdict is looked for in the raw text before
 * it is stored — see `verify.ts`. Only then does deterministic code score it.
 *
 * The model sits in the middle of that sequence and touches nothing on either
 * side of it. It cannot choose what is fetched, and it cannot choose what the
 * score is.
 *
 * ## What the round will not do
 *
 * It never writes `disposition`. That column belongs to the user, and a round
 * that re-saw a dismissed offer must be able to record having seen it without
 * un-dismissing it. The one exception the design allows — marking a 404 as
 * `expired` — is not implemented here, because this round only reads postings
 * it has not read before; re-checking live offers is a different job.
 */

import type { Store } from '../store/store.js';
import type { CvDocument } from '../store/cvDocument.js';
import type { Preferences } from '../store/preferences.js';
import { fingerprintPreferences } from '../store/preferences.js';
import { fingerprintValue } from '../core/fingerprint.js';
import type { OfferRecord, OfferSighting } from '../store/offerRecord.js';
import { searchWeb, type SearchHit } from './webSearch.js';
import { resolveOffer } from './resolve.js';
import type { StatedFacts } from './boardFacts.js';
import { normaliseUrl, offerId } from './identity.js';
import { buildQueries, queriesForRound } from './queries.js';
import { verifyFacts, type OfferClaims } from './verify.js';
import { evaluate, SCORER_VERSION } from './criteria.js';

/**
 * Reading a posting into structured claims.
 *
 * A function rather than the runtime itself, so that this module does not
 * import the thing that imports it — and so the round can be exercised end to
 * end against a stub, which is what makes its dedupe, verification and scoring
 * testable without a model.
 */
export type OfferAnalyser = (input: {
  offerText: string;
  url: string;
  boardFacts?: StatedFacts;
  signal?: AbortSignal;
}) => Promise<Record<string, unknown>>;

export type RoundOptions = {
  store: Store;
  cv: CvDocument;
  preferences: Preferences;
  analyse: OfferAnalyser;
  /** Which slice of the derived query list to run. 1-based. */
  round?: number;
  queriesPerRound?: number;
  /** Results asked of the engine, per query. */
  searchLimit?: number;
  /** How many postings this round will actually read. The round's real cost. */
  fetchLimit?: number;
  /** Overrides the derived queries entirely, for a search the user typed. */
  queries?: string[];
  signal?: AbortSignal;
  search?: typeof searchWeb;
  resolve?: typeof resolveOffer;
};

export type RoundReport = {
  round: number;
  queries: string[];
  /** Search results, before any dedupe. */
  hits: number;
  /** Distinct offer URLs this round had not seen before. */
  discovered: number;
  fetched: number;
  rated: number;
  unreadable: number;
  added: number;
  updated: number;
  /**
   * The engine returned offers and every one of them was already on file. The
   * signal to stop, and cheap to act on: a saturated round has already paid for
   * its searches and skipped the fetches, which are the expensive half.
   *
   * Requires `hits > 0`. A round that got no results at all has not established
   * that there is nothing left to find — it has established that this engine
   * answered with nothing, which the keyless search path does routinely when it
   * is soft-blocked. Reading that as saturation would stop the loop on round
   * one and report the run as complete.
   */
  saturated: boolean;
  /** Queries the engine refused or could not answer. Not the same as finding nothing. */
  searchFailures: string[];
  /**
   * Offers this round stored that share a company and title with one already on
   * file. Reported, never merged — see the note above.
   */
  duplicates: { id: string; of: string }[];
  scored: {
    id: string;
    url: string;
    title: string;
    company: string;
    eligibility: OfferRecord['eligibility'];
    fit: number | null;
    completeness: number | null;
    unverified: string[];
  }[];
};

/** The spellings the analysis uses for "the offer did not say". */
const isAbsent = (value: unknown): boolean =>
  typeof value !== 'string' ||
  value.trim() === '' ||
  value === 'Not stated' ||
  value === 'Unknown';

const stringOf = (value: unknown): string | undefined =>
  isAbsent(value) ? undefined : String(value).trim();

/** Maps the analysis record onto the fields the record and the criteria use. */
const claimsFrom = (analysis: Record<string, unknown>): OfferClaims => ({
  title: stringOf(analysis.position),
  company: stringOf(analysis.company),
  location: stringOf(analysis.location),
  work_mode: stringOf(analysis.work_mode),
  seniority: stringOf(analysis.seniority),
  contract_type: stringOf(analysis.contract_type),
  salary: stringOf(analysis.salary),
  skills: Array.isArray(analysis.required_skills)
    ? analysis.required_skills.map(String).filter((skill) => skill.trim() !== '')
    : undefined
});

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * How interesting a search hit looks before anything is fetched.
 *
 * Ordering only — this decides what the round spends its fetch budget on, never
 * what an offer scores. That separation is why it is allowed to read the hit's
 * own title and snippet at all: page-authored text choosing its own place in a
 * queue is a nuisance at worst, and the same text choosing its own rating would
 * be the injection this design exists to prevent.
 */
const rank = (hit: SearchHit, cv: CvDocument, preferences: Preferences): number => {
  const haystack = `${hit.title} ${hit.snippet}`.toLowerCase();
  let score = 0;

  for (const skill of preferences.skills.require) {
    if (skill.trim() && haystack.includes(skill.toLowerCase())) score += 3;
  }

  for (const skill of [...cv.skills.frameworks, ...cv.skills.programming_languages]) {
    if (skill.trim() && haystack.includes(skill.toLowerCase())) score += 1;
  }

  const role = cv.skills.role.toLowerCase();
  if (role && hit.title.toLowerCase().includes(role)) score += 3;

  for (const mode of preferences.work_mode.accept) {
    if (haystack.includes(mode)) score += 2;
  }

  // A posting on a board is more likely to be a posting than a listing page,
  // an aggregator, or somebody's blog about the role.
  if (/justjoin|nofluffjobs|pracuj|rocketjobs|bulldogjob|theprotocol|indeed|linkedin/.test(hostOf(hit.url))) {
    score += 2;
  }

  return score;
};

/**
 * Whether this round should spend a fetch on an offer it already has a row for.
 *
 * A rated offer is not read again: its text is on file, and re-reading a
 * posting to arrive at the same score is the most expensive way to do nothing.
 * An unreadable one is not retried either — that state exists precisely so a
 * board that blocks us is not retried daily forever. And anything the user has
 * acted on is left alone, because re-reading a dismissed offer to re-rank it is
 * work done against their decision.
 */
const worthFetching = (record: OfferRecord | undefined): boolean => {
  if (!record) return true;
  if (record.disposition !== 'active') return false;
  return record.processing === 'candidate';
};

/**
 * Runs one round.
 *
 * Never throws for an offer-shaped reason. A refused search, an unreadable
 * board and a model that fails on one posting are all ordinary outcomes that
 * the report names, because nineteen offers and one failure is a good round and
 * discarding the nineteen would be the wrong trade — the same argument
 * `runBatch` makes about a batch.
 */
export const runRound = async (options: RoundOptions): Promise<RoundReport> => {
  const {
    store,
    cv,
    preferences,
    analyse,
    round = 1,
    queriesPerRound = 4,
    searchLimit = 10,
    fetchLimit = 5,
    signal,
    search = searchWeb,
    resolve = resolveOffer
  } = options;

  const queries =
    options.queries ??
    queriesForRound(buildQueries(cv, preferences), round, queriesPerRound);

  /* ------------------------------------------------------------ search -- */

  const searchFailures: string[] = [];
  const byUrl = new Map<string, SearchHit>();
  let hits = 0;

  for (const query of queries) {
    const outcome = await search(query, { limit: searchLimit, signal });

    if (outcome.status === 'unavailable') {
      // Nothing is configured to search with, so every remaining query would
      // fail the same way. Reported per query rather than once, because the
      // report's job is to say what did not happen, and "three of four queries
      // are missing" is the thing a caller would otherwise have to infer.
      for (const remaining of queries.slice(queries.indexOf(query))) {
        searchFailures.push(`${remaining}: ${outcome.detail}`);
      }
      break;
    }

    if (outcome.status !== 'ok') {
      searchFailures.push(`${query}: ${outcome.detail}`);
      continue;
    }

    hits += outcome.hits.length;

    for (const hit of outcome.hits) {
      const url = normaliseUrl(hit.url);
      // The first dedupe. Two queries returning the same posting is the normal
      // case, not the exception — that is what makes it worth doing before
      // anything else.
      if (url && !byUrl.has(url)) byUrl.set(url, { ...hit, url });
    }
  }

  /* ------------------------------------------------------------ triage -- */

  const known = new Map((await store.offerRecords.all()).map((record) => [record.id, record]));

  const candidates = [...byUrl.values()]
    .map((hit) => ({ hit, id: offerId(hit.url), record: known.get(offerId(hit.url)) }))
    .filter((candidate) => candidate.id !== '');

  const discovered = candidates.filter((candidate) => !candidate.record).length;

  const fetchable = candidates
    .filter((candidate) => worthFetching(candidate.record))
    .sort((left, right) => rank(right.hit, cv, preferences) - rank(left.hit, cv, preferences));

  const reading = fetchable.slice(0, fetchLimit);
  const readingIds = new Set(reading.map((candidate) => candidate.id));

  // Everything else is still recorded. A candidate row costs a line in a text
  // file and is what lets the next round pick up where this one stopped —
  // without it, an offer below the fetch cut would be rediscovered and
  // re-ranked from scratch every round, forever.
  const sightings: OfferSighting[] = candidates
    .filter((candidate) => !readingIds.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      url: candidate.hit.url,
      board: hostOf(candidate.hit.url)
    }));

  /* ------------------------------------------------- read, verify, store -- */

  const unverifiedBy = new Map<string, string[]>();
  let unreadable = 0;
  let rated = 0;

  for (const candidate of reading) {
    signal?.throwIfAborted();

    const outcome = await resolve(candidate.hit.url, signal);

    if (outcome.status !== 'ok') {
      unreadable++;
      sightings.push({
        id: candidate.id,
        url: candidate.hit.url,
        board: hostOf(candidate.hit.url),
        processing: 'unreadable'
      });
      continue;
    }

    let analysis: Record<string, unknown>;

    try {
      analysis = await analyse({
        offerText: outcome.text,
        url: outcome.finalUrl,
        boardFacts: outcome.board,
        signal
      });
    } catch {
      // The posting was read; only the extraction failed. `fetched` says so,
      // and the next round will find it worth another attempt.
      sightings.push({
        id: candidate.id,
        url: outcome.finalUrl,
        board: hostOf(outcome.finalUrl),
        text: outcome.text,
        processing: 'fetched'
      });
      continue;
    }

    // The boundary. Everything above this line came from the posting or from a
    // model reading it; nothing below may use a fact that is not in the text.
    const { facts, unverified } = verifyFacts(claimsFrom(analysis), outcome.text);

    unverifiedBy.set(candidate.id, unverified);
    rated++;

    sightings.push({
      id: candidate.id,
      url: outcome.finalUrl,
      board: hostOf(outcome.finalUrl),
      text: outcome.text,
      analysis,
      ...facts,
      processing: 'rated'
    });
  }

  const stored = await store.saveOffers(sightings);

  /* ------------------------------------------------------------- score -- */

  // Scored from the merged records rather than from the sightings, because a
  // sighting is partial: an offer this round only re-saw still carries what an
  // earlier round extracted, and rating the fragment would throw that away.
  const cvFingerprint = fingerprintValue({ ...cv, updated_at: '' });
  const prefsFingerprint = fingerprintPreferences(preferences);
  const ratedAt = new Date().toISOString();

  const ratings: OfferSighting[] = stored.records
    .filter((record) => record.processing === 'rated')
    .map((record) => {
      const evaluation = evaluate(record, preferences);

      return {
        id: record.id,
        eligibility: evaluation.eligibility,
        fit: evaluation.fit,
        completeness: evaluation.completeness,
        score_detail: {
          ...evaluation.detail,
          unverified: unverifiedBy.get(record.id) ?? []
        },
        rated_at: ratedAt,
        scorer_version: SCORER_VERSION,
        cv_fingerprint: cvFingerprint,
        prefs_fingerprint: prefsFingerprint
      };
    });

  const scoredRecords = ratings.length > 0 ? (await store.saveOffers(ratings)).records : [];

  /* --------------------------------------------------------- duplicates -- */

  // Computed over one read of the file rather than a lookup per offer, which is
  // the same answer for a fraction of the reads.
  const identity = (record: OfferRecord): string =>
    `${record.company.trim().toLowerCase()}\u0000${record.title.trim().toLowerCase()}`;

  const byIdentity = new Map<string, string>();
  const duplicates: RoundReport['duplicates'] = [];

  for (const record of await store.offerRecords.all()) {
    if (!record.company.trim() || !record.title.trim()) continue;

    const key = identity(record);
    const first = byIdentity.get(key);

    // File order is arrival order, so the earlier record is the original and
    // this one is the repost — which is the direction a caller would expect.
    if (first === undefined) byIdentity.set(key, record.id);
    else if (scoredRecords.some((scored) => scored.id === record.id)) {
      duplicates.push({ id: record.id, of: first });
    }
  }

  return {
    round,
    queries,
    hits,
    discovered,
    fetched: reading.length,
    rated,
    unreadable,
    added: stored.added,
    updated: stored.updated,
    saturated: hits > 0 && discovered === 0,
    searchFailures,
    duplicates,
    scored: scoredRecords.map((record) => ({
      id: record.id,
      url: record.url,
      title: record.title,
      company: record.company,
      eligibility: record.eligibility,
      fit: record.fit,
      completeness: record.completeness,
      unverified: unverifiedBy.get(record.id) ?? []
    }))
  };
};

/**
 * Runs rounds until they stop finding anything, or until `rounds` is spent.
 *
 * The loop is deliberately thin, because the round is where the work and the
 * guarantees are. Stopping on saturation is what makes "run ten rounds" a safe
 * thing to ask for: the tenth costs nothing if the third had already exhausted
 * the queries this CV implies.
 */
export const runRounds = async (
  options: RoundOptions & { rounds?: number }
): Promise<RoundReport[]> => {
  const { rounds = 1, ...rest } = options;
  const reports: RoundReport[] = [];

  for (let index = 0; index < Math.max(rounds, 1); index++) {
    const report = await runRound({ ...rest, round: (rest.round ?? 1) + index });
    reports.push(report);

    if (report.saturated) break;

    // Not saturation — the opposite. Nothing was searched, so nothing can be
    // concluded about whether more offers exist, and another round would fail
    // identically. Stopping here is what turns a missing search key into one
    // report the caller can read rather than ten copies of it.
    if (report.queries.length > 0 && report.searchFailures.length === report.queries.length) break;
  }

  return reports;
};
