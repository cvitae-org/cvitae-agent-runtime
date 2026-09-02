/**
 * Asking a search engine where an employer publishes its jobs.
 *
 * Every other tier of a recipient check starts from something a board handed
 * over — a company URL, or a company name. Boards mostly publish the name, and
 * a name that cannot be turned into a domain by trying `<name>.com` ends the
 * check on its first tier. That is the state a panel reports as "checked one
 * source": not a company that hides, just a lookup nobody made.
 *
 * A search engine is the thing that knows where a company called
 * "P&P Solutions Sp. z o.o." actually lives, and which page of theirs says how
 * to apply.
 *
 * **Results are pointers, never answers.** A title and a snippet are written by
 * whoever wrote the page and ordered by an engine with its own incentives, so
 * nothing here may name a recipient. The URLs get fetched, the pages get read,
 * and the ranking weighs them on facts a page cannot assert about itself. A
 * snippet containing an address moves its page up the fetch queue and
 * contributes nothing else — the address still has to be found on the page to
 * count. That rule is the reason this port exists at all rather than a model
 * being handed the results and asked who to write to.
 *
 * Two engines, in the order to prefer them:
 *
 *   brave       — an API, a key, a free tier, JSON, and terms that permit
 *                 exactly this.
 *   duckduckgo  — the keyless fallback, so a fresh checkout has the feature at
 *                 all. It is an HTML endpoint being read by a program: it is
 *                 rate-limited without notice and it will sometimes refuse.
 *                 When it does, this says so rather than reporting an empty web.
 */

import { RuntimeError } from '../contracts/index.js';
import type {
  SearchEngine,
  SearchHit,
  SearchOutcome,
  WebSearch
} from '../contracts/index.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Which market to search.
 *
 * Defaults to Poland because the boards this reads are Polish, and the
 * difference is not cosmetic: an unqualified search for a small Polish
 * employer's name returns the American company with the same one.
 */
const DEFAULT_COUNTRY = 'pl';

/**
 * Spacing between queries, per engine.
 *
 * Brave's free tier is one query per second and answers 429 above it;
 * DuckDuckGo publishes no number and starts returning an anomaly page. A check
 * makes two or three queries, so this costs a couple of seconds at most and is
 * the difference between a tier that works and one that works until it is used.
 */
const SPACING_MS: Record<SearchEngine, number> = {
  brave: 1100,
  duckduckgo: 1500
};

/**
 * Answers, kept for the length of a session's worth of re-checks.
 *
 * "Check again" is a button a person presses repeatedly while editing the field
 * beside it, and the queries it produces are identical every time. Ten minutes
 * is long enough to make a re-check free and short enough that a careers page
 * published this morning is found this afternoon. A failure is kept for a
 * minute — long enough to stop a retry loop hammering an engine that just
 * rate-limited us, short enough that a person who fixes their key is not told
 * to wait ten minutes for the fix to take.
 */
const CACHE_TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 60_000;
const CACHE_LIMIT = 200;

// Sent so the endpoint returns its normal page. Not an attempt to defeat bot
// detection: a challenge is reported, never bypassed.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Enough HTML entities to read a Polish result.
 *
 * The numeric pass is not a nicety here: `ł`, `ą` and `ę` arrive as `&#x142;`
 * and friends from the lite endpoint, and a title left as `Do&#x142;&#x105;cz`
 * is both unreadable to the person looking at it and unmatchable by the slug
 * comparison that decides whether a result names the employer.
 *
 * `&amp;` is decoded last so `&amp;lt;` stays the four characters someone
 * wrote rather than becoming a tag.
 */
const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d{1,7}|x[0-9a-f]{1,6});/gi, (whole, code: string) => {
      const point = code[0]?.toLowerCase() === 'x'
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);

      // Surrogates and out-of-range points are left as written: a malformed
      // entity is not worth turning into a replacement character.
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : whole;
    })
    .replace(/&amp;/gi, '&');

const plainText = (html: string, limit = 300): string =>
  decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TimeoutError';

const cancelled = (): RuntimeError => new RuntimeError('The run was cancelled.', 'aborted');

/* ------------------------------------------------------------- duckduckgo */

/**
 * Markers that mean the endpoint declined rather than found nothing.
 *
 * Checked only against a response that produced no results, because "blocked"
 * and "captcha" are ordinary words that appear in the snippets of a page full
 * of real ones. The wall is served as a 202 with an anomaly modal in the body
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
      // `y.js` is an ad slot and carries no `uddg`. Dropping it here is why a
      // caller never sees a sponsored placement as evidence.
      return url.searchParams.get('uddg') ?? '';
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

    if (!/class="[^"]*result(?:__a|-link)[^"]*"/i.test(attributes)) continue;

    const url = unwrap(attribute(attributes, 'href'));

    if (!url || seen.has(url)) continue;

    seen.add(url);

    hits.push({
      title: plainText(match[2] ?? '', 200),
      url,
      // Positional: the nth result carries the nth snippet in both layouts. A
      // mismatch costs ordering, never correctness — snippets decide nothing.
      snippet: snippets[index] ?? ''
    });

    index += 1;
  }

  return hits;
};

/* ------------------------------------------------------------------ build */

export type WebSearchOptions = {
  /** `'auto'` picks Brave when a key exists. Unset reads `WEB_SEARCH`. */
  readonly engine?: SearchEngine | 'off' | 'auto';
  readonly apiKey?: string;
  readonly country?: string;
  readonly timeoutMs?: number;
  /** Injected so the tests that matter here need no network. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly spacingMs?: Partial<Record<SearchEngine, number>>;
};

/**
 * Reads `WEB_SEARCH`.
 *
 * `auto` is the default and means "the best engine that is actually usable":
 * Brave when a key exists, DuckDuckGo when one does not. Naming an engine
 * explicitly disables the substitution, so a deployment that has paid for a key
 * fails loudly rather than quietly falling back to scraping a search page.
 */
const settingFrom = (raw: string | undefined): SearchEngine | 'off' | 'auto' => {
  const setting = (raw ?? 'auto').trim().toLowerCase();

  if (setting === 'off' || setting === 'false' || setting === '0') return 'off';
  if (setting === 'brave') return 'brave';
  if (setting === 'duckduckgo' || setting === 'ddg') return 'duckduckgo';

  return 'auto';
};

/**
 * Builds the web search port.
 *
 * The queue, the per-engine clock and the cache are per instance. They were
 * module state in the previous runtime, which is the same defect the offer
 * reader had and it matters more here: the rate limit being spaced against is
 * per key, so a second limiter in the same process does not halve the interval,
 * it doubles the request rate against an allowance that answers 429.
 *
 * Per instance is still the right scope for that, because a composition root
 * owns one key. Two runtimes in one process with two different keys are two
 * allowances, and sharing a limiter between them would be the mirror-image
 * mistake.
 */
export const createWebSearch = (options: WebSearchOptions = {}): WebSearch => {
  const {
    fetch: request = globalThis.fetch,
    now = Date.now,
    timeoutMs = Number(process.env.WEB_SEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  } = options;

  const apiKey = (options.apiKey ?? process.env.BRAVE_API_KEY ?? '').trim();
  const country = (
    options.country ?? (process.env.WEB_SEARCH_COUNTRY?.trim() || DEFAULT_COUNTRY)
  ).toLowerCase();

  const setting = options.engine ?? settingFrom(process.env.WEB_SEARCH);
  const engine: SearchEngine | undefined =
    setting === 'off' ? undefined : setting === 'auto' ? (apiKey ? 'brave' : 'duckduckgo') : setting;

  const spacing: Record<SearchEngine, number> = { ...SPACING_MS, ...options.spacingMs };

  /** One query at a time, spaced per engine. Instance state, not module state. */
  let queue: Promise<unknown> = Promise.resolve();
  const lastCallAt: Record<SearchEngine, number> = { brave: 0, duckduckgo: 0 };
  const cache = new Map<string, { at: number; ttl: number; outcome: SearchOutcome }>();

  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      // An already-aborted signal never fires `abort` again, so a listener is
      // not enough on its own.
      if (signal.aborted) {
        reject(cancelled());
        return;
      }

      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      function onAbort(): void {
        clearTimeout(timer);
        reject(cancelled());
      }

      signal.addEventListener('abort', onAbort, { once: true });
    });

  const spaced = <T>(which: SearchEngine, signal: AbortSignal, run: () => Promise<T>): Promise<T> => {
    const result = queue.then(async () => {
      const wait = lastCallAt[which] + spacing[which] - now();

      if (wait > 0) await sleep(wait, signal);

      try {
        return await run();
      } finally {
        lastCallAt[which] = now();
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

  const remember = (key: string, outcome: SearchOutcome): SearchOutcome => {
    if (cache.size >= CACHE_LIMIT) {
      // Oldest insertion first, which is the order a Map iterates.
      const oldest = cache.keys().next();

      if (!oldest.done) cache.delete(oldest.value);
    }

    cache.set(key, {
      at: now(),
      ttl: outcome.status === 'ok' ? CACHE_TTL_MS : FAILURE_TTL_MS,
      outcome
    });

    return outcome;
  };

  const clock = (signal: AbortSignal): AbortSignal =>
    AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

  const braveSearch = async (
    query: string,
    limit: number,
    signal: AbortSignal
  ): Promise<SearchOutcome> => {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');

    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(Math.max(limit, 1), 20)));
    url.searchParams.set('country', country);
    url.searchParams.set('safesearch', 'off');
    // Snippets are read by a regex looking for '@' and by a person, not rendered.
    url.searchParams.set('text_decorations', '0');

    let response: Response;

    try {
      response = await request(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey
        },
        signal: clock(signal)
      });
    } catch (error) {
      if (signal.aborted) throw cancelled();

      return {
        status: 'failed',
        engine: 'brave',
        detail: isTimeout(error)
          ? `Brave did not answer within ${timeoutMs / 1000}s.`
          : 'Brave could not be reached.'
      };
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

  const duckDuckGoSearch = async (query: string, signal: AbortSignal): Promise<SearchOutcome> => {
    let response: Response;

    try {
      response = await request('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': BROWSER_UA,
          Accept: 'text/html',
          'Accept-Language': 'pl,en;q=0.8'
        },
        body: new URLSearchParams({
          q: query,
          kl: country === 'pl' ? 'pl-pl' : 'wt-wt'
        }).toString(),
        signal: clock(signal)
      });
    } catch (error) {
      if (signal.aborted) throw cancelled();

      return {
        status: 'failed',
        engine: 'duckduckgo',
        detail: isTimeout(error)
          ? `DuckDuckGo did not answer within ${timeoutMs / 1000}s.`
          : 'DuckDuckGo could not be reached.'
      };
    }

    const body = await response.text();
    const hits = parseDuckDuckGo(body);

    if (hits.length > 0) return { status: 'ok', engine: 'duckduckgo', hits };

    // Nothing came back, and the two reasons for that are not alike. A refusal
    // means this deployment has no working search and should be given a key; an
    // empty result means this employer is not findable under that name, which
    // is a fact about the employer. Reporting the first as the second is how a
    // feature comes to look broken in the one place it matters — beside a Send
    // button, saying nothing was found.
    const declined =
      response.status === 202
      || DDG_REFUSAL.test(body)
      || /<title>[^<]*captcha/i.test(body);

    if (declined) {
      return {
        status: 'failed',
        engine: 'duckduckgo',
        detail:
          'DuckDuckGo answered with a challenge instead of results. The keyless '
          + 'fallback is best-effort; set BRAVE_API_KEY for a search path that is '
          + 'not rate-limited.'
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

  return {
    engine: () => engine,

    async search(query, call) {
      if (call.signal.aborted) throw cancelled();

      if (!engine) {
        return { status: 'unavailable', detail: 'WEB_SEARCH is off.' };
      }

      if (engine === 'brave' && !apiKey) {
        return {
          status: 'unavailable',
          detail: 'BRAVE_API_KEY is not set, so the web tier has nothing to search with.'
        };
      }

      const trimmed = query.trim();

      if (!trimmed) return { status: 'ok', engine, hits: [] };

      const limit = call.limit ?? 10;
      const key = `${engine}:${country}:${limit}:${trimmed}`;
      const cached = cache.get(key);

      if (cached && now() - cached.at < cached.ttl) return cached.outcome;

      return remember(
        key,
        await spaced(engine, call.signal, () =>
          engine === 'brave'
            ? braveSearch(trimmed, limit, call.signal)
            : duckDuckGoSearch(trimmed, call.signal)
        )
      );
    }
  };
};
