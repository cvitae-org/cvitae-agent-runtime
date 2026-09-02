/**
 * The authored offer record: what the runtime knows about a job posting.
 *
 * This file exists because `paths.ts` made a claim the code could not keep.
 * Everything under `lance/` was documented as rebuildable — "a schema change
 * here is `rm -rf` and re-index rather than a migration" — but the offers table
 * held `text`, the posting as it was read, for postings that get taken down
 * within weeks. That is not derived data. It cannot be rebuilt from anything,
 * because the source it would be rebuilt from is a 404 by then.
 *
 * So the offers table joins the chunk table as a genuine index, and the records
 * move here: one JSON object per line, beside `cv.json`, under the same atomic
 * write. It diffs, it greps, and a schema change to it is a reindex rather than
 * a migration — which is the property the split was supposed to buy.
 *
 * ## Two axes of state, two writers
 *
 * `processing` is how far the pipeline got. `disposition` is what the user
 * decided. Collapsing them into one `status` column looks tidier and creates a
 * race: the discovery round and the person would both write the same field,
 * and neither can safely overwrite the other. Split, each column has exactly
 * one writer — `sight()` owns `processing`, `update()` owns `disposition` — and
 * `expired` is the single crossing, written by the round when a re-fetch 404s.
 *
 * They are also genuinely independent. An offer can be dismissed on sight of
 * its title, before it was ever fetched or rated; one column could not say so.
 *
 * ## Three states, not two
 *
 * `unknown` is a first-class answer throughout. A posting that does not state a
 * salary has not failed a salary requirement, and an extracted claim that fails
 * verification against the raw text degrades to unknown rather than to a value.
 * That second case is what forces the tri-state: with only pass and fail, every
 * verification failure would read as a rejection, and the verification step
 * would quietly become a way to discard offers.
 *
 * Hence nullable numbers for the salary bounds and `''` for unstated strings,
 * rather than zeroes that would be indistinguishable from a real answer.
 */

import { z } from 'zod';
import { JsonlStore } from './jsonl.js';
import { offersPath } from './paths.js';
import { parseSalary } from '../offers/salary.js';

/** How far the round got. Written by `sight()`. */
export const processingStates = [
  'candidate',
  'fetched',
  /** Fetched and scored. Says nothing about whether the score was good. */
  'rated',
  /**
   * The source could not be read: a board that blocked us, one that renders
   * client-side, one robots.txt forbids. Distinct so the round can stop
   * retrying it daily forever — the same distinction `RuntimeError` draws with
   * `unreadable_source`.
   */
  'unreadable'
] as const;

/** What the user decided. Written by `update()`, except `expired`. */
export const dispositions = [
  'active',
  /** The state that makes a standing search bearable to live with. */
  'dismissed',
  'applied',
  /** Set when a re-fetch 404s. Never deleted — an offer you applied to is a record. */
  'expired'
] as const;

export const eligibilities = [
  'unrated',
  'eligible',
  /** No criterion failed, but at least one could not be decided. */
  'provisional',
  'ineligible'
] as const;

/**
 * The basis a salary is quoted on.
 *
 * Not optional, and not a detail. In the market this runtime targets, `20000
 * PLN` is a normal monthly permanent salary and an absurd annual one, and a B2B
 * rate is often quoted per day. Storing the number without the period makes a
 * salary floor a coin flip.
 */
export const salaryPeriods = ['', 'hour', 'day', 'month', 'year'] as const;

export type ProcessingState = (typeof processingStates)[number];
export type Disposition = (typeof dispositions)[number];
export type Eligibility = (typeof eligibilities)[number];
export type SalaryPeriod = (typeof salaryPeriods)[number];

export const offerRecordSchema = z.object({
  /** Bumped when a field changes meaning, so a stale file is recognisable. */
  version: z.literal(1).default(1),

  /* ---------------------------------------------------------- identity -- */

  id: z.string(),
  url: z.string().default(''),
  board: z.string().default(''),

  /* ------------------------------------------------------------ facts -- */

  title: z.string().default(''),
  company: z.string().default(''),
  location: z.string().default(''),
  /** `''` means the posting did not say — not "onsite". */
  work_mode: z.string().default(''),
  seniority: z.string().default(''),
  contract_type: z.string().default(''),

  /** The salary exactly as the posting stated it, for display and for verification. */
  salary: z.string().default(''),
  /** Parsed once at write time. `null` is unstated, which is not zero. */
  salary_min: z.number().nullable().default(null),
  salary_max: z.number().nullable().default(null),
  salary_currency: z.string().default(''),
  salary_period: z.enum(salaryPeriods).default(''),

  skills: z.array(z.string()).default([]),
  /** The posting as read. The reason this file is authored and not derived. */
  text: z.string().default(''),
  /** Whatever capability produced it owns the shape; this only stores it. */
  analysis: z.record(z.string(), z.unknown()).default({}),

  /* ------------------------------------------------------ observation -- */

  /**
   * Two timestamps, because one could not answer the question a standing search
   * asks. The previous single `imported_at` was restamped on every upsert, so an
   * offer seen daily for a month looked new every morning.
   */
  first_seen_at: z.string(),
  last_seen_at: z.string(),

  /* ------------------------------------------------------------ state -- */

  processing: z.enum(processingStates).default('candidate'),
  disposition: z.enum(dispositions).default('active'),

  /* ----------------------------------------------------------- rating -- */

  eligibility: z.enum(eligibilities).default('unrated'),
  /**
   * Match quality over *decided* facts: `matched / (matched + unmet)`. Unknowns
   * are excluded from the denominator rather than counted as misses, which is
   * the whole reason this is not a single `matched / named` ratio.
   */
  fit: z.number().nullable().default(null),
  /**
   * How much of the offer was extracted *and verified*, over a fixed list of
   * seven fields. Separate from `fit` so a posting that states one requirement
   * reads as "high fit, low confidence" instead of borrowing a perfect score.
   */
  completeness: z.number().nullable().default(null),
  /**
   * The per-requirement verdicts behind the two numbers.
   *
   * Not promoted to columns and never indexed: nobody filters on it, and the
   * only question it answers — "why is this provisional?" — is asked about one
   * offer at a time. Without it the tri-state is unexplainable, which would
   * defeat the point of having it.
   */
  score_detail: z.record(z.string(), z.unknown()).default({}),

  rated_at: z.string().default(''),
  /** The scoring algorithm. Bumped when the rules change. */
  scorer_version: z.string().default(''),
  /**
   * Which `cv.json` and which `preferences.json` the score was computed against.
   *
   * A rating is only meaningful relative to its inputs, so "which offers need
   * rescoring?" is an equality check against the current fingerprints — the same
   * trick that lets `reindex` skip unchanged chunks.
   */
  cv_fingerprint: z.string().default(''),
  prefs_fingerprint: z.string().default('')
});

export type OfferRecord = z.infer<typeof offerRecordSchema>;

/**
 * What a discovery round reports about an offer it just saw.
 *
 * Deliberately cannot carry `disposition`, `first_seen_at` or `last_seen_at`.
 * The first belongs to the user and the round must not touch it; the other two
 * are computed here, which is the point of the type — the old bug was a caller
 * being handed a timestamp field it could set.
 */
export type OfferSighting = Partial<
  Omit<OfferRecord, 'version' | 'id' | 'disposition' | 'first_seen_at' | 'last_seen_at'>
> & { id: string };

/** Fields a sighting must never overwrite once a record exists. */
const preserved = ['version', 'id', 'disposition', 'first_seen_at'] as const;

/** The parsed pay, which a caller may state instead of having read from the text. */
const numerics = ['salary_min', 'salary_max', 'salary_currency', 'salary_period'] as const;

/**
 * Fills the salary numerics from the salary text.
 *
 * Runs when the text is new or has changed, and never when the sighting stated
 * numerics of its own — a board that publishes structured pay knows better than
 * a parser reading its own rendering of it. Recomputing only on a change is
 * what keeps that override alive: it survives every later partial sighting, and
 * expires exactly when the thing it described is replaced.
 *
 * Without this the columns had no writer at all. `salary_min` existed, every
 * predicate over it was inert, and a salary floor silently matched nothing.
 */
const derivePay = (
  merged: Record<string, unknown>,
  stated: Record<string, unknown>,
  previous: OfferRecord | undefined
): Record<string, unknown> => {
  if (numerics.some((key) => key in stated)) return merged;

  const salary = typeof merged.salary === 'string' ? merged.salary : '';

  if (!salary.trim() || salary === previous?.salary) return merged;

  const parsed = parseSalary(salary);

  return {
    ...merged,
    salary_min: parsed.min,
    salary_max: parsed.max,
    salary_currency: parsed.currency,
    salary_period: parsed.period
  };
};

export class OfferRecordStore {
  private readonly file: JsonlStore<OfferRecord>;

  constructor(path: string = offersPath()) {
    this.file = new JsonlStore(path, offerRecordSchema);
  }

  async all(): Promise<OfferRecord[]> {
    return this.file.all();
  }

  async get(id: string): Promise<OfferRecord | null> {
    return (await this.all()).find((record) => record.id === id) ?? null;
  }

  /**
   * Records offers a round just saw.
   *
   * A re-seen offer keeps its `first_seen_at` and its `disposition`, and gets a
   * fresh `last_seen_at`. A field the sighting omits keeps whatever it had,
   * rather than reverting to a default — the round that found an offer by title
   * on a listing page knows less than the round that fetched it, and must not
   * erase the difference.
   */
  async sight(sightings: OfferSighting[]): Promise<{
    added: number;
    updated: number;
    records: OfferRecord[];
  }> {
    if (sightings.length === 0) return { added: 0, updated: 0, records: [] };

    const now = new Date().toISOString();
    const existing = await this.all();
    const byId = new Map(existing.map((record) => [record.id, record]));

    let added = 0;
    let updated = 0;
    const touched: OfferRecord[] = [];

    for (const sighting of sightings) {
      const previous = byId.get(sighting.id);

      // Undefined keys are stripped so a partial sighting merges rather than
      // blanking fields: spreading `{ salary: undefined }` over a record would
      // otherwise delete a salary the previous round worked to extract.
      const stated = Object.fromEntries(
        Object.entries(sighting).filter(([, value]) => value !== undefined)
      );

      const merged = offerRecordSchema.parse(
        derivePay(
          {
            ...(previous ?? {}),
            ...stated,
            ...(previous
              ? Object.fromEntries(preserved.map((key) => [key, previous[key]]))
              : {}),
            id: sighting.id,
            first_seen_at: previous?.first_seen_at ?? now,
            last_seen_at: now
          },
          stated,
          previous
        )
      );

      byId.set(merged.id, merged);
      touched.push(merged);

      if (previous) updated++;
      else added++;
    }

    await this.file.write([...byId.values()]);

    return { added, updated, records: touched };
  }

  /**
   * Applies a targeted change to one record.
   *
   * The other writer. A rating result and a user's dismissal both come through
   * here, and neither goes near the observation timestamps — `last_seen_at`
   * means "a round saw this posting", and dismissing an offer is not seeing it.
   */
  async update(
    id: string,
    patch: Partial<
      Omit<OfferRecord, 'version' | 'id' | 'first_seen_at' | 'last_seen_at'>
    >
  ): Promise<OfferRecord | null> {
    const records = await this.all();
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) return null;

    const previous = records[index] as OfferRecord;

    const stated = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined)
    );

    const next = offerRecordSchema.parse({
      ...previous,
      ...stated,
      version: previous.version,
      id: previous.id,
      first_seen_at: previous.first_seen_at,
      last_seen_at: previous.last_seen_at
    });

    records[index] = next;
    await this.file.write(records);

    return next;
  }

  /**
   * Offers already on file for a company and title.
   *
   * The cheap half of identity dedupe, and the half that runs before anything
   * is fetched. Board titles are formulaic enough that the same posting
   * syndicated to three boards matches on both fields; a reworded repost needs
   * the embedding check, which costs a vector and therefore runs only on what
   * survives this.
   */
  async findByIdentity(company: string, title: string): Promise<OfferRecord[]> {
    const key = (value: string) => value.trim().toLowerCase();
    const wantedCompany = key(company);
    const wantedTitle = key(title);

    if (!wantedCompany || !wantedTitle) return [];

    return (await this.all()).filter(
      (record) => key(record.company) === wantedCompany && key(record.title) === wantedTitle
    );
  }
}
