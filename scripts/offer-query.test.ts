import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHarness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { projectOffer } from '../src/storage/sqlite/offer-query-projection.js';
import { queryTables, defaultOfferSql } from '../src/storage/sqlite/offer-query-schema.js';
import { createOfferQueryStore } from '../src/storage/sqlite/offer-query-store.js';
import { queryRuntimeSupported } from '../src/storage/sqlite/offer-query-process.js';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createDiscoverySearchStore } from '../src/storage/sqlite/discovery-searches.js';
import type { QueryScope } from '../src/contracts/offer-query.js';
const fixture = (id: string, title = 'Published React') => ({ offer: { id, url: `https://example.test/${id}`, board: 'justjoin', position: 'AI title', company: 'AI company', text: 'C++ C# .NET React engineer in Kraków and Łódź.', stated: { title, company: 'Published Co', location: 'Kraków', work_mode: 'remote', company_type: 'Fintech', company_size: '50–100', engagement_length: '6 months', start_date: 'ASAP', salary: '20000–25000 PLN/month', salary_ranges: [{ min: 20000, max: 25000, currency: 'PLN', period: 'month', contractType: 'B2B', rawText: '20–25k PLN' }], required_skills: ['React', 'C++'] }, analysis: { company: 'SECRET AI', position: 'SECRET AI' } }, listing: { board: 'justjoin', title: 'slug-only', titleSource: 'slug' } });
function setup(path = ':memory:') { const h = createHarness({ databasePath: path, env: {}, scraperUrl: '' }); return h; }
function seed(h: ReturnType<typeof setup>, id = 's', n = 3) { const identity = { id, importKey: 'fixture' }; h.discoverySearches.begin({ ...identity, phrase: 'React', boards: ['justjoin'], filters: {}, rowCount: n }); for (let i = 0; i < n; i += 50)
    h.discoverySearches.append({ ...identity, offset: i, items: Array.from({ length: Math.min(50, n - i) }, (_, j) => fixture(`${id}-${i + j}`)) }); h.discoverySearches.finish(identity); }
async function execute(h: ReturnType<typeof setup>, sql: string, scope: QueryScope = { kind: 'search', searchId: 's' }, ownerSearchId = 's', params: {
    name: string;
    value: string | number | null | boolean;
}[] = []) { const ctx = await h.offerQueries.context(ownerSearchId, scope); const { executionId } = h.offerQueries.start({ requestId: randomUUID(), ownerSearchId, sql, params, schemaVersion: 1, scope, expectedScopeRevision: ctx.scopeRevision, snapshotId: ctx.snapshotId }); for (let i = 0; i < 1000; i++) {
    const r = h.offerQueries.get(ownerSearchId, executionId);
    if (!['queued', 'capturing', 'running'].includes(r.state))
        return r;
    await delay(5);
} throw Error('test query timeout'); }
const integration = { skip: !queryRuntimeSupported() };
test('published projection maps table fields and never falls back to canonical AI', () => {
    const value = fixture('one');
    const p = projectOffer('e', value as Parameters<typeof projectOffer>[1]);
    const row = Object.fromEntries(queryTables.offers.map((c, i) => [c.name, p.tables.offers![0]![i]]));
    assert.equal(row.role, 'Published React');
    assert.equal(row.company, 'Published Co');
    assert.equal(row.industry, 'Fintech');
    assert.equal(row.duration, '6 months');
    assert.equal(row.company_size, '50–100');
    assert.equal(row.start_date, 'ASAP');
    assert.equal(row.work_mode, 'remote');
    assert.equal(row.location_key, 'krakow');
    assert.ok(!JSON.stringify(p).includes('SECRET AI'));
    const missing = projectOffer('e2', { offer: { id: 'one', text: '', position: 'AI', company: 'AI', salaryReading: { min: 100, max: 200, currency: 'PLN', period: 'month' }, analysis: { position: 'AI' } }, listing: { title: 'slug', titleSource: 'slug' } });
    assert.equal(missing.tables.offers![0]![4], null);
    assert.equal(missing.tables.offers![0]![5], null);
    assert.equal(missing.tables.offer_salaries![0]![2], null);
});
test('projection source replacement and empty salary units preserve unknowns and alternatives', () => {
    const p = projectOffer('e', { offer: { id: 'a', text: '', stated: { salary: 'New salary without units' } }, listing: { salary: 'Old salary', salary_ranges: [{ min: 10, max: 20, currency: 'PLN', period: 'month', rawText: 'old' }] } });
    assert.equal(p.tables.offer_salaries![0]![2], null);
    assert.equal(p.tables.offer_salaries![0]![5], null);
});
test('schema, parameterized SQL, FTS, duplicate columns, big integers and validation', integration, async () => {
    const h = setup();
    try {
        seed(h);
        const r = await execute(h, 'SELECT o.offer_id,o.company AS x,o.role AS x,9223372036854775807 AS big FROM offers o WHERE o.location_key=:city', undefined, undefined, [{ name: 'city', value: 'krakow' }]);
        assert.equal(r.state, 'succeeded', JSON.stringify(r));
        const page = h.offerQueries.page('s', r.executionId, undefined, 2);
        assert.equal(page.rows.length, 2);
        assert.equal(page.columns[1]?.name, page.columns[2]?.name);
        assert.deepEqual(page.rows[0]?.[3], { integer: '9223372036854775807' });
        assert.equal(page.references.length, 2);
        assert.equal(h.offerQueries.page('s', r.executionId, page.nextCursor!, 2).rows.length, 1);
        for (const q of ['"c++"', '"c#"', '".net"', 'lodz']) {
            const f = await execute(h, 'SELECT count(*) FROM offer_text_fts WHERE offer_text_fts MATCH :q', undefined, undefined, [{ name: 'q', value: q }]);
            assert.equal(f.state, 'succeeded', JSON.stringify(f));
            assert.deepEqual(h.offerQueries.page('s', f.executionId, undefined, 100).rows, [[3]]);
        }
        const ctx = await h.offerQueries.context('s', { kind: 'search', searchId: 's' });
        const validated = await h.offerQueries.validate({ ownerSearchId: 's', scope: { kind: 'search', searchId: 's' }, schemaVersion: 1, expectedScopeRevision: ctx.scopeRevision, sql: 'SELECT count(*) FROM offers' });
        assert.equal(validated.columns.length, 1);
        assert.equal('returnedRowCount' in validated, false);
        const count = await execute(h, 'SELECT count(*) FROM offers');
        assert.deepEqual(h.offerQueries.page('s', count.executionId, undefined, 100).rows, [[3]]);
    }
    finally {
        h.close();
    }
});
test('security, scope ownership and aggregate/forged identities', integration, async () => {
    const h = setup();
    try {
        seed(h);
        seed(h, 'other', 1);
        for (const sql of ['SELECT * FROM sqlite_master', 'SELECT * FROM offer_text_fts_content', 'SELECT * FROM offers;SELECT 1', "SELECT load_extension('x')", 'PRAGMA database_list', "ATTACH DATABASE ':memory:' AS other", 'WITH RECURSIVE x AS (SELECT 1) SELECT * FROM x']) {
            const r = await execute(h, sql);
            assert.equal(r.state, 'failed', sql);
        }
        const r = await execute(h, "SELECT 's-0' AS offer_id");
        assert.equal(h.offerQueries.page('s', r.executionId, undefined, 100).references.length, 0);
        assert.throws(() => h.offerQueries.get('other', r.executionId), { code: 'query_not_found' });
        await assert.rejects(h.offerQueries.context('other', { kind: 'search', searchId: 's' }), { code: 'query_scope_conflict' });
        await assert.rejects(h.offerQueries.context('s', { kind: 'result', executionId: r.executionId }), { code: 'query_scope_not_offers' });
        const good = await execute(h, "SELECT o.offer_id FROM offers o WHERE o.offer_id='s-0'");
        const nested = await execute(h, 'SELECT count(*) FROM offers', { kind: 'result', executionId: good.executionId });
        assert.deepEqual(h.offerQueries.page('s', nested.executionId, undefined, 100).rows, [[1]]);
        const catalogue = await execute(h, 'SELECT count(*) FROM offers', { kind: 'catalogue' });
        assert.deepEqual(h.offerQueries.page('s', catalogue.executionId, undefined, 100).rows, [[4]]);
    }
    finally {
        h.close();
    }
});
test('idempotency, immutable snapshots, cache, pending draft and last-success behavior', integration, async () => {
    const h = setup();
    try {
        seed(h);
        const ctx = await h.offerQueries.context('s', { kind: 'search', searchId: 's' });
        const request = { ownerSearchId: 's', requestId: randomUUID(), scope: { kind: 'search', searchId: 's' }, schemaVersion: 1, expectedScopeRevision: ctx.scopeRevision, snapshotId: ctx.snapshotId, sql: 'SELECT o.* FROM offers o' };
        const first = h.offerQueries.start(request);
        assert.deepEqual(h.offerQueries.start(request), first);
        assert.throws(() => h.offerQueries.start({ ...request, sql: 'SELECT 1' }), { code: 'query_request_conflict' });
        while (['queued', 'capturing', 'running'].includes(h.offerQueries.get('s', first.executionId).state))
            await delay(5);
        const repeat = await execute(h, request.sql);
        assert.equal(repeat.timing?.resultCacheHit, true);
        const doc = h.offerQueries.document('s');
        h.offerQueries.save({ ownerSearchId: 's', expectedDocumentRevision: doc.revision, draftSql: 'SELECT bad FROM offers', params: [], scope: { kind: 'search', searchId: 's' }, presentation: 'results' });
        await execute(h, 'SELECT bad FROM offers');
        assert.equal(h.offerQueries.document('s').appliedExecutionId, repeat.executionId);
        h.offers.setDisposition('s-0', 'applied');
        const changed = await h.offerQueries.context('s', { kind: 'search', searchId: 's' });
        assert.notEqual(changed.scopeRevision, ctx.scopeRevision);
        const old = h.offerQueries.page('s', first.executionId, undefined, 100);
        const disposition = old.columns.findIndex(c => c.name === 'disposition');
        assert.equal(old.rows[0]?.[disposition], 'active');
    }
    finally {
        h.close();
    }
});
test('migration/backfill preserves old filters and notes; evidence GC retains query references', integration, async () => {
    const db = open(':memory:');
    try {
        migrate(db, migrations.filter(m => m.version <= 22));
        const offers = createOfferStore(db), searches = createDiscoverySearchStore(db, offers);
        searches.begin({ id: 's', importKey: 'i', phrase: 'React', boards: ['justjoin'], filters: { minimum: 20000, contracts: ['b2b'] }, rowCount: 1 });
        searches.append({ id: 's', importKey: 'i', offset: 0, items: [fixture('x')] });
        searches.finish({ id: 's', importKey: 'i' });
        db.prepare("INSERT INTO offer_notes VALUES('x','private',1,1)").run();
        migrate(db);
        let time = 100;
        const store = createOfferQueryStore(db, () => time);
        assert.match(store.document('s').draftSql, /EXISTS/);
        assert.equal(store.document('s').originalFilters.minimum, 20000);
        const s = await store.capture('s', { kind: 'search', searchId: 's' });
        const old = (db.prepare('SELECT evidence_id FROM offer_query_members WHERE snapshot_id=?').get(s.id) as {
            evidence_id: string;
        }).evidence_id;
        searches.refreshOffer({ ...offers.get('x')!, text: 'Changed' }, { offerId: 'x', status: 'idle', updatedAt: 1 } as Parameters<typeof searches.refreshOffer>[1]);
        store.gc();
        assert.ok(db.prepare('SELECT 1 FROM discovery_offer_evidence WHERE id=?').get(old));
        time += 2 * 86400000;
        store.gc();
        assert.equal(db.prepare('SELECT 1 FROM discovery_offer_evidence WHERE id=?').get(old), undefined);
        assert.equal((db.prepare('SELECT text FROM offer_notes').get() as {
            text: string;
        }).text, 'private');
        assert.deepEqual(db.pragma('foreign_key_check'), []);
    }
    finally {
        db.close();
    }
});
test('cancellation ends expensive native SQL and allows next query', integration, async () => { const h = setup(); try {
    seed(h, 's', 100);
    const ctx = await h.offerQueries.context('s', { kind: 'search', searchId: 's' });
    const request = { ownerSearchId: 's', requestId: randomUUID(), scope: { kind: 'search', searchId: 's' }, schemaVersion: 1, expectedScopeRevision: ctx.scopeRevision, snapshotId: ctx.snapshotId, sql: 'SELECT sum(length(a.offer_id)+length(b.offer_id)+length(c.offer_id)+length(d.offer_id)) FROM offers a,offers b,offers c,offers d' };
    const { executionId } = h.offerQueries.start(request);
    while (h.offerQueries.get('s', executionId).state !== 'running') {
        const r = h.offerQueries.get('s', executionId);
        assert.ok(['queued', 'capturing'].includes(r.state), JSON.stringify(r));
        await delay(5);
    }
    const began = performance.now();
    assert.equal((await h.offerQueries.cancel('s', executionId)).state, 'cancelled');
    assert.ok(performance.now() - began < 1000);
    const next = await execute(h, 'SELECT count(*) FROM offers');
    assert.equal(next.state, 'succeeded', JSON.stringify(next));
}
finally {
    h.close();
} });
test('restart preserves successful pages and marks unfinished work interrupted', integration, async () => { const dir = mkdtempSync(join(tmpdir(), 'query-restart-')); let h = setup(join(dir, 'db')); try {
    seed(h);
    const good = await execute(h, 'SELECT o.offer_id FROM offers o');
    h.close();
    const db = open(join(dir, 'db'));
    db.prepare("UPDATE offer_query_executions SET state='running' WHERE id=?").run(good.executionId);
    db.close();
    h = setup(join(dir, 'db'));
    assert.equal(h.offerQueries.get('s', good.executionId).state, 'interrupted');
    const next = await execute(h, 'SELECT o.offer_id FROM offers o');
    h.close();
    h = setup(join(dir, 'db'));
    assert.equal(h.offerQueries.page('s', next.executionId, undefined, 100).rows.length, 3);
}
finally {
    h.close();
    rmSync(dir, { recursive: true, force: true });
} });
test('dispatcher exposes typed query endpoints and rejects cross-owner use', integration, async () => { const h = setup(); try {
    seed(h);
    const dispatch = createDispatch(h);
    assert.equal((await dispatch('offers.query.schema', {})).ok, true);
    const r = await dispatch('offers.query.context', { ownerSearchId: 's', scope: { kind: 'search', searchId: 's' } });
    assert.equal(r.ok, true);
    assert.equal((await dispatch('offers.query.get', { ownerSearchId: 's', executionId: 'missing' })).ok, false);
}
finally {
    h.close();
} });
test('analysis-only evidence changes keep public fingerprints; published changes invalidate them', integration, async () => {
    const h = setup();
    try {
        seed(h);
        const before = await h.offerQueries.context('s', { kind: 'search', searchId: 's' });
        const offer = h.offers.get('s-0')!;
        h.discoverySearches.refreshOffer({ ...offer, analysis: { ...offer.analysis, team: 'AI-only' }, company: 'AI-only' }, { offerId: offer.id, status: 'succeeded', updatedAt: 123, analyzedAt: 123 } as Parameters<typeof h.discoverySearches.refreshOffer>[1]);
        const after = await h.offerQueries.context('s', { kind: 'search', searchId: 's' });
        assert.equal(after.scopeRevision, before.scopeRevision);
        h.discoverySearches.refreshOffer({ ...offer, stated: { ...offer.stated, company: 'Changed published' } }, { offerId: offer.id, status: 'idle', updatedAt: 123 } as Parameters<typeof h.discoverySearches.refreshOffer>[1]);
        const changed = await h.offerQueries.context('s', { kind: 'search', searchId: 's' });
        assert.notEqual(changed.scopeRevision, before.scopeRevision);
        const started = h.offerQueries.start({ ownerSearchId: 's', requestId: randomUUID(), scope: { kind: 'search', searchId: 's' }, schemaVersion: 1, expectedScopeRevision: before.scopeRevision, sql: 'SELECT 1' });
        while (['queued', 'capturing', 'running'].includes(h.offerQueries.get('s', started.executionId).state))
            await delay(5);
        assert.equal(h.offerQueries.get('s', started.executionId).error?.code, 'query_scope_conflict');
    }
    finally {
        h.close();
    }
});
test('legacy filter translation preserves published interval/alternative matching and excludes AI fallback', integration, async () => {
    const h = setup();
    try {
        const identity = { id: 's', importKey: 'i' };
        h.discoverySearches.begin({ ...identity, phrase: 'React', boards: ['justjoin'], filters: { minimum: 21000, maximum: 23000, contracts: ['b2b'], currency: 'PLN', period: 'month' }, rowCount: 2 });
        const published = fixture('p');
        const ai = { offer: { id: 'ai', text: 'No stated salary', board: 'justjoin', salaryReading: { min: 22000, max: 23000, currency: 'PLN', period: 'month' }, contractType: 'B2B', analysis: { salary: '22000 PLN/month', contract_type: 'B2B' } } };
        h.discoverySearches.append({ ...identity, offset: 0, items: [published, ai] });
        h.discoverySearches.finish(identity);
        const old = h.discoverySearches.read({ id: 's', filtered: true, limit: 100 }).items.map(x => x.offer.id);
        assert.deepEqual(old.sort(), ['ai', 'p']);
        const d = h.offerQueries.document('s');
        const r = await execute(h, d.draftSql, undefined, undefined, d.params);
        assert.equal(r.state, 'succeeded', JSON.stringify(r));
        assert.deepEqual(h.offerQueries.page('s', r.executionId, undefined, 100).references.map(x => x.offerId), ['p']);
    }
    finally {
        h.close();
    }
});
test('catalogue chooses latest captured evidence and excludes non-Discover offers', integration, async () => {
    const h = setup();
    try {
        seed(h);
        h.offers.sight([{ id: 'private-board-only', text: 'Do not query' }], 1);
        const identity = { id: 'other', importKey: 'i' };
        h.discoverySearches.begin({ ...identity, phrase: 'React', boards: ['justjoin'], filters: {}, rowCount: 1 });
        h.discoverySearches.append({ ...identity, offset: 0, items: [fixture('s-0', 'New public title')] });
        h.discoverySearches.finish(identity);
        const r = await execute(h, 'SELECT o.offer_id,o.role FROM offers o ORDER BY o.offer_id', { kind: 'catalogue' });
        assert.equal(r.state, 'succeeded', JSON.stringify(r));
        const page = h.offerQueries.page('s', r.executionId, undefined, 100);
        assert.equal(page.rows.length, 3);
        assert.equal(page.rows[0]?.[1], 'New public title');
    }
    finally {
        h.close();
    }
});
test('row cap is explicit and capped or joined results cannot become an offer scope', integration, async () => { const h = setup(); try {
    seed(h, 's', 25);
    const r = await execute(h, 'SELECT a.offer_id FROM offers a,offers b,offers c');
    assert.equal(r.state, 'succeeded', JSON.stringify(r));
    assert.equal(r.returnedRowCount, 10000);
    assert.equal(r.result?.truncated, true);
    await assert.rejects(h.offerQueries.context('s', { kind: 'result', executionId: r.executionId }), { code: 'query_scope_not_offers' });
}
finally {
    h.close();
} });
test('allowed expensive sorting is stopped by resource limits without starving the host', integration, async () => { const h = setup(); try {
    seed(h, 's', 100);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    try {
        const r = await execute(h, 'SELECT a.description || b.description || c.description || d.description AS huge FROM offers a,offers b,offers c,offers d ORDER BY huge');
        assert.equal(r.state, 'failed', JSON.stringify(r));
        assert.ok(['query_memory_limit', 'query_timeout'].includes(r.error?.code ?? ''), JSON.stringify(r));
        assert.ok(ticks > 5);
    }
    finally {
        clearInterval(timer);
    }
}
finally {
    h.close();
} });
test('unreferenced result expiry retains idempotency tombstones and historical evidence pins', integration, async () => {
    const db = open(':memory:');
    try {
        migrate(db);
        const offers = createOfferStore(db), searches = createDiscoverySearchStore(db, offers);
        searches.begin({ id: 's', importKey: 'i', phrase: 'React', boards: ['justjoin'], filters: {}, rowCount: 1 });
        searches.append({ id: 's', importKey: 'i', offset: 0, items: [fixture('x')] });
        searches.finish({ id: 's', importKey: 'i' });
        let at = 1;
        const store = createOfferQueryStore(db, () => at);
        const snapshot = await store.capture('s', { kind: 'search', searchId: 's' });
        const request = { ownerSearchId: 's', requestId: 'r', origin: 'chat' as const, schemaVersion: 1 as const, scope: { kind: 'search' as const, searchId: 's' }, expectedScopeRevision: snapshot.fingerprint, sql: 'SELECT 1', params: [] };
        const { execution } = store.insert(request);
        store.status(execution.executionId, 'running', snapshot.id);
        store.complete(execution.executionId, { columns: [], rows: [[1]], bytes: 3, truncated: false, identityIndex: null }, { captureMs: 0, projectionMs: 0, queueMs: 0, sqlMs: 0, totalMs: 0, rssKiB: 0, datasetCacheHit: false, resultCacheHit: false });
        assert.ok(db.prepare("SELECT 1 FROM offer_query_pins WHERE execution_id=? AND pin='client'").get(execution.executionId));
        store.release('s',execution.executionId);
        assert.equal(db.prepare("SELECT 1 FROM offer_query_pins WHERE execution_id=? AND pin='client'").get(execution.executionId),undefined);
        at += 2 * 86400000;
        store.gc();
        assert.equal(store.get('s', execution.executionId).state, 'expired');
        assert.throws(() => store.prior(request), { code: 'query_scope_expired' });
        assert.equal(db.prepare('SELECT 1 FROM offer_query_pages').get(), undefined);
    }
    finally {
        db.close();
    }
});
test('editor concurrency is bounded and queued chat work cancels without changing prior results', integration, async () => { const h = setup(); try {
    seed(h, 's', 50);
    const ctx = await h.offerQueries.context('s', { kind: 'search', searchId: 's' });
    const base = { ownerSearchId: 's', scope: { kind: 'search', searchId: 's' }, schemaVersion: 1, expectedScopeRevision: ctx.scopeRevision, snapshotId: ctx.snapshotId, sql: 'SELECT sum(length(a.offer_id)+length(b.offer_id)+length(c.offer_id)+length(d.offer_id)) FROM offers a,offers b,offers c,offers d' };
    const first = h.offerQueries.start({ ...base, requestId: 'one' });
    assert.throws(() => h.offerQueries.start({ ...base, requestId: 'two' }), { code: 'query_capacity_exceeded' });
    const queued = h.offerQueries.start({ ...base, requestId: 'chat', origin: 'chat' });
    assert.equal((await h.offerQueries.cancel('s', queued.executionId)).state, 'cancelled');
    await h.offerQueries.cancel('s', first.executionId);
    assert.equal((await execute(h, 'SELECT 1')).state, 'succeeded');
}
finally {
    h.close();
} });
test('oversized single projection fails explicitly before IPC transfer', integration, async () => { const db = open(':memory:'); try {
    migrate(db);
    const offers = createOfferStore(db), searches = createDiscoverySearchStore(db, offers);
    offers.sight([{ id: 'huge', text: '' }], 1);
    searches.create('s', 'React', ['justjoin']);
    const value = JSON.stringify({ offer: { id: 'huge', text: 'Published', stated: { required_skills: Array.from({ length: 400 }, (_, i) => `${i}-${'x'.repeat(9000)}`) } } });
    db.prepare('INSERT INTO discovery_offer_evidence VALUES(?,?,?)').run('huge-evidence', 'huge', value);
    db.prepare('INSERT INTO discovery_search_members VALUES(?,?,?,?)').run('s', 'huge', 0, 'huge-evidence');
    const store = createOfferQueryStore(db);
    await assert.rejects(store.capture('s', { kind: 'search', searchId: 's' }), { code: 'query_capacity_exceeded' });
    assert.equal(db.prepare('SELECT 1 FROM offer_query_snapshots').get(), undefined);
}
finally {
    db.close();
} });

test('invalid SQL preserves the existing read-only dataset cache',integration,async()=>{const h=setup();try{seed(h);assert.equal((await execute(h,'SELECT 1')).state,'succeeded');assert.equal((await execute(h,'SELECT missing FROM offers')).state,'failed');const next=await execute(h,'SELECT 2');assert.equal(next.state,'succeeded',JSON.stringify(next));assert.equal(next.timing?.datasetCacheHit,true);}finally{h.close();}});


test('new unfiltered search documents use the same default as the editor', () => {
    const h = setup();
    try {
        seed(h);
        assert.equal(h.offerQueries.document('s').draftSql, defaultOfferSql);
    } finally { h.close(); }
});
