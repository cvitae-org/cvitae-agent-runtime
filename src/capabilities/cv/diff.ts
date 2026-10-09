/**
 * What changed between two CVs, as a list a person can read and a store can apply.
 *
 * `edit_cv` proposes a whole document, and a host that shows the proposal has to
 * show what is different about it. Every host working that out for itself is how
 * a screen and a save come to disagree, so the difference is made here, once, and
 * it travels with the proposal. An accept applies these changes and nothing else
 * (`storage/sqlite/cv-lifecycle.ts`), so the list a person approved is the list
 * that is written.
 *
 * A change is one of three things, in the vocabulary of a JSON patch and with
 * one addition: it says what it found.
 *
 *   replace  the value at `path` was `before` and is `after`
 *   add      `after` is a new key of an object, or is inserted at an index of a list
 *   remove   the key or the index held `before` and is gone
 *
 * `path` is the keys and the indices from the root of the document, so
 * `["experience", 1, "highlights", 0]` is the first highlight of the second job.
 *
 * **They are applied in order, each to what the one before left.** An index is the
 * index at that moment, which is what lets one list of changes insert two entries
 * and remove a third without any arithmetic on the reader's side, and what keeps
 * the list short: a reorder is not a rewrite of everything after it.
 *
 * **`before` is checked when a change is applied.** A change that finds something
 * else where it expected `before` does not apply, and nothing is written. That is
 * the second line of the revision check an accept already makes, and the one
 * that holds when a store is handed changes it did not make.
 *
 * **Two lists are lined up before they are compared.** Entries that are the same
 * in both stay where they are, and what lies between them is compared in order:
 * the first entry of what went is edited into the first of what came, and the
 * rest are removed or added. A job with a new bullet is one `add`, not seven
 * edits, and an entry moved to the top is a `remove` and an `add` of the same
 * thing, which is what moved it.
 *
 * Pure. Nothing here knows what a CV is except `diffCv` and `applyCv`, which say
 * so in their types.
 */

import { z } from 'zod';
import type { DocumentChange, DocumentValue } from '../../contracts/index.js';
import type { CvDocument } from './document.js';

/* ------------------------------------------------------------------- shapes */

export type Json = DocumentValue;

/** A key of an object, or an index of a list. */
export type Place = string | number;

export type CvChange = DocumentChange;

/** The deepest a path may go. A CV is five levels at most; the rest is a refusal. */
export const PATH_DEPTH = 12;

const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(jsonSchema), z.record(z.string(), jsonSchema)])
);

const pathSchema = z
  .array(z.union([z.string(), z.number().int().min(0)]))
  .min(1, 'A change names a place.')
  .max(PATH_DEPTH);

/** The shape a stored change must have, and the one a host may rely on. */
export const cvChangeSchema: z.ZodType<CvChange> = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replace'), path: pathSchema, before: jsonSchema, after: jsonSchema }).strict(),
  z.object({ op: z.literal('add'), path: pathSchema, after: jsonSchema }).strict(),
  z.object({ op: z.literal('remove'), path: pathSchema, before: jsonSchema }).strict()
]);

export const cvChangesSchema = z.array(cvChangeSchema).max(2_000);

/** A change did not apply. Says where, and never what was there: a CV is personal. */
export class ChangesDoNotApply extends Error {
  constructor(
    /** The position in the list of the change that did not apply. */
    readonly at: number,
    reason: string
  ) {
    super(`Change ${at + 1} does not apply: ${reason}.`);
    this.name = 'ChangesDoNotApply';
  }
}

/* ------------------------------------------------------------------ helpers */

const isList = (value: unknown): value is readonly Json[] => Array.isArray(value);

const isRecord = (value: unknown): value is { readonly [key: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/**
 * A key is set with `defineProperty`, never with `=`: a CV's `links` is a record
 * a person fills in, and a key called `__proto__` has to be a key.
 */
const put = (record: Record<string, Json>, key: string, value: Json): void => {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
};

/** A deep copy of plain data, with `undefined` left out, as JSON would leave it. */
const plain = (value: unknown): Json => {
  if (isList(value)) return value.map(plain);
  if (isRecord(value)) {
    const copy: Record<string, Json> = {};
    for (const key of Object.keys(value)) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner !== undefined) put(copy, key, plain(inner));
    }
    return copy;
  }
  return value === undefined ? null : (value as Json);
};

/** Deep equality of two values of plain data, whatever order an object's keys are in. */
export const same = (a: Json, b: Json): boolean => {
  if (a === b) return true;
  if (isList(a)) return isList(b) && a.length === b.length && a.every((item, index) => same(item, b[index] as Json));
  if (isRecord(a)) {
    if (!isRecord(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => has(b, key) && same(a[key] as Json, b[key] as Json));
  }
  return false;
};

/* --------------------------------------------------------------------- diff */

/**
 * The most the alignment of two lists is allowed to cost, in comparisons. A CV's
 * lists are tens of entries long; a list past this is compared in order instead,
 * which gives a longer answer and the same one every time.
 */
const ALIGN_LIMIT = 250_000;

/**
 * The entries two lists share, as pairs of positions, in order. What is the same at
 * either end is taken first, which is nearly always most of it.
 */
const align = (a: readonly Json[], b: readonly Json[]): [number, number][] => {
  const pairs: [number, number][] = [];

  let head = 0;
  while (head < a.length && head < b.length && same(a[head] as Json, b[head] as Json)) {
    pairs.push([head, head]);
    head += 1;
  }

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    same(a[a.length - 1 - tail] as Json, b[b.length - 1 - tail] as Json)
  ) {
    tail += 1;
  }

  const rows = a.length - head - tail;
  const columns = b.length - head - tail;

  if (rows > 0 && columns > 0 && rows * columns <= ALIGN_LIMIT) {
    // The longest common subsequence of what is left in the middle.
    const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
    for (let r = rows - 1; r >= 0; r -= 1) {
      for (let c = columns - 1; c >= 0; c -= 1) {
        const row = table[r] as number[];
        row[c] = same(a[head + r] as Json, b[head + c] as Json)
          ? ((table[r + 1] as number[])[c + 1] as number) + 1
          : Math.max(((table[r + 1] as number[])[c] as number), row[c + 1] as number);
      }
    }

    let r = 0;
    let c = 0;
    while (r < rows && c < columns) {
      if (same(a[head + r] as Json, b[head + c] as Json)) {
        pairs.push([head + r, head + c]);
        r += 1;
        c += 1;
      } else if (((table[r + 1] as number[])[c] as number) >= ((table[r] as number[])[c + 1] as number)) {
        r += 1;
      } else {
        c += 1;
      }
    }
  }

  for (let k = 0; k < tail; k += 1) pairs.push([a.length - tail + k, b.length - tail + k]);
  return pairs;
};

const diffList = (path: readonly Place[], a: readonly Json[], b: readonly Json[], out: CvChange[]): void => {
  // `at` is where the next entry of `b` sits in the list as it is being rebuilt:
  // everything before it already is what `b` has.
  let at = 0;
  let from = 0;
  let to = 0;

  const gap = (until: readonly [number, number]): void => {
    const gone = a.slice(from, until[0]);
    const came = b.slice(to, until[1]);
    const paired = Math.min(gone.length, came.length);

    for (let k = 0; k < paired; k += 1) diffValue([...path, at + k], gone[k] as Json, came[k] as Json, out);
    // What is left of the shorter side. A removal is always at the same index:
    // the entry after it moves up into it.
    for (let k = paired; k < gone.length; k += 1) {
      out.push({ op: 'remove', path: [...path, at + paired], before: gone[k] as Json });
    }
    for (let k = paired; k < came.length; k += 1) {
      out.push({ op: 'add', path: [...path, at + k], after: came[k] as Json });
    }

    at += came.length;
  };

  for (const pair of [...align(a, b), [a.length, b.length] as [number, number]]) {
    gap(pair);
    if (pair[0] < a.length) {
      at += 1;
      from = pair[0] + 1;
      to = pair[1] + 1;
    }
  }
};

const diffRecord = (
  path: readonly Place[],
  a: { readonly [key: string]: Json },
  b: { readonly [key: string]: Json },
  out: CvChange[]
): void => {
  for (const key of Object.keys(a)) {
    if (has(b, key)) diffValue([...path, key], a[key] as Json, b[key] as Json, out);
    else out.push({ op: 'remove', path: [...path, key], before: a[key] as Json });
  }
  for (const key of Object.keys(b)) {
    if (!has(a, key)) out.push({ op: 'add', path: [...path, key], after: b[key] as Json });
  }
};

const diffValue = (path: readonly Place[], a: Json, b: Json, out: CvChange[]): void => {
  if (same(a, b)) return;
  if (isList(a) && isList(b)) return diffList(path, a, b, out);
  if (isRecord(a) && isRecord(b)) return diffRecord(path, a, b, out);
  out.push({ op: 'replace', path, before: a, after: b });
};

/**
 * What has to be done to the document `a` to make it the document `b`. Empty when
 * they are the same. A document is an object: a change names a place, and the
 * whole of a document is not one.
 */
export const diffJson = (a: unknown, b: unknown): CvChange[] => {
  const [from, to] = [plain(a), plain(b)];
  if (!isRecord(from) || !isRecord(to)) throw new TypeError('A difference is made between two documents.');

  const out: CvChange[] = [];
  diffRecord([], from, to, out);
  return out;
};

/** What has to be done to a CV to make it the other one. */
export const diffCv = (from: CvDocument, to: CvDocument): CvChange[] => diffJson(from, to);

/* -------------------------------------------------------------------- apply */

const where = (path: readonly Place[]): string => path.join('.');

/**
 * The changes, applied in order to a copy of `document`. The document is not
 * touched, and a change that does not apply stops the rest.
 */
export const applyJson = (document: unknown, changes: readonly CvChange[]): Json => {
  const root = plain(document);

  changes.forEach((change, at) => {
    const refuse = (reason: string): never => {
      throw new ChangesDoNotApply(at, reason);
    };

    if (change.path.length === 0 || change.path.length > PATH_DEPTH) refuse('it does not name a place');

    // The place that holds the one named: every step but the last.
    let holder: Json = root;
    for (const step of change.path.slice(0, -1)) {
      if (isList(holder) && typeof step === 'number') {
        if (step >= holder.length) refuse(`${where(change.path)} is not in the document`);
        holder = holder[step] as Json;
      } else if (isRecord(holder) && typeof step === 'string') {
        if (!has(holder, step)) refuse(`${where(change.path)} is not in the document`);
        holder = holder[step] as Json;
      } else {
        return refuse(`${where(change.path)} is not in the document`);
      }
    }

    const last = change.path[change.path.length - 1] as Place;

    if (isList(holder)) {
      if (typeof last !== 'number') return refuse(`${where(change.path)} is not an index of a list`);
      const list = holder as Json[];

      if (change.op === 'add') {
        if (last > list.length) return refuse(`${where(change.path)} is past the end of the list`);
        list.splice(last, 0, plain(change.after));
        return;
      }
      if (last >= list.length) return refuse(`${where(change.path)} is not in the document`);
      if (!same(list[last] as Json, change.before)) return refuse(`${where(change.path)} is not what it was`);
      if (change.op === 'remove') list.splice(last, 1);
      else list[last] = plain(change.after);
      return;
    }

    if (isRecord(holder)) {
      if (typeof last !== 'string') return refuse(`${where(change.path)} is not a key of an object`);
      const record = holder as Record<string, Json>;

      if (change.op === 'add') {
        if (has(record, last)) return refuse(`${where(change.path)} is there already`);
        put(record, last, plain(change.after));
        return;
      }
      if (!has(record, last)) return refuse(`${where(change.path)} is not in the document`);
      if (!same(record[last] as Json, change.before)) return refuse(`${where(change.path)} is not what it was`);
      if (change.op === 'remove') delete record[last];
      else put(record, last, plain(change.after));
      return;
    }

    // The holder is a value, not a place that holds others: `root` is the only
    // thing a path of one step can replace, and a root is never replaced here.
    return refuse(`${where(change.path)} is not in the document`);
  });

  return root;
};

/** A CV with the changes applied, as the document it becomes. */
export const applyCv = (from: CvDocument, changes: readonly CvChange[]): CvDocument =>
  applyJson(from, changes) as unknown as CvDocument;

/* -------------------------------------------------------------------- scope */

/**
 * The changes that touch somewhere other than `key`, which is a key of the
 * document: `experience`, `personal`. An edit is aimed at one section, so its
 * proposal has none.
 */
export const outside = (changes: readonly CvChange[], key: string): CvChange[] =>
  changes.filter((change) => change.path[0] !== key);

/** The keys of the document that the changes touch, in the order they first appear. */
export const touched = (changes: readonly CvChange[]): string[] => [
  ...new Set(changes.map((change) => String(change.path[0])))
];
