import { z } from 'zod';
import { discoveryBoardIdSchema, maxDiscoveryBoards } from '../contracts/discovery-board.js';
import { publishedSalarySchema } from '../contracts/published-salary.js';
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
export const discoveryDescriptors = z.object({ version: z.literal(1), recipeEngines: z.array(short).max(10).optional(), recipeBinding: z.literal('provider-source-v1').optional(), boards: z.array(z.object({
  id: boardId, label: short, adapterId: short.optional(), adapterVersion: short.optional(),
  markets: z.array(short).max(100).optional(), iconKey: boardId.optional(), enabled: z.boolean(), unavailableReason: short.optional(),
  searchMode: z.enum(['slug', 'board']), pagination: z.literal('snapshot'),
  coverage: z.enum(['sitemap', 'paginated', 'first-page']), detail: z.boolean(),
  filters: z.object({ keyword: filterCapability, matchMode: filterCapability, activity: filterCapability,
    maxPublishedAgeDays: filterCapability, workMode: filterCapability }).strict(),
  limitations: z.array(short).max(30)
})).max(maxDiscoveryBoards) });
export const discoveryOutcome = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), data: batch }),
  z.object({ status: z.enum(['error', 'empty', 'blocked', 'disallowed', 'unsupported', 'invalid_query', 'invalid_cursor', 'expired_cursor']), detail: short, requestCount: z.number().int().min(0).max(10).optional() })
]);


export const createDiscoveryTransport = (options: {url?: string; token?: string; fetch?: typeof globalThis.fetch}) => {
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
  return read;
};
