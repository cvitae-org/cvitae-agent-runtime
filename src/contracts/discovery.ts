import type { PublishedSalary } from './published-salary.js';
import type { OfferRecord } from './offer.js';
import type { Enrichment } from './enrichment.js';

export type DiscoveryBoardId = string;
export type DiscoveryMatchMode = 'title' | 'anywhere';
export type DiscoverySourceMode = 'live' | 'cache' | 'hybrid';
export type DiscoveryFilterId = 'keyword' | 'matchMode' | 'activity' | 'maxPublishedAgeDays' | 'workMode';
export type DiscoveryFilterSupport = 'native' | 'local' | 'unsupported' | 'unknown';
export type DiscoveryFilterCapability = { support: DiscoveryFilterSupport; stage: 'source' | 'runtime'; detail: string };
export type DiscoveryEffectiveFilter = {
  id: DiscoveryFilterId; support: DiscoveryFilterSupport; stage: 'source' | 'runtime';
  requested: string | number | null; applied: boolean; detail: string;
};
export type DiscoveryFilterReport = { effective: DiscoveryEffectiveFilter[]; unsupported: DiscoveryFilterId[] };
export type DiscoveryConditionDecision = 'pass' | 'fail' | 'unknown';
export type DiscoveryActivityStatus = 'active' | 'inactive' | 'unknown';
export type DiscoverySearchPolicy = {
  unknownPolicy: 'separate';
  activity: 'exclude_explicitly_inactive' | 'any';
  maxPublishedAgeDays: number | null;
};
export type DiscoveryBudget = {
  /** Null means that accepted-result count never stops acquisition. */
  targetAcceptedTotal: number | null;
  maxCandidatesTotal: number;
  maxPagesPerSource: number;
  maxRequestsTotal: number;
  deadlineMs: number;
  maxConcurrentRequests: number;
};
export const defaultDiscoveryBudget: DiscoveryBudget = {
  targetAcceptedTotal: null,
  maxCandidatesTotal: 10_000,
  maxPagesPerSource: 100,
  maxRequestsTotal: 500,
  deadlineMs: 720_000,
  maxConcurrentRequests: 3
};
export type DiscoveryRequestUsage = {
  search: number;
  details: number;
  total: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
};
export type DiscoveryFreshness = {
  publication: { value?: string; precision: 'instant' | 'date' | 'unknown' };
  firstObservedAt: number;
  latestObservedAt: number;
  detailsFetchedAt?: number;
  activity: { status: DiscoveryActivityStatus; reason: string; checkedAt?: number };
};
export type DiscoveryQualification = {
  policyVersion: 'discovery-match-v2';
  mode: DiscoveryMatchMode;
  decision: 'accepted' | 'unknown';
  tier: 'title-exact' | 'title-terms' | 'anywhere-terms' | 'unknown';
  reasons: string[];
  conditions: Array<{ id: 'query' | 'activity' | 'recency'; decision: DiscoveryConditionDecision; reason: string }>;
  origin: 'live' | 'cache';
};
export type ListingTitleSource = 'board' | 'slug' | 'unavailable';
export type DiscoveryListing = {
  board: DiscoveryBoardId;
  url: string;
  title: string;
  titleSource: ListingTitleSource;
  external_id?: string;
  description?: string; apply_url?: string; work_mode?: string;
  adapter_id?: string; adapter_version?: string;
  company?: string;
  location?: string;
  salary?: string;
  contract_type?: string;
  employment_type?: string; company_type?: string; company_size?: string; engagement_length?: string; valid_through?: string; salary_ranges?: PublishedSalary[];
  required_skills?: string[];
  posted_at?: string;
};
export type DiscoveryBatch = {
  version: 1;
  /** False when acquisition hit a source page/request cap before the last page. */
  sourceExhausted?: boolean;
  requestCount?: number;
  board: DiscoveryBoardId;
  items: DiscoveryListing[];
  nextCursor: string | null;
  hasMore: boolean;
  coverage: 'sitemap' | 'paginated' | 'first-page';
  retrievedAt: string;
  expiresAt: string;
  effectiveFilters: DiscoveryEffectiveFilter[];
  unsupportedFilters: DiscoveryFilterId[];
  limitations: string[];
};
export type DiscoveryBoard = {
  id: DiscoveryBoardId;
  label: string;
  adapterId?: string; adapterVersion?: string; markets?: string[]; iconKey?: string;
  enabled: boolean;
  visible?: boolean; defaultSelected?: boolean; searchAction?: 'collect' | 'browser';
  browserSearch?: { enabled: boolean; hosts: string[] };
  unavailableReason?: string;
  searchMode: 'slug' | 'board';
  pagination: 'snapshot';
  coverage: 'sitemap' | 'paginated' | 'first-page';
  detail: boolean;
  filters: Record<DiscoveryFilterId, DiscoveryFilterCapability>;
  limitations: string[];
};
export type DiscoveryFailure = { status: 'error' | 'empty' | 'blocked' | 'disallowed' | 'unsupported' | 'invalid_query' | 'invalid_cursor' | 'expired_cursor' | 'unavailable'; detail: string; requestCount?: number };
export type DiscoveryBrowserPlan = {
  version: 1; board: string; query: string; url: string;
  filters: Array<{ label: string }>; unmappedTerms: string[]; needsReview: boolean;
};
export interface DiscoverySource {
  browserSearch?(board: string, keyword: string, signal: AbortSignal): Promise<DiscoveryBrowserPlan>;
  validateBoard?(id: string): void;
  requestCost?(id: string, cursor?: string): number;
  boards(signal: AbortSignal): Promise<{ version: 1; boards: DiscoveryBoard[]; catalogueAvailable?: boolean; collectionUnavailableReason?: string }>;
  search(query: { board: DiscoveryBoardId; keyword: string; pageSize: number; cursor?: string; requestLimit?: number }, signal: AbortSignal): Promise<{ status: 'ok'; data: DiscoveryBatch } | DiscoveryFailure>;
}
export type CatalogueItem = {
  offer: OfferRecord;
  enrichment?: Enrichment;
  note?: { text: string; revision: number; updatedAt: number };
  listing?: DiscoveryListing;
  /** Adapter capture time, not an offer availability verification. */
  retrievedAt?: string;
  freshness?: DiscoveryFreshness;
  qualification?: DiscoveryQualification;
};
export type CatalogueQuery = { keyword: string; boards: DiscoveryBoardId[]; matchMode?: DiscoveryMatchMode; limit: number; offset: number };
export type CataloguePage = { items: CatalogueItem[]; hasMore: boolean; nextOffset: number | null };
export interface DiscoveryCatalogue {
  ingest(batch: DiscoveryBatch, seenAt: number): CatalogueItem[];
  search(query: CatalogueQuery): CataloguePage;
}
export type DiscoveryBoardState = {
  board: DiscoveryBoardId;
  status: 'loading' | 'ready' | 'exhausted' | 'error' | 'cancelled';
  nextCursor?: string;
  coverage?: DiscoveryBatch['coverage'];
  limitations?: string[];
  filterReport?: DiscoveryFilterReport;
  error?: DiscoveryFailure;
  completion?: 'exhausted' | 'bounded' | 'unknown';
  stopReason?: 'exhausted' | 'cache_only' | 'cancelled' | 'failed' | 'session_limit' |
    'target_reached' | 'candidate_budget' | 'page_budget' | 'request_budget' |
    'deadline' | 'repeated_cursor' | 'no_new_identities' | 'blocked' | 'unknown_completeness';
  candidates?: number;
  accepted?: number;
  unknown?: number;
};
export type DiscoveryEvent = {
  seq: number;
  kind: 'cached' | 'batch' | 'board' | 'cancelled';
  board?: DiscoveryBoardId;
  items?: CatalogueItem[];
  reviewItems?: CatalogueItem[];
  state?: DiscoveryBoardState;
  cacheNextOffset?: number | null;
  added?: number;
};
export type DiscoveryPoll = {
  id: string;
  events: DiscoveryEvent[];
  after: number;
  hasMoreEvents: boolean;
  boards: DiscoveryBoardState[];
  cancelled: boolean;
};
