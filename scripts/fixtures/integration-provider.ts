import { generateKeyPairSync } from 'node:crypto';
import { snapshotSchema, httpJsonRecipeSchema, embeddedJsonRecipeSchema } from '../../vendor/integration-protocol/index.mjs';
import { signSnapshot } from '../../vendor/integration-protocol/node.mjs';
import type { IntegrationConnection } from '../../src/effects/integration-providers.js';

export const httpRecipe = httpJsonRecipeSchema.parse({ kind: 'http-json-v1', sourceId: 'jobs', revision: 'recipe-1', hosts: ['jobs.example'],
  request: { url: 'https://jobs.example/api', query: { q: { input: 'keyword' }, page: { input: 'page' } } }, itemsPointer: '/jobs',
  pagination: { pagePointer: '/page', totalPagesPointer: '/pages', startPage: 0, maxPages: 2 },
  fields: { title: { pointer: '/title', operation: 'text', required: true }, url: { pointer: '/url', operation: 'url', required: true }, external_id: { pointer: '/id', operation: 'text', required: true } } });
export const browserRecipe = embeddedJsonRecipeSchema.parse({ kind: 'embedded-json-v1', sourceId: 'jobs', revision: 'recipe-1', hosts: ['jobs.example'],
  listing: { path: '/find', pageParameter: 'page', keywordParameter: 'q' },
  embedded: { scriptId: 'DATA', items: '/jobs', page: '/page', pages: '/pages', keywords: '/keywords' },
  fields: { id: '/id', title: '/title', company: '/company', location: { items: '/locations', value: '/name' }, skills: '/skills',
    postedAt: '/postedAt', assumeUTC: false, workModes: '/modes', workModeValues: {} },
  offer: { pathPrefix: '/offer/', slug: '/slug', idSuffix: '-id-', idFormat: 'uuid' },
  salaries: { items: '/salaries', min: '/min', max: '/max', currencies: ['/currency'], period: '/period', contractId: '/contractId', contractName: '/contractName', tax: ['/tax'],
    contractValues: {}, contractAliases: {}, currencyValues: {}, periodValues: {} } });
export function fixtureProvider(id: string, now: number, browser = false) {
  const pair = generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const connection: IntegrationConnection = { id, providerId: `${id}.example`, name: `${id} provider`, resolveUrl: `https://${id}.example/resolve`, authentication: 'none',
    publicKeys: { signing: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, scope: { categories: ['science'], markets: ['CA'] }, enabled: true, priority: 10 };
  let snapshot = snapshotSchema.parse({ protocol: 'job-integrations', schemaVersion: 2, providerId: connection.providerId, scope: connection.scope,
    releaseSequence: 1, revision: 'release-1', publishedAt: new Date(now).toISOString(), validUntil: new Date(now + 3600000).toISOString(), refreshAfterSeconds: 300, revokedRecipes: [],
    sources: [{ id: 'jobs', label: `${id} Jobs`, website: 'https://jobs.example', hosts: ['jobs.example'], categories: ['science'], markets: ['CA'], revision: 'recipe-1',
      modes: ['external-link', browser ? 'embedded-json-v1' : 'http-json-v1'], defaultSelected: true,
      routes: { listing: 'https://jobs.example/find', offerPathPrefix: '/offer/', search: { kind: 'query', parameter: 'q' } },
      ...(browser ? { browserRecipe } : { recipe: httpRecipe }), presentation: { attribution: [] }, limitations: [],
      health: { status: 'validated', detail: 'Synthetic fixture', checkedAt: new Date(now).toISOString(), lastSuccessAt: new Date(now).toISOString(), environment: 'fixture', recipeRevision: 'recipe-1' } }] });
  return { connection, get snapshot() { return snapshot; }, set snapshot(value: typeof snapshot) { snapshot = snapshotSchema.parse(value); },
    seal: () => signSnapshot(snapshot, privateKey, 'signing') };
}
