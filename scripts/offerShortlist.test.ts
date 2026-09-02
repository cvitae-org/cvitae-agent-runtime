/**
 * The report half of the hunt: ranking, the tally around it, and the one
 * narrowing of a stored `rating.detail`.
 *
 * The ordering is the part worth pinning. It encodes a judgement — that an
 * offer silent about salary belongs above one that fails the floor and below
 * one that clears it — and a judgement expressed as a comparator is exactly the
 * kind of thing a later edit reorders by accident while still looking correct.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfferRecord, OfferRating } from '../src/contracts/index.js';
import { offerView, readScoreDetail, shortlist } from '../src/capabilities/offers/shortlist.js';

const AT = 1_760_000_000_000;

const rating = (over: Partial<OfferRating> = {}): OfferRating => ({
  eligibility: 'eligible',
  fit: 1,
  completeness: 1,
  ratedAt: AT,
  scorerVersion: '2',
  cvFingerprint: 'cv',
  prefsFingerprint: 'prefs',
  ...over
});

const record = (over: Partial<OfferRecord> = {}): OfferRecord => ({
  id: 'offer-1',
  text: 'a posting',
  firstSeenAt: AT,
  lastSeenAt: AT,
  processing: 'rated',
  disposition: 'active',
  ...over
});

test('the shortlist runs eligible, then provisional, then the rest', () => {
  const offers = [
    record({ id: 'ineligible', rating: rating({ eligibility: 'ineligible' }) }),
    record({ id: 'provisional', rating: rating({ eligibility: 'provisional', fit: 0.2 }) }),
    record({ id: 'eligible-low', rating: rating({ fit: 0.4 }) }),
    record({ id: 'eligible-high', rating: rating({ fit: 0.9 }) })
  ];

  // Scope `shortlist` drops the ineligible one entirely; scope `rated` keeps it
  // and shows where it sits, which is the difference between "what now" and
  // "what did the scorer think".
  assert.deepEqual(
    shortlist(offers).offers.map((o) => o.id),
    ['eligible-high', 'eligible-low', 'provisional']
  );
  assert.deepEqual(
    shortlist(offers, { scope: 'rated' }).offers.map((o) => o.id),
    ['eligible-high', 'eligible-low', 'provisional', 'ineligible']
  );
});

test('a tie on fit is broken by how much the posting actually said', () => {
  const offers = [
    record({ id: 'vague', rating: rating({ fit: 0.5, completeness: 0.3 }) }),
    record({ id: 'detailed', rating: rating({ fit: 0.5, completeness: 0.9 }) })
  ];

  assert.deepEqual(
    shortlist(offers).offers.map((o) => o.id),
    ['detailed', 'vague']
  );
});

test('the tally counts the work that is not on the list', () => {
  const offers = [
    record({ id: 'a', rating: rating() }),
    record({ id: 'b', rating: rating({ eligibility: 'provisional' }) }),
    record({ id: 'c', rating: rating({ eligibility: 'ineligible' }) }),
    record({ id: 'd', processing: 'candidate', url: 'https://justjoin.it/offers/d' }),
    record({ id: 'e', processing: 'candidate', url: 'https://justjoin.it/offers/e' }),
    record({ id: 'f', processing: 'candidate', url: 'https://elsewhere.example/f' }),
    record({ id: 'g', processing: 'fetched' }),
    record({ id: 'h', processing: 'unreadable' }),
    record({ id: 'i', rating: rating(), disposition: 'dismissed' })
  ];

  const result = shortlist(offers);

  assert.deepEqual(result.tally, {
    total: 9,
    shortlisted: 2,
    eligible: 1,
    provisional: 1,
    ruledOut: 1,
    unread: 3,
    unanalysed: 1,
    unreadable: 1,
    decided: 1
  });

  // Only `candidate` rows are attributed to a board: a `fetched` row owes a
  // model call, and filing it under a board would aim the next round at a
  // request it does not have to make.
  assert.deepEqual(result.unreadByBoard, [
    { board: 'Just Join IT', count: 2 },
    { board: 'elsewhere', count: 1 }
  ]);
});

test('a dismissed offer leaves the shortlist without leaving the count', () => {
  const offers = [record({ id: 'a', rating: rating(), disposition: 'dismissed' })];
  const result = shortlist(offers);

  assert.deepEqual(result.offers, []);
  assert.equal(result.tally.total, 1);
  assert.equal(result.tally.decided, 1);
  // Not counted as ruled out: the scorer never ruled on it, a person did.
  assert.equal(result.tally.ruledOut, 0);
});

test('the board name shown is the catalogue name, not the stored domain', () => {
  const view = offerView(
    record({ url: 'https://justjoin.it/offers/x', board: 'justjoin.it', rating: rating() })
  );

  // `unreadByBoard` groups by this same name. One payload calling a board
  // `justjoin.it` in one field and `Just Join IT` in another cannot be filtered.
  assert.equal(view.board, 'Just Join IT');
});

test('an unknown field is empty in the view, never undefined', () => {
  const view = offerView(record({ id: 'bare' }));

  assert.equal(view.position, '');
  assert.equal(view.company, '');
  assert.equal(view.salaryCurrency, '');
  assert.equal(view.salaryMin, null);
  assert.deepEqual(view.skills, []);
  assert.equal(view.eligibility, 'unrated');
  assert.equal(view.fit, null);
  assert.equal(view.ratedAt, null);
});

test('a score written by an older scorer still reads, minus what it cannot', () => {
  const detail = readScoreDetail({
    scorer: '1',
    criteria: [
      { criterion: 'salary', verdict: 'pass', because: 'clears the floor', strength: 'must' },
      // No `strength`: written before the field existed. Still a usable answer,
      // so it defaults rather than disqualifying the criterion.
      { criterion: 'work mode', verdict: 'unknown', because: '' },
      // Unrecognised entries are dropped rather than guessed at.
      { criterion: 'nonsense', verdict: 'maybe', because: '' },
      { verdict: 'pass' },
      'not an object'
    ],
    stated: ['salary', 42, 'company'],
    missing: []
  });

  assert.equal(detail.scorer, '1');
  assert.deepEqual(
    detail.criteria.map((c) => [c.criterion, c.strength, c.verdict]),
    [
      ['salary', 'must', 'pass'],
      ['work mode', 'prefer', 'unknown']
    ]
  );
  assert.deepEqual(detail.stated, ['salary', 'company']);
});

test('an empty detail reads as an empty score rather than throwing', () => {
  assert.deepEqual(readScoreDetail({}), { scorer: '', criteria: [], stated: [], missing: [] });
});

test('unverified claims survive into the view, where an applicant will see them', () => {
  const view = offerView(
    record({
      rating: rating({ detail: { scorer: '2', criteria: [], unverified: ['remote', 'equity'] } })
    })
  );

  assert.deepEqual(view.unverified, ['remote', 'equity']);
});

test('a limit truncates the list and leaves the tally whole', () => {
  const offers = [
    record({ id: 'a', rating: rating({ fit: 0.9 }) }),
    record({ id: 'b', rating: rating({ fit: 0.8 }) }),
    record({ id: 'c', rating: rating({ fit: 0.7 }) })
  ];

  const result = shortlist(offers, { limit: 2 });

  assert.deepEqual(
    result.offers.map((o) => o.id),
    ['a', 'b']
  );
  assert.equal(result.tally.shortlisted, 3);
});
