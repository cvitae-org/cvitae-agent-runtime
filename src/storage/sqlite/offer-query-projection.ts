import { createHash } from 'node:crypto';
import type { DiscoveryEvidence } from '../../contracts/discovery-search.js';
import type { ProjectedOffer } from '../../contracts/offer-query.js';
import { publishedContract } from '../../capabilities/offers/published.js';
import { parseSalary } from '../../capabilities/offers/salary.js';
import { queryTables } from './offer-query-schema.js';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const normalize = (s: string) => s.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replaceAll('ł', 'l');
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() && !/^(unknown|not[ _-]?stated|n\/?a|brak|nie podano|none|unspecified)$/i.test(v.trim()) ? v.trim() : null;
export function projectOffer(evidenceId: string, e: DiscoveryEvidence, metadata: Record<string, unknown> = {}): ProjectedOffer {
    const o = e.offer, s = o.stated ?? {}, l = e.listing ?? {};
    const row: Record<string, string | number | null> = {};
    const sources: (string | number | null)[][] = [];
    const put = (key: string, value: string | number | null, source: string) => { row[key] = value; if (value !== null)
        sources.push([o.id, key, source, evidenceId, e.enrichment?.detailsFetchedAt ?? null]); };
    const pick = (key: string, a: unknown, b?: unknown) => put(key, text(a) ?? text(b), text(a) !== null ? 'stated' : 'listing');
    put('offer_id', o.id, 'application_metadata');
    put('opportunity_id', typeof metadata.opportunityId === 'string' ? metadata.opportunityId : o.id, 'application_metadata');
    put('evidence_id', evidenceId, 'application_metadata');
    put('search_rank', typeof metadata.searchRank === 'number' ? metadata.searchRank : null, 'application_metadata');
    put('match_tier', e.qualification?.tier ?? null, 'search_metadata');
    put('match_reasons_json', e.qualification ? JSON.stringify(e.qualification.reasons) : null, 'search_metadata');
    put('match_origin', e.qualification?.origin ?? null, 'search_metadata');
    put('match_policy_version', e.qualification?.policyVersion ?? null, 'search_metadata');
    put('source', text(l.board) ?? text(o.board), 'listing');
    put('url', text(l.url) ?? text(o.finalUrl) ?? text(o.url), 'listing');
    pick('role', s.title, l.titleSource === 'board' ? l.title : undefined);
    pick('company', s.company, l.company);
    pick('location', s.location, l.location);
    put('work_mode', ['remote', 'hybrid', 'onsite'].includes(s.work_mode ?? '') ? s.work_mode! : null, 'stated');
    pick('seniority', s.seniority);
    pick('salary_text', s.salary, l.salary);
    pick('contract_type', publishedContract(s.contract_type), publishedContract(l.contract_type));
    pick('employment_type', s.employment_type, l.employment_type);
    pick('industry', s.company_type, l.company_type);
    pick('company_size', s.company_size, l.company_size);
    pick('start_date', s.start_date);
    pick('duration', s.engagement_length, l.engagement_length);
    pick('posted_at', s.posted_at, l.posted_at);
    put('publication_precision', e.freshness?.publication.precision ?? null, 'source_observation');
    pick('valid_through', s.valid_through, l.valid_through);
    put('description', o.text ?? '', 'source_text');
    put('details_fetched_at', e.freshness?.detailsFetchedAt ?? e.enrichment?.detailsFetchedAt ?? null, 'source_observation');
    put('first_seen_at', e.freshness?.firstObservedAt ?? o.firstSeenAt ?? null, 'source_observation');
    put('last_seen_at', e.freshness?.latestObservedAt ?? o.lastSeenAt ?? null, 'source_observation');
    put('activity_status', e.freshness?.activity.status ?? 'unknown', 'source_observation');
    put('activity_reason', e.freshness?.activity.reason ?? 'No source activity evidence is available.', 'source_observation');
    put('activity_checked_at', e.freshness?.activity.checkedAt ?? null, 'source_observation');
    put('disposition', o.disposition ?? null, 'application_metadata');
    put('listing_title', text(l.title), 'listing');
    put('title_source', l.titleSource ?? 'unavailable', 'listing');
    for (const key of ['company', 'location'])
        row[`${key}_key`] = typeof row[key] === 'string' ? normalize(row[key]) : null;
    const skills = (s.required_skills?.filter(v => text(v))?.length ? s.required_skills : l.required_skills) ?? [];
    const seen = new Set<string>();
    const tags = skills.flatMap(v => { const clean = text(v); if (!clean)
        return []; const key = normalize(clean); if (seen.has(key))
        return []; seen.add(key); return [[o.id, clean, key, evidenceId]]; });
    const ranges = s.salary_ranges?.length ? s.salary_ranges : (!text(s.salary) || text(s.salary) === text(l.salary)) ? l.salary_ranges : undefined;
    let salaries: (string | number | null)[][];
    if (ranges?.length)
        salaries = ranges.map((r, i) => [o.id, String(i), r.min, r.max, text(r.currency)?.toUpperCase() ?? null, text(r.period), publishedContract(r.contractType) ?? row.contract_type ?? null, text(r.taxBasis), r.rawText, evidenceId, 'structured']);
    else {
        const salary = typeof row.salary_text === 'string' ? row.salary_text : '';
        const parsed = parseSalary(salary);
        salaries = [[o.id, '0', parsed.min, parsed.max, text(parsed.currency)?.toUpperCase() ?? null, text(parsed.period), row.contract_type ?? null, null, salary || null, evidenceId, parsed.min !== null || parsed.max !== null ? 'parsed' : 'unparsed']];
    }
    const tables: ProjectedOffer['tables'] = { offers: [queryTables.offers.map(c => row[c.name] ?? null)], offer_salaries: salaries, offer_skills: tags, offer_fact_sources: sources, offer_extracted_facts: [], offer_text_fts: [[o.id, normalize([row.role, row.company, row.location, row.description, ...tags.map(x => x[1])].filter(Boolean).join(' ')).replace(/(?<=\S)\.+(?=\s|$)/gu, '')]] };
    // Evidence identity/provenance timestamps are not data freshness. Metadata fields
    // in offers remain hashed; new AI evidence alone cannot invalidate published data.
    const content = { ...tables, offers: tables.offers!.map(r => r.filter((_, i) => !['evidence_id', 'search_rank'].includes(queryTables.offers[i]!.name))), offer_salaries: salaries.map(r => r.filter((_, i) => i !== 9)), offer_skills: tags.map(r => r.slice(0, 3)), offer_fact_sources: sources.filter(r => r[1] !== 'evidence_id').map(r => r.slice(0, 3)) };
    return { evidenceId, offerId: o.id, hash: hash(JSON.stringify(content)), tables };
}
