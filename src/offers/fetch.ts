/**
 * Fetches a job offer page and reduces it to readable text.
 *
 * Job boards differ wildly in how reachable they are from a server: some render
 * on the server and read fine, some ship an empty JS shell, and some sit behind
 * bot protection that returns a challenge page instead of content. The fetcher
 * reports which of those happened rather than returning empty text, so the UI
 * can ask for a manual paste with an accurate reason. Nothing here attempts to
 * work around a bot challenge — a block is reported as a block.
 */

export type FetchOutcome =
  | { status: 'ok'; text: string; finalUrl: string }
  | { status: 'blocked'; detail: string }
  | { status: 'empty'; detail: string }
  | { status: 'error'; detail: string };

/** Below this, a 200 response is a JS shell rather than a readable offer. */
const MIN_USEFUL_CHARS = 400;

/** Keeps a pathological page from blowing up the model's context. */
const MAX_TEXT_CHARS = 20_000;

const FETCH_TIMEOUT_MS = 15_000;

// Sent so boards return their normal page rather than a stripped one. This is
// not an attempt to defeat bot detection: challenges are reported, not bypassed.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CHALLENGE_MARKERS = [
  'just a moment',
  'enable javascript and cookies',
  'cf-browser-verification',
  'cf_chl_opt',
  'attention required',
  'checking your browser'
];

export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * The two elements that hold page furniture and nothing else. Left in, their
 * text is extracted as though the offer had said it: a nofluffjobs page put
 * "Aplikuj Zapisz ofertę Analiza CV BETA" into how_to_apply, and its <nav> put
 * "Zaloguj się / Cennik / Kalkulator wynagrodzeń" in front of the model.
 *
 * Kept deliberately short. Stripping <aside>, <footer> and <header> as well, or
 * narrowing to <main>, cuts the text by 36% but measurably degrades extraction:
 * this board keeps the company description in an <aside> (company_type went
 * from "Tech-driven company" to "Not stated"), the job title in a <header>, and
 * across three runs per variant it tripled the garbled values in `team` and
 * destabilised contract_type. The furniture and the offer are interleaved, so
 * removing containers wholesale takes the offer with them. The saving here is
 * only ~4% of the prompt — this is an accuracy fix, not a speed one.
 */
const CHROME_TAGS = ['nav', 'button'] as const;

const stripElements = (html: string, tags: readonly string[]): string =>
  tags.reduce(
    (acc, tag) =>
      acc.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' '),
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
    // \u00A0 written as an escape rather than the literal character it was
    // ported as. Same behaviour, and the intent is now visible: HTML is full
    // of real non-breaking spaces, and a text extractor that leaves them in
    // hands the model words glued together by a character it cannot see.
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

/** Strips markup, scripts, and styles down to the text a reader would see. */
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

const looksLikeChallenge = (html: string): boolean => {
  const head = html.slice(0, 4000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => head.includes(marker));
};

export const fetchOffer = async (
  url: string,
  signal?: AbortSignal
): Promise<FetchOutcome> => {
  if (!isHttpUrl(url)) {
    return { status: 'error', detail: 'Not a valid http(s) URL.' };
  }

  let response: Response;

  try {
    response = await fetch(url, {
      redirect: 'follow',
      // Both clocks: the page's own budget, and the run being cancelled. A
      // board that is merely slow must not outlive the request that wanted it.
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
        : AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pl,en;q=0.8'
      }
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.name === 'TimeoutError'
        ? `The page did not respond within ${FETCH_TIMEOUT_MS / 1000}s.`
        : 'The page could not be reached.';
    return { status: 'error', detail };
  }

  const html = await response.text();

  // 403/429 plus a challenge body is bot protection, which is an infrastructure
  // obstacle rather than a missing page — say so, so the user knows pasting the
  // text manually is the way forward.
  if (looksLikeChallenge(html)) {
    return {
      status: 'blocked',
      detail:
        'The board answered with a bot-protection challenge instead of the offer. Paste the offer text manually.'
    };
  }

  if (!response.ok) {
    return {
      status: 'error',
      detail: `The board returned HTTP ${response.status}.`
    };
  }

  const text = extractVisibleText(html);

  if (text.length < MIN_USEFUL_CHARS) {
    return {
      status: 'empty',
      detail:
        'The page rendered no readable text on the server — it is likely a JavaScript-only board. Paste the offer text manually.'
    };
  }

  return {
    status: 'ok',
    text: text.slice(0, MAX_TEXT_CHARS),
    finalUrl: response.url || url
  };
};
