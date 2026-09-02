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
  | 'company'
  | 'position'
  | 'salary'
  | 'seniority'
  | 'start_date'
  | 'location'
  | 'work_mode'
  | 'required_skills';

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
  readonly text: string;
  readonly stated?: StatedFacts;
  readonly analysis?: Readonly<Record<string, unknown>>;
  readonly runId?: string;
  readonly importedAt: number;
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
}
