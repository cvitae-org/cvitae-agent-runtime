import { z } from 'zod';
export const queryLimits = { sqlBytes: 32768, parameterBytes: 65536, snapshotBytes: 64 * 1024 * 1024, frameBytes: 4 * 1024 * 1024, captureMs: 10000, executionMs: 5000, resultBytes: 5 * 1024 * 1024, resultRows: 10000, pageRows: 100, processes: 2, queue: 20, rssKiB: 192 * 1024, transientBytes: 100 * 1024 * 1024, ttlMs: 86400000, tombstoneMs: 7 * 86400000 } as const;
const id = z.string().min(1).max(200);
export const queryParamsSchema = z.array(z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]) }).strict()).max(100).refine(v => new Set(v.map(x => x.name)).size === v.length && Buffer.byteLength(JSON.stringify(v)) <= queryLimits.parameterBytes, 'Invalid query parameters');
export const queryScopeSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('search'), searchId: id }).strict(), z.object({ kind: z.literal('catalogue') }).strict(), z.object({ kind: z.literal('result'), executionId: id }).strict()
]);
export type QueryScope = z.infer<typeof queryScopeSchema>;
export type QueryParams = z.infer<typeof queryParamsSchema>;
const sql = z.string().min(1).max(32768).refine(v => Buffer.byteLength(v) <= queryLimits.sqlBytes);
const context = { ownerSearchId: id, scope: queryScopeSchema, snapshotId: id.optional(), expectedScopeRevision: z.string().max(100).nullable(), schemaVersion: z.literal(1) };
export const queryStartSchema = z.object({ ...context, requestId: id, sql, params: queryParamsSchema.default([]), origin: z.enum(['editor', 'chat', 'presentation']).default('editor') }).strict();
export const queryValidateSchema = z.object({ ...context, sql, params: queryParamsSchema.default([]) }).strict();
export const querySaveSchema = z.object({ ownerSearchId: id, expectedDocumentRevision: z.number().int().nonnegative(), draftSql: sql, params: queryParamsSchema.default([]), scope: queryScopeSchema, presentation: z.enum(['offers', 'results']) }).strict();
export const queryOwnedSchema = z.object({ ownerSearchId: id, executionId: id }).strict();
export const queryPageSchema = queryOwnedSchema.extend({ cursor: z.string().max(500).optional(), limit: z.number().int().min(1).max(100).default(100) }).strict();
export const queryPayloads = {
    'offers.query.schema': z.object({ schemaVersion: z.literal(1).optional() }).strict(),
    'offers.query.context': z.object({ ownerSearchId: id, scope: queryScopeSchema }).strict(),
    'offers.query.document': z.object({ ownerSearchId: id }).strict(),
    'offers.query.save': querySaveSchema, 'offers.query.validate': queryValidateSchema, 'offers.query.start': queryStartSchema,
    'offers.query.opportunities': queryPageSchema,
    'offers.query.get': queryOwnedSchema, 'offers.query.page': queryPageSchema, 'offers.query.cancel': queryOwnedSchema, 'offers.query.release': queryOwnedSchema
};
export type QueryStart = z.infer<typeof queryStartSchema>;
export type QueryValue = string | number | null | {
    integer: string;
};
export type QueryColumn = {
    index: number;
    name: string;
    declaredType: string | null;
    origin: {
        relation: string;
        column: string;
    } | null;
};
export type QueryResult = {
    columns: QueryColumn[];
    rows: QueryValue[][];
    truncated: boolean;
    identityIndex: number | null;
    bytes: number;
};
export type QueryState = 'queued' | 'capturing' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'expired';
export type QueryError = {
    code: string;
    message: string;
};
export type ProjectedOffer = {
    evidenceId: string;
    offerId: string;
    hash: string;
    tables: Record<string, (string | number | null)[][]>;
};
export type QueryTiming = {
    captureMs: number;
    projectionMs: number;
    queueMs: number;
    sqlMs: number;
    materializeMs?: number;
    serializationMs?: number;
    totalMs: number;
    rssKiB: number;
    datasetCacheHit: boolean;
    resultCacheHit: boolean;
};
export type QueryExecution = {
    executionId: string;
    ownerSearchId: string;
    request: QueryStart;
    state: QueryState;
    snapshotId: string | null;
    error: QueryError | null;
    result: Omit<QueryResult, 'rows'> | null;
    returnedRowCount: number;
    createdAt: number;
    timing: QueryTiming | null;
};
