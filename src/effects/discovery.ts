import { browserDescriptor, browserPlan, browserRoute } from './discovery-browser-search.js';
import { discoveryBoardIdSchema, maxDiscoveryBoards } from '../contracts/discovery-board.js';
import { discoveryRegistrations, type DiscoveryRegistration } from './discovery-registry.js';
import { configuredDiscoveryProvider, type DiscoveryProvider, type ProviderSnapshot } from './discovery-provider.js';
import { z } from 'zod';
import { publishedSalarySchema } from '../contracts/published-salary.js';
import type { DiscoverySource, DiscoveryBoard } from '../contracts/discovery.js';
import { OperationError } from '../contracts/operation-error.js';

const boardId = discoveryBoardIdSchema;
const short = z.string().max(2000);
const timestamp = z.string().datetime();
const filterId = z.enum(['keyword', 'matchMode', 'activity', 'maxPublishedAgeDays', 'workMode']);
const support = z.enum(['native', 'local', 'unsupported', 'unknown']);
const filterCapability = z.object({ support, stage: z.enum(['source', 'runtime']), detail: short });
const effectiveFilter = z.object({
  id: filterId, support, stage: z.enum(['source', 'runtime']),
  requested: z.union([z.string(), z.number(), z.null()]), applied: z.boolean(), detail: short
});
const listing = z.object({
  board: boardId, url: z.string().url().max(4000), title: short,
  titleSource: z.enum(['board', 'slug', 'unavailable']),
  external_id: short.optional(),
    description: z.string().max(500000).optional(), apply_url: z.string().url().max(4000).optional(),
    work_mode: z.enum(['remote','hybrid','onsite','unknown']).optional(), adapter_id: short.optional(), adapter_version: short.optional(), company: short.optional(), location: short.optional(),
  salary: short.optional(), contract_type: short.optional(),
  employment_type: short.optional(), company_type: short.optional(), company_size: short.optional(), engagement_length: short.optional(), valid_through: short.optional(), salary_ranges: z.array(publishedSalarySchema).max(20).optional(),
  required_skills: z.array(short).max(200).optional(), posted_at: short.optional()
});
const batch = z.object({
  version: z.literal(1), sourceExhausted: z.boolean().optional(), requestCount: z.number().int().min(0).max(10).optional(), board: boardId, items: z.array(listing).max(100),
  nextCursor: z.string().min(1).max(100).nullable(), hasMore: z.boolean(),
  coverage: z.enum(['sitemap', 'paginated', 'first-page']), retrievedAt: timestamp, expiresAt: timestamp,
  effectiveFilters: z.array(effectiveFilter).max(20), unsupportedFilters: z.array(filterId).max(20),
  limitations: z.array(short).max(30)
}).refine((value) => value.hasMore === (value.nextCursor !== null));
const descriptors = z.object({ version: z.literal(1), recipeEngines: z.array(short).max(10).optional(), boards: z.array(z.object({
  id: boardId, label: short, adapterId: short.optional(), adapterVersion: short.optional(),
  markets: z.array(short).max(100).optional(), iconKey: boardId.optional(), enabled: z.boolean(), unavailableReason: short.optional(),
  searchMode: z.enum(['slug', 'board']), pagination: z.literal('snapshot'),
  coverage: z.enum(['sitemap', 'paginated', 'first-page']), detail: z.boolean(),
  filters: z.object({ keyword: filterCapability, matchMode: filterCapability, activity: filterCapability,
    maxPublishedAgeDays: filterCapability, workMode: filterCapability }).strict(),
  limitations: z.array(short).max(30)
})).max(maxDiscoveryBoards) });
const outcome = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), data: batch }),
  z.object({ status: z.enum(['error', 'empty', 'blocked', 'disallowed', 'unsupported', 'invalid_query', 'invalid_cursor', 'expired_cursor']), detail: short, requestCount: z.number().int().min(0).max(10).optional() })
]);


export const createDiscoverySource = (options: { url?: string; token?: string; fetch?: typeof globalThis.fetch; registrations?: readonly DiscoveryRegistration[]; provider?: DiscoveryProvider } = {}): DiscoverySource => {
  const provider = options.provider ?? configuredDiscoveryProvider();
  const localPolicy = new Map((options.registrations ?? discoveryRegistrations).map(board => [board.id, board]));
  const registrations = new Map(provider ? [] : localPolicy);
  let providerSnapshot: ProviderSnapshot | undefined;
  type RecipePin = { source: ProviderSnapshot['sources'][number]; validUntil: string; expiresAt: number };
  const recipePins = new Map<string, RecipePin>();
  let available = new Map<string, boolean>();
  const workerBoards = new Set<string>();
  let advertised = false;
  let availabilityError: OperationError | undefined;
  let unavailableReasons = new Map<string, string>();
  const configured = options.url ?? process.env.SCRAPER_URL ?? 'http://127.0.0.1:8787';
  const token = (options.token ?? process.env.SCRAPER_API_TOKEN ?? '').trim();
  const base = configured.trim() ? new URL(configured) : undefined;
  if (base && (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash)) {
    throw new OperationError('misconfigured', 'Discovery scraper must be an HTTP(S) loopback service.');
  }
  const request = options.fetch ?? globalThis.fetch;
  const read = async (path: string, signal: AbortSignal, body?: unknown): Promise<{ ok: boolean; body: unknown }> => {
    if (!base) throw new OperationError('unavailable', 'The scraper is disabled. Cached search remains available.');
    if (token.length < 32) throw new OperationError('misconfigured', 'SCRAPER_API_TOKEN must contain at least 32 characters.');
    const response = await request(`${base.toString().replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Cvitae-Discovery-Registry': '2', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)])
    });
    return { ok: response.ok, body: await response.json() as unknown };
  };
  const browserHelp = (id: string) => browserCapabilities(id).enabled
    ? ' You can also open this board in Cvitae Browser and use Collect pages or Preview jobs.' : '';
  const validateBoard = (id: string): void => {
    if (provider && (!providerSnapshot || Date.parse(providerSnapshot.validUntil) <= Date.now())) {
      throw new OperationError('unavailable', 'Refresh the integration registry before collecting new offers.');
    }
    const board = registrations.get(id);
    if (!board) throw new OperationError('unsupported_source', `The source "${id}" is not registered in this runtime.`);
    if (board.refused) throw new OperationError('unsupported_source', `${board.label}: live acquisition is disabled by source policy.`);
    if (availabilityError) throw new OperationError(availabilityError.code, `${board.label}: ${availabilityError.message}${browserHelp(id)}`);
    if (!advertised && board.optIn) throw new OperationError('unavailable', `${board.label}: source availability has not been checked. Start the scraper and retry the search.${browserHelp(id)}`);
    if (available.get(id) === false || (advertised && !available.has(id))) {
      const reason = unavailableReasons.get(id) ?? 'This adapter is not available in the running scraper.';
      throw new OperationError('unsupported_source', `${board.label}: ${reason}${browserHelp(id)}`);
    }
  };
  const sourceBlocked = (source: ProviderSnapshot['sources'][number]) => source.health.status === 'drift'
    || providerSnapshot?.revokedRecipes.some(recipe => recipe.sourceId === source.id && recipe.revision === source.revision) === true;
  const browserCapabilities = (id: string) => {
    const definition = providerSnapshot?.sources.find(source => source.id === id);
    const installed = localPolicy.get(id);
    return definition ? browserDescriptor(definition, sourceBlocked(definition) ? undefined : browserRoute(definition))
      : !provider && installed ? browserDescriptor(installed, installed.browser) : { enabled: false, hosts: [] };
  };
  const refreshProvider = async (signal: AbortSignal) => {
    if (!provider) return;
    const resolved = await provider.resolve(signal);
    signal.throwIfAborted();
    if (Date.parse(resolved.validUntil) <= Date.now()) throw new OperationError('unavailable', 'The integration registry has expired.');
    providerSnapshot = resolved;
    registrations.clear();
    for (const source of resolved.sources) {
      if (!source.modes.includes('installed-adapter') && !source.recipe) continue;
      registrations.set(source.id, { id: source.id, label: source.label, hosts: source.hosts, optIn: true,
        refused: localPolicy.get(source.id)?.refused || sourceBlocked(source) });
    }
  };
  const placeholder = (id: string, label: string): DiscoveryBoard => {
    const unknown = { support: 'unknown', stage: 'runtime', detail: 'Automatic collection is not available.' } as const;
    return { id, label, enabled: false, searchMode: 'board', pagination: 'snapshot', coverage: 'first-page', detail: false,
      filters: { keyword: unknown, matchMode: unknown, activity: unknown, maxPublishedAgeDays: unknown, workMode: unknown }, limitations: [] };
  };
  return {
    requestCost: (id, cursor) => workerBoards.has(id) && !cursor ? 10 : 1,
    validateBoard,
    async browserSearch(id, keyword, signal) {
      await refreshProvider(signal);
      if (provider) {
        const source = providerSnapshot?.sources.find(source => source.id === id);
        if (!source || sourceBlocked(source)) throw new OperationError('unsupported_source', 'This browser source is unavailable or withdrawn.');
        return browserPlan(source, browserRoute(source), keyword);
      }
      const source = localPolicy.get(id);
      if (!source || source.visible === false || source.refused) throw new OperationError('unsupported_source', 'This browser source is unavailable.');
      return browserPlan(source, source.browser, keyword);
    },
    async boards(signal) {
      try {
        await refreshProvider(signal);
        let parsed: z.infer<typeof descriptors> = { version: 1, boards: [] };
        let collectorError: OperationError | undefined;
        try {
          const response = await read('/v1/discovery/boards', signal);
          const result = descriptors.safeParse(response.body);
          if (!response.ok || !result.success) throw new OperationError('invalid_response', 'Unsupported discovery board response.');
          if (new Set(result.data.boards.map(board => board.id)).size !== result.data.boards.length) throw new OperationError('invalid_response', 'Duplicate board IDs.');
          parsed = result.data;
        } catch (error) {
          signal.throwIfAborted();
          collectorError = error instanceof OperationError ? error : new OperationError('unavailable', 'The local collector could not be reached. Browser searches and saved offers remain available.');
        }
        const candidates: DiscoveryBoard[] = parsed.boards.filter(board => !provider || providerSnapshot?.sources.some(source => source.id === board.id));
        const definitions = providerSnapshot?.sources ?? [...localPolicy.values()].filter(source => collectorError || source.browser);
        for (const source of definitions) if (!candidates.some(board => board.id === source.id)) {
          const board = placeholder(source.id, source.label);
          const definition = providerSnapshot?.sources.find(value => value.id === source.id);
          if (definition?.recipe && !collectorError) {
            const local = { support: 'local', stage: 'runtime', detail: 'Evaluated against captured published evidence.' } as const;
            Object.assign(board, { enabled: true, coverage: 'paginated',
              filters: { keyword: { support: 'native', stage: 'source', detail: 'Keyword applied through the verified recipe.' }, matchMode: local, activity: local, maxPublishedAgeDays: local,
                workMode: { support: 'unsupported', stage: 'runtime', detail: 'Work mode is available for local result filtering.' } } });
          }
          candidates.push(board);
        }
        const boards = candidates.map(board => {
          const installed = registrations.get(board.id);
          const definition = providerSnapshot?.sources.find(source => source.id === board.id);
          const policy = localPolicy.get(board.id);
          const compatible = definition?.recipe ? definition.recipe.kind === 'http-json-v1' && parsed.recipeEngines?.includes('http-json-v1') === true
            : !definition || definition.adapterId === (board.adapterId ?? board.id);
          return { ...board, ...(definition ? { label: definition.label, limitations: [...board.limitations, ...definition.limitations].slice(0, 30) } : {}),
            ...(definition?.recipe ? { adapterId: definition.recipe.kind, adapterVersion: definition.revision, detail: false, coverage: 'paginated' as const } : {}),
            visible: provider ? true : !!policy && policy.visible !== false,
            defaultSelected: (provider ? definition?.defaultSelected : policy?.defaultSelected) === true,
            searchAction: (definition ? !definition.recipe && !definition.modes.includes('installed-adapter') : policy?.browserOnly) ? 'browser' as const : 'collect' as const,
            browserSearch: browserCapabilities(board.id),
            enabled: !collectorError && !(definition ? !definition.recipe && !definition.modes.includes('installed-adapter') : policy?.browserOnly) && board.enabled && !!installed && !installed.refused && compatible,
            ...(collectorError ? { unavailableReason: collectorError.message } : !installed ? { unavailableReason: 'Automatic collection is not available for this source.' } :
              installed.refused ? { unavailableReason: 'Live acquisition is disabled by source policy or registry validation.' } :
              !compatible ? { unavailableReason: 'Update the local collector to support this registry recipe or adapter.' } : {}) };
        });
        workerBoards.clear();
        for (const board of boards) if (['jobspy', 'solidjobs-api', 'bulldogjob-html', 'theprotocol-html', 'http-json-v1'].includes(board.adapterId ?? '')) workerBoards.add(board.id);
        available = new Map(boards.map(board => [board.id, board.enabled]));
        unavailableReasons = new Map(boards.flatMap(board => board.unavailableReason ? [[board.id, board.unavailableReason] as const] : []));
        advertised = true; availabilityError = collectorError;
        return { version: 1, boards, ...(collectorError ? { collectionUnavailableReason: collectorError.message } : {}) };
      } catch (error) {
        available.clear(); workerBoards.clear(); unavailableReasons.clear(); advertised = false;
        availabilityError = error instanceof OperationError ? error : new OperationError('unavailable', 'The integration registry could not be refreshed. Saved offers remain available.');
        throw availabilityError;
      }
    },
    async search(query, signal) {
      try {
        try { validateBoard(query.board); }
        catch (error) { if (error instanceof OperationError) return {status: error.code === 'unsupported_source' ? 'unsupported' : 'unavailable', detail: error.message}; throw error; }
        const installed = registrations.get(query.board)!;
        for (const [cursor, pin] of recipePins) if (pin.expiresAt <= Date.now()) recipePins.delete(cursor);
        const current = providerSnapshot?.sources.find(source => source.id === query.board);
        const pin = query.cursor ? recipePins.get(query.cursor) : current?.recipe && providerSnapshot
          ? { source: current, validUntil: providerSnapshot.validUntil, expiresAt: Date.now() + 30 * 60000 } : undefined;
        if (current?.recipe && query.cursor && !pin) return { status: 'expired_cursor', detail: 'Pinned recipe is no longer available; start a new search.', requestCount: 0 };
        if (pin && (Date.parse(pin.validUntil) <= Date.now() || providerSnapshot?.revokedRecipes.some(recipe => recipe.sourceId === pin.source.id && recipe.revision === pin.source.revision))) {
          return { status: 'unsupported', detail: 'The pinned recipe has expired or been withdrawn.', requestCount: 0 };
        }
        const response = await read(pin ? '/v1/discovery/recipes/search' : '/v1/discovery/search', signal,
          pin ? { ...query, recipe: pin.source.recipe, validUntil: pin.validUntil } : query);
        const parsed = outcome.safeParse(response.body);
        if (!parsed.success || (parsed.data.status === 'ok' && !response.ok)) {
          return { status: 'error', detail: 'Invalid discovery response from the scraper.' };
        }
        if (parsed.data.status !== 'ok') return parsed.data;
        if ((parsed.data.data.requestCount ?? 0) > (query.requestLimit ?? 10)) return { status: 'error', detail: 'Source exceeded its reserved request allowance.' };
        const data = parsed.data.data;
        const hosts = pin?.source.hosts ?? installed.hosts;
        if (data.board !== query.board || data.items.length > query.pageSize || data.items.some((item) => {
          const url = new URL(item.url);
          return item.board !== query.board || url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
        })) return { status: 'error', detail: 'The scraper returned items for another source or an invalid offer URL.' };
        if (pin && data.nextCursor) {
          while (recipePins.size >= 400) recipePins.delete(recipePins.keys().next().value!);
          recipePins.set(data.nextCursor, { ...pin, expiresAt: Math.min(pin.expiresAt, Date.parse(data.expiresAt), Date.parse(pin.validUntil)) });
        }
        return { status: 'ok', data };
      } catch (error) {
        if (error instanceof OperationError) return { status: 'unavailable', detail: error.message };
        return { status: 'unavailable', detail: signal.aborted ? 'Search cancelled.' : 'The scraper could not be reached. Cached search remains available.' };
      }
    }
  };
};
