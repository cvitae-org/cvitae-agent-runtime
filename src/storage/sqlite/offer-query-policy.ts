import parse from 'sqlite-parser';
import { constants as C } from 'node:sqlite';
import { OperationError } from '../../contracts/operation-error.js';
import type { QueryParams } from '../../contracts/offer-query.js';
import { queryFunctions, queryTables } from './offer-query-schema.js';
type Ast = {
    type?: string;
    variant?: string;
    name?: string | Ast;
    [key: string]: unknown;
};
const allowed = new Set(queryFunctions), relations = new Set(Object.keys(queryTables));
const fail = (code: string, message: string): never => { throw new OperationError(code, message); };
const walk = (raw: unknown, fn: (node: Ast) => void): void => { if (!raw || typeof raw !== 'object')
    return; if (Array.isArray(raw)) {
    raw.forEach(x => walk(x, fn));
    return;
} const n = raw as Ast; fn(n); Object.values(n).forEach(x => walk(x, fn)); };
export function queryAst(sql: string, params: QueryParams): Ast {
    let ast: Ast;
    try {
        ast = parse(sql) as Ast;
    }
    catch {
        return fail('query_invalid_sql', 'SQL could not be parsed. Check the supported SELECT syntax.');
    }
    const statements = ast.statement as Ast[];
    if (ast.variant !== 'list' || statements?.length !== 1)
        fail('query_unsupported_syntax', 'Exactly one SELECT statement is required.');
    const ctes = new Set<string>(), bindings = new Set<string>();
    walk(ast, n => { if (n.variant === 'recursive')
        fail('query_unsupported_syntax', 'Recursive queries are not supported.'); for (const c of (n.with ?? []) as {
        target: {
            name: string;
        };
    }[])
        ctes.add(c.target.name.toLowerCase()); });
    walk(statements[0], n => {
        if (n.type === 'statement' && !['select', 'compound'].includes(n.variant ?? ''))
            fail('query_access_denied', 'Only SELECT is available.');
        if (n.type === 'identifier' && n.variant === 'table' && !relations.has(String(n.name).toLowerCase()) && !ctes.has(String(n.name).toLowerCase()))
            fail('query_access_denied', 'The query references an unavailable relation.');
        if (n.type === 'function' && !allowed.has(String((n.name as Ast)?.name).toLowerCase()))
            fail('query_access_denied', 'The query uses an unavailable function.');
        if (n.type === 'variable') {
            if (!/^:[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(String(n.name)))
                fail('query_invalid_params', 'Use named :parameters.');
            bindings.add(String(n.name).slice(1));
        }
    });
    if (bindings.size !== params.length || params.some(p => !bindings.has(p.name)))
        fail('query_invalid_params', 'Parameter names must exactly match the SQL.');
    return statements[0]!;
}
export function identityIndex(s: Ast, cols: {
    column: string | null;
    table: string | null;
}[]): number | null {
    const from = s.from as Ast | undefined, results = s.result as Ast[] | undefined;
    if (s.variant !== 'select' || s.with || s.group || s.having || from?.type !== 'identifier' || String(from.name).toLowerCase() !== 'offers' || !results)
        return null;
    let functions = false;
    results.forEach(r => walk(r, n => { if (n.type === 'function' || n.type === 'statement')
        functions = true; }));
    if (functions)
        return null;
    const alias = String(from.alias ?? 'offers');
    let i: number;
    if (results.length === 1 && results[0]?.variant === 'star' && ['*', `${alias}.*`].includes(String(results[0].name)))
        i = cols.findIndex(c => c.table === 'offers' && c.column === 'offer_id');
    else {
        if (results.some(r => r.variant === 'star'))
            return null;
        i = results.findIndex(r => r.type === 'identifier' && r.variant === 'column' && (r.name === `${alias}.offer_id` || r.name === 'offer_id'));
    }
    return i >= 0 && cols[i]?.table === 'offers' && cols[i]?.column === 'offer_id' ? i : null;
}
export const authorizer = (phase: {
    executing: boolean;
}) => (action: number, a: string | null, b: string | null, database: string | null) => {
    if (action === C.SQLITE_SELECT)
        return C.SQLITE_OK;
    if (action === C.SQLITE_READ && relations.has(a ?? '') && (database === 'main' || (database === null && b === '')))
        return C.SQLITE_OK;
    if (action === C.SQLITE_FUNCTION && allowed.has(b?.toLowerCase() ?? ''))
        return C.SQLITE_OK;
    if (phase.executing && database === 'main') {
        if (action === C.SQLITE_READ && ['offer_text_fts_data', 'offer_text_fts_idx', 'offer_text_fts_content', 'offer_text_fts_docsize', 'offer_text_fts_config'].includes(a ?? ''))
            return C.SQLITE_OK;
        if (action === C.SQLITE_PRAGMA && a === 'data_version' && b === null)
            return C.SQLITE_OK;
    }
    return C.SQLITE_DENY;
};
