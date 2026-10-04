/**
 * Saved offers as a well.
 *
 * One scope per offer, named by the offer's id. The only thing addressable so far
 * is the captured posting text, as the section `posting`: it is the one part of
 * an offer that reaches a model today, through a snapshot conversation. An offer
 * has no revision of its own, so an entry for it carries no version and the
 * digest says which text it was. Fields, the rating and the analysis join when a
 * capability sends them.
 */

import { formatRef } from '../../grounding/index.js';
import type { WellDef } from '../../grounding/index.js';

export const OFFERS_WELL = 'offers';

export const offersWell: WellDef = {
  id: OFFERS_WELL,
  describe: 'Saved offers. One scope per offer. Only the posting text is addressable so far, as the section posting.'
};

export const POSTING = 'posting';

/** The address of an offer's posting text. */
export const postingRef = (offerId: string): string =>
  formatRef({ well: OFFERS_WELL, scope: offerId, path: [POSTING] });
