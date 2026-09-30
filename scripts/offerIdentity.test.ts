/**
 * URL identity.
 *
 * Pure, and it fails quietly. A URL normaliser that strips one parameter too
 * many merges two different postings into one row; one that strips too few
 * stores the same job four times. Neither looks like an error from the outside.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseUrl, offerId } from '../src/capabilities/offers/identity.js';

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
