/**
 * Talks to cvitae-scrapper, when it is running.
 *
 * The scraper is a separate process, so this is written to be absent. If it is
 * not listening, `resolveOffer` falls back to the built-in `fetchOffer` — starting it is an upgrade, not a
 * dependency. `SCRAPER_URL=` (empty) disables the attempt entirely.
 *
 * What it buys is the boards `fetchOffer` cannot read: ones that render offers
 * client-side, and ones that need a sitemap or a browser rather than a plain
 * GET. It also returns fields the board stated itself — salary, company,
 * skills — which are worth more than the same values inferred by a small model.
 */

const DEFAULT_URL = 'http://127.0.0.1:8787';

/**
 * Long enough for the browser path (a rendered board runs to ~30s), short
 * enough to leave the five analysis calls room inside the route's 60s budget.
 */
const TIMEOUT_MS = 30_000;

/** Mirrors cvitae-scrapper's `ScrapedOffer`. Optional means the board was silent. */
export type BoardOffer = {
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
  /** When the work begins ("ASAP") — not to be confused with posted_at. */
  start_date?: string;
  required_skills?: string[];
  text: string;
};

export type ScraperOutcome =
  /** The scraper read the offer. */
  | { status: 'ok'; offer: BoardOffer }
  /**
   * The scraper is not reachable or is switched off. The caller should fall
   * back — this says nothing about the offer itself.
   */
  | { status: 'unavailable'; detail: string }
  /**
   * The scraper reached the board and could not have the offer: bot-blocked,
   * disallowed by robots.txt, a board it will not crawl, or a page with no
   * readable text. Falling back is pointless — `fetchOffer` is strictly less
   * capable, so it would fail too, slower and with a vaguer message.
   */
  | { status: 'failed'; reason: string; detail: string };

/**
 * The outcomes cvitae-scrapper names, all of them final.
 *
 * Every one means it reached a decision about this offer: the board refused
 * (`blocked`), robots.txt forbade the path (`disallowed`), it will not crawl
 * that board at all (`unsupported`), the page held no offer (`empty`), or the
 * board itself failed (`error`). None of them is improved by retrying with a
 * plain GET, and two of them would be actively wrong to retry.
 */
const REFUSALS = new Set([
  'blocked',
  'disallowed',
  'unsupported',
  'empty',
  'error'
]);

const baseUrl = (): string => {
  const configured = process.env.SCRAPER_URL;
  // Unset means "use the default port"; explicitly empty means "off".
  if (configured === undefined) return DEFAULT_URL;
  return configured.trim();
};

export const isScraperEnabled = (): boolean => baseUrl().length > 0;

export const scrapeOffer = async (
  url: string,
  signal?: AbortSignal
): Promise<ScraperOutcome> => {
  const base = baseUrl();

  if (!base) {
    return { status: 'unavailable', detail: 'SCRAPER_URL is empty.' };
  }

  let response: Response;

  try {
    response = await fetch(`${base}/scrape/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    // Connection refused is the ordinary case of "not started", and on
    // localhost it fails in milliseconds, so the fallback costs nothing.
    const detail =
      error instanceof Error && error.name === 'TimeoutError'
        ? `cvitae-scrapper did not answer within ${TIMEOUT_MS / 1000}s.`
        : 'cvitae-scrapper is not running.';
    return { status: 'unavailable', detail };
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return { status: 'unavailable', detail: 'cvitae-scrapper returned no JSON.' };
  }

  const body = payload as {
    status?: string;
    detail?: string;
    data?: BoardOffer;
  };

  if (response.ok && body.status === 'ok' && body.data?.text) {
    return { status: 'ok', offer: body.data };
  }

  // Decided on the body, never on the HTTP code. The obvious version of this
  // check — treat any 5xx as the service being broken and fall back — is wrong
  // here, because the scraper answers 501 for a board it refuses to crawl and
  // 403 for one that robots.txt disallows. Falling back on those would have
  // cvitae quietly fetch LinkedIn itself, or walk past a Disallow the scraper
  // had just honoured. Every outcome the scraper names is its final answer.
  if (typeof body.status === 'string' && REFUSALS.has(body.status)) {
    return {
      status: 'failed',
      reason: body.status,
      detail: body.detail ?? 'The offer could not be read.'
    };
  }

  // An unrecognised shape is not the scraper talking — a proxy error page, or a
  // version that no longer agrees with this client. Fall back.
  return {
    status: 'unavailable',
    detail: `cvitae-scrapper answered HTTP ${response.status} in an unrecognised shape.`
  };
};
