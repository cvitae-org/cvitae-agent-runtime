import type { OfferRecord } from './offer.js';
import type { ResolvedOffer } from './effects.js';
import type { RunResult } from './capability.js';

export type DetailFetch = {
  id: string;
  status: 'fetching' | 'succeeded' | 'failed' | 'cancelled';
  updatedAt: number;
  fetchedAt?: number;
  error?: string;
  /** An explicit fetch consumer, independent of analysis. */
  requested?: boolean;
};

export type Enrichment = {
  details?: DetailFetch;
  offerId: string;
  id: string;
  status: 'idle' | 'fetching' | 'analyzing' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
  updatedAt: number;
  detailsFetchedAt?: number;
  analyzedAt?: number;
  sourceHash?: string;
  extractorVersion?: string;
  analysisHash?: string;
  runId?: string;
  error?: string;
  degraded?: readonly string[];
  provenance?: Record<string, { source: 'board' | 'ai'; at: number; runId?: string }>;
};
export interface EnrichmentStore {
  get(offerId: string): Enrichment | undefined;
  write(value: Enrichment): void;
  source(value: Enrichment, source: ResolvedOffer): OfferRecord;
  complete(value: Enrichment, result: RunResult): OfferRecord;
  recover(): void;
}
