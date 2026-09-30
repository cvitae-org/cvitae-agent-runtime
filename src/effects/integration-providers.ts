import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { z } from 'zod';
import { connectionsSchema, connectionSchema } from '../../vendor/integration-protocol/index.mjs';
import { cacheKey, sourceKey, verifySnapshot } from '../../vendor/integration-protocol/node.mjs';
import { OperationError } from '../contracts/operation-error.js';

export type IntegrationConnection = z.infer<typeof connectionSchema>;
export type IntegrationSnapshot = ReturnType<typeof verifySnapshot>;
export type IntegrationSource = IntegrationSnapshot['sources'][number];
export type ProviderResolution = {
  connectionId: string; providerId: string; name: string;
  status: 'ready' | 'cached' | 'unavailable' | 'disabled';
  snapshot?: IntegrationSnapshot; detail?: string;
};
export type SourceReference = { connectionId: string; providerId: string; sourceId: string };
export type ScopedIntegration = { generation?: number; key: string; reference: SourceReference; source: IntegrationSource; validUntil: string; releaseSequence: number; releaseRevision: string };
export type IntegrationClientOptions = {
  cacheDirectory: string; resolveCredential?: (reference: string) => string | undefined | Promise<string | undefined>;
  fetch?: typeof globalThis.fetch; now?: () => number;
};
export const integrationCapabilities = ['http-json-v1', 'embedded-json-v1', 'external-link', 'host-routing-v1', 'dom-listing-v1', 'dom-detail-v1', 'page-listing-v1', 'dom-detail-v2', 'sitemap-v1'];
const limit = 4_100_000;

async function readBody(response: Response): Promise<unknown> {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('json')) throw new Error('Invalid provider response');
  const reader = response.body.getReader(), chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Provider response exceeds the size limit');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { await reader.cancel().catch(() => {}); }
}

export function createIntegrationClient(raw: IntegrationConnection, options: IntegrationClientOptions) {
  const connection = connectionSchema.parse(raw);
  if (!isAbsolute(options.cacheDirectory)) throw new OperationError('misconfigured', 'Provider cache directory must be absolute.');
  const now = options.now ?? Date.now, request = options.fetch ?? globalThis.fetch;
  const cachePath = join(options.cacheDirectory, `${cacheKey(connection)}.json`);
  let cached: IntegrationSnapshot | undefined, loaded = false, checkedAt = 0, retryAfter = 0;
  let pending: Promise<ProviderResolution> | undefined;
  const lifetime = new AbortController();
  const result = (status: ProviderResolution['status'], detail?: string): ProviderResolution => ({
    connectionId: connection.id, providerId: connection.providerId, name: connection.name, status,
    ...(cached && ['ready', 'cached'].includes(status) ? { snapshot: structuredClone(cached) } : {}), ...(detail ? { detail } : {}),
  });
  const trusted = (allowExpired = false) => ({ providerId: connection.providerId, publicKeys: connection.publicKeys, scope: connection.scope, now: now(), allowExpired });
  async function refresh(force: boolean): Promise<ProviderResolution> {
    if (!loaded) {
      loaded = true;
      try {
        if ((await stat(cachePath)).size > limit) throw new Error('Cache too large');
        cached = verifySnapshot(JSON.parse(await readFile(cachePath, 'utf8')) as unknown, trusted(true));
      } catch { /* Unverified caches never authorize collection. */ }
    }
    lifetime.signal.throwIfAborted();
    if (!force) {
      if (retryAfter > now()) return cached && Date.parse(cached.validUntil) > now()
        ? result('cached', 'Provider refresh failed; using a verified unexpired release.')
        : result('unavailable', 'Provider unavailable, untrusted, expired or missing credentials. Saved offers remain available.');
      if (cached && Date.parse(cached.validUntil) > now() && checkedAt && now() - checkedAt < cached.refreshAfterSeconds * 1000) return result('ready');
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (connection.authentication === 'bearer') {
        const token = await options.resolveCredential?.(connection.credentialRef!);
        if (!token || token.length > 4096 || !/^[-._~+/A-Za-z0-9]+=*$/.test(token)) throw new Error('Credential unavailable');
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await request(connection.resolveUrl, { method: 'POST', redirect: 'error', headers,
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]),
        body: JSON.stringify({ protocol: 'job-integrations', schemaVersion: 2,
          client: { id: 'cvitae-studio', version: '0.1.0' }, capabilities: integrationCapabilities,
          scope: connection.scope, knownRevision: cached?.revision ?? null }),
      });
      const raw = await readBody(response), next = verifySnapshot(raw, trusted());
      if (cached && (next.releaseSequence < cached.releaseSequence || next.releaseSequence === cached.releaseSequence && next.revision !== cached.revision)) throw new Error('Provider release rollback');
      lifetime.signal.throwIfAborted();
      await mkdir(options.cacheDirectory, { recursive: true, mode: 0o700 });
      const temporary = `${cachePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(raw), { mode: 0o600, flag: 'wx' });
        lifetime.signal.throwIfAborted();
        await rename(temporary, cachePath);
      } finally { await rm(temporary, { force: true }).catch(() => {}); }
      cached = next; checkedAt = now(); retryAfter = 0;
      return result('ready');
    } catch {
      lifetime.signal.throwIfAborted();
      retryAfter = now() + 60000;
      return cached && Date.parse(cached.validUntil) > now()
        ? result('cached', 'Provider refresh failed; using a verified unexpired release.')
        : result('unavailable', 'Provider unavailable, untrusted, expired or missing credentials. Saved offers remain available.');
    }
  }
  return {
    connection: structuredClone(connection),
    signal: lifetime.signal as AbortSignal,
    async resolve(signal: AbortSignal, force = false): Promise<ProviderResolution> {
      signal.throwIfAborted(); lifetime.signal.throwIfAborted();
      if (!connection.enabled) return result('disabled');
      pending ??= refresh(force).finally(() => { pending = undefined; });
      const value = await pending;
      signal.throwIfAborted(); lifetime.signal.throwIfAborted();
      return structuredClone(value);
    },
    close() { lifetime.abort(); },
    async purge() { lifetime.abort(); await pending?.catch(() => {}); await rm(cachePath, {force:true}); },
  };
}

export type IntegrationProviders = ReturnType<typeof createIntegrationProviders>;
export function createIntegrationProviders(raw: IntegrationConnection[], options: IntegrationClientOptions) {
  const initial = connectionsSchema.parse(raw);
  const clients = new Map(initial.map(connection => [connection.id, createIntegrationClient(connection, options)]));
  const purges = new Map<string, Promise<void>>();
  const states = new Map<string, ProviderResolution>();
  const generations = new Map(initial.map(item => [item.id, 0]));
  const connections = () => [...clients.values()].map(client => client.connection).sort((a,b) => a.priority-b.priority || a.id.localeCompare(b.id));
  return {
    connections: () => structuredClone(connections()),
    generation: (id: string) => generations.get(id),
    signal: (id: string): AbortSignal | undefined => clients.get(id)?.signal,
    status: (id: string) => structuredClone(states.get(id)),
    async resolveConnection(id: string, signal: AbortSignal, force = false): Promise<ProviderResolution> {
      const client = clients.get(id);
      if (!client) throw new OperationError('unsupported_source', 'Integration provider is not configured.');
      const result = await client.resolve(signal, force);
      if(clients.get(id)!==client) throw new OperationError('unsupported_source','Provider configuration changed.');
      states.set(id,result); return result;
    },
    async resolve(signal: AbortSignal, force = false) {
      signal.throwIfAborted();
      const active = connections();
      const batchGenerations = new Map(active.map(item => [item.id, generations.get(item.id)]));
      const settled = await Promise.allSettled(active.map(connection => this.resolveConnection(connection.id, signal, force)));
      signal.throwIfAborted();
      const providers: ProviderResolution[] = settled.map((value, index) => value.status === 'fulfilled' ? value.value : {
        connectionId: active[index]!.id, providerId: active[index]!.providerId, name: active[index]!.name,
        status: 'unavailable', detail: 'Provider refresh failed. Other providers remain available.',
      });
      const sources: ScopedIntegration[] = [];
      for (const provider of providers) for (const source of provider.snapshot?.sources ?? []) sources.push({
        generation: batchGenerations.get(provider.connectionId),
        key: sourceKey(provider.connectionId, source.id), reference: { connectionId: provider.connectionId, providerId: provider.providerId, sourceId: source.id },
        source, validUntil: provider.snapshot!.validUntil, releaseSequence: provider.snapshot!.releaseSequence, releaseRevision: provider.snapshot!.revision,
      });
      if (new Set(sources.map(source => source.key)).size !== sources.length) throw new OperationError('invalid_response', 'Integration source identity collision.');
      return { providers, sources };
    },
    upsert(raw: IntegrationConnection) {
      const connection=connectionSchema.parse(raw), previous=clients.get(connection.id);
      if(previous && previous.connection.providerId!==connection.providerId) throw new OperationError('misconfigured','A different provider requires a new connection.');
      connectionsSchema.parse([...connections().filter(item=>item.id!==connection.id),connection]);
      const next=createIntegrationClient(connection,options);
      previous?.close();
      if (previous && cacheKey(previous.connection) !== cacheKey(connection)) {
        const prior = purges.get(connection.id);
        purges.set(connection.id, (prior ?? Promise.resolve()).then(() => previous.purge()).catch(() => {}));
      }
      clients.set(connection.id,next); states.delete(connection.id);
      generations.set(connection.id, (generations.get(connection.id) ?? 0) + 1);
    },
    setEnabled(id: string, enabled: boolean) {
      const existing=clients.get(id);
      if(!existing)throw new OperationError('unsupported_source','Integration provider is not configured.');
      this.upsert({...existing.connection,enabled});
    },
    remove(id: string) {
      const client=clients.get(id); client?.close(); clients.delete(id); states.delete(id); generations.delete(id);
      if(client) { const prior=purges.get(id); purges.set(id,(prior??Promise.resolve()).then(()=>client.purge()).catch(()=>{})); }
    },
    async purge(id: string) { await purges.get(id); purges.delete(id); },
    close() { for (const client of clients.values()) client.close(); },
  };
}

export function configuredIntegrationProviders(env: Record<string, string | undefined> = process.env): IntegrationProviders {
  if (env.INTEGRATION_PROVIDERS_JSON === undefined) return createIntegrationProviders([], {cacheDirectory:''});
  try {
    const connections = connectionsSchema.parse(JSON.parse(env.INTEGRATION_PROVIDERS_JSON) as unknown);
    if(!connections.length) return createIntegrationProviders([], {cacheDirectory:''});
    const directory = env.INTEGRATION_PROVIDERS_CACHE_DIR;
    if (!directory || !isAbsolute(directory)) throw new Error('Missing cache directory');
    return createIntegrationProviders(connections, { cacheDirectory: directory, resolveCredential: reference => env[reference] });
  } catch { throw new OperationError('misconfigured', 'Configure integration providers, trusted keys, credential references and an absolute cache directory.'); }
}
