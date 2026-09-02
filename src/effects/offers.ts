/**
 * Reading the public web: the offer a user pasted, and the pages that say
 * whether an application to it would reach the employer.
 *
 * Three things are folded together here because they are one decision, not
 * three: where a URL is allowed to point, how a page becomes text, and which of
 * two readers gets to try.
 *
 * **Where it may point.** Every URL is checked before the request and again at
 * every redirect. In the previous runtime the guard was optional and normally
 * absent, on the reasoning that a person pasting a URL into their own machine
 * could have opened it in a browser anyway. That reasoning holds exactly as
 * long as the runtime has one user. The moment it is reachable over IPC from a
 * window showing someone else's link — or over any host added later — the URL
 * is a stranger's, and fetching it means turning the reply into text and
 * handing it straight back. That is server-side request forgery in the
 * ordinary sense, and the local deployment has the more interesting targets:
 * this process's own database file is not reachable over HTTP, but a companion
 * service on loopback is.
 *
 * So the guard is unconditional. Nothing legitimate is lost, because the
 * addresses it refuses never serve a job board, and the cost of being wrong in
 * the other direction is a private page read aloud.
 *
 * **How a page becomes text.** Markup out, furniture out, entities decoded,
 * capped. The tag list is deliberately short — see `CHROME_TAGS`.
 *
 * **Which reader.** A companion scraper renders pages, follows sitemaps and
 * knows individual boards; it is a separate process that may not be running, so
 * this is written to work without it. What it buys when it is up is the boards a
 * plain GET cannot read, plus the fields the board stated itself. Those fields
 * come back here **uninterpreted**: deciding that a stated salary beats a
 * model's reading of the same page is domain judgment, and it happens in
 * `capabilities/`.
 *
 * **Two ports, one object.** This builds an `OfferReader & SiteReader`. The
 * split is real to a capability — opening three pages a search engine ranked
 * is a wider authority than fetching the posting in front of the user, and a
 * step should have to name it — but there is exactly one host politeness map,
 * one SSRF guard and one scraper client here, because two of any of them is
 * the bug each is there to prevent. Two limiters spacing the same host at a
 * second each is two requests a second.
 */

import { lookup } from 'node:dns/promises';
import { RuntimeError } from '../contracts/index.js';
import type {
  CompanyPage,
  CompanySite,
  EffectCall,
  Listing,
  OfferReader,
  ResolvedOffer,
  SiteOutcome,
  SiteReader,
  StatedFacts,
  StatedRoutes
} from '../contracts/index.js';

/* ------------------------------------------------ where a URL may point */

/** Hostnames that never belong to an employer's public site. */
const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|home\.arpa|lan)$/i;

const parseV4 = (value: string): number[] | undefined => {
  const parts = value.split('.');

  if (parts.length !== 4) return undefined;

  const octets = parts.map((part) => Number(part));

  return octets.every(
    (octet, index) =>
      Number.isInteger(octet)
      && octet >= 0
      && octet <= 255
      // Rejects "01" and "0x7f", which some resolvers read as decimal.
      && String(octet) === parts[index]
  )
    ? octets
    : undefined;
};

/**
 * The IPv4 ranges that are not somewhere on the public internet.
 *
 * Loopback and the link-local metadata address are the ones that matter; the
 * rest are here because a list covering only the famous cases invites the
 * unfamous one. Carrier-grade NAT (100.64/10) and the benchmark range
 * (198.18/15) both reach infrastructure this process should never be asking
 * about.
 */
const isPrivateV4 = (ip: string): boolean => {
  const octets = parseV4(ip);

  if (!octets) return false;

  const [a = 0, b = 0] = octets;

  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 198 && (b === 18 || b === 19))
    // Multicast, reserved, broadcast. Nothing serves a careers page here.
    || a >= 224
  );
};

const isPrivateV6 = (ip: string): boolean => {
  const address = ip.toLowerCase().split('%')[0] ?? '';

  // `::ffff:127.0.0.1` is loopback wearing an IPv6 hat, and a check that read
  // only the prefix would wave it through.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped?.[1]) return isPrivateV4(mapped[1]);

  return (
    address === '::'
    || address === '::1'
    || /^f[cd]/.test(address)
    || /^fe[89ab]/.test(address)
    || /^ff/.test(address)
  );
};

export const isPrivateAddress = (ip: string): boolean =>
  ip.includes(':') ? isPrivateV6(ip) : isPrivateV4(ip);

export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/** Resolves a hostname to every address it answers with. Injectable for tests. */
export type HostResolver = (host: string) => Promise<readonly string[]>;

const systemResolver: HostResolver = async (host) => {
  const addresses = await lookup(host, { all: true });
  return addresses.map((entry) => entry.address);
};

/**
 * Why a URL may not be fetched, or `undefined` if it may.
 *
 * Resolving first is not a complete defence — the address can change between
 * the check and the connection, which is the classic rebinding window — but it
 * removes the case that costs an attacker nothing to attempt.
 */
export const refuseUrl = async (
  url: string,
  resolveHost: HostResolver = systemResolver
): Promise<string | undefined> => {
  if (!isHttpUrl(url)) return 'Not an http(s) URL.';

  const { hostname } = new URL(url);
  const host = hostname.replace(/^\[|\]$/g, '');

  if (LOCAL_NAME.test(host)) return `${host} is not a public host.`;

  // An IP literal never needs resolving, and asking a resolver about one is how
  // "127.0.0.1" turns into a successful lookup on some platforms.
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    return isPrivateAddress(host) ? `${host} is not a public address.` : undefined;
  }

  let addresses: readonly string[];

  try {
    addresses = await resolveHost(host);
  } catch {
    return `${host} could not be resolved.`;
  }

  if (addresses.length === 0) return `${host} does not resolve.`;

  // Every answer, not the first: a name that resolves to one public address and
  // one loopback address is the standard way around a check like this.
  const blocked = addresses.find((address) => isPrivateAddress(address));

  return blocked ? `${host} resolves to ${blocked}, which is not public.` : undefined;
};

/* ---------------------------------------------- how a page becomes text */

/**
 * The two elements that hold page furniture and nothing else.
 *
 * Left in, their text is extracted as though the offer had said it: one board's
 * apply widget put "Aplikuj Zapisz ofertę Analiza CV BETA" into `how_to_apply`,
 * and its `<nav>` put a pricing menu in front of the model.
 *
 * Deliberately short. Stripping `<aside>`, `<footer>` and `<header>` as well,
 * or narrowing to `<main>`, cuts the text by 36% and measurably degrades
 * extraction: that board keeps the company description in an `<aside>`
 * (`company_type` went from a real answer to "Not stated") and the job title in
 * a `<header>`, and across three runs per variant it tripled the garbled values
 * in `team`. The furniture and the offer are interleaved, so removing
 * containers wholesale takes the offer with them. The saving is ~4% of the
 * prompt — this is an accuracy decision, not a speed one.
 */
const CHROME_TAGS = ['nav', 'button'] as const;

const stripElements = (html: string, tags: readonly string[]): string =>
  tags.reduce(
    (acc, tag) => acc.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' '),
    html
  );

const flatten = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // The non-breaking space is written as an escape rather than as the
    // literal character it looks like. HTML is full of real ones, and an
    // extractor that leaves them in hands the model words glued together by
    // a character nobody can see.
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

/** Markup, scripts and styles out; what a reader would see, in. */
export const extractVisibleText = (html: string): string =>
  flatten(
    stripElements(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' '),
      CHROME_TAGS
    )
  );

const CHALLENGE_MARKERS = [
  'just a moment',
  'enable javascript and cookies',
  'cf-browser-verification',
  'cf_chl_opt',
  'attention required',
  'checking your browser'
];

const looksLikeChallenge = (html: string): boolean => {
  const head = html.slice(0, 4000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => head.includes(marker));
};

/* ------------------------------------------------------------- settings */

/** Below this, a 200 is a JavaScript shell rather than a readable offer. */
const MIN_USEFUL_CHARS = 400;

/** Keeps a pathological page from swallowing the model's context. */
const MAX_TEXT_CHARS = 20_000;

const FETCH_TIMEOUT_MS = 15_000;

/**
 * The same fetch, on a shorter clock, for a page nobody asked for.
 *
 * An offer is the thing the run is about and is worth waiting on. A careers
 * page a search engine ranked third is a guess, several of them are opened per
 * run, and each one that hangs spends its budget before the ranking step ever
 * sees the others. Cheaper to give up on a slow maybe.
 */
const PAGE_TIMEOUT_MS = 12_000;

/**
 * Below this a page is a shell — but the floor is half the offer's.
 *
 * A posting that renders 300 characters rendered nothing. A `/kontakt` page
 * that renders 300 characters is a contact page: an address, a phone number
 * and a street, which is the entire content and also the most useful page on
 * the site for this purpose. The offer's floor applied here would discard
 * exactly the pages worth opening.
 */
const PAGE_MIN_CHARS = 200;

/**
 * Reading a company's site is several fetches, not one.
 *
 * A homepage, the careers and contact pages it links to, and — when only a
 * name is known — a round of probes first. Measured in the previous runtime at
 * 31s against a 30s ceiling, which failed in the least useful way available:
 * the scraper answered correctly and nobody was still listening. Sized for the
 * work rather than for one page.
 */
const COMPANY_TIMEOUT_MS = 60_000;

/**
 * Long enough for the scraper's browser path (a rendered board runs to ~30s),
 * short enough to leave the analysis calls room inside a run's budget.
 */
const SCRAPER_TIMEOUT_MS = 30_000;

/** How many hops to follow, given that this is the one doing the following. */
const MAX_REDIRECTS = 4;

const MIN_HOST_INTERVAL_MS = 1_000;

// Sent so boards return their normal page rather than a stripped one. Not an
// attempt to defeat bot detection: a challenge is reported, never bypassed.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_SCRAPER_URL = 'http://127.0.0.1:8787';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The companion scraper's address, checked to be loopback.
 *
 * The rule looks like the one guarding a local model server and exists for a
 * different reason, which is why it is written out rather than shared: there,
 * a remote URL would spend our credential; here, it would post every offer URL
 * a user analyses to a host they did not choose. Unset means the default port;
 * explicitly empty means the scraper is switched off.
 */
const scraperBase = (configured: string | undefined): string => {
  if (configured === undefined) return DEFAULT_SCRAPER_URL;

  const value = configured.trim();

  if (!value) return '';

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new RuntimeError(`SCRAPER_URL "${value}" is not a valid URL.`, 'misconfigured');
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new RuntimeError(
      `SCRAPER_URL must point at localhost, not "${url.hostname}".`,
      'misconfigured'
    );
  }

  return url.toString().replace(/\/$/, '');
};

/* ----------------------------------------------------- what the scraper says */

/** Mirrors the scraper's offer shape. Optional means the board was silent. */
type BoardOffer = {
  board: string;
  source_url: string;
  /** 'api' | 'jsonld' | 'html' | 'browser' — how much to trust the text. */
  extraction: string;
  title: string;
  company?: string;
  location?: string;
  work_mode?: string;
  salary?: string;
  contract_type?: string;
  seniority?: string;
  posted_at?: string;
  /** When the work begins ("ASAP"). Not to be confused with `posted_at`. */
  start_date?: string;
  required_skills?: string[];
  /** The employer's site, as the board published it in its schema.org markup. */
  company_url?: string;
  /** The address the board itself states applications go to. Rare, and best. */
  application_email?: string;
  /** A form or ATS link the board states. The right answer when there is no email. */
  apply_url?: string;
  text: string;
};

/**
 * The outcomes the scraper names, all of them final.
 *
 * Every one means it reached a decision about this offer: the board refused
 * (`blocked`), robots.txt forbade the path (`disallowed`), it will not crawl
 * that board at all (`unsupported`), the page held no offer (`empty`), or the
 * board itself failed (`error`). None is improved by retrying with a plain GET,
 * and two would be actively wrong to retry.
 */
const REFUSALS = new Set(['blocked', 'disallowed', 'unsupported', 'empty', 'error']);

/**
 * What a board stated, narrowed to the fields `StatedKey` admits.
 *
 * `contract_type` is dropped on purpose. Naming the set in `contracts/offer.ts`
 * rather than copying whatever the scraper happens to emit is what keeps "the
 * board wins" from silently widening when either side grows a field.
 */
const statedFrom = (offer: BoardOffer): StatedFacts | undefined => {
  const stated: Record<string, unknown> = {};
  const put = (key: string, value: string | string[] | undefined): void => {
    if (typeof value === 'string' && value.trim()) stated[key] = value.trim();
    if (Array.isArray(value) && value.length > 0) stated[key] = value;
  };

  put('company', offer.company);
  put('title', offer.title);
  put('location', offer.location);
  put('work_mode', offer.work_mode);
  put('salary', offer.salary);
  put('seniority', offer.seniority);
  put('start_date', offer.start_date);
  put('required_skills', offer.required_skills);

  return Object.keys(stated).length > 0 ? (stated as StatedFacts) : undefined;
};

/**
 * The routing fields, renamed and otherwise untouched.
 *
 * No validation, deliberately. A `company_url` that does not parse and an
 * `application_email` with no `@` are both facts about the board's markup, and
 * the place that can act on them is the ranking step that weighs every
 * candidate address against every other. Rejecting them here would turn "the
 * board published something odd" into "the board published nothing", which is
 * a different and less true thing to tell the caller.
 */
const routesFrom = (offer: BoardOffer): StatedRoutes | undefined => {
  const routes: Record<string, string> = {};
  const put = (key: string, value: string | undefined): void => {
    if (typeof value === 'string' && value.trim()) routes[key] = value.trim();
  };

  put('companyUrl', offer.company_url);
  put('applicationEmail', offer.application_email);
  put('applyUrl', offer.apply_url);

  return Object.keys(routes).length > 0 ? (routes as StatedRoutes) : undefined;
};

/** Mirrors the scraper's company shape, which is snake_case on the wire. */
type ScrapedCompany = {
  origin?: string;
  redirected_from?: string;
  discovered?: boolean;
  corroborated?: boolean;
  pages?: { url?: string; kind?: string; text?: string }[];
  /** Pages it tried and could not read. Provenance for the scraper, not for us. */
  missed?: string[];
};

const PAGE_KINDS = new Set(['home', 'careers', 'contact']);

/**
 * The wire shape, narrowed to what a caller may act on.
 *
 * `missed` is dropped rather than carried. It is a list of URLs the scraper
 * failed on, and a ranking step given it would be tempted to treat a missing
 * careers page as a fact about the employer, when it is a fact about a fetch.
 * A page that was not read is not evidence of anything, in either direction.
 */
const siteFrom = (raw: ScrapedCompany): CompanySite | undefined => {
  if (!raw.origin) return undefined;

  const pages: CompanyPage[] = (raw.pages ?? [])
    .filter(
      (page): page is { url: string; kind: string; text: string } =>
        typeof page.url === 'string'
        && typeof page.text === 'string'
        && page.text.trim().length > 0
        && typeof page.kind === 'string'
        && PAGE_KINDS.has(page.kind)
    )
    .map((page) => ({
      url: page.url,
      kind: page.kind as CompanyPage['kind'],
      text: page.text.slice(0, MAX_TEXT_CHARS)
    }));

  return {
    origin: raw.origin,
    ...(raw.redirected_from ? { redirectedFrom: raw.redirected_from } : {}),
    ...(raw.discovered === undefined ? {} : { discovered: raw.discovered }),
    ...(raw.corroborated === undefined ? {} : { corroborated: raw.corroborated }),
    pages
  };
};

/** Mirrors the scraper's listing row. */
type ScrapedListing = { board?: string; url?: string; title?: string; company?: string };

const listingsFrom = (raw: readonly ScrapedListing[]): Listing[] =>
  raw
    .filter(
      (row): row is { board: string; url: string; title: string; company?: string } =>
        typeof row.board === 'string'
        && typeof row.url === 'string'
        && typeof row.title === 'string'
    )
    .map((row) => ({
      board: row.board,
      url: row.url,
      title: row.title,
      ...(row.company ? { company: row.company } : {})
    }));

/* ------------------------------------------------------------ the reader */

export type WebReaderOptions = {
  /** Unset uses the default loopback port; `''` switches the scraper off. */
  readonly scraperUrl?: string;
  /** Injected so the tests that matter here need no network. */
  readonly fetch?: typeof globalThis.fetch;
  readonly resolveHost?: HostResolver;
  readonly now?: () => number;
  readonly minHostIntervalMs?: number;
};

const cancelled = (): RuntimeError => new RuntimeError('The run was cancelled.', 'aborted');

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TimeoutError';

type HtmlOutcome =
  | { readonly status: 'ok'; readonly html: string; readonly finalUrl: string }
  | { readonly status: 'blocked'; readonly detail: string }
  /** A guard refused this URL or one it redirected to. Never retried. */
  | { readonly status: 'refused'; readonly detail: string }
  | { readonly status: 'error'; readonly detail: string };

/**
 * Builds the web reader: one object, handed out as two ports.
 *
 * The politeness state below is per instance rather than per module. It was
 * module state in the previous runtime, which meant two things that only look
 * like one: tests could not run in isolation, and a second runtime in the same
 * process — an Electron window and a CLI invocation sharing a main process —
 * silently shared a rate limiter with the first.
 */
export const createWebReader = (
  options: WebReaderOptions = {}
): OfferReader & SiteReader => {
  const {
    fetch: request = globalThis.fetch,
    resolveHost = systemResolver,
    now = Date.now,
    minHostIntervalMs = MIN_HOST_INTERVAL_MS
  } = options;

  const base = scraperBase(
    options.scraperUrl === undefined ? process.env.SCRAPER_URL : options.scraperUrl
  );

  /** One request per host at a time, spaced. Instance state, not module state. */
  const hostQueue = new Map<string, Promise<unknown>>();
  const hostLastAt = new Map<string, number>();

  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      // An already-aborted signal never fires `abort` again, so a listener is
      // not enough on its own: a run cancelled while it was queued behind
      // another read of the same host would sit out the full delay first.
      if (signal.aborted) {
        reject(cancelled());
        return;
      }

      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      // Without this the politeness delay outlives the cancellation that was
      // supposed to end it, and a cancelled run still sleeps a second per host.
      function onAbort(): void {
        clearTimeout(timer);
        reject(cancelled());
      }

      signal.addEventListener('abort', onAbort, { once: true });
    });

  const perHost = <T>(host: string, signal: AbortSignal, run: () => Promise<T>): Promise<T> => {
    const queued = (hostQueue.get(host) ?? Promise.resolve()).then(async () => {
      const wait = (hostLastAt.get(host) ?? 0) + minHostIntervalMs - now();

      if (wait > 0) await sleep(wait, signal);

      try {
        return await run();
      } finally {
        hostLastAt.set(host, now());
      }
    });

    // The chain has to outlive a rejected turn, or one failure blocks the host
    // for the life of the process.
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
   * One GET, reduced to the four answers a caller can act on.
   *
   * Redirects are followed by hand rather than by `fetch`, which is the entire
   * reason this loop exists: `redirect: 'follow'` checks the URL this code
   * chose and none of the ones the server chose, and the hop a server chooses
   * is the one worth checking.
   */
  const requestHtml = async (
    url: string,
    call: EffectCall,
    timeoutMs: number
  ): Promise<HtmlOutcome> => {
    if (!isHttpUrl(url)) return { status: 'error', detail: 'Not a valid http(s) URL.' };

    let target = url;

    for (let hop = 0; ; hop += 1) {
      const refusal = await refuseUrl(target, resolveHost);

      if (refusal) return { status: 'refused', detail: refusal };

      let response: Response;

      try {
        response = await request(target, {
          redirect: 'manual',
          // Both clocks: the page's own budget, and the run being cancelled. A
          // board that is merely slow must not outlive the run that wanted it.
          signal: AbortSignal.any([call.signal, AbortSignal.timeout(timeoutMs)]),
          headers: {
            'User-Agent': BROWSER_UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'pl,en;q=0.8'
          }
        });
      } catch (error) {
        if (call.signal.aborted) throw cancelled();

        return {
          status: 'error',
          detail: isTimeout(error)
            ? `The page did not respond within ${timeoutMs / 1000}s.`
            : 'The page could not be reached.'
        };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');

        if (!location) {
          return {
            status: 'error',
            detail: `The site returned HTTP ${response.status} with no location.`
          };
        }

        if (hop >= MAX_REDIRECTS) {
          return { status: 'error', detail: 'The site redirected too many times.' };
        }

        try {
          target = new URL(location, target).toString();
        } catch {
          return { status: 'error', detail: 'The site redirected to an unreadable location.' };
        }

        continue;
      }

      const html = await response.text();

      // 403 or 429 plus a challenge body is bot protection: an infrastructure
      // obstacle rather than a missing page. Saying so is what tells the user
      // that pasting the text is the way forward.
      if (looksLikeChallenge(html)) {
        return {
          status: 'blocked',
          detail: 'The site answered with a bot-protection challenge instead of the page.'
        };
      }

      if (!response.ok) {
        return { status: 'error', detail: `The site returned HTTP ${response.status}.` };
      }

      return { status: 'ok', html, finalUrl: response.url || target };
    }
  };

  /**
   * One POST to the scraper, with its outcome vocabulary preserved.
   *
   * The decision is taken on the body, never on the HTTP code. The obvious
   * version — treat any 5xx as the service being broken and fall back — is
   * wrong here, because the scraper answers 501 for a board it refuses to crawl
   * and 403 for one robots.txt disallows. Falling back on those would fetch the
   * board ourselves, or walk past a `Disallow` it had just honoured.
   *
   * Generic because three endpoints share it and differ only in what `data`
   * holds. The rules above are the same for all three and were settled once.
   * `SiteOutcome` is exactly the vocabulary they need, so it is what comes back
   * — `resolve` is the one caller that turns these into exceptions, because it
   * is the one caller with nothing to do without an answer.
   */
  const askScraper = async <T>(
    path: string,
    body: unknown,
    call: EffectCall,
    timeoutMs: number = SCRAPER_TIMEOUT_MS
  ): Promise<SiteOutcome<T>> => {
    if (!base) {
      return { status: 'unavailable', detail: 'SCRAPER_URL is empty, so the scraper is off.' };
    }

    let response: Response;

    try {
      response = await request(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([call.signal, AbortSignal.timeout(timeoutMs)])
      });
    } catch (error) {
      if (call.signal.aborted) throw cancelled();

      // Connection refused is the ordinary "not started" case, and on loopback
      // it fails in milliseconds, so the fallback costs nothing.
      return {
        status: 'unavailable',
        detail: isTimeout(error)
          ? `The scraper did not answer within ${timeoutMs / 1000}s.`
          : 'The scraper is not running.'
      };
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      return { status: 'unavailable', detail: 'The scraper returned no JSON.' };
    }

    const parsed = payload as { status?: string; detail?: string; data?: T };

    if (response.ok && parsed.status === 'ok' && parsed.data !== undefined) {
      return { status: 'ok', data: parsed.data };
    }

    if (typeof parsed.status === 'string' && REFUSALS.has(parsed.status)) {
      return { status: 'failed', detail: parsed.detail ?? 'The page could not be read.' };
    }

    // An unrecognised shape is not the scraper talking — a proxy error page, or
    // a version that no longer agrees with this client. Fall back.
    return {
      status: 'unavailable',
      detail: `The scraper answered HTTP ${response.status} in an unrecognised shape.`
    };
  };

  const readDirectly = async (url: string, call: EffectCall): Promise<ResolvedOffer> => {
    let host: string;

    try {
      host = new URL(url).host;
    } catch {
      throw new RuntimeError(`"${url}" is not a valid URL.`, 'invalid_input');
    }

    const outcome = await perHost(host, call.signal, () =>
      requestHtml(url, call, FETCH_TIMEOUT_MS)
    );

    if (outcome.status === 'refused') {
      // The guard talking, not a board. Its wording is about where the URL
      // pointed, and the remedy is a different URL rather than a paste.
      throw new RuntimeError(outcome.detail, 'invalid_input');
    }

    if (outcome.status === 'blocked') {
      throw new RuntimeError(
        'The board answered with a bot-protection challenge instead of the offer. '
          + 'Paste the offer text manually.',
        'unreadable_source'
      );
    }

    if (outcome.status === 'error') {
      // A transport failure is not "there was nothing to read" — trying again
      // is a reasonable thing for a caller to do, and `unreadable_source`
      // promises it is not.
      throw new RuntimeError(outcome.detail.replace('site', 'board'), 'step_failed');
    }

    const text = extractVisibleText(outcome.html);

    if (text.length < MIN_USEFUL_CHARS) {
      throw new RuntimeError(
        'The page rendered no readable text on the server — it is likely a '
          + 'JavaScript-only board. Paste the offer text manually.',
        'unreadable_source'
      );
    }

    return { url, finalUrl: outcome.finalUrl, text: text.slice(0, MAX_TEXT_CHARS) };
  };

  return {
    async resolve(url, call) {
      if (call.signal.aborted) throw cancelled();

      const scraped = await askScraper<BoardOffer>('/scrape/offer', { url }, call);

      // An offer with no text is not an offer, whatever the status said. The
      // plain GET below is a better answer than an empty success.
      if (scraped.status === 'ok' && scraped.data.text) {
        const offer = scraped.data;
        const stated = statedFrom(offer);
        const routes = routesFrom(offer);

        return {
          url,
          finalUrl: offer.source_url || url,
          text: offer.text.slice(0, MAX_TEXT_CHARS),
          ...(offer.board ? { board: offer.board } : {}),
          ...(stated ? { stated } : {}),
          ...(routes ? { routes } : {})
        };
      }

      if (scraped.status === 'failed') {
        // The scraper reached the board and was told no. A plain GET is
        // strictly less capable, so retrying it would fail too — slower, and
        // with a worse message than the one already in hand.
        throw new RuntimeError(scraped.detail, 'unreadable_source');
      }

      return readDirectly(url, call);
    },

    /**
     * A page, or nothing.
     *
     * Every failure here is one outcome to the caller — the page is not
     * evidence — but they are not collapsed into one, because the three say
     * different things about *this deployment*: `refused` is the guard, and a
     * search engine repeatedly pointing at addresses the guard refuses is
     * worth seeing in a log; `unreadable` is the ordinary web.
     */
    async readPage(url, call) {
      if (call.signal.aborted) throw cancelled();

      let host: string;

      try {
        host = new URL(url).host;
      } catch {
        return { status: 'refused', detail: 'Not a valid URL.' };
      }

      const outcome = await perHost(host, call.signal, () =>
        requestHtml(url, call, PAGE_TIMEOUT_MS)
      );

      if (outcome.status === 'refused') return outcome;

      if (outcome.status !== 'ok') return { status: 'unreadable', detail: outcome.detail };

      const text = extractVisibleText(outcome.html);

      if (text.length < PAGE_MIN_CHARS) {
        return { status: 'unreadable', detail: 'The page rendered too little text to read.' };
      }

      return { status: 'ok', text: text.slice(0, MAX_TEXT_CHARS), finalUrl: outcome.finalUrl };
    },

    /**
     * The employer's own site.
     *
     * Scraper only, with no fallback, and that is the honest shape rather than
     * a gap. `resolve` falls back because a plain GET of one known URL is a
     * worse version of the same job; there is no worse version of "find the
     * origin, probe it, follow its careers link" that fits behind a fetch. A
     * runtime without the scraper does not do this tier, and says so.
     */
    async readCompany(request, call) {
      if (call.signal.aborted) throw cancelled();

      if (!request.url && !request.name) {
        return { status: 'failed', detail: 'Neither a site nor a name was given.' };
      }

      const outcome = await askScraper<ScrapedCompany>(
        '/scrape/company',
        {
          ...(request.url ? { url: request.url } : {}),
          ...(request.name ? { name: request.name } : {}),
          ...(request.hints?.length ? { hints: [...request.hints] } : {})
        },
        call,
        COMPANY_TIMEOUT_MS
      );

      if (outcome.status !== 'ok') return outcome;

      const site = siteFrom(outcome.data);

      return site
        ? { status: 'ok', data: site }
        : { status: 'failed', detail: 'The scraper found no site for that company.' };
    },

    /**
     * One board's listing rows.
     *
     * `listingOnly` because the rows are all it takes to decide which postings
     * are worth opening. Fetching every result would spend the request budget
     * on other companies' jobs before reaching the one this run is about.
     */
    async listBoard(request, call) {
      if (call.signal.aborted) throw cancelled();

      const outcome = await askScraper<ScrapedListing[]>(
        '/scrape/search',
        { ...request, listingOnly: true },
        call
      );

      return outcome.status === 'ok'
        ? { status: 'ok', data: listingsFrom(outcome.data) }
        : outcome;
    }
  };
};
