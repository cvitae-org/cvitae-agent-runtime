import { defaultOfferSql } from './offer-query-schema.js';
import { discoveryFiltersSchema } from '../../contracts/discovery-search.js';
import type { QueryParams } from '../../contracts/offer-query.js';
export function translateFilters(raw: unknown) {
    const f = discoveryFiltersSchema.parse(raw), params: QueryParams = [], clauses: string[] = [];
    const bind = (value: QueryParams[number]['value']) => { const name = `p${params.length}`; params.push({ name, value }); return `:${name}`; };
    if (f.sources.length)
        clauses.push(`o.source IN (${f.sources.map(bind).join(',')})`);
    const tests: string[] = [];
    if (f.contracts.length)
        tests.push(`coalesce(lower(s.contract_type),'unknown') IN (${f.contracts.map(x => bind(x.toLowerCase())).join(',')})`);
    if (f.minimum !== null || f.maximum !== null) {
        const unknown = '(s.currency IS NULL OR s.period IS NULL OR (s.min_amount IS NULL AND s.max_amount IS NULL))';
        const salary = [`NOT ${unknown}`, `s.currency=${bind(f.currency.toUpperCase())}`, `s.period=${bind(f.period)}`];
        if (f.minimum !== null)
            salary.push(`(s.max_amount IS NULL OR s.max_amount>=${bind(f.minimum)})`);
        if (f.maximum !== null)
            salary.push(`(s.min_amount IS NULL OR s.min_amount<=${bind(f.maximum)})`);
        tests.push(`((${salary.join(' AND ')})${f.includeUnknown ? ` OR ${unknown}` : ''})`);
    }
    if (tests.length)
        clauses.push(`EXISTS (SELECT 1 FROM offer_salaries s WHERE s.offer_id=o.offer_id AND ${tests.join(' AND ')})`);
    if (!clauses.length) return { draftSql: defaultOfferSql, params, presentation: 'offers' as const };
    return { draftSql: `SELECT o.* FROM offers o${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY o.offer_id`, params, presentation: 'offers' as const };
}
