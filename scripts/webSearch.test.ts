/**
 * What a search engine is allowed to contribute, and what it is not.
 *
 * The port exists to move a URL up a fetch queue and to do nothing else. Every
 * test here is written from that one sentence: a link is unwrapped so the page
 * that gets opened is the employer's and not a redirector, an ad slot is
 * dropped rather than ranked, and the three ways a query can come back with no
 * hits are kept apart because a caller reports them to a person differently.
 *
 * The distinction the failure vocabulary is built around is the one worth
 * keeping. "No engine is configured", "the engine refused us" and "nothing
 * matched that name" are three different sentences beside a Send button, and
 * collapsing them into an empty list makes a deployment fault look like a fact
 * about the employer.
 *
 * Mutations run, not assumed — applied to `effects/search.ts`, whole suite run,
 * failures counted, reverted:
 *
 *   `unwrap` returns the raw href         2  a result's link is unwrapped …
 *   numeric entities left encoded         1  a result's link is unwrapped …
 *   202 dropped from the refusal check    1  a challenge served as a success code …
 *   the wording check dropped             1  a refusal wearing a 200 …
 *   a rejected key reported as failed     1  a key the engine rejects is a …
 *   the cache never consulted             2  the same question twice costs one …
 *   `auto` always picks duckduckgo        1  auto picks the engine that can answer
 *   spacing dropped from the queue        1  a query queued behind another …
 *
 * Nothing here opens a socket: `fetch` and the clock are both injected.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeError } from '../src/contracts/index.js';
import { createWebSearch, parseDuckDuckGo } from '../src/effects/search.js';

/* --------------------------------------------------------------- fixtures */

const call = (signal: AbortSignal = new AbortController().signal) => ({
  traceId: 'trace-1',
  runId: 'run-1',
  step: 'web_lookup',
  signal
});

const codeOf = (error: unknown): string =>
  error instanceof RuntimeError ? error.code : `not a RuntimeError: ${String(error)}`;

/** Records what was asked for and answers from a list, in order. */
const fakeFetch = (replies: (Response | (() => Response))[]) => {
  const asked: string[] = [];
  let inFlight = 0;
  let peak = 0;

  const fetch = (async (input: string | URL | Request) => {
    asked.push(typeof input === 'string' ? input : input.toString());
    inFlight += 1;
    peak = Math.max(peak, inFlight);

    try {
      await Promise.resolve();

      const reply = replies[asked.length - 1];

      if (!reply) throw new Error(`unexpected request ${asked.length}`);

      return typeof reply === 'function' ? reply() : reply;
    } finally {
      inFlight -= 1;
    }
  }) as unknown as typeof globalThis.fetch;

  return { fetch, asked, peak: () => peak };
};

const brave = (hits: { title: string; url: string; description: string }[]) =>
  new Response(JSON.stringify({ web: { results: hits } }), {
    headers: { 'Content-Type': 'application/json' }
  });

/* ---------------------------------------------------------- the html page */

test('a result’s link is unwrapped, so a caller never fetches the redirector', () => {
  // Every DuckDuckGo result href points at duckduckgo.com. Opening one reads a
  // redirector, and its registrable domain is not the employer's, so the whole
  // "is this on the company's own site" judgment would answer no every time.
  const hits = parseDuckDuckGo(
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.test%2Fkariera">'
    + 'Acme — kariera</a>'
    + '<td class="result__snippet">Do&#x142;&#x105;cz do zespo&#x142;u.</td>'
  );

  assert.deepEqual(hits, [
    { title: 'Acme — kariera', url: 'https://acme.test/kariera', snippet: 'Dołącz do zespołu.' }
  ]);
});

test('an ad slot names no destination and is dropped rather than ranked', () => {
  const hits = parseDuckDuckGo(
    '<a class="result__a" href="//duckduckgo.com/y.js?ad_provider=bing">Sponsored</a>'
    + '<a class="result-link" href="https://acme.test/">Acme</a>'
  );

  assert.deepEqual(
    hits.map((hit) => hit.url),
    ['https://acme.test/'],
    'a sponsored placement reached a caller as evidence'
  );
});

test('the same page linked twice is one result', () => {
  const hits = parseDuckDuckGo(
    '<a class="result__a" href="https://acme.test/kariera">Kariera</a>'
    + '<a class="result__a" href="https://acme.test/kariera">Kariera — Acme</a>'
  );

  assert.equal(hits.length, 1);
});

/* ----------------------------------------------------- which engine, if any */

test('search switched off never reaches the network', async () => {
  const { fetch, asked } = fakeFetch([]);
  const search = createWebSearch({ engine: 'off', fetch });

  assert.equal(search.engine(), undefined);

  const outcome = await search.search('Acme kariera', call());

  assert.equal(outcome.status, 'unavailable');
  assert.deepEqual(asked, []);
});

test('auto picks the engine that can actually answer', async () => {
  // A key is the difference between a search path with an allowance and one
  // that is scraped best-effort, so the choice follows the key rather than a
  // preference written down somewhere.
  assert.equal(createWebSearch({ engine: 'auto', apiKey: 'k' }).engine(), 'brave');
  assert.equal(createWebSearch({ engine: 'auto', apiKey: '' }).engine(), 'duckduckgo');
});

test('naming an engine that has no key fails loudly instead of substituting', async () => {
  // A deployment that paid for a key and mistyped its name should hear about
  // it, not quietly start scraping a search page under a different name.
  const { fetch, asked } = fakeFetch([]);
  const search = createWebSearch({ engine: 'brave', apiKey: '', fetch });

  const outcome = await search.search('Acme kariera', call());

  assert.equal(outcome.status, 'unavailable');
  assert.match(outcome.status === 'unavailable' ? outcome.detail : '', /BRAVE_API_KEY/);
  assert.deepEqual(asked, []);
});

test('the market searched is Poland unless a caller says otherwise', async () => {
  // An unqualified search for a small Polish employer returns the American
  // company with the same name, which is a wrong answer that looks right.
  const { fetch, asked } = fakeFetch([brave([]), brave([])]);

  await createWebSearch({ engine: 'brave', apiKey: 'k', fetch }).search('Acme', call());
  await createWebSearch({ engine: 'brave', apiKey: 'k', country: 'DE', fetch }).search(
    'Acme',
    call()
  );

  assert.equal(new URL(asked[0] ?? '').searchParams.get('country'), 'pl');
  assert.equal(new URL(asked[1] ?? '').searchParams.get('country'), 'de');
});

/* ------------------------------------------------------ how it says no */

test('a key the engine rejects is a deployment fault, not an empty web', async () => {
  const { fetch } = fakeFetch([new Response('', { status: 403 })]);
  const search = createWebSearch({ engine: 'brave', apiKey: 'stale', fetch });

  const outcome = await search.search('Acme kariera', call());

  assert.equal(outcome.status, 'unavailable');
});

test('a rate limit is a failure, because the next query might work', async () => {
  const { fetch } = fakeFetch([new Response('', { status: 429 })]);
  const search = createWebSearch({ engine: 'brave', apiKey: 'k', fetch });

  const outcome = await search.search('Acme kariera', call());

  assert.equal(outcome.status, 'failed');
  assert.match(outcome.status === 'failed' ? outcome.detail : '', /rate-limited/);
});

test('a challenge served as a success code is still a refusal', async () => {
  // The wall arrives as HTTP 202 carrying a modal, and the modal's wording is
  // not something to depend on. A 2xx that produced no results at all is the
  // signal; read as a success it becomes "nothing matched that employer".
  const { fetch } = fakeFetch([new Response('<html><body></body></html>', { status: 202 })]);
  const search = createWebSearch({ engine: 'duckduckgo', fetch });

  const outcome = await search.search('Acme kariera', call());

  assert.equal(outcome.status, 'failed');
  assert.match(outcome.status === 'failed' ? outcome.detail : '', /BRAVE_API_KEY/);
});

test('a refusal wearing a 200 is caught by what the page says', async () => {
  // Checked only against a response that produced no results: "blocked" and
  // "captcha" are ordinary words in the snippets of a page full of real ones.
  const { fetch } = fakeFetch([
    new Response('<html><body>Our systems have detected unusual traffic.</body></html>')
  ]);
  const search = createWebSearch({ engine: 'duckduckgo', fetch });

  const outcome = await search.search('Acme kariera', call());

  assert.equal(outcome.status, 'failed');
});

test('an engine that answered with nothing is an answer about the employer', async () => {
  const { fetch } = fakeFetch([new Response('<html><body>No results.</body></html>')]);
  const search = createWebSearch({ engine: 'duckduckgo', fetch });

  const outcome = await search.search('Zażółć Gęślą Jaźń sp. z o.o.', call());

  assert.equal(outcome.status, 'ok');
  assert.deepEqual(outcome.status === 'ok' ? outcome.hits : undefined, []);
});

/* ----------------------------------------------------------- manners */

test('the same question twice costs one request', async () => {
  // "Check again" is a button a person presses while editing the field beside
  // it, and it asks the identical two queries every time.
  const { fetch, asked } = fakeFetch([brave([{ title: 'Acme', url: 'https://acme.test/', description: '' }])]);
  const search = createWebSearch({ engine: 'brave', apiKey: 'k', fetch });

  const first = await search.search('Acme kariera', call());
  const second = await search.search('Acme kariera', call());

  assert.deepEqual(first, second);
  assert.equal(asked.length, 1);
});

test('a refusal is forgotten sooner than an answer', async () => {
  // Long enough to stop a retry loop hammering an engine that just refused,
  // short enough that fixing a key takes effect before the coffee is cold.
  let clock = 1_000_000;
  const { fetch, asked } = fakeFetch([
    new Response('', { status: 429 }),
    brave([{ title: 'Acme', url: 'https://acme.test/', description: '' }]),
    brave([])
  ]);
  const search = createWebSearch({
    engine: 'brave',
    apiKey: 'k',
    fetch,
    now: () => clock,
    spacingMs: { brave: 0 }
  });

  await search.search('Acme kariera', call());
  clock += 90_000;
  const retried = await search.search('Acme kariera', call());

  assert.equal(retried.status, 'ok');
  assert.equal(asked.length, 2, 'the failure was still cached after 90 seconds');

  clock += 90_000;
  await search.search('Acme kariera', call());

  assert.equal(asked.length, 2, 'the answer was dropped inside ten minutes');
});

test('two queries never overlap, whatever the caller does', async () => {
  const { fetch, peak } = fakeFetch([brave([]), brave([])]);
  const search = createWebSearch({
    engine: 'brave',
    apiKey: 'k',
    fetch,
    spacingMs: { brave: 0 }
  });

  await Promise.all([
    search.search('Acme kariera', call()),
    search.search('Acme kontakt', call())
  ]);

  assert.equal(peak(), 1);
});

test('a query queued behind another does not sit out the spacing after a cancel', async () => {
  // The same defect the offer reader had: a signal aborted before the delay
  // begins never fires `abort` again, so a listener alone leaves a cancelled
  // run waiting out the full interval and then searching anyway.
  const { fetch } = fakeFetch([brave([]), brave([])]);
  const search = createWebSearch({
    engine: 'brave',
    apiKey: 'k',
    fetch,
    // Long enough that waiting it out would be obvious in the test's runtime.
    spacingMs: { brave: 30_000 }
  });

  await search.search('Acme kariera', call());

  const stop = new AbortController();
  const queued = search.search('Acme kontakt', call(stop.signal));

  stop.abort();

  const error = await queued.then(
    () => undefined,
    (reason: unknown) => reason
  );

  assert.equal(codeOf(error), 'aborted');
});

test('one runtime’s allowance is not spent by another’s cache', async () => {
  // Per instance, not per module: the rate limit being spaced against belongs
  // to a key, and a composition root owns one key.
  const { fetch, asked } = fakeFetch([brave([]), brave([])]);

  await createWebSearch({ engine: 'brave', apiKey: 'one', fetch }).search('Acme', call());
  await createWebSearch({ engine: 'brave', apiKey: 'two', fetch }).search('Acme', call());

  assert.equal(asked.length, 2);
});
