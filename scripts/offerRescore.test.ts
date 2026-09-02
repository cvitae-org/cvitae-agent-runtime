/**
 * Rescoring: what happens to offers already on file when the ask changes.
 *
 * The behaviour that matters here is all about restraint. A rescore rewrites
 * the numbers and must leave alone the two things it did not compute — the
 * user's disposition, and the extraction's record of what it could not verify.
 * Both are silent failures: an un-dismissed offer looks like a fresh find, and
 * an erased `unverified` list looks like a posting that never overclaimed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { emptyDocument } from '../src/capabilities/cv/document.js';
import { emptyPreferences, preferencesSchema } from '../src/capabilities/offers/preferences.js';
import type { Preferences } from '../src/capabilities/offers/preferences.js';
import { rescoreOffers } from '../src/capabilities/offers/rescore.js';
import { SCORER_VERSION } from '../src/capabilities/offers/criteria.js';
import type { OfferRecord, OfferStore } from '../src/contracts/index.js';
import { scratch } from './support/db.js';

const AT = 1_760_000_000_000;
const cv = emptyDocument();

const wants = (over: Partial<Preferences> = {}): Preferences =>
  preferencesSchema.parse({ ...emptyPreferences(), ...over });

/** Asks for 20 000 PLN a month, and means it. */
const demanding = (): Preferences =>
  wants({
    salary: {
      strength: 'must',
      floor: 20000,
      currency: 'PLN',
      period: 'month',
      basis: 'any'
    }
  });

const seed = (store: OfferStore, over: Partial<OfferRecord> = {}): OfferRecord => {
  const record: OfferRecord = {
    id: 'offer-1',
    url: 'https://justjoin.it/offers/offer-1',
    company: 'Kowalski',
    position: 'Senior Flutter Developer',
    location: 'Kraków',
    workMode: 'hybrid',
    seniority: 'senior',
    contractType: 'b2b',
    salary: '25 000 PLN / mies.',
    salaryReading: { min: 25000, max: 25000, currency: 'PLN', period: 'month' },
    skills: ['Flutter'],
    text: 'Senior Flutter developer, 25 000 PLN monthly, hybrid in Kraków.',
    firstSeenAt: AT,
    lastSeenAt: AT,
    processing: 'rated',
    disposition: 'active',
    ...over
  };
  store.save(record);
  return record;
};

const rate = (store: OfferStore, id: string, over: Record<string, unknown> = {}): void => {
  store.rate(id, {
    eligibility: 'eligible',
    fit: 1,
    completeness: 1,
    ratedAt: AT,
    scorerVersion: SCORER_VERSION,
    cvFingerprint: 'stale-cv',
    prefsFingerprint: 'stale-prefs',
    ...over
  });
};

test('a preferences edit is what makes an existing score stale', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    seed(store);
    rate(store, 'offer-1');

    const first = rescoreOffers({ store, cv, preferences: emptyPreferences() });
    assert.equal(first.rated, 1);
    assert.equal(first.stale, 1);

    // Run it again with nothing changed: the fingerprints now match, so there
    // is no work. This is the whole reason the fingerprints are stored.
    const second = rescoreOffers({ store, cv, preferences: emptyPreferences() });
    assert.equal(second.stale, 0);
    assert.equal(second.rescored, 0);

    // Change the ask, and the same offer is stale again.
    const third = rescoreOffers({ store, cv, preferences: demanding() });
    assert.equal(third.stale, 1);
  } finally {
    s.dispose();
  }
});

test('`all` rescores what the fingerprints say is already current', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    seed(store);
    rate(store, 'offer-1');
    rescoreOffers({ store, cv, preferences: emptyPreferences() });

    const report = rescoreOffers({ store, cv, preferences: emptyPreferences(), all: true });

    assert.equal(report.stale, 1);
    // Nothing moved — `rescored` counts the numbers that actually changed, not
    // the rows that were looked at.
    assert.equal(report.rescored, 0);
  } finally {
    s.dispose();
  }
});

test('an offer that stops clearing the floor says which criterion turned', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    seed(store, { salaryReading: { min: 12000, max: 12000, currency: 'PLN', period: 'month' } });
    rate(store, 'offer-1');
    rescoreOffers({ store, cv, preferences: emptyPreferences() });

    const report = rescoreOffers({ store, cv, preferences: demanding() });

    assert.equal(report.changed.length, 1);
    const change = report.changed[0]!;
    assert.equal(change.id, 'offer-1');
    assert.equal(change.position, 'Senior Flutter Developer');
    assert.equal(change.to, 'ineligible');
    assert.ok(
      change.because.some((line) => line.startsWith('salary:')),
      `expected a salary line, got ${JSON.stringify(change.because)}`
    );
    assert.equal(store.get('offer-1')?.rating?.eligibility, 'ineligible');
  } finally {
    s.dispose();
  }
});

test('a dismissed offer is rescored and stays dismissed', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    seed(store);
    rate(store, 'offer-1');
    store.setDisposition('offer-1', 'dismissed');

    const report = rescoreOffers({ store, cv, preferences: demanding() });

    assert.equal(report.stale, 1);
    const after = store.get('offer-1');
    // The numbers are ours; the decision is the user's.
    assert.equal(after?.disposition, 'dismissed');
    assert.equal(after?.rating?.prefsFingerprint !== 'stale-prefs', true);
  } finally {
    s.dispose();
  }
});

test('an offer never rated is not rescored, because it owes a model call', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    seed(store, { id: 'unrated', processing: 'candidate', text: '' });

    const report = rescoreOffers({ store, cv, preferences: demanding() });

    assert.equal(report.rated, 0);
    assert.equal(report.stale, 0);
    assert.equal(store.get('unrated')?.processing, 'candidate');
  } finally {
    s.dispose();
  }
});

test('what the extraction could not verify survives the rewrite', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    seed(store);
    rate(store, 'offer-1', {
      detail: { scorer: '1', criteria: [], unverified: ['fully remote', 'stock options'] }
    });

    rescoreOffers({ store, cv, preferences: demanding() });

    // A fact about a model call that happened once. Re-deriving it here without
    // the model would either invent it or erase the audit trail.
    assert.deepEqual(store.get('offer-1')?.rating?.detail?.unverified, [
      'fully remote',
      'stock options'
    ]);
  } finally {
    s.dispose();
  }
});

test('a bumped scorer version makes every score stale on its own', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    seed(store);
    rate(store, 'offer-1');
    rescoreOffers({ store, cv, preferences: emptyPreferences() });

    const current = store.get('offer-1')!.rating!;
    // Same CV, same preferences, older rules.
    store.rate('offer-1', { ...current, scorerVersion: 'older' });

    const report = rescoreOffers({ store, cv, preferences: emptyPreferences() });
    assert.equal(report.stale, 1);
    assert.equal(store.get('offer-1')?.rating?.scorerVersion, SCORER_VERSION);
  } finally {
    s.dispose();
  }
});

test('a store larger than one page is walked to the end, once each', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    // 250 rows against a page size of 200: the second read must return the
    // remainder rather than the same first page, and the loop must stop.
    for (let n = 0; n < 250; n++) {
      seed(store, { id: `offer-${n}`, url: `https://justjoin.it/offers/${n}` });
      rate(store, `offer-${n}`, { ratedAt: AT + n });
    }

    const report = rescoreOffers({ store, cv, preferences: demanding() });

    assert.equal(report.rated, 250);
    assert.equal(report.stale, 250);
    assert.equal(rescoreOffers({ store, cv, preferences: demanding() }).stale, 0);
  } finally {
    s.dispose();
  }
});

test('an abort stops the pass rather than finishing it quietly', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    seed(store);
    rate(store, 'offer-1');

    const controller = new AbortController();
    controller.abort();

    assert.throws(
      () =>
        rescoreOffers({
          store,
          cv,
          preferences: demanding(),
          signal: controller.signal
        }),
      /abort/i
    );
    assert.equal(store.get('offer-1')?.rating?.prefsFingerprint, 'stale-prefs');
  } finally {
    s.dispose();
  }
});
