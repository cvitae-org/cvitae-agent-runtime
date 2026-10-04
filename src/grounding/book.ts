/**
 * The entries of one run's record, in memory: checked on the way in, equal
 * entries kept once, first-recorded order kept.
 *
 * "Equal" means equal in every field: the same original, at the same version,
 * in the same form, with the same status, origin and channel. A model that reads
 * one item three times leaves one entry. An edit between two reads leaves two,
 * because the digest differs, and the record is where that shows. The same item
 * read by a search and by a direct read leaves two as well: the model was given
 * two different things.
 *
 * Nothing is stored here. The book is what a store loads when a paused run
 * continues, so that what the run already recorded is not recorded twice, and
 * what a store checks an entry against before it writes.
 */

import { ENTRY_ORIGINS, ENTRY_STATUSES, OperationError } from '../contracts/index.js';
import type { RecordEntry } from '../contracts/index.js';
import { canonicalJson } from './canonical.js';
import { isDigest } from './digest.js';
import { encodeSegment, parseRef } from './ref.js';
import type { WellRegistry } from './wells.js';

const VIA = /^[a-z][a-z0-9_.:-]{0,63}$/;

const invalid = (message: string): never => {
  throw new OperationError('invalid_entry', message);
};

/** Two entries with one key are one entry. */
export const entryKey = (entry: RecordEntry): string =>
  canonicalJson([entry.ref, entry.version ?? null, entry.digest, entry.shown ?? null, entry.status, entry.origin, entry.via]);

/**
 * Whether an entry is something the model was given. Anything else, including a
 * status this code has never heard of, is not: a reader of an older or newer
 * record must not count what it cannot name.
 */
export const reached = (entry: { readonly status: string }): boolean => entry.status === 'included';

const normalise = (wells: WellRegistry, entry: RecordEntry): RecordEntry => {
  const ref = parseRef(entry.ref);
  if (ref.version !== undefined || ref.digest !== undefined) {
    invalid('An entry names its original by address; the version and the digest are fields of their own.');
  }
  wells.check(ref);

  if (entry.version !== undefined) encodeSegment(entry.version);
  if (!isDigest(entry.digest)) invalid('An entry needs the digest of its original.');
  if (entry.shown !== undefined && !isDigest(entry.shown)) invalid('An entry\'s shown digest is 16 lower-case hex characters.');
  if (!ENTRY_STATUSES.includes(entry.status)) invalid(`Not an entry status: ${JSON.stringify(entry.status)}.`);
  if (!ENTRY_ORIGINS.includes(entry.origin)) invalid(`Not an entry origin: ${JSON.stringify(entry.origin)}.`);
  if (!VIA.test(entry.via)) invalid(`Not a channel name: ${JSON.stringify(entry.via)}.`);

  return {
    ref: entry.ref,
    ...(entry.version === undefined ? {} : { version: entry.version }),
    digest: entry.digest,
    // Shown only when it differs: what the model got being the whole original is
    // the ordinary case, and one way of saying so keeps equal entries equal.
    ...(entry.shown === undefined || entry.shown === entry.digest ? {} : { shown: entry.shown }),
    status: entry.status,
    origin: entry.origin,
    via: entry.via
  };
};

export interface RecordBook {
  /** Records the entry unless an equal one is already there. True when it was new. */
  add(entry: RecordEntry): boolean;
  /** Everything recorded so far, in the order each entry was first added. */
  entries(): readonly RecordEntry[];
}

/**
 * `existing` is what a store already holds for the run. It was checked when it
 * was written, so it is indexed and not checked again: a record that outlives
 * the well it names must still load.
 */
export const createRecordBook = (wells: WellRegistry, existing: readonly RecordEntry[] = []): RecordBook => {
  const byKey = new Map<string, RecordEntry>();
  for (const entry of existing) byKey.set(entryKey(entry), entry);

  return {
    add(entry) {
      const clean = normalise(wells, entry);
      const key = entryKey(clean);
      if (byKey.has(key)) return false;
      byKey.set(key, clean);
      return true;
    },
    entries: () => [...byKey.values()]
  };
};
