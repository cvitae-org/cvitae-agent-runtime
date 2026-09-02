/**
 * The web tier, in the parts that are worth pinning down.
 *
 * Everything here is pure or refuses before it reaches the network, so the
 * suite makes no requests. Three properties are the reason this file exists:
 *
 *   · a search result is a pointer — it can never name a recipient by itself
 *   · a board, a social profile and an applicant tracking system are not the
 *     employer's domain, however often they rank above it
 *   · a URL this project did not choose cannot be used to reach a private
 *     address, at the first hop or at a later one
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectApplyRoutes,
  domainCandidates,
  hostKind,
  pagesToOpen,
  routeKind
} from '../src/capabilities/applyRoutes.js';
import { rankRecipients } from '../src/capabilities/recipientRanking.js';
import { isPrivateAddress, refuseUrl } from '../src/offers/page.js';
import { resolveOffer } from '../src/offers/resolve.js';
import { parseDuckDuckGo } from '../src/offers/webSearch.js';

const hit = (url: string, title = '', snippet = '') => ({ url, title, snippet });

/* ------------------------------------------------------------- parsing --- */

test('a wrapped result is unwrapped to the page it points at', () => {
  const html = `
    <a rel="nofollow" class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fupvanta.com%2Fkariera&rut=abc">Kariera — Upvanta</a>
    <td class="result-snippet">Dołącz do zespołu. rekrutacja@upvanta.com</td>
  `;

  const [first] = parseDuckDuckGo(html);

  assert.equal(first?.url, 'https://upvanta.com/kariera');
  assert.equal(first?.title, 'Kariera — Upvanta');
  assert.match(first?.snippet ?? '', /rekrutacja@upvanta\.com/);
});

test('sponsored placements never become results', () => {
  // Ad slots are anchors with the same shape and no `uddg`. Left in, they would
  // be fetched and scanned for addresses like any other page.
  const html = `
    <a class="result-link" href="//duckduckgo.com/y.js?ad_provider=x">Sponsored</a>
    <a class="result__a" href="https://upvanta.com/">Upvanta</a>
  `;

  const hits = parseDuckDuckGo(html);

  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.url, 'https://upvanta.com/');
});

/* ------------------------------------------------------ what a host is --- */

test('a board, a network and an ATS are told apart from an employer', () => {
  assert.equal(hostKind('https://justjoin.it/offers/upvanta-lead'), 'board');
  assert.equal(hostKind('https://www.linkedin.com/company/upvanta'), 'board');
  assert.equal(hostKind('https://www.facebook.com/upvanta'), 'social');
  assert.equal(hostKind('https://jobs.lever.co/upvanta/1234'), 'ats');
  assert.equal(hostKind('https://aleo.com/pl/firma/upvanta'), 'directory');
  assert.equal(hostKind('https://upvanta.com/kariera'), 'employer');
});

test('a careers page is recognised from the path, the title, or neither', () => {
  assert.equal(routeKind('https://upvanta.com/kariera'), 'careers');
  assert.equal(routeKind('https://upvanta.com/kontakt'), 'contact');
  assert.equal(routeKind('https://jobs.lever.co/upvanta'), 'ats');
  // The path decides when it says anything at all; the title is the fallback
  // for the sites that name their careers page something unguessable.
  assert.equal(routeKind('https://upvanta.com/pl/team-2024'), 'page');
  assert.equal(
    routeKind('https://upvanta.com/pl/team-2024', 'Dołącz do nas — rekrutacja'),
    'careers'
  );
  assert.equal(routeKind('https://upvanta.com/produkt'), 'page');
});

/* ------------------------------------------------ which domain is theirs - */

test('the employer domain is preferred over the boards that outrank it', () => {
  const [best] = domainCandidates(
    [
      hit('https://justjoin.it/offers/upvanta-lead-developer', 'Upvanta Lead Developer'),
      hit('https://www.linkedin.com/company/upvanta', 'Upvanta | LinkedIn'),
      hit('https://upvanta.com/kariera', 'Kariera — Upvanta'),
      hit('https://upvanta.com/', 'Upvanta')
    ],
    'Upvanta'
  );

  assert.equal(best?.domain, 'upvanta.com');
});

test('a legal form in the name does not stop the domain being recognised', () => {
  const [best] = domainCandidates(
    [hit('https://upvanta.com/', 'Upvanta'), hit('https://example.org/', 'Something else')],
    'Upvanta Sp. z o.o.'
  );

  assert.equal(best?.domain, 'upvanta.com');
});

test('an ATS is never proposed as the employer own domain', () => {
  // `jobs.lever.co` belongs to Lever and hosts thousands of employers. Believing
  // it would make every address on Lever's domain a match for this company.
  const candidates = domainCandidates(
    [hit('https://jobs.lever.co/upvanta', 'Upvanta jobs')],
    'Upvanta'
  );

  assert.deepEqual(candidates, []);
});

/* --------------------------------------------------- which pages to open - */

test('a page whose snippet already shows an address is opened first', () => {
  const picks = pagesToOpen(
    [
      hit('https://upvanta.com/kariera', 'Kariera'),
      hit('https://upvanta.com/kontakt', 'Kontakt', 'napisz do nas: hr@upvanta.com')
    ],
    { companyDomains: ['https://upvanta.com'] }
  );

  assert.equal(picks[0]?.url, 'https://upvanta.com/kontakt');
  assert.equal(picks[0]?.promising, true);
});

test('boards and directories are not opened, and read pages are not reread', () => {
  const picks = pagesToOpen(
    [
      hit('https://justjoin.it/offers/upvanta', 'Upvanta'),
      hit('https://aleo.com/pl/firma/upvanta', 'Upvanta — dane firmy'),
      hit('https://upvanta.com/kariera', 'Kariera'),
      hit('https://jobs.lever.co/upvanta', 'Apply')
    ],
    {
      companyDomains: ['https://upvanta.com'],
      // The company crawl already read this one, with a trailing slash.
      alreadyRead: ['https://upvanta.com/kariera/']
    }
  );

  assert.deepEqual(
    picks.map((pick) => pick.url),
    ['https://jobs.lever.co/upvanta']
  );
});

test('a stranger site is not opened once the employer domain is known', () => {
  const picks = pagesToOpen([hit('https://another-company.com/kariera', 'Kariera')], {
    companyDomains: ['https://upvanta.com']
  });

  assert.deepEqual(picks, []);
});

test('apply routes are deduplicated across the tiers that found them', () => {
  // The board's stated apply link and the top search result are frequently the
  // same ATS page, and showing it twice makes the list look assembled.
  const routes = collectApplyRoutes([
    { url: 'https://jobs.lever.co/upvanta/1', kind: 'form', host: 'jobs.lever.co', source: 'board' },
    { url: 'https://upvanta.com/kariera', kind: 'careers', host: 'upvanta.com', source: 'company_site' },
    { url: 'https://jobs.lever.co/upvanta/1/', kind: 'ats', host: 'jobs.lever.co', source: 'web' }
  ]);

  assert.equal(routes.length, 2);
  // The one that takes an application comes first.
  assert.equal(routes[0]?.kind, 'form');
});

/* ------------------------------------------------------ where it may go --- */

test('private and loopback addresses are recognised in both families', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1'
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }

  for (const address of ['8.8.8.8', '93.184.216.34', '2606:2800:220:1::1']) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test('a search result pointing at the machine itself is refused', async () => {
  // No DNS is involved for a literal or for a local name, so this stays offline.
  assert.ok(await refuseUrl('http://127.0.0.1:8787/document'));
  assert.ok(await refuseUrl('http://169.254.169.254/latest/meta-data/'));
  assert.ok(await refuseUrl('http://localhost/'));
  assert.ok(await refuseUrl('http://scraper.internal/'));
  assert.ok(await refuseUrl('file:///etc/passwd'));
  assert.equal(await refuseUrl('https://8.8.8.8/'), undefined);
});

/* ---------------------------------------------------- what it is worth --- */

test('an address found only by web search is never strong on its own', () => {
  const [candidate] = rankRecipients({
    gathered: [
      {
        source: 'web_page',
        url: 'https://jobs.lever.co/upvanta',
        text: 'Send your CV to recruitment@some-agency.com'
      }
    ],
    companyDomains: ['https://upvanta.com']
  });

  assert.equal(candidate?.address, 'recruitment@some-agency.com');
  assert.equal(candidate?.confidence, 'low');
  assert.equal(candidate?.domain_match, false);
});

test('a page found by search cannot vouch for the domain it names', () => {
  // Only the employer's own site attests a domain. Without that rule, an ATS
  // page naming an agency address would make that agency's domain count as the
  // employer's, and every address on it would read as a match.
  const ranked = rankRecipients({
    gathered: [
      {
        source: 'web_page',
        url: 'https://jobs.lever.co/upvanta',
        text: 'hr@some-agency.com'
      },
      {
        source: 'offer',
        url: 'https://justjoin.it/offers/upvanta',
        text: 'Aplikuj: hr@some-agency.com'
      }
    ],
    companyDomains: ['https://upvanta.com']
  });

  const candidate = ranked[0];

  assert.equal(candidate?.corroborated, true);
  assert.equal(candidate?.domain_match, false);
  // Corroboration without a domain match is still not a recommendation.
  assert.equal(candidate?.confidence, 'low');
});

test('a web page corroborating an address on the employer domain does count', () => {
  const [candidate] = rankRecipients({
    gathered: [
      { source: 'offer', url: 'https://justjoin.it/x', text: 'kariera@upvanta.com' },
      {
        source: 'web_page',
        url: 'https://jobs.lever.co/upvanta',
        text: 'Applications: kariera@upvanta.com'
      }
    ],
    companyDomains: ['https://upvanta.com']
  });

  assert.equal(candidate?.domain_match, true);
  assert.equal(candidate?.corroborated, true);
  assert.equal(candidate?.confidence, 'high');
  assert.ok(candidate?.why.some((reason) => /web search/i.test(reason)));
});

/* ------------------------------------------------------- offer URLs --- */

/**
 * The guard above was written for URLs a search engine returned. It now runs on
 * offer URLs as well, which look safer only until the runtime is somewhere a
 * stranger can post to it — and the local deployment has the better targets
 * anyway: cvitae-mail on :8789 holds a Gmail token, and this process's own
 * :8788 would otherwise analyse its own health endpoint.
 *
 * These refuse before any socket is opened, so the suite still makes no
 * requests.
 */
test('an offer URL pointing at another service on this machine is refused', async () => {
  const outcome = await resolveOffer('http://127.0.0.1:8789/drafts');

  assert.equal(outcome.status, 'error');
  assert.match(
    outcome.status === 'error' ? outcome.detail : '',
    /not a public address/
  );
});

test('an offer URL pointing at the cloud metadata service is refused', async () => {
  const outcome = await resolveOffer('http://169.254.169.254/latest/meta-data/');

  assert.equal(outcome.status, 'error');
});

test('"localhost" is refused by name, before it is ever resolved', async () => {
  const outcome = await resolveOffer('http://localhost:8788/health');

  assert.equal(outcome.status, 'error');
  assert.match(
    outcome.status === 'error' ? outcome.detail : '',
    /not a public host/
  );
});
