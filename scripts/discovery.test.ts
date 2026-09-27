import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createDiscoveryCatalogue } from '../src/storage/sqlite/discovery.js';
import { createDiscoverySearchStore } from '../src/storage/sqlite/discovery-searches.js';
import { createDiscoveryService } from '../src/runtime/discovery.js';
import { createDiscoverySource } from '../src/effects/discovery.js';
import { createHarness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { CatalogueItem, DiscoveryBatch, DiscoveryBoardId, DiscoveryListing, DiscoverySource } from '../src/contracts/discovery.js';

const row = (slug: string, title = 'React Developer', board: DiscoveryBoardId = 'justjoin'): DiscoveryListing => ({
  board, url: `https://${board === 'justjoin' ? 'justjoin.it' : 'nofluffjobs.com'}/job-offer/${slug}`,
  title, titleSource: 'board', external_id: slug, company: 'Example', required_skills: ['React']
});
const batch = (items: DiscoveryListing[], nextCursor: string | null = null): DiscoveryBatch => ({
  version: 1, board: items[0]?.board ?? 'justjoin', items, nextCursor, hasMore: !!nextCursor,
  coverage: 'sitemap', retrievedAt: '2026-09-11T12:00:00.000Z', expiresAt: '2026-09-11T12:30:00.000Z',
  effectiveFilters: [{ id:'keyword' as const, support:'local' as const, stage:'source' as const, requested:'react', applied:true, detail:'Slug match.' }], unsupportedFilters: [], limitations: []
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const searchQuery = { keyword: 'react', boards: ['justjoin'] as DiscoveryBoardId[], limit: 30, offset: 0 };
const setup = () => {
  const db = open(':memory:'); migrate(db);
  const offers = createOfferStore(db);
  return { db, offers, catalogue: createDiscoveryCatalogue(db, offers) };
};
const source = (search: DiscoverySource['search']): DiscoverySource => ({ boards: async () => ({ version: 1, boards: [] }), search });
const savedSearches = () => {
  const searches = new Map<string, { phrase: string; boards: DiscoveryBoardId[]; items: Map<string, CatalogueItem> }>();
  return {
    searches,
    store: {
      create(id: string, phrase: string, boards: string[]) {
        searches.set(id, { phrase, boards: boards as DiscoveryBoardId[], items: new Map() });
      },
      add(id: string, items: readonly CatalogueItem[]) {
        const search = searches.get(id)!;
        let added = 0;
        for (const item of items) {
          if (!search.items.has(item.offer.id)) added++;
          search.items.set(item.offer.id, item);
        }
        return { added };
      },
      get(id: string) { return searches.get(id)!; }
    }
  };
};

test('migration indexes existing offers and searches technical tokens without confusing C, C++, C#', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((step) => step.version <= 15));
    const offers = createOfferStore(db);
    for (const [id, position] of [['c', 'C Developer'], ['cpp', 'C++ Developer'], ['cs', 'C# Developer'], ['net', '.NET Engineer']]) {
      offers.save({ id: id!, position, board: 'justjoin', text: '', firstSeenAt: 1, lastSeenAt: 1, processing: 'candidate', disposition: 'active' });
    }
    migrate(db);
    const catalogue = createDiscoveryCatalogue(db, offers);
    for (const [keyword, id] of [['C', 'c'], ['C++', 'cpp'], ['C#', 'cs'], ['.NET', 'net']]) {
      assert.deepEqual(catalogue.search({ ...searchQuery, keyword: keyword! }).items.map((item) => item.offer.id), [id]);
    }
    offers.save({ ...offers.get('net')!, position: 'Java Engineer' });
    assert.equal(catalogue.search({ ...searchQuery, keyword: '.NET' }).items.length, 0);
    assert.equal(catalogue.search({ ...searchQuery, keyword: 'Java' }).items.length, 1);
  } finally { db.close(); }
});

test('ingestion deduplicates source IDs across URL changes and never erases richer offer or application state', () => {
  const { db, offers, catalogue } = setup();
  try {
    const first = catalogue.ingest(batch([row('a')]), 10)[0]!;
    offers.save({ ...first.offer, text: 'Full React posting', position: 'Verified React Engineer', salary: '100 PLN/hour',
      stated: { company: 'Verified' }, analysis: { company_type: 'fintech' }, processing: 'rated', disposition: 'applied' });
    const changed = { ...row('a', 'URL title'), url: 'https://justjoin.it/job-offer/renamed', titleSource: 'slug' as const, salary: '', required_skills: [] };
    catalogue.ingest(batch([changed, changed]), 20);
    const all = offers.recent(20);
    assert.equal(all.length, 1);
    assert.equal(all[0]?.id, first.offer.id);
    assert.equal(all[0]?.firstSeenAt, 10);
    assert.equal(all[0]?.lastSeenAt, 20);
    assert.equal(all[0]?.disposition, 'applied');
    assert.equal(all[0]?.processing, 'rated');
    assert.equal(all[0]?.position, 'Verified React Engineer');
    assert.equal(all[0]?.salary, '100 PLN/hour');
    assert.equal(all[0]?.text, 'Full React posting');
    assert.deepEqual(all[0]?.stated, { company: 'Verified' });
    assert.deepEqual(all[0]?.analysis, { company_type: 'fintech' });
    // Generated analysis is retained but cannot independently qualify a search.
    assert.equal(catalogue.search({ ...searchQuery, keyword: 'react fintech' }).items.length, 0);
  } finally { db.close(); }
});

test('literal multi-field search ranks title matches, scopes boards, and paginates', () => {
  const { db, catalogue } = setup();
  try {
    catalogue.ingest(batch([row('title'), { ...row('skill', 'Developer'), company: 'React' }, row('last')]), 1);
    catalogue.ingest(batch([row('other', 'React Developer', 'nofluffjobs')]), 1);
    const page = catalogue.search({ ...searchQuery, limit: 1 });
    assert.equal(page.items.length, 1); assert.equal(page.hasMore, true); assert.equal(page.nextOffset, 1);
    assert.equal(page.items[0]?.offer.position, 'React Developer');
    assert.equal(catalogue.search({ ...searchQuery, offset: 2 }).items.length, 1);
    assert.equal(catalogue.search({ ...searchQuery, keyword: '" OR *' }).items.length, 0);
    assert.equal(catalogue.search({ ...searchQuery, keyword: 'react example' }).items.length, 2);
  } finally { db.close(); }
});

test('source freshness preserves observation history and derives activity only from explicit validity evidence', () => {
  const { db, offers, catalogue } = setup();
  try {
    const firstAt = Date.parse('2026-09-10T12:00:00.000Z');
    const secondAt = Date.parse('2026-09-17T12:00:00.000Z');
    catalogue.ingest(batch([{ ...row('fresh'), posted_at: '2026-09-09', valid_through: '2026-09-30' }]), firstAt);
    catalogue.ingest({ ...batch([{ ...row('fresh'), posted_at: '2026-09-09' }]), retrievedAt: '2026-09-17T12:00:00.000Z' }, secondAt);
    const item = catalogue.search(searchQuery).items[0]!;
    assert.equal(item.freshness?.firstObservedAt, firstAt);
    assert.equal(item.freshness?.latestObservedAt, secondAt);
    assert.deepEqual(item.freshness?.publication, { value: '2026-09-09', precision: 'date' });
    assert.equal(item.freshness?.activity.status, 'active');
    assert.equal(item.freshness?.activity.checkedAt, secondAt);
    assert.equal(offers.get(item.offer.id)?.firstSeenAt, firstAt);
  } finally { db.close(); }
});

test('unknown title evidence is separated from qualified membership and explicit inactivity is excluded', async () => {
  const { db, offers, catalogue } = setup();
  const searches = createDiscoverySearchStore(db, offers, () => Date.parse('2026-09-17T12:00:00.000Z'));
  const service = createDiscoveryService(catalogue, source(async () => ({ status: 'ok', data: batch([
    { ...row('active', 'React Engineer'), valid_through: '2026-09-30' },
    { ...row('expired', 'React Engineer'), valid_through: '2026-09-01' },
    { ...row('unknown', 'Untitled'), titleSource: 'unavailable' }
  ]) })), () => Date.parse('2026-09-17T12:00:00.000Z'), searches);
  try {
    const { id } = service.start({ searchId: 'tri-state', keyword: 'react', boards: ['justjoin'], pageSize: 30, sourceMode: 'live', matchMode: 'title' });
    await tick(); await tick();
    assert.equal(searches.read({ id: 'tri-state' }).count, 1);
    const review = searches.read({ id: 'tri-state', group: 'review' });
    assert.equal(review.count, 1);
    assert.equal(review.items[0]?.qualification?.decision, 'unknown');
    assert.equal(review.items[0]?.qualification?.conditions.find((condition) => condition.id === 'query')?.decision, 'unknown');
    const state = service.poll(id).boards[0]!;
    assert.deepEqual({ candidates: state.candidates, accepted: state.accepted, unknown: state.unknown }, { candidates: 3, accepted: 1, unknown: 1 });
    assert.deepEqual(state.filterReport?.effective.map((filter) => [filter.id, filter.support, filter.stage, filter.applied]), [
      ['keyword', 'local', 'source', true],
      ['matchMode', 'local', 'runtime', true],
      ['activity', 'local', 'runtime', true],
      ['maxPublishedAgeDays', 'local', 'runtime', false]
    ]);
    assert.deepEqual(state.filterReport?.unsupported, []);
    assert.deepEqual(searches.get('tri-state').budget, {
      targetAcceptedTotal: null, maxCandidatesTotal: 10000, maxPagesPerSource: 100,
      maxRequestsTotal: 500, deadlineMs: 720000, maxConcurrentRequests: 3
    });
  } finally { service.close(); db.close(); }
});

test('ingestion transaction rolls back all source and offer changes on failure', () => {
  const { db, offers, catalogue } = setup();
  try {
    db.exec("CREATE TRIGGER fail_source BEFORE INSERT ON discovery_sources BEGIN SELECT RAISE(ABORT, 'fail'); END");
    assert.throws(() => catalogue.ingest(batch([row('a')]), 1));
    assert.equal(offers.recent(10).length, 0);
  } finally { db.close(); }
});

test('catalogue persists across restart and searches offline through the harness', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'discovery-'));
  const databasePath = join(directory, 'runtime.db');
  let harness = createHarness({ databasePath, env: {}, discoverySource: source(async () => ({ status: 'ok', data: batch([row('persist')]) })) });
  try {
    const dispatch = createDispatch(harness);
    const started = await dispatch('discovery.start', { keyword: 'react', boards: ['justjoin'] });
    assert.equal(started.ok, true);
    await tick();
    harness.close();
    harness = createHarness({ databasePath, env: {}, scraperUrl: '' });
    const offline = await createDispatch(harness)('discovery.cached', { keyword: 'React', boards: ['justjoin'] });
    assert.equal(offline.ok, true);
    if (offline.ok) assert.equal((offline.data as { items: unknown[] }).items.length, 1);
    const unavailable = await createDispatch(harness)('discovery.boards');
    assert.equal(unavailable.ok, true);
    if (unavailable.ok) {
      const catalogue = unavailable.data as { boards: Array<{ enabled: boolean; browserSearch?: { enabled: boolean } }>; collectionUnavailableReason?: string };
      assert.ok(catalogue.boards.every(board => !board.enabled));
      assert.ok(catalogue.boards.some(board => board.browserSearch?.enabled));
      assert.ok(catalogue.collectionUnavailableReason);
    }
  } finally { harness.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('boards deliver independently with separate cursors and bounded concurrent requests', async () => {
  const { db, catalogue } = setup();
  let release: (value: Awaited<ReturnType<DiscoverySource['search']>>) => void = () => undefined;
  let justjoinReads = 0;
  const service = createDiscoveryService(catalogue, source(async (query) => {
    if (query.board === 'nofluffjobs') return new Promise((resolve) => { release = resolve; });
    justjoinReads++;
    await tick();
    return { status: 'ok', data: batch([row(query.cursor ? 'second' : 'first')], query.cursor ? null : 'next') };
  }));
  try {
    const { id } = service.start({ keyword: 'react', boards: ['justjoin', 'nofluffjobs'], pageSize: 2 });
    await tick(); await tick();
    const first = service.poll(id);
    assert.ok(first.events.some((event) => event.kind === 'batch' && event.board === 'justjoin'));
    assert.equal(first.boards.find((state) => state.board === 'nofluffjobs')?.status, 'loading');
    service.next(id); service.next(id);
    await tick(); await tick();
    // Continuation waits until every selected source has had its first chance.
    assert.equal(justjoinReads, 1);
    release({ status: 'blocked', detail: 'Source refusal' }); await tick();
    await tick();
    assert.equal(justjoinReads, 2);
    assert.equal(service.poll(id).boards.find((state) => state.board === 'justjoin')?.status, 'exhausted');
    const later = service.poll(id, first.after);
    assert.ok(later.events.every((event) => event.seq > first.after));
    assert.equal(later.boards.find((state) => state.board === 'nofluffjobs')?.error?.status, 'blocked');
    assert.equal(catalogue.search(searchQuery).items.length, 2);
  } finally { service.close(); db.close(); }
});

test('saved interactive searches collect every cached match, not only the first 30', () => {
  const { db, catalogue } = setup();
  const saved = savedSearches();
  try {
    catalogue.ingest(batch(Array.from({ length: 75 }, (_, i) => row(`cached-${i}`))), 1);
    const service = createDiscoveryService(catalogue, source(async () => ({ status: 'unavailable', detail: 'Offline' })), Date.now, saved.store);
    const { id } = service.start({ searchId: 'saved', keyword: 'react', boards: ['justjoin'], pageSize: 30, sourceMode: 'hybrid' });
    assert.equal(saved.searches.get('saved')?.items.size, 75);
    const cached = service.poll(id).events[0];
    assert.equal(cached?.kind, 'cached');
    assert.equal(cached?.items?.length, 30);
    assert.equal(cached?.cacheNextOffset, null);
    service.close();
  } finally { db.close(); }
});

test('accepted target counts the complete cached membership after fair live coverage', async () => {
  const { db, catalogue } = setup();
  const saved = savedSearches();
  catalogue.ingest(batch(Array.from({ length: 75 }, (_, i) => row(`cached-target-${i}`))), 1);
  let calls = 0;
  const service = createDiscoveryService(catalogue, source(async () => {
    calls++;
    return { status: 'ok', data: batch([row('live-target')], 'next') };
  }), Date.now, saved.store);
  try {
    const { id } = service.start({ sourceMode: 'hybrid', searchId: 'cached-target', keyword: 'react', boards: ['justjoin'], pageSize: 30,
      budget: { targetAcceptedTotal: 50, maxCandidatesTotal: 100, maxPagesPerSource: 10, maxRequestsTotal: 10, deadlineMs: 60000, maxConcurrentRequests: 1 } });
    await tick(); await tick();
    assert.equal(calls, 1);
    assert.equal(service.poll(id).boards[0]?.stopReason, 'target_reached');
  } finally { service.close(); db.close(); }
});

test('saved interactive searches automatically exhaust every source cursor', async () => {
  const { db, catalogue } = setup();
  const saved = savedSearches();
  const cursors: Array<string | undefined> = [];
  const service = createDiscoveryService(catalogue, source(async (query) => {
    cursors.push(query.cursor);
    const index = query.cursor === undefined ? 0 : Number(query.cursor);
    return { status: 'ok', data: batch([row(`source-${index}`)], index < 2 ? String(index + 1) : null) };
  }), Date.now, saved.store);
  try {
    const { id } = service.start({ searchId: 'saved', keyword: 'react', boards: ['justjoin'], pageSize: 30 });
    for (let i = 0; i < 10 && service.poll(id).boards[0]?.status !== 'exhausted'; i++) await tick();
    assert.deepEqual(cursors, [undefined, '1', '2']);
    assert.equal(service.poll(id).boards[0]?.status, 'exhausted');
    assert.equal(saved.searches.get('saved')?.items.size, 3);
  } finally { service.close(); db.close(); }
});

test('accepted target waits for fair first-source coverage and honors concurrency', async () => {
  const { db, catalogue } = setup();
  const saved = savedSearches();
  const calls: DiscoveryBoardId[] = [];
  let active = 0, maximumActive = 0;
  const service = createDiscoveryService(catalogue, source(async (query) => {
    calls.push(query.board); active++; maximumActive = Math.max(maximumActive, active); await tick(); active--;
    return { status: 'ok', data: batch([row(`${query.board}-${calls.length}`, 'React Engineer', query.board)], query.board === 'justjoin' ? 'next' : null) };
  }), Date.now, saved.store);
  try {
    const { id } = service.start({ searchId: 'fair-target', keyword: 'react', boards: ['justjoin', 'nofluffjobs'], pageSize: 2,
      sourceMode: 'live', matchMode: 'title', budget: { targetAcceptedTotal: 1, maxCandidatesTotal: 20, maxPagesPerSource: 10, maxRequestsTotal: 10, deadlineMs: 60000, maxConcurrentRequests: 1 } });
    for (let i = 0; i < 10 && service.poll(id).boards.some((state) => !['exhausted','error','cancelled'].includes(state.status)); i++) await tick();
    assert.deepEqual(calls, ['justjoin', 'nofluffjobs']);
    assert.equal(maximumActive, 1);
    assert.equal(service.poll(id).boards.find((state) => state.board === 'justjoin')?.stopReason, 'target_reached');
  } finally { service.close(); db.close(); }
});

test('page, candidate, repeated-cursor and no-new guards report deterministic bounded outcomes', async () => {
  const cases: Array<{ name: string; budget: { maxCandidatesTotal: number; maxPagesPerSource: number }; search: DiscoverySource['search']; reason: string }> = [
    { name: 'page', budget: { maxCandidatesTotal: 20, maxPagesPerSource: 1 }, search: async () => ({ status: 'ok', data: batch([row('page')], 'next') }), reason: 'page_budget' },
    { name: 'candidate', budget: { maxCandidatesTotal: 1, maxPagesPerSource: 10 }, search: async () => ({ status: 'ok', data: batch([row('one'), row('two')], 'next') }), reason: 'candidate_budget' },
    { name: 'cursor', budget: { maxCandidatesTotal: 20, maxPagesPerSource: 10 }, search: async () => ({ status: 'ok', data: { ...batch([row('cursor')], 'same'), nextCursor: 'same' } }), reason: 'repeated_cursor' },
    { name: 'identity', budget: { maxCandidatesTotal: 20, maxPagesPerSource: 10 }, search: async (query) => ({ status: 'ok', data: batch([row('duplicate')], query.cursor ? 'third' : 'second') }), reason: 'no_new_identities' }
  ];
  for (const scenario of cases) {
    const { db, catalogue } = setup();
    const saved = savedSearches();
    const service = createDiscoveryService(catalogue, source(scenario.search), Date.now, saved.store);
    try {
      const { id } = service.start({ searchId: scenario.name, keyword: 'react', boards: ['justjoin'], pageSize: 2, sourceMode: 'live', matchMode: 'title',
        budget: { targetAcceptedTotal: null, maxCandidatesTotal: scenario.budget.maxCandidatesTotal, maxPagesPerSource: scenario.budget.maxPagesPerSource, maxRequestsTotal: 10, deadlineMs: 60000, maxConcurrentRequests: 1 } });
      for (let i = 0; i < 10 && service.poll(id).boards[0]?.status !== 'exhausted'; i++) await tick();
      const state = service.poll(id).boards[0]!;
      assert.equal(state.completion, 'bounded', scenario.name);
      assert.equal(state.stopReason, scenario.reason, scenario.name);
    } finally { service.close(); db.close(); }
  }
});

test('source refusals explicitly leave completeness unknown', async () => {
  const { db, catalogue } = setup();
  const service = createDiscoveryService(catalogue, source(async () => ({ status: 'blocked', detail: 'Denied' })));
  try {
    const { id } = service.start({ keyword: 'react', boards: ['justjoin'], pageSize: 2 });
    await tick();
    assert.deepEqual({ completion: service.poll(id).boards[0]?.completion, reason: service.poll(id).boards[0]?.stopReason }, { completion: 'unknown', reason: 'blocked' });
    assert.deepEqual(service.poll(id).boards[0]?.filterReport?.effective[0], {
      id: 'keyword', support: 'unknown', stage: 'source', requested: 'react', applied: false,
      detail: 'No successful source page has confirmed keyword application yet.'
    });
  } finally { service.close(); db.close(); }
});

test('request budget stops a source before another page is scheduled', async () => {
  const { db, catalogue } = setup();
  let calls = 0;
  const saved = savedSearches();
  const service = createDiscoveryService(catalogue, source(async () => {
    calls++;
    return { status: 'ok', data: batch([row(`request-${calls}`)], `cursor-${calls}`) };
  }), Date.now, saved.store);
  try {
    const { id } = service.start({ searchId: 'request-budget', keyword: 'react', boards: ['justjoin'], pageSize: 2, sourceMode: 'live',
      budget: { targetAcceptedTotal: null, maxCandidatesTotal: 20, maxPagesPerSource: 10, maxRequestsTotal: 1, deadlineMs: 60000, maxConcurrentRequests: 1 } });
    await tick(); await tick();
    assert.equal(calls, 1);
    assert.deepEqual({ completion: service.poll(id).boards[0]?.completion, reason: service.poll(id).boards[0]?.stopReason }, { completion: 'bounded', reason: 'request_budget' });
  } finally { service.close(); db.close(); }
});

test('versioned title mode applies the same qualification to cache and live candidates', async () => {
  const { db, catalogue } = setup();
  const saved = savedSearches();
  try {
    catalogue.ingest(batch([
      row('cached-title', 'Frontend Developer'),
      { ...row('cached-description', 'Backend Developer'), required_skills: ['frontend'] }
    ]), 1);
    const service = createDiscoveryService(catalogue, source(async () => ({ status: 'ok', data: batch([
      row('live-title', 'Senior Frontend Engineer'),
      { ...row('live-description', 'Java Engineer'), company: 'Frontend Labs' }
    ]) })), Date.now, saved.store);
    const { id } = service.start({ searchId: 'qualified', keyword: 'frontend', boards: ['justjoin'], pageSize: 30, sourceMode: 'hybrid', matchMode: 'title' });
    for (let i = 0; i < 10 && service.poll(id).boards[0]?.status !== 'exhausted'; i++) await tick();
    assert.deepEqual([...saved.searches.get('qualified')!.items.keys()].sort(), [
      catalogue.search({ ...searchQuery, keyword: 'frontend', matchMode: 'title' }).items[0]!.offer.id,
      catalogue.search({ ...searchQuery, keyword: 'frontend', matchMode: 'title', offset: 1 }).items[0]!.offer.id
    ].sort());
    for (const item of saved.searches.get('qualified')!.items.values()) {
      assert.equal(item.qualification?.mode, 'title');
      assert.match(item.offer.position ?? '', /frontend/i);
    }
  } finally { db.close(); }
});

test('live mode excludes cache-only matches and cache mode performs no source request', async () => {
  const { db, catalogue } = setup();
  const saved = savedSearches();
  catalogue.ingest(batch([row('old', 'Frontend Developer')]), 1);
  let calls = 0;
  const service = createDiscoveryService(catalogue, source(async () => {
    calls++;
    return { status: 'ok', data: batch([row('fresh', 'Frontend Engineer')]) };
  }), Date.now, saved.store);
  try {
    const live = service.start({ searchId: 'live', keyword: 'frontend', boards: ['justjoin'], pageSize: 30, sourceMode: 'live', matchMode: 'title' });
    for (let i = 0; i < 10 && service.poll(live.id).boards[0]?.status !== 'exhausted'; i++) await tick();
    assert.equal(saved.searches.get('live')?.items.size, 1);
    assert.ok([...saved.searches.get('live')!.items.values()].every(item => item.qualification?.origin === 'live'));
    const before = calls;
    const cache = service.start({ searchId: 'cache', keyword: 'frontend', boards: ['justjoin'], pageSize: 30, sourceMode: 'cache', matchMode: 'title' });
    assert.equal(calls, before);
    assert.equal(service.poll(cache.id).boards[0]?.stopReason, 'cache_only');
    assert.ok([...saved.searches.get('cache')!.items.values()].every(item => item.qualification?.origin === 'cache'));
  } finally { service.close(); db.close(); }
});

test('cancellation ignores late results even when a reader ignores its abort signal', async () => {
  const { db, catalogue } = setup();
  let release: (value: Awaited<ReturnType<DiscoverySource['search']>>) => void = () => undefined;
  let signal: AbortSignal | undefined;
  const service = createDiscoveryService(catalogue, source((_query, provided) => { signal = provided; return new Promise((resolve) => { release = resolve; }); }));
  try {
    const { id } = service.start({ keyword: 'react', boards: ['justjoin'], pageSize: 2 });
    service.cancel(id); assert.equal(signal?.aborted, true);
    release({ status: 'ok', data: batch([row('late')]) }); await tick();
    assert.equal(catalogue.search(searchQuery).items.length, 0);
    assert.equal(service.poll(id).cancelled, true);
    assert.ok(!service.poll(id).events.some((event) => event.kind === 'batch'));
  } finally { service.close(); db.close(); }
});

test('expired source cursors do not restart at page one or retry on scroll', async () => {
  const { db, catalogue } = setup();
  let calls = 0;
  const service = createDiscoveryService(catalogue, source(async (query) => {
    calls++;
    return query.cursor ? { status: 'expired_cursor', detail: 'Expired' } : { status: 'ok', data: batch([row('a')], 'cursor') };
  }));
  try {
    const { id } = service.start({ keyword: 'react', boards: ['justjoin'], pageSize: 2 });
    await tick(); service.next(id); await tick(); service.next(id); await tick();
    assert.equal(calls, 2);
    assert.equal(service.poll(id).boards[0]?.error?.status, 'expired_cursor');
  } finally { service.close(); db.close(); }
});

test('IPC rejects bad search inputs and preserves session error codes', async () => {
  const harness = createHarness({ databasePath: ':memory:', env: {}, scraperUrl: '' });
  try {
    const dispatch = createDispatch(harness);
    for (const payload of [{ keyword: '', boards: ['justjoin'] }, { keyword: 'react', boards: [] }, { keyword: 'react', boards: ['linkedin'] }]) {
      assert.equal((await dispatch('discovery.start', payload)).ok, false);
    }
    const unsupported = await dispatch('discovery.start', { keyword: 'react', boards: ['justjoin', 'pracuj'], workMode: 'remote' });
    assert.equal(unsupported.ok, false);
    if (!unsupported.ok) {
      assert.equal(unsupported.error.code, 'unsupported_filter');
      assert.match(unsupported.error.message, /justjoin, pracuj/);
    }
    const expired = await dispatch('discovery.poll', { id: '00000000-0000-4000-8000-000000000000' });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.error.code, 'search_expired');
  } finally { harness.close(); }
});

test('a newer listing snapshot is not overwritten by a slower stale response', () => {
  const { db, catalogue } = setup();
  try {
    catalogue.ingest({ ...batch([row('same', 'Current React role')]), retrievedAt: '2026-09-12T12:00:00.000Z' }, 10);
    catalogue.ingest(batch([row('same', 'Old Java role')]), 20);
    const result = catalogue.search(searchQuery);
    assert.equal(result.items[0]?.offer.position, 'Current React role');
    assert.equal(result.items[0]?.listing?.title, 'Current React role');
    assert.equal(result.items[0]?.retrievedAt, '2026-09-12T12:00:00.000Z');
  } finally { db.close(); }
});

test('replacing a query cancels its old session and ignores old results', async () => {
  const { db, catalogue } = setup();
  let release: (value: Awaited<ReturnType<DiscoverySource['search']>>) => void = () => undefined;
  const service = createDiscoveryService(catalogue, source(async (query) => {
    if (query.keyword === 'old') return new Promise((resolve) => { release = resolve; });
    return { status: 'ok', data: batch([row('new', 'New Developer')]) };
  }));
  try {
    const previous = service.start({ keyword: 'old', boards: ['justjoin'], pageSize: 2 });
    const current = service.start({ keyword: 'new', boards: ['justjoin'], pageSize: 2, replaceSessionId: previous.id });
    release({ status: 'ok', data: batch([row('old', 'Old Developer')]) }); await tick();
    assert.throws(() => service.poll(previous.id), { code: 'search_expired' });
    assert.equal(service.poll(current.id).events.find((event) => event.kind === 'batch')?.items?.[0]?.listing?.external_id, 'new');
    assert.equal(catalogue.search(searchQuery).items.length, 1);
  } finally { service.close(); db.close(); }
});

test('explicit hybrid search delivers cached rows before reporting its source failure', async () => {
  const { db, catalogue } = setup();
  catalogue.ingest(batch([row('cached')]), 1);
  const service = createDiscoveryService(catalogue, source(async () => ({ status: 'unavailable', detail: 'Offline' })));
  try {
    const { id } = service.start({ sourceMode: 'hybrid', keyword: 'react', boards: ['justjoin'], pageSize: 2 });
    await tick();
    const result = service.poll(id);
    assert.equal(result.events[0]?.kind, 'cached');
    assert.equal(result.events[0]?.items?.length, 1);
    assert.equal(result.boards[0]?.error?.status, 'unavailable');
    assert.equal(catalogue.search(searchQuery).items.length, 1);
  } finally { service.close(); db.close(); }
});

test('scraper client validates response identity, URLs, status and continuation', async () => {
  const query = { board: 'justjoin' as const, keyword: 'react', pageSize: 2 };
  const signal = new AbortController().signal;
  const token = '0123456789abcdef0123456789abcdef';
  const client = (body: unknown, status = 200) => createDiscoverySource({ token, fetch: async () => new Response(JSON.stringify(body), { status }) });
  const good = { status: 'ok', data: batch([row('a')]) };
  assert.equal((await client(good).search(query, signal)).status, 'ok');
  for (const data of [
    { ...good.data, board: 'nofluffjobs' },
    batch([{ ...row('a'), url: 'https://justjoin.it.evil.example/job' }]),
    { ...good.data, hasMore: true },
    { ...good.data, version: 2 }
  ]) assert.equal((await client({ status: 'ok', data }).search(query, signal)).status, 'error');
  assert.equal((await client(good, 500).search(query, signal)).status, 'error');
  assert.equal((await client({ status: 'disallowed', detail: 'No' }, 403).search(query, signal)).status, 'disallowed');
  assert.throws(() => createDiscoverySource({ url: 'https://example.com' }));
});

test('scraper client authenticates in a header without putting the token in the URL', async () => {
  const token = '0123456789abcdef0123456789abcdef';
  let seenUrl = '';
  let seenAuthorization = '';
  const client = createDiscoverySource({
    token,
    fetch: async (input, init) => {
      seenUrl = String(input);
      seenAuthorization = new Headers(init?.headers).get('authorization') ?? '';
      return Response.json({ version: 1, boards: [] });
    }
  });
  await client.boards(new AbortController().signal);
  assert.equal(seenAuthorization, `Bearer ${token}`);
  assert.doesNotMatch(seenUrl, new RegExp(token));
});


test('new searches default to live and never substitute catalogue matches', async () => {
  const {db, offers, catalogue} = setup();
  const searches = createDiscoverySearchStore(db, offers);
  catalogue.ingest(batch([row('old-cache')]), 1);
  let calls = 0;
  const service = createDiscoveryService(catalogue, source(async () => {
    calls++;
    return {status:'unavailable',detail:'Offline'};
  }), Date.now, searches);
  try {
    const {id} = service.start({searchId:'fresh',keyword:'react',boards:['justjoin'],pageSize:30});
    await tick();
    assert.equal(calls, 1);
    assert.equal(searches.get('fresh').sourceMode, 'live');
    assert.equal(searches.get('fresh').count, 0);
    assert.equal(service.poll(id).boards[0]?.error?.detail, 'Offline');
  } finally {service.close();db.close();}
});

test('refetch keeps the same owner, renews its budget, and reset affects only its membership', async () => {
  const {db, offers, catalogue} = setup();
  const searches = createDiscoverySearchStore(db, offers);
  const old = catalogue.ingest(batch([row('old')]), 1);
  searches.create('owner','react',['justjoin']); searches.add('owner',old);
  searches.create('other','react',['justjoin']); searches.add('other',old);
  db.prepare("INSERT INTO offer_notes VALUES (?, 'keep note', 1, 1)").run(old[0]!.offer.id);
  db.prepare("INSERT INTO conversations(id,subject_kind,subject_id,created_at,updated_at) VALUES('chat','discovery','owner',1,1)").run();
  let calls = 0;
  const service = createDiscoveryService(catalogue, source(async query => {
    assert.equal(query.keyword,'react'); assert.equal(query.cursor,undefined);
    return {status:'ok',data:batch([row(`new-${++calls}`)])};
  }), Date.now, searches);
  try {
    while(searches.reserveRequest('owner','search')) { /* Exhaust the old run. */ }
    const request = {searchId:'owner',keyword:'unsubmitted edit',boards:['nofluffjobs'] as DiscoveryBoardId[],pageSize:30};
    service.start({...request,refetch:'append'}); await tick();
    assert.equal(searches.get('owner').count,2);
    assert.equal(searches.requestUsage('owner').search,1);
    const beforeReset = searches.read({id:'owner',limit:1}).pageRevision;
    service.start({...request,refetch:'reset'}); await tick();
    assert.equal(searches.get('owner').count,1);
    assert.equal(searches.get('owner').sourceMode,'live');
    assert.equal(searches.get('owner').phrase,'react');
    assert.equal(searches.requestUsage('owner').search,1);
    assert.equal(searches.read({id:'owner'}).items[0]?.listing?.external_id,'new-2');
    assert.equal(searches.get('other').count,1);
    assert.ok(offers.get(old[0]!.offer.id));
    assert.ok(db.prepare("SELECT 1 FROM conversations WHERE id='chat'").get());
    assert.ok(db.prepare("SELECT 1 FROM offer_notes WHERE text='keep note'").get());
    assert.throws(()=>searches.read({id:'owner',offset:1,pageRevision:beforeReset}),{code:'search_results_changed'});
  } finally {service.close();db.close();}
});

test('missing scraper authentication reports a configuration error without making a request', async () => {
  const client = createDiscoverySource({token:'',fetch:async()=>assert.fail('must not request')});
  const result = await client.search({board:'justjoin',keyword:'UX Designer',pageSize:30},new AbortController().signal);
  assert.equal(result.status,'unavailable');
  assert.match(result.detail,/SCRAPER_API_TOKEN/);
});
