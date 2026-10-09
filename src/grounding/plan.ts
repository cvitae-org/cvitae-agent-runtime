/**
 * The digest of a plan: what a message is made of before a model is asked,
 * as one value.
 *
 * A preview computes it from the entries a run would record, a run computes it
 * from the entries it did record, and one function does both, so that "the
 * preview equals the send" is a statement about two calls of the same code over
 * the same entries and not about two implementations that agree.
 *
 * What counts is what the message was given and what was held back, by ref and
 * by the digest of each piece: those are what a person approves. Two things are
 * left out on purpose.
 *
 *   what was read   an entry read through a port or handed over by a tool is
 *                   what the model asked for once it was running. It cannot be
 *                   known before, and it is not part of what was approved.
 *   version, via    the version is the revision of the document a piece is part
 *                   of, which moves with an edit to a part nobody asked for; a
 *                   piece that did not change keeps its digest, and the digest
 *                   is what the model sees.
 *                   How a piece came (pinned or attached) says nothing of it.
 *
 * Entries are ordered by ref, so the digest does not depend on the order the
 * pieces happened to be recorded in. It carries no label and no time, because an
 * entry has none.
 */

import type { RecordEntry } from '../contracts/index.js';
import { digest } from './digest.js';

/** Channels whose entries are what the model reached for once it was running. */
const AFTER_THE_START = ['port:', 'tool:'] as const;

/** Whether an entry says what the message was made of, and not what the run later read. */
export const isPrepared = (entry: RecordEntry): boolean =>
  !AFTER_THE_START.some((channel) => entry.via.startsWith(channel));

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const planDigestOf = (entries: readonly RecordEntry[]): string =>
  digest(
    entries
      .filter(isPrepared)
      .map((entry) => ({
        ref: entry.ref,
        digest: entry.digest,
        ...(entry.shown === undefined ? {} : { shown: entry.shown }),
        status: entry.status,
        origin: entry.origin
      }))
      .sort((a, b) => compare(a.ref, b.ref) || compare(a.status, b.status) || compare(a.digest, b.digest))
  );
