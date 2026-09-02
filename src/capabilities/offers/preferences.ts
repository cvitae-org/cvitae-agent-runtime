/**
 * What the user wants out of a job, in a form deterministic code can check.
 *
 * The smallest of the authored documents. The CV says what the user has done
 * and the offers table says what the runtime has seen; this says what would
 * make one of those offers worth reading. It is the other half of every score:
 * a rating is only meaningful relative to a CV *and* a set of requirements,
 * which is why `OfferRating` fingerprints both.
 *
 * ## Why the slots are closed and few
 *
 * Four criteria — work mode, contract type, salary, skills — chosen because
 * they are the four the runtime can actually decide. A preference the code
 * cannot evaluate is worse than no preference: it reads as a stated requirement
 * and silently never fires. Location is the deliberate omission; for the remote
 * and hybrid roles this runtime is pointed at it is mostly answered by
 * `work_mode`, and answering it properly needs commute distance rather than
 * string equality.
 *
 * An unset slot produces no criterion at all rather than an undecidable one.
 * That distinction matters more than it looks: "I don't care about contract
 * type" and "I care and the offer didn't say" must not both come out as
 * `provisional`, or every offer would be provisional for every user who left a
 * field blank.
 *
 * ## Why `must` and `prefer` are separate from the values
 *
 * Strength is per slot rather than global because the two questions are
 * genuinely different — one decides whether an offer is eligible at all, the
 * other only moves the fit score. Folding them together would mean either
 * treating a nice-to-have as a filter, or having no filters at all.
 *
 * ## Why the conversion assumptions live here
 *
 * `hours_per_month` and `days_per_month` are stated by the user rather than
 * hardcoded in the comparison, because they *are* an assumption: converting an
 * hourly rate to a monthly floor requires deciding how many hours a month is,
 * and there is no answer that is true for everyone. Written down here they are
 * a rule the user set and can change; buried in the evaluator they would be the
 * runtime quietly inventing a working month.
 *
 * No such number exists for B2B against a permanent contract, which is exactly
 * why `basis` is a separate field — see `compareSalary` in `criteria.ts`.
 */

import { z } from 'zod';
import { salaryPeriods, workModes } from '../../contracts/index.js';
import { fingerprintValue } from '../../hash.js';

/**
 * Forms of employment, as the Polish market names them.
 *
 * Deliberately not the board's schema.org `employmentType`, which answers
 * FULL_TIME/CONTRACTOR — a different axis, and the one `boardFacts.ts` already
 * refuses to map onto this one. `any` is how a user says the question does not
 * matter to them while still stating a salary floor.
 */
export const contractTypes = ['b2b', 'uop', 'zlecenie', 'dzielo'] as const;

/** Whether a slot filters or only ranks. */
export const strengths = ['must', 'prefer'] as const;

export type ContractType = (typeof contractTypes)[number];
export type Strength = (typeof strengths)[number];

const strength = z.enum(strengths).default('prefer');

export const preferencesSchema = z.object({
  version: z.literal(1).default(1),

  /** Unset when `accept` is empty. Values are `workModes` minus `unknown`. */
  work_mode: z
    .object({
      strength,
      accept: z.array(z.enum(workModes)).default([])
    })
    .default({ strength: 'prefer', accept: [] }),

  contract_type: z
    .object({
      strength,
      accept: z.array(z.enum(contractTypes)).default([])
    })
    .default({ strength: 'prefer', accept: [] }),

  /**
   * A floor, not a range. Nobody rejects an offer for paying too much, and a
   * ceiling would only ever be a way to express "this looks too senior" — which
   * is a seniority question wearing a salary costume.
   */
  salary: z
    .object({
      strength,
      /** Unset when null. */
      floor: z.number().nullable().default(null),
      /** Required alongside a floor: 15000 is a different ask in PLN and EUR. */
      currency: z.string().default(''),
      period: z.enum(salaryPeriods).default(''),
      /**
       * The contract the floor is quoted against.
       *
       * `any` compares the numbers as printed. Naming a contract instead means
       * a figure quoted against a different one is *incomparable*, not lower —
       * B2B and UoP differ by taxes and contributions that depend on choices
       * this file does not know.
       */
      basis: z.enum([...contractTypes, 'any']).default('any')
    })
    .default({ strength: 'prefer', floor: null, currency: '', period: '', basis: 'any' })
    // A floor with no currency or no period is not a requirement, it is a
    // number: 15000 is a different ask in PLN and in EUR, and per month and per
    // year. Left unvalidated it would parse cleanly and then evaluate to
    // `unknown` on every offer forever, which is the worst kind of bug — a
    // stated preference that silently never fires. Better to refuse the file.
    .refine(
      (salary) => salary.floor === null || (salary.currency !== '' && salary.period !== ''),
      { message: 'a salary floor must state both a currency and a period' }
    ),

  /**
   * Technologies the user wants to be working with. Each becomes its own
   * criterion rather than a matched-over-named ratio, so that a skill the offer
   * never mentions stays distinguishable from one it rules out.
   */
  skills: z
    .object({
      strength,
      require: z.array(z.string()).default([])
    })
    .default({ strength: 'prefer', require: [] }),

  /** Stated, not assumed. See the note at the top of this file. */
  assumptions: z
    .object({
      hours_per_month: z.number().positive().default(168),
      days_per_month: z.number().positive().default(21)
    })
    .default({ hours_per_month: 168, days_per_month: 21 }),

  updated_at: z.string().default('')
});

export type Preferences = z.infer<typeof preferencesSchema>;

/** The defaults, which state nothing and therefore filter nothing. */
export const emptyPreferences = (): Preferences => preferencesSchema.parse({});

/**
 * The identity of these preferences for rating purposes.
 *
 * `updated_at` is excluded on purpose: rewriting the file without changing what
 * it asks for must not invalidate every score on disk. `fingerprintValue` sorts
 * keys, so reordering the JSON by hand does not either.
 */
export const fingerprintPreferences = (preferences: Preferences): string => {
  const content = { ...preferences, updated_at: '' };
  return fingerprintValue(content);
};

/**
 * The document id and kind.
 *
 * One set of preferences per runtime, so the id is a constant for the same
 * reason `CV_ID` is: a second one would need a way for a caller to say which,
 * and no capability has anything to say about requirements that are not the
 * user's own.
 *
 * Stored as a document beside the CV rather than in a table of its own. It is
 * one authored blob that is read whole, written whole and never queried by
 * field — which is the shape `documents` already exists for.
 */
export const PREFERENCES_ID = 'preferences';
export const PREFERENCES_KIND = 'preferences';

/**
 * Reads a stored body back as preferences.
 *
 * A body that does not parse throws rather than falling back to the defaults.
 * The defaults state nothing and therefore filter nothing, so swallowing the
 * error would turn "your requirements file is corrupt" into "you appear to have
 * no requirements" — and the user would find out by being shown every offer on
 * the board.
 */
export const asPreferences = (
  body: Readonly<Record<string, unknown>> | undefined
): Preferences => {
  if (!body) return emptyPreferences();

  const parsed = preferencesSchema.safeParse(body);

  if (!parsed.success) {
    throw new Error(
      `The stored preferences do not match the schema: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }

  return parsed.data;
};
