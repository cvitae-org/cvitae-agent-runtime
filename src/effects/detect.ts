/**
 * Identifiers found by their shape: the ones a person's CV does not list.
 *
 * `mask.ts` keeps from a model what a person has already said about themselves.
 * This finds what has a shape of its own wherever it turns up — the email of a
 * referee in a pasted CV, a recruiter's phone in a posting, a PESEL in a scanned
 * form's text, an IBAN in an invoice — and hands it to the same vault, so that it
 * is put back in the answer in the same way.
 *
 * **Precision before recall.** A value that is not found is a value that was never
 * known; a number that is taken for an identifier is a number the model cannot
 * read. So each detector asks for more than a run of digits: a checksum (PESEL,
 * NIP, IBAN, a Polish account number), a date that exists, a label that says what
 * the number is (a NIP, a date of birth), or a layout nobody writes an amount in
 * (`22 123 45 67`). What a detector lets through is a number that looks like
 * one and is not checked; what it must never do is take `123 456 789 PLN`, a
 * version `3.11.2` or a year for a person. The corpus in the tests is the list
 * of what was thought of.
 *
 * Every pattern is matched on the folded text of `mask.ts` (lower case, no
 * accents, one code unit for one), so none of them spells a capital or a `ł`, and
 * none of them has a capturing group: the vault tells its seeds apart by group
 * and these are told apart by what they are.
 *
 * What a detector does not do: a name, a street or a city (no shape), anything
 * spelled out in words ("six hundred…"), a number split over a line break, and
 * an identifier in a country this does not know.
 */

export type DetectedKind = 'email' | 'phone' | 'link' | 'id' | 'dob';

export type Detected = {
  readonly kind: DetectedKind;
  readonly start: number;
  readonly end: number;
};

type Detector = {
  readonly name: string;
  readonly kind: DetectedKind;
  /** On folded text. No capturing groups. */
  readonly source: string;
  /** Cheap and necessary: the text has none of this, so the pattern is not run. */
  readonly needs?: RegExp;
  /**
   * How much of what matched is the thing and not only the shape of it, in
   * characters from its start; none when none of it is. Folded text in.
   *
   * More than a yes or a no, because a pattern that takes a run of groups takes
   * the next word too when that is four letters long ("… 2874 more").
   */
  readonly fit?: (matched: string) => number;
};

/** A check that takes all of what matched or none of it. */
const all =
  (check: (matched: string) => boolean) =>
  (matched: string): number =>
    check(matched) ? matched.length : 0;

/* ----------------------------------------------------------------- checksums */

const digitsOf = (text: string): number[] => Array.from(text.replace(/\D/g, ''), Number);

const weighted = (digits: readonly number[], weights: readonly number[]): number =>
  weights.reduce((sum, weight, index) => sum + weight * (digits[index] ?? 0), 0);

/** The days in a month of a year, so that "31.02" is not a date. */
const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * A PESEL: eleven digits, a control digit, and a birth date that exists, with the
 * century carried by the month (1800s +80, 1900s +0, 2000s +20, 2100s +40,
 * 2200s +60). The date is what keeps an eleven-digit order number out.
 */
export const isPesel = (text: string): boolean => {
  const digits = digitsOf(text);
  if (digits.length !== 11) return false;

  const control = (10 - (weighted(digits, [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]) % 10)) % 10;
  if (control !== digits[10]) return false;

  const month = digits[2]! * 10 + digits[3]!;
  const century = [1900, 2000, 2100, 2200, 1800][Math.floor(month / 20)];
  const calendar = month % 20;
  if (century === undefined || calendar < 1 || calendar > 12) return false;

  const day = digits[4]! * 10 + digits[5]!;
  return day >= 1 && day <= daysIn(century + digits[0]! * 10 + digits[1]!, calendar);
};

/** A NIP: ten digits and a control digit. A remainder of ten is no digit, so no NIP has it. */
export const isNip = (text: string): boolean => {
  const digits = digitsOf(text);
  return digits.length === 10 && weighted(digits, [6, 5, 7, 2, 3, 4, 5, 6, 7]) % 11 === digits[9];
};

/** The remainder of a long number written in digits and letters, divided by 97. */
const mod97 = (text: string): number => {
  let remainder = 0;
  for (const char of text) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 87);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
};

const ibanOf = (text: string): string => text.replace(/\s/g, '').toLowerCase();

/** An IBAN: the right length for what it can be, and a remainder of one. */
export const isIban = (text: string): boolean => {
  const iban = ibanOf(text);
  if (iban.length < 15 || iban.length > 34) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
};

/**
 * The IBAN at the start of a run of groups: all of it, or all but the last
 * groups, since the pattern takes a following word of four letters for one.
 */
const fitIban = (matched: string): number => {
  for (let end = matched.length; end > 0; ) {
    if (isIban(matched.slice(0, end))) return end;

    const space = matched.lastIndexOf(' ', end - 1);
    if (space <= 0) return 0;
    end = space;
  }
  return 0;
};

/** A Polish account number written without its `PL`: 26 digits that are an IBAN once it is put on. */
export const isPolishAccount = (text: string): boolean => isIban(`pl${text}`);

/** A date a person could have been born on. */
const isBirthDate = (text: string): boolean => {
  const numbers = text.match(/\d+/g)?.map(Number) ?? [];
  const month = MONTHS.find((name) => text.includes(name.word));

  let day: number | undefined;
  let monthNumber: number | undefined;
  let year: number | undefined;

  if (month !== undefined) {
    // The pattern has a day and a year and nothing else with digits in it.
    [day, year] = numbers;
    monthNumber = month.number;
  } else if (numbers.length === 3) {
    if (numbers[0]! >= 1000) {
      [year, monthNumber, day] = numbers;
    } else {
      // Day first, as it is written here, or month first, as it is in the United States.
      year = numbers[2];
      [day, monthNumber] = isDate(numbers[2]!, numbers[1]!, numbers[0]!) ? [numbers[0], numbers[1]] : [numbers[1], numbers[0]];
    }
  }

  if (day === undefined || monthNumber === undefined || year === undefined) return false;
  return isDate(year, monthNumber, day);
};

/** A day that was, in a year somebody could still have been born in. */
const isDate = (year: number, month: number, day: number): boolean =>
  year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);

/**
 * The digits a number has after its country code, for the countries where that
 * is always the same, so that a number is its first so-many digits and not the
 * count that follows it ("+48 600 700 800 12 times").
 */
const NATIONAL_DIGITS: Readonly<Record<string, number>> = { '48': 9, '44': 10, '1': 10 };

/**
 * A number written with its country code: the right length for the country when
 * the country is known, and from 8 to 15 digits (what E.164 allows, and fewer
 * than 8 is not a phone) when it is not.
 */
const fitInternational = (matched: string): number => {
  const marker = matched.startsWith('00') ? 2 : 1;
  const digits = matched.slice(marker).replace(/\D/g, '');
  const code = Object.keys(NATIONAL_DIGITS).find((known) => digits.startsWith(known));

  if (code === undefined) return digits.length >= 8 && digits.length <= 15 ? matched.length : 0;

  // Too few digits never reaches the count and falls out of the loop as none.
  const need = code.length + NATIONAL_DIGITS[code]!;
  let seen = 0;
  for (let index = marker; index < matched.length; index += 1) {
    if (/\d/.test(matched[index]!)) seen += 1;
    if (seen === need) return index + 1;
  }
  return 0;
};

/* ----------------------------------------------------------------- the words */

/**
 * Each month by the words it is written with, folded. Which of "march" and "mar"
 * is found does not matter, they are the same month, and the pattern backtracks
 * to whichever the text has.
 */
const MONTHS: readonly { readonly word: string; readonly number: number }[] = [
  ['january', 'stycznia', 'styczen', 'jan'],
  ['february', 'lutego', 'luty', 'feb'],
  ['march', 'marca', 'marzec', 'mar'],
  ['april', 'kwietnia', 'kwiecien', 'apr'],
  ['may', 'maja', 'maj'],
  ['june', 'czerwca', 'czerwiec', 'jun'],
  ['july', 'lipca', 'lipiec', 'jul'],
  ['august', 'sierpnia', 'sierpien', 'aug'],
  ['september', 'wrzesnia', 'wrzesien', 'sept', 'sep'],
  ['october', 'pazdziernika', 'pazdziernik', 'oct'],
  ['november', 'listopada', 'listopad', 'nov'],
  ['december', 'grudnia', 'grudzien', 'dec']
].flatMap((words, index) => words.map((word) => ({ word, number: index + 1 })));

const MONTH_WORDS = MONTHS.map((month) => month.word).join('|');

/** Words that say the date after them is one of birth. */
const BIRTH_LABEL =
  '(?<![\\p{L}\\p{N}])(?:date of birth|birth date|birthdate|birthday|d\\.o\\.b\\.?|dob|born'
  + '|data urodzenia|ur\\.|urodzon[ya]|urodzon[ya] dnia|urodz\\.)';

/** What stands between a label and what it labels. */
const LABEL_GAP = '\\s{0,3}[:\\-]?\\s{0,3}';

/** A day, a month and a year, in the orders and spellings people write them. */
const DATE =
  '(?:\\d{1,2}[./\\-]\\d{1,2}[./\\-]\\d{4}'
  + '|\\d{4}[./\\-]\\d{1,2}[./\\-]\\d{1,2}'
  + `|\\d{1,2}(?:st|nd|rd|th)?\\.?\\s+(?:of\\s+)?(?:${MONTH_WORDS})\\.?,?\\s+\\d{4}`
  + `|(?:${MONTH_WORDS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})`;

/** Whatever an amount or a measure is followed by: not a phone number. */
const NOT_AN_AMOUNT = '(?!\\s{0,2}(?:pln|zl|eur|usd|gbp|chf|czk|€|\\$|£|%|kg|km|m2|m²|mb|gb|kb|ms)(?![\\p{L}]))';

/** Not the end of a longer number, and not the tail of a grouped one ("1 600 700 800"). */
const NOT_AFTER_DIGITS = '(?<![\\p{N}+\\-€$£]|\\p{N}[ .,])';
const NOT_BEFORE_DIGITS = '(?![\\p{N}])';

const FILE_ENDINGS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'css', 'js']);

/** `logo@2x.png` has the shape of an address and is not one. */
const isAddress = (text: string): boolean => !FILE_ENDINGS.has(text.slice(text.lastIndexOf('.') + 1));

/* ------------------------------------------------------------------ profiles */

const PATH_END = '[\\p{L}\\p{N}_\\-~%@+/]';
const PATH = `(?:\\/[\\p{L}\\p{N}_\\-.~%@+/]*${PATH_END})?`;
const HOST_BEFORE = '(?<![\\p{L}\\p{N}@.\\-])(?:https?:\\/\\/)?(?:[a-z]{2,3}\\.)?';
const NAME = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}_.\\-]{0,37}[\\p{L}\\p{N}_])?';

const PROFILE_HOSTS = [
  `linkedin\\.com\\/(?:in|pub|profile)\\/${NAME}${PATH}`,
  `(?:github|gitlab)\\.com\\/${NAME}${PATH}`,
  `bitbucket\\.org\\/${NAME}${PATH}`,
  `(?:twitter|x|instagram|facebook|behance|dribbble|tiktok)\\.(?:com|net)\\/@?${NAME}${PATH}`,
  `medium\\.com\\/@${NAME}${PATH}`,
  `stackoverflow\\.com\\/users\\/\\d+${PATH}`,
  `(?:goldenline|pracuj|aplikuj|olx)\\.pl\\/(?:profil|profile|u|user)\\/${NAME}${PATH}`,
  `t\\.me\\/${NAME}`
];

/* ----------------------------------------------------------------- detectors */

const DETECTORS: readonly Detector[] = [
  {
    name: 'email',
    kind: 'email',
    source:
      '(?<![\\p{L}\\p{N}._%+\\-])[\\p{L}\\p{N}._%+\\-]{1,64}@'
      + '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}\\-]{0,61}[\\p{L}\\p{N}])?'
      + '(?:\\.[\\p{L}\\p{N}](?:[\\p{L}\\p{N}\\-]{0,61}[\\p{L}\\p{N}])?)*'
      + '\\.[\\p{L}]{2,24}(?![\\p{L}\\p{N}_\\-]|\\.[\\p{L}\\p{N}])',
    needs: /@/,
    fit: all(isAddress)
  },
  {
    name: 'profile',
    kind: 'link',
    source: `${HOST_BEFORE}(?:${PROFILE_HOSTS.join('|')})(?![\\p{L}\\p{N}])`,
    needs: /\.(?:com|net|org|pl)\/|t\.me\//
  },
  {
    name: 'handle',
    kind: 'link',
    source:
      '(?<=(?<![\\p{L}\\p{N}])(?:github|gitlab|twitter|instagram|telegram|skype|linkedin)\\s{0,2}[:\\-]?\\s{0,2})'
      + '@[\\p{L}\\p{N}_.]{2,30}(?<![.])(?![\\p{L}\\p{N}_])',
    needs: /@/
  },
  {
    name: 'phone with country code',
    kind: 'phone',
    source: `(?<![\\p{N}+])(?:\\+|00)[1-9]\\d{0,2}(?:[ .\\-]?\\(?\\d{1,4}\\)?){2,6}${NOT_BEFORE_DIGITS}`,
    needs: /\+\d|00\d/,
    fit: fitInternational
  },
  {
    name: 'polish mobile',
    kind: 'phone',
    source:
      `${NOT_AFTER_DIGITS}(?:45|50|51|53|57|60|66|69|72|73|78|79|88)\\d(?:[ \\-]?\\d{3}){2}`
      + `${NOT_BEFORE_DIGITS}${NOT_AN_AMOUNT}`,
    needs: /\d{3}/
  },
  {
    name: 'polish landline',
    kind: 'phone',
    source: `${NOT_AFTER_DIGITS}\\(?[1-9]\\d\\)?[ \\-]\\d{3}[ \\-]\\d{2}[ \\-]\\d{2}${NOT_BEFORE_DIGITS}${NOT_AN_AMOUNT}`,
    needs: /\d{2}\)?[ -]\d{3}/
  },
  {
    name: 'us number',
    kind: 'phone',
    source:
      `${NOT_AFTER_DIGITS}(?:\\(\\d{3}\\)[ ]?\\d{3}[ \\-.]\\d{4}|\\d{3}[\\-.]\\d{3}[\\-.]\\d{4})`
      + `${NOT_BEFORE_DIGITS}${NOT_AN_AMOUNT}`,
    needs: /\d{3}[-.)]/
  },
  {
    name: 'uk number',
    kind: 'phone',
    source:
      `${NOT_AFTER_DIGITS}0[1-9](?:\\d{1,3}[ ]\\d{3,4}[ ]\\d{3,4}|\\d{3}[ ]\\d{6})`
      + `${NOT_BEFORE_DIGITS}${NOT_AN_AMOUNT}`,
    needs: /0[1-9]\d* \d{3}/
  },
  {
    name: 'pesel',
    kind: 'id',
    source: '(?<![\\p{N}])\\d{11}(?![\\p{N}])',
    needs: /\d{11}/,
    fit: all(isPesel)
  },
  {
    name: 'nip with a label',
    kind: 'id',
    source:
      '(?<=(?<![\\p{L}\\p{N}])(?:nip|vat(?:[ \\-]?(?:id|no\\.?|number|nr))?|tax[ \\-]?id|ust[ \\-]?id)'
      + '\\s{0,2}[:.\\-#]?\\s{0,2})(?:pl[ ]?)?\\d(?:[ \\-]?\\d){9}(?![\\p{N}])',
    needs: /\d/,
    fit: all(isNip)
  },
  {
    name: 'nip by its layout',
    kind: 'id',
    source:
      '(?<![\\p{L}\\p{N}\\-])(?:pl)?(?:\\d{3}-\\d{3}-\\d{2}-\\d{2}|\\d{3}-\\d{2}-\\d{2}-\\d{3}|(?<=pl)\\d{10})(?![\\p{N}\\-])',
    needs: /\d-\d|pl\d/,
    fit: all(isNip)
  },
  {
    name: 'iban',
    kind: 'id',
    source: '(?<![\\p{L}\\p{N}])[a-z]{2}\\d{2}(?:[ ]?[a-z0-9]{4}){2,7}(?:[ ]?[a-z0-9]{1,4})?',
    needs: /[a-z]{2}\d{2}/,
    fit: fitIban
  },
  {
    name: 'polish account number',
    kind: 'id',
    source: '(?<![\\p{N}])\\d{2}(?:[ ]?\\d{4}){6}(?![\\p{N}])',
    needs: /\d{2}[ ]?\d{4}/,
    fit: all(isPolishAccount)
  },
  {
    name: 'date of birth',
    kind: 'dob',
    source: `(?<=${BIRTH_LABEL}${LABEL_GAP}(?:on\\s+)?)${DATE}`,
    needs: /\d/,
    fit: all(isBirthDate)
  }
];

const COMPILED = DETECTORS.map((detector) => ({ detector, pattern: new RegExp(detector.source, 'gu') }));

/** What the detectors are called, what they find and what they look for, for the tests and the docs. */
export const detectors: readonly { readonly name: string; readonly kind: DetectedKind; readonly source: string }[] =
  DETECTORS.map(({ name, kind, source }) => ({ name, kind, source }));

/**
 * Every span of folded text that a detector takes for an identifier, as a
 * detector sees it and before anything else has a say: spans of different
 * detectors may overlap, and the vault chooses (`mask.ts`).
 */
export const detect = (folded: string, guarded = true): readonly Detected[] => {
  const found: Detected[] = [];

  for (const { detector, pattern } of COMPILED) {
    // A guard is only ever a saving: `guarded = false` is how a test shows that none of them hides anything.
    if (guarded && detector.needs !== undefined && !detector.needs.test(folded)) continue;

    // A pattern that has found nothing more is back at the start of the text.
    for (let match = pattern.exec(folded); match !== null; match = pattern.exec(folded)) {
      const start = match.index;
      const length = detector.fit === undefined ? match[0].length : detector.fit(match[0]);

      if (length > 0) found.push({ kind: detector.kind, start, end: start + length });

      // What a check refused is not used up: a shorter identifier may begin inside
      // it, so the scan goes on from the next character. (It is also what keeps a
      // pattern that took nothing from being asked again for the same place.)
      pattern.lastIndex = start + Math.max(length, 1);
    }
  }

  return found;
};
