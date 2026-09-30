import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createDiscoverySearchStore } from '../src/storage/sqlite/discovery-searches.js';
import { createHarness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';

const manifest = (id = 'search-a', rowCount = 2) => ({ id, importKey: 'legacy-1', phrase: 'react', boards: ['vacancies'],
  filters: { minimum: 20000, maximum: 25000, includeUnknown: true }, selectedId: 'a', rowCount });
const item = (id: string, position = 'React Engineer') => ({ offer: { id, position, url: `https://vacancies.example/job-offer/${id}`,
  text: 'Public description', board: 'vacancies', salary: '20000 PLN/month',
  analysis: { company_type: 'Fintech', candidate_match: 'SECRET PROFILE' }, rating: { detail: 'SECRET PROFILE' },
  firstSeenAt: 100, lastSeenAt: 200 }, note: { text: 'PRIVATE NOTE' },
  enrichment: { analyzedAt: 123, runId: 'private-run', provenance: { salary: { source: 'ai', at: 123, runId: 'private-run' } } } });
const setup = () => {
  const db = open(':memory:'); migrate(db);
  const offers = createOfferStore(db);
  return { db, offers, searches: createDiscoverySearchStore(db, offers, () => 500) };
};
const identity = (id = 'search-a') => ({ id, importKey: 'legacy-1' });

test('migration 19 preserves existing conversations, messages, catalogue and notes', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((m) => m.version <= 18));
    const offers = createOfferStore(db);
    offers.sight([{ id: 'a', text: 'New canonical text' }], 1);
    db.prepare("INSERT INTO offer_notes VALUES ('a', 'private', 1, 1)").run();
    db.prepare("INSERT INTO conversations(id, subject_kind, subject_id, created_at, updated_at) VALUES ('c', 'profile', '', 1, 1)").run();
    db.prepare("INSERT INTO messages(conversation_id, seq, id, role, text, created_at) VALUES ('c', 1, 'm', 'user', 'Profile question', 1)").run();
    migrate(db);
    assert.equal((db.prepare('SELECT text FROM messages').get() as { text: string }).text, 'Profile question');
    assert.equal(offers.get('a')?.text, 'New canonical text');
    assert.equal((db.prepare('SELECT text FROM offer_notes').get() as { text: string }).text, 'private');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); }
});

test('migration 26 backfills request ledgers and preserves legacy detail jobs', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((step) => step.version <= 25));
    const offers = createOfferStore(db);
    offers.sight([{ id: 'legacy-offer', text: '' }], 1);
    db.prepare(`INSERT INTO discovery_searches(id,import_key,manifest,status,row_count,revision,created_at,updated_at)
      VALUES(?, ?, ?, 'ready', 0, 1, 1, 1)`).run('legacy-search','native',JSON.stringify(manifest('legacy-search',0)));
    db.prepare("INSERT INTO discovery_detail_queue(offer_id,status,revision) VALUES('legacy-offer','queued',1)").run();
    migrate(db);
    const searches = createDiscoverySearchStore(db, offers);
    assert.deepEqual(searches.requestUsage('legacy-search'), { search: 0, details: 0, total: 0, limit: 500, remaining: 500, exhausted: false });
    assert.deepEqual(db.prepare('SELECT search_id,stop_reason FROM discovery_detail_queue WHERE offer_id=?').get('legacy-offer'), { search_id: null, stop_reason: null });
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); }
});

test('staged imports require contiguous batches and complete evidence before becoming visible', () => {
  const { db, searches } = setup();
  try {
    assert.equal(searches.begin(manifest()).nextOffset, 0);
    assert.equal(searches.list().items.length, 0);
    assert.throws(() => searches.read({ id: 'search-a' }), { code: 'search_importing' });
    assert.throws(() => searches.finish(identity()), { code: 'search_conflict' });
    assert.throws(() => searches.append({ ...identity(), offset: 1, items: [item('b')] }), { code: 'search_conflict' });
    searches.append({ ...identity(), offset: 0, items: [item('a'), item('b')] });
    assert.equal(searches.finish(identity()).revision, 1);
    assert.equal(searches.finish(identity()).revision, 1);
    const first = searches.read({ id: 'search-a', limit: 1 });
    assert.equal(first.count, 2); assert.equal(first.nextOffset, 1); assert.equal(first.pageRevision, '1:0');
    assert.equal(first.items[0]?.offer.id, 'a');
    assert.equal(first.search.filters.minimum, 20000); assert.equal(first.search.selectedId, 'a');
    assert.equal(searches.read({ id: 'search-a', offset: 1, pageRevision: first.pageRevision }).items[0]?.offer.id, 'b');
    assert.equal(searches.list().items.length, 1);
  } finally { db.close(); }
});

test('continuation pages require the pinned revision and stale pages require an explicit refresh', () => {
  const { db, offers, searches } = setup();
  try {
    searches.begin(manifest('search-a', 2));
    searches.append({ ...identity(), offset: 0, items: [item('a'), item('b')] }); searches.finish(identity());
    const first = searches.read({ id: 'search-a', limit: 1 });
    assert.equal(first.pageRevision, '1:0');
    assert.throws(() => searches.read({ id: 'search-a', offset: 1 }), /page revision/i);

    offers.sight([item('new').offer], 500);
    searches.add('search-a', [{ offer: offers.get('new')! }]);
    db.prepare("UPDATE discovery_search_members SET ordinal=-1 WHERE search_id='search-a' AND offer_id='new'").run();
    assert.throws(
      () => searches.read({ id: 'search-a', offset: 1, pageRevision: first.pageRevision }),
      { code: 'search_results_changed' }
    );
    const refreshed = searches.read({ id: 'search-a', limit: 1 });
    assert.equal(refreshed.pageRevision, '2:0');
    assert.equal(refreshed.items[0]?.offer.id, 'new');
  } finally { db.close(); }
});

test('lost responses replay idempotently but changed manifests, keys and batches are refused', () => {
  const { db, searches } = setup();
  try {
    searches.begin(manifest());
    const batch = { ...identity(), offset: 0, items: [item('a')] };
    searches.append(batch);
    assert.equal(searches.begin(manifest()).nextOffset, 1);
    assert.equal(searches.append(batch).nextOffset, 1);
    assert.throws(() => searches.begin({ ...manifest(), phrase: 'java' }), { code: 'search_conflict' });
    assert.throws(() => searches.append({ ...batch, importKey: 'other' }), { code: 'search_conflict' });
    assert.throws(() => searches.append({ ...batch, items: [item('b')] }), { code: 'search_conflict' });
    searches.append({ ...identity(), offset: 1, items: [item('b')] }); searches.finish(identity());
    assert.equal(searches.append(batch).status, 'ready');
    assert.equal(searches.read({ id: 'search-a' }).count, 2);
  } finally { db.close(); }
});

test('historical evidence survives enrichment; private notes, ratings and profile fields are excluded', () => {
  const { db, offers, searches } = setup();
  try {
    offers.sight([{ id: 'a', text: 'Canonical newer text', position: 'Newer title' }], 999);
    offers.setDisposition('a', 'applied');
    db.prepare("INSERT INTO offer_notes VALUES ('a', 'private', 3, 1)").run();
    const before = offers.get('a');
    searches.begin(manifest('search-a', 1));
    searches.append({ ...identity(), offset: 0, items: [item('a', 'Historical title')] });
    searches.finish(identity());
    assert.deepEqual(offers.get('a'), before);
    const page = searches.read({ id: 'search-a' });
    assert.equal(page.items[0]?.offer.position, 'Historical title');
    assert.deepEqual(page.items[0]?.enrichment?.provenance, { salary: { source: 'ai', at: 123 } });
    assert.ok(!JSON.stringify(page).includes('SECRET')); assert.ok(!JSON.stringify(page).includes('PRIVATE'));
    assert.ok(!JSON.stringify(page).includes('private-run'));
    assert.equal((db.prepare('SELECT revision FROM offer_notes').get() as { revision: number }).revision, 3);
    offers.sight([{ id: 'a', text: 'Even newer' }], 1000);
    assert.equal(searches.read({ id: 'search-a' }).items[0]?.offer.text, 'Public description');
  } finally { db.close(); }
});

test('membership deduplicates in first-seen order and searches never mix evidence', () => {
  const { db, searches } = setup();
  try {
    searches.begin(manifest('search-a', 3));
    searches.append({ ...identity(), offset: 0, items: [item('a'), item('a', 'Duplicate'), item('b')] });
    searches.finish(identity());
    searches.begin(manifest('search-b', 1));
    searches.append({ ...identity('search-b'), offset: 0, items: [item('c')] }); searches.finish(identity('search-b'));
    assert.deepEqual(searches.read({ id: 'search-a' }).items.map((i) => i.offer.id), ['a', 'b']);
    assert.deepEqual(searches.read({ id: 'search-b' }).items.map((i) => i.offer.id), ['c']);
    assert.equal(searches.read({ id: 'search-a' }).items[0]?.offer.position, 'React Engineer');
    assert.equal((db.prepare('SELECT count(*) AS n FROM discovery_offer_evidence').get() as { n: number }).n, 3);
  } finally { db.close(); }
});

test('failure rolls back offers, evidence, memberships and receipt together', () => {
  const { db, offers, searches } = setup();
  try {
    searches.begin(manifest());
    db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON discovery_search_members WHEN NEW.offer_id='b' BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
    assert.throws(() => searches.append({ ...identity(), offset: 0, items: [item('a'), item('b')] }));
    assert.equal(searches.begin(manifest()).nextOffset, 0);
    assert.equal(offers.recent(10).length, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM discovery_offer_evidence').get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('delete cascades memberships and blocks late imports while retaining catalogue and notes', () => {
  const { db, searches, offers } = setup();
  try {
    searches.begin(manifest('search-a', 1));
    searches.append({ ...identity(), offset: 0, items: [item('a')] }); searches.finish(identity());
    db.prepare("INSERT INTO offer_notes VALUES ('a', 'private', 1, 1)").run();
    assert.equal(searches.delete('search-a'), true); assert.equal(searches.delete('search-a'), false);
    assert.throws(() => searches.begin(manifest('search-a', 1)), { code: 'search_deleted' });
    assert.throws(() => searches.append({ ...identity(), offset: 0, items: [item('a')] }), { code: 'search_not_found' });
    assert.ok(offers.get('a')); assert.equal((db.prepare('SELECT text FROM offer_notes').get() as { text: string }).text, 'private');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal((db.prepare('SELECT count(*) AS n FROM discovery_offer_evidence').get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('empty completed search is distinct from an incomplete import', () => {
  const { db, searches } = setup();
  try {
    searches.begin(manifest('empty', 0)); searches.finish(identity('empty'));
    assert.equal(searches.read({ id: 'empty' }).count, 0);
    assert.equal(searches.read({ id: 'empty' }).nextOffset, null);
  } finally { db.close(); }
});

test('IPC import resumes after restart and rejects malformed and oversized requests', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'discovery-searches-'));
  const databasePath = join(directory, 'runtime.db');
  let harness = createHarness({ databasePath, env: {}, scraperUrl: '' });
  try {
    let dispatch = createDispatch(harness);
    assert.equal((await dispatch('discovery.searches.import.begin', manifest())).ok, true);
    assert.equal((await dispatch('discovery.searches.import.append', { ...identity(), offset: 0, items: [item('a')] })).ok, true);
    harness.close(); harness = createHarness({ databasePath, env: {}, scraperUrl: '' }); dispatch = createDispatch(harness);
    const resumed = await dispatch('discovery.searches.import.begin', manifest());
    assert.equal(resumed.ok, true); if (resumed.ok) assert.equal((resumed.data as { nextOffset: number }).nextOffset, 1);
    assert.equal((await dispatch('discovery.searches.import.append', { ...identity(), offset: 1, items: [item('b')] })).ok, true);
    assert.equal((await dispatch('discovery.searches.import.finish', identity())).ok, true);
    for (const input of [{ ...manifest(), rowCount: -1 }, { ...manifest(), boards: ['invalid'] }, { ...manifest(), filters: { minimum: 3, maximum: 2 } }]) {
      assert.equal((await dispatch('discovery.searches.import.begin', input)).ok, false);
    }
    assert.equal((await dispatch('discovery.searches.import.append', { ...identity(), offset: 0, items: Array.from({ length: 51 }, () => item('a')) })).ok, false);
    assert.equal((await dispatch('discovery.searches.read', { id: 'search-a', limit: 101 })).ok, false);
    const multibyte = { offer: { id: 'big', text: '字'.repeat(300000) } };
    assert.equal((await dispatch('discovery.searches.import.append', { ...identity(), offset: 0, items: [multibyte, multibyte] })).ok, false);
    harness.close(); harness = createHarness({ databasePath, env: {}, scraperUrl: '' });
    const restored = await createDispatch(harness)('discovery.searches.read', { id: 'search-a' });
    assert.equal(restored.ok, true); if (restored.ok) assert.equal((restored.data as { count: number }).count, 2);
  } finally { harness.close(); rmSync(directory, { recursive: true, force: true }); }
});
