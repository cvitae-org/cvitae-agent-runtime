/**
 * What an edit is aimed at, as a ref.
 *
 * An edit changes one section of a CV, and a section already has an address: the
 * ref that an exclusion, a pin and a record's entry call it by (`well.ts`). So the
 * edit is aimed with that ref rather than with a second spelling of it, and the
 * wall that keeps a section out of a conversation is asked about the very string
 * the edit arrived with.
 *
 *   cv:<scope>/overview/personal     an item of the overview: personal,
 *                                    role_description or skills
 *   cv:<scope>/experience            a list section: experience, education,
 *                                    certificates or languages
 *
 * An entry of a list (`cv:<scope>/experience/acme~dev`) is not a target. Editing
 * one entry in place and putting it back is a different edit from the one that
 * returns a whole section (the plan's "item-level edit swap"), and a target that
 * named an entry would promise it. It is refused, and says what to name.
 */

import { OperationError } from '../../contracts/index.js';
import { formatRef, parseRef } from '../../grounding/index.js';
import { CV_WELL, LIST_SECTIONS, OVERVIEW, OVERVIEW_ITEMS, cvRef } from './well.js';

const isItem = (name: string): boolean => (OVERVIEW_ITEMS as readonly string[]).includes(name);
const isList = (name: string): boolean => (LIST_SECTIONS as readonly string[]).includes(name);

/** The ref of a section of the CV with this scope, as an edit is aimed at it. */
export const targetOf = (scope: string, section: string): string =>
  isItem(section) ? cvRef(scope, OVERVIEW, section) : cvRef(scope, section);

/**
 * The section a ref names, for the edit of the CV with this scope.
 *
 * Refused as `invalid_selection`, and not read as anything else, when the ref is
 * of another well, of another CV, of the whole CV, of an entry, or of something
 * that is not a section: an edit that guessed which section was meant would be
 * the one that rewrites the wrong one.
 */
export const sectionOf = (text: string, scope: string): string => {
  const ref = parseRef(text);
  const [first, second, ...rest] = ref.path;

  const section =
    first === OVERVIEW && second !== undefined && isItem(second) && rest.length === 0
      ? second
      : first !== undefined && isList(first) && second === undefined
        ? first
        : undefined;

  if (ref.well !== CV_WELL || ref.scope !== scope || section === undefined) {
    throw new OperationError(
      'invalid_selection',
      `An edit is aimed at a section of this conversation's own CV, such as ${targetOf(scope, 'experience')} or ${targetOf(scope, 'skills')}, and ${formatRef({ well: ref.well, scope: ref.scope, path: ref.path })} is not one.`
    );
  }

  // A version or a digest names a revision of the section; the edit is made on
  // the revision that is stored, whatever a client last saw of it.
  return section;
};
