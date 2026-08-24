/**
 * Asking a search engine where an employer publishes its jobs.
 *
 * Every other tier of `verify_recipient` starts from something the board handed
 * over — a company URL, or a company name. Only one of the three boards here
 * publishes `hiringOrganization.url`, so the common case is a name, and a name
 * that cannot be turned into a domain by trying `<name>.com` ends the check on
 * its first tier. That is the state the panel reports as "checked 1 source":
 * not a company that hides, just a lookup this project never made.
 *
 * A search engine is the thing that knows where a company called
 * "P&P Solutions Sp. z o.o." actually lives, and which page of theirs says how
 * to apply.
 *
 * **Results are pointers, never answers.** A title and a snippet are written by
 * whoever wrote the page and ordered by an engine with its own incentives, so
 * nothing here may name a recipient: the URLs get fetched, the pages get
 * scanned for `@` by the same regex as everywhere else, and `recipientRanking`
 * weighs them on facts a page cannot assert about itself. A snippet that
 * contains an address moves its page up the fetch queue and contributes nothing
 * else — the address still has to be found on the page itself to count.
 *
 * Two engines, in the order to prefer them:
 *
 *   brave       — an API, a key, a free tier of 2,000 queries a month, JSON,
 *                 and terms that permit exactly this.
 *   duckduckgo  — the keyless fallback, so a fresh checkout has the feature at
 *                 all. It is an HTML endpoint being read by a program: it is
 *                 rate-limited without notice and it will sometimes refuse.
 *                 When it does, this says so rather than reporting an empty web.
 */

export type SearchEngine = 'brave' | 'duckduckgo';

export type SearchHit = {
  title: string;
  url: string;
  /** The engine's own summary. Used to order fetches, never as evidence. */
  snippet: string;
};

export type SearchOutcome =
  /** The engine answered. An empty `hits` is a real answer: nothing matched. */
  | { status: 'ok'; engine: SearchEngine; hits: SearchHit[] }
  /**
   * Nothing is configured to search with — no key, or `WEB_SEARCH=off`. Says
   * nothing about the employer, and the caller should report it as a tier that
   * did not run rather than as a tier that found nothing.
   */
  | { status: 'unavailable'; detail: string }
  /** The engine was reached and refused, or answered in a shape this cannot read. */
  | { status: 'failed'; engine: SearchEngine; detail: string };

const TIMEOUT_MS = Number(process.env.WEB_SEARCH_TIMEOUT_MS) || 10_000;

/**
 * Which market to search.
 *
 * Defaults to Poland because the boards this project reads are Polish, and the
 * difference is not cosmetic: an unqualified search for a small Polish
 * employer's name returns the American company with the same one.
 */
const country = (): string =>
  (process.env.WEB_SEARCH_COUNTRY?.trim() || 'pl').toLowerCase();

const braveKey = (): string => process.env.BRAVE_API_KEY?.trim() ?? '';

/**
 * `auto` is the default and means "the best engine that is actually usable":
 * Brave when a key exists, DuckDuckGo when one does not. Naming an engine
 * explicitly disables the substitution, so a deployment that has paid for a key
 * fails loudly rather than quietly falling back to scraping a search page.
 */
const configured = (): SearchEngine | 'off' => {
  const setting = (process.env.WEB_SEARCH ?? 'auto').trim().toLowerCase();

  if (setting === 'off' || setting === 'false' || setting === '0') return 'off';
  if (setting === 'brave') return 'brave';
  if (setting === 'duckduckgo' || setting === 'ddg') return 'duckduckgo';

  return braveKey() ? 'brave' : 'duckduckgo';
};

export const isWebSearchEnabled = (): boolean => configured() !== 'off';

/** Which engine a run will actually use, for saying so in the payload. */
export const activeEngine = (): SearchEngine | undefined => {
  const engine = configured();
  return engine === 'off' ? undefined : engine;
};

/**
 * Spacing between queries, per engine.
 *
 * Brave's free tier is one query per second and answers 429 above it; DuckDuckGo
 * publishes no number and starts returning an anomaly page. A verification makes
 * two or three queries, so this costs a couple of seconds at most and is the
 * difference between a tier that works and one that works until it is used.
 */
const SPACING_MS: Record<SearchEngine, number> = {
  brave: 1100,
  duckduckgo: 1500
};

const lastCallAt: Record<SearchEngine, number> = { brave: 0, duckduckgo: 0 };

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
      },
      { once: true }
    );
  });

/**
 * One query at a time, process-wide, spaced per engine.
 *
 * Process-wide rather than per-run because the rate limit is per key, not per
 * user: two people verifying at once share the same allowance, and a limiter
 * scoped to a request would not know that.
 */
let queue: Promise<unknown> = Promise.resolve();

const spaced = <T>(
  engine: SearchEngine,
  run: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> => {
  const result = queue.then(async () => {
    const wait = lastCallAt[engine] + SPACING_MS[engine] - Date.now();

    if (wait > 0) await sleep(wait, signal);

    try {
      return await run();
    } finally {
      lastCallAt[engine] = Date.now();
    }
  });

  // The queue must survive a rejected turn, or one failed query stops every
  // later one from ever starting.
  queue = result.then(
    () => undefined,
    () => undefined
  );

  return result;
};

/**
 * Answers, kept for the length of a session's worth of re-checks.
 *
 * "Check again" is a button a person presses repeatedly while editing the field
 * beside it, and the queries it produces are identical every time. Ten minutes
 * is long enough to make a re-check free and short enough that a careers page
 * published this morning is found this afternoon.
 */
const CACHE_TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 60_000;
const CACHE_LIMIT = 200;

const cache = new Map<string, { at: number; ttl: number; outcome: SearchOutcome }>();

const remember = (key: string, outcome: SearchOutcome): SearchOutcome => {
  if (cache.size >= CACHE_LIMIT) {
    // Oldest insertion first, which is the order a Map iterates.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }

  cache.set(key, {
    at: Date.now(),
    ttl: outcome.status === 'ok' ? CACHE_TTL_MS : FAILURE_TTL_MS,
    outcome
  });

  return outcome;
};

/** Exposed for tests, and for a long-lived process that wants the memory back. */
export const clearSearchCache = (): void => cache.clear();

const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/gi, '&');

const plainText = (html: string, limit = 300): string =>
  decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

/* ------------------------------------------------------------------ brave -- */

const braveSearch = async (
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<SearchOutcome> => {
  const key = braveKey();

  if (!key) {
    return {
      status: 'unavailable',
      detail: 'BRAVE_API_KEY is not set, so the web tier has nothing to search with.'
    };
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 20)));
  url.searchParams.set('country', country());
  url.searchParams.set('safesearch', 'off');
  // Snippets are read by a regex looking for '@' and by a person, not rendered.
  url.searchParams.set('text_decorations', '0');

  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': key
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.name === 'TimeoutError'
        ? `Brave did not answer within ${TIMEOUT_MS / 1000}s.`
        : 'Brave could not be reached.';

    return { status: 'failed', engine: 'brave', detail };
  }

  // A rejected key is a configuration fault rather than a fact about the web,
  // and it will reject every later query too. Reported as unavailable so the
  // caller says "the web tier is not set up" instead of "nothing was found".
  if (response.status === 401 || response.status === 403) {
    return {
      status: 'unavailable',
      detail: `Brave rejected BRAVE_API_KEY (HTTP ${response.status}).`
    };
  }

  if (!response.ok) {
    return {
      status: 'failed',
      engine: 'brave',
      detail:
        response.status === 429
          ? 'Brave rate-limited the search. The free tier allows one query per second.'
          : `Brave returned HTTP ${response.status}.`
    };
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return { status: 'failed', engine: 'brave', detail: 'Brave returned no JSON.' };
  }

  const results = (payload as { web?: { results?: unknown[] } }).web?.results ?? [];

  const hits = results
    .map((entry) => entry as { title?: unknown; url?: unknown; description?: unknown })
    .filter((entry) => typeof entry.url === 'string')
    .map((entry) => ({
      title: plainText(String(entry.title ?? ''), 200),
      url: String(entry.url),
      snippet: plainText(String(entry.description ?? ''))
    }));

  return { status: 'ok', engine: 'brave', hits };
};

/* ------------------------------------------------------------- duckduckgo -- */

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Markers that mean the endpoint declined rather than found nothing.
 *
 * Checked only against a response that produced no results, because "blocked"
 * and "captcha" are ordinary words that appear in the snippets of a page full
 * of real ones. The wall is served as a 202 with an `anomaly-modal` in the body
 * — a success code carrying a refusal, which is why the status alone decides
 * nothing here.
 */
const DDG_REFUSAL = /anomaly|unusual traffic|are you a robot|blocked|captcha/i;

const attribute = (tag: string, name: string): string => {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return match?.[1] ? decodeEntities(match[1]) : '';
};

/**
 * The one redirect worth unwrapping: DuckDuckGo wraps every result in
 * `/l/?uddg=<encoded>`, so the raw href is a duckduckgo.com URL and following
 * it would fetch a redirector rather than the employer's page.
 */
const unwrap = (href: string): string => {
  const absolute = href.startsWith('//') ? `https:${href}` : href;

  if (!/^https?:\/\//i.test(absolute)) return '';

  try {
    const url = new URL(absolute);

    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname)) {
      const target = url.searchParams.get('uddg');
      // `y.js` is an ad slot, and it carries no uddg. Dropping it here is why
      // the caller never sees sponsored placements as evidence.
      return target ?? '';
    }

    return absolute;
  } catch {
    return '';
  }
};

/** Both layouts DuckDuckGo serves: `result__a` on /html/, `result-link` on /lite/. */
export const parseDuckDuckGo = (html: string): SearchHit[] => {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  const snippets: string[] = [];

  for (const match of html.matchAll(
    /class="[^"]*result(?:__snippet|-snippet)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/gi
  )) {
    snippets.push(plainText(match[1] ?? ''));
  }

  let index = 0;

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1] ?? '';
    const inner = match[2] ?? '';

    if (!/class="[^"]*result(?:__a|-link)[^"]*"/i.test(attributes)) continue;

    const url = unwrap(attribute(attributes, 'href'));

    if (!url || seen.has(url)) continue;
    seen.add(url);

    hits.push({
      title: plainText(inner, 200),
      url,
      // Positional: the nth result carries the nth snippet in both layouts.
      // A mismatch costs ordering, never correctness — snippets decide nothing.
      snippet: snippets[index] ?? ''
    });

    index += 1;
  }

  return hits;
};

const duckDuckGoSearch = async (
  query: string,
  signal?: AbortSignal
): Promise<SearchOutcome> => {
  const region = country() === 'pl' ? 'pl-pl' : 'wt-wt';

  let response: Response;

  try {
    response = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': BROWSER_UA,
        Accept: 'text/html',
        'Accept-Language': 'pl,en;q=0.8'
      },
      body: new URLSearchParams({ q: query, kl: region }).toString(),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.name === 'TimeoutError'
        ? `DuckDuckGo did not answer within ${TIMEOUT_MS / 1000}s.`
        : 'DuckDuckGo could not be reached.';

    return { status: 'failed', engine: 'duckduckgo', detail };
  }

  const body = await response.text();
  const hits = parseDuckDuckGo(body);

  if (hits.length > 0) return { status: 'ok', engine: 'duckduckgo', hits };

  /**
   * Nothing came back, and the two reasons for that are not alike.
   *
   * A refusal means this deployment has no working search and should be given a
   * key; an empty result means this employer is not findable under that name,
   * which is a fact about the employer. Reporting the first as the second is
   * how a feature comes to look broken in the one place it matters — beside a
   * Send button, saying nothing was found.
   */
  const declined =
    response.status === 202 ||
    DDG_REFUSAL.test(body) ||
    /<title>[^<]*captcha/i.test(body);

  if (declined) {
    return {
      status: 'failed',
      engine: 'duckduckgo',
      detail:
        'DuckDuckGo answered with a challenge instead of results. The keyless fallback is best-effort; set BRAVE_API_KEY for a search path that is not rate-limited.'
    };
  }

  if (!response.ok) {
    return {
      status: 'failed',
      engine: 'duckduckgo',
      detail: `DuckDuckGo returned HTTP ${response.status}.`
    };
  }

  return { status: 'ok', engine: 'duckduckgo', hits };
};

/* ------------------------------------------------------------------- api --- */

/**
 * One query, through whichever engine is configured.
 *
 * Never throws: every failure is an outcome, because this sits inside a
 * non-critical step whose whole purpose is to add reach when it can and get out
 * of the way when it cannot.
 */
export const searchWeb = async (
  query: string,
  { limit = 10, signal }: { limit?: number; signal?: AbortSignal } = {}
): Promise<SearchOutcome> => {
  const engine = configured();

  if (engine === 'off') {
    return { status: 'unavailable', detail: 'WEB_SEARCH is off.' };
  }

  const trimmed = query.trim();

  if (!trimmed) {
    return { status: 'ok', engine, hits: [] };
  }

  const key = `${engine}:${country()}:${limit}:${trimmed}`;
  const cached = cache.get(key);

  if (cached && Date.now() - cached.at < cached.ttl) return cached.outcome;

  try {
    const outcome = await spaced(
      engine,
      () =>
        engine === 'brave'
          ? braveSearch(trimmed, limit, signal)
          : duckDuckGoSearch(trimmed, signal),
      signal
    );

    return remember(key, outcome);
  } catch (error) {
    // Only reached when the run itself was cancelled while queued. Not cached:
    // the next run's identical query deserves a real attempt.
    return {
      status: 'failed',
      engine,
      detail: error instanceof Error ? error.message : 'The search was cancelled.'
    };
  }
};
