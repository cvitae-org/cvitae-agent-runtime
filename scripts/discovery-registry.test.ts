import { createDiscoveryService } from '../src/runtime/discovery.js';
import { createDiscoverySearchStore } from '../src/storage/sqlite/discovery-searches.js';
import { defaultDiscoveryBudget } from '../src/contracts/discovery.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createDiscoveryCatalogue } from '../src/storage/sqlite/discovery.js';
import { withDiscoveryMetadata } from '../src/storage/sqlite/discovery-registry.js';
import type { DiscoveryBoard, DiscoveryBatch } from '../src/contracts/discovery.js';
import { discoveryEvidenceSchema } from '../src/contracts/discovery-search.js';
import { projectOffer } from '../src/storage/sqlite/offer-query-projection.js';

const filter = { support: 'native', stage: 'source', detail: 'Fixture search' } as const;
const board: DiscoveryBoard = { id: 'fixture_jobs', label: 'Fixture Jobs', enabled: true,
 searchMode: 'board', pagination: 'snapshot', coverage: 'first-page', detail: true,
 filters: { keyword: filter, matchMode: filter, activity: filter, maxPublishedAgeDays: filter, workMode: filter }, limitations: [] };
const batch = (url = 'https://jobs.example/one'): DiscoveryBatch => ({
 version: 1, board: board.id, items: [{ board: board.id, url, title: 'React Developer',
 titleSource: 'board', external_id: 'external-1', company: 'Example', description: 'Full published React description',
 work_mode: 'remote', adapter_id: 'fixture', adapter_version: '1', apply_url: 'https://employer.example/apply' }],
 nextCursor: null, hasMore: false, coverage: 'first-page', retrievedAt: '2026-09-21T10:00:00Z',
 expiresAt: '2026-09-21T11:00:00Z', effectiveFilters: [], unsupportedFilters: [], limitations: [] });

test('new-board metadata survives unavailable or removed adapters without authorizing collection', async () => {
 const db = open(':memory:'); migrate(db);
 try {
  let available = true;
  const source = withDiscoveryMetadata(db, { boards: async () => {
    if (!available) throw new Error('offline'); return { version: 1, boards: [board] };
  }, search: async () => ({ status: 'unsupported', detail: 'disabled' }) });
  await source.boards(new AbortController().signal); available = false;
  const saved = (await source.boards(new AbortController().signal)).boards[0]!;
  assert.equal(saved.label, board.label); assert.equal(saved.enabled, false);
  const removed = withDiscoveryMetadata(db, { boards: async () => ({ version: 1, boards: [] }), search: source.search });
  assert.equal((await removed.boards(new AbortController().signal)).boards[0]?.enabled, false);
 } finally { db.close(); }
});

test('migration and fourth-board refresh preserve IDs, details, disposition and SQL evidence', () => {
 const db = open(':memory:'); migrate(db, migrations.filter(m => m.version <= 31));
 const offers = createOfferStore(db);
 offers.save({ id: 'legacy', url: 'https://jobs.example/old', board: board.id, text: 'old', firstSeenAt: 1, lastSeenAt: 1, processing: 'rated', disposition: 'applied' });
 migrate(db);
 try {
  db.prepare('INSERT INTO offer_notes VALUES(?,?,?,?)').run('legacy', 'My application note', 1, 1);
  const catalogue = createDiscoveryCatalogue(db, offers);
  const first = catalogue.ingest(batch('https://jobs.example/old'), 2)[0]!;
  assert.equal(first.offer.id, 'legacy');
  const next = catalogue.ingest({ ...batch('https://jobs.example/new'), retrievedAt: '2026-09-21T12:00:00Z' }, 3)[0]!;
  assert.equal(next.offer.id, 'legacy'); assert.equal(next.offer.disposition, 'applied');
  assert.equal(next.note?.text, 'My application note');
  assert.equal(next.offer.processing, 'rated'); assert.equal(next.offer.firstSeenAt, 1);
  assert.equal(next.offer.text, 'Full published React description');
  assert.equal(next.enrichment?.extractorVersion, 'listing:fixture:1');
  assert.equal(next.enrichment?.details?.status, 'succeeded');
  assert.equal(next.enrichment?.status, 'idle');
  assert.equal(next.offer.stated?.work_mode, 'remote');
  const evidence = discoveryEvidenceSchema.parse(next);
  const projected = projectOffer('evidence', evidence);
  assert.ok(JSON.stringify(projected).includes('Full published React description'));
  const oldUrl = batch('https://jobs.example/old'); delete oldUrl.items[0]!.external_id;
  assert.equal(catalogue.ingest(oldUrl, 4)[0]?.offer.id, 'legacy');
  const sparse = batch('https://jobs.example/new'); delete sparse.items[0]!.description;
  catalogue.ingest({ ...sparse, retrievedAt: '2026-09-21T14:00:00Z' }, 5);
  assert.equal(offers.get('legacy')?.text, 'Full published React description');
  db.prepare('INSERT INTO discovery_blacklist VALUES(?,?)').run('legacy', 6);
  assert.deepEqual(catalogue.ingest(batch('https://jobs.example/another-url'), 7), []);
 } finally { db.close(); }
});

test('two boards sharing an application URL retain distinct listing identities', () => {
 const db = open(':memory:'); migrate(db);
 try {
  const catalogue = createDiscoveryCatalogue(db, createOfferStore(db));
  const first = catalogue.ingest(batch(), 1)[0]!;
  const secondBatch = batch('https://other.example/listing'); secondBatch.board = 'other_jobs'; secondBatch.items[0]!.board = 'other_jobs';
  const second = catalogue.ingest(secondBatch, 2)[0]!;
  assert.notEqual(first.offer.id, second.offer.id);
 } finally { db.close(); }
});


test('worker reservation shares the search/detail budget and refunds unused upstream requests', async () => {
 const db = open(':memory:'); migrate(db);
 const offers = createOfferStore(db), saved = createDiscoverySearchStore(db, offers);
 let allowance = 0;
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 const service = createDiscoveryService(createDiscoveryCatalogue(db, offers), {
   requestCost: () => 10,
   boards: async () => ({ version: 1, boards: [board] }),
   search: async query => {
     allowance = query.requestLimit!;
     await gate;
     return { status: 'ok', data: { ...batch(), requestCount: 2 } };
   }
 }, Date.now, saved);
 try {
   service.start({ keyword: 'React', boards: [board.id], pageSize: 30, searchId: 'budget-test',
     budget: { ...defaultDiscoveryBudget, maxRequestsTotal: 5 } });
   assert.equal(allowance, 5);
   assert.equal(saved.requestUsage('budget-test').total, 5);
   assert.equal(saved.reserveRequest('budget-test', 'detail'), false);
   release();
   await new Promise<void>(resolve => setImmediate(resolve));
   assert.equal(saved.requestUsage('budget-test').total, 2);
   assert.equal(saved.reserveRequest('budget-test', 'detail'), true);
 } finally { release(); service.close(); db.close(); }
});


test('waiting sources do not cancel a worker holding the remaining reservation', async () => {
 const db = open(':memory:'); migrate(db);
 const offers = createOfferStore(db), saved = createDiscoverySearchStore(db, offers);
 const allowances: number[] = [];
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 const service = createDiscoveryService(createDiscoveryCatalogue(db, offers), {
  requestCost: () => 10,
  boards: async () => ({ version: 1, boards: [board] }),
  search: async (query, signal) => {
   allowances.push(query.requestLimit!);
   if (allowances.length === 1) await gate;
   assert.equal(signal.aborted, false);
   const data = batch(`https://jobs.example/${query.board}`);
   data.board = query.board; data.items[0]!.board = query.board;
   return { status: 'ok', data: { ...data, requestCount: 2 } };
  }
 }, Date.now, saved);
 try {
  service.start({ keyword: 'React', boards: [board.id, 'second_jobs'], pageSize: 30, searchId: 'shared-budget',
   budget: { ...defaultDiscoveryBudget, maxRequestsTotal: 5 } });
  assert.deepEqual(allowances, [5]);
  release();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(allowances, [5, 3]);
  assert.equal(saved.requestUsage('shared-budget').total, 4);
 } finally { release(); service.close(); db.close(); }
});


test('a capped source snapshot remains bounded after the final local page', async () => {
 const db = open(':memory:'); migrate(db);
 const service = createDiscoveryService(createDiscoveryCatalogue(db, createOfferStore(db)), {
  boards: async () => ({ version: 1, boards: [board] }),
  search: async () => ({ status: 'ok', data: { ...batch(), sourceExhausted: false } })
 });
 try {
  const run = service.start({ keyword: 'React', boards: [board.id], pageSize: 30 });
  await new Promise<void>(resolve => setImmediate(resolve));
  const state = service.poll(run.id, 0).boards[0]!;
  assert.equal(state.status, 'exhausted'); assert.equal(state.completion, 'bounded');
  assert.equal(state.stopReason, 'page_budget');
 } finally { service.close(); db.close(); }
});
