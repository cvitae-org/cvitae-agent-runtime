import {boards} from './fixtures/source-catalogue.js';
/**
 * The board catalogue, URL identity, and query construction.
 *
 * All three are pure, all three were uncovered, and all three fail quietly.
 * A URL normaliser that strips one parameter too many merges two different
 * postings into one row; one that strips too few stores the same job four
 * times. Neither looks like an error from the outside.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardFor as classifyBoard,
  hostOf,
  isFetchable as canFetch,
  scrapableBoards as filterScrapable,
  searchableBoards as filterSearchable
} from '../src/capabilities/offers/boards.js';
import { normaliseUrl, offerId } from '../src/capabilities/offers/identity.js';
import { buildKeywords, buildQueries, queriesForRound } from '../src/capabilities/offers/queries.js';
import { emptyPreferences, preferencesSchema } from '../src/capabilities/offers/preferences.js';
import { emptyDocument, type CvDocument } from '../src/capabilities/cv/document.js';

const boardFor=(url:string)=>classifyBoard(url,boards),isFetchable=(url:string)=>canFetch(url,boards),scrapableBoards=()=>filterScrapable('pl',boards),searchableBoards=()=>filterSearchable('pl',boards);
/* ------------------------------------------------------------- catalogue -- */

test('a board is named once, and found by any of its URLs', () => {
  const board = boardFor('https://vacancies.example/offers/some-role');
  assert.equal(board?.domain, 'vacancies.example');
  assert.equal(boardFor('https://www.vacancies.example/offers/x')?.domain, 'vacancies.example');
  assert.equal(boardFor('https://not-a-board.example/jobs/1'), undefined);
});

test('hostOf drops the www and keeps everything that distinguishes a board', () => {
  assert.equal(hostOf('https://www.rendered.example/praca/x'), 'rendered.example');
  assert.equal(hostOf('https://it.rendered.example/praca/x'), 'it.rendered.example');
  assert.equal(hostOf('not a url'), '');
});

/**
 * The refused list is the load-bearing half of the catalogue. Manual Jobs and
 * Manual Two ban the account that crawls them, so "we have no adapter yet" and "we
 * will not fetch this" have to be different answers.
 */
test('a board we refuse to fetch is not merely one we cannot', () => {
  const manual_jobs = boardFor('https://www.manual.example/jobs/view/1');
  assert.equal(manual_jobs?.fetchable, 'refused');
  assert.equal(isFetchable('https://www.manual.example/jobs/view/1'), false);
  assert.equal(isFetchable('https://vacancies.example/offers/x'), true);
});

test('every board in the catalogue is well formed and unique', () => {
  const domains = boards.map((b) => b.domain);
  assert.equal(new Set(domains).size, domains.length, 'a domain is listed twice');

  for (const board of boards) {
    assert.ok(board.name.length > 0, `${board.domain} has no name`);
    assert.ok(board.markets.length > 0, `${board.domain} names no market`);
  }

  // The two subsets are subsets, and a board we refuse to fetch is in neither.
  for (const board of [...searchableBoards(), ...scrapableBoards()]) {
    assert.notEqual(board.fetchable, 'refused', `${board.domain} is refused yet listed`);
  }
});

/* -------------------------------------------------------------- identity -- */

test('tracking parameters are stripped and meaningful ones are kept', () => {
  assert.equal(
    normaliseUrl('https://vacancies.example/offers/role?utm_source=x&gclid=y'),
    normaliseUrl('https://vacancies.example/offers/role')
  );
  assert.notEqual(
    normaliseUrl('https://boards.example/view?id=1'),
    normaliseUrl('https://boards.example/view?id=2')
  );
});

test('the same posting under two spellings is one id', () => {
  const a = offerId('https://www.vacancies.example/offers/role?utm_campaign=spring');
  const b = offerId('https://vacancies.example/offers/role');
  assert.equal(a, b);
  assert.ok(a.startsWith('offer-'));
});

/**
 * A search engine returns `mailto:` and `javascript:` links often enough that
 * handling them here beats handling them at every call site. `''` is the
 * caller's signal for "not a candidate".
 */
test('anything that is not an http URL is not a candidate', () => {
  for (const bad of ['mailto:jobs@example.com', 'javascript:void(0)', 'not a url', '']) {
    assert.equal(normaliseUrl(bad), '', bad);
    assert.equal(offerId(bad), '', bad);
  }
});

/* --------------------------------------------------------------- queries -- */

const cv = (): CvDocument => ({
  ...emptyDocument(),
  skills: {
    ...emptyDocument().skills,
    role: 'Senior Frontend Developer',
    frameworks: ['React', 'React Query', 'React Native'],
    programming_languages: ['TypeScript', 'Elixir']
  }
});

test('keywords come from the CV and the stated requirements', () => {
  const keywords = buildKeywords(
    cv(),
    preferencesSchema.parse({ skills: { strength: 'prefer', require: ['Elixir'] } })
  );

  assert.ok(keywords.includes('elixir'), JSON.stringify(keywords));
  assert.ok(keywords.includes('react'), JSON.stringify(keywords));

  // The role word survives, minus the part that filters nothing: `developer`
  // matches 6,000 of vacancies's 9,783 live offers.
  assert.ok(keywords.includes('frontend'), JSON.stringify(keywords));
  assert.ok(!keywords.includes('developer'), JSON.stringify(keywords));
});

/**
 * Near-duplicate framework names used to eat the six-token budget: a CV listing
 * React, React Query and React Native spent three slots on one token, and the
 * languages beside them were never searched at all. Frameworks and languages
 * are interleaved so neither category can starve the other.
 */
test('one technology cannot spend the whole keyword budget', () => {
  const keywords = buildKeywords(cv(), emptyPreferences());

  assert.equal(keywords.filter((k) => k === 'react').length, 1);
  assert.ok(keywords.includes('typescript'), JSON.stringify(keywords));
  assert.ok(keywords.includes('elixir'), JSON.stringify(keywords));
});

/**
 * A name too short to filter on is dropped rather than searched. `go` as a slug
 * substring matches `mongo`, `django`, `algolia` and roughly half the board, so
 * the term would cost a request and return noise.
 *
 * The cost is real and is recorded here rather than hidden: Go, C and R cannot
 * be searched for by name on a board listing. They still reach the web-query
 * path, which quotes phrases instead of matching substrings.
 */
test('a technology name too short to filter on is not used as a board term', () => {
  const shortOnly = {
    ...emptyDocument(),
    skills: { ...emptyDocument().skills, role: 'Backend Developer', programming_languages: ['Go', 'C'] }
  };

  assert.deepEqual(buildKeywords(shortOnly, emptyPreferences()), ['backend']);
});

test('an empty profile yields no queries rather than an empty search', () => {
  assert.deepEqual(buildKeywords(emptyDocument(), emptyPreferences()), []);
  assert.deepEqual(buildQueries(emptyDocument(), emptyPreferences()), []);
});

/**
 * Rounds page through the list and then wrap, rather than running out. A
 * standing search that exhausted its queries would go quiet and look like it
 * was still working; re-asking costs nothing, because the market changes
 * underneath the query and the URL dedupe makes a repeated answer free.
 */
test('rounds page through the queries and then wrap', () => {
  const all = ['a', 'b', 'c', 'd', 'e'];

  assert.deepEqual(queriesForRound(all, 1, 2), ['a', 'b']);
  assert.deepEqual(queriesForRound(all, 2, 2), ['c', 'd']);
  assert.deepEqual(queriesForRound(all, 3, 2), ['e', 'a']);

  // Rounds are one-based; a caller counting from zero gets the first page
  // rather than a page before the beginning.
  assert.deepEqual(queriesForRound(all, 0, 2), queriesForRound(all, 1, 2));
});

/** No query list, or no room, means no search — not a search for nothing. */
test('an empty list or an empty round asks nothing', () => {
  assert.deepEqual(queriesForRound([], 1, 3), []);
  assert.deepEqual(queriesForRound(['a'], 1, 0), []);
  // A round wider than the list does not ask the same question twice.
  assert.deepEqual(queriesForRound(['a', 'b'], 1, 5), ['a', 'b']);
});
