import { createHash } from 'node:crypto';

export const opportunityRuleVersion = 'opportunity-headlines-v3';
export const normalizeIdentity = (value: string) => value.normalize('NFKD')
  .toLowerCase().replace(/\p{M}/gu, '').replaceAll('ł', 'l').replace(/\s+/g, ' ').trim();

export type OpportunityFeatures = {
  id: string; board: string; company: string; role: string; fingerprint: string;
};
const published = (value: unknown): string => typeof value === 'string' &&
  !/^(?:unknown|not[ _-]?stated|untitled|n\/?a|brak|nie podano|none|unspecified)$/i.test(value.trim())
  ? value.trim() : '';

/** Headline-only grouping. Detail differences belong to the individual sources. */
export function opportunityFeatures(id: string, board: string, _text: string,
  stated: Record<string, unknown>, listing: Record<string, unknown> = {}): OpportunityFeatures {
  const company = normalizeIdentity(published(stated.company) || published(listing.company))
    .replace(/\s+(?:sp\.?\s*z\s*o\.?o\.?|spolka z ograniczona odpowiedzialnoscia|ltd\.?|inc\.?)$/, '');
  // A slug is not a published role. Missing/unknown headlines remain singletons.
  const role = normalizeIdentity(published(stated.title) ||
    (listing.titleSource === 'board' ? published(listing.title) : ''));
  return { id, board, company, role,
    fingerprint: createHash('sha256').update(JSON.stringify([company, role])).digest('hex') };
}

export function matchingEvidence(a: OpportunityFeatures, b: OpportunityFeatures) {
  if (!a.company || !a.role || a.company !== b.company || a.role !== b.role) return;
  return { kind: 'headline', company: a.company, role: a.role };
}
