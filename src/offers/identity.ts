/**
 * Deciding when two links are the same offer.
 *
 * The first of the three dedupes a discovery round needs, and the cheapest: it
 * runs on a URL alone, before anything is fetched, so the offers it removes
 * cost nothing at all. The other two are identity (`company` + `title`, in
 * `OfferRecordStore.findByIdentity`) and text similarity, which needs a vector
 * and therefore only runs on what survives this.
 *
 * ## Why the id is derived from the URL
 *
 * An offer's id has to be stable across rounds, across days and across the
 * process restarting, because the whole point of `offers.jsonl` is that a
 * posting seen again is recognised rather than re-added. A random id would need
 * a lookup table; a hash of the text would change when the employer edits a
 * word; a board's own id is only available on boards this project can parse.
 * The normalised URL is the one identifier that is knowable before the fetch,
 * which is exactly when the round needs it.
 *
 * ## What normalisation removes, and what it must not
 *
 * Tracking parameters are stripped because the same posting arrives with a
 * different `utm_source` from every search, and treating those as different
 * offers would make a standing search re-fetch the same job daily forever.
 *
 * Everything else is left alone, and that restraint matters more than the
 * stripping does. Boards put the offer identity *in* the query string —
 * `?id=1234567` on some, a path slug on others — so an over-eager normaliser
 * that dropped unknown parameters would collapse an entire board into one
 * offer, and the symptom would be a discovery round that finds one job.
 */

import { fingerprint } from '../core/fingerprint.js';

/**
 * Parameters that never identify a posting.
 *
 * A closed list rather than an allowlist, for the reason above: being wrong
 * about a parameter that *is* meaningful loses offers silently, while being
 * wrong about a tracking one only costs a duplicate that the identity dedupe
 * catches later.
 */
const TRACKING = [
  /^utm_/,
  /^ga_/,
  /^_ga/,
  /^gclid$/,
  /^fbclid$/,
  /^msclkid$/,
  /^mc_[ce]id$/,
  /^igshid$/,
  /^ref$/,
  /^referrer$/,
  /^source$/,
  /^src$/,
  /^campaign$/,
  /^trk$/,
  /^spm$/
];

const isTracking = (key: string): boolean => {
  const name = key.toLowerCase();
  return TRACKING.some((pattern) => pattern.test(name));
};

/**
 * The comparable form of an offer URL.
 *
 * Returns `''` for anything that is not an http(s) URL, which the caller reads
 * as "not a candidate" — a search engine returns `mailto:` and `javascript:`
 * often enough to be worth handling here rather than at every call site.
 */
export const normaliseUrl = (raw: string): string => {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    return '';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.protocol = 'https:';
  url.port = '';
  // A fragment is a scroll position. No board serves a different offer at one.
  url.hash = '';

  for (const key of [...url.searchParams.keys()]) {
    if (isTracking(key)) url.searchParams.delete(key);
  }

  // Sorted so that the same parameters in a different order are the same offer,
  // which is the ordinary case when one link came from a board and one from a
  // search engine that rebuilt it.
  url.searchParams.sort();

  // Only a bare trailing slash, and never the one that *is* the path: `/` and
  // `` are the same page, but `/jobs/` and `/jobs` are the same offer too, and
  // no board distinguishes them.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
};

/**
 * The id an offer keeps for as long as it exists.
 *
 * Prefixed so that a record's origin is legible in the file — `offer-` is what
 * a round wrote, and anything else was imported by hand. Hashed rather than
 * stored raw because the URL is already on the record and an id that is also a
 * URL invites string surgery on it.
 */
export const offerId = (url: string): string => {
  const normalised = normaliseUrl(url);
  return normalised ? `offer-${fingerprint(normalised)}` : '';
};
