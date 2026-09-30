/**
 * What the offer reader is allowed to fetch, and what it does with what it got.
 *
 * The first test is the one worth keeping. Every guard of this kind is easy to
 * write for the URL the caller supplied and easy to forget for the URL a server
 * supplies afterwards, and the second is the one an attacker controls. It was
 * confirmed by breaking it: hoisting the `refuseUrl` call out of the redirect
 * loop so only the caller's URL is vetted makes this test — and only this test —
 * fail, with the metadata address fetched and its body returned as page text.
 *
 * The politeness tests were confirmed the same way. Dropping the `perHost`
 * wrapper fails both of them: the same-host peak goes from 1 to 2, and the
 * cancellation test then resolves instead of rejecting, because nothing is
 * waiting to be cancelled.
 *
 * That cancellation test earned its place by finding a real defect. `sleep`
 * registered an abort listener without first checking `signal.aborted`, and a
 * signal aborted before the delay begins never fires `abort` again — so a run
 * cancelled while queued behind another read of the same host sat out the full
 * interval and then fetched anyway. The test took 30 seconds and reported a
 * successful fetch; it now takes under a millisecond.
 *
 * The second half covers the three reads that are not the posting — a page, an
 * employer's site, a board's listing rows. Each was confirmed the same way, by
 * one mutation apiece: collapsing `refused` into `unreadable`, removing the
 * thin-page floor, carrying the scraper's `missed` list through to the caller,
 * and dropping `listingOnly` from the search request each fail exactly one of
 * them. The `missed` one is the least obvious and the most worth keeping — a
 * careers page the scraper could not fetch is a fact about the fetch, and a
 * ranking step handed that list will read it as "this employer publishes no
 * address".
 *
 * Everything here runs against an injected `fetch` and an injected resolver, so
 * no test in this file opens a socket or asks a nameserver anything.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeError } from '../src/contracts/index.js';
import { createWebReader, type HostResolver } from '../src/effects/offers.js';

/* --------------------------------------------------------------- fixtures */

/** Long enough to clear the "this is a JavaScript shell" floor. */
const OFFER_HTML =
  '<html><body><h1>Senior TypeScript Engineer</h1><p>'
  + 'We are looking for an engineer to work on our platform team. '.repeat(12)
  + '</p></body></html>';

const PUBLIC_ADDRESS = '93.184.216.34';
const SCRAPER_TOKEN = '0123456789abcdef0123456789abcdef';

const resolver: HostResolver = async (host) => {
  if (host.endsWith('.example')) return [PUBLIC_ADDRESS];
  throw new Error(`unexpected lookup: ${host}`);
};

type Reply = Response | (() => Response);

/** Records every URL asked for, and answers from a table. */
const fakeFetch = (replies: Record<string, Reply>) => {
  const asked: string[] = [];
  let inFlight = 0;
  let peak = 0;

  const fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    asked.push(url);
    inFlight += 1;
    peak = Math.max(peak, inFlight);

    try {
      // A turn of the loop, so overlapping calls are visible as overlapping.
      await Promise.resolve();

      const reply = replies[url];

      if (!reply) throw new Error(`unexpected fetch: ${url}`);

      return typeof reply === 'function' ? reply() : reply.clone();
    } finally {
      inFlight -= 1;
    }
  }) as unknown as typeof globalThis.fetch;

  return { fetch, asked, peak: () => peak };
};

const callFor = (signal: AbortSignal = new AbortController().signal) => ({
  traceId: 'trace-1',
  runId: 'run-1',
  step: 'fetch_offer',
  signal
});

const codeOf = (error: unknown): string =>
  error instanceof RuntimeError ? error.code : `not a RuntimeError: ${String(error)}`;

/* ------------------------------------------------------ where it may go */

test('the guard runs at every redirect, not only the first', async () => {
  const metadata = 'http://169.254.169.254/latest/meta-data/';
  const { fetch, asked } = fakeFetch({
    'https://board.example/offer/1': new Response(null, {
      status: 302,
      headers: { location: metadata }
    }),
    [metadata]: new Response('ami-id\ninstance-id\niam/security-credentials/')
  });

  const reader = createWebReader({ scraperUrl: '', fetch, resolveHost: resolver });

  const error = await reader.resolve('https://board.example/offer/1', callFor()).then(
    () => undefined,
    (reason: unknown) => reason
  );

  assert.equal(codeOf(error), 'invalid_input');
  assert.match((error as Error).message, /169\.254\.169\.254/);

  // The point of the test: the second hop was never requested. A guard that
  // only vets the URL the caller supplied would have this list at length 2.
  assert.deepEqual(asked, ['https://board.example/offer/1']);
});

test('a host that resolves to loopback is refused before any request', async () => {
  const { fetch, asked } = fakeFetch({});
  const reader = createWebReader({
    scraperUrl: '',
    fetch,
    // The classic bypass: one public answer and one private one.
    resolveHost: async () => [PUBLIC_ADDRESS, '127.0.0.1']
  });

  const error = await reader.resolve('https://board.example/offer/1', callFor()).then(
    () => undefined,
    (reason: unknown) => reason
  );

  assert.equal(codeOf(error), 'invalid_input');
  assert.deepEqual(asked, []);
});

/* ------------------------------------------------ what came back, judged */

test('a bot-protection challenge asks for a paste rather than reporting a failure', async () => {
  const { fetch } = fakeFetch({
    'https://board.example/offer/1': new Response(
      '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>',
      { status: 403 }
    )
  });

  const reader = createWebReader({ scraperUrl: '', fetch, resolveHost: resolver });

  const error = await reader.resolve('https://board.example/offer/1', callFor()).then(
    () => undefined,
    (reason: unknown) => reason
  );

  // Not `step_failed`: nothing failed, and the only thing that works from here
  // is a person pasting the text. Collapsing the two costs them that.
  assert.equal(codeOf(error), 'unreadable_source');
  assert.match((error as Error).message, /Paste the offer text manually/);
});

test('a page that renders client-side is an unreadable source', async () => {
  const { fetch } = fakeFetch({
    'https://board.example/offer/1': new Response('<html><body><div id="root"></div></body></html>')
  });

  const reader = createWebReader({ scraperUrl: '', fetch, resolveHost: resolver });

  const error = await reader.resolve('https://board.example/offer/1', callFor()).then(
    () => undefined,
    (reason: unknown) => reason
  );

  assert.equal(codeOf(error), 'unreadable_source');
});

test('a transport failure stays a failure, because trying again is reasonable', async () => {
  const { fetch } = fakeFetch({
    'https://board.example/offer/1': () => {
      throw new Error('socket hang up');
    }
  });

  const reader = createWebReader({ scraperUrl: '', fetch, resolveHost: resolver });

  const error = await reader.resolve('https://board.example/offer/1', callFor()).then(
    () => undefined,
    (reason: unknown) => reason
  );

  // `unreadable_source` promises there was nothing to read. A closed socket
  // promises nothing of the kind.
  assert.equal(codeOf(error), 'step_failed');
});

test('a readable page comes back as text, with the furniture stripped', async () => {
  const { fetch } = fakeFetch({
    'https://board.example/offer/1': new Response(
      `<html><body><nav>Zaloguj się | Cennik</nav>${OFFER_HTML}
       <script>window.__DATA__ = 1;</script></body></html>`
    )
  });

  const reader = createWebReader({ scraperUrl: '', fetch, resolveHost: resolver });
  const offer = await reader.resolve('https://board.example/offer/1', callFor());

  assert.match(offer.text, /Senior TypeScript Engineer/);
  assert.doesNotMatch(offer.text, /Cennik/);
  assert.doesNotMatch(offer.text, /__DATA__/);
  assert.equal(offer.stated, undefined);
});

/* ----------------------------------------------------------- the scraper */

test('the scraper address cannot redirect credentials away from the local API contract', () => {
  for (const scraperUrl of [
    'https://example.com:8787',
    'ftp://127.0.0.1:8787',
    'http://user:password@127.0.0.1:8787',
    'http://127.0.0.1:8787?token=bad',
    'http://127.0.0.1:8787#fragment'
  ]) {
    assert.throws(() => createWebReader({ scraperUrl }), { code: 'misconfigured' });
  }
});

test("the scraper's refusal is final — the plain fetch is never tried", async () => {
  const scraperUrl = 'http://127.0.0.1:8787';
  const { fetch, asked } = fakeFetch({
    [`${scraperUrl}/scrape/offer`]: new Response(
      JSON.stringify({ status: 'disallowed', detail: 'robots.txt forbids /offer/.' })
    ),
    'https://board.example/offer/1': new Response(OFFER_HTML)
  });

  const reader = createWebReader({ scraperUrl, scraperToken: SCRAPER_TOKEN, fetch, resolveHost: resolver });

  const error = await reader.resolve('https://board.example/offer/1', callFor()).then(
    () => undefined,
    (reason: unknown) => reason
  );

  assert.equal(codeOf(error), 'unreadable_source');
  // Falling back here would fetch a path the scraper had just honoured a
  // `Disallow` for. The board was never asked.
  assert.deepEqual(asked, [`${scraperUrl}/scrape/offer`]);
});

test('a scraper that is not running is not an answer about the offer', async () => {
  const scraperUrl = 'http://127.0.0.1:8787';
  const { fetch, asked } = fakeFetch({
    [`${scraperUrl}/scrape/offer`]: () => {
      throw new Error('ECONNREFUSED');
    },
    'https://board.example/offer/1': new Response(OFFER_HTML)
  });

  const reader = createWebReader({ scraperUrl, scraperToken: SCRAPER_TOKEN, fetch, resolveHost: resolver });
  const offer = await reader.resolve('https://board.example/offer/1', callFor());

  assert.match(offer.text, /Senior TypeScript Engineer/);
  assert.deepEqual(asked, [`${scraperUrl}/scrape/offer`, 'https://board.example/offer/1']);
});

test('what the board stated comes back uninterpreted, and only the declared fields', async () => {
  const scraperUrl = 'http://127.0.0.1:8787';
  const { fetch } = fakeFetch({
    [`${scraperUrl}/scrape/offer`]: new Response(
      JSON.stringify({
        status: 'ok',
        data: {
          board: 'vacancies',
          source_url: 'https://board.example/offer/1?ref=canonical',
          extraction: 'jsonld',
          title: 'Senior TypeScript Engineer',
          company: 'Acme',
          salary: '18000 - 24000 PLN',
          work_mode: 'Praca zdalna',
          contract_type: 'B2B',
          required_skills: ['TypeScript', 'Node.js'],
          text: OFFER_HTML
        }
      })
    )
  });

  const reader = createWebReader({ scraperUrl, scraperToken: SCRAPER_TOKEN, fetch, resolveHost: resolver });
  const offer = await reader.resolve('https://board.example/offer/1', callFor());

  assert.equal(offer.board, 'vacancies');
  assert.equal(offer.finalUrl, 'https://board.example/offer/1?ref=canonical');

  // Verbatim: `work_mode` is the board's Polish phrase, not a `WorkMode`.
  // Narrowing it is domain judgment, and this is not where that happens.
  assert.deepEqual(offer.stated, {
    company: 'Acme',
    title: 'Senior TypeScript Engineer',
    work_mode: 'Praca zdalna',
    salary: '18000 - 24000 PLN',
    required_skills: ['TypeScript', 'Node.js'],
    contract_type: 'B2B'
  });

  // Only a recognized contract form is admitted, independently of employment type.
  assert.equal(offer.stated?.contract_type, 'B2B');
});

/* -------------------------------------------------------------- manners */

test('two reads of one host do not overlap; two hosts do', async () => {
  const same = fakeFetch({
    'https://board.example/a': new Response(OFFER_HTML),
    'https://board.example/b': new Response(OFFER_HTML)
  });
  const sameReader = createWebReader({
    scraperUrl: '',
    fetch: same.fetch,
    resolveHost: resolver,
    minHostIntervalMs: 0
  });

  await Promise.all([
    sameReader.resolve('https://board.example/a', callFor()),
    sameReader.resolve('https://board.example/b', callFor())
  ]);

  assert.equal(same.peak(), 1);

  const across = fakeFetch({
    'https://one.example/a': new Response(OFFER_HTML),
    'https://two.example/a': new Response(OFFER_HTML)
  });
  const acrossReader = createWebReader({
    scraperUrl: '',
    fetch: across.fetch,
    resolveHost: resolver,
    minHostIntervalMs: 0
  });

  await Promise.all([
    acrossReader.resolve('https://one.example/a', callFor()),
    acrossReader.resolve('https://two.example/a', callFor())
  ]);

  assert.equal(across.peak(), 2);
});

test('cancelling a run does not sit out the politeness delay', async () => {
  const { fetch } = fakeFetch({
    'https://board.example/a': new Response(OFFER_HTML),
    'https://board.example/b': new Response(OFFER_HTML)
  });

  const reader = createWebReader({
    scraperUrl: '',
    fetch,
    resolveHost: resolver,
    // Long enough that waiting it out would be obvious in the test's runtime.
    minHostIntervalMs: 30_000
  });

  const stop = new AbortController();

  await reader.resolve('https://board.example/a', callFor());

  const queued = reader.resolve('https://board.example/b', callFor(stop.signal));
  stop.abort();

  const error = await queued.then(
    () => undefined,
    (reason: unknown) => reason
  );

  assert.equal(codeOf(error), 'aborted');
});

/* ------------------------------------------------- reading beyond the board */

test('a page the guard refuses is refused, not merely unreadable', async () => {
  // Three outcomes rather than two, because a search engine that keeps
  // pointing at addresses the guard turns down is worth seeing in a log, and
  // "the page had nothing on it" would hide exactly that.
  const { fetch, asked } = fakeFetch({});
  const reader = createWebReader({ scraperUrl: '', fetch, resolveHost: resolver });

  const outcome = await reader.readPage('http://169.254.169.254/latest/meta-data/', callFor());

  assert.equal(outcome.status, 'refused');
  assert.deepEqual(asked, []);
});

test('a URL that is not a URL never reaches the network', async () => {
  const { fetch, asked } = fakeFetch({});
  const reader = createWebReader({ scraperUrl: '', fetch, resolveHost: resolver });

  const outcome = await reader.readPage('kariera', callFor());

  assert.equal(outcome.status, 'refused');
  assert.deepEqual(asked, []);
});

test('a page too thin to read returns no text at all', async () => {
  // Not "ok with a short string". A caller handed 40 characters would scan
  // them for an address and report finding none, which is a claim about the
  // employer made from a page that never rendered.
  const { fetch } = fakeFetch({
    'https://acme.example/kariera': new Response('<html><body><p>Kariera</p></body></html>')
  });
  const reader = createWebReader({ scraperUrl: '', fetch, resolveHost: resolver });

  const outcome = await reader.readPage('https://acme.example/kariera', callFor());

  assert.equal(outcome.status, 'unreadable');
  assert.equal('text' in outcome, false);
});

test('a readable page comes back with the URL it actually landed on', async () => {
  const { fetch } = fakeFetch({
    'https://acme.example/kariera': new Response(null, {
      status: 301,
      headers: { location: 'https://acme.example/pl/kariera' }
    }),
    'https://acme.example/pl/kariera': new Response(OFFER_HTML)
  });
  const reader = createWebReader({ scraperUrl: '', fetch, resolveHost: resolver });

  const outcome = await reader.readPage('https://acme.example/kariera', callFor());

  assert.equal(outcome.status, 'ok');
  assert.equal(outcome.status === 'ok' && outcome.finalUrl, 'https://acme.example/pl/kariera');
});

test('asking for a company site with neither a site nor a name asks nobody', async () => {
  const scraperUrl = 'http://127.0.0.1:8787';
  const { fetch, asked } = fakeFetch({});
  const reader = createWebReader({ scraperUrl, scraperToken: SCRAPER_TOKEN, fetch, resolveHost: resolver });

  const outcome = await reader.readCompany({}, callFor());

  assert.equal(outcome.status, 'failed');
  assert.deepEqual(asked, []);
});

test('a company read with no scraper is unavailable, not a fact about the employer', async () => {
  // This tier has no fallback, so the difference decides what the caller says:
  // "we could not look" is a note about the deployment, while "we looked and
  // found nothing" would be a claim about the company.
  const scraperUrl = 'http://127.0.0.1:8787';
  const { fetch } = fakeFetch({
    [`${scraperUrl}/scrape/company`]: () => {
      throw new Error('ECONNREFUSED');
    }
  });
  const reader = createWebReader({ scraperUrl, scraperToken: SCRAPER_TOKEN, fetch, resolveHost: resolver });

  const outcome = await reader.readCompany({ url: 'https://acme.example' }, callFor());

  assert.equal(outcome.status, 'unavailable');
});

test('a page the scraper could not read is not carried as evidence of anything', async () => {
  const scraperUrl = 'http://127.0.0.1:8787';
  const { fetch } = fakeFetch({
    [`${scraperUrl}/scrape/company`]: new Response(
      JSON.stringify({
        status: 'ok',
        data: {
          origin: 'https://acme.example',
          discovered: true,
          corroborated: false,
          pages: [
            { url: 'https://acme.example/', kind: 'home', text: 'Acme.' },
            // Empty, so nothing was read; and a kind nobody declared.
            { url: 'https://acme.example/kontakt', kind: 'contact', text: '   ' },
            { url: 'https://acme.example/blog', kind: 'blog', text: 'Posts.' }
          ],
          missed: ['https://acme.example/kariera']
        }
      })
    )
  });
  const reader = createWebReader({ scraperUrl, scraperToken: SCRAPER_TOKEN, fetch, resolveHost: resolver });

  const outcome = await reader.readCompany({ url: 'https://acme.example' }, callFor());

  assert.equal(outcome.status, 'ok');
  assert.deepEqual(
    outcome.status === 'ok' ? outcome.data.pages.map((page) => page.url) : [],
    ['https://acme.example/']
  );
  // A careers page that failed to fetch is a fact about the fetch. Handing it
  // over invites a ranking step to read it as "this employer publishes none".
  assert.equal(outcome.status === 'ok' && 'missed' in outcome.data, false);
  assert.equal(outcome.status === 'ok' && outcome.data.corroborated, false);
});

test('a board is asked for rows only, and rows missing a URL are dropped', async () => {
  const scraperUrl = 'http://127.0.0.1:8787';
  const sent: unknown[] = [];
  const authorizations: string[] = [];
  const { fetch } = fakeFetch({
    [`${scraperUrl}/scrape/search`]: new Response(
      JSON.stringify({
        status: 'ok',
        data: [
          { board: 'vacancies', url: 'https://vacancies.example/o/acme-1', title: 'Backend Engineer' },
          { board: 'vacancies', title: 'Frontend Engineer' }
        ]
      })
    )
  });

  const recording = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
    return fetch(input, init);
  }) as unknown as typeof globalThis.fetch;

  const reader = createWebReader({ scraperUrl, scraperToken: SCRAPER_TOKEN, fetch: recording, resolveHost: resolver });
  const outcome = await reader.listBoard(
    { board: 'vacancies', keyword: 'backend', limit: 200 },
    callFor()
  );

  assert.equal(outcome.status, 'ok');
  assert.deepEqual(
    outcome.status === 'ok' ? outcome.data.map((row) => row.title) : [],
    ['Backend Engineer']
  );
  // Fetching every result would spend the budget on other companies' postings.
  assert.deepEqual(sent, [
    { board: 'vacancies', keyword: 'backend', limit: 200, listingOnly: true }
  ]);
  assert.deepEqual(authorizations, [`Bearer ${SCRAPER_TOKEN}`]);
  assert.doesNotMatch(String(scraperUrl), new RegExp(SCRAPER_TOKEN));
});

test('Board archival capture retains full source text and extra metadata separately from model limits',async()=>{
 const text='Full job posting content. '.repeat(2000);
 const reader=createWebReader({scraperUrl:'http://127.0.0.1:8000',scraperToken:SCRAPER_TOKEN,minHostIntervalMs:0,resolveHost:resolver,
  fetch:async()=>new Response(JSON.stringify({status:'ok',data:{text,source_url:'https://jobs.example/role',board:'example',title:'Engineer',custom_application_field:'Availability',salary:'20 000 PLN'}}),{headers:{'Content-Type':'application/json'}})});
 const call={traceId:'board-capture',signal:new AbortController().signal};
 const archived=await reader.capture!('https://jobs.example/role',call);
 assert.equal(archived.text,text);assert.equal(archived.sourceData?.custom_application_field,'Availability');assert.equal(archived.contentTruncated,false);
 const model=await reader.resolve('https://jobs.example/role',call);assert.equal(model.text.length,20000);
});
test('oversized archival source is explicitly marked truncated',async()=>{
 const reader=createWebReader({scraperUrl:'http://127.0.0.1:8000',scraperToken:SCRAPER_TOKEN,minHostIntervalMs:0,resolveHost:resolver,
  fetch:async()=>new Response(JSON.stringify({status:'ok',data:{text:'Posting '.repeat(150000)}}),{headers:{'Content-Type':'application/json'}})});
 const archived=await reader.capture!('https://jobs.example/role',{traceId:'large-capture',signal:new AbortController().signal});
 assert.equal(archived.text.length,1000000);assert.equal(archived.contentTruncated,true);
});


test('full capture keeps page text but separates the matching JobPosting description for language detection', async () => {
 const url='https://board.example/offer/1';
 const description='<p>We are looking for an engineer to build reliable services.</p><p>You will develop applications and work with our product team.</p>';
 const html='<p>Przejdź do treści ogłoszenia. Wybrano język polski. </p>'.repeat(20)
  + '<script type="application/ld+json">'+JSON.stringify({'@graph':[
   {'@type':'JobPosting',url:'/offer/2',description:'Projektowanie aplikacji. '.repeat(20)},
   {'@type':'JobPosting',url:url+'?utm_source=board',description}
  ]})+'</script>';
 const {fetch}=fakeFetch({[url]:new Response(html)});
 const reader=createWebReader({scraperUrl:'',fetch,resolveHost:resolver});
 const result=await reader.capture!(url,callFor());
 assert.match(result.text,/Przejdź/);
 assert.equal(result.descriptionText,'We are looking for an engineer to build reliable services.\nYou will develop applications and work with our product team.');
});

test('ambiguous JobPosting metadata never supplies another job’s language evidence', async () => {
 const url='https://board.example/offer/1';
 const html=OFFER_HTML+'<script type="application/ld+json">'+JSON.stringify([
  {'@type':'JobPosting',description:'Other description. '.repeat(20)},
  {'@type':'JobPosting',url:'/offer/2',description:'Different description. '.repeat(20)}
 ])+'</script>';
 const {fetch}=fakeFetch({[url]:new Response(html)});
 const reader=createWebReader({scraperUrl:'',fetch,resolveHost:resolver});
 const result=await reader.capture!(url,callFor());
 assert.equal(result.descriptionText,undefined);
});
