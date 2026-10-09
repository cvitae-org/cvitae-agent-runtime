import type { FieldEvidence } from './field-evidence.js';
import type { PublishedSalary } from './published-salary.js';
/**
 * The offer vocabulary: the words two modules have to agree on to talk about a
 * job posting at all.
 *
 * This file exists to break a cycle rather than to hold logic. In the previous
 * runtime `workModes` was declared inside the offer-analysis capability and
 * imported back by the scraper's fact merger, so the capability and the effect
 * each depended on the other and neither could be read on its own.
 *
 * The split that fixes it is worth stating, because the same question comes up
 * for every capability added later. A shared *enum* is vocabulary: `'hybrid'`
 * means the same thing to the scraper, the model and the database, and nobody
 * owns it. A shared *rule* — that a board's stated salary beats a model's
 * inference, that `employmentType` is a different axis from the Polish form of
 * employment — is domain judgment, and domain judgment has exactly one home in
 * `capabilities/`. So the names live here and the decisions live there.
 */

/**
 * Where the work happens.
 *
 * `'unknown'` is a value, not a gap. Boards routinely omit this, and a model
 * asked to choose between three modes on silent evidence will pick one. Making
 * "the offer did not say" expressible is what stops a guess being recorded as
 * a fact.
 */
export const workModes = ['remote', 'hybrid', 'onsite', 'unknown'] as const;

export type WorkMode = (typeof workModes)[number];

export const isWorkMode = (value: unknown): value is WorkMode =>
  typeof value === 'string' && (workModes as readonly string[]).includes(value);

/**
 * What a job board published as structured data, as opposed to what a model
 * read out of the prose.
 *
 * Deliberately loose. These come off pages written by strangers: `work_mode` is
 * a `string` and not a `WorkMode` because a board is free to emit anything, and
 * narrowing happens at the point of use with `isWorkMode`. A type that promised
 * more than the source can deliver would just move the lie earlier.
 */
export type StatedFacts = {
  readonly extractor_version?: string;
  readonly field_evidence?: Record<string, FieldEvidence>;
  readonly requisition_id?: string;
  readonly requisition_issuer?: string;
  readonly apply_url?: string;
  readonly client_name?: string;
  readonly contract_type?: string;
  readonly employment_type?: string;
  readonly company_type?: string;
  readonly company_size?: string;
  readonly engagement_length?: string;
  readonly posted_at?: string;
  readonly valid_through?: string;
  readonly salary_ranges?: readonly PublishedSalary[];
  readonly company?: string;
  readonly title?: string;
  readonly location?: string;
  readonly work_mode?: string;
  readonly salary?: string;
  readonly seniority?: string;
  readonly start_date?: string;
  readonly required_skills?: readonly string[];
};

/**
 * Where the board says an application goes.
 *
 * Kept apart from `StatedFacts` because it answers a different question and
 * has a different consumer. `StatedFacts` is what the board says about the
 * *job*, and it exists so a stated salary can beat a model's reading of the
 * same page. These three are what the board says about *routing*, and they are
 * read by verification, which has no interest in the salary and every interest
 * in an address that arrived attached to the posting rather than scraped out
 * of its prose.
 *
 * They are still a board's word, not the employer's. What makes them worth
 * more than an address found on a page is provenance, not certainty.
 */
export type StatedRoutes = {
  /** The employer's own site, as published in the posting's schema.org markup. */
  readonly companyUrl?: string;
  /** The address the board states applications go to. Rare, and the best one. */
  readonly applicationEmail?: string;
  /** A form or ATS link the board states. The right answer when there is no email. */
  readonly applyUrl?: string;
};

/**
 * The fields a board is allowed to speak to.
 *
 * Naming the set here — rather than deriving it from whatever the analysis
 * schema happens to contain — is what keeps "the board wins" from silently
 * widening when a capability grows a field.
 */
export type StatedKey =
  | 'contract_type' | 'company_type' | 'company_size' | 'engagement_length'
  | 'company'
  | 'position'
  | 'salary'
  | 'seniority'
  | 'start_date'
  | 'location'
  | 'work_mode'
  | 'required_skills';

/* ------------------------------------------------------------- discovery -- */

/**
 * How far the machinery got with an offer.
 *
 * Written by discovery and enrichment, never by a person. It is deliberately
 * not a judgment about the offer — `'rated'` says a score exists, not that it
 * was good — because the two questions have different owners and different
 * lifetimes.
 *
 * Two of the four have no writer left. `'rated'` and `'unreadable'` were
 * written by the search round and its scorer, which nothing reached and which
 * were removed. They stay because the column's CHECK and the rows already
 * stored allow them, and enrichment keeps a `'rated'` it finds.
 */
export const processingStates = ['candidate', 'fetched', 'rated', 'unreadable'] as const;

export type ProcessingState = (typeof processingStates)[number];

/**
 * What a person decided about an offer.
 *
 * Kept apart from `ProcessingState` because a machine writes one and a human
 * writes the other, and conflating them is how a re-scrape silently un-dismisses
 * something. `'expired'` is the exception, set when a re-fetch 404s.
 *
 * Nothing here is a delete. An offer that was applied to is a record of an
 * application, and the day it stops being retrievable is the day the user
 * cannot answer "what did I send them, and when?".
 */
export const dispositions = ['active', 'dismissed', 'applied', 'expired'] as const;

export type Disposition = (typeof dispositions)[number];

/**
 * Whether the offer clears the user's requirements.
 *
 * Three outcomes and not two. `'provisional'` — nothing failed, but something
 * could not be decided — is the state that stops silence being read as
 * agreement. A posting that never mentions salary is not thereby paying enough,
 * and a scorer that has to answer yes or no will say one of those two things
 * about it.
 */
export const eligibilities = ['unrated', 'eligible', 'provisional', 'ineligible'] as const;

export type Eligibility = (typeof eligibilities)[number];

/**
 * The basis a salary is quoted on.
 *
 * Not optional, and not a detail. In the market this runtime targets, `20000
 * PLN` is a normal monthly permanent salary and an absurd annual one, and a B2B
 * rate is often quoted per day. Storing the number without the period makes a
 * salary floor a coin flip.
 *
 * `''` is "the posting did not say", which is different from every other member
 * and must stay expressible for the same reason `'unknown'` is a `WorkMode`.
 */
export const salaryPeriods = ['', 'hour', 'day', 'month', 'year'] as const;

export type SalaryPeriod = (typeof salaryPeriods)[number];

/**
 * A salary as a machine can compare it, parsed once at write time.
 *
 * `null` is unstated, and unstated is not zero. The raw string the posting
 * printed is kept beside this on the record, because a range parsed wrong is
 * only discoverable against what it was parsed from.
 */
export type SalaryReading = {
  readonly min: number | null;
  readonly max: number | null;
  readonly currency: string;
  readonly period: SalaryPeriod;
};

/**
 * The outcome of scoring one offer against one CV and one set of criteria.
 *
 * Read back from the offer's columns, and written by nothing: the scorer and
 * the rescore that wrote it were never reached and were removed, along with
 * `OfferStore.rate`. The type stays because the columns do and the studio
 * reads `rating` off an offer.
 *
 * The two fingerprints are what made "which offers need rescoring?" an
 * equality check rather than a rescan. A rating is only meaningful relative to
 * its inputs, so the inputs are stored with it.
 *
 * `fit` and `completeness` are separate numbers on purpose. `fit` is match
 * quality over *decided* facts — matched / (matched + unmet), with unknowns
 * excluded from the denominator rather than counted as misses. `completeness`
 * is how much of the offer was extracted and verified at all. Folding them into
 * one score makes a posting that states a single requirement read as a perfect
 * match, which is exactly backwards.
 */
export type OfferRating = {
  readonly eligibility: Eligibility;
  readonly fit: number | null;
  readonly completeness: number | null;
  /**
   * The per-requirement verdicts behind the two numbers.
   *
   * Never indexed and never filtered on: the only question it answers — "why is
   * this provisional?" — is asked about one offer at a time. Without it the
   * tri-state is unexplainable, which would defeat the point of having it.
   */
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly ratedAt: number;
  /** The scoring rules. Bumped when they change, so old scores are recognisable. */
  readonly scorerVersion: string;
  readonly cvFingerprint: string;
  readonly prefsFingerprint: string;
};

/** An offer as it is stored: canonical text plus whatever the board stated. */
export type OfferRecord = {
  readonly id: string;
  readonly url?: string;
  readonly finalUrl?: string;
  readonly board?: string;
  readonly company?: string;
  readonly position?: string;
  readonly location?: string;
  readonly workMode?: WorkMode;
  readonly seniority?: string;
  readonly contractType?: string;
  /** The salary exactly as the posting stated it, for display and for checking. */
  readonly salary?: string;
  readonly salaryReading?: SalaryReading;
  readonly skills?: readonly string[];
  readonly text: string;
  readonly stated?: StatedFacts;
  readonly analysis?: Readonly<Record<string, unknown>>;
  readonly runId?: string;
  /**
   * Two timestamps, because one could not answer the question a standing search
   * asks. A single `importedAt` restamped on every upsert made an offer seen
   * daily for a month look new every morning; never restamping it — which is
   * what the upsert did instead — made "is this still posted?" unanswerable.
   */
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly processing: ProcessingState;
  readonly disposition: Disposition;
  readonly rating?: OfferRating;
};

/**
 * An offer as discovery has just seen it: enough to recognise, not necessarily
 * enough to store.
 *
 * A sighting carries no timestamps and no state. Which of those to write is the
 * store's decision, and it is the whole reason `sight` exists as an operation
 * rather than as a `save` the caller prepares — a caller that computed
 * `firstSeenAt` itself would have to read the row first, and two callers doing
 * that concurrently is precisely the lost update the JSONL store used to have.
 */
export type OfferSighting = Omit<
  OfferRecord,
  'firstSeenAt' | 'lastSeenAt' | 'processing' | 'disposition' | 'rating' | 'text'
> & {
  readonly text?: string;
  readonly processing?: ProcessingState;
};

/** What `sight` did, per offer, so the caller can report it without re-reading. */
export type SightingResult = {
  readonly id: string;
  /** First time this machine has seen it. The only offers worth announcing. */
  readonly isNew: boolean;
};

/**
 * Where offers are kept.
 *
 * Declared here for the same reason as every other port: a capability reaching
 * storage does so through a signature it can see, and `capabilities/` is barred
 * from importing `storage/` at all. An interface declared inside the adapter
 * would make the one implementation the definition, and a second one — a
 * caller's own store, a fake in a test — would have to import the SQLite module
 * to find out what it owed.
 *
 * `search` takes text rather than a predicate. A filter expressed as a string a
 * caller composes is a query language, and the moment a model can influence one
 * the shape of the query is in its hands.
 */
export interface OfferStore {
  get(id: string): OfferRecord | undefined;
  byUrl(url: string): OfferRecord | undefined;
  recent(limit: number): OfferRecord[];
  /** Insert or replace by id. Returns what was stored. */
  save(offer: OfferRecord): OfferRecord;
  search(text: string, limit: number): OfferRecord[];

  /**
   * Record a batch of offers a discovery search just saw, in one transaction.
   *
   * Preserves `firstSeenAt` and every disposition a person set, advances
   * `lastSeenAt`, and reports which were new. Batched rather than per-offer
   * because a search sights tens of offers at once and each one is a read and a
   * write that must not interleave with another search's.
   */
  sight(sightings: readonly OfferSighting[], at: number): SightingResult[];

  /** Record what a person decided. The one write a machine never makes. */
  setDisposition(id: string, disposition: Disposition): void;

  /**
   * Offers matching a company and position, for recognising the same job posted
   * twice under two URLs. Folded and diacritic-insensitive, like `search`.
   */
  byIdentity(company: string, position: string): OfferRecord[];
}

/**
 * A look at the saved offers, for a message that asks which of some offers fit a
 * CV. Read-only: nothing here can change an offer, a board or a selection.
 *
 * Present on a run that is about a CV of the person's own and whose runtime keeps
 * offers. An offer is never read for a wall: the caller asks only for the ids that
 * no exclusion covers.
 */
export interface OfferShelf {
  /** The saved offers of these ids as they are now. An id nothing carries is left out. */
  read(ids: readonly string[]): readonly OfferRecord[];
  /** Which of these ids are on the Board now (an archived entry is not). */
  onBoard(ids: readonly string[]): ReadonlySet<string>;
}
