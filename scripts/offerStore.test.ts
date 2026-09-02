/**
 * The offer store, and the migration that widened it.
 *
 * Both were until now completely uncovered: `OfferStore` is constructed in
 * `runtime/create.ts` and no capability had yet written through it, so every
 * claim the SQL made was unchecked. The interesting behaviour is all in what
 * `sight` refuses to overwrite, which is precisely the behaviour that fails
 * silently — a lost `first_seen_at` or an un-dismissed offer reads as a
 * successful write.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import type { OfferRecord, OfferSighting } from '../src/contracts/index.js';
import { scratch } from './support/db.js';

const AT = 1_760_000_000_000;

const record = (over: Partial<OfferRecord> = {}): OfferRecord => ({
  id: 'offer-1',
  url: 'https://boards.example/offer-1',
  company: 'Kowalski Sp. z o.o.',
  position: 'Senior Flutter Developer',
  text: 'We are hiring a senior Flutter developer.',
  firstSeenAt: AT,
  lastSeenAt: AT,
  processing: 'fetched',
  disposition: 'active',
  ...over
});

test('a saved offer comes back with every field it went in with', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const written = record({
      finalUrl: 'https://boards.example/offer-1?utm=x',
      board: 'justjoin',
      location: 'Kraków',
      workMode: 'hybrid',
      seniority: 'senior',
      contractType: 'b2b',
      salary: '20 000 - 25 000 PLN / mies.',
      salaryReading: { min: 20000, max: 25000, currency: 'PLN', period: 'month' },
      skills: ['Flutter', 'Dart'],
      stated: { company: 'Kowalski Sp. z o.o.', salary: '20 000 - 25 000 PLN' },
      analysis: { role: 'Flutter developer' }
    });
    store.save(written);

    // Spread both sides: the reader returns `runId: undefined` where the input
    // simply had no such key, and `deepEqual` counts that as a difference. The
    // claim under test is about values, not about which keys were typed out.
    assert.deepEqual({ ...store.get('offer-1') }, { ...written, runId: undefined, rating: undefined });
  } finally {
    s.dispose();
  }
});

/**
 * A salary with no period is the dangerous reading, not the missing one: `20000`
 * is a fine monthly wage and an absurd yearly one. The store must be able to
 * say "nothing was parsed" without saying "zero".
 */
test('an unparsed salary is absent rather than a row of nulls', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    store.save(record());
    assert.equal(store.get('offer-1')?.salaryReading, undefined);

    store.save(record({ salaryReading: { min: null, max: null, currency: '', period: '' } }));
    assert.deepEqual(store.get('offer-1')?.salaryReading, {
      min: null,
      max: null,
      currency: '',
      period: ''
    });
  } finally {
    s.dispose();
  }
});

test('sighting an offer twice keeps the first sighting and moves the last', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const seen: OfferSighting = { id: 'offer-1', url: 'https://b.example/1', text: 'body' };

    assert.deepEqual(store.sight([seen], AT), [{ id: 'offer-1', isNew: true }]);
    assert.deepEqual(store.sight([seen], AT + 86_400_000), [
      { id: 'offer-1', isNew: false }
    ]);

    const stored = store.get('offer-1');
    assert.equal(stored?.firstSeenAt, AT, 'first seen was overwritten');
    assert.equal(stored?.lastSeenAt, AT + 86_400_000, 'last seen did not move');
  } finally {
    s.dispose();
  }
});

/**
 * The failure this prevents is not hypothetical. A standing search re-sights
 * every offer it finds, every morning. If a sighting could write `disposition`,
 * everything the user had said no to would come back, and the feature that
 * makes a standing search bearable to live with would silently not work.
 */
test('a re-sighting never un-dismisses what a person dismissed', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    store.sight([{ id: 'offer-1', text: 'body' }], AT);
    store.setDisposition('offer-1', 'dismissed');

    store.sight([{ id: 'offer-1', text: 'body' }], AT + 1000);

    assert.equal(store.get('offer-1')?.disposition, 'dismissed');
  } finally {
    s.dispose();
  }
});

/**
 * A board search yields a title and a URL and no body. Letting that overwrite a
 * posting already fetched in full would destroy the only copy of the text —
 * and the row would still look perfectly healthy afterwards.
 */
test('a thin sighting does not overwrite a posting already read in full', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const full = 'The full posting, several paragraphs of it, fetched from the board.';

    store.sight([{ id: 'offer-1', text: full, company: 'Kowalski' }], AT);
    store.sight([{ id: 'offer-1', text: '', position: 'Senior Flutter Developer' }], AT + 1);

    const stored = store.get('offer-1');
    assert.equal(stored?.text, full, 'the body was clobbered by a search result');
    assert.equal(stored?.company, 'Kowalski', 'a fact absent from the sighting was dropped');
    assert.equal(stored?.position, 'Senior Flutter Developer', 'a new fact was not merged');
  } finally {
    s.dispose();
  }
});

test('rating an offer marks it rated and is readable back whole', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    store.sight([{ id: 'offer-1', text: 'body' }], AT);

    const rating = {
      eligibility: 'provisional' as const,
      fit: 0.75,
      completeness: 0.4,
      detail: { salary: 'unknown' },
      ratedAt: AT + 5,
      scorerVersion: '3',
      cvFingerprint: 'cv-a',
      prefsFingerprint: 'prefs-a'
    };
    store.rate('offer-1', rating);

    const stored = store.get('offer-1');
    assert.deepEqual(stored?.rating, rating);
    assert.equal(stored?.processing, 'rated');
  } finally {
    s.dispose();
  }
});

/** An unreadable source stays unreadable. Scoring it does not mean it was read. */
test('rating does not promote a source that could not be read', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    store.sight([{ id: 'offer-1', text: '', processing: 'unreadable' }], AT);
    store.rate('offer-1', {
      eligibility: 'unrated',
      fit: null,
      completeness: null,
      ratedAt: AT,
      scorerVersion: '3',
      cvFingerprint: 'cv-a',
      prefsFingerprint: 'prefs-a'
    });
    assert.equal(store.get('offer-1')?.processing, 'unreadable');
  } finally {
    s.dispose();
  }
});

/**
 * The defect this pins would have cost a fetch and a model call per offer per
 * night, forever, and every symptom of it looks like the system working: the
 * rows are all there, the counts are right, and the store just keeps paying to
 * learn what it already knew.
 *
 * `processing` is NOT NULL with a default of `'candidate'`, so a sighting that
 * says nothing about the state still arrives at `excluded.processing` as the
 * literal `'candidate'`. Updating the column from `excluded` therefore demotes
 * every rated offer a standing search re-saw.
 */
test('re-seeing an offer does not forget that it was already read', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    store.sight([{ id: 'offer-1', url: 'https://boards.example/1', text: 'the full posting' }], AT);
    store.sight(
      [{ id: 'offer-1', url: 'https://boards.example/1', text: 'the full posting', processing: 'rated' }],
      AT
    );

    // A later round sees the same URL on a board listing: an id, a URL, no body
    // and nothing to say about state.
    store.sight([{ id: 'offer-1', url: 'https://boards.example/1' }], AT + 1000);

    assert.equal(store.get('offer-1')?.processing, 'rated');
    assert.equal(store.get('offer-1')?.text, 'the full posting');

    // A sighting that *does* state a processing state still wins.
    store.sight([{ id: 'offer-1', processing: 'unreadable' }], AT + 2000);
    assert.equal(store.get('offer-1')?.processing, 'unreadable');
  } finally {
    s.dispose();
  }
});

/**
 * Three things at once, because they are the three ways this query was wrong
 * before it was a query: a dismissed offer is still rescored (only the decision
 * is the user's, the numbers are ours), an unrated offer is not (it needs a
 * fetch and a model, which is a round's work), and a bumped scorer version
 * makes every score stale on its own.
 *
 * The NULL handling is the reason it is `IS NOT` and not `<>`: an unrated row
 * has NULL in all three columns, and `NULL <> 'cv-a'` is NULL rather than true.
 * With `<>` the never-rated rows vanish — which here is the wanted answer, but
 * only by accident, and the same accident hides a row scored by a scorer that
 * wrote no version.
 */
test('a stale score is one whose inputs moved, dismissed or not', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    store.sight(
      [
        { id: 'never-rated', text: 'a' },
        { id: 'stale-cv', text: 'b' },
        { id: 'current', text: 'c' },
        { id: 'dismissed', text: 'd' },
        { id: 'stale-scorer', text: 'e' }
      ],
      AT
    );

    const base = { fit: 1, completeness: 1, eligibility: 'eligible' } as const;
    store.rate('stale-cv', {
      ...base,
      ratedAt: AT,
      scorerVersion: '3',
      cvFingerprint: 'cv-OLD',
      prefsFingerprint: 'prefs-a'
    });
    store.rate('current', {
      ...base,
      ratedAt: AT + 1,
      scorerVersion: '3',
      cvFingerprint: 'cv-a',
      prefsFingerprint: 'prefs-a'
    });
    store.rate('dismissed', {
      ...base,
      ratedAt: AT + 2,
      scorerVersion: '3',
      cvFingerprint: 'cv-OLD',
      prefsFingerprint: 'prefs-a'
    });
    store.rate('stale-scorer', {
      ...base,
      ratedAt: AT + 3,
      scorerVersion: '2',
      cvFingerprint: 'cv-a',
      prefsFingerprint: 'prefs-a'
    });
    store.setDisposition('dismissed', 'dismissed');

    const inputs = { scorerVersion: '3', cvFingerprint: 'cv-a', prefsFingerprint: 'prefs-a' };

    // Oldest score first, so a capped pass makes progress on the worst of it.
    assert.deepEqual(
      store.staleRatings(10, inputs).map((o) => o.id),
      ['stale-cv', 'dismissed', 'stale-scorer']
    );

    // No inputs: every rated offer, which is the pass to run when the rules
    // changed in a way the scorer version did not capture.
    assert.deepEqual(
      store.staleRatings(10).map((o) => o.id),
      ['stale-cv', 'current', 'dismissed', 'stale-scorer']
    );

    assert.equal(store.countRated(), 4);
  } finally {
    s.dispose();
  }
});

test('the same job posted twice is found by company and position', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    store.save(record({ id: 'a', url: 'https://one.example/x' }));
    store.save(
      record({
        id: 'b',
        url: 'https://two.example/y',
        company: 'KOWALSKI SP. Z O.O.',
        position: 'Senior Flutter Developer'
      })
    );
    store.save(
      record({ id: 'c', url: 'https://three.example/z', company: 'Nowak', position: 'Cook' })
    );

    const found = store.byIdentity('Kowalski Sp. z o.o.', 'Senior Flutter Developer');
    assert.deepEqual(found.map((o) => o.id).sort(), ['a', 'b']);
  } finally {
    s.dispose();
  }
});

/**
 * A blank half must match nothing rather than everything. The failure mode is
 * a deduplicator that collapses an entire board into a single row because one
 * posting omitted its company name.
 */
test('an identity missing half of itself matches nothing', () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    store.save(record());
    assert.deepEqual(store.byIdentity('', 'Senior Flutter Developer'), []);
    assert.deepEqual(store.byIdentity('Kowalski Sp. z o.o.', ''), []);
  } finally {
    s.dispose();
  }
});

/**
 * 0003 renames a column and backfills from it. Both are no-ops on an empty
 * table, which is what a fresh-file test would exercise — so this builds the
 * old schema, puts a row in it, and only then applies the migration.
 */
test('the widening keeps the rows it found and dates them from what it knew', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-offers-'));
  const db = open(join(dir, 'harness.db'));

  try {
    const before = migrations.filter((m) => m.version <= 2);
    migrate(db, before);

    db.prepare(
      `INSERT INTO offers (id, url, company, position, text, search_text, imported_at)
       VALUES ('old', 'https://b.example/old', 'Kowalski', 'Developer', 'body', 'body', ?)`
    ).run(AT);

    assert.equal(migrate(db), 3);

    const store = createOfferStore(db);
    const row = store.get('old');

    assert.equal(row?.text, 'body', 'the row did not survive the widening');
    assert.equal(row?.firstSeenAt, AT);
    assert.equal(row?.lastSeenAt, AT, 'last seen was stamped with the clock, not the row');
    assert.equal(row?.processing, 'candidate');
    assert.equal(row?.disposition, 'active');
    assert.equal(row?.rating, undefined, 'a row that was never scored claims a score');

    // The old index name went with the old column name.
    const indexes = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    assert.ok(!indexes.includes('offers_imported'));
    assert.ok(indexes.includes('offers_first_seen'));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
