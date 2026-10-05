/**
 * What a model may be shown of a CV when parts of it are excluded.
 *
 * An exclusion is a ref with no version (`grounding/walls.ts`). This file is the
 * half that knows a CV: it cuts a document down to what is left, and says what it
 * cut so that an edit can put it back.
 *
 *   original  the document as stored
 *   shown     the document with every excluded piece taken out
 *   rows      for each entry of `shown`, where it sits in `original`
 *   keys      for each entry of `shown`, its key in `original`
 *   withheld  the pieces taken out, with the places they came from
 *
 * The keys are the point. An entry's key is derived from the entries before it
 * (`well.ts`), so computed over `shown` they would drift as soon as anything was
 * cut, and a record would name the wrong item. Everything that reports a piece
 * does it through `keys` and `rows`, which are `original`'s.
 *
 * A piece an exclusion covers is gone from `shown`, not blanked. A list entry is
 * removed. An overview item (name and contact details, the role description, the
 * skills) is emptied in the document and left out of what `read_cv` returns, so
 * the model is not told the CV has no name.
 */

import type { DocumentRecord, PieceRef } from '../../contracts/index.js';
import { isWalled } from '../../grounding/index.js';
import { CV_KIND, emptyDocument } from './document.js';
import type { CvDocument } from './document.js';
import {
  CV_WELL,
  LIST_SECTIONS,
  OVERVIEW,
  OVERVIEW_ITEMS,
  cvKeys,
  cvOf
} from './well.js';
import type { ListSection } from './well.js';

export type OverviewItem = (typeof OVERVIEW_ITEMS)[number];

/**
 * The pieces taken out, as plain data. An edit keeps this beside the document it
 * made, and `restoreCv` puts the pieces back.
 */
export type CvWithheld = {
  /** The overview items cut out, by name, as they were. */
  readonly items: Partial<Record<OverviewItem, unknown>>;
  /** The entries cut out of each list section, with the index each had. Ascending. */
  readonly entries: Readonly<Record<ListSection, readonly { readonly index: number; readonly entry: unknown }[]>>;
  /** What the document says about where it came from, when the whole CV is excluded. */
  readonly sources?: unknown;
};

export type CvView = {
  readonly original: CvDocument;
  readonly shown: CvDocument;
  readonly rows: Readonly<Record<ListSection, readonly number[]>>;
  readonly keys: Readonly<Record<ListSection, readonly string[]>>;
  /** Whether anything was cut. When false, `shown` is `original`. */
  readonly walled: boolean;
  readonly withheld: CvWithheld;
};

const none: CvWithheld = {
  items: {},
  entries: { experience: [], education: [], certificates: [], languages: [] }
};

/** The walls that name this CV, and nothing else. */
export const cvWallsOf = (walls: readonly PieceRef[], scope: string): PieceRef[] =>
  walls.filter((wall) => wall.well === CV_WELL && wall.scope === scope);

/**
 * The view of a document under the walls that name this CV.
 *
 * With no wall that applies the view is the document itself, with its own keys,
 * and every caller reads it the same way.
 */
export const cvView = (document: CvDocument, walls: readonly PieceRef[], scope: string): CvView => {
  const keys = cvKeys(document);
  const mine = cvWallsOf(walls, scope);
  const at = (...path: string[]): PieceRef => ({ well: CV_WELL, scope, path });

  const rows = Object.fromEntries(
    LIST_SECTIONS.map((section) => [section, document[section].map((_, index) => index)])
  ) as Record<ListSection, number[]>;
  const kept = Object.fromEntries(LIST_SECTIONS.map((section) => [section, [...keys[section]]])) as Record<
    ListSection,
    string[]
  >;

  if (mine.length === 0) {
    return { original: document, shown: document, rows, keys: kept, walled: false, withheld: none };
  }

  const blank = emptyDocument();
  const shown: Record<string, unknown> = { ...document };
  const items: Partial<Record<OverviewItem, unknown>> = {};
  const entries: Record<ListSection, { index: number; entry: unknown }[]> = {
    experience: [],
    education: [],
    certificates: [],
    languages: []
  };
  let walled = false;

  for (const item of OVERVIEW_ITEMS) {
    if (isWalled(mine, at(OVERVIEW, item))) {
      items[item] = structuredClone(document[item]);
      shown[item] = blank[item];
      walled = true;
    }
  }

  for (const section of LIST_SECTIONS) {
    const left: unknown[] = [];
    const leftRows: number[] = [];
    const leftKeys: string[] = [];

    document[section].forEach((entry, index) => {
      const key = keys[section][index] as string;
      if (isWalled(mine, at(section, key))) {
        entries[section].push({ index, entry: structuredClone(entry) });
        walled = true;
      } else {
        left.push(entry);
        leftRows.push(index);
        leftKeys.push(key);
      }
    });

    shown[section] = left;
    rows[section] = leftRows;
    kept[section] = leftKeys;
  }

  // `sources` is not a piece of its own; it goes when everything does.
  let sources: unknown;
  if (isWalled(mine, at())) {
    sources = structuredClone(document.sources);
    shown.sources = [];
    walled = true;
  }

  if (!walled) return { original: document, shown: document, rows, keys: kept, walled: false, withheld: none };

  return {
    original: document,
    shown: shown as CvDocument,
    rows,
    keys: kept,
    walled: true,
    withheld: { items, entries, ...(sources === undefined ? {} : { sources }) }
  };
};

/**
 * Whether the piece a path names is in the document now.
 *
 * A selection outlives what it names: a key is derived from what an entry says,
 * so renaming an entry gives it a new key and the old one now names nothing
 * (the plan's O1). A host shows an exclusion that names nothing as gone, and this
 * is how it knows.
 */
export const cvHolds = (document: CvDocument | undefined, path: readonly string[]): boolean => {
  const [section, key] = path;
  // A CV nothing has been written to has no pieces, and the whole of it is there.
  if (document === undefined) return section === undefined;
  if (section === undefined) return true;
  if (section === OVERVIEW) {
    return key === undefined || (OVERVIEW_ITEMS as readonly string[]).includes(key);
  }
  if (!(LIST_SECTIONS as readonly string[]).includes(section)) return false;
  return key === undefined || cvKeys(document)[section as ListSection].includes(key);
};

/**
 * Whether the section an edit is aimed at has nothing the model may be shown.
 *
 * An edit that reaches a section with some of it excluded works on what is left
 * and puts the rest back (`restoreCv`). One with nothing left has no document to
 * edit, and a model handed a blank would write a new section over the excluded
 * one's place: the edit says so instead.
 *
 * `section` is an edit's, so it is one of the three overview items or a list
 * section. A list that is empty of its own has nothing excluded in it, and an
 * edit may fill it, unless the whole section is excluded.
 */
export const cvTargetWalled = (
  walls: readonly PieceRef[],
  scope: string,
  section: string,
  document: CvDocument
): boolean => {
  const mine = cvWallsOf(walls, scope);
  if (mine.length === 0) return false;

  if ((OVERVIEW_ITEMS as readonly string[]).includes(section)) {
    return isWalled(mine, { well: CV_WELL, scope, path: [OVERVIEW, section] });
  }
  if (!(LIST_SECTIONS as readonly string[]).includes(section)) return false;
  if (isWalled(mine, { well: CV_WELL, scope, path: [section] })) return true;

  const listed = section as ListSection;
  return document[listed].length > 0 && cvView(document, walls, scope).shown[listed].length === 0;
};

/**
 * Puts what was cut back into a document that was made from `shown`.
 *
 * Overview items come back as they were, whatever the document now says: the
 * model was never shown them and has no say in them. List entries come back at
 * the index each had, in ascending order, so two cut entries keep their order
 * and an entry whose index is now past the end goes last.
 */
export const restoreCv = (edited: CvDocument, withheld: CvWithheld): CvDocument => {
  const out: Record<string, unknown> = { ...edited };

  for (const item of OVERVIEW_ITEMS) {
    if (item in withheld.items) out[item] = structuredClone(withheld.items[item]);
  }

  for (const section of LIST_SECTIONS) {
    const cut = withheld.entries[section];
    if (cut.length === 0) continue;
    const list = [...edited[section]] as unknown[];
    for (const { index, entry } of cut) list.splice(Math.min(index, list.length), 0, structuredClone(entry));
    out[section] = list;
  }

  if (withheld.sources !== undefined) out.sources = structuredClone(withheld.sources);
  return out as CvDocument;
};

/* ---------------------------------------------------------------- the record */

/**
 * Which view each document record a walled port handed out was cut with.
 *
 * Keyed by the record object itself, so a reader holding the record it was given
 * finds exactly the view that record was made under, whatever has changed since.
 * A record nobody cut has no entry, and `viewOf` makes the identity view.
 */
const made = new WeakMap<object, CvView>();

export const rememberView = (record: DocumentRecord, view: CvView): void => {
  made.set(record, view);
};

/**
 * The view of a record this run's documents port returned: the one it was cut
 * with, or the view of a record nobody cut. Nothing when the record is not a CV
 * or its body does not parse as one, which is for the reader to refuse as it
 * always did.
 */
export const viewOf = (record: DocumentRecord): CvView | undefined => {
  const cut = made.get(record);
  if (cut !== undefined) return cut;
  if (record.kind !== CV_KIND) return undefined;
  const document = cvOf(record.body);
  return document === undefined ? undefined : cvView(document, [], '');
};

/**
 * The CV as it is stored, from a record this run's documents port returned. The
 * one a piece is placed in and named by, whatever of it the model was shown.
 */
export const storedCv = (record: DocumentRecord): CvDocument | undefined => viewOf(record)?.original;
