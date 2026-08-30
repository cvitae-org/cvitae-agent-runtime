/**
 * Decides whether an offer meets the user's requirements, and says why.
 *
 * The deterministic half of the design. A model may read a posting and extract
 * facts from it, but it never assigns the number that decides whether the offer
 * is shown — that would put the posting in charge of its own ranking, and a
 * posting is untrusted input. Everything here is a comparison between two
 * structured values, which is what makes a score explainable, testable, and
 * unmoved by whatever the offer text says about how it should be treated.
 *
 * ## Three answers, not two
 *
 * Every criterion resolves to `pass`, `fail` or `unknown`, and the third is the
 * one that carries the design. A posting that does not state a salary has not
 * failed a salary requirement; a currency this runtime cannot convert has not
 * failed one either. Collapsing `unknown` into `fail` would make every silence
 * a rejection, and — once verification lands — would turn a failed check of an
 * extracted claim into a way to discard the offer, which is precisely the
 * outcome that would make verification unsafe to run.
 *
 * ## Why three numbers instead of one ratio
 *
 * `matched / named` rewards a vague posting and punishes a thorough one: an
 * offer whose only stated requirement is "JavaScript" scores 1.00 against a
 * candidate who knows JavaScript, while one that lists eight technologies can
 * only ever score a fraction. The ratio conflates two different things — how
 * well the offer fits, and how much of it is actually known — so they are kept
 * apart:
 *
 *   `eligibility` is a filter over `must` criteria alone. One failure is
 *   `ineligible`; one undecided is `provisional`; otherwise `eligible`.
 *
 *   `fit` is match quality over *decided* criteria only. Unknowns leave the
 *   denominator rather than counting as misses, so a thorough posting is not
 *   penalised for the questions it did answer.
 *
 *   `completeness` is how much of the offer is known at all, over a fixed list
 *   of seven facts. It is a property of the posting, not of the match, which is
 *   why it does not consult the preferences.
 *
 * Read together, a vague offer now reads as "high fit, low completeness" —
 * visibly a guess — instead of borrowing a perfect score from its own silence.
 */

import type { OfferRecord, Eligibility, SalaryPeriod } from '../store/offerRecord.js';
import type { Preferences, ContractType, Strength } from '../store/preferences.js';

/** Bumped when a rule changes, so a stale score is recognisable as stale. */
export const SCORER_VERSION = '1';

export type Verdict = 'pass' | 'fail' | 'unknown';

export type CriterionVerdict = {
  /** `work_mode`, `salary`, `contract_type`, or `skill:react`. */
  criterion: string;
  strength: Strength;
  verdict: Verdict;
  /** Why, in one sentence, for a human reading `score_detail`. */
  because: string;
};

/** Goes into `OfferRecord.score_detail` verbatim. */
export type ScoreDetail = {
  scorer: string;
  criteria: CriterionVerdict[];
  /** Of the seven counted facts, the ones the posting states. */
  stated: string[];
  missing: string[];
};

export type Evaluation = {
  eligibility: Eligibility;
  fit: number | null;
  completeness: number;
  detail: ScoreDetail;
};

/**
 * The facts `completeness` is measured over.
 *
 * Fixed rather than derived from the record's keys, so that adding a field to
 * `OfferRecord` does not silently move every score on disk. Seven scalars a
 * posting either states or does not; `skills` is excluded because a list is
 * incomplete in degrees rather than absent, and `text` because a posting with
 * no text was never read at all.
 */
export const COUNTED_FACTS = [
  'title',
  'company',
  'location',
  'work_mode',
  'seniority',
  'contract_type',
  'salary'
] as const;

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** How the market spells each contract form, including the ways it abbreviates. */
const CONTRACT_PATTERNS: [ContractType, RegExp][] = [
  ['b2b', /\bb2b\b|\bjdg\b|kontrakt|self.?employ|freelance/],
  ['uop', /\buop\b|umow\w* o prac|employment contract|permanent|\betat\b/],
  ['zlecenie', /zlecen/],
  ['dzielo', /dziel/]
];

/**
 * Which contract forms a posting offers, from the free text of `contract_type`.
 *
 * A list rather than one value, because "B2B / UoP" is a normal thing for a
 * posting to say and collapsing it to either one would invent a restriction the
 * employer did not state.
 */
export const readContractTypes = (raw: string): ContractType[] => {
  const text = fold(raw);
  return CONTRACT_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([type]) => type);
};

/**
 * Skill names, compared with punctuation and case removed.
 *
 * `Node.js`, `NodeJS` and `node js` are the same skill written three ways, and
 * treating them as three would make the comparison a test of how the posting
 * punctuates. Deliberately no synonym table: mapping `JS` to `JavaScript` is a
 * judgement, and the moment there is a judgement in here the score stops being
 * reproducible from the inputs.
 */
const skillKey = (value: string): string => fold(value).replace(/[^a-z0-9]/g, '');

/** Converts to a monthly figure using the user's own stated assumptions. */
const toMonthly = (
  amount: number,
  period: SalaryPeriod,
  assumptions: Preferences['assumptions']
): number | null => {
  switch (period) {
    case 'hour':
      return amount * assumptions.hours_per_month;
    case 'day':
      return amount * assumptions.days_per_month;
    case 'month':
      return amount;
    case 'year':
      return amount / 12;
    default:
      return null;
  }
};

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Compares a posting's pay against the user's floor.
 *
 * Four things make it `unknown` rather than `fail`, and each is a refusal
 * rather than an omission:
 *
 *   No figure, or no currency. Nothing to compare.
 *
 *   A different currency. Applying an exchange rate would make yesterday's
 *   scores disagree with today's for reasons that have nothing to do with the
 *   offer, so the rate is not applied and the answer is that it is not known.
 *
 *   A different contract basis. `20 000 PLN` on B2B and on a permanent contract
 *   are different amounts of money, and the gap between them depends on tax
 *   choices this runtime does not know. There is no honest multiplier, so there
 *   is no comparison — this is the case the design is refusing to paper over.
 *
 *   No period on either side. Handled at the boundary for the floor, which the
 *   schema requires to carry one; a posting is under no such obligation.
 *
 * A range that straddles the floor passes. `15 000 - 25 000` against a floor of
 * 20 000 is an offer that can pay what the user asked for, and the reason to
 * see a posting is to find out.
 */
const compareSalary = (record: OfferRecord, preferences: Preferences): CriterionVerdict => {
  const { strength, floor, currency, period, basis } = preferences.salary;
  const base: Omit<CriterionVerdict, 'verdict' | 'because'> = {
    criterion: 'salary',
    strength
  };

  const undecided = (because: string): CriterionVerdict => ({
    ...base,
    verdict: 'unknown',
    because
  });

  if (record.salary_min === null && record.salary_max === null) {
    return undecided('the posting states no figure');
  }

  if (!record.salary_currency) return undecided('the posting states no currency');

  if (record.salary_currency !== currency) {
    return undecided(
      `quoted in ${record.salary_currency} against a floor in ${currency}; no exchange rate is applied`
    );
  }

  if (basis !== 'any') {
    const offered = readContractTypes(record.contract_type);

    if (offered.length === 0) {
      return undecided(
        `the floor is stated for ${basis} and the posting does not say which contract it offers`
      );
    }

    if (!offered.includes(basis)) {
      return undecided(
        `quoted against ${offered.join('/')} while the floor is stated for ${basis}; the two are not comparable`
      );
    }
  }

  if (!record.salary_period) return undecided('the posting states no period');

  const bottom =
    record.salary_min === null
      ? 0
      : toMonthly(record.salary_min, record.salary_period, preferences.assumptions);
  const top =
    record.salary_max === null
      ? Number.POSITIVE_INFINITY
      : toMonthly(record.salary_max, record.salary_period, preferences.assumptions);
  const wanted = toMonthly(floor as number, period, preferences.assumptions);

  if (bottom === null || top === null || wanted === null) {
    return undecided('the period cannot be converted');
  }

  // Named so that `because` can say which assumption was applied, since a
  // conversion the user did not expect is the likeliest reason for a verdict
  // they disagree with.
  const converted =
    record.salary_period === period
      ? ''
      : ` (converted from ${record.salary_period} at ${
          record.salary_period === 'hour'
            ? `${preferences.assumptions.hours_per_month} h/month`
            : record.salary_period === 'day'
              ? `${preferences.assumptions.days_per_month} days/month`
              : '12 months/year'
        })`;

  const asking = `${round(wanted)} ${currency}/month`;

  if (bottom >= wanted) {
    return { ...base, verdict: 'pass', because: `the whole range clears ${asking}${converted}` };
  }

  if (top < wanted) {
    return { ...base, verdict: 'fail', because: `the whole range is below ${asking}${converted}` };
  }

  return {
    ...base,
    verdict: 'pass',
    because: `the range straddles ${asking}${converted}, so the offer can pay it`
  };
};

const compareWorkMode = (
  record: OfferRecord,
  preferences: Preferences
): CriterionVerdict | null => {
  const { strength, accept } = preferences.work_mode;
  if (accept.length === 0) return null;

  const wanted = accept.join('/');

  if (!record.work_mode || record.work_mode === 'unknown') {
    return {
      criterion: 'work_mode',
      strength,
      verdict: 'unknown',
      because: `the posting does not say; ${wanted} wanted`
    };
  }

  const matched = (accept as readonly string[]).includes(record.work_mode);

  return {
    criterion: 'work_mode',
    strength,
    verdict: matched ? 'pass' : 'fail',
    because: `the posting is ${record.work_mode}; ${wanted} wanted`
  };
};

const compareContract = (
  record: OfferRecord,
  preferences: Preferences
): CriterionVerdict | null => {
  const { strength, accept } = preferences.contract_type;
  if (accept.length === 0) return null;

  const offered = readContractTypes(record.contract_type);
  const wanted = accept.join('/');

  if (offered.length === 0) {
    return {
      criterion: 'contract_type',
      strength,
      verdict: 'unknown',
      because: record.contract_type
        ? `"${record.contract_type}" names no contract form this build knows; ${wanted} wanted`
        : `the posting does not say; ${wanted} wanted`
    };
  }

  const matched = offered.some((type) => accept.includes(type));

  return {
    criterion: 'contract_type',
    strength,
    verdict: matched ? 'pass' : 'fail',
    because: `the posting offers ${offered.join('/')}; ${wanted} wanted`
  };
};

/**
 * One criterion per wanted skill, rather than one ratio over all of them.
 *
 * The ratio is what the three-number split exists to avoid: `2/5` says nothing
 * about *which* three are missing, and a `must` on skills has to be able to
 * fail on one name. Per skill, each verdict is separately explainable and the
 * fit denominator falls out of the same rule as every other criterion.
 *
 * A posting with no extracted skills yields unknowns, not failures — the list
 * being empty is a fact about the extraction, not about the job.
 */
const compareSkills = (record: OfferRecord, preferences: Preferences): CriterionVerdict[] => {
  const { strength, require } = preferences.skills;
  if (require.length === 0) return [];

  const offered = new Set(record.skills.map(skillKey));

  return require.map((skill) => {
    const criterion = `skill:${skillKey(skill)}`;

    if (offered.size === 0) {
      return {
        criterion,
        strength,
        verdict: 'unknown' as const,
        because: `the posting lists no skills, so ${skill} is undecided`
      };
    }

    const matched = offered.has(skillKey(skill));

    return {
      criterion,
      strength,
      verdict: matched ? ('pass' as const) : ('fail' as const),
      because: matched
        ? `the posting names ${skill}`
        : `the posting lists its skills and ${skill} is not among them`
    };
  });
};

/**
 * How much of the posting is known, over `COUNTED_FACTS`.
 *
 * Takes the record as it stands, which is what makes it survive verification
 * landing later: a claim that fails to check out against the raw text is blanked
 * on the record before this runs, so an unverifiable fact counts as missing
 * without this function needing to know that verification exists.
 */
export const measureCompleteness = (
  record: OfferRecord
): { completeness: number; stated: string[]; missing: string[] } => {
  const stated: string[] = [];
  const missing: string[] = [];

  for (const fact of COUNTED_FACTS) {
    const value = record[fact];
    const known = typeof value === 'string' && value.trim() !== '' && value !== 'unknown';
    (known ? stated : missing).push(fact);
  }

  return {
    completeness: round(stated.length / COUNTED_FACTS.length),
    stated,
    missing
  };
};

/**
 * Scores one offer against one set of preferences.
 *
 * Pure: no clock, no network, no model, no store. The same record and the same
 * preferences always give the same three numbers, which is the property that
 * lets `scorer_version` and the two fingerprints on the record mean anything —
 * "does this need rescoring?" is an equality check only if scoring is a
 * function of its inputs.
 */
export const evaluate = (record: OfferRecord, preferences: Preferences): Evaluation => {
  const criteria: CriterionVerdict[] = [
    compareWorkMode(record, preferences),
    compareContract(record, preferences),
    preferences.salary.floor === null ? null : compareSalary(record, preferences),
    ...compareSkills(record, preferences)
  ].filter((verdict): verdict is CriterionVerdict => verdict !== null);

  // Only `must` decides eligibility. A `prefer` that fails moves the fit score
  // and nothing else, which is the whole reason the two strengths exist.
  const required = criteria.filter((verdict) => verdict.strength === 'must');

  const eligibility: Eligibility = required.some((verdict) => verdict.verdict === 'fail')
    ? 'ineligible'
    : required.some((verdict) => verdict.verdict === 'unknown')
      ? 'provisional'
      : 'eligible';

  // Unknowns leave the denominator rather than counting against the offer. An
  // offer with nothing decided has no fit — `null`, not zero, because zero is a
  // claim about the match and this is the absence of one.
  const decided = criteria.filter((verdict) => verdict.verdict !== 'unknown');
  const passed = decided.filter((verdict) => verdict.verdict === 'pass');
  const fit = decided.length === 0 ? null : round(passed.length / decided.length);

  const { completeness, stated, missing } = measureCompleteness(record);

  return {
    eligibility,
    fit,
    completeness,
    detail: { scorer: SCORER_VERSION, criteria, stated, missing }
  };
};
