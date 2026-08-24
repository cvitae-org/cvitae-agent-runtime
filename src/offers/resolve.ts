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
import { refuseUrl } from './page.js';
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

/**
 * Where an offer URL may point.
 *
 * `refuseUrl` was written for the web tier, whose URLs come from a search
 * engine and are therefore nobody's choice. An offer URL looks safer — a person
 * pasted it — but the safety is in who chose it, and by the time it reaches
 * this function that person may be a stranger posting to a runtime someone else
 * is hosting. The reply is turned into text and handed back verbatim, so a URL
 * that resolves to a private address is a way to read whatever answers there.
 *
 * It is applied unconditionally rather than only when the runtime is hosted,
 * because the local deployment has the more interesting targets: cvitae-mail on
 * :8789 holds a Gmail token, and this process's own :8788 would happily analyse
 * its own `/health`. Nothing legitimate is lost — the addresses refused here
 * never serve a job board — and the guard runs again at every redirect, which
 * is the hop that actually gets used.
 */
export const resolveOffer = async (
  url: string,
  signal?: AbortSignal
): Promise<ResolvedOffer> => {
  const refusal = await refuseUrl(url);

  if (refusal) return { status: 'error', detail: refusal };

  const scraped = await scrapeOffer(url, signal);

  if (scraped.status === 'ok') {
    return {
      status: 'ok',
      text: scraped.data.text,
      finalUrl: scraped.data.source_url || url,
      board: scraped.data,
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
  const outcome = await fetchOffer(url, signal, refuseUrl);

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
