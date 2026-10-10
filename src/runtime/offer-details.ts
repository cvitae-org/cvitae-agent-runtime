import { publishedExtractorVersion } from '../contracts/field-evidence.js';
import { randomUUID } from 'node:crypto';
import { fingerprint } from '../hash.js';
import type { Enrichment, EnrichmentStore } from '../contracts/enrichment.js';
import type { OfferReader, OfferStore } from '../contracts/index.js';
import { OperationError } from '../contracts/index.js';

type Pending = { controller: AbortController; consumers: Set<symbol>; explicit?: symbol; promise: Promise<void> };
/** Written by a browser import that saw only the listing row. */
const listingOnly = 'browser:listing';

/** Public source collection; never resolves a model or requires a CV. */
export const createOfferDetailsService = (offers: OfferStore, store: EnrichmentStore, reader: OfferReader,
  now: () => number = Date.now, changed: (value: Enrichment) => void = () => undefined) => {
  const active = new Map<string, Pending>();
  let closed = false;
  const state = (id: string): Enrichment => {
    if (!offers.get(id)) throw new OperationError('offer_missing', 'This offer is no longer stored.');
    return store.get(id) ?? { offerId: id, id: randomUUID(), status: 'idle', updatedAt: now() };
  };
  const write = (value: Enrichment) => { store.write(value); changed(value); };
  const fresh = (id: string) => {
    const value = state(id);
    if (value.extractorVersion?.startsWith('browser:') && offers.get(id)?.text.trim()) return true;
    if (value.extractorVersion?.startsWith('listing:') && offers.get(id)?.text.trim()) return true;
    return ([publishedExtractorVersion,'reader-v1'].includes(value.extractorVersion ?? '') || value.extractorVersion?.startsWith('integration:')) && !!offers.get(id)?.text.trim() && value.detailsFetchedAt !== undefined && now() - value.detailsFetchedAt < 7 * 24 * 60 * 60 * 1000;
  };
  const release = (id: string, pending: Pending, consumer: symbol) => {
    pending.consumers.delete(consumer);
    if (pending.consumers.size || active.get(id) !== pending) return;
    pending.controller.abort(); active.delete(id);
    const value = state(id);
    if (value.details) write({ ...value, updatedAt: now(), details: { ...value.details, status: 'cancelled', requested: false, updatedAt: now() } });
  };
  const acquire = (id: string, force: boolean, explicit: boolean): { pending?: Pending; consumer?: symbol } => {
    if (closed) throw new OperationError('details_closed', 'Detail fetching is unavailable.');
    const previous = state(id);
    // A listing-only row has no capture to protect; the reader says when no provider reads its page.
    if (previous.extractorVersion?.startsWith('browser:') && previous.extractorVersion !== listingOnly && (force || !offers.get(id)?.text.trim())) throw new OperationError('browser_capture_required', 'Open the offer in your browser and import its details with Cvitae Browser Companion.');
    if (force && previous.extractorVersion?.startsWith('listing:')) throw new OperationError('unsupported_source', 'This description comes from the source job feed. Refresh the search to update this offer.');
    let pending = active.get(id);
    if (!pending && !force && fresh(id)) {
      if (explicit) write({ ...previous, updatedAt: now(), details: { id: randomUUID(), status: 'succeeded', updatedAt: now(), fetchedAt: previous.detailsFetchedAt, requested: false } });
      return {};
    }
    if (!pending) {
      if (active.size >= 3) throw new OperationError('details_capacity', 'Three offers are already being fetched. Wait for one to finish.');
      pending = { controller: new AbortController(), consumers: new Set(), promise: Promise.resolve() };
      active.set(id, pending);
      write({ ...previous, updatedAt: now(), details: { id: randomUUID(), status: 'fetching', updatedAt: now(), fetchedAt: previous.detailsFetchedAt, requested: explicit } });
      const operation = pending;
      // Start after registering the first consumer; aborted/late reads cannot publish.
      operation.promise = Promise.resolve().then(async () => {
        if (operation.controller.signal.aborted) return;
        const offer = offers.get(id)!;
        if (!offer.url) throw new OperationError('unreadable_source', 'This offer has no source URL.');
        const source = await reader.resolve(offer.url, { traceId: state(id).details!.id, signal: operation.controller.signal });
        if (closed || operation.controller.signal.aborted) return;
        if (!source.text.trim()) throw new OperationError('unreadable_source', 'The offer contained no readable text.');
        const value = state(id);
        const at = now();
        const saved = { ...value, extractorVersion: source.stated?.extractor_version ?? 'reader-v1', detailsFetchedAt: at, sourceHash: fingerprint(JSON.stringify([source.text, source.stated])), updatedAt: at,
          details: { ...value.details!, status: 'succeeded' as const, fetchedAt: at, updatedAt: at, requested: false, error: undefined } };
        store.source(saved, source);
        changed(store.get(id)!);
      }).catch((error: unknown) => {
        if (!closed && !operation.controller.signal.aborted) {
          const value = state(id);
          write({ ...value, updatedAt: now(), details: { ...value.details!, status: 'failed', requested: false, updatedAt: now(), error: error instanceof Error ? error.message : 'Detail fetching failed.' } });
        }
        throw error;
      }).finally(() => { if (active.get(id) === operation) active.delete(id); });
      // Explicit starts are polled; ensure consumers still receive the rejection.
      void operation.promise.catch(() => undefined);
    }
    if (explicit && pending.explicit) return { pending, consumer: pending.explicit };
    const consumer = Symbol(); pending.consumers.add(consumer);
    if (explicit) {
      pending.explicit = consumer;
      const value = state(id);
      if (!value.details?.requested) write({ ...value, details: { ...value.details!, requested: true }, updatedAt: now() });
    }
    return { pending, consumer };
  };
  return {
    running(id: string) { return active.has(id); },
    /** Listing-only browser rows whose page a configured provider reads without a browser. */
    async readable(ids: readonly string[], signal: AbortSignal): Promise<ReadonlySet<string>> {
      const urls = new Map(ids.flatMap(id => {
        const offer = offers.get(id);
        return store.get(id)?.extractorVersion === listingOnly && offer?.url && !offer.text.trim() ? [[id, offer.url] as const] : [];
      }));
      if (!urls.size || !reader.covers) return new Set();
      const covered = await reader.covers([...new Set(urls.values())], signal);
      return new Set([...urls].filter(([, url]) => covered.has(url)).map(([id]) => id));
    },
    start(id: string, force = false) {
      if (force && state(id).status === 'analyzing') throw new OperationError('details_busy', 'Wait for analysis to finish before refreshing its source.');
      acquire(id, force, true); return state(id);
    },
    async ensure(id: string, force: boolean, signal: AbortSignal) {
      if (signal.aborted) throw new OperationError('cancelled', 'Analysis was cancelled.');
      const { pending, consumer } = acquire(id, force, false);
      if (!pending || !consumer) return;
      let abort: () => void = () => undefined;
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => { release(id, pending, consumer); reject(new OperationError('cancelled', 'Analysis was cancelled.')); };
        signal.addEventListener('abort', abort, { once: true });
      });
      try { await Promise.race([pending.promise, cancelled]); }
      finally { signal.removeEventListener('abort', abort); pending.consumers.delete(consumer); }
    },
    cancel(id: string) {
      state(id);
      const pending = active.get(id);
      if (!pending?.explicit) return;
      const consumer = pending.explicit; pending.explicit = undefined;
      release(id, pending, consumer);
      if (active.get(id) === pending) {
        const value = state(id);
        write({ ...value, updatedAt: now(), details: { ...value.details!, requested: false } });
      }
    },
    close() { closed = true; for (const pending of active.values()) pending.controller.abort(); active.clear(); }
  };
};
