/**
 * Saved offers as a well.
 *
 * One scope per offer, named by the offer's id. Two things are addressable. The
 * captured posting text is the section `posting`: it reaches a model through a
 * snapshot conversation. The card is the section `card`: the fields an offer was
 * stored with and the start of its text, as a message that compares offers shows
 * them (`cv/fit.ts`). An offer has no revision of its own, so an entry for either
 * carries no version and the digest says which text it was. The rating and the
 * analysis join when a capability sends them.
 */

import { formatRef } from '../../grounding/index.js';
import type { WellDef } from '../../grounding/index.js';

export const OFFERS_WELL = 'offers';

export const offersWell: WellDef = {
  id: OFFERS_WELL,
  describe: 'Saved offers. One scope per offer. Sections: posting (the captured text) and card (its fields and the start of its text).'
};

export const POSTING = 'posting';

/** The address of an offer's posting text. */
export const postingRef = (offerId: string): string =>
  formatRef({ well: OFFERS_WELL, scope: offerId, path: [POSTING] });

export const CARD = 'card';

/** The address of an offer's card. */
export const cardRef = (offerId: string): string =>
  formatRef({ well: OFFERS_WELL, scope: offerId, path: [CARD] });

/** The address of a whole offer: what an exclusion names, and what a message that was left out of is told. */
export const offerRef = (offerId: string): string =>
  formatRef({ well: OFFERS_WELL, scope: offerId, path: [] });
