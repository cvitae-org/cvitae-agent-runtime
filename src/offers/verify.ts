/**
 * Checking that an extracted fact is actually in the posting.
 *
 * The seam the whole scoring design rests on. `criteria.ts` is deterministic,
 * which makes it reproducible and injection-proof *as a comparison* — but it
 * compares values a model produced by reading attacker-writable text. A scorer
 * that cannot be talked into a verdict is still worthless if the numbers it
 * compares can be. So every fact that can move a verdict is looked for in the
 * raw text before it is allowed to count.
 *
 * This is a grounding check, not a correctness check. It answers "is this claim
 * present in what was actually published?" and nothing more. A posting that
 * lies about its own salary passes, because no amount of reading can tell —
 * that is the employer's claim to make, and the record stores it as such.
 *
 * ## Failure has to mean unknown
 *
 * A rejected claim is blanked, and a blank field is `unknown` to the evaluator,
 * never `fail`. That direction is not an implementation detail. If a failed
 * check degraded a claim to a rejection instead, then text that made
 * verification fail — a stray character, an unusual spelling — would remove the
 * offer from the results, and verification would have become a way to *hide*
 * postings rather than a way to trust them. Wrong in the safe direction is
 * `provisional`, which is a thing the user can look at.
 *
 * ## Two classes of fact, on purpose
 *
 * **Gating facts** — salary, work mode, contract type, skills — are the four
 * the criteria consult. These are verified strictly and blanked on failure,
 * because these are the only ones an ungrounded value could use to make an
 * offer look eligible.
 *
 * **Descriptive facts** — title, company, location, seniority — are checked and
 * reported but not blanked. They move only `completeness`, and blanking them
 * would have a nasty systematic cost: a Polish posting analysed into English
 * says `Warszawa` where the model wrote `Warsaw`, and a strict check would mark
 * every such offer under-described. The residual is honest and small —
 * `completeness` can be inflated by a fact nothing corroborates — and
 * `score_detail.unverified` names exactly which, so it is visible rather than
 * silent.
 */

import { parseSalary } from './salary.js';
import { readContractTypes } from './criteria.js';

export type OfferClaims = {
  title?: string;
  company?: string;
  location?: string;
  work_mode?: string;
  seniority?: string;
  contract_type?: string;
  salary?: string;
  skills?: string[];
};

export type Verification = {
  /** The claims that may be written to the record. Gating facts that failed are gone. */
  facts: OfferClaims;
  verified: string[];
  /** Claimed, and not found in the text. Gating facts here were dropped from `facts`. */
  unverified: string[];
};

/** The facts a criterion can consult, and therefore the ones that are enforced. */
const GATING = new Set(['salary', 'work_mode', 'contract_type', 'skills']);

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .toLowerCase();

/** Alphanumerics only, so `Node.js` and `NodeJS` compare equal. */
const squash = (value: string): string => fold(value).replace(/[^a-z0-9]/g, '');

/**
 * The text with thousands separators removed, for finding a figure in it.
 *
 * Only a separator followed by exactly three digits is dropped — the same rule
 * `salary.ts` parses by. Stripping every separator between digits would merge
 * `Founded 2010, 50 people` into one number and let an unrelated pair of
 * figures corroborate a salary that was never printed.
 */
const digitsRun = (text: string): string =>
  fold(text).replace(/(?<=\d)[ .,](?=\d{3}(?:\D|$))/g, '');

/** How each work mode is written, in both languages the boards use. */
const WORK_MODE_MARKERS: Record<string, RegExp> = {
  remote: /\bremote\b|zdaln/,
  hybrid: /\bhybrid\b|hybryd/,
  onsite: /\bon.?site\b|stacjonarn|w biurze/
};

/**
 * Whether a figure appears in the posting.
 *
 * Both spellings are tried because a posting writes twenty thousand as `20 000`
 * and as `20k`, and the model normalises either into the same number. Checking
 * only the digits would reject every posting that abbreviates.
 */
const statesAmount = (amount: number, run: string, text: string): boolean => {
  if (run.includes(String(amount))) return true;

  if (amount >= 1000 && amount % 1000 === 0) {
    const thousands = amount / 1000;
    return new RegExp(`\\b${thousands}\\s*(k\\b|tys)`).test(text);
  }

  return false;
};

/**
 * Whether the posting names a skill.
 *
 * Long names are matched against the punctuation-stripped text, so that
 * `Node.js` finds `NodeJS`. Short ones are not: `Go` squashed to `go` occurs
 * inside `Google`, `algorithm` and `good`, and a substring check on two letters
 * corroborates everything. Those fall back to a word boundary in the ordinary
 * text, which is stricter and is the right trade for a name that short.
 */
const statesSkill = (skill: string, text: string, squashed: string): boolean => {
  const key = squash(skill);
  if (!key) return false;

  if (key.length <= 3) {
    return new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
  }

  return squashed.includes(key);
};

/** A descriptive fact is present if any substantial word of it is. */
const statesPhrase = (claim: string, text: string): boolean => {
  const words = fold(claim)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);

  if (words.length === 0) return fold(claim).trim().length > 0 && text.includes(fold(claim).trim());

  return words.some((word) => text.includes(word));
};

/**
 * Grounds a set of claims in the posting they came from.
 *
 * Absent claims are neither verified nor rejected — a model that said nothing
 * about the salary has made no claim to check, and reporting that as a failed
 * verification would confuse "the posting is quiet" with "the model made
 * something up".
 */
export const verifyFacts = (claims: OfferClaims, rawText: string): Verification => {
  const text = fold(rawText);
  const squashed = squash(rawText);
  const run = digitsRun(rawText);

  const verified: string[] = [];
  const unverified: string[] = [];
  const facts: OfferClaims = {};

  const settle = (field: string, stated: boolean, grounded: boolean, keep: () => void) => {
    if (!stated) return;

    if (grounded) {
      verified.push(field);
      keep();
      return;
    }

    unverified.push(field);
    // Descriptive facts survive an ungrounded check; gating facts do not.
    if (!GATING.has(field)) keep();
  };

  /* --------------------------------------------------------- gating --- */

  const salary = (claims.salary ?? '').trim();
  const figures = salary ? parseSalary(salary) : null;
  const amounts = [figures?.min, figures?.max].filter(
    (value): value is number => typeof value === 'number'
  );

  settle(
    'salary',
    salary !== '',
    // A salary line with no figure in it — "do uzgodnienia" — has nothing to
    // corroborate and nothing to inflate, so it passes as stated.
    amounts.length === 0 || amounts.every((amount) => statesAmount(amount, run, text)),
    () => {
      facts.salary = salary;
    }
  );

  const workMode = (claims.work_mode ?? '').trim().toLowerCase();
  settle(
    'work_mode',
    workMode !== '' && workMode !== 'unknown',
    WORK_MODE_MARKERS[workMode]?.test(text) ?? false,
    () => {
      facts.work_mode = workMode;
    }
  );

  const contract = (claims.contract_type ?? '').trim();
  const claimed = readContractTypes(contract);
  const inText = readContractTypes(rawText);
  settle(
    'contract_type',
    contract !== '',
    claimed.length > 0 && claimed.some((type) => inText.includes(type)),
    () => {
      facts.contract_type = contract;
    }
  );

  const skills = claims.skills ?? [];
  if (skills.length > 0) {
    const grounded = skills.filter((skill) => statesSkill(skill, text, squashed));

    // Per skill rather than all-or-nothing: one invented technology in a list
    // of eight is not grounds to discard the seven the posting really names,
    // and dropping only the invented one is what keeps the criterion decidable.
    facts.skills = grounded;

    if (grounded.length === skills.length) verified.push('skills');
    else unverified.push('skills');
  }

  /* ---------------------------------------------------- descriptive --- */

  for (const field of ['title', 'company', 'location', 'seniority'] as const) {
    const claim = (claims[field] ?? '').trim();
    settle(field, claim !== '' && claim.toLowerCase() !== 'unknown', statesPhrase(claim, text), () => {
      facts[field] = claim;
    });
  }

  return { facts, verified, unverified };
};
