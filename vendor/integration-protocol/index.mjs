import { pageListingRecipeSchema } from './page-listing.mjs';
import { z } from 'zod';
import { httpJsonRecipeSchema } from './http-json.mjs';
import { embeddedJsonRecipeSchema } from './embedded-json.mjs';
import { domListingRecipeSchema, domDetailRecipeSchema } from './dom.mjs';
import { semanticDetailRecipeSchema } from './semantic-dom.mjs';
import { sitemapRecipeSchema } from './sitemap.mjs';
export { pageListingRecipeSchema, httpJsonRecipeSchema, embeddedJsonRecipeSchema, domListingRecipeSchema, domDetailRecipeSchema, sitemapRecipeSchema, semanticDetailRecipeSchema };

export const protocol = 'job-integrations';
export const sourceIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const providerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const text = z.string().min(1).max(2000);
const tag = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
/** @template {z.ZodType} T @param {T} schema */
const unique = schema => z.array(schema).max(128).refine(values => new Set(values).size === values.length, 'Duplicate values');
export const hostSchema = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/)
  .refine(value => !/\.(local|localhost|internal)$/.test(value));
export const publicUrlSchema = z.string().url().max(4000).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && hostSchema.safeParse(url.hostname).success;
}, 'Expected a public HTTPS URL');
export const scopeSchema = z.object({ categories: unique(tag), markets: unique(tag) }).strict();
export const publicKeysSchema = z.record(sourceIdSchema, z.string().min(1).max(4096))
  .refine(keys => Object.keys(keys).length >= 1 && Object.keys(keys).length <= 8);
export const descriptorSchema = z.object({
  protocol: z.literal(protocol), schemaVersion: z.literal(2), providerId: providerIdSchema,
  name: text, website: publicUrlSchema, resolveUrl: publicUrlSchema,
  authentication: z.enum(['none', 'bearer']), capabilities: unique(tag), scope: scopeSchema,
  signing: z.object({ algorithm: z.literal('Ed25519'), publicKeys: publicKeysSchema }).strict(),
}).strict();
export const resolveSchema = z.object({
  protocol: z.literal(protocol), schemaVersion: z.literal(2),
  client: z.object({ id: sourceIdSchema, version: text }).strict(), capabilities: unique(tag),
  scope: scopeSchema, knownRevision: text.nullable().default(null),
}).strict();
export const healthSchema = z.object({
  status: z.enum(['unverified', 'validated', 'empty', 'reachable', 'blocked', 'rate-limited', 'drift', 'unavailable', 'not-probed']),
  detail: text, checkedAt: z.iso.datetime().nullable(), lastSuccessAt: z.iso.datetime().nullable(),
  environment: tag, recipeRevision: text,
}).strict();
const asset = z.object({ url: publicUrlSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.enum(['image/png', 'image/webp']), byteLength: z.number().int().positive().max(200000) }).strict();
export const sourceSchema = z.object({
  id: sourceIdSchema, label: text, website: publicUrlSchema, hosts: unique(hostSchema).refine(hosts => hosts.length > 0 && hosts.length <= 10),
  categories: unique(tag), markets: unique(tag), revision: text,
  modes: unique(z.enum(['external-link', 'http-json-v1', 'embedded-json-v1', 'dom-listing-v1', 'dom-detail-v1', 'dom-detail-v2', 'page-listing-v1', 'sitemap-v1'])).refine(modes => modes.length > 0),
  defaultSelected: z.boolean(),
  routes: z.object({ listing: publicUrlSchema, offerPathPrefix: z.string().startsWith('/').max(1000).nullable(),
    search: z.object({ kind: z.enum(['query', 'browse']), parameter: tag.nullable() }).strict(),
  }).strict(),
  recipe: z.union([httpJsonRecipeSchema, domListingRecipeSchema, pageListingRecipeSchema, sitemapRecipeSchema]).optional(),
  browserRecipe: z.union([embeddedJsonRecipeSchema, domListingRecipeSchema, pageListingRecipeSchema]).optional(), detailRecipe: z.union([domDetailRecipeSchema, semanticDetailRecipeSchema]).optional(),
  routing: z.array(z.object({host:hostSchema,kind:z.enum(['board','ats','social','directory'])}).strict()).max(200).optional(),
  presentation: z.object({ icon: asset.optional(), attribution: z.array(z.object({ text, url: publicUrlSchema.optional() }).strict()).max(10) }).strict(),
  health: healthSchema, limitations: z.array(text).max(30),
}).strict().superRefine((source, context) => {
  for (const url of [source.website, source.routes.listing]) if (!source.hosts.includes(new URL(url).hostname)) context.addIssue({ code: 'custom', message: 'Source routes must use declared hosts' });
  if (source.routes.search.kind === 'query' && !source.routes.search.parameter) context.addIssue({ code: 'custom', message: 'Query routes require a parameter' });
  const recipes = [source.recipe, source.browserRecipe, source.detailRecipe].filter(Boolean);
  for (const kind of ['http-json-v1', 'embedded-json-v1', 'dom-listing-v1', 'dom-detail-v1', 'dom-detail-v2', 'page-listing-v1', 'sitemap-v1']) {
    if (source.modes.includes(kind) !== recipes.some(recipe => recipe.kind === kind)) context.addIssue({ code: 'custom', message: 'Every engine capability requires a recipe' });
  }
  if (source.recipe && source.browserRecipe && source.recipe.kind === source.browserRecipe.kind && JSON.stringify(source.recipe) !== JSON.stringify(source.browserRecipe)) context.addIssue({ code: 'custom', message: 'HTTP and browser DOM listing recipes must agree' });
  for (const field of ['recipe', 'browserRecipe', 'detailRecipe']) {
    const recipe = source[field];
    if (recipe && (recipe.sourceId !== source.id || recipe.revision !== source.revision || recipe.hosts.some(host => !source.hosts.includes(host)))) {
      context.addIssue({ code: 'custom', message: 'Recipe identity, revision, capability and hosts must match the source' });
    }
  }
  if (source.health.recipeRevision !== source.revision) context.addIssue({ code: 'custom', message: 'Health must refer to the current recipe revision' });
});
export const snapshotSchema = z.object({
  protocol: z.literal(protocol), schemaVersion: z.literal(2), providerId: providerIdSchema, scope: scopeSchema,
  releaseSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), revision: text,
  publishedAt: z.iso.datetime(), validUntil: z.iso.datetime(), refreshAfterSeconds: z.number().int().min(300).max(86400),
  sources: z.array(sourceSchema).max(128), revokedRecipes: z.array(z.object({ sourceId: sourceIdSchema, revision: text }).strict()).max(1000),
}).strict().superRefine((snapshot, context) => {
  if (new Set(snapshot.sources.map(source => source.id)).size !== snapshot.sources.length) context.addIssue({ code: 'custom', message: 'Duplicate source IDs' });
  const ttl = Date.parse(snapshot.validUntil) - Date.parse(snapshot.publishedAt);
  if (ttl <= 0 || ttl > 14 * 86400000) context.addIssue({ code: 'custom', message: 'Invalid validity period' });
  for (const source of snapshot.sources) for (const field of ['categories', 'markets']) {
    if (snapshot.scope[field].length && !source[field].some(value => snapshot.scope[field].includes(value))) context.addIssue({ code: 'custom', message: 'Source is outside the requested scope' });
  }
});
export const envelopeSchema = z.object({ algorithm: z.literal('Ed25519'), keyId: sourceIdSchema,
  payloadBase64: z.string().min(1).max(4000000), signatureBase64: z.string().min(1).max(128) }).strict();

export const connectionSchema = z.object({
  id: sourceIdSchema, providerId: providerIdSchema, name: text, resolveUrl: publicUrlSchema,
  authentication: z.enum(['none', 'bearer']), credentialRef: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/).optional(),
  publicKeys: publicKeysSchema, scope: scopeSchema, enabled: z.boolean(), priority: z.number().int().min(0).max(10000),
}).strict().superRefine((connection, context) => {
  if (connection.authentication === 'bearer' && !connection.credentialRef || connection.authentication === 'none' && connection.credentialRef) context.addIssue({ code: 'custom', message: 'Credential reference must match authentication mode' });
});
export const connectionsSchema = z.array(connectionSchema).max(16)
  .refine(connections => new Set(connections.map(connection => connection.id)).size === connections.length, 'Duplicate local connection IDs');
