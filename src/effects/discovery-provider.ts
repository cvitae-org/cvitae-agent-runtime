import { embeddedJsonRecipeSchema } from '@cvitae/job-pages/recipes';
import { createPublicKey, verify } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationError } from '../contracts/operation-error.js';
import { discoveryBoardIdSchema } from '../contracts/discovery-board.js';

const text = z.string().min(1).max(2000);
const host = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/)
  .refine(value => !/\.(local|localhost|internal)$/.test(value));
const publicUrl = z.string().url().max(4000).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && host.safeParse(url.hostname).success;
});
const source = z.object({ id: discoveryBoardIdSchema, label: text, hosts: z.array(host).min(1).max(10),
  revision: text, modes: z.array(z.enum(['installed-adapter', 'external-link', 'http-json-v1', 'embedded-json-v1'])).min(1).max(4), adapterId: discoveryBoardIdSchema.nullable(),
  defaultSelected: z.boolean().optional(),
  routes: z.object({ listing: publicUrl, offerPathPrefix: z.string().startsWith('/').nullable(),
    search: z.object({ kind: z.enum(['query', 'installed-adapter', 'browse']), parameter: z.string().min(1).max(100).nullable() }).strict(),
  }).strict().optional(),
  browserRecipe: embeddedJsonRecipeSchema.optional(),
  recipe: z.object({ kind: text, sourceId: discoveryBoardIdSchema, revision: text, hosts: z.array(host).min(1).max(10) }).passthrough().optional(),
  health: z.object({ status: z.enum(['unverified', 'validated', 'empty', 'reachable', 'blocked', 'rate-limited', 'drift', 'unavailable', 'not-probed']), detail: text }),
  limitations: z.array(text).max(30),
}).superRefine((source, context) => {
  if (source.routes && (!source.hosts.includes(new URL(source.routes.listing).hostname) || source.routes.search.kind === 'query' && !source.routes.search.parameter)) context.addIssue({ code: 'custom', message: 'Invalid browser search route' });
  if (source.modes.includes('embedded-json-v1') !== !!source.browserRecipe || source.browserRecipe && (source.browserRecipe.sourceId !== source.id || source.browserRecipe.revision !== source.revision || source.browserRecipe.hosts.some(host => !source.hosts.includes(host)))) context.addIssue({ code: 'custom', message: 'Browser recipe identity or hosts differ from source registration' });
  if (source.modes.includes('http-json-v1') !== !!source.recipe || source.recipe && (source.recipe.sourceId !== source.id || source.recipe.revision !== source.revision || source.recipe.hosts.some(host => !source.hosts.includes(host)))) {
    context.addIssue({ code: 'custom', message: 'Recipe identity or hosts differ from source registration' });
  }
});
const snapshot = z.object({ schemaVersion: z.literal(1), providerId: z.literal('jobboards.info'),
  scope: z.object({ categories: z.array(z.literal('it')).length(1), markets: z.array(z.enum(['PL', 'remote'])).length(2) }),
  releaseSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), revision: text,
  publishedAt: z.string().datetime(), validUntil: z.string().datetime(), refreshAfterSeconds: z.number().int().min(300).max(86400),
  sources: z.array(source).max(32), revokedRecipes: z.array(z.object({ sourceId: discoveryBoardIdSchema, revision: text })).max(100),
});
const envelope = z.object({ algorithm: z.literal('Ed25519'), keyId: discoveryBoardIdSchema,
  payloadBase64: z.string().min(1).max(2_000_000), signatureBase64: z.string().min(1).max(128),
}).strict();
export type ProviderSnapshot = z.infer<typeof snapshot>;
export type DiscoveryProvider = { resolve(signal: AbortSignal): Promise<ProviderSnapshot> };
export type ProviderOptions = { url: string; token: string; publicKeys: Record<string, string>; cachePath: string;
  fetch?: typeof globalThis.fetch; now?: () => number };

export function verifyProviderEnvelope(raw: unknown, keys: Record<string, string>, now: number, allowExpired = false): ProviderSnapshot {
  const value = envelope.parse(raw);
  if (!Object.hasOwn(keys, value.keyId)) throw new Error('Unknown signing key');
  const key = createPublicKey(keys[value.keyId]!);
  const bytes = Buffer.from(value.payloadBase64, 'base64'), signature = Buffer.from(value.signatureBase64, 'base64');
  if (bytes.toString('base64') !== value.payloadBase64 || signature.toString('base64') !== value.signatureBase64 || signature.length !== 64
    || key.asymmetricKeyType !== 'ed25519' || !verify(null, bytes, key, signature)) throw new Error('Invalid signature');
  const data = snapshot.parse(JSON.parse(bytes.toString('utf8')) as unknown);
  const start = Date.parse(data.publishedAt), end = Date.parse(data.validUntil);
  if (end <= start || end - start > 14 * 86400000 || start > now + 300000 || (!allowExpired && end <= now)
    || new Set(data.sources.map(entry => entry.id)).size !== data.sources.length
    || new Set(data.scope.markets).size !== 2) throw new Error('Invalid registry validity or scope');
  return data;
}

async function readBody(response: Response): Promise<unknown> {
  if (!response.ok || !response.headers.get('content-type')?.includes('json') || !response.body) throw new Error('Invalid response');
  const reader = response.body.getReader(), chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 2_100_000) throw new Error('Registry too large');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { await reader.cancel().catch(() => {}); }
}

export function createDiscoveryProvider(options: ProviderOptions): DiscoveryProvider {
  const url = new URL(options.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !host.safeParse(url.hostname).success
    || !/^[A-Za-z0-9_-]{32,256}$/.test(options.token) || !isAbsolute(options.cachePath)) throw new OperationError('misconfigured', 'Invalid jobboards.info registry configuration.');
  const now = options.now ?? Date.now, request = options.fetch ?? globalThis.fetch;
  let cached: ProviderSnapshot | undefined, checkedAt = 0, initialized = false, pending: Promise<ProviderSnapshot> | undefined;
  let retryAfter = 0;
  async function resolve(): Promise<ProviderSnapshot> {
    if (!initialized) {
      initialized = true;
      try {
        if ((await stat(options.cachePath)).size > 2_100_000) throw new Error('Oversized cache');
        const raw: unknown = JSON.parse(await readFile(options.cachePath, 'utf8'));
        cached = verifyProviderEnvelope(raw, options.publicKeys, now(), true);
        // Refresh after process restart to learn revocations. The old signature
        // is still verified before it can serve as an outage fallback.
      } catch { /* Missing or invalid caches cannot authorize collection. */ }
    }
    if (cached && Date.parse(cached.validUntil) > now() && (now() - checkedAt < cached.refreshAfterSeconds * 1000 || now() < retryAfter)) return cached;
    try {
      const raw = await readBody(await request(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` },
        body: JSON.stringify({ schemaVersion: 1, client: { id: 'cvitae-studio', version: '0.1.0' }, capabilities: ['installed-adapter', 'http-json-v1', 'embedded-json-v1'],
          scope: { categories: ['it'], markets: ['PL', 'remote'] }, knownRevision: cached?.revision ?? null }),
      }));
      const next = verifyProviderEnvelope(raw, options.publicKeys, now());
      if (cached && (next.releaseSequence < cached.releaseSequence || next.releaseSequence === cached.releaseSequence && next.revision !== cached.revision)) throw new Error('Registry rollback');
      // Persist before activation so restart retains the anti-rollback baseline.
      await mkdir(dirname(options.cachePath), { recursive: true, mode: 0o700 });
      const temporary = `${options.cachePath}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(raw), { mode: 0o600, flag: 'wx' }); await rename(temporary, options.cachePath); }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
      cached = next; checkedAt = now(); retryAfter = 0;
      return next;
    } catch {
      retryAfter = now() + 60000;
      if (cached && Date.parse(cached.validUntil) > now()) return cached;
      throw new OperationError('unavailable', 'The integration registry is unavailable or expired. Saved offers remain available.');
    }
  }
  return { async resolve(signal) {
    signal.throwIfAborted();
    pending ??= resolve().finally(() => { pending = undefined; });
    const result = await pending; signal.throwIfAborted(); return result;
  } };
}

export function configuredDiscoveryProvider(): DiscoveryProvider | undefined {
  if (!process.env.JOBBOARDS_REGISTRY_URL) return undefined;
  // Defer config validation until discovery runs so unrelated app work remains
  // available even when a deployment has incomplete registry settings.
  let provider: DiscoveryProvider | undefined;
  return { async resolve(signal) {
    if (!provider) {
      try {
        provider = createDiscoveryProvider({ url: process.env.JOBBOARDS_REGISTRY_URL!, token: process.env.JOBBOARDS_REGISTRY_TOKEN ?? '',
          publicKeys: z.record(discoveryBoardIdSchema, text).parse(JSON.parse(process.env.JOBBOARDS_REGISTRY_PUBLIC_KEYS ?? '{}') as unknown),
          cachePath: process.env.JOBBOARDS_REGISTRY_CACHE_PATH ?? '' });
      } catch { throw new OperationError('misconfigured', 'Configure the registry URL, read token, trusted public keys and cache path.'); }
    }
    return provider.resolve(signal);
  } };
}
