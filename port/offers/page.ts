/**
 * Reading a page this project did not choose.
 *
 * Every other fetch here starts from a URL the user pasted or a board
 * published. The web tier's URLs come from a search engine, which means they
 * are chosen by whoever managed to rank for the employer's name — so this path
 * carries two protections the others do not need.
 *
 * **Where it may go.** A hostname that resolves to a private, loopback or
 * link-local address is refused before the request, and again at every redirect
 * (`requestHtml`'s `allow` guard follows the hops by hand for exactly this).
 * Without it, a page that ranks for a company name could answer 302 to
 * `http://169.254.169.254/` and have the response scanned for `@` and shown to
 * the user as evidence. Resolving first is not a complete defence — the address
 * could change between the check and the connection — but it removes the case
 * that costs nothing to attempt.
 *
 * **How fast.** One request per host at a time, spaced. cvitae-scrapper does
 * this properly, with robots.txt and a crawl-delay, and remains the right place
 * for anything resembling a crawl; this reads two or three pages a person is
 * waiting on, and should not need saying twice to the same server.
 */

import { lookup } from 'node:dns/promises';
import { extractVisibleText, isHttpUrl, requestHtml } from './fetch.js';

export type PageOutcome =
  | { status: 'ok'; text: string; finalUrl: string }
  /** Reached, and not worth reading: a challenge, an error, an empty shell. */
  | { status: 'unreadable'; detail: string }
  /** Refused before or during the request. Says something about the URL. */
  | { status: 'refused'; detail: string };

/** Contact blocks sit near the top; the rest is navigation and legal text. */
const MAX_TEXT = 20_000;

/** Below this a 200 is a JavaScript shell, not a page anyone can read. */
const MIN_USEFUL_CHARS = 200;

/** Shorter than an offer's: these are extra pages inside someone's wait. */
const TIMEOUT_MS = 12_000;

const MIN_HOST_INTERVAL_MS = 1_000;

/** Hostnames that never belong to an employer's public site. */
const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|home\.arpa|lan)$/i;

const parseV4 = (value: string): number[] | undefined => {
  const parts = value.split('.');

  if (parts.length !== 4) return undefined;

  const octets = parts.map((part) => Number(part));

  return octets.every(
    (octet, index) =>
      Number.isInteger(octet) &&
      octet >= 0 &&
      octet <= 255 &&
      // Rejects "01" and "0x7f", which resolve as decimal elsewhere.
      String(octet) === parts[index]
  )
    ? octets
    : undefined;
};

/**
 * The IPv4 ranges that are not somewhere on the public internet.
 *
 * Loopback and the link-local metadata address are the ones that matter; the
 * rest are here because a list that covers only the famous cases invites the
 * unfamous one. Carrier-grade NAT (100.64/10) and the benchmark range
 * (198.18/15) reach infrastructure this process should never be asking about.
 */
const isPrivateV4 = (ip: string): boolean => {
  const octets = parseV4(ip);

  if (!octets) return false;

  const [a = 0, b = 0] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    // Multicast, reserved, and broadcast. Nothing serves a careers page here.
    a >= 224
  );
};

const isPrivateV6 = (ip: string): boolean => {
  const address = ip.toLowerCase().split('%')[0] ?? '';

  // `::ffff:127.0.0.1` is loopback wearing an IPv6 hat, and a check that only
  // looked at the prefix would wave it through.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped?.[1]) return isPrivateV4(mapped[1]);

  return (
    address === '::' ||
    address === '::1' ||
    /^f[cd]/.test(address) ||
    /^fe[89ab]/.test(address) ||
    /^ff/.test(address)
  );
};

export const isPrivateAddress = (ip: string): boolean =>
  ip.includes(':') ? isPrivateV6(ip) : isPrivateV4(ip);

/**
 * Whether a URL may be fetched at all.
 *
 * Exported because it is the interesting half of this module to test, and
 * because `verify_recipient` uses it to drop unreachable candidates from the
 * fetch queue before spending a request on them.
 */
export const refuseUrl = async (url: string): Promise<string | undefined> => {
  if (!isHttpUrl(url)) return 'Not an http(s) URL.';

  const { hostname } = new URL(url);
  const host = hostname.replace(/^\[|\]$/g, '');

  if (LOCAL_NAME.test(host)) return `${host} is not a public host.`;

  // An IP literal never needs resolving, and asking a resolver about one is how
  // "127.0.0.1" turns into a successful lookup on some platforms.
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    return isPrivateAddress(host) ? `${host} is not a public address.` : undefined;
  }

  try {
    const addresses = await lookup(host, { all: true });

    if (addresses.length === 0) return `${host} does not resolve.`;

    // Every answer, not the first: a name that resolves to one public address
    // and one loopback address is the standard way around a check like this.
    const blocked = addresses.find((entry) => isPrivateAddress(entry.address));

    return blocked ? `${host} resolves to ${blocked.address}, which is not public.` : undefined;
  } catch {
    return `${host} could not be resolved.`;
  }
};

/** One request per host at a time, spaced by `MIN_HOST_INTERVAL_MS`. */
const hostQueue = new Map<string, Promise<unknown>>();
const hostLastAt = new Map<string, number>();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const perHost = <T>(host: string, run: () => Promise<T>): Promise<T> => {
  const queued = (hostQueue.get(host) ?? Promise.resolve()).then(async () => {
    const wait = (hostLastAt.get(host) ?? 0) + MIN_HOST_INTERVAL_MS - Date.now();

    if (wait > 0) await sleep(wait);

    try {
      return await run();
    } finally {
      hostLastAt.set(host, Date.now());
    }
  });

  // The chain must outlive a rejected turn, or one failure blocks the host.
  hostQueue.set(
    host,
    queued.then(
      () => undefined,
      () => undefined
    )
  );

  return queued;
};

/**
 * Fetches one page and returns its visible text.
 *
 * Never throws, and never distinguishes more than the caller can act on: a page
 * that could not be read is simply not evidence, and the verification carries on
 * with what it has.
 */
export const readWebPage = async (
  url: string,
  signal?: AbortSignal
): Promise<PageOutcome> => {
  let host: string;

  try {
    host = new URL(url).host;
  } catch {
    return { status: 'refused', detail: 'Not a valid URL.' };
  }

  const outcome = await perHost(host, () =>
    requestHtml(url, { signal, timeoutMs: TIMEOUT_MS, allow: refuseUrl })
  );

  if (outcome.status === 'refused') return outcome;

  if (outcome.status !== 'ok') {
    return { status: 'unreadable', detail: outcome.detail };
  }

  const text = extractVisibleText(outcome.html);

  if (text.length < MIN_USEFUL_CHARS) {
    return {
      status: 'unreadable',
      detail: 'The page rendered no readable text on the server.'
    };
  }

  return { status: 'ok', text: text.slice(0, MAX_TEXT), finalUrl: outcome.finalUrl };
};
