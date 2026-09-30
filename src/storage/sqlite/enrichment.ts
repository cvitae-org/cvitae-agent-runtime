import { publishedContract, publishedSalaries } from '../../capabilities/offers/published.js';
import type { Enrichment, EnrichmentStore } from '../../contracts/enrichment.js';
import type { OfferStore, ResolvedOffer, RunResult } from '../../contracts/index.js';
import { isWorkMode, OperationError } from '../../contracts/index.js';
import { applyStated } from '../../capabilities/analyzeOffer.js';
import { parseSalary } from '../../capabilities/offers/salary.js';
import { createIntegrationAcquisitions } from './integration-acquisitions.js';
import type { Db } from './open.js';

const present = (value: unknown): boolean => typeof value === 'string'
  ? !!value.trim() && !/^(not[\s_-]?stated|unknown|none|n\/?a|brak|nie podano|unspecified)$/i.test(value.trim())
  : Array.isArray(value) && value.length > 0;
const fields = ['company','company_type','company_size','team','position','role_profile','seniority','ideal_candidate','salary','contract_type','engagement_length','location','work_mode','start_date','how_to_apply','responsibilities','required_skills'];
export const createEnrichmentStore = (db: Db, offers: OfferStore): EnrichmentStore => {
  const acquisitions = createIntegrationAcquisitions(db);
  const read = db.prepare<[string]>('SELECT value FROM offer_enrichments WHERE offer_id=?');
  const put = db.prepare('INSERT INTO offer_enrichments(offer_id,value) VALUES(?,?) ON CONFLICT(offer_id) DO UPDATE SET value=excluded.value');
  const get = (id: string): Enrichment | undefined => {
    const row = read.get(id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as Enrichment : undefined;
  };
  const write = (value: Enrichment): void => { put.run(value.offerId, JSON.stringify(value)); };
  const requireOffer = (id: string) => {
    const offer = offers.get(id);
    if (!offer) throw new OperationError('offer_missing', 'This offer is no longer stored.');
    return offer;
  };
  return {
    get, write,
    source: db.transaction((value: Enrichment, source: ResolvedOffer) => {
      const offer = requireOffer(value.offerId);
      const sourceRow = db.prepare('SELECT listing FROM discovery_sources WHERE offer_id=? ORDER BY seen_at DESC LIMIT 1').get(value.offerId) as { listing: string } | undefined;
      const listing = sourceRow ? JSON.parse(sourceRow.listing) as Record<string, unknown> : {};
      const listingFacts = Object.fromEntries(Object.entries({ company: listing.company, salary: listing.salary,
        title: listing.titleSource === 'board' ? listing.title : undefined, location: listing.location,
        required_skills: listing.required_skills }).filter(([, v]) => present(v)));
      const stated = { ...listingFacts, ...offer.stated, ...Object.fromEntries(Object.entries(source.stated ?? {}).filter(([, v]) => present(v))) };
      if (source.stated?.field_evidence) stated.field_evidence = source.stated.field_evidence;
      for (const [key, evidence] of Object.entries(source.stated?.field_evidence ?? {})) {
        if(evidence.status !== 'stated') delete (stated as Record<string,unknown>)[key];
      }
      stated.contract_type = publishedContract(source.stated?.contract_type) ?? publishedContract(offer.stated?.contract_type) ?? publishedContract(listing.contract_type);
      stated.salary_ranges = publishedSalaries(stated.salary_ranges);
      if (source.stated?.salary && !source.stated.salary_ranges?.length && source.stated.salary !== (offer.stated?.salary ?? offer.salary)) delete stated.salary_ranges;
      const { overrides } = applyStated({}, stated);
      const saved = offers.save({ ...offer, text: source.text, finalUrl: source.finalUrl,
        stated, position: stated.title ?? offer.position, company: stated.company ?? offer.company,
        salary: stated.salary ?? offer.salary,
        salaryReading: stated.salary_ranges?.length ? (stated.salary_ranges.length === 1 ? stated.salary_ranges[0] : undefined) : stated.salary ? parseSalary(stated.salary) : offer.salaryReading,
        contractType: typeof overrides.contract_type === 'string' ? overrides.contract_type : offer.contractType,
        location: stated.location ?? offer.location,
        seniority: stated.seniority ?? offer.seniority,
        workMode: isWorkMode(stated.work_mode) ? stated.work_mode : offer.workMode,
        skills: stated.required_skills?.length ? [...stated.required_skills] : offer.skills,
        analysis: { ...offer.analysis, ...overrides },
        processing: offer.processing === 'rated' ? 'rated' : 'fetched' });
      const provenance = { ...value.provenance };
      for (const key of Object.keys(overrides)) provenance[key] = { source: 'board', at: value.updatedAt };
      for (const key of ['salary_ranges','employment_type','posted_at','valid_through']) {
        if (present((source.stated as Record<string,unknown> | undefined)?.[key])) provenance[key] = { source: 'board', at: value.updatedAt };
      }
      acquisitions.record(value.offerId, source.integration, source.integration?.provenance.sourceKey ?? offer.board ?? 'browser', new Date(value.updatedAt).toISOString(), value.updatedAt);
      write({ ...value, provenance });
      return saved;
    }).immediate,
    complete: db.transaction((value: Enrichment, result: RunResult) => {
      // Re-read now: disposition may have changed while the model was running.
      const offer = requireOffer(value.offerId);
      const extracted = Object.fromEntries(fields.filter((key) => present(result.data[key])).map((key) => [key, result.data[key]]));
      const analysis = { ...offer.analysis, ...extracted };
      const sourceRow = db.prepare('SELECT listing FROM discovery_sources WHERE offer_id=? ORDER BY seen_at DESC LIMIT 1').get(value.offerId) as { listing: string } | undefined;
      const listing = sourceRow ? JSON.parse(sourceRow.listing) as Record<string, unknown> : {};
      if (present(listing.contract_type)) analysis.contract_type = listing.contract_type;
      const { overrides } = applyStated(analysis, offer.stated ?? {});
      Object.assign(analysis, overrides);
      const str = (key: string, fallback?: string) => present(analysis[key]) ? String(analysis[key]) : fallback;
      const provenance = { ...get(value.offerId)?.provenance };
      for (const key of Object.keys(extracted)) provenance[key] = { source: 'ai', at: value.updatedAt, runId: result.runId };
      for (const key of Object.keys(overrides)) provenance[key] = { source: 'board', at: value.updatedAt };
      // applyStated reports only changed fields; identify equal board facts too.
      const authoritative = applyStated({}, offer.stated ?? {}).overrides;
      for (const key of Object.keys(authoritative)) provenance[key] = { source: 'board', at: value.updatedAt };
      if (present(listing.contract_type)) provenance.contract_type = { source: 'board', at: value.updatedAt };
      const saved = offers.save({ ...offer, analysis,
        position: str('position', offer.position), company: str('company', offer.company),
        salary: str('salary', offer.salary),
        salaryReading: offer.stated?.salary_ranges?.length ? (offer.stated.salary_ranges.length === 1 ? offer.stated.salary_ranges[0] : undefined) : str('salary', offer.salary) ? parseSalary(str('salary', offer.salary)!) : offer.salaryReading,
        contractType: str('contract_type', offer.contractType),
        location: str('location', offer.location), seniority: str('seniority', offer.seniority),
        workMode: isWorkMode(analysis.work_mode) && analysis.work_mode !== 'unknown' ? analysis.work_mode : offer.workMode,
        skills: Array.isArray(analysis.required_skills) && analysis.required_skills.length ? analysis.required_skills.filter((v): v is string => typeof v === 'string') : offer.skills,
        processing: offer.processing === 'rated' ? 'rated' : 'fetched' });
      write({ ...value, provenance });
      return saved;
    }).immediate,
    recover() {
      for (const row of db.prepare('SELECT value FROM offer_enrichments').all() as { value: string }[]) {
        const value = JSON.parse(row.value) as Enrichment;
        if (value.details?.status === 'fetching') {
          value.details = { ...value.details, status: 'failed', requested: false, error: 'Detail fetching was interrupted. Retry to continue.' };
          write(value);
        }
        if (value.status === 'fetching' || value.status === 'analyzing') write({ ...value, status: 'failed', error: 'Enrichment was interrupted. Retry to continue.' });
      }
    }
  };
};
