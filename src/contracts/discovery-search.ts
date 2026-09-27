import { discoveryBoardIdSchema, maxDiscoveryBoards } from './discovery-board.js';
import { fieldEvidenceMapSchema } from './field-evidence.js';
import { z } from 'zod';
import { publishedSalarySchema } from './published-salary.js';

const id = z.string().min(1).max(200);
const text = z.string().max(10000);
const strings = z.array(text).max(500);
const board = discoveryBoardIdSchema;
const optionalText = text.optional();

export const discoveryBudgetSchema = z.object({
  targetAcceptedTotal: z.number().int().min(1).max(100000).nullable().default(null),
  maxCandidatesTotal: z.number().int().min(1).max(100000).default(10000),
  maxPagesPerSource: z.number().int().min(1).max(1000).default(100),
  maxRequestsTotal: z.number().int().min(1).max(10000).default(500),
  deadlineMs: z.number().int().min(1000).max(3600000).default(720000),
  maxConcurrentRequests: z.number().int().min(1).max(3).default(3)
}).strict();
export const discoveryBudgetDefaults = {
  targetAcceptedTotal: null,
  maxCandidatesTotal: 10000,
  maxPagesPerSource: 100,
  maxRequestsTotal: 500,
  deadlineMs: 720000,
  maxConcurrentRequests: 3
} as const;

export const discoveryFiltersSchema = z.object({
  sources: z.array(text).max(20).default([]), contracts: z.array(text).max(100).default([]),
  minimum: z.number().nonnegative().nullable().default(null), maximum: z.number().nonnegative().nullable().default(null),
  currency: z.string().max(20).default('PLN'), period: z.enum(['hour', 'day', 'month', 'year']).default('month'),
  includeUnknown: z.boolean().default(false)
}).refine((v) => v.minimum === null || v.maximum === null || v.minimum <= v.maximum, 'Invalid salary interval.');

// Strip all unknown fields at every level. In particular rating, run IDs, notes
// and candidate/profile facts must never enter Discover's public evidence store.
export const discoveryEvidenceSchema = z.object({
  offer: z.object({
    id, url: optionalText, finalUrl: optionalText, board: optionalText,
    position: optionalText, company: optionalText, location: optionalText,
    workMode: z.enum(['remote', 'hybrid', 'onsite', 'unknown']).optional(),
    seniority: optionalText, contractType: optionalText, salary: optionalText,
    salaryReading: z.object({ min: z.number().nullable(), max: z.number().nullable(),
      currency: text, period: z.enum(['', 'hour', 'day', 'month', 'year']) }).optional(),
    skills: strings.optional(), text: z.string().max(500000).default(''),
    firstSeenAt: z.number().nonnegative().optional(), lastSeenAt: z.number().nonnegative().optional(),
    processing: z.enum(['candidate', 'fetched', 'rated', 'unreadable']).optional(),
    disposition: z.enum(['active', 'dismissed', 'applied', 'expired']).optional(),
    stated: z.object({ extractor_version: optionalText, field_evidence: fieldEvidenceMapSchema.optional(), requisition_id: optionalText, requisition_issuer: optionalText, apply_url: optionalText, client_name: optionalText, contract_type: optionalText, employment_type: optionalText, company_type: optionalText, company_size: optionalText, engagement_length: optionalText, posted_at: optionalText, valid_through: optionalText, salary_ranges: z.array(publishedSalarySchema).max(20).optional(), company: optionalText, title: optionalText, location: optionalText,
      work_mode: optionalText, salary: optionalText, seniority: optionalText,
      start_date: optionalText, required_skills: strings.optional() }).optional(),
    analysis: z.object({ company: optionalText, company_type: optionalText, company_size: optionalText,
      team: optionalText, position: optionalText, role_profile: optionalText, seniority: optionalText,
      ideal_candidate: optionalText, salary: optionalText, contract_type: optionalText,
      engagement_length: optionalText, location: optionalText, work_mode: optionalText,
      start_date: optionalText, how_to_apply: optionalText,
      responsibilities: strings.optional(), required_skills: strings.optional() }).optional()
  }),
  listing: z.object({ board: board.optional(), url: optionalText, title: optionalText,
    titleSource: z.enum(['board', 'slug', 'unavailable']).optional(), external_id: optionalText,
    description: z.string().max(500000).optional(), apply_url: z.string().url().max(4000).optional(),
    work_mode: z.enum(['remote','hybrid','onsite','unknown']).optional(), adapter_id: text.optional(), adapter_version: text.optional(),
    company: optionalText, location: optionalText, salary: optionalText, contract_type: optionalText,
    employment_type: optionalText, company_type: optionalText, company_size: optionalText, engagement_length: optionalText, valid_through: optionalText, salary_ranges: z.array(publishedSalarySchema).max(20).optional(),
    required_skills: strings.optional(), posted_at: optionalText }).optional(),
  retrievedAt: z.string().max(100).nullable().optional(),
  freshness: z.object({
    publication: z.object({ value: optionalText, precision: z.enum(['instant','date','unknown']) }),
    firstObservedAt: z.number().nonnegative(), latestObservedAt: z.number().nonnegative(),
    detailsFetchedAt: z.number().nonnegative().optional(),
    activity: z.object({ status: z.enum(['active','inactive','unknown']), reason: z.string().min(1).max(500), checkedAt: z.number().nonnegative().optional() })
  }).optional(),
  enrichment: z.object({ detailsFetchedAt: z.number().nullable().optional(), analyzedAt: z.number().nullable().optional(),
    sourceHash: optionalText, analysisHash: optionalText,
    provenance: z.record(z.string().max(100), z.object({ source: z.enum(['board', 'ai']), at: z.number().nonnegative() })).optional()
  }).optional(),
  qualification: z.union([z.object({
    policyVersion: z.literal('discovery-match-v1'),
    mode: z.enum(['title', 'anywhere']),
    decision: z.literal('accepted'),
    tier: z.enum(['title-exact', 'title-terms', 'anywhere-terms']),
    reasons: z.array(z.string().min(1).max(500)).min(1).max(20),
    origin: z.enum(['live', 'cache'])
  }), z.object({
    policyVersion: z.literal('discovery-match-v2'),
    mode: z.enum(['title', 'anywhere']),
    decision: z.enum(['accepted','unknown']),
    tier: z.enum(['title-exact', 'title-terms', 'anywhere-terms', 'unknown']),
    reasons: z.array(z.string().min(1).max(500)).min(1).max(20),
    conditions: z.array(z.object({ id: z.enum(['query','activity','recency']), decision: z.enum(['pass','fail','unknown']), reason: z.string().min(1).max(500) })).min(3).max(3),
    origin: z.enum(['live', 'cache'])
  })]).optional()
});
export type DiscoveryEvidence = z.infer<typeof discoveryEvidenceSchema>;
export const discoveryBoardThreadSchema = z.object({
  boardId: board, label: z.string().trim().min(1).max(200),
  mode: z.enum(['automatic', 'browser'])
}).strict();
export const discoverySearchBatchSchema = z.object({
  phrase: z.string().trim().min(1).max(300),
  children: z.array(discoveryBoardThreadSchema.extend({ id })).min(1).max(maxDiscoveryBoards),
  matchMode: z.enum(['title', 'anywhere']).default('title'),
  activity: z.enum(['exclude_explicitly_inactive', 'any']).default('exclude_explicitly_inactive'),
  maxPublishedAgeDays: z.number().int().min(0).max(3650).nullable().default(null),
  budget: discoveryBudgetSchema.default(discoveryBudgetDefaults)
}).strict().refine(v => new Set(v.children.map(c => c.id)).size === v.children.length &&
  new Set(v.children.map(c => c.boardId)).size === v.children.length, 'Each child must have a unique ID and board.');
export const discoveryImportSchema = z.object({
  boardThread: discoveryBoardThreadSchema.optional(),
  kind: z.enum(['search', 'browser_import']).default('search'),
  id, importKey: id, phrase: z.string().trim().min(1).max(300),
  boards: z.array(board).min(1).max(maxDiscoveryBoards), filters: discoveryFiltersSchema,
  sourceMode: z.enum(['live', 'cache', 'hybrid']).default('hybrid'),
  matchMode: z.enum(['title', 'anywhere']).default('anywhere'),
  unknownPolicy: z.literal('separate').default('separate'),
  activity: z.enum(['exclude_explicitly_inactive','any']).default('exclude_explicitly_inactive'),
  maxPublishedAgeDays: z.number().int().min(0).max(3650).nullable().default(null),
  budget: discoveryBudgetSchema.default(discoveryBudgetDefaults),
  matchingPolicyVersion: z.string().min(1).max(100).default('legacy-unified-v0'),
  selectedId: id.nullable().default(null), rowCount: z.number().int().min(0).max(100000)
}).strict();
export type DiscoveryImport = z.infer<typeof discoveryImportSchema>;
export type DiscoveryImportReceipt = {
  id: string; importKey: string; nextOffset: number; rowCount: number;
  status: 'importing' | 'ready'; revision: number;
};
export const discoveryImportBatchSchema = z.object({
  id, importKey: id, offset: z.number().int().min(0).max(100000),
  items: z.array(discoveryEvidenceSchema).min(1).max(50)
}).strict().refine((v) => new TextEncoder().encode(JSON.stringify(v.items)).byteLength <= 1000000, 'Import batch exceeds 1 MB.');
export const discoveryImportIdentitySchema = z.object({ id, importKey: id }).strict();
export const discoverySearchPageSchema = z.object({
  id, filtered: z.boolean().default(false), offset: z.number().int().nonnegative().max(100000).default(0),
  group: z.enum(['accepted','review']).default('accepted'),
  presentation: z.enum(['listings','opportunities']).default('listings'),
  pageRevision: z.string().regex(/^\d+:\d+(?::\d+)?$/).max(100).optional(),
  limit: z.number().int().min(1).max(100).default(30)
}).strict().superRefine((value, context) => {
  if (value.offset > 0 && value.pageRevision === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['pageRevision'],
      message: 'A page revision is required when continuing saved-result pagination.' });
  }
});

export const discoveryChatRequestSchema = z.object({
  searchId: id, conversationId: id, runId: id, question: z.string().trim().min(1).max(4000),
  scope: z.enum(['all', 'filtered', 'results']).default('all'), filterRevision: z.number().int().nonnegative().default(0),
  collection: z.literal(true).optional(),
  version: z.literal(2).optional(), snapshotId: id.optional(), scopeRevision: id.optional(), executionId: id.optional(),
  language: z.enum(['en','pl']).default('en')
}).strict();
export type DiscoveryChatRequest = z.infer<typeof discoveryChatRequestSchema>;
