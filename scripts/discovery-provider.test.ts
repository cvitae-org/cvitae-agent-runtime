import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyProviderEnvelope, createDiscoveryProvider, type ProviderSnapshot } from '../src/effects/discovery-provider.js';
import { createDiscoverySource } from '../src/effects/discovery.js';

const pair = generateKeyPairSync('ed25519');
const publicKeys = { test: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
const token = 'r'.repeat(40), scraperToken = 's'.repeat(40);
const scope = { categories: ['it'], markets: ['PL', 'remote'] };
const definition = { id: 'fixture_jobs', label: 'Remote registry label', hosts: ['jobs.example'], revision: 'recipe-1',
  modes: ['installed-adapter'], adapterId: 'fixture_jobs', health: { status: 'validated', detail: 'Fixture only' }, limitations: ['Provider limitation'] };
const payload = (now: number, sequence = 1) => ({ schemaVersion: 1, providerId: 'jobboards.info', scope,
  releaseSequence: sequence, revision: `release-${sequence}`, publishedAt: new Date(now).toISOString(), validUntil: new Date(now + 2 * 86400000).toISOString(),
  refreshAfterSeconds: 300, sources: [definition], revokedRecipes: [] });
const seal = (data: unknown) => {
  const bytes = Buffer.from(JSON.stringify(data));
  return { algorithm: 'Ed25519', keyId: 'test', payloadBase64: bytes.toString('base64'), signatureBase64: sign(null, bytes, pair.privateKey).toString('base64') };
};
const controller = () => new AbortController().signal;

test('provider POST is scoped, coalesced and caches only signed metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'discovery-registry-'));
  try {
    let calls = 0; const now = Date.now(), cachePath = join(dir, 'registry.json');
    const provider = createDiscoveryProvider({ url: 'https://registry.example/resolve', token, publicKeys, cachePath, now: () => now,
      fetch: (async (_url, options) => {
        calls++; assert.equal(options?.redirect, 'error'); assert.equal(options?.method, 'POST');
        assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
        const body = JSON.parse(options?.body as string) as Record<string, unknown>;
        assert.deepEqual(body.scope, scope); assert.equal(body.keyword, undefined);
        return Response.json(seal(payload(now)));
      }) as typeof fetch });
    const values = await Promise.all([provider.resolve(controller()), provider.resolve(controller())]);
    assert.equal(calls, 1); assert.equal(values[0]?.sources[0]?.label, definition.label);
    await provider.resolve(controller()); assert.equal(calls, 1);
    const disk = await readFile(cachePath, 'utf8'); assert.ok(!disk.includes(token)); assert.ok(disk.includes('signatureBase64'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('restart survives provider outage; expired cache cannot authorize collection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'discovery-registry-'));
  try {
    let now = Date.now(); const start = now;
    const options = { url: 'https://registry.example/resolve', token, publicKeys, cachePath: join(dir, 'registry.json'), now: () => now };
    await createDiscoveryProvider({ ...options, fetch: (async () => Response.json(seal(payload(now)))) as typeof fetch }).resolve(controller());
    const offline = createDiscoveryProvider({ ...options, fetch: (async () => { throw new Error('offline'); }) as typeof fetch });
    assert.equal((await offline.resolve(controller())).releaseSequence, 1);
    now = start + 2 * 86400000;
    await assert.rejects(offline.resolve(controller()), /unavailable or expired/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tampered or rolled-back responses cannot replace the durable last good release', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'discovery-registry-'));
  try {
    let now = Date.now(); const start = now; let mode = 'valid';
    const cachePath = join(dir, 'registry.json');
    const provider = createDiscoveryProvider({ url: 'https://registry.example/resolve', token, publicKeys, cachePath, now: () => now,
      fetch: (async () => {
        const response = seal(payload(start, mode === 'rollback' ? 1 : 2));
        if (mode === 'tampered') response.payloadBase64 = Buffer.from('{}').toString('base64');
        return Response.json(response);
      }) as typeof fetch });
    await provider.resolve(controller()); const original = await readFile(cachePath, 'utf8');
    for (const value of ['tampered', 'rollback']) {
      mode = value; now += 301000;
      assert.equal((await provider.resolve(controller())).releaseSequence, 2);
      assert.equal(await readFile(cachePath, 'utf8'), original);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('signed metadata authorizes the installed adapter and validates listing hosts without leaking credentials', async () => {
  const now = Date.now();
  const provider = { resolve: async () => payload(now) as ProviderSnapshot };
  const filter = { support: 'native', stage: 'source', detail: 'fixture' };
  const board = { id: definition.id, label: 'Installed label', enabled: true, searchMode: 'board', pagination: 'snapshot', coverage: 'first-page', detail: false,
    filters: Object.fromEntries(['keyword', 'matchMode', 'activity', 'maxPublishedAgeDays', 'workMode'].map(id => [id, filter])), limitations: [] };
  let badHost = false;
  const source = createDiscoverySource({ provider,
    token: scraperToken, registrations: [], fetch: (async (url, options) => {
      assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${scraperToken}`);
      return Response.json(String(url).endsWith('/boards') ? { version: 1, boards: [board] } : { status: 'ok', data: {
        version: 1, board: definition.id, items: [{ board: definition.id, title: 'React', titleSource: 'board', url: badHost ? 'https://elsewhere.example/job' : 'https://jobs.example/job' }],
        nextCursor: null, hasMore: false, coverage: 'first-page', retrievedAt: new Date(now).toISOString(), expiresAt: new Date(now + 100000).toISOString(), effectiveFilters: [], unsupportedFilters: [], limitations: [],
      } });
    }) as typeof fetch });
  assert.throws(() => source.validateBoard?.(definition.id), /registry/);
  const boards = await source.boards(controller());
  assert.equal(boards.boards[0]?.label, definition.label); assert.equal(boards.boards[0]?.enabled, true);
  const query = { board: definition.id, keyword: 'react', pageSize: 30 };
  assert.equal((await source.search(query, controller())).status, 'ok');
  badHost = true; assert.equal((await source.search(query, controller())).status, 'error');
});

test('a configured registry failure does not silently fall back to bundled registrations', async () => {
  const source = createDiscoverySource({ token: scraperToken, provider: { resolve: async () => { throw new Error('offline'); } },
    fetch: (async () => { assert.fail('Scraper must not be consulted after registry failure'); }) as typeof fetch });
  await assert.rejects(source.boards(controller()));
  assert.throws(() => source.validateBoard?.('justjoin'));
});

test('recipes enable new sources without adapters, pin continuations, and stop on withdrawal', async () => {
  const now = Date.now();
  const recipe = { kind: 'http-json-v1', sourceId: definition.id, revision: 'recipe-1', hosts: definition.hosts, fields: { title: '/title' } };
  let current = { ...payload(now), sources: [{ ...definition, modes: ['http-json-v1'], adapterId: null, recipe }] } as ProviderSnapshot;
  let engines = ['http-json-v1']; const received: Record<string, unknown>[] = [];
  const source = createDiscoverySource({ token: scraperToken, registrations: [], provider: { resolve: async () => current },
    fetch: (async (url, options) => {
      if (String(url).endsWith('/boards')) return Response.json({ version: 1, recipeEngines: engines, boards: [] });
      assert.ok(String(url).endsWith('/recipes/search'));
      const body = JSON.parse(options?.body as string) as Record<string, unknown>; received.push(body);
      return Response.json({ status: 'ok', data: { version: 1, board: definition.id, items: [], nextCursor: `pinned-${(body.recipe as typeof recipe).revision}`, hasMore: true,
        requestCount: body.cursor ? 0 : 2, sourceExhausted: false, coverage: 'paginated', retrievedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 100000).toISOString(), effectiveFilters: [], unsupportedFilters: [], limitations: [] } });
    }) as typeof fetch });
  assert.equal((await source.boards(controller())).boards[0]?.enabled, true);
  assert.equal(source.requestCost?.(definition.id), 10);
  const query = { board: definition.id, keyword: 'C++', pageSize: 1, requestLimit: 3 };
  assert.equal((await source.search(query, controller())).status, 'ok');
  current = { ...current, sources: [{ ...current.sources[0]!, revision: 'recipe-2', recipe: { ...recipe, revision: 'recipe-2' } }] };
  await source.boards(controller());
  assert.equal((await source.search({ ...query, cursor: 'pinned-recipe-1' }, controller())).status, 'ok');
  assert.equal((received.at(-1)?.recipe as typeof recipe).revision, 'recipe-1');
  assert.equal((await source.search(query, controller())).status, 'ok');
  assert.equal((received.at(-1)?.recipe as typeof recipe).revision, 'recipe-2');
  assert.equal((await source.search({ ...query, cursor: 'unknown' }, controller())).status, 'expired_cursor');
  current = { ...current, revokedRecipes: [{ sourceId: definition.id, revision: 'recipe-1' }] };
  await source.boards(controller()); const before = received.length;
  assert.equal((await source.search({ ...query, cursor: 'pinned-recipe-1' }, controller())).status, 'unsupported');
  assert.equal(received.length, before);
  current = { ...current, revokedRecipes: [] }; engines = [];
  assert.equal((await source.boards(controller())).boards[0]?.enabled, false);
  assert.equal((await source.search(query, controller())).status, 'unsupported');
  assert.equal(received.length, before);
});

test('provider catalogue owns defaults, browser routes and removal even when collector is offline', async () => {
  const now = Date.now();
  const entry = { ...definition, modes: ['external-link'], adapterId: null, defaultSelected: true,
    routes: { listing: 'https://jobs.example/find?market=PL', offerPathPrefix: null, search: {kind:'query',parameter:'q'} } };
  let current = { ...payload(now), sources: [entry] } as ProviderSnapshot;
  let collectorCalls = 0;
  const client = createDiscoverySource({ token: scraperToken, provider: {resolve:async()=>current}, fetch:async()=>{
    collectorCalls++; throw new Error('offline');
  } });
  const catalogue = await client.boards(controller());
  assert.equal(catalogue.boards.length,1);
  assert.deepEqual(catalogue.boards[0]?.browserSearch,{enabled:true,hosts:['jobs.example']});
  assert.equal(catalogue.boards[0]?.searchAction,'browser');
  assert.equal(catalogue.boards[0]?.defaultSelected,true);
  assert.equal(catalogue.boards[0]?.enabled,false);
  assert.throws(()=>client.validateBoard?.(entry.id));
  const phrase='C++ / C# & .NET Łódź';
  const plan=await client.browserSearch!(entry.id,phrase,controller());
  assert.equal(new URL(plan.url).searchParams.get('q'),phrase);
  assert.equal(new URL(plan.url).searchParams.get('market'),'PL');
  assert.equal(plan.board,entry.id); assert.equal(plan.needsReview,false);
  assert.equal(collectorCalls,1,'Browser planning does not depend on the collector');
  current={...current,sources:[{...entry,routes:{...entry.routes,listing:'https://jobs.example/new',search:{kind:'query',parameter:'term'}}}]} as ProviderSnapshot;
  const updated=await client.browserSearch!(entry.id,phrase,controller());
  assert.equal(new URL(updated.url).pathname,'/new'); assert.equal(new URL(updated.url).searchParams.get('term'),phrase);
  current={...current,sources:[{...entry,routes:{...entry.routes,search:{kind:'browse',parameter:null}}}]} as ProviderSnapshot;
  const browse=await client.browserSearch!(entry.id,phrase,controller());
  assert.equal(browse.needsReview,true); assert.deepEqual(browse.unmappedTerms,[phrase]);
  current={...current,revokedRecipes:[{sourceId:entry.id,revision:entry.revision}]};
  assert.equal((await client.boards(controller())).boards[0]?.browserSearch?.enabled,false);
  await assert.rejects(client.browserSearch!(entry.id,phrase,controller()));
  current={...current,sources:[]};
  assert.deepEqual((await client.boards(controller())).boards,[]);
  await assert.rejects(client.browserSearch!(entry.id,phrase,controller()));
  await assert.rejects(client.browserSearch!('linkedin',phrase,controller()), /unavailable/);
});

test('verified browser routes reject host escape and malformed query metadata', () => {
  const now=Date.now();
  for (const listing of ['https://elsewhere.example/find','https://jobs.example:444/find','https://user@jobs.example/find','http://jobs.example/find','https://127.0.0.1/find','https://jobs.local/find','https://jobs.example/find#fragment']) {
    assert.throws(()=>verifyProviderEnvelope(seal({...payload(now),sources:[{...definition,routes:{listing,offerPathPrefix:null,search:{kind:'query',parameter:'q'}}}]}),publicKeys,now));
  }
  assert.throws(()=>verifyProviderEnvelope(seal({...payload(now),sources:[{...definition,routes:{listing:'https://jobs.example/find',offerPathPrefix:null,search:{kind:'query',parameter:null}}}]}),publicKeys,now));
});
