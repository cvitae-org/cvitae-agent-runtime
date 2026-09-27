import { OperationError } from '../../contracts/operation-error.js';
import { discoveryQuerySchema, type DiscoveryQuery } from '../../contracts/discovery-query.js';
import type { DiscoveryAnswerContext } from '../../contracts/discovery-chat.js';
import { discoveryFiltersSchema, type DiscoveryEvidence } from '../../contracts/discovery-search.js';
import type { Db } from './open.js';
import { discoveryFilter } from './discovery-filter.js';

const salary = (field: string) => `json_extract(e.value,'$.offer.salaryReading.${field}')`;
const workMode = "coalesce(json_extract(e.value,'$.offer.workMode'),json_extract(e.value,'$.offer.analysis.work_mode'),'unknown')";
const groupFields = {
 company: "coalesce(json_extract(e.value,'$.offer.company'),json_extract(e.value,'$.listing.company'),'Unknown')",
 source: "coalesce(json_extract(e.value,'$.offer.board'),json_extract(e.value,'$.listing.board'),'unknown')",
 contract: "coalesce(json_extract(e.value,'$.offer.contractType'),json_extract(e.value,'$.offer.analysis.contract_type'),'Unknown')",
 workMode
};
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';

/** Queries only frozen membership; all dynamic values are bound parameters. */
export const retrieveDiscovery = (db: Db, context: DiscoveryAnswerContext, raw: DiscoveryQuery): DiscoveryAnswerContext => {
 const query = discoveryQuerySchema.parse(raw);
 const result: DiscoveryAnswerContext = { ...context, query, evidence: [], matchedCount: 0, aggregates: {}, limitations: [] };
 if (query.mode === 'clarify' || query.mode === 'help') { delete result.matchedCount; return result; }
 if ((query.minimum !== null || query.maximum !== null || query.sort === 'salaryDescending') && (!query.currency || !query.period)) {
  result.query = { ...query, mode: 'clarify', clarification: context.request.language === 'pl' ? 'Podaj walutę i okres wynagrodzenia do porównania.' : 'Which salary currency and pay period should I compare?' };
  return result;
 }
 const filter = discoveryFilter(discoveryFiltersSchema.parse({ sources: query.sources, contracts: query.contracts.map(c=>c.toLowerCase()), minimum: query.minimum, maximum: query.maximum, currency: query.currency ?? 'PLN', period: query.period ?? 'month' }), {currency:query.currency ?? undefined,period:query.period ?? undefined});
 const clauses = ['m.run_id=?', filter.sql], args: (string|number)[] = [context.request.runId, ...filter.args];
 if (query.workMode) { clauses.push(`${workMode}=?`); args.push(query.workMode); }
 if (query.references.length) {
  const ids = query.references.map(marker => {
   const ref = context.previousReferences?.find(r=>r.marker===marker);
   if (!ref) throw new OperationError('invalid_reference', 'That earlier reference is unavailable. Please select an offer again.');
   return ref.offerId;
  });
  clauses.push(`m.offer_id IN (${ids.map(()=>'?').join(',')})`); args.push(...ids);
 }
 if (query.mode === 'compare' && !query.references.length) {
  result.query = { ...query, mode:'clarify', clarification: context.request.language === 'pl' ? 'Które oferty mam porównać? Wskaż ich numery.' : 'Which offers should I compare? Give their reference numbers.' }; return result;
 }
 for (const group of query.termGroups) {
  clauses.push(`e.id IN (SELECT evidence_id FROM discovery_evidence_fts WHERE discovery_evidence_fts MATCH ?)`);
  args.push('(' + group.map(quote).join(' OR ') + ')');
  // FTS ignores punctuation; retain literal distinctions for C++, C# and .NET.
  if (group.some(t=>/[+#.]/.test(t))) {
   clauses.push('(' + group.map(()=> 'instr(lower(e.value),lower(?))>0').join(' OR ') + ')'); args.push(...group);
  }
 }
 if (query.sort === 'salaryDescending') {
  clauses.push(`upper(${salary('currency')})=? AND ${salary('period')}=? AND ${salary('min')} IS NOT NULL AND ${salary('max')} IS NOT NULL AND ${salary('min')}>=0 AND ${salary('max')}>=${salary('min')}`);
  args.push(query.currency!, query.period!);
  result.limitations!.push('Salary ranking uses complete published/parsed ranges in the requested currency and period, ordered by the upper bound. Other units and incomplete ranges are excluded.');
 }
 const from = `FROM discovery_turn_members m JOIN discovery_offer_evidence e ON e.id=m.evidence_id WHERE ${clauses.join(' AND ')}`;
 const count = (db.prepare(`SELECT count(*) AS n ${from}`).get(...args) as {n:number}).n;
 result.matchedCount = count;
 if (query.mode === 'group') {
  if (!query.groupBy) throw new OperationError('invalid_query', 'A grouping field is required.');
  const expression = `substr(trim(${groupFields[query.groupBy]}),1,160)`;
  const groups = db.prepare(`SELECT ${expression} AS label,count(*) AS count ${from} GROUP BY ${expression} ORDER BY count DESC,label LIMIT 20`).all(...args) as {label:string;count:number}[];
  result.aggregates = { groupBy:query.groupBy, groups, otherCount:count-groups.reduce((sum,g)=>sum+g.count,0) };
 }
 if (query.mode === 'salary' || query.sort === 'salaryDescending') result.limitations!.push('Offers with multiple salary alternatives are excluded from salary statistics and salary ranking; their separate contract and tax bases are retained in offer details.');
 if (query.mode === 'salary') {
  const valid = `${salary('min')} IS NOT NULL AND ${salary('max')} IS NOT NULL AND ${salary('min')}>=0 AND ${salary('max')}>=${salary('min')} AND length(${salary('currency')})=3 AND ${salary('period')} IN ('hour','day','month','year')`;
  const groups = db.prepare(`SELECT upper(${salary('currency')}) AS currency,${salary('period')} AS period,count(*) AS count,min(${salary('min')}) AS minimum,max(${salary('max')}) AS maximum,avg((${salary('min')}+${salary('max')})/2.0) AS averageMidpoint ${from} AND ${valid} GROUP BY upper(${salary('currency')}),${salary('period')} ORDER BY count DESC,currency,period LIMIT 20`).all(...args) as {currency:string;period:string;count:number;minimum:number;maximum:number;averageMidpoint:number}[];
  result.aggregates = { salaryGroups:groups, excludedOrOtherCount:count-groups.reduce((sum,g)=>sum+g.count,0), method:'Average of complete range midpoints, grouped by currency and pay period; no currency conversion or net/gross equivalence.' };
 }
 if (query.references.length > count) result.limitations!.push('Some requested references are outside the captured scope or do not match the requested filters.');
 if (query.mode === 'count') return result;
 const terms = query.termGroups.flat();
 const ranks = terms.map(()=> "(CASE WHEN instr(lower(coalesce(json_extract(e.value,'$.offer.position'),'')),lower(?))>0 THEN 4 ELSE 0 END + CASE WHEN instr(lower(coalesce(json_extract(e.value,'$.offer.skills'),'')),lower(?))>0 THEN 2 ELSE 0 END)");
 const rankArgs = terms.flatMap(t=>[t,t]);
 const order = query.sort === 'salaryDescending' ? `${salary('max')} DESC,${salary('min')} DESC,m.ordinal` : (ranks.length ? `(${ranks.join('+')}) DESC,m.ordinal` : 'm.ordinal');
 const selected = db.prepare(`SELECT e.id,e.value ${from} ORDER BY ${order} LIMIT 12`).all(...args,...(query.sort==='salaryDescending' ? [] : rankArgs)) as {id:string;value:string}[];
 let budget = 24000;
 for (const row of selected) {
  const item = JSON.parse(row.value) as DiscoveryEvidence, o=item.offer;
  const entry: DiscoveryAnswerContext['evidence'][number] = {
   reference:{offerId:o.id,evidenceId:row.id,label:[o.position ?? item.listing?.title ?? o.id,o.company].filter(Boolean).join(' — ').slice(0,300),marker:result.evidence.length+1},
   facts:{position:o.position?.slice(0,250),company:o.company?.slice(0,250),salary:o.salary?.slice(0,250),salaryReading:o.salaryReading,salaryRanges:o.stated?.salary_ranges,employmentType:o.stated?.employment_type,contract:o.contractType?.slice(0,250),location:o.location?.slice(0,250),workMode:o.workMode,skills:o.skills?.slice(0,20).map(s=>s.slice(0,80))},
   excerpt:o.text.slice(0,1400)
  };
  const provenance = {published:item.listing,extracted:o.analysis,provenance:item.enrichment?.provenance};
  if (JSON.stringify(provenance).length<=1200) Object.assign(entry.facts,provenance);
  const size=JSON.stringify(entry).length; if(size>budget) break; budget-=size; result.evidence.push(entry);
 }
 if (count>result.evidence.length) result.limitations!.push('Offer excerpts are a bounded subset. Counts and aggregate values cover all matches in the captured scope.');
 return result;
};
