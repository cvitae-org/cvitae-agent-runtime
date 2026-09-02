/**
 * The parts of an application draft that are parsed rather than generated.
 *
 * Same argument as `findSummary`, applied to a different field. The body of a
 * covering email genuinely is not present in the input — that is new prose and
 * the model is the right tool for it. The **recipient address** is the opposite:
 * it is already sitting in the offer text, and a small model asked to copy it
 * out will occasionally produce a plausible address that nobody reads. The cost
 * of that mistake is not a bad sentence, it is an application that was never
 * received, discovered weeks later or never.
 *
 * So the address is extracted with a regex and offered as a *suggestion*, and
 * `analyze_offer`'s `how_to_apply` — which a model wrote — is carried alongside
 * as prose for the user to read, never as a value anything sends to.
 *
 * The second half of this module is the placeholder guard. A small model writing
 * a letter emits `[Your Name]` and `[Company Name]` constantly; it is the single
 * most common defect in this kind of output, it is trivially detectable, and for
 * the ones whose real value is already known the fix is a substitution rather
 * than another model call.
 */

/**
 * Deliberately loose on the local part and strict on the last label, because the
 * text being scanned is a scraped web page rather than a mail header.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Addresses that exist to be written *from*, never to. Writing an application to
 * one is the same outcome as writing to nobody, minus the chance of noticing.
 */
const NOT_A_MAILBOX =
  /^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster|mailer-daemon|bounce)@/i;

/**
 * A trailing label that is a file extension rather than a TLD.
 *
 * Board pages are full of asset URLs, and `logo@2x.png` matches an email regex
 * perfectly — local part `logo`, domain `2x.png`, three alphabetic characters of
 * "TLD". Sprite filenames are the reason this list exists.
 */
const ASSET_SUFFIX =
  /\.(png|jpe?g|gif|svg|webp|avif|css|js|mjs|json|html?|php|pdf|ico|woff2?|ttf|eot|map)$/i;

/** Domains that belong to the page's plumbing rather than to the employer. */
const INFRASTRUCTURE =
  /@(example|test|localhost|sentry\.io|wixpress|sentry-cdn|googlemail\.com\.)/i;

/**
 * Words that mark an address as the one applications go to.
 *
 * Polish and English, because these are the boards this project reads. Used only
 * to order the suggestions — never to discard one, since plenty of small
 * companies publish a plain `kontakt@` or a named recruiter.
 */
const RECRUITING =
  /(recruit|rekrutacj|\bhr\b|kadry|\bjobs?\b|career|kariera|praca|apply|aplikacj|\bcv\b|talent|hiring)/i;

/**
 * Email addresses from the offer, most likely first.
 *
 * Returns every plausible one rather than picking a winner, because the choice
 * belongs to the person applying. A board that lists both a recruiter and a
 * general inbox has given the user a decision to make, and collapsing it here
 * would make it silently.
 */
export const findApplicationEmails = (text: string, limit = 5): string[] => {
  const seen = new Set<string>();
  const found: string[] = [];

  for (const match of text.matchAll(EMAIL)) {
    const address = match[0].toLowerCase().replace(/[.,;:]+$/, '');

    if (seen.has(address)) continue;
    if (ASSET_SUFFIX.test(address)) continue;
    if (NOT_A_MAILBOX.test(address)) continue;
    if (INFRASTRUCTURE.test(address)) continue;

    seen.add(address);
    found.push(address);
  }

  // Stable within each group, so two general inboxes keep the order the page
  // put them in — which is usually the order of importance the employer chose.
  const preferred = found.filter((address) => RECRUITING.test(address));
  const rest = found.filter((address) => !RECRUITING.test(address));

  return [...preferred, ...rest].slice(0, limit);
};

/**
 * Bracketed spans a model left behind.
 *
 * `[…]` and `{{…}}` are what small models actually emit. Angle brackets are
 * included for `<Your Name>` but exclude anything holding an `@` or a `/`, since
 * a quoted address or URL legitimately wears them.
 */
const PLACEHOLDER = /\[[^\]\n]{2,60}\]|\{\{[^}\n]{1,60}\}\}|<[A-Z][^>\n@/]{1,40}>/g;

/** The inner text, reduced so `[Your Name]` and `[YOUR_NAME]` are one key. */
const placeholderKey = (raw: string): string =>
  raw
    .replace(/^[[{<]+|[\]}>]+$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, ' ')
    .trim();

/** What the runtime already knows, and so never has to ask a model to invent. */
export type KnownValues = {
  name?: string;
  company?: string;
  position?: string;
  email?: string;
  phone?: string;
};

const KEYS: { field: keyof KnownValues; matches: RegExp }[] = [
  {
    field: 'name',
    matches: /^(your |candidate |applicant |my )?(full )?(name|imie|imię|imie i nazwisko|imię i nazwisko|nazwisko)$/
  },
  {
    field: 'company',
    matches: /^(the )?(company|company name|employer|organisation|organization|firma|nazwa firmy|pracodawca)$/
  },
  {
    field: 'position',
    matches: /^(the )?(position|role|job title|job|title|position name|stanowisko|nazwa stanowiska)$/
  },
  { field: 'email', matches: /^(your |my )?(e ?mail|email address|adres e ?mail)$/ },
  { field: 'phone', matches: /^(your |my )?(phone|phone number|telephone|telefon|numer telefonu)$/ }
];

export type PlaceholderReview = {
  text: string;
  /** Substitutions actually made, as `[Your Name] → Jan Kowalski`. */
  filled: string[];
  /** Bracketed spans still in the text. Each one is visible to the recipient. */
  remaining: string[];
};

/**
 * Fills the placeholders whose value is already known and reports the rest.
 *
 * Filling rather than re-prompting, because a second model call to insert a name
 * the runtime is holding is both slower and capable of getting it wrong. What
 * cannot be filled is reported rather than deleted: an empty gap where a company
 * name belongs reads as a typo, while `[Company Name]` reads as what it is, and
 * the user needs to see it to fix it.
 */
export const reviewPlaceholders = (
  text: string,
  known: KnownValues
): PlaceholderReview => {
  const filled: string[] = [];

  const substituted = text.replace(PLACEHOLDER, (match) => {
    const key = placeholderKey(match);
    const entry = KEYS.find(({ matches }) => matches.test(key));
    const value = entry ? known[entry.field]?.trim() : undefined;

    if (!value) return match;

    filled.push(`${match} → ${value}`);
    return value;
  });

  const remaining = [...new Set(substituted.match(PLACEHOLDER) ?? [])];

  return { text: substituted, filled, remaining };
};

/**
 * Openings and asides that mean the model addressed the operator, not the
 * recruiter.
 *
 * The failure `findSummary` documents in its other form: asked for a letter, a
 * small model sometimes returns a preamble about writing one. Detectable, and
 * worth naming in a warning rather than shipping into someone's inbox.
 */
const CHATTY_OPENING =
  /^\s*(sure|certainly|of course|okay|ok|here(?:'s| is| you go)|absolutely|no problem)\b/i;

const META_COMMENTARY =
  /\b(as an ai|language model|i cannot|i'm unable|as requested|hope this helps|let me know if)\b/i;

/** A letter shorter than this is a fragment, not a draft. */
const MIN_BODY_WORDS = 40;

export const countWords = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Everything deterministically wrong with a draft, named for a person to read.
 *
 * Warnings rather than failures throughout. A draft with a leftover placeholder
 * is still worth ten times a 500 to someone who was going to read it before
 * sending anyway — and every one of these is visible the moment they do.
 */
export const reviewDraft = ({
  subject,
  body,
  known
}: {
  subject: string;
  body: string;
  known: KnownValues;
}): { subject: string; body: string; warnings: string[]; filled: string[] } => {
  const warnings: string[] = [];

  // A subject is a header, and a newline in a header is the injection `mime.ts`
  // strips at the other end. Flattening here too means the value cvitae shows
  // in its preview is the value that will be sent.
  const cleanSubject = subject.replace(/[\r\n]+/g, ' ').trim();

  const reviewedSubject = reviewPlaceholders(cleanSubject, known);
  const reviewedBody = reviewPlaceholders(body.trim(), known);

  const remaining = [
    ...new Set([...reviewedSubject.remaining, ...reviewedBody.remaining])
  ];

  if (remaining.length > 0) {
    warnings.push(`Unfilled placeholders: ${remaining.join(', ')}.`);
  }

  if (!reviewedSubject.text) {
    warnings.push('The subject line is empty.');
  }

  const words = countWords(reviewedBody.text);

  if (words < MIN_BODY_WORDS) {
    warnings.push(`The body is ${words} words, which is too short to send.`);
  }

  if (CHATTY_OPENING.test(reviewedBody.text)) {
    warnings.push('The body opens by addressing the request rather than the reader.');
  }

  if (META_COMMENTARY.test(reviewedBody.text)) {
    warnings.push('The body contains commentary aimed at the operator.');
  }

  return {
    subject: reviewedSubject.text,
    body: reviewedBody.text,
    warnings,
    filled: [...reviewedSubject.filled, ...reviewedBody.filled]
  };
};
