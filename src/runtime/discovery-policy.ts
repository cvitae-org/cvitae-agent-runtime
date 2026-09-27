import type { CatalogueItem, DiscoveryConditionDecision, DiscoveryMatchMode, DiscoveryQualification, DiscoverySearchPolicy } from '../contracts/discovery.js';

export const discoveryMatchingPolicyVersion = 'discovery-match-v2' as const;
export const defaultDiscoverySearchPolicy: DiscoverySearchPolicy = {
  unknownPolicy: 'separate', activity: 'exclude_explicitly_inactive', maxPublishedAgeDays: null
};

const normalize = (value: string): string => value
  .normalize('NFKD')
  .toLowerCase()
  .replace(/\p{M}/gu, '')
  .replaceAll('ł', 'l');

export const discoveryTerms = (query: string): string[] =>
  query.match(/[\p{L}\p{N}+#.]+/gu)
    ?.filter((term) => /[\p{L}\p{N}]/u.test(term))
    .map(normalize) ?? [];

const sourceText = (item: CatalogueItem): string => {
  const listing = item.listing;
  const stated = item.offer.stated;
  return [
    listing?.title,
    listing?.company,
    listing?.location,
    listing?.salary,
    listing?.contract_type,
    listing?.employment_type,
    listing?.company_type,
    listing?.company_size,
    listing?.engagement_length,
    ...(listing?.required_skills ?? []),
    stated?.title,
    stated?.company,
    stated?.location,
    stated?.salary,
    stated?.contract_type,
    stated?.employment_type,
    stated?.company_type,
    stated?.company_size,
    stated?.engagement_length,
    ...(stated?.required_skills ?? []),
    item.offer.position,
    item.offer.company,
    item.offer.location,
    item.offer.salary,
    ...(item.offer.skills ?? []),
    item.offer.text
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ');
};

/** One deterministic, source-backed evaluator for cached and live candidates. */
export const qualifyDiscoveryItem = (
  item: CatalogueItem,
  query: string,
  mode: DiscoveryMatchMode,
  origin: DiscoveryQualification['origin'],
  policy: DiscoverySearchPolicy = defaultDiscoverySearchPolicy,
  now = Date.now()
): CatalogueItem | null => {
  const terms = discoveryTerms(query);
  if (!terms.length) return null;
  const publishedTitle = item.listing?.titleSource === 'board' ? item.listing.title : item.offer.stated?.title;
  const title = normalize(publishedTitle || '');
  const text = sourceText(item);
  const haystack = mode === 'title' ? title : normalize(text);
  let queryDecision: DiscoveryConditionDecision;
  let queryReason: string;
  if (!haystack.trim()) {
    queryDecision = 'unknown';
    queryReason = mode === 'title' ? 'The source did not publish a usable title.' : 'The source did not publish searchable text.';
  } else if (terms.every((term) => haystack.includes(term))) {
    queryDecision = 'pass';
    queryReason = mode === 'title' ? 'All query terms occur in the source title.' : 'All query terms occur in source-published fields.';
  } else {
    queryDecision = 'fail';
    queryReason = mode === 'title' ? 'The published source title does not contain every query term.' : 'The source-published fields do not contain every query term.';
  }
  const activity = item.freshness?.activity ?? { status: 'unknown' as const, reason: 'No source activity evidence is available.' };
  const activityDecision: DiscoveryConditionDecision = policy.activity === 'any' || activity.status === 'active'
    ? 'pass' : activity.status === 'inactive' ? 'fail' : 'unknown';
  const activityReason = policy.activity === 'any' ? 'Activity was not required by this search.' : activity.reason;
  let recencyDecision: DiscoveryConditionDecision = 'pass';
  let recencyReason = 'No publication-age limit was requested.';
  if (policy.maxPublishedAgeDays !== null) {
    const published = item.freshness?.publication.value;
    const timestamp = published ? Date.parse(published) : Number.NaN;
    if (!Number.isFinite(timestamp)) {
      recencyDecision = 'unknown'; recencyReason = 'The source did not publish a usable publication date.';
    } else if (timestamp < now - policy.maxPublishedAgeDays * 86_400_000) {
      recencyDecision = 'fail'; recencyReason = `The publication date is older than ${policy.maxPublishedAgeDays} days.`;
    } else recencyReason = `The publication date is within ${policy.maxPublishedAgeDays} days.`;
  }
  const conditions: DiscoveryQualification['conditions'] = [
    { id: 'query', decision: queryDecision, reason: queryReason },
    { id: 'activity', decision: activityDecision, reason: activityReason },
    { id: 'recency', decision: recencyDecision, reason: recencyReason }
  ];
  if (conditions.some((condition) => condition.decision === 'fail')) return null;
  // The default activity filter excludes only explicit inactivity. Unknown
  // activity stays visible with its label; it is not a claim that the offer is
  // active. Missing evidence for the requested content/recency is reviewable.
  const decision: DiscoveryQualification['decision'] = [
    conditions.find((condition) => condition.id === 'query')!,
    conditions.find((condition) => condition.id === 'recency')!
  ].some((condition) => condition.decision === 'unknown') ? 'unknown' : 'accepted';
  const normalizedQuery = normalize(query).trim().replace(/\s+/g, ' ');
  const tier: DiscoveryQualification['tier'] = mode === 'anywhere'
    ? 'anywhere-terms'
    : decision === 'unknown' ? 'unknown' : title === normalizedQuery
      ? 'title-exact'
      : 'title-terms';
  return {
    ...item,
    qualification: {
      policyVersion: discoveryMatchingPolicyVersion,
      mode,
      decision,
      tier,
      reasons: conditions.filter((condition) => condition.decision !== 'pass' || condition.id === 'query').map((condition) => condition.reason),
      conditions,
      origin
    }
  };
};
