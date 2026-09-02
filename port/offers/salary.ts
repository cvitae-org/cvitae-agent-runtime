/**
 * Turns the salary line of a posting into numbers, or admits it cannot.
 *
 * This exists because `OfferRecord.salary_min` and friends had no writer: the
 * columns were there and every predicate over them was inert. It is
 * deliberately not a model's job. A number that decides whether an offer is
 * shown at all has to be reproducible and inspectable, and extracting `20 000 -
 * 25 000 PLN` is a parsing problem, not a reasoning one — the moment it becomes
 * a generation problem, the posting is deciding its own score.
 *
 * ## What makes it fiddly
 *
 * Nothing here is clever; it is a pile of conventions that collide.
 *
 *   Separators. Polish writes `20 000,50` and English writes `20,000.50`, so
 *   the same comma is a thousands separator in one and a decimal point in the
 *   other. Resolved positionally — a separator followed by exactly three digits
 *   with more to its left is grouping, one followed by one or two digits is a
 *   decimal — rather than by guessing a locale from the surrounding words.
 *
 *   Multipliers. `20-25k` means twenty to twenty-five thousand, with the `k`
 *   written once at the end and applying to both. `tys.` does the same job in
 *   Polish.
 *
 *   Open ranges. `od 20 000` has no ceiling and `do 25 000` has no floor, and
 *   the difference decides whether an offer can be ruled out. Both are stored
 *   as a null on the open side rather than as a repeated bound, so that
 *   `compareSalary` can tell "at least 20k, possibly much more" from "20k".
 *
 * ## What it refuses
 *
 * No currency conversion. An exchange rate is a number that moves, and building
 * it into a score would mean yesterday's ratings quietly disagree with today's
 * for reasons that have nothing to do with the offer or the user. A floor in
 * PLN against a salary in EUR is `unknown`, which is the truthful answer.
 */

import type { SalaryPeriod } from '../store/offerRecord.js';

export type ParsedSalary = {
  /** `null` on an open lower bound, and when nothing was found. */
  min: number | null;
  /** `null` on an open upper bound (`od 20 000`), and when nothing was found. */
  max: number | null;
  /** ISO-ish code — `PLN`, `EUR`, `USD`, `GBP`. `''` when the text did not say. */
  currency: string;
  period: SalaryPeriod;
};

const EMPTY: ParsedSalary = { min: null, max: null, currency: '', period: '' };

/**
 * Currency spellings, longest-first so `zł` is not shadowed by a bare `z`.
 *
 * Symbol and code both, because postings mix them freely and `$` is far more
 * common than `USD` in the ones that use it at all.
 */
const CURRENCIES: [RegExp, string][] = [
  [/\bpln\b|zł|\bzl\b|złoty|zlotych|złotych/, 'PLN'],
  [/\beur\b|€|euro/, 'EUR'],
  [/\busd\b|\$|dolar/, 'USD'],
  [/\bgbp\b|£|funt/, 'GBP']
];

/**
 * Period spellings. Order matters only in that the first match wins.
 *
 * `mies` catches `miesiąc`, `miesięcznie` and the `mies.` abbreviation in one
 * pattern; the accented forms are folded away before this runs.
 */
const PERIODS: [RegExp, SalaryPeriod][] = [
  [/\/\s*h\b|\bh\b|godz|hour|hourly|per hour|stawka godzinowa/, 'hour'],
  [/\/\s*d\b|\bmd\b|dzien|dziennie|daily|per day|day rate|man-?day/, 'day'],
  [/\/\s*mies|mies|miesiac|monthly|per month|\/\s*m\b|\bpm\b/, 'month'],
  [/\/\s*rok|rocznie|annually|annual|per year|\/\s*yr\b|\bp\.?a\.?\b|year/, 'year']
];

/**
 * Folds the text into one comparable form.
 *
 * Accents go because `miesiąc` and `miesiac` are the same word to a pattern,
 * and every dash variant becomes a hyphen because postings use en dashes,
 * em dashes and minus signs interchangeably for ranges. Non-breaking spaces are
 * the ones that actually bite: they survive a copy-paste from a board and are
 * invisible in the file afterwards.
 */
const fold = (raw: string): string =>
  raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .toLowerCase();

/**
 * Reads one number, resolving `.` and `,` by what follows them.
 *
 * A separator with exactly three digits after it and something before it is
 * grouping; anything else is a decimal point. That rule gets `20,000` and
 * `20 000` and `1 500,50` right without knowing which language the posting is
 * in, and gets `1,5` right too — which a locale guess based on the surrounding
 * words would not, since a Polish posting can quote a dollar figure.
 */
const readNumber = (token: string): number | null => {
  const compact = token.replace(/ /g, '');
  const grouped = compact.replace(/[.,](?=\d{3}(?:\D|$))/g, '');
  const normalised = grouped.replace(',', '.');
  const value = Number(normalised);

  return Number.isFinite(value) ? value : null;
};

/** `k` and `tys` both mean a thousand, and both attach to the number's right. */
const MULTIPLIER = /^\s*(k\b|tys\.?)/;

const NUMBER = /\d[\d .,]*\d|\d/g;

/**
 * Digits in the line that are not money.
 *
 * `b2b` is the one that matters and the reason this exists at all: it is the
 * most common word on a Polish salary line and it contains a 2, so without this
 * the parser reads a two-złoty lower bound and every floor comparison passes.
 * Percentages are the same shape of mistake with a bonus clause.
 */
const NOT_MONEY = /\bb2b\b|\d+\s*%/g;

type Amount = { value: number; start: number; end: number; scaled: boolean };

/**
 * Every figure in the text with its position, multiplier already applied.
 *
 * The trailing-`k` rule is why this collects a list before deciding anything:
 * in `20-25k` only the second figure carries the suffix and it is meant for
 * both, so a bare number is scaled up when a later one was scaled — the only
 * reading of `20-25k` that is not absurd. Guarded by `< 1000` so that a genuine
 * `2000-25k` is left alone.
 */
const readAmounts = (text: string): Amount[] => {
  const found: Amount[] = [];

  NUMBER.lastIndex = 0;

  let match: RegExpExecArray | null;

  while ((match = NUMBER.exec(text)) !== null) {
    const value = readNumber(match[0]);
    if (value === null) continue;

    const end = match.index + match[0].length;
    const scaled = MULTIPLIER.test(text.slice(end));

    found.push({ value: scaled ? value * 1000 : value, start: match.index, end, scaled });
  }

  const anyScaled = found.some((amount) => amount.scaled);

  return found.map((amount) =>
    anyScaled && !amount.scaled && amount.value < 1000
      ? { ...amount, value: amount.value * 1000 }
      : amount
  );
};

/**
 * What may sit between the two halves of a range.
 *
 * More than just the dash, because postings repeat the unit on both sides:
 * `$120,000 - $150,000` puts a symbol after the join and `15 tys. - 20 tys.`
 * puts a multiplier before it. Everything permitted here belongs to one of the
 * two figures; anything else means the numbers are not a pair.
 */
const UNIT = String.raw`(?:k\b|tys\.?|[$\u20ac\u00a3]|\bzl\b|z\u0142|\bpln\b|\beur\b|\busd\b|\bgbp\b)`;
const RANGE_JOIN = new RegExp(
  String.raw`^\s*${UNIT}?\s*(?:-|do|to|az do)\s*${UNIT}?\s*$`
);

/**
 * The first adjacent pair of figures joined by a range word.
 *
 * Positional rather than "smallest and largest figure on the line", because a
 * line often carries a second number that is not a bound — a bonus, a headcount,
 * a second range quoted for a different contract. Requiring the two to be
 * adjacent with only a dash between them is what distinguishes `20 000 - 25 000`
 * from `20 000 PLN + 5 000 bonus`.
 */
const findRange = (text: string, amounts: Amount[]): [Amount, Amount] | null => {
  for (let index = 0; index + 1 < amounts.length; index++) {
    const left = amounts[index] as Amount;
    const right = amounts[index + 1] as Amount;

    if (RANGE_JOIN.test(text.slice(left.end, right.start))) return [left, right];
  }

  return null;
};

/** `od 20 000` and `from 20k` state a floor with no ceiling. */
const OPEN_UPWARD = /\b(od|from|min\.?|minimum|starting at|powyzej)\b/;
/** `do 25 000` and `up to 25k` state a ceiling with no floor. */
const OPEN_DOWNWARD = /\b(do|up to|max\.?|maximum|maksymalnie|ponizej)\b/;

/**
 * Reads a posting's salary line.
 *
 * Always returns a shape rather than throwing or returning null, because every
 * field it fills is independently useful: a line that says `PLN, do uzgodnienia`
 * yields a currency and no numbers, and that is a better record than nothing.
 * "Found nothing" is `min === null && max === null && currency === ''`.
 */
export const parseSalary = (raw: string): ParsedSalary => {
  if (!raw.trim()) return { ...EMPTY };

  const text = fold(raw);

  // A posting that says so explicitly is not a parse failure, but it must not
  // be allowed to contribute stray numbers from a nearby sentence either.
  if (/\bnot stated\b|\bnie podano\b|\bdo uzgodnienia\b|\bdo ustalenia\b/.test(text)) {
    const currencyOnly = CURRENCIES.find(([pattern]) => pattern.test(text));
    return { ...EMPTY, currency: currencyOnly?.[1] ?? '' };
  }

  const currency = CURRENCIES.find(([pattern]) => pattern.test(text))?.[1] ?? '';
  const period = PERIODS.find(([pattern]) => pattern.test(text))?.[1] ?? '';

  // Blanked rather than deleted, so that every later offset still lines up with
  // the string the periods and range joins were matched against.
  const money = text.replace(NOT_MONEY, (matched) => ' '.repeat(matched.length));
  const amounts = readAmounts(money);

  if (amounts.length === 0) return { ...EMPTY, currency, period };

  const range = findRange(money, amounts);

  if (range) {
    const [low, high] = range;
    return {
      min: Math.min(low.value, high.value),
      max: Math.max(low.value, high.value),
      currency,
      period
    };
  }

  // No range join, so the other figures on the line are something else. The
  // largest is the salary: a bonus, a headcount or a notice period quoted
  // beside it is smaller, and reading the outer bounds of everything would
  // invent a floor the posting never offered.
  const only = amounts.reduce(
    (best, amount) => (amount.value > best.value ? amount : best),
    amounts[0] as Amount
  ).value;

  if (OPEN_UPWARD.test(text)) return { min: only, max: null, currency, period };
  if (OPEN_DOWNWARD.test(text)) return { min: null, max: only, currency, period };

  return { min: only, max: only, currency, period };
};
