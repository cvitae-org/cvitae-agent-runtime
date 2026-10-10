import { validateCapture, domOfferMatches } from '@cvitae/job-pages';
import { z } from 'zod';
import type { OfferReader, ResolvedOffer } from '../contracts/effects.js';
import { OperationError } from '../contracts/operation-error.js';
import type { IntegrationProviders, ScopedIntegration } from './integration-providers.js';
import { connectionEnabled, executionFor } from './integration-execution.js';
import { createDiscoveryTransport } from './discovery-wire.js';

export type IntegrationOfferHint = { sourceKey: string; externalId?: string };
/** Offer acquisition uses only explicitly configured providers. Site reading is a separate port. */
export function createIntegrationOfferReader(providers: IntegrationProviders, options: {
  url?: string; token?: string; fetch?: typeof globalThis.fetch; now?: () => number;
  lookup?: (url: string) => IntegrationOfferHint | undefined;
} = {}): OfferReader {
  const read = createDiscoveryTransport(options), now = options.now ?? Date.now;
  const failure = (message: string): never => { throw new OperationError('unreadable_source', message); };
  type Resolved = Awaited<ReturnType<IntegrationProviders['resolve']>>;
  const available = (resolved: Resolved, source: ScopedIntegration) => connectionEnabled(providers, source) && Date.parse(source.validUntil) > now()
    && source.source.health.status !== 'drift' && !resolved.providers.find(provider => provider.connectionId === source.reference.connectionId)?.snapshot?.revokedRecipes.some(recipe => recipe.sourceId === source.reference.sourceId && recipe.revision === source.source.revision);
  /** The one source whose detail recipe reads this URL, or why there is none. */
  const select = (resolved: Resolved, url: string, hint?: IntegrationOfferHint): { source: ScopedIntegration } | { problem: string } => {
    const candidates = resolved.sources.filter(source => available(resolved, source) && source.source.detailRecipe
      && (!hint || source.key === hint.sourceKey) && domOfferMatches(source.source.detailRecipe, url));
    const priority = (source: ScopedIntegration) => providers.connections().find(connection => connection.id === source.reference.connectionId)!.priority;
    candidates.sort((a,b) => priority(a) - priority(b));
    if (!candidates.length) return { problem: 'No enabled provider offers a detail recipe for this source. Open the offer in a browser or configure its provider.' };
    if (!hint && candidates.length > 1 && priority(candidates[0]!) === priority(candidates[1]!)) return { problem: 'Several providers cover this offer. Import it from the desired provider search first.' };
    return { source: candidates[0]! };
  };
  const reader: OfferReader = {
    async covers(urls, signal) {
      const resolved = await providers.resolve(signal);
      return new Set(urls.filter(url => 'source' in select(resolved, url, options.lookup?.(url))));
    },
    async resolve(url, call): Promise<ResolvedOffer> {
      const hint = options.lookup?.(url), resolved = await providers.resolve(call.signal), selected = select(resolved, url, hint);
      if ('problem' in selected) return failure(selected.problem);
      const source = selected.source, recipe = source.source.detailRecipe!, integration = executionFor(source, recipe.kind);
      const acquisitionSignal = AbortSignal.any([call.signal, providers.signal(source.reference.connectionId)!]);
      const response = await read('/v1/discovery/recipes/detail', acquisitionSignal, { board: source.key, url, expectedId: hint?.externalId,
        recipe, validUntil: source.validUntil, binding: { connectionId: source.reference.connectionId, sourceId: source.reference.sourceId } });
      call.signal.throwIfAborted();
      const latest = await providers.resolve(call.signal), current = latest.sources.find(item => item.key === source.key);
      if (!current?.source.detailRecipe || Date.parse(current.validUntil) <= now() || !available(resolved, source) || current.source.health.status === 'drift'
        || latest.providers.find(provider => provider.connectionId === source.reference.connectionId)?.snapshot?.revokedRecipes.some(entry => entry.sourceId === recipe.sourceId && entry.revision === recipe.revision)) return failure('This provider or recipe was withdrawn during detail collection.');
      const result = z.object({status:z.literal('ok'),data:z.unknown(),requestCount:z.number().int().min(0).max(2)}).safeParse(response.body);
      if (!response.ok || !result.success) return failure('The local collector could not verify this offer with the selected provider recipe.');
      const capture = validateCapture({version:1,kind:'offer',url,title:'Offer',recipe:{sourceId:recipe.sourceId,revision:recipe.revision},items:[result.data.data]},recipe);
      const item = capture.items[0]!;
      if (hint?.externalId && item.external_id !== hint.externalId) return failure('The detail page changed its offer identity.');
      return { url, finalUrl: item.url, board: source.key, text: item.description!, descriptionText: item.description,
        routes: { applyUrl:item.apply_url,companyUrl:item.company_url,applicationEmail:item.application_email },
        stated: { title:item.title, company:item.company, location:item.location, salary:item.salary,
          contract_type:item.contract_type, employment_type:item.employment_type, seniority:item.seniority,
          posted_at:item.posted_at, valid_through:item.valid_through, apply_url:item.apply_url,
          work_mode:item.work_mode === 'remote' || item.work_mode === 'hybrid' || item.work_mode === 'onsite' ? item.work_mode : undefined,
          required_skills:item.required_skills, extractor_version:item.extractor_version, field_evidence:item.field_evidence, salary_ranges:item.salary_ranges, start_date:item.start_date, company_type:item.company_type, company_size:item.company_size, engagement_length:item.engagement_length, requisition_id:item.requisition_id, requisition_issuer:item.requisition_issuer, client_name:item.client_name }, integration };
    },
  };
  return { ...reader, capture: reader.resolve };
}
