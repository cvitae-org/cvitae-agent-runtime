/**
 * Which earlier answers a wall reaches.
 *
 * An answer is built from what its run was given, and a record says what that
 * was. When something is excluded after the answer was written, the answer may
 * still carry it, and a conversation that hands the answer back to a model has
 * put the excluded piece in front of one. So an answer built from something now
 * excluded is withheld, and so is an answer built on a withheld one, however many
 * turns back: the taint is followed down the chain, not only one link.
 *
 * Pure, over the records and the walls it is given. Which turn is which, what a
 * record's entry says about earlier turns, and whether a capability's record can
 * be trusted are the caller's, because they are facts about a conversation and
 * this file knows no well.
 *
 * What counts as tainting:
 *
 *   - an `included` entry from the server whose piece is walled, or has a wall
 *     inside it (an entry for a whole scope is touched by a wall on any part of it)
 *   - an `included` entry that carried an earlier answer which is itself withheld
 *
 * What does not:
 *
 *   - a `read` entry: the run read the piece, and nothing says it reached the model
 *   - an entry from the client: the runtime did not read it from a well and does
 *     not vouch for it, so it is outside the guarantee and says so (`origin`)
 *
 * What is withheld without knowing: an answer whose record cannot say what it was
 * given (no record, one that is not closed, a capability that does not record).
 * Not knowing is not a reason to hand it over, so while anything at all is walled
 * such an answer is withheld.
 */

import type { PieceRef, RecordEntry } from '../contracts/index.js';
import { reached } from './book.js';
import { parseRef } from './ref.js';
import { isWalled, wallsWithin } from './walls.js';

/** Whether a wall covers the piece or lies inside it. */
export const touches = (walls: readonly PieceRef[], ref: PieceRef): boolean =>
  isWalled(walls, ref) || wallsWithin(walls, ref).length > 0;

/** What is known of what the run that wrote an answer was given. */
export type Source =
  | { readonly known: false }
  | { readonly known: true; readonly entries: readonly RecordEntry[] };

export type TaintRules = {
  readonly walls: readonly PieceRef[];
  /** What the run behind the answer `key` was given. */
  readonly source: (key: string) => Source;
  /** The keys of the earlier answers an entry carried into a run. Most entries carry none. */
  readonly carried: (entry: RecordEntry) => readonly string[];
};

/** Whether the answer `key` is withheld. Remembers what it has worked out. */
export const createTaint = (rules: TaintRules): ((key: string) => boolean) => {
  const settled = new Map<string, boolean>();
  const visiting = new Set<string>();

  const withheld = (key: string): boolean => {
    if (rules.walls.length === 0) return false;

    const known = settled.get(key);
    if (known !== undefined) return known;

    // An answer cannot be built on itself, so a record that says it was has
    // nothing to trace. Met again while it is being worked out, it is withheld
    // and not looped on: not knowing is not a reason to hand it over.
    if (visiting.has(key)) return true;
    visiting.add(key);

    const source = rules.source(key);
    const result =
      !source.known ||
      source.entries.some((entry) => {
        if (!reached(entry) || entry.origin !== 'server') return false;
        return touches(rules.walls, parseRef(entry.ref)) || rules.carried(entry).some(withheld);
      });

    visiting.delete(key);
    settled.set(key, result);
    return result;
  };

  return withheld;
};
