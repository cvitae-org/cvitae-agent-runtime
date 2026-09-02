/**
 * One complete pass of offer discovery: search, dedupe, read, verify, score.
 *
 * A round is the smallest unit of work that leaves the store in a state worth
 * keeping. It searches, removes what it has seen before, reads what looks worth
 * reading, grounds every extracted fact in the posting it came from, scores
 * against the user's preferences, and persists — all of it, or it reports what
 * it could not do. Nothing is buffered for a later round to finish.
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
 * un-dismissing it. `OfferStore.sight` enforces that in SQL, so this module
 * cannot get it wrong even by accident. The one exception the design allows —
 * marking a 404 as `expired` — is not implemented here, because this round only
 * reads postings it has not read before; re-checking live offers is a different
 * job.
 *
 * ## Why it takes ports rather than an `EffectSet`
 *
 * A round needs to read offers and to search, and nothing else in the set. It
 * asks for those two by name so that a caller can see, from the call site, that
 * a discovery round cannot send mail or write a document — and so the whole
 * thing runs against two small stubs in a test with no network and no model.
 */

import type {
  EffectCall,
  OfferReader,
  OfferRecord,
  OfferSighting,
  OfferStore,
  SalaryReading,
  SearchHit,
  StatedFacts,
  WebSearch
} from '../../contracts/index.js';
import { isWorkMode } from '../../contracts/index.js';
import { fingerprintCv } from '../cv/document.js';
import type { CvDocument } from '../cv/document.js';
import { boardFor, hostOf, isFetchable } from './boards.js';
import { evaluate, SCORER_VERSION } from './criteria.js';
import { normaliseUrl, offerId } from './identity.js';
import { fingerprintPreferences } from './preferences.js';
import type { Preferences } from './preferences.js';
import { buildQueries, queriesForRound } from './queries.js';
import { parseSalary } from './salary.js';
import { verifyFacts, type OfferClaims } from './verify.js';

/**
 * Reading a posting into structured claims.
 *
 * A function rather than the runtime itself, so that this module does not
 * import the thing that imports it — the boundary rules forbid it, and the
 * reason they forbid it is this: the round can then be exercised end to end
 * against a stub, which is what makes its dedupe, verification and scoring
 * testable without a model.
 */
export type OfferAnalyser = (input: {
  readonly offerText: string;
  readonly url: string;
  readonly stated?: StatedFacts;
  readonly signal?: AbortSignal;
}) => Promise<Record<string, unknown>>;

/**
 * What a round accepts as an answer to "what offers exist for this term".
 *
 * Narrower than `SearchOutcome` on purpose: a round has no use for which engine
 * answered, and naming one would tie the seam to the open web. `fromWebSearch`
 * satisfies this, and so does `boardSearch`, which asks the companion scraper
 * instead and touches no third party at all.
 */
export type DiscoveryOutcome =
  | { readonly status: 'ok'; readonly hits: readonly SearchHit[] }
  /** Nothing is configured or running to search with. Says nothing about the market. */
  | { readonly status: 'unavailable'; readonly detail: string }
  /** It was asked and could not answer. */
  | { readonly status: 'failed'; readonly detail: string };

export type DiscoverySource = (
  query: string,
  options: { readonly limit: number; readonly call: EffectCall }
) => Promise<DiscoveryOutcome>;

/** The open web as a discovery source. Drops the engine name, keeps the rest. */
export const fromWebSearch =
  (search: WebSearch): DiscoverySource =>
  async (query, { limit, call }) => {
    const outcome = await search.search(query, { ...call, limit });
    return outcome.status === 'ok'
      ? { status: 'ok', hits: outcome.hits }
      : { status: outcome.status, detail: outcome.detail };
  };

export type RoundOptions = {
  readonly store: OfferStore;
  readonly cv: CvDocument;
  readonly preferences: Preferences;
  readonly analyse: OfferAnalyser;
  /** Reads one posting. Throws `unreadable_source` when there is nothing to read. */
  readonly read: OfferReader;
  readonly search: DiscoverySource;
  readonly call: EffectCall;
  /** Which slice of the derived query list to run. 1-based. */
  readonly round?: number;
  readonly queriesPerRound?: number;
  /** Results asked of the engine, per query. */
  readonly searchLimit?: number;
  /** How many postings this round will actually read. The round's real cost. */
  readonly fetchLimit?: number;
  /**
   * Run exactly these, this round, with no slicing. For a search the user
   * typed, and for tests that want one query and one answer.
   */
  readonly queries?: readonly string[];
  /**
   * The full derived list to *slice* per round, replacing the one this module
   * would build from the CV.
   *
   * Distinct from `queries` because the slicing is the third dedupe: a caller
   * that hands over a finished slice has silently turned every round into the
   * same round. Board search needs this — its terms are slug keywords, which
   * `buildQueries` does not produce — while still wanting round *n* to search
   * something round *n-1* did not.
   */
  readonly terms?: readonly string[];
};

export type RoundReport = {
  readonly round: number;
  readonly queries: readonly string[];
  /** Search results, before any dedupe. */
  readonly hits: number;
  /** Distinct offer URLs this round had not seen before. */
  readonly discovered: number;
  /** Offers worked on this round: read from the board, or re-analysed from stored text. */
  readonly fetched: number;
  /** Of those, how many were actually requested from a board. */
  readonly requested: number;
  readonly rated: number;
  readonly unreadable: number;
  /** Candidates on a board whose terms refuse automated access. Never fetched. */
  readonly refused: number;
  readonly added: number;
  readonly updated: number;
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
  readonly saturated: boolean;
  /** Queries the engine refused or could not answer. Not the same as finding nothing. */
  readonly searchFailures: readonly string[];
  /**
   * Offers this round stored that share a company and position with one already
   * on file. Reported, never merged — see the note above.
   */
  readonly duplicates: readonly { readonly id: string; readonly of: string }[];
  readonly scored: readonly {
    readonly id: string;
    readonly url: string;
    readonly position: string;
    readonly company: string;
    readonly eligibility: string;
    readonly fit: number | null;
    readonly completeness: number | null;
    readonly unverified: readonly string[];
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
  position: stringOf(analysis.position),
  company: stringOf(analysis.company),
  location: stringOf(analysis.location),
  workMode: stringOf(analysis.work_mode),
  seniority: stringOf(analysis.seniority),
  contractType: stringOf(analysis.contract_type),
  salary: stringOf(analysis.salary),
  skills: Array.isArray(analysis.required_skills)
    ? analysis.required_skills.map(String).filter((skill) => skill.trim() !== '')
    : undefined
});

/**
 * The figures behind a salary line.
 *
 * Derived here rather than in the store, which is where it used to live and is
 * the wrong layer twice over: reading `20 000 - 25 000 PLN / mies.` is domain
 * judgment, and a store that parsed it would be a store with an opinion about
 * Polish payroll. The round is the writer of the fact, so the round derives it.
 *
 * Reused unchanged when the text has not moved. That is what lets a figure
 * stated by a board — which knows its own pay data better than a parser reading
 * its rendering of it — survive every later sighting, and expire exactly when
 * the line it described is replaced.
 */
const readingFor = (
  salary: string | undefined,
  previous: OfferRecord | undefined
): SalaryReading | undefined => {
  const text = (salary ?? '').trim();
  if (!text) return undefined;
  if (previous?.salary === text && previous.salaryReading) return previous.salaryReading;
  return parseSalary(text);
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

  // A posting on a known board is more likely to be a posting than a listing
  // page, an aggregator, or somebody's blog about the role. The list is
  // `boards.ts`; one worth searching outranks one merely recognised.
  const board = boardFor(hit.url);
  if (board) score += board.search ? 3 : 1;

  return score;
};

/**
 * What this round should do about an offer it may already have a row for.
 *
 * A rated offer is not read again: its text is on file, and re-reading a
 * posting to arrive at the same score is the most expensive way to do nothing.
 * An unreadable one is not retried either — that state exists precisely so a
 * board that blocks us is not retried daily forever. And anything the user has
 * acted on is left alone, because re-reading a dismissed offer to re-rank it is
 * work done against their decision.
 *
 * `fetched` is the interesting one, and it is why this returns a verb rather
 * than a boolean. It means the posting was read and the extraction then failed
 * — a rate-limited provider, a model that returned nothing parseable. The text
 * is already on file, so the work left is a model call and not another request
 * to the board. An earlier version treated `fetched` as finished and left those
 * offers stranded forever: read, unscored, and never looked at again. Found by
 * running a real round against a rate-limited provider, which put two offers
 * into exactly that state.
 */
type Intent = 'fetch' | 'analyse' | 'skip';

const intentFor = (record: OfferRecord | undefined): Intent => {
  if (!record) return 'fetch';
  if (record.disposition !== 'active') return 'skip';
  if (record.processing === 'candidate') return 'fetch';
  if (record.processing === 'fetched' && record.text.trim()) return 'analyse';
  return 'skip';
};

/** What an extraction claimed and could not support, from whichever round extracted. */
const auditedUnverified = (record: OfferRecord): string[] => {
  const stored = record.rating?.detail?.unverified;
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry): entry is string => typeof entry === 'string');
};

/**
 * Runs one round.
 *
 * Never throws for an offer-shaped reason. A refused search, an unreadable
 * board and a model that fails on one posting are all ordinary outcomes that
 * the report names, because nineteen offers and one failure is a good round and
 * discarding the nineteen would be the wrong trade.
 */
export const runRound = async (options: RoundOptions): Promise<RoundReport> => {
  const {
    store,
    cv,
    preferences,
    analyse,
    read,
    search,
    call,
    round = 1,
    queriesPerRound = 4,
    searchLimit = 10,
    fetchLimit = 5
  } = options;

  const { signal } = call;

  const queries =
    options.queries ??
    queriesForRound([...(options.terms ?? buildQueries(cv, preferences))], round, queriesPerRound);

  /* ------------------------------------------------------------ search -- */

  const searchFailures: string[] = [];
  const byUrl = new Map<string, SearchHit>();
  let hits = 0;

  for (const [index, query] of queries.entries()) {
    const outcome = await search(query, { limit: searchLimit, call });

    if (outcome.status === 'unavailable') {
      // Nothing is configured to search with, so every remaining query would
      // fail the same way. Reported per query rather than once, because the
      // report's job is to say what did not happen, and "three of four queries
      // are missing" is the thing a caller would otherwise have to infer.
      for (const remaining of queries.slice(index)) {
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

  // A lookup per candidate, against the primary key. The predecessor read every
  // record in the store to build a map and then used a handful of its entries.
  const candidates = [...byUrl.values()]
    .map((hit) => ({ hit, id: offerId(hit.url) }))
    .filter((candidate) => candidate.id !== '')
    .map((candidate) => ({ ...candidate, record: store.get(candidate.id) }));

  const discovered = candidates.filter((candidate) => !candidate.record).length;

  // Boards whose terms refuse automated access are recorded and never read.
  // Without this the round rediscovers them every time and spends a fetch
  // learning what `boards.ts` already knows — and the refusal is a term of use,
  // not a rate limit, so retrying is not a matter of waiting longer.
  const refused = candidates.filter((candidate) => !isFetchable(candidate.hit.url));

  const actionable = candidates
    .filter((candidate) => isFetchable(candidate.hit.url))
    .map((candidate) => ({ ...candidate, intent: intentFor(candidate.record) }))
    .filter((candidate) => candidate.intent !== 'skip')
    .sort((left, right) => {
      // Offers that only need analysing come first: the request to the board is
      // already paid for, so finishing one costs strictly less than starting a
      // new one and leaves less half-done work behind.
      if (left.intent !== right.intent) return left.intent === 'analyse' ? -1 : 1;
      return rank(right.hit, cv, preferences) - rank(left.hit, cv, preferences);
    });

  const reading = actionable.slice(0, fetchLimit);
  const readingIds = new Set(reading.map((candidate) => candidate.id));

  // Everything else is still recorded. A candidate row is one insert and is
  // what lets the next round pick up where this one stopped — without it, an
  // offer below the fetch cut would be rediscovered and re-ranked from scratch
  // every round, forever.
  const sightings: OfferSighting[] = candidates
    .filter((candidate) => !readingIds.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      url: candidate.hit.url,
      board: hostOf(candidate.hit.url),
      // Marked at the point it is known, so the state means "this will not be
      // read" rather than "this has not been read yet".
      ...(isFetchable(candidate.hit.url) ? {} : { processing: 'unreadable' as const })
    }));

  /* ------------------------------------------------- read, verify, store -- */

  const unverifiedBy = new Map<string, string[]>();
  let unreadable = 0;
  let rated = 0;
  let fetches = 0;

  for (const candidate of reading) {
    signal.throwIfAborted();

    // Text already on file, from a round whose extraction failed after the
    // fetch. Nothing is asked of the board a second time.
    const stored = candidate.intent === 'analyse' ? candidate.record : undefined;

    let text: string;
    let finalUrl: string;
    let stated: StatedFacts | undefined;

    if (stored) {
      text = stored.text;
      finalUrl = stored.finalUrl ?? stored.url ?? candidate.hit.url;
      stated = stored.stated;
    } else {
      try {
        const resolved = await read.resolve(candidate.hit.url, call);
        text = resolved.text;
        finalUrl = resolved.finalUrl;
        stated = resolved.stated;
      } catch {
        // `resolve` throws `unreadable_source` for a board that blocked us, one
        // that renders client-side, one robots.txt forbids. Nothing failed, and
        // the only way forward is for a person to paste the text.
        unreadable++;
        sightings.push({
          id: candidate.id,
          url: candidate.hit.url,
          board: hostOf(candidate.hit.url),
          processing: 'unreadable'
        });
        continue;
      }
      fetches++;
    }

    let analysis: Record<string, unknown>;

    try {
      analysis = await analyse({ offerText: text, url: finalUrl, stated, signal });
    } catch {
      // The posting was read; only the extraction failed. `fetched` says so,
      // and the next round will find it worth another attempt.
      sightings.push({
        id: candidate.id,
        url: finalUrl,
        board: hostOf(finalUrl),
        stated,
        text,
        processing: 'fetched'
      });
      continue;
    }

    // The boundary. Everything above this line came from the posting or from a
    // model reading it; nothing below may use a fact that is not in the text.
    const { facts, unverified } = verifyFacts(claimsFrom(analysis), text);

    unverifiedBy.set(candidate.id, unverified);
    rated++;

    sightings.push({
      id: candidate.id,
      url: finalUrl,
      board: hostOf(finalUrl),
      stated,
      text,
      analysis,
      position: facts.position,
      company: facts.company,
      location: facts.location,
      // Narrowed here rather than trusted. `verifyFacts` only keeps a work mode
      // it found a marker for, so in practice this always holds — but the claim
      // arrives as a model's string, and the column is an enum a consumer
      // switches on. A guard that never fires costs nothing; the absence of one
      // costs a badge that renders as nothing anybody can see is wrong.
      workMode: isWorkMode(facts.workMode) ? facts.workMode : undefined,
      seniority: facts.seniority,
      contractType: facts.contractType,
      salary: facts.salary,
      salaryReading: readingFor(facts.salary, candidate.record),
      skills: facts.skills,
      processing: 'rated'
    });
  }

  const results = store.sight(sightings, Date.now());
  const added = results.filter((result) => result.isNew).length;

  /* ------------------------------------------------------------- score -- */

  // Scored from the merged records rather than from the sightings, because a
  // sighting is partial: an offer this round only re-saw still carries what an
  // earlier round extracted, and rating the fragment would throw that away.
  const inputs = {
    scorerVersion: SCORER_VERSION,
    cvFingerprint: fingerprintCv(cv),
    prefsFingerprint: fingerprintPreferences(preferences)
  };
  const ratedAt = Date.now();

  const scored: RoundReport['scored'][number][] = [];

  for (const result of results) {
    const record = store.get(result.id);
    if (!record || record.processing !== 'rated') continue;

    const evaluation = evaluate(record, preferences);
    // Every rated record this round *touched* is re-scored, not only the ones
    // it read — which is right, because preferences may have moved — but a
    // round that merely re-saw an offer has re-checked nothing. Defaulting to
    // an empty list there erased the audit trail on the strength of not having
    // looked, and it took two rounds and a dismissed offer to notice.
    const unverified = unverifiedBy.get(record.id) ?? auditedUnverified(record);

    store.rate(record.id, {
      ...inputs,
      eligibility: evaluation.eligibility,
      fit: evaluation.fit,
      completeness: evaluation.completeness,
      detail: { ...evaluation.detail, unverified },
      ratedAt
    });

    scored.push({
      id: record.id,
      url: record.url ?? '',
      position: record.position ?? '',
      company: record.company ?? '',
      eligibility: evaluation.eligibility,
      fit: evaluation.fit,
      completeness: evaluation.completeness,
      unverified
    });
  }

  /* --------------------------------------------------------- duplicates -- */

  // One indexed lookup per scored offer, against the same full-text index
  // `search` uses. The predecessor read every record in the store and built a
  // map of every company/title pair on file to answer a question about five of
  // them.
  //
  // The index is asked a broad question and the exact answer is filtered out of
  // it: FTS matches every record containing these terms, which would call a
  // "Flutter Developer" a repost of a "Senior Flutter Developer".
  const fold = (value: string): string => value.trim().toLowerCase();
  const duplicates: { id: string; of: string }[] = [];

  for (const entry of scored) {
    if (!fold(entry.company) || !fold(entry.position)) continue;

    const original = store
      .byIdentity(entry.company, entry.position)
      .filter(
        (other) =>
          other.id !== entry.id &&
          fold(other.company ?? '') === fold(entry.company) &&
          fold(other.position ?? '') === fold(entry.position)
      )
      // Earliest first: the older record is the original and this one is the
      // repost, which is the direction a caller would expect. Ties broken by id
      // so two rows sighted in one transaction do not report each other.
      .sort((left, right) => left.firstSeenAt - right.firstSeenAt || left.id.localeCompare(right.id))
      .at(0);

    if (original) duplicates.push({ id: entry.id, of: original.id });
  }

  return {
    round,
    queries,
    hits,
    discovered,
    fetched: reading.length,
    requested: fetches,
    rated,
    unreadable: unreadable + refused.length,
    refused: refused.length,
    added,
    updated: results.length - added,
    saturated: hits > 0 && discovered === 0,
    searchFailures,
    duplicates,
    scored
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
  options: RoundOptions & { readonly rounds?: number }
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
