/**
 * What a CV says about the pieces an exclusion can name.
 */

import { cvKeys, LIST_SECTIONS, OVERVIEW, OVERVIEW_ITEMS } from './well.js';
import type { ListSection } from './well.js';
import type { CvDocument } from './document.js';

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
