import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { descriptorSchema, connectionsSchema, snapshotSchema, sourceSchema } from './index.mjs';
import { signSnapshot, verifySnapshot, sourceKey, cacheKey } from './node.mjs';

const pair = generateKeyPairSync('ed25519');
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeys = { signing: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
const now = Date.parse('2026-09-28T12:00:00Z');
const scope = { categories: ['science'], markets: ['CA', 'NZ'] };
const source = {
  id: 'lab_roles', label: 'Laboratory roles', website: 'https://jobs.example', hosts: ['jobs.example'],
  categories: ['science'], markets: ['CA'], revision: 'recipe-1', modes: ['external-link'], defaultSelected: false,
  routes: { listing: 'https://jobs.example/search', offerPathPrefix: '/jobs/', search: { kind: 'query', parameter: 'q' } },
  presentation: { attribution: [{ text: 'Provided by Example' }] }, limitations: [],
  health: { status: 'unverified', detail: 'Synthetic fixture', checkedAt: null, lastSuccessAt: null, environment: 'fixture', recipeRevision: 'recipe-1' },
};
const snapshot = (providerId = 'independent.example') => ({ protocol: 'job-integrations', schemaVersion: 2, providerId, scope,
  releaseSequence: 1, revision: 'release-1', publishedAt: new Date(now).toISOString(), validUntil: new Date(now + 86400000).toISOString(),
  refreshAfterSeconds: 300, sources: [structuredClone(source)], revokedRecipes: [] });
const connection = { id: 'research', providerId: 'independent.example', name: 'Independent research provider', resolveUrl: 'https://registry.example/resolve',
  authentication: 'none', publicKeys, scope, enabled: true, priority: 10 };

test('neutral schemas accept unfamiliar identities, scopes and anonymous or bearer connections', () => {
  assert.equal(snapshotSchema.parse(snapshot()).sources[0].id, 'lab_roles');
  assert.equal(connectionsSchema.parse([connection])[0].authentication, 'none');
  assert.equal(connectionsSchema.parse([{ ...connection, authentication: 'bearer', credentialRef: 'RESEARCH_TOKEN' }])[0].credentialRef, 'RESEARCH_TOKEN');
  assert.throws(() => connectionsSchema.parse([{ ...connection, authentication: 'bearer' }]));
  assert.throws(() => connectionsSchema.parse([{ ...connection, credentialRef: 'UNEXPECTED_TOKEN' }]));
  assert.throws(() => connectionsSchema.parse([connection, connection]));
  assert.throws(() => sourceSchema.parse({ ...source, script: 'execute code' }));
  assert.throws(() => sourceSchema.parse({ ...source, routes: { ...source.routes, listing: 'https://other.example/search' } }));
  assert.throws(() => snapshotSchema.parse({ ...snapshot(), sources: [source, source] }));
  assert.throws(() => snapshotSchema.parse({ ...snapshot(), scope: { categories: ['finance'], markets: [] } }));
});

test('verification binds exact signature, provider identity, scope and validity to explicit trust', () => {
  const sealed = signSnapshot(snapshot(), privateKey, 'signing');
  const trusted = { providerId: connection.providerId, publicKeys, scope, now };
  assert.equal(verifySnapshot(sealed, trusted).providerId, connection.providerId);
  assert.throws(() => verifySnapshot(sealed, { ...trusted, providerId: 'other.example' }));
  assert.throws(() => verifySnapshot(sealed, { ...trusted, scope: { categories: [], markets: [] } }));
  assert.throws(() => verifySnapshot(sealed, { ...trusted, publicKeys: {} }));
  assert.throws(() => verifySnapshot({ ...sealed, payloadBase64: Buffer.from('{}').toString('base64') }, trusted));
  assert.throws(() => verifySnapshot(sealed, { ...trusted, now: now + 86400000 }));
  assert.equal(verifySnapshot(sealed, { ...trusted, now: now + 86400000, allowExpired: true }).revision, 'release-1');
  const advertised = descriptorSchema.parse({ protocol: 'job-integrations', schemaVersion: 2, providerId: 'other.example',
    name: 'Untrusted advertisement', website: 'https://other.example', resolveUrl: 'https://other.example/resolve',
    authentication: 'none', capabilities: ['external-link'], scope, signing: { algorithm: 'Ed25519', publicKeys } });
  assert.throws(() => verifySnapshot(signSnapshot(snapshot(advertised.providerId), privateKey, 'signing'), trusted));
});

test('local source keys and cache bindings isolate providers even when source IDs and key IDs overlap', () => {
  assert.notEqual(sourceKey('first', 'jobs'), sourceKey('second', 'jobs'));
  assert.equal(sourceKey('first', 'jobs'), sourceKey('first', 'jobs'));
  assert.match(sourceKey('first', 'jobs'), /^[a-z][a-z0-9_-]{0,63}$/);
  for (const change of [{ id: 'other' }, { providerId: 'other.example' }, { resolveUrl: 'https://other.example/resolve' }, { scope: { categories: [], markets: [] } }, { publicKeys: { rotated: publicKeys.signing } }]) {
    assert.notEqual(cacheKey(connection), cacheKey({ ...connection, ...change }));
  }
  assert.equal(cacheKey(connection), cacheKey({ ...connection, scope: { ...scope, markets: [...scope.markets].reverse() } }));
});
