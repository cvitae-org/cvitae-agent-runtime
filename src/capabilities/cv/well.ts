/**
 * The CV as a well: what its pieces are called, and how reading them is recorded.
 *
 * A grounding record names a piece by address and digest and never holds its text
 * (`contracts/grounding.ts`). This file is the half of that which knows a CV: how
 * a document divides into sections and items, what each item is called, and which
 * piece of the document a retrieved passage came from. The engine knows none of
 * it, and the tools and the ports that report a read share this one definition,
 * so a piece is called the same thing whichever way the model got it.
 *
 *   scope    the CV context id
 *   version  the document revision
 *   overview     personal, role_description, skills
 *   experience   one item per entry, keyed `company~title`
 *   education    keyed `university~degree`
 *   certificates keyed by name
 *   languages    keyed by name
 *
 * Keys are derived from what an entry says, so renaming an entry renames its
 * address. That is acceptable for a record, which also carries the revision it
 * read, and it is the thing to settle before an exclusion is allowed to name an
 * item: an exclusion that outlives a rename would silently stop excluding.
 *
 * The digest of a piece is the digest of the piece as the parsed, normalised
 * document holds it (`asCvDocument`), whichever way it was read, so two reads of
 * one piece at one revision agree.
 */

import { OperationError } from '../../contracts/index.js';
import type { EntryStatus, RecordEntry } from '../../contracts/index.js';
import { digest, encodeSegment, formatRef } from '../../grounding/index.js';
import type { WellDef } from '../../grounding/index.js';
import { cvDocumentSchema, normaliseCv } from './document.js';
import type { CvDocument } from './document.js';

export const CV_WELL = 'cv';

export const cvWell: WellDef = {
  id: CV_WELL,
  describe:
    'A CV. One scope per CV context, versioned by the document revision. '
    + 'Sections: overview, experience, education, certificates, languages.'
};

export const OVERVIEW = 'overview';
export const OVERVIEW_ITEMS = ['personal', 'role_description', 'skills'] as const;
export const LIST_SECTIONS = ['experience', 'education', 'certificates', 'languages'] as const;
export type ListSection = (typeof LIST_SECTIONS)[number];

const isListSection = (section: string): section is ListSection =>
  (LIST_SECTIONS as readonly string[]).includes(section);

/* -------------------------------------------------------------------- keys */

/** The longest a part of a key may be once it is written into an address. */
const PART_LIMIT = 200;

const slug = (text: string): string => {
  const plain = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+/, '');

  // Cut by what the address will cost and not by how many characters there are:
  // a CJK title is one third as long as the bytes it is written in, and an
  // address has a ceiling.
  let kept = [...plain].slice(0, 100);
  while (kept.length > 0 && encodeSegment(kept.join('')).length > PART_LIMIT) kept = kept.slice(0, -1);

  // The end is trimmed last, because the cut may have left a separator there
  // whether or not the name had one.
  return kept.join('').replace(/-+$/, '');
};

/** `acme~senior-engineer`; `entry` for an entry that says nothing a key can be made of. */
const keyOf = (parts: readonly string[]): string =>
  parts.map(slug).filter((part) => part !== '').join('~') || 'entry';

/**
 * One key for each row, in the rows' order. A key already taken gets `-2`, then
 * `-3`: two rows never share an address, and the same document always gives the
 * same keys.
 */
const keysOf = (rows: readonly (readonly string[])[]): string[] => {
  const taken = new Set<string>();

  return rows.map((parts) => {
    const base = keyOf(parts);
    let key = base;
    let count = 1;
    while (taken.has(key)) {
      count += 1;
      key = `${base}-${count}`;
    }
    taken.add(key);
    return key;
  });
};

/** The key of every entry of every list section, parallel to the section's array. */
export const cvKeys = (document: CvDocument): Readonly<Record<ListSection, readonly string[]>> => ({
  experience: keysOf(document.experience.map((entry) => [entry.company, entry.title])),
  education: keysOf(document.education.map((entry) => [entry.university, entry.degree])),
  certificates: keysOf(document.certificates.map((entry) => [entry.name])),
  languages: keysOf(document.languages.map((entry) => [entry.name]))
});

/** The address of a piece: the whole scope with no section, a section, or an item. */
export const cvRef = (scope: string, section?: string, key?: string): string =>
  formatRef({
    well: CV_WELL,
    scope,
    path: section === undefined ? [] : key === undefined ? [section] : [section, key]
  });

/* ----------------------------------------------------------------- entries */

/** How one read is described: its status, its channel, and what the model got of it. */
export type CvRead = {
  readonly status: EntryStatus;
  readonly via: string;
  /** What the model received of the piece when that is not all of it. */
  readonly shown?: unknown;
};

type Place = { readonly section?: string; readonly key?: string };

const entry = (scope: string, revision: number, place: Place, original: unknown, how: CvRead): RecordEntry => ({
  ref: cvRef(scope, place.section, place.key),
  version: String(revision),
  digest: digest(original),
  // Compared by digest in the record book, which drops it when it is the whole.
  ...(how.shown === undefined ? {} : { shown: digest(how.shown) }),
  status: how.status,
  origin: 'server',
  via: how.via
});

/** The document as a CV, or nothing when the body is not one, which the reader then reports itself. */
export const cvOf = (body: Readonly<Record<string, unknown>>): CvDocument | undefined => {
  const parsed = cvDocumentSchema.safeParse(body);
  return parsed.success ? normaliseCv(parsed.data) : undefined;
};

/**
 * The whole CV, read. The extent that reached a model is not known here, so
 * there is no `shown`.
 */
export const cvWholeEntry = (scope: string, revision: number, document: CvDocument, how: CvRead): RecordEntry =>
  entry(scope, revision, {}, document, how);

/**
 * What one `read_cv` call handed to the model: the pieces in `data`, each with
 * what was kept of it.
 *
 * `data` is the bounded copy the tool returned, and the originals come from the
 * document the copy was made from. A piece the copy has no room for was not
 * handed over and has no entry; one it clipped has a `shown` digest of what is
 * left.
 */
export const cvReadEntries = (
  scope: string,
  revision: number,
  document: CvDocument,
  request: { readonly section: string; readonly offset: number },
  data: unknown,
  via: string
): RecordEntry[] => {
  const how = (shown: unknown): CvRead => ({ status: 'included', via, shown });
  const given = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};

  if (request.section === OVERVIEW) {
    return OVERVIEW_ITEMS.flatMap((key) =>
      given[key] === undefined
        ? []
        : [entry(scope, revision, { section: OVERVIEW, key }, document[key], how(given[key]))]
    );
  }

  if (!isListSection(request.section)) {
    throw new OperationError(
      'invalid_entry',
      `A read reported the section ${JSON.stringify(request.section)}, and the CV well has no such section.`
    );
  }

  const section = request.section;
  const keys = cvKeys(document)[section];
  const items: unknown[] = Array.isArray(given.items) ? given.items : [];

  return items.flatMap((shown, index) => {
    const at = request.offset + index;
    const key = keys[at];
    return key === undefined ? [] : [entry(scope, revision, { section, key }, document[section][at], how(shown))];
  });
};

/** A retrieved passage, as far as placing it in the document needs. */
export type CvHit = {
  readonly kind: string;
  readonly text: string;
  readonly meta: Readonly<Record<string, unknown>>;
};

/**
 * Where in the document a passage came from, when the document still agrees.
 *
 * A passage says which entry it was cut from by position, and a position moves
 * when the document is edited, so the employer and the title it was indexed
 * under have to match what the document holds there now. When they do not, the
 * passage cannot be placed and the caller records the whole CV instead, which is
 * less precise and never wrong.
 */
const placer = (document: CvDocument) => {
  const keys = cvKeys(document);

  return (hit: CvHit): { place: Place; original: unknown } | undefined => {
    const { meta } = hit;

    if (meta.section === 'role_description' && document.role_description.trim() !== '') {
      return { place: { section: OVERVIEW, key: 'role_description' }, original: document.role_description };
    }

    if (meta.section === 'experience' && typeof meta.entry === 'number') {
      const row = document.experience[meta.entry];
      const key = keys.experience[meta.entry];
      if (row !== undefined && key !== undefined && row.company === meta.company && row.title === meta.title) {
        return { place: { section: 'experience', key }, original: row };
      }
    }

    return undefined;
  };
};

/**
 * One entry for each retrieved passage: the piece it came from at this revision
 * when it can be placed, the whole CV when it cannot.
 *
 * With `passage` set, the entry says the model received the passage, which is a
 * part of the piece and so always has a `shown` digest of the passage text.
 */
export const cvHitEntries = (
  scope: string,
  revision: number,
  document: CvDocument,
  hits: readonly CvHit[],
  how: { readonly status: EntryStatus; readonly via: string; readonly passage: boolean }
): RecordEntry[] => {
  const place = placer(document);

  return hits.map((hit) => {
    const found = place(hit);
    const read: CvRead = {
      status: how.status,
      via: how.via,
      ...(how.passage ? { shown: hit.text } : {})
    };
    return found === undefined
      ? entry(scope, revision, {}, document, read)
      : entry(scope, revision, found.place, found.original, read);
  });
};
