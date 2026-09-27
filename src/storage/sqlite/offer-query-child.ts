// Private process entry point. Only sanitized projections and a dedicated dataset
// path arrive here; no runtime write connection, credentials or user DB path.
import { DatabaseSync } from 'node:sqlite';
import type { ProjectedOffer, QueryParams, QueryResult, QueryValue } from '../../contracts/offer-query.js';
import { queryLimits } from '../../contracts/offer-query.js';
import { OperationError } from '../../contracts/operation-error.js';
import { queryDdl, queryTables } from './offer-query-schema.js';
import { authorizer, identityIndex, queryAst } from './offer-query-policy.js';
type Message = {
    type: 'init';
    path: string;
    cached: boolean;
    sql: string;
    params: QueryParams;
    validate: boolean;
} | {
    type: 'batch';
    offers: ProjectedOffer[];
} | {
    type: 'end';
};
let initializedAt = 0;
let db: DatabaseSync, request: Extract<Message, {
    type: 'init';
}>;
let statements: Record<string, ReturnType<DatabaseSync['prepare']>> = {};
const send = (data: unknown, done?: () => void) => process.send?.(data, () => done?.());
const finish = () => { db?.close(); process.disconnect?.(); };
function execute() {
    if (!request.cached) {
        db.exec('COMMIT');
        db.close();
        db = new DatabaseSync(request.path, { readOnly: true, allowExtension: false, enableDoubleQuotedStringLiterals: false });
    }
    db.prepare("SELECT offer_id FROM offer_text_fts WHERE offer_text_fts MATCH 'warmup'").all();
    db.exec('PRAGMA query_only=ON; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-2048');
    db.enableDefensive(true);
    const ast = queryAst(request.sql, request.params), phase = { executing: false };
    db.setAuthorizer(authorizer(phase));
    const stmt = db.prepare(request.sql);
    stmt.setAllowBareNamedParameters(false);
    stmt.setAllowUnknownNamedParameters(false);
    stmt.setReturnArrays(true);
    stmt.setReadBigInts(true);
    const raw = stmt.columns(), columns = raw.map((c, index) => ({ index, name: c.name, declaredType: c.type, origin: c.table && c.column ? { relation: c.table, column: c.column } : null }));
    const result: QueryResult = { columns, rows: [], truncated: false, identityIndex: identityIndex(ast, raw), bytes: Buffer.byteLength(JSON.stringify(columns)) + 256 };
    if (result.bytes > queryLimits.resultBytes)
        throw new OperationError('query_capacity_exceeded', 'Result metadata exceeds the output limit.');
    const materializeMs = performance.now() - initializedAt;
    send({ type: 'running' });
    const began = performance.now();
    let serializationMs = 0;
    if (!request.validate) {
        phase.executing = true;
        const args = Object.fromEntries(request.params.map(p => [`:${p.name}`, typeof p.value === 'boolean' ? Number(p.value) : p.value]));
        for (const rawRow of stmt.iterate(args)) {
            const serializationStarted = performance.now();
            const row = (rawRow as unknown as unknown[]).map((v): QueryValue => { if (v instanceof Uint8Array || typeof v === 'number' && !Number.isFinite(v))
                throw new OperationError('query_output_unsupported', 'Binary or non-finite output is unsupported.'); if (typeof v === 'bigint')
                return v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER) ? { integer: String(v) } : Number(v); return v as QueryValue; });
            const bytes = Buffer.byteLength(JSON.stringify(row)) + 1;
            serializationMs += performance.now() - serializationStarted;
            if (result.rows.length >= queryLimits.resultRows || result.bytes + bytes > queryLimits.resultBytes) {
                result.truncated = true;
                break;
            }
            result.bytes += bytes;
            result.rows.push(row);
        }
    }
    send({ type: 'result', result, sqlMs: performance.now() - began - serializationMs, serializationMs, materializeMs }, finish);
}
process.on('message', (raw: Message) => {
    try {
        if (raw.type === 'init') {
            request = raw;
            initializedAt = performance.now();
            db = new DatabaseSync(raw.path, { readOnly: raw.cached, allowExtension: false, enableDoubleQuotedStringLiterals: false });
            if (raw.cached) {
                execute();
                return;
            }
            db.exec(queryDdl);
            db.exec('BEGIN');
            statements = Object.fromEntries(Object.entries(queryTables).map(([name, cols]) => [name, db.prepare(`INSERT INTO ${name} VALUES(${cols.map(() => '?').join(',')})`)]));
            send({ type: 'ready' });
        }
        else if (raw.type === 'batch') {
            for (const o of raw.offers)
                for (const [name, rows] of Object.entries(o.tables))
                    for (const row of rows)
                        statements[name]!.run(...row);
            send({ type: 'ready' });
        }
        else
            execute();
    }
    catch (error) {
        const e = error as Error;
        send({ type: 'error', error: error instanceof OperationError ? { code: error.code, message: error.message } : { code: /authoriz/i.test(e.message) ? 'query_access_denied' : 'query_invalid_sql', message: /authoriz/i.test(e.message) ? 'This operation is not available.' : 'SQLite could not prepare or execute this SELECT. Check fields, types and syntax.' } }, finish);
    }
});
