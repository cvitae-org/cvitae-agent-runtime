import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { signSnapshot, cacheKey } from '../vendor/integration-protocol/node.mjs';
import { createIntegrationClient, createIntegrationProviders, configuredIntegrationProviders, type IntegrationConnection } from '../src/effects/integration-providers.js';

const start = Date.parse('2026-09-28T12:00:00Z');
const scope = { categories: ['science'], markets: ['CA'] };
function identity(id: string, authentication: 'none' | 'bearer' = 'none') {
  const pair = generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const connection: IntegrationConnection = { id, providerId: `${id}.example`, name: `${id} provider`, resolveUrl: `https://${id}.example/api/resolve`,
    authentication, ...(authentication === 'bearer' ? { credentialRef: `${id.toUpperCase()}_TOKEN` } : {}),
    publicKeys: { shared: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, scope, enabled: true, priority: 10 };
  const payload = (sequence = 1, at = start, until = start + 86400000) => ({ protocol: 'job-integrations', schemaVersion: 2, providerId: connection.providerId, scope,
    releaseSequence: sequence, revision: `release-${sequence}`, publishedAt: new Date(at).toISOString(), validUntil: new Date(until).toISOString(),
    refreshAfterSeconds: 300, revokedRecipes: [], sources: [{ id: 'jobs', label: `${id} laboratory jobs`, website: 'https://jobs.example', hosts: ['jobs.example'],
      categories: ['science'], markets: ['CA'], revision: 'recipe-1', modes: ['external-link'], defaultSelected: false,
      routes: { listing: 'https://jobs.example/find', offerPathPrefix: '/offer/', search: { kind: 'query', parameter: 'q' } },
      presentation: { attribution: [] }, limitations: [], health: { status: 'validated', detail: 'Synthetic provider', checkedAt: new Date(at).toISOString(),
        lastSuccessAt: new Date(at).toISOString(), environment: 'fixture', recipeRevision: 'recipe-1' } }] });
  const seal = (value: unknown = payload()) => signSnapshot(value, privateKey, 'shared');
  return { connection, payload, seal };
}
const signal = () => new AbortController().signal;
const withCache = async (run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), 'integration-providers-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
};

test('two providers retain separate identities, source keys, credentials, sequences and signed caches', () => withCache(async directory => {
  const first = identity('first', 'bearer'), second = identity('second');
  const requests: { url: string; init?: RequestInit }[] = [];
  const resolvedReferences: string[] = [];
  const manager = createIntegrationProviders([second.connection, { ...first.connection, priority: 0 }], { cacheDirectory: directory, now: () => start,
    resolveCredential: reference => { resolvedReferences.push(reference); return 'private-token'; },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json(String(url) === first.connection.resolveUrl ? first.seal(first.payload(800)) : second.seal());
    } });
  const values = await manager.resolve(signal());
  assert.deepEqual(values.providers.map(provider => [provider.connectionId, provider.status, provider.snapshot?.releaseSequence]), [['first', 'ready', 800], ['second', 'ready', 1]]);
  assert.deepEqual(values.sources.map(source => source.reference), [{ connectionId: 'first', providerId: 'first.example', sourceId: 'jobs' }, { connectionId: 'second', providerId: 'second.example', sourceId: 'jobs' }]);
  assert.notEqual(values.sources[0]!.key, values.sources[1]!.key);
  assert.ok(values.sources.every(source => source.source.id === 'jobs'), 'Signed provider-local identity remains unchanged');
  assert.deepEqual(resolvedReferences, ['FIRST_TOKEN']);
  for (const request of requests) {
    assert.equal(request.init?.redirect, 'error');
    assert.deepEqual(JSON.parse(request.init?.body as string), { protocol: 'job-integrations', schemaVersion: 2,
      client: { id: 'cvitae-studio', version: '0.1.0' }, capabilities: ['http-json-v1', 'embedded-json-v1', 'external-link', 'host-routing-v1', 'dom-listing-v1', 'dom-detail-v1', 'page-listing-v1', 'dom-detail-v2', 'sitemap-v1'], scope, knownRevision: null });
    assert.equal((request.init?.headers as Record<string, string>).Authorization, request.url === first.connection.resolveUrl ? 'Bearer private-token' : undefined);
  }
  const files = await readdir(directory); assert.equal(files.length, 2);
  for (const file of files) {
    const content = await readFile(join(directory, file), 'utf8');
    assert.ok(content.includes('signatureBase64')); assert.ok(!content.includes('private-token'));
    assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
  }
  assert.ok(!JSON.stringify(values).includes('private-token'));
  assert.ok(!JSON.stringify(manager.connections()).includes('private-token'));
  const settings = manager.connections(); settings[0]!.enabled = false;
  values.sources[0]!.source.label = 'Mutated caller copy';
  assert.equal(manager.connections()[0]!.enabled, true);
  assert.equal((await manager.resolve(signal())).sources[0]!.source.label, 'first laboratory jobs');
  assert.equal(requests.length, 2); manager.close();
}));

test('one expired or offline provider does not disable the other; cooldown also applies without a cache', () => withCache(async directory => {
  const first = identity('first'), second = identity('second'); let now = start, firstCalls = 0, offline = true;
  const manager = createIntegrationProviders([first.connection, second.connection], { cacheDirectory: directory, now: () => now,
    fetch: async url => {
      if (String(url) === second.connection.resolveUrl) return Response.json(second.seal());
      firstCalls++; if (offline) throw new Error('offline');
      return Response.json(first.seal(first.payload(1, start, start + 120000)));
    } });
  let result = await manager.resolve(signal());
  assert.deepEqual(result.providers.map(provider => provider.status), ['unavailable', 'ready']);
  assert.deepEqual(result.sources.map(source => source.reference.connectionId), ['second']);
  await manager.resolve(signal()); assert.equal(firstCalls, 1);
  offline = false; result = await manager.resolve(signal(), true);
  assert.deepEqual(result.providers.map(provider => provider.status), ['ready', 'ready']);
  now = start + 121000; result = await manager.resolve(signal());
  assert.deepEqual(result.providers.map(provider => provider.status), ['unavailable', 'ready']);
  assert.deepEqual(result.sources.map(source => source.reference.connectionId), ['second']); manager.close();
}));

test('restart verifies caches and refuses a lower release even after the cached release expires', () => withCache(async directory => {
  const provider = identity('first'); let now = start;
  const options = { cacheDirectory: directory, now: () => now };
  const initial = createIntegrationClient(provider.connection, { ...options, fetch: async () => Response.json(provider.seal(provider.payload(20))) });
  await initial.resolve(signal()); initial.close();
  const original = await readFile(join(directory, `${cacheKey(provider.connection)}.json`), 'utf8');
  const offline = createIntegrationClient(provider.connection, { ...options, fetch: async () => { throw new Error('offline'); } });
  assert.equal((await offline.resolve(signal())).status, 'cached'); offline.close();
  now += 86401000;
  const downgraded = createIntegrationClient(provider.connection, { ...options,
    fetch: async () => Response.json(provider.seal(provider.payload(19, now, now + 86400000))) });
  const result = await downgraded.resolve(signal());
  assert.equal(result.status, 'unavailable'); assert.equal(result.snapshot, undefined);
  assert.equal(await readFile(join(directory, `${cacheKey(provider.connection)}.json`), 'utf8'), original); downgraded.close();
}));

test('same key labels cannot cross trust boundaries; identity, scope, tamper and revision conflicts preserve the last release', () => withCache(async directory => {
  const first = identity('first'), second = identity('second'); let response = first.seal(first.payload(10));
  const client = createIntegrationClient(first.connection, { cacheDirectory: directory, now: () => start, fetch: async () => Response.json(response) });
  await client.resolve(signal());
  const original = await readFile(join(directory, `${cacheKey(first.connection)}.json`), 'utf8');
  const candidates = [second.seal(), first.seal({ ...first.payload(11), providerId: second.connection.providerId }),
    first.seal({ ...first.payload(11), scope: { categories: [], markets: [] } }),
    { ...first.seal(), payloadBase64: Buffer.from('{}').toString('base64') },
    first.seal({ ...first.payload(10), revision: 'different-release' })];
  for (const candidate of candidates) {
    response = candidate; const result = await client.resolve(signal(), true);
    assert.equal(result.status, 'cached'); assert.equal(result.snapshot?.releaseSequence, 10);
    assert.equal(await readFile(join(directory, `${cacheKey(first.connection)}.json`), 'utf8'), original);
  }
  client.close();
}));

test('cache authorization cannot transfer to another connection, endpoint, scope or signing key', () => withCache(async directory => {
  const first = identity('first'), second = identity('second');
  const options = { cacheDirectory: directory, now: () => start };
  const client = createIntegrationClient(first.connection, { ...options, fetch: async () => Response.json(first.seal()) });
  await client.resolve(signal()); client.close();
  for (const change of [{ id: 'another' }, { providerId: 'another.example' }, { resolveUrl: 'https://new.example/resolve' }, { scope: { categories: [], markets: [] } }, { publicKeys: second.connection.publicKeys }]) {
    const changed = createIntegrationClient({ ...first.connection, ...change }, { ...options, fetch: async () => { throw new Error('offline'); } });
    const result = await changed.resolve(signal());
    assert.equal(result.status, 'unavailable'); assert.equal(result.snapshot, undefined); changed.close();
  }
}));

test('disable and remove stop pending authorization without affecting a second provider', () => withCache(async directory => {
  const first = identity('first'), second = identity('second');
  let announce!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  let release!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => { release = resolve; });
  let firstCalls = 0;
  const manager = createIntegrationProviders([first.connection, second.connection], { cacheDirectory: directory, now: () => start,
    fetch: async url => {
      if (String(url) === second.connection.resolveUrl) return Response.json(second.seal());
      firstCalls++; if (firstCalls === 1) { announce(); return delayed; }
      return Response.json(first.seal());
    } });
  const pending = manager.resolve(signal()); await started;
  manager.setEnabled('first', false); release(Response.json(first.seal()));
  assert.deepEqual((await pending).sources.map(source => source.reference.connectionId), ['second']);
  const disabled = await manager.resolve(signal());
  assert.equal(disabled.providers[0]?.status, 'disabled'); assert.equal(firstCalls, 1);
  manager.setEnabled('first', true);
  assert.equal((await manager.resolve(signal())).sources.length, 2);
  manager.remove('first');
  assert.deepEqual(manager.connections().map(connection => connection.id), ['second']);
  assert.deepEqual((await manager.resolve(signal())).sources.map(source => source.reference.connectionId), ['second']);
  await assert.rejects(manager.resolveConnection('first', signal())); manager.close();
}));

test('concurrent callers share refresh work but cannot mutate one another or trusted settings', () => withCache(async directory => {
  const provider = identity('first'); let calls = 0;
  const client = createIntegrationClient(provider.connection, { cacheDirectory: directory, now: () => start,
    fetch: async url => { calls++; assert.equal(url, provider.connection.resolveUrl); return Response.json(provider.seal()); } });
  client.connection.resolveUrl = 'https://wrong.example/resolve';
  const [first, second] = await Promise.all([client.resolve(signal()), client.resolve(signal())]);
  assert.equal(calls, 1);
  first.snapshot!.sources[0]!.label = 'Caller mutation';
  assert.equal(second.snapshot!.sources[0]!.label, 'first laboratory jobs');
  assert.equal((await client.resolve(signal())).snapshot!.sources[0]!.label, 'first laboratory jobs'); client.close();
}));

test('configuration has no implicit provider or secret value and rejects invalid connection settings', () => withCache(async directory => {
  const defaults=configuredIntegrationProviders({});assert.deepEqual(await defaults.resolve(signal()),{providers:[],sources:[]});defaults.close();
  const empty = configuredIntegrationProviders({ INTEGRATION_PROVIDERS_JSON: '[]', INTEGRATION_PROVIDERS_CACHE_DIR: directory });
  assert.deepEqual(await empty!.resolve(signal()), { providers: [], sources: [] }); empty!.close();
  const unconfigured=configuredIntegrationProviders({INTEGRATION_PROVIDERS_JSON:'[]'});assert.deepEqual(unconfigured.connections(),[]);unconfigured.close();
  const first = identity('first', 'bearer');
  assert.throws(() => configuredIntegrationProviders({ INTEGRATION_PROVIDERS_JSON: JSON.stringify([{ ...first.connection, token: 'secret' }]), INTEGRATION_PROVIDERS_CACHE_DIR: directory }));
  const unavailable = createIntegrationClient(first.connection, { cacheDirectory: directory, now: () => start, fetch: async () => { assert.fail('Missing credentials must not be sent'); } });
  assert.equal((await unavailable.resolve(signal())).status, 'unavailable'); unavailable.close();
}));
