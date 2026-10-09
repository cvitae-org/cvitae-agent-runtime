import type { CollectionCoverage } from './offer-collection.js';
import type { ExtractionCoverage, FactSource, Criterion, StoredFact, FactBatch } from './offer-facts.js';
import type { QueryScope, QueryResult, QueryParams } from './offer-query.js';
import type { DiscoveryQuery } from './discovery-query.js';
import type { DiscoveryChatRequest } from './discovery-search.js';
export type DiscoveryReference = { offerId: string; label: string; evidenceId: string; marker: number };
export type DiscoveryAnswerContext = {
 collection?: CollectionCoverage;
 queryContext?: { snapshotId: string; scopeRevision: string; scope: QueryScope };
 capturedMembers?: { offer_id: string; evidence_id: string; metadata: string }[];
 sqlArtifact?: DiscoverySqlArtifact;
 request: DiscoveryChatRequest; scopeCount: number; revision: number;
 evidence: { reference: DiscoveryReference; facts: Record<string, unknown>; excerpt: string }[];
 history: { role: string; text: string }[];
 previousReferences?: DiscoveryReference[];
 query?: DiscoveryQuery;
 matchedCount?: number;
 aggregates?: Record<string, unknown>;
 limitations?: string[];
 /** How many offers of the captured snapshot this conversation excludes, when it excludes any. */
 withheldOffers?: number;
 /** The runs whose messages this turn was given as history; null for a message that belongs to no run. */
 historyRuns?: (string | null)[];
};

export type DiscoverySqlArtifact = {
 version: 1; executionId: string; sql: string; params: QueryParams; schemaVersion: 1;
 snapshotId: string; scope: QueryScope; columns: QueryResult['columns']; rows: QueryResult['rows'];
 returnedRowCount: number; truncated: boolean; contextTruncated: boolean; elapsedMs: number;
 collection?: CollectionCoverage;
 extraction?: ExtractionCoverage;
 budget: { calls: number; chargedTokens: number; estimated: boolean };
};
export type DiscoverySqlPort = {
 collection?: {
  defaults(searchId:string): { phrase:string; boards:string[] };
  run(context:DiscoveryAnswerContext,keyword:string,signal:AbortSignal,progress:(coverage:CollectionCoverage)=>void):Promise<DiscoveryAnswerContext>;
 };
 facts?: FactPort;
 record(context: DiscoveryAnswerContext): DiscoveryAnswerContext;
 schema(): unknown;
 capture(context: DiscoveryAnswerContext, signal: AbortSignal): Promise<NonNullable<DiscoveryAnswerContext['queryContext']>>;
 execute(context: DiscoveryAnswerContext, sql: string, params: QueryParams, attempt: number, signal: AbortSignal): Promise<DiscoveryAnswerContext>;
};

export type FactPort={
 modelVersion(choice:{providerId:string;modelId:string}):string;
 prepare(context:DiscoveryAnswerContext,signal:AbortSignal):Promise<FactBatch>;
 cached(source:FactSource,criteria:Criterion[],modelVersion:string):StoredFact[]|null;
 save(source:FactSource,facts:StoredFact[],signal:AbortSignal):void;
 lock(key:string,signal:AbortSignal):Promise<()=>void>;
 refresh(context:DiscoveryAnswerContext,batch:FactBatch,signal:AbortSignal):Promise<DiscoveryAnswerContext>;
};
