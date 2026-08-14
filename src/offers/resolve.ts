/**
 * Gets the text of an offer, by whichever route can.
 *
 * Two readers sit behind this. the built-in `fetchOffer` is a plain GET and
 * always available; cvitae-scrapper renders pages, follows sitemaps and knows
 * individual boards, but runs as a separate process that may not be up.
 *
 * The order matters less than what each failure means:
 *
 *   scraper unavailable  → it is not running. Says nothing about the offer, so
 *                          fall back to the plain fetch.
 *   scraper failed       → it reached the board and was refused, or found no
 *                          offer. `fetchOffer` is strictly less capable, so
 *                          retrying it would fail too — slower, and with a
 *                          worse message than the one already in hand.
 *   scraper ok           → use it, and keep the board's structured fields.
 */

import { fetchOffer } from './fetch.js';
import { scrapeOffer, type BoardOffer } from './scraper.js';

export type ResolvedOffer =
  | {
      status: 'ok';
      text: string;
      finalUrl: string;
      /** Present only when the scraper read it; absent on the fallback path. */
      board?: BoardOffer;
      via: 'scraper' | 'builtin';
    }
  | { status: 'blocked' | 'empty' | 'error' | 'disallowed' | 'unsupported'; detail: string };

/** Scraper outcome names that are not among cvitae's own fetch statuses. */
const KNOWN_REASONS = new Set([
  'blocked',
  'empty',
  'error',
  'disallowed',
  'unsupported'
]);

export const resolveOffer = async (
  url: string,
  signal?: AbortSignal
): Promise<ResolvedOffer> => {
  const scraped = await scrapeOffer(url, signal);

  if (scraped.status === 'ok') {
    return {
      status: 'ok',
      text: scraped.offer.text,
      finalUrl: scraped.offer.source_url || url,
      board: scraped.offer,
      via: 'scraper'
    };
  }

  if (scraped.status === 'failed') {
    const reason = KNOWN_REASONS.has(scraped.reason)
      ? (scraped.reason as Exclude<ResolvedOffer, { status: 'ok' }>['status'])
      : 'error';
    return { status: reason, detail: scraped.detail };
  }

  // Only reached when the scraper is down or switched off.
  const outcome = await fetchOffer(url, signal);

  if (outcome.status !== 'ok') {
    return { status: outcome.status, detail: outcome.detail };
  }

  return {
    status: 'ok',
    text: outcome.text,
    finalUrl: outcome.finalUrl,
    via: 'builtin'
  };
};
