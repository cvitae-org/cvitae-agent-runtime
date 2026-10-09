/**
 * Which of the offers a message names are compared, and which are left out and why.
 *
 * Decided here and nowhere else, from the ids the message named, so that what a
 * preview says and what a run does are one computation. Nothing here asks a model
 * and nothing is random: the same ids against the same offers give the same list.
 *
 *   excluded   the conversation has left the offer out. Looked at first and by id,
 *              so an excluded offer is never read from the shelf at all.
 *   missing    no saved offer has that id.
 *   board      the offer is already on the Board. It has its own preparation and
 *              its own conversation, so it is not offered again as a candidate.
 *   cut        more offers are left than are compared. The ones seen most recently
 *              stay (`lastSeenAt`, then the offer's id), because nothing writes an
 *              offer's rating yet and recency is the one order the store can vouch for.
 *
 * Each of the four is a list of ids in a fixed order, so a host can say how many
 * and which.
 */

import type { OfferRecord, OfferShelf, PieceRef } from '../../contracts/index.js';
import { COMPARE_LIMIT } from '../../context/ground.js';
import { isWalled } from '../../grounding/index.js';
import { OFFERS_WELL } from './well.js';

export type Left = {
  readonly excluded: readonly string[];
  readonly missing: readonly string[];
  readonly board: readonly string[];
  readonly cut: readonly string[];
};

export type Shortlist = {
  /** The offers compared, most recently seen first. */
  readonly compared: readonly OfferRecord[];
  readonly left: Left;
};

/** How many offers are left out, all reasons together. */
export const leftOut = (left: Left): number =>
  left.excluded.length + left.missing.length + left.board.length + left.cut.length;

/** The address of a whole offer, for asking a wall about it. */
const whole = (offerId: string): PieceRef => ({ well: OFFERS_WELL, scope: offerId, path: [] });

export const shortlist = (
  asked: readonly string[],
  shelf: OfferShelf,
  walls: readonly PieceRef[],
  limit: number = COMPARE_LIMIT
): Shortlist => {
  const excluded = asked.filter((id) => isWalled(walls, whole(id)));
  const open = asked.filter((id) => !excluded.includes(id));

  const found = new Map(shelf.read(open).map((offer) => [offer.id, offer]));
  const missing = open.filter((id) => !found.has(id));

  const onBoard = shelf.onBoard([...found.keys()]);
  const board = open.filter((id) => found.has(id) && onBoard.has(id));

  const eligible = [...found.values()]
    .filter((offer) => !onBoard.has(offer.id))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    compared: eligible.slice(0, limit),
    left: { excluded, missing, board, cut: eligible.slice(limit).map((offer) => offer.id) }
  };
};
