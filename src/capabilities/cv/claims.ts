/**
 * The citation protocol: what the model writes, and what survives checking.
 *
 * A summary written against a job offer is the one CV artefact with a standing
 * incentive to lie. Every other capability restructures text that already
 * exists — extraction carves fields out of a CV, translation carries them into
 * another language, and a wrong answer is a mangled fact. This one is asked to
 * *argue*, from facts, to a reader who is deciding. A model doing that will
 * round a B2 up to fluent, turn four years into five, and name a technology it
 * saw in the vacancy rather than the CV, because every one of those makes the
 * paragraph better at its job.
 *
 * So the model is not asked for prose. It is asked for prose *with its sources
 * attached*, one claim per line:
 *
 *     EVIDENCE(job:0:2,skill:7) REQUIREMENTS(req:1) :: Claim sentence.
 *
 * and everything below is the deterministic half — parse the markers, resolve
 * the ids against the catalogue that produced them, and check each sentence
 * against the facts it claims to rest on. A sentence that cites nothing is not
 * a weaker claim, it is an unsourced one, and it is dropped.
 *
 * `render.ts` already notes that numbering a list is "the cheapest form of
 * citation available without tool calling". This is that idea taken to the
 * point where the citation is checkable: the ids are minted by the same code
 * that later resolves them, so `job:0:2` means `experience[0].highlights[2]`
 * and nothing else, and a claim citing it can be compared against that exact
 * sentence rather than against the CV in general.
 *
 * What this does *not* guarantee is worth stating plainly, because the word
 * "cited" invites a stronger reading than the checks earn. Numbers, contact
 * details, language levels and sentences lifted from the previous summary are
 * checked against the cited facts. The claim's *meaning* is not: nothing here
 * decides whether a sentence follows from the lines it names, and deciding
 * that would take a second model call this capability deliberately does not
 * make. Two things get through, both seen in a real run against a local model.
 * A claim can name the position (`job:0`) while the fact it actually rests on
 * is one of that position's highlights (`job:0:0`) — true of the CV, attached
 * to the wrong line. And a claim can join facts from two different positions
 * into one sentence, which reads as one role having done both. Neither is
 * false; both are looser than the citation implies.
 *
 * That boundary is the reason the checks are aimed where they are. A reader
 * cannot verify an implication, but they can verify a number, and a number is
 * what an interview asks about.
 *
 * **No message built here may contain CV prose.** Failures name a category and
 * a count — "claim 3 contains 1 numeric claim not present in its cited
 * evidence" — because these strings reach logs and a run record, and the input
 * is the user's employment history.
 */

import { RuntimeError } from '../../contracts/index.js';

/* --------------------------------------------------------------- the catalogue */

/**
 * Where a fact came from, which is also what a claim is allowed to cite.
 *
 * `summary` is the candidate's *previous* description and is deliberately in
 * the catalogue: it holds facts nothing else does, and it is also the one entry
 * the model must not treat as a draft to edit. See `SOURCE_SENTENCE_MIN`.
 */
export const factKinds = [
  'role',
  'summary',
  'skill',
  'job',
  'highlight',
  'education',
  'certificate',
  'language'
] as const;

export type FactKind = (typeof factKinds)[number];

export type Fact = {
  /** Minted by the catalogue builder; the only thing a claim may cite. */
  readonly id: string;
  readonly kind: FactKind;
  readonly text: string;
};

export type Requirement = {
  readonly id: string;
  /** `skill` before `responsibility`: the offer's own order of insistence. */
  readonly category: 'skill' | 'responsibility';
  readonly text: string;
};

/**
 * Ids travel through a plain-text marker the model copies, so the character set
 * is the one that survives a `(a,b)` list without ambiguity.
 */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;

/* ------------------------------------------------------------------- limits */

export const MIN_CLAIMS = 2;
export const MAX_CLAIMS = 8;
export const MAX_REFERENCES_PER_CLAIM = 20;
/** Below this a "sentence" is a fragment, and matching it proves nothing. */
const SOURCE_SENTENCE_MIN = 40;

/** How short the finished paragraph may fall before it is not what was asked. */
export const DETAIL_RATIO = 0.6;
export const minChars = (maxChars: number): number => Math.ceil(maxChars * DETAIL_RATIO);

/* ------------------------------------------------------------------ parsing */

export type Claim = {
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly requirementIds: readonly string[];
};

/**
 * Tolerant about the wrapping, strict about the marker.
 *
 * A local model asked for one claim per line will sometimes number them, or
 * bullet them, or open with a fence. None of that changes what the line says,
 * so the leading noise is allowed and the marker itself is not.
 */
const CLAIM_LINE =
  /^\s*(?:[-*]|\d+[.)])?\s*EVIDENCE\(([^)]*)\)\s+REQUIREMENTS\(([^)]*)\)\s*::\s*(.*?)\s*$/iu;

const idsFrom = (raw: string): string[] => {
  const value = raw.trim();
  if (!value || /^none$/iu.test(value)) return [];

  return [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && ID_PATTERN.test(id))
    )
  ].slice(0, MAX_REFERENCES_PER_CLAIM);
};

/** Splits on sentence ends, but only where the next sentence starts capitalised. */
export const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+(?=["'“”‘’(]*\p{Lu})/u)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);

const ENDS_A_SENTENCE = /[.!?]["'”’)]?$/u;

export const parseClaims = (generated: string): Claim[] => {
  const claims: { text: string; evidenceIds: string[]; requirementIds: string[] }[] = [];

  for (const rawLine of generated.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || /^```/.test(line)) continue;

    const match = CLAIM_LINE.exec(line);

    if (match) {
      const evidenceIds = idsFrom(match[1] ?? '');
      const requirementIds = idsFrom(match[2] ?? '');

      // One marker over two sentences cites both, which is the only reading
      // available: the model attached one source list to the pair.
      for (const sentence of sentences(match[3]?.replace(/\s+/g, ' ').trim() ?? '')) {
        claims.push({ text: sentence, evidenceIds, requirementIds });
      }
      continue;
    }

    // A wrapped line. Continuing the previous claim is unambiguous only while
    // that claim is unfinished; anything else is uncited prose, and uncited
    // prose is exactly what this protocol exists to refuse.
    const previous = claims.at(-1);
    if (previous && !ENDS_A_SENTENCE.test(previous.text)) {
      previous.text = `${previous.text} ${line}`.replace(/\s+/g, ' ').trim();
    }
  }

  return claims;
};

/* ------------------------------------------------------------------- checks */

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const PHONE_SHAPED = /\+?\d[\d ().-]{6,18}\d/g;

/**
 * A digit run is a phone number when there are enough digits to dial and few
 * enough to be one.
 *
 * The count is doing real work rather than tightening an already-good pattern.
 * `\+?\d[\d ().-]{7,}\d` — the shape alone — also matches `2019-2023`, which
 * is in almost every CV in the catalogue. Redacting it would be worse than
 * cosmetic: the cited fact would lose the years, and the numeric-support check
 * below would then refuse a claim about a date the CV plainly states. A rule
 * that turns true statements into run failures is more expensive than the leak
 * it was guarding.
 *
 * Nine is the shortest national number worth dialling and fifteen is the E.164
 * maximum, so a longer run is an identifier of some other kind.
 */
const dialable = (value: string): boolean => {
  const digits = value.match(/\d/g)?.length ?? 0;
  return digits >= 9 && digits <= 15;
};

const contactsIn = (value: string): string[] => [
  ...(value.match(EMAIL) ?? []),
  ...(value.match(PHONE_SHAPED) ?? []).filter(dialable)
];

/** Strips contact details from material on its way *to* the model. */
export const withoutContacts = (value: string): string => {
  let result = value.replace(EMAIL, '[removed]');

  for (const phone of (result.match(PHONE_SHAPED) ?? []).filter(dialable)) {
    result = result.replace(phone, '[removed]');
  }

  return result;
};

/**
 * Numbers, with their units attached.
 *
 * `5`, `5%`, `4.5`, `10k` are each one token, because "10" appearing somewhere
 * in the evidence does not support a claim of "10k", and a claim of "5+ years"
 * is not supported by a fact that says "5 people".
 */
const numbers = (value: string): string[] =>
  value.match(/\b\d+(?:[.,]\d+)?(?:\s?(?:[%+]|[kKmMbB]))?\b/g) ?? [];

/**
 * A sentence that stops before it finishes.
 *
 * The list is function words — a sentence ending on a conjunction or a
 * preposition is unfinished whatever follows it, in any subject matter. The
 * previous runtime's version of this regex also carried specific phrases
 * pasted in from bad outputs it had seen (`with hands-on`, `for complex`,
 * `and agent`), which can only ever catch themselves; a rule that generalises
 * covers those three and the ones nobody has seen yet.
 */
const DANGLING =
  /\b(?:and|or|but|with|for|from|to|of|in|on|at|by|as|through|across|into|about|having|including|using)[.!?]["'”’)]?$/iu;

const unfinished = (value: string): boolean => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length === 0 || !ENDS_A_SENTENCE.test(text) || DANGLING.test(text);
};

const CEFR = /\b(?:A1|A2|B1|B2|C1|C2)\b/giu;

/** Word-level proficiency, in the two languages this project's CVs are in. */
const PROFICIENCIES = [
  ['fluent', /\b(?:fluent|fluently)\b|\b(?:biegl|płynn)\p{L}*/iu],
  ['native', /\b(?:native|natively)\b|\bojczyst\p{L}*/iu],
  ['advanced', /\badvanced\b|\bzaawansowan\p{L}*/iu],
  ['intermediate', /\bintermediate\b|\bśredniozaawansowan\p{L}*/iu],
  ['basic', /\b(?:beginner|basic)\b|\b(?:początkując|podstawow)\p{L}*/iu]
] as const;

/**
 * Language levels the claim states that its cited language facts do not.
 *
 * Upgrading is the specific failure worth catching. It is the one change that
 * makes the paragraph better at its job and the candidate worse off in the
 * room, because the interview that discovers it is conducted in the language.
 *
 * The two halves are checked differently because they are differently
 * ambiguous. A CEFR level is unambiguous — `B2` is a claim about language and
 * nothing else, so it is checked wherever it appears, exactly, since B2 and C1
 * are different claims about the same person. A word like `advanced` is not: it
 * is a language level in "advanced German" and an ordinary description of skill
 * in "advanced Kubernetes work", and checking it everywhere would drop true
 * sentences about technical depth for saying so. So the word-level check runs
 * only where the claim is actually about a language — it names one of the CV's
 * languages, or it cites a language fact.
 */
const unsupportedLevels = (
  text: string,
  cited: string,
  languages: readonly string[]
): string[] => {
  const citedLevels = new Set([...cited.matchAll(CEFR)].map((m) => m[0].toLocaleUpperCase()));
  const unsupported = new Set<string>();

  for (const match of text.matchAll(CEFR)) {
    const level = match[0].toLocaleUpperCase();
    if (!citedLevels.has(level)) unsupported.add(level);
  }

  const aboutALanguage =
    cited.length > 0
    || languages.some((name) => new RegExp(`\\b${escaped(name)}\\b`, 'iu').test(text));

  if (aboutALanguage) {
    for (const [label, pattern] of PROFICIENCIES) {
      if (pattern.test(text) && !pattern.test(cited)) unsupported.add(label);
    }
  }

  return [...unsupported];
};

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalise = (value: string): string =>
  value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

/* -------------------------------------------------------------------- fitting */

/**
 * Brings an overlong draft under the ceiling by dropping whole sentences.
 *
 * Deletion only, and never inside a sentence. Truncating to a character budget
 * is what produces prose ending in "with hands-on." — a paragraph that reads as
 * broken rather than short, in the one document where that matters most.
 *
 * At most eight claims, so trying every subset is 255 string joins. The first
 * claim is kept in every candidate: the prompt asks for the strongest overlap
 * first, so dropping it changes what the paragraph is about rather than how
 * long it is.
 */
const fitWithin = (claims: Claim[], maximum: number, warnings: string[]): Claim[] => {
  const joined = claims.map((claim) => claim.text).join(' ');
  if (joined.length <= maximum) return claims;

  const floor = minChars(maximum);
  let best: Claim[] | undefined;
  let bestLength = -1;

  for (let mask = 1; mask < 1 << claims.length; mask += 1) {
    if ((mask & 1) === 0) continue;

    const selected = claims.filter((_, index) => (mask & (1 << index)) !== 0);
    if (selected.length < MIN_CLAIMS) continue;

    const length = selected.map((claim) => claim.text).join(' ').length;
    if (length < floor || length > maximum || length <= bestLength) continue;

    best = selected;
    bestLength = length;
  }

  if (!best) {
    throw new RuntimeError(
      `The summary is ${joined.length} characters and no whole-sentence subset of it fits `
        + `between ${floor} and ${maximum}.`,
      'step_failed'
    );
  }

  const dropped = claims.length - best.length;
  warnings.push(
    `The draft ran past ${maximum} characters, so ${dropped} complete `
      + `${dropped === 1 ? 'sentence was' : 'sentences were'} dropped. None was truncated.`
  );

  return best;
};

/* --------------------------------------------------------------------- review */

export type Review = {
  readonly claims: readonly Claim[];
  readonly chars: number;
  readonly warnings: readonly string[];
};

export type ReviewInput = {
  readonly facts: readonly Fact[];
  readonly requirements: readonly Requirement[];
  readonly maxChars: number;
};

/**
 * Every check, in one pass, with two kinds of verdict.
 *
 * A claim is **refused** — the whole run fails — when keeping it would put
 * something false in front of an employer: a number the evidence does not
 * support, a contact detail, a sentence copied whole from the previous
 * description, or no citation at all. A claim is **dropped**, with a warning,
 * when it is merely unusable: unfinished prose, a duplicate, a language level
 * the cited facts do not carry.
 *
 * The line between them is whether a person reading the output would be misled
 * or merely underserved. Refusing is reserved for the cases where a quieter
 * failure would ship the lie; everything else survives as a warning, because
 * the paragraph is built from several claims and losing one still leaves a
 * checked paragraph.
 *
 * Length sits on the underserved side of that line, which is not where it
 * started. A first run against the local model produced four correctly cited
 * claims totalling 321 characters against a 600-character request, and the
 * floor refused the run. Nothing in that output was false; it was thin. Since
 * this capability makes exactly one model call, refusing means the caller gets
 * an error instead of the checked prose the model actually managed — trading a
 * usable summary for no summary over a length preference. So a short summary
 * is returned with a warning saying so, and the caller decides whether to ask
 * again. Overlong prose is different and still refuses, because there the only
 * alternatives are breaking the ceiling or cutting a sentence in half.
 */
export const review = (generated: string, input: ReviewInput): Review => {
  const parsed = parseClaims(generated);

  if (parsed.length < MIN_CLAIMS) {
    throw new RuntimeError(
      `The model returned ${parsed.length} cited ${parsed.length === 1 ? 'claim' : 'claims'}; `
        + `at least ${MIN_CLAIMS} are required.`,
      'step_failed'
    );
  }

  const factById = new Map(input.facts.map((fact) => [fact.id, fact]));

  // Every language the CV names, cited or not — a claim inflating German is
  // about a language whether or not it bothered to cite the German fact.
  const languages = input.facts
    .filter((fact) => fact.kind === 'language')
    .map((fact) => fact.text.split(' — ')[0]?.trim() ?? '')
    .filter((name) => name.length > 0);
  const requirementIds = new Set(input.requirements.map((requirement) => requirement.id));
  const previous = new Set(
    sentences(input.facts.find((fact) => fact.kind === 'summary')?.text ?? '')
      .map(normalise)
      .filter((sentence) => sentence.length >= SOURCE_SENTENCE_MIN)
  );

  const warnings: string[] = [];
  const kept: Claim[] = [];
  const seen = new Set<string>();

  for (const [index, claim] of parsed.slice(0, MAX_CLAIMS).entries()) {
    const at = index + 1;
    if (claim.text.length === 0) continue;

    if (contactsIn(claim.text).length > 0) {
      throw new RuntimeError(`Claim ${at} contains a contact detail.`, 'step_failed');
    }

    if (sentences(claim.text).some((sentence) => previous.has(normalise(sentence)))) {
      throw new RuntimeError(
        `Claim ${at} repeats a whole sentence from the previous description instead of `
          + 'writing a new one.',
        'step_failed'
      );
    }

    const evidenceIds = claim.evidenceIds.filter((id) => factById.has(id));
    const requirements = claim.requirementIds.filter((id) => requirementIds.has(id));

    const unknownFacts = claim.evidenceIds.length - evidenceIds.length;
    const unknownRequirements = claim.requirementIds.length - requirements.length;
    if (unknownFacts > 0) {
      warnings.push(`Claim ${at} cited ${unknownFacts} fact ${unknownFacts === 1 ? 'id' : 'ids'} that do not exist.`);
    }
    if (unknownRequirements > 0) {
      warnings.push(
        `Claim ${at} cited ${unknownRequirements} requirement `
          + `${unknownRequirements === 1 ? 'id' : 'ids'} that do not exist.`
      );
    }

    if (evidenceIds.length === 0) {
      throw new RuntimeError(
        `Claim ${at} cites no fact that exists, so nothing supports it.`,
        'step_failed'
      );
    }

    const cited = evidenceIds.map((id) => factById.get(id)?.text ?? '').join(' ');

    // Whitespace removed on both sides so "10 k" in a claim matches "10k" in a
    // fact. Everything else about the token has to match exactly.
    const citedDigits = cited.replace(/\s+/g, '').toLocaleLowerCase();
    const invented = numbers(claim.text).filter(
      (token) => !citedDigits.includes(token.replace(/\s+/g, '').toLocaleLowerCase())
    );
    if (invented.length > 0) {
      throw new RuntimeError(
        `Claim ${at} states ${invented.length} ${invented.length === 1 ? 'number' : 'numbers'} `
          + 'that its cited facts do not.',
        'step_failed'
      );
    }

    if (sentences(claim.text).some(unfinished)) {
      warnings.push(`Claim ${at} was dropped: the sentence does not finish.`);
      continue;
    }

    const citedLanguages = evidenceIds
      .map((id) => factById.get(id))
      .filter((fact) => fact?.kind === 'language')
      .map((fact) => fact?.text ?? '')
      .join(' ');
    const levels = unsupportedLevels(claim.text, citedLanguages, languages);
    if (levels.length > 0) {
      warnings.push(
        `Claim ${at} was dropped: it states ${levels.length} language `
          + `${levels.length === 1 ? 'level' : 'levels'} its cited facts do not.`
      );
      continue;
    }

    const key = normalise(claim.text);
    if (seen.has(key)) {
      warnings.push(`Claim ${at} was dropped as a duplicate.`);
      continue;
    }
    seen.add(key);

    kept.push({ text: claim.text, evidenceIds, requirementIds: requirements });
  }

  if (parsed.length > MAX_CLAIMS) {
    const over = parsed.length - MAX_CLAIMS;
    warnings.push(`${over} ${over === 1 ? 'claim' : 'claims'} past the maximum of ${MAX_CLAIMS} were dropped.`);
  }

  if (kept.length < MIN_CLAIMS) {
    throw new RuntimeError(
      `${kept.length} ${kept.length === 1 ? 'claim' : 'claims'} survived review; `
        + `at least ${MIN_CLAIMS} are required.`,
      'step_failed'
    );
  }

  const fitted = fitWithin(kept, input.maxChars, warnings);
  const chars = fitted.map((claim) => claim.text).join(' ').length;
  const floor = minChars(input.maxChars);

  if (chars < floor) {
    warnings.push(
      `The summary is ${chars} characters, short of the ${floor} this length asks for. `
        + 'Every claim in it is cited and checked; there are simply fewer of them.'
    );
  }

  return { claims: fitted, chars, warnings };
};
