import { planPageSearch } from '@cvitae/job-pages';
import { createHash } from 'node:crypto';
import type { DiscoverySource, DiscoveryBoard } from '../contracts/discovery.js';
import { OperationError } from '../contracts/operation-error.js';
import type { IntegrationProviders, ScopedIntegration } from './integration-providers.js';
import { executionFor, connectionEnabled } from './integration-execution.js';
import { createDiscoveryTransport, discoveryDescriptors, discoveryOutcome } from './discovery-wire.js';

type Pin = { source: ScopedIntegration; keyword: string; pageSize: number; cursor: string; expiresAt: number };
export function createIntegrationDiscovery(providers: IntegrationProviders, options: {url?: string; token?: string; fetch?: typeof globalThis.fetch; now?: () => number} = {}): DiscoverySource {
  const now = options.now ?? Date.now, read = createDiscoveryTransport(options);
  let resolved: Awaited<ReturnType<IntegrationProviders['resolve']>> = { providers: [], sources: [] };
  let automatic = new Set<string>();
  const pins = new Map<string, Pin>();
  const refresh = async (signal: AbortSignal) => { resolved = await providers.resolve(signal); };
  const current = (key: string) => resolved.sources.find(source => source.key === key);
  const allowed = (source: ScopedIntegration) => {
    const latest = current(source.key);
    const provider = resolved.providers.find(provider => provider.connectionId === source.reference.connectionId);
    return connectionEnabled(providers, source) && !!latest && Date.parse(source.validUntil) > now() && Date.parse(latest.validUntil) > now()
      && latest.source.health.status !== 'drift' && !provider?.snapshot?.revokedRecipes.some(recipe => recipe.sourceId === source.reference.sourceId && recipe.revision === source.source.revision);
  };
  const validateBoard = (key: string) => {
    const source = current(key);
    if (!source || !allowed(source) || !automatic.has(key)) throw new OperationError('unsupported_source', 'This provider integration is unavailable, withdrawn or unsupported by the local collector.');
  };
  return {
    validateBoard, requestCost: (_id, cursor) => cursor ? 1 : 10,
    async boards(signal) {
      await refresh(signal);
      let supported: string[] = [], reason: string | undefined = resolved.sources.length ? undefined : 'No enabled provider supplies sources. Configure a provider to discover new offers; saved offers remain available.';
      if (resolved.sources.some(source => source.source.recipe || source.source.detailRecipe)) try {
        const response = await read('/v1/discovery/boards', signal), parsed = discoveryDescriptors.safeParse(response.body);
        supported = response.ok && parsed.success && parsed.data.recipeBinding === 'provider-source-v1' ? parsed.data.recipeEngines ?? [] : [];
        if (!supported.length) reason = 'Update the local collector to support provider-scoped recipes.';
      } catch { signal.throwIfAborted(); reason = 'The local collector is unavailable. Browser searches and saved offers remain available.'; }
      automatic = new Set();
      const boards: DiscoveryBoard[] = resolved.sources.map(source => {
        const definition = source.source, enabled = !!definition.recipe && supported.includes(definition.recipe.kind) && allowed(source);
        if (enabled) automatic.add(source.key);
        const local = { support: 'local', stage: 'runtime', detail: 'Evaluated against captured published evidence.' } as const;
        const providerName = resolved.providers.find(provider => provider.connectionId === source.reference.connectionId)!.name;
        return { id: source.key, label: definition.label, presentation: definition.presentation, integration: { ...source.reference, providerName }, markets: definition.markets,
          enabled, visible: true, defaultSelected: definition.defaultSelected, searchAction: definition.recipe ? 'collect' : 'browser',
          browserSearch: { enabled: allowed(source), hosts: definition.hosts },
          searchMode: definition.recipe?.kind === 'sitemap-v1' ? 'slug' : 'board', pagination: 'snapshot', coverage: definition.recipe?.kind === 'sitemap-v1' ? 'sitemap' : 'paginated', detail: !!definition.detailRecipe && supported.includes(definition.detailRecipe.kind),
          ...(definition.recipe ? { adapterId: definition.recipe.kind, adapterVersion: definition.revision } : {}),
          filters: { keyword: { support: definition.recipe?.kind === 'sitemap-v1' ? 'local' : definition.recipe ? 'native' : 'unknown', stage: 'source', detail: definition.recipe?.kind === 'sitemap-v1' ? 'Matches URL slugs only; titles are provisional until details are fetched.' : 'Search is defined by the selected provider integration.' },
            matchMode: local, activity: local, maxPublishedAgeDays: local, workMode: local }, limitations: definition.limitations,
          ...(!enabled && definition.recipe ? { unavailableReason: reason ?? 'The provider withdrew this integration.' } : {}),
        };
      });
      return { version: 1, boards, ...(reason ? { collectionUnavailableReason: reason } : {}) };
    },
    async browserSearch(key, keyword, signal) {
      await refresh(signal);
      const source = current(key);
      if (!source || !allowed(source) || keyword.length > 300) throw new OperationError('unsupported_source', 'This provider integration is unavailable.');
      if(source.source.browserRecipe?.kind==='page-listing-v1') return {...planPageSearch(source.source.browserRecipe,keyword),board:key};
      const route = source.source.routes, url = new URL(route.listing), query = keyword.trim();
      if (route.search.kind === 'query') url.searchParams.set(route.search.parameter!, query);
      return { version: 1, board: key, query, url: url.href, filters: [],
        unmappedTerms: route.search.kind === 'browse' && query ? [query] : [], needsReview: route.search.kind === 'browse' && !!query };
    },
    async search(query, signal) {
      try {
        await refresh(signal); validateBoard(query.board);
        for (const [key, pin] of pins) if (pin.expiresAt <= now()) pins.delete(key);
        const saved = query.cursor ? pins.get(query.cursor) : undefined;
        if (query.cursor && (!saved || saved.source.key !== query.board || saved.keyword !== query.keyword || saved.pageSize !== query.pageSize)) return { status: 'expired_cursor', detail: 'This continuation belongs to an expired or different integration search.', requestCount: 0 };
        const source = saved?.source ?? current(query.board)!;
        if (!allowed(source) || !source.source.recipe) return { status: 'unsupported', detail: 'The pinned provider recipe expired or was withdrawn.', requestCount: 0 };
        const integration = executionFor(source, source.source.recipe.kind);
        const acquisitionSignal = AbortSignal.any([signal, providers.signal(source.reference.connectionId)!]);
        const response = await read('/v1/discovery/recipes/search', acquisitionSignal, { ...query, cursor: saved?.cursor,
          recipe: integration.recipe, validUntil: source.validUntil,
          binding: { connectionId: source.reference.connectionId, sourceId: source.reference.sourceId } });
        signal.throwIfAborted();
        if (!allowed(source)) return { status: 'unsupported', detail: 'The provider connection was disabled or withdrawn during collection.', requestCount: query.requestLimit ?? 10 };
        const parsed = discoveryOutcome.safeParse(response.body);
        if (!parsed.success || parsed.data.status === 'ok' && !response.ok) return { status: 'error', detail: 'Invalid provider recipe response from the local collector.' };
        if (parsed.data.status !== 'ok') return parsed.data;
        const data = parsed.data.data;
        if (data.board !== query.board || data.items.length > query.pageSize || (data.requestCount ?? 0) > (query.requestLimit ?? 10) || data.items.some(item => {
          const url = new URL(item.url);
          return item.board !== query.board || url.protocol !== 'https:' || !!url.username || !!url.password || !!url.port || !source.source.hosts.includes(url.hostname);
        })) return { status: 'error', detail: 'The collector returned data outside the pinned integration or its request allowance.' };
        let nextCursor: string | null = null;
        if (data.nextCursor) {
          nextCursor = createHash('sha256').update(JSON.stringify([source.key, integration.provenance, source.validUntil, query.keyword, query.pageSize, data.nextCursor])).digest('hex');
          while (pins.size >= 400) pins.delete(pins.keys().next().value!);
          pins.set(nextCursor, { source: structuredClone(source), keyword: query.keyword, pageSize: query.pageSize, cursor: data.nextCursor,
            expiresAt: Math.min(saved?.expiresAt ?? now() + 30 * 60000, Date.parse(data.expiresAt), Date.parse(source.validUntil)) });
        }
        return { status: 'ok', data: { ...data, nextCursor, integration, items: data.items.map(item => ({ ...item, provenance: integration.provenance })) } };
      } catch (error) {
        signal.throwIfAborted();
        return { status: error instanceof OperationError && error.code === 'unsupported_source' ? 'unsupported' : 'unavailable', detail: error instanceof OperationError ? error.message : 'Provider collection is unavailable. Saved offers remain available.' };
      }
    },
  };
}
