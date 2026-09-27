import { randomUUID } from 'node:crypto';
import { createOfferDetailsService } from './offer-details.js';
import { fingerprint } from '../hash.js';
import type { Enrichment, EnrichmentStore } from '../contracts/enrichment.js';
import type { OfferReader, OfferStore, RunResult } from '../contracts/index.js';
import { OperationError } from '../contracts/index.js';
import type { RunHandle } from './run.js';

export const createEnrichmentService = (offers: OfferStore, store: EnrichmentStore, reader: OfferReader,
  analyze: (offerId: string, signal: AbortSignal) => RunHandle, now = Date.now, changed: (value: Enrichment) => void = () => undefined) => {
  const active = new Map<string, AbortController>();
  let closed = false;
  store.recover();
  const details = createOfferDetailsService(offers, store, reader, now, changed);
  const requireOffer = (id: string) => {
    const offer = offers.get(id);
    if (!offer) throw new OperationError('offer_missing', 'This offer is no longer stored.');
    return offer;
  };
  const work = async (initial: Enrichment, force: boolean, controller: AbortController): Promise<void> => {
    let value = initial;
    try {
      await details.ensure(value.offerId, force, controller.signal);
      if (closed || controller.signal.aborted) return;
      value = store.get(value.offerId)!;
      const current = requireOffer(value.offerId);
      value = { ...value, sourceHash: fingerprint(JSON.stringify([current.text, current.stated])) };
      const handle = analyze(value.offerId, controller.signal);
      value = { ...value, status: 'analyzing', runId: handle.runId, updatedAt: now() };
      store.write(value);
      const result: RunResult = await handle.settled;
      if (closed || controller.signal.aborted) return;
      value = { ...store.get(value.offerId)!, status: result.degraded.length ? 'partial' : 'succeeded',
        analyzedAt: now(), analysisHash: value.sourceHash, updatedAt: now(), degraded: result.degraded };
      store.complete(value, result);
      changed(store.get(value.offerId)!);
    } catch (error) {
      if (!closed && !controller.signal.aborted) store.write({ ...store.get(value.offerId)!, status: 'failed', updatedAt: now(), error: error instanceof Error ? error.message : 'Enrichment failed.' });
    } finally { active.delete(initial.offerId); }
  };
  const cancel = (offerId: string): void => {
    const controller = active.get(offerId);
    if (!controller) return;
    controller.abort();
    const value = store.get(offerId);
    if (value) store.write({ ...value, status: 'cancelled', updatedAt: now() });
  };
  return {
    start(offerId: string, force = false, refreshDetails = force) {
      if (closed) throw new OperationError('enrichment_closed', 'Enrichment is unavailable.');
      const offer = requireOffer(offerId);
      const previous = store.get(offerId);
      if (active.has(offerId)) return previous!;
      if (!force && !details.running(offerId) && previous?.status === 'succeeded' && previous.analysisHash === fingerprint(JSON.stringify([offer.text, offer.stated])) && previous.detailsFetchedAt && now() - previous.detailsFetchedAt < 7 * 24 * 60 * 60 * 1000) return previous;
      if (active.size >= 3) throw new OperationError('enrichment_capacity', 'Three offers are already being enriched. Wait for one to finish.');
      const value: Enrichment = { ...previous, offerId, id: randomUUID(), status: 'fetching', error: undefined, degraded: undefined, updatedAt: now() };
      store.write(value);
      const controller = new AbortController(); active.set(offerId, controller);
      void work(value, refreshDetails, controller);
      return value;
    },
    details,
    get(offerId: string) { return { enrichment: store.get(offerId) ?? null, offer: requireOffer(offerId) }; },
    cancel,
    close() { for (const id of active.keys()) cancel(id); details.close(); closed = true; }
  };
};
