import assert from 'node:assert/strict';
import test from 'node:test';
import { open } from '../src/storage/sqlite/open.js';
import { migrate } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createEnrichmentStore } from '../src/storage/sqlite/enrichment.js';
import { createEnrichmentService } from '../src/runtime/enrichment.js';
import { createDiscoveryCatalogue } from '../src/storage/sqlite/discovery.js';
import type { ResolvedOffer, RunResult } from '../src/contracts/index.js';
import { createHarness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const setup = () => {
  const db = open(':memory:'); migrate(db);
  const offers = createOfferStore(db);
  offers.save({ id: 'a', url: 'https://vacancies.example/job-offer/a', board: 'vacancies', text: '',
    company: 'Existing company', salary: 'Original salary', analysis: { company_size: '50–200' },
    firstSeenAt: 1, lastSeenAt: 2, processing: 'candidate', disposition: 'active' });
  const store = createEnrichmentStore(db, offers);
  return { db, offers, store };
};
const source: ResolvedOffer = { url: 'https://vacancies.example/job-offer/a', finalUrl: 'https://vacancies.example/job-offer/a',
  text: 'React role. Fintech company with 50–200 employees. Salary 100 PLN/hour.',
  stated: { title: 'React Engineer', salary: '100 PLN/hour', company: 'Board company' } };
const result = (data: Record<string, unknown>, degraded: string[] = []): RunResult => ({
  runId: 'run', capability: 'analyze_offer', data, degraded, outcomes: [], elapsedMs: 1
});

test('enrichment keeps board facts and user state, merges partial results, and updates search index', async () => {
  const { db, offers, store } = setup();
  let finish: (value: RunResult) => void = () => undefined;
  const service = createEnrichmentService(offers, store, { resolve: async () => source },
    () => ({ runId: 'run', settled: new Promise((resolve) => { finish = resolve; }) }), () => 1000);
  try {
    service.start('a'); await tick();
    assert.equal(store.get('a')?.status, 'analyzing');
    offers.setDisposition('a', 'applied');
    finish(result({ salary: '999999 PLN', position: 'Wrong AI title', company: 'Unknown', company_type: 'Fintech', company_size: 'Not stated' }, ['facts']));
    await tick();
    const offer = offers.get('a')!;
    assert.equal(offer.salary, '100 PLN/hour'); assert.equal(offer.position, 'React Engineer');
    assert.equal(offer.company, 'Board company'); assert.equal(offer.analysis?.company_size, '50–200');
    assert.equal(offer.analysis?.company_type, 'Fintech'); assert.equal(offer.disposition, 'applied');
    assert.equal(offer.firstSeenAt, 1); assert.equal(offer.lastSeenAt, 2);
    assert.equal(store.get('a')?.status, 'partial');
    assert.equal(store.get('a')?.provenance?.salary?.source, 'board');
    assert.equal(store.get('a')?.provenance?.company_type?.source, 'ai');
    const cached = createDiscoveryCatalogue(db, offers).search({ keyword: 'react fintech', boards: ['vacancies'], limit: 10, offset: 0 });
    assert.equal(cached.items[0]?.enrichment?.status, 'partial');
  } finally { service.close(); db.close(); }
});

test('failed analysis preserves fetched text and retries it without fetching again', async () => {
  const { db, offers, store } = setup(); let reads = 0; let analyses = 0;
  const service = createEnrichmentService(offers, store, { resolve: async () => { reads++; return source; } },
    () => ({ runId: 'run', settled: ++analyses === 1 ? Promise.reject(new Error('Model unavailable')) : Promise.resolve(result({ company_type: 'Fintech' })) }), () => 1000);
  try {
    service.start('a'); await tick();
    assert.equal(store.get('a')?.status, 'failed'); assert.equal(offers.get('a')?.text, source.text);
    service.start('a'); await tick();
    assert.equal(store.get('a')?.status, 'succeeded'); assert.equal(reads, 1); assert.equal(analyses, 2);
    service.start('a'); await tick(); assert.equal(analyses, 2);
    service.start('a', true); await tick(); assert.equal(reads, 2); assert.equal(analyses, 3);
  } finally { service.close(); db.close(); }
});

test('one offer has only one active enrichment and cancellation ignores a late source', async () => {
  const { db, offers, store } = setup(); let reads = 0;
  let finish: (value: ResolvedOffer) => void = () => undefined;
  const service = createEnrichmentService(offers, store, { resolve: async () => { reads++; return new Promise((resolve) => { finish = resolve; }); } },
    () => { assert.fail('must not analyze after cancellation'); });
  try {
    const first = service.start('a'); const second = service.start('a');
    assert.equal(first.id, second.id); await tick(); assert.equal(reads, 1);
    service.cancel('a'); finish(source); await tick();
    assert.equal(store.get('a')?.status, 'cancelled'); assert.equal(offers.get('a')?.text, '');
  } finally { service.close(); db.close(); }
});

test('source failure preserves all stored fields and never calls a model', async () => {
  const { db, offers, store } = setup(); const before = offers.get('a');
  const service = createEnrichmentService(offers, store, { resolve: async () => { throw new Error('Source refused'); } },
    () => { assert.fail('must not analyze a refused source'); });
  try {
    service.start('a'); await tick();
    assert.deepEqual(offers.get('a'), before); assert.equal(store.get('a')?.status, 'failed');
  } finally { service.close(); db.close(); }
});

test('interrupted enrichment is recovered as retryable and completed metadata remains durable', async () => {
  const { db, offers, store } = setup();
  store.write({ offerId: 'a', id: 'op', status: 'analyzing', updatedAt: 1, detailsFetchedAt: 1, runId: 'old-run' });
  const reopenedStore = createEnrichmentStore(db, offers); reopenedStore.recover();
  assert.equal(reopenedStore.get('a')?.status, 'failed');
  assert.equal(reopenedStore.get('a')?.detailsFetchedAt, 1);
  db.close();
});

test('IPC rejects missing offers and does not accept arbitrary analysis input', async () => {
  const harness = createHarness({ databasePath: ':memory:', env: {}, scraperUrl: '' });
  try {
    const call = createDispatch(harness);
    const missing = await call('discovery.enrich', { offerId: 'missing' });
    assert.equal(missing.ok, false); if (!missing.ok) assert.equal(missing.error.code, 'offer_missing');
    assert.equal((await call('discovery.enrich', { offerId: 'a', url: 'https://example.com', capability: 'ask_profile' })).ok, false);
  } finally { harness.close(); }
});

test('completed enrichment and provenance survive closing and reopening the database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'offer-enrichment-'));
  const path = join(directory, 'runtime.db');
  let db = open(path); migrate(db);
  const offers = createOfferStore(db);
  offers.save({ id: 'a', url: source.url, text: '', firstSeenAt: 1, lastSeenAt: 1, processing: 'candidate', disposition: 'active' });
  const service = createEnrichmentService(offers, createEnrichmentStore(db, offers), { resolve: async () => source },
    () => ({ runId: 'persisted-run', settled: Promise.resolve({ ...result({ company_type: 'Fintech' }), runId: 'persisted-run' }) }));
  try {
    service.start('a'); await tick(); service.close(); db.close();
    db = open(path); migrate(db);
    const storedOffers = createOfferStore(db);
    const stored = createEnrichmentStore(db, storedOffers); stored.recover();
    assert.equal(stored.get('a')?.status, 'succeeded');
    assert.equal(stored.get('a')?.runId, 'persisted-run');
    assert.equal(stored.get('a')?.provenance?.company_type?.source, 'ai');
    assert.equal(storedOffers.get('a')?.analysis?.company_type, 'Fintech');
    assert.equal(storedOffers.get('a')?.salaryReading?.period, 'hour');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});


test('fetch-only operation persists board facts without invoking analysis and survives restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'details-only-'));
  const path = join(directory, 'runtime.db');
  let db = open(path); migrate(db);
  const offers = createOfferStore(db);
  offers.save({ id: 'a', url: source.url, text: '', firstSeenAt: 1, lastSeenAt: 2, processing: 'candidate', disposition: 'applied' });
  const store = createEnrichmentStore(db, offers);
  let reads = 0;
  const service = createEnrichmentService(offers, store, { resolve: async () => { reads++; return source; } }, () => { assert.fail('fetch must not analyze'); });
  try {
    const first = service.details.start('a');
    assert.equal(service.details.start('a').details?.id, first.details?.id);
    await tick();
    assert.equal(reads, 1);
    assert.equal(store.get('a')?.status, 'idle');
    assert.equal(store.get('a')?.details?.status, 'succeeded');
    assert.equal(store.get('a')?.analyzedAt, undefined);
    service.details.start('a'); await tick(); assert.equal(reads, 1);
    service.close(); db.close();
    db = open(path); migrate(db);
    const reopened = createOfferStore(db);
    const metadata = createEnrichmentStore(db, reopened); metadata.recover();
    assert.equal(reopened.get('a')?.position, 'React Engineer');
    assert.equal(reopened.get('a')?.disposition, 'applied');
    assert.equal(reopened.get('a')?.salaryReading?.period, 'hour');
    assert.equal(metadata.get('a')?.details?.status, 'succeeded');
    assert.equal(metadata.get('a')?.provenance?.position?.source, 'board');
  } finally { service.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('fetch cancellation ignores late reads, and a failed refresh preserves successful facts and timestamp', async () => {
  const { db, offers, store } = setup();
  let finish: (value: ResolvedOffer) => void = () => undefined;
  let fail = false;
  const service = createEnrichmentService(offers, store, { resolve: async () => {
    if (fail) throw new Error('Source refused');
    return new Promise(resolve => { finish = resolve; });
  } }, () => { assert.fail('no model'); });
  try {
    service.details.start('a'); await tick();
    service.details.cancel('a'); finish(source); await tick();
    assert.equal(store.get('a')?.details?.status, 'cancelled');
    assert.equal(offers.get('a')?.text, '');
    service.details.start('a'); await tick(); finish(source); await tick();
    const before = offers.get('a'); const timestamp = store.get('a')?.detailsFetchedAt;
    fail = true; service.details.start('a', true); await tick();
    assert.equal(store.get('a')?.details?.status, 'failed');
    assert.equal(store.get('a')?.detailsFetchedAt, timestamp);
    assert.deepEqual(offers.get('a'), before);
    assert.equal(store.get('a')?.status, 'idle');
  } finally { service.close(); db.close(); }
});

for (const cancel of ['analysis', 'details'] as const) {
  test(`shared fetch continues when only ${cancel} consumer cancels`, async () => {
    const { db, offers, store } = setup();
    let reads = 0; let analyses = 0;
    let finish: (value: ResolvedOffer) => void = () => undefined;
    const service = createEnrichmentService(offers, store, { resolve: async () => { reads++; return new Promise(resolve => { finish = resolve; }); } },
      () => { analyses++; return { runId: 'run', settled: Promise.resolve(result({})) }; });
    try {
      service.details.start('a'); service.start('a'); await tick();
      if (cancel === 'analysis') service.cancel('a'); else service.details.cancel('a');
      finish(source); await tick();
      assert.equal(reads, 1); assert.equal(offers.get('a')?.text, source.text);
      assert.equal(store.get('a')?.details?.status, 'succeeded');
      assert.equal(analyses, cancel === 'analysis' ? 0 : 1);
      assert.equal(store.get('a')?.status, cancel === 'analysis' ? 'cancelled' : 'succeeded');
    } finally { service.close(); db.close(); }
  });
}

test('fetch success stays successful after analysis fails; reanalysis reuses source and refresh cannot race analysis', async () => {
  const { db, offers, store } = setup(); let reads = 0;
  let fail: (error: Error) => void = () => undefined;
  const service = createEnrichmentService(offers, store, { resolve: async () => { reads++; return source; } },
    () => ({ runId: 'run', settled: new Promise((_, reject) => { fail = reject; }) }));
  try {
    service.details.start('a'); await tick();
    service.start('a', true, false); await tick();
    assert.equal(reads, 1);
    assert.throws(() => service.details.start('a', true), /Wait for analysis/);
    fail(new Error('No provider key')); await tick();
    assert.equal(store.get('a')?.status, 'failed');
    assert.equal(store.get('a')?.details?.status, 'succeeded');
    assert.equal(offers.get('a')?.text, source.text);
  } finally { service.close(); db.close(); }
});

test('interrupted independent fetch recovers without marking analysis failed', () => {
  const { db, offers, store } = setup();
  store.write({ offerId: 'a', id: 'idle', status: 'idle', updatedAt: 1,
    details: { id: 'fetch', status: 'fetching', updatedAt: 1, requested: true } });
  const recovered = createEnrichmentStore(db, offers); recovered.recover();
  assert.equal(recovered.get('a')?.status, 'idle');
  assert.equal(recovered.get('a')?.details?.status, 'failed');
  assert.equal(recovered.get('a')?.details?.requested, false);
  db.close();
});
