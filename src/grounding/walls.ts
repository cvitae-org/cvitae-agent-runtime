/**
 * Wall math: which refs a set of exclusions covers.
 *
 * A wall is a ref with no version, and it covers every ref beneath it: a wall
 * on a section covers the items in that section, a wall on a scope covers all
 * of it. Containment is by whole path segments. A string prefix would let a wall
 * on `billing` cover `billing-faq`, which is a different section.
 *
 * Version and digest play no part. An exclusion follows the live revision of
 * what it names, so a wall set before an edit still holds after it.
 *
 * These are pure functions over refs. Putting them in front of a read is the
 * ports' business, one step later.
 */

import type { PieceRef } from '../contracts/index.js';

const sameScope = (a: PieceRef, b: PieceRef): boolean => a.well === b.well && a.scope === b.scope;

const startsWith = (outer: readonly string[], inner: readonly string[]): boolean =>
  outer.length <= inner.length && outer.every((segment, at) => segment === inner[at]);

/** `outer` covers `inner` when it names the same scope and a leading part of its path. */
export const contains = (outer: PieceRef, inner: PieceRef): boolean =>
  sameScope(outer, inner) && startsWith(outer.path, inner.path);

/** The first wall that covers the ref, so a caller can say which one held it back. */
export const wallFor = (walls: readonly PieceRef[], ref: PieceRef): PieceRef | undefined =>
  walls.find((wall) => contains(wall, ref));

export const isWalled = (walls: readonly PieceRef[], ref: PieceRef): boolean => wallFor(walls, ref) !== undefined;

/**
 * The walls strictly inside a ref.
 *
 * Reading a section is allowed when only an item in it is walled, and the read
 * has to leave that item out. This is how a port learns which ones.
 */
export const wallsWithin = (walls: readonly PieceRef[], ref: PieceRef): PieceRef[] =>
  walls.filter((wall) => sameScope(wall, ref) && wall.path.length > ref.path.length && startsWith(ref.path, wall.path));
