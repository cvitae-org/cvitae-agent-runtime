/**
 * The mask engine: a person's own identifiers out of a prompt, and back into
 * what comes home.
 *
 * It knows nothing about a CV, a run or a provider. It is given values to keep
 * from a model (`MaskSeed`) and answers two questions about a string: what is it
 * with those values replaced by placeholders, and what is a string that came
 * back with the placeholders put right again. `masking.ts` decides when to ask,
 * and `runtime/` decides which values.
 *
 * **A vault is one gateway call.** Placeholders are numbered from 1 in each, the
 * table that says what `[EMAIL_1]` stands for lives only as long as the call, and
 * nothing here is module state. A value that outlived its call would be a copy of
 * a person's contact details held for no reason, and the same placeholder meaning
 * two things in two calls would be a bug that only a long conversation shows.
 *
 * **Matching is one pass.** Every seed is compiled into one alternation, longest
 * value first, and the text is scanned once: a name inside an email address is the
 * email's, and text that was put into the output is never scanned again, so a
 * placeholder cannot be matched by a seed that happens to spell part of it.
 *
 * **What was written is what is put back.** A placeholder stands for the exact
 * text that was found — `ANNA KOWALSKA` in a heading and `Anna Kowalska` in a
 * sentence are two placeholders — so `restore(mask(x))` is `x`, and a person's
 * CV is not re-cased by being asked about. The cost is that a model sees two
 * names where there is one, which is a smaller harm than a CV changed by being
 * read. The exception is text that already spells a placeholder this vault has
 * issued, which can only be told apart from one up to the moment it is seen
 * (`reserve`); what turns up after is put back as the value. That is a mix-up in
 * what a person reads on their own machine, and nothing leaves by it.
 *
 * Matching is on a folded copy of the text, lower case and without accents, with
 * one code unit for every code unit of the original so that an offset in one is an
 * offset in the other. Polish is typed without its diacritics as often as with
 * them, and a mask that a missing `ł` defeats is not much of a mask.
 *
 * What it does not do, said once here and in the plan: a form the seed does not
 * spell (a Polish case ending on a surname, a phone number with its country code
 * dropped when the seed has none, an address the CV never stated), a name that is
 * not the person's, and anything that is not text. Step 9 adds detectors for
 * identifiers by their shape; this one keeps what a person has already said.
 */

import type { MaskSeed, MaskSeedKind } from '../contracts/index.js';

const LABEL: Readonly<Record<MaskSeedKind, string>> = {
  name: 'NAME',
  email: 'EMAIL',
  phone: 'PHONE',
  link: 'LINK'
};

/**
 * The shortest value worth masking, in characters.
 *
 * Below it a seed is more likely to be a word than a person: a name of two letters
 * is a particle or an initial, and masking "Li" would redact every "Li" in the
 * text for the sake of one person.
 */
export const MIN_SEED_LENGTH = 3;

/** The longest, so that a CV field holding a paragraph cannot become a pattern. */
export const MAX_SEED_LENGTH = 300;

/** The fewest digits a number needs to be a phone number and not a year. */
const MIN_PHONE_DIGITS = 7;

/** The fewest digits left after taking a country code off. */
const MIN_NATIONAL_DIGITS = 9;

/** The shortest link, once its scheme and `www.` are taken off. */
const MIN_LINK_LENGTH = 4;

/* -------------------------------------------------------------------- fold */

const SPECIAL_FOLD: Readonly<Record<string, string>> = {
  ł: 'l',
  Ł: 'l',
  đ: 'd',
  Đ: 'd',
  ø: 'o',
  Ø: 'o'
};

const ASCII_ONLY = /^\p{ASCII}*$/u;
const MARKS = /\p{M}/gu;

/**
 * One character, lower case and without its accents; itself when that would not
 * leave one code unit for one, which is what keeps offsets the same.
 */
const foldPoint = (point: string): string => {
  const special = SPECIAL_FOLD[point];
  if (special !== undefined) return special;

  const plain = point.normalize('NFD').replace(MARKS, '').toLowerCase();
  return plain.length === point.length ? plain : point;
};

/** The text as it is matched. As long as the text, whatever the text is. */
export const fold = (text: string): string =>
  ASCII_ONLY.test(text) ? text.toLowerCase() : Array.from(text, foldPoint).join('');

/* ---------------------------------------------------------------- patterns */

type Pattern = {
  readonly kind: MaskSeedKind;
  readonly source: string;
  /** How much text it stands for, so that the longest is tried first. */
  readonly weight: number;
};

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Nothing letter or digit-like on either side: a whole word and not a piece of one. */
const BEFORE = '(?<![\\p{L}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{N}])';

const SEPARATOR = '[\\s().\\-\\u2011\\u2013]*';

const HYPHENS = /[-\u2010-\u2015]+/;

const namePatterns = (value: string): Pattern[] => {
  const parts = fold(value)
    .split(/\s+/)
    .map((part) => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((part) => part !== '');
  if (parts.length === 0) return [];

  const whole = (words: readonly string[]): Pattern => ({
    kind: 'name',
    source: `${BEFORE}${words.map(escape).join('\\s+')}${AFTER}`,
    weight: words.join(' ').length
  });

  const patterns: Pattern[] = [];
  if (parts.length > 1) patterns.push(whole(parts));
  // "Kowalska Anna", which is how a Polish form asks for it.
  if (parts.length === 2) patterns.push(whole([parts[1]!, parts[0]!]));

  // Each word, and each half of a hyphenated one: "Nowak-Kowalska" is also
  // "Kowalska" to whoever is writing about her.
  const words = new Set(parts.flatMap((part) => [part, ...part.split(HYPHENS)]));
  for (const word of words) {
    if ([...word].length >= MIN_SEED_LENGTH) patterns.push(whole([word]));
  }

  return patterns;
};

const emailPatterns = (value: string): Pattern[] => {
  const email = fold(value);

  return [
    {
      kind: 'email',
      // Not the tail of a longer address, and not the head of one with a longer domain.
      source: `(?<![\\p{L}\\p{N}._%+\\-])${escape(email)}(?![\\p{L}\\p{N}_\\-]|\\.[\\p{L}\\p{N}])`,
      weight: email.length
    }
  ];
};

const phonePatterns = (value: string): Pattern[] => {
  const digits = value.replace(/\D/g, '');
  if (digits.length < MIN_PHONE_DIGITS) return [];

  const trimmed = value.trim();
  const international = /^(\+|00)/.test(trimmed);
  const core = /^00/.test(trimmed) ? digits.slice(2) : digits;
  if (core.length < MIN_PHONE_DIGITS) return [];

  const spelled = (run: string): string => [...run].join(SEPARATOR);
  const patterns: Pattern[] = [
    {
      kind: 'phone',
      source: `(?<![\\p{N}])(?:\\+|00)?${spelled(core)}(?![\\p{N}])`,
      weight: core.length + 2
    }
  ];

  // The number without its country code, which is how it is said at home. Only for
  // a number written with one, and only when what is left is long enough to be a
  // number and not the end of one.
  if (international) {
    for (let drop = 1; drop <= 3; drop += 1) {
      const national = core.slice(drop);
      if (national.length >= MIN_NATIONAL_DIGITS) {
        patterns.push({
          kind: 'phone',
          source: `(?<![\\p{N}])${spelled(national)}(?![\\p{N}])`,
          weight: national.length
        });
      }
    }
  }

  return patterns;
};

const linkPatterns = (value: string): Pattern[] => {
  const core = fold(value.trim())
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#]+$/, '');
  if (core.length < MIN_LINK_LENGTH) return [];

  return [
    {
      kind: 'link',
      source:
        '(?<![\\p{L}\\p{N}@.\\-])(?:[a-z][a-z0-9+.-]*:\\/\\/)?(?:www\\.)?'
        + `${escape(core)}\\/?${AFTER}`,
      weight: core.length + 8
    }
  ];
};

const PATTERNS: Readonly<Record<MaskSeedKind, (value: string) => Pattern[]>> = {
  name: namePatterns,
  email: emailPatterns,
  phone: phonePatterns,
  link: linkPatterns
};

const patternsOf = (seeds: readonly MaskSeed[]): Pattern[] => {
  const seen = new Set<string>();
  const found: Pattern[] = [];

  for (const seed of seeds) {
    const value = seed.value.trim();
    if (value.length < MIN_SEED_LENGTH || value.length > MAX_SEED_LENGTH) continue;

    for (const pattern of PATTERNS[seed.kind](value)) {
      const key = `${pattern.kind}\u0000${pattern.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(pattern);
    }
  }

  // Longest first: the alternation takes the first that matches where a match
  // begins, so "Anna Kowalska" must be tried before "Anna".
  return found.sort((a, b) => b.weight - a.weight);
};

/* ------------------------------------------------------------ placeholders */

/**
 * Where a placeholder may be found in what a model wrote, loosely.
 *
 * Models fold case, escape an underscore as a markdown writer would, and pad a
 * bracket, so `[email_1]`, `[EMAIL\_1]` and `[ EMAIL 1 ]` are all the placeholder
 * they were given. The gaps are bounded because `restorer` has to know how much
 * of the end of a stream might still become one (`PENDING`).
 */
const GAP = '[\\s_\\\\-]{0,3}';
const PLACEHOLDER = new RegExp(
  `\\[\\s{0,3}(${Object.values(LABEL).join('|')})${GAP}(\\d{1,4})\\s{0,3}\\]`,
  'gi'
);

/**
 * What can still become a placeholder when the next fragment arrives: a bracket
 * and no more than the 18 characters that fit between it and the closing one
 * when every gap is as wide as `PLACEHOLDER` allows (three spaces, `PHONE`, three
 * of gap, four digits, three spaces).
 */
const PENDING = /^\[[\s\w\\-]{0,18}$/;

/* ------------------------------------------------------------------- vault */

export type Restorer = {
  /** A fragment of what came back. Whatever can be settled is passed on at once. */
  push(fragment: string): void;
  /** The stream has ended: what was held back, restored as far as it can be. */
  end(): void;
};

export type Vault = {
  /** No value was usable, so nothing can be masked and a call may go as it is. */
  readonly empty: boolean;
  /**
   * Notes the text a call is made of before any of it is masked, so that a
   * placeholder-shaped string already in it is never issued as a placeholder.
   */
  reserve(...texts: readonly string[]): void;
  mask(text: string): string;
  /** Every string in a JSON-shaped value, keys included. Other values are left. */
  maskDeep<T>(value: T): T;
  restore(text: string): string;
  restoreDeep<T>(value: T): T;
  restorer(emit: (text: string) => void): Restorer;
  /** How many values have been replaced, for a test and for nothing else. */
  replaced(): number;
};

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

const walk = <T>(value: T, change: (text: string) => string): T => {
  if (typeof value === 'string') return change(value) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => walk(item, change)) as T;
  if (isPlain(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [change(key), walk(item, change)])
    ) as T;
  }
  return value;
};

export const createVault = (seeds: readonly MaskSeed[]): Vault => {
  const patterns = patternsOf(seeds);
  const matcher =
    patterns.length === 0
      ? undefined
      : new RegExp(patterns.map((pattern) => `(${pattern.source})`).join('|'), 'gu');

  const issued = new Map<string, string>();
  const surfaces = new Map<string, string>();
  const taken = new Set<string>();
  const counts: Record<MaskSeedKind, number> = { name: 0, email: 0, phone: 0, link: 0 };
  let replaced = 0;

  const key = (label: string, number: number): string => `${label}_${number}`;

  const reserve = (...texts: readonly string[]): void => {
    for (const text of texts) {
      for (const found of text.matchAll(PLACEHOLDER)) {
        taken.add(key(found[1]!.toUpperCase(), Number(found[2])));
      }
    }
  };

  const issue = (kind: MaskSeedKind, surface: string): string => {
    const known = issued.get(`${kind}\u0000${surface}`);
    if (known !== undefined) return known;

    const label = LABEL[kind];
    let number = counts[kind];
    do number += 1;
    while (taken.has(key(label, number)));
    counts[kind] = number;

    const placeholder = `[${key(label, number)}]`;
    issued.set(`${kind}\u0000${surface}`, placeholder);
    surfaces.set(key(label, number), surface);
    return placeholder;
  };

  const mask = (text: string): string => {
    if (matcher === undefined) return text;

    reserve(text);
    const folded = fold(text);
    matcher.lastIndex = 0;

    let out = '';
    let last = 0;
    for (const found of folded.matchAll(matcher)) {
      const which = found.findIndex((group, index) => index > 0 && group !== undefined) - 1;
      const start = found.index;
      const end = start + found[0].length;

      out += text.slice(last, start) + issue(patterns[which]!.kind, text.slice(start, end));
      last = end;
      replaced += 1;
    }

    return last === 0 ? text : out + text.slice(last);
  };

  const restore = (text: string): string =>
    surfaces.size === 0
      ? text
      : text.replace(
          PLACEHOLDER,
          (whole, label: string, number: string) =>
            surfaces.get(key(label.toUpperCase(), Number(number))) ?? whole
        );

  return {
    empty: matcher === undefined,
    reserve,
    mask,
    maskDeep: (value) => walk(value, mask),
    restore,
    restoreDeep: (value) => walk(value, restore),
    restorer: (emit) => {
      let held = '';

      return {
        push(fragment) {
          held += fragment;

          // A placeholder has no `[` inside it, so none that began before the last
          // `[` can still be open, and only what follows it can become one.
          const open = held.lastIndexOf('[');
          const pending = open >= 0 && PENDING.test(held.slice(open));
          const settled = pending ? held.slice(0, open) : held;
          held = pending ? held.slice(open) : '';

          if (settled !== '') emit(restore(settled));
        },
        end() {
          // What is held never holds a closing bracket (`PENDING`), so there is
          // no placeholder in it to put right.
          const rest = held;
          held = '';
          if (rest !== '') emit(rest);
        }
      };
    },
    replaced: () => replaced
  };
};
