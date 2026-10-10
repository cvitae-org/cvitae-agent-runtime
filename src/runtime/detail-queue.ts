import type { DetailQueueStore } from '../contracts/detail-queue.js';
import { OperationError } from '../contracts/operation-error.js';
import { RuntimeError } from '../contracts/run.js';
import type { createEnrichmentService } from './enrichment.js';
type RequestLedger = {
 reserveRequest(searchId: string, kind: 'detail'): boolean;
 refundRequest(searchId: string, kind: 'detail'): void;
 requestUsage(searchId: string): unknown;
};
/** A failed read is kept by its error's code; `unknown` for an error with none, such as a dropped connection. */
const failureCode = (error: unknown): string => error instanceof OperationError || error instanceof RuntimeError ? error.code : 'unknown';
/** Two background consumers reserve capacity for explicit detail/analysis requests. */
export const createDetailQueue = (store: DetailQueueStore, enrichment: ReturnType<typeof createEnrichmentService>, requests?: RequestLedger) => {
 const active = new Map<string, AbortController>();
 const pending = new Map<string, Promise<void>>();
 const stopping = new Set<string>();
 const lifetime = new AbortController();
 let closed = false; let timer: ReturnType<typeof setTimeout> | undefined;
 store.recover();
 const schedule = () => { if (!closed && !timer) { timer=setTimeout(() => {timer=undefined;pump();},250); timer.unref(); } };
 const pump = () => {
  if (closed || store.paused()) return;
  while (active.size<2) {
   const job=store.next(); if (!job) return;
   if (job.searchId && requests && !requests.reserveRequest(job.searchId,'detail')) {
    store.set(job.offerId,'cancelled','request_budget');
    continue;
   }
   const controller=new AbortController(); active.set(job.offerId,controller); store.set(job.offerId,'running');
   const task = enrichment.details.ensure(job.offerId,false,controller.signal).then(() => {
    if (!closed) store.set(job.offerId,controller.signal.aborted?(stopping.has(job.offerId)?'queued':'cancelled'):'succeeded');
   }).catch((error: unknown) => {
    if (closed) return;
    // Explicit operations can occupy all source slots; capacity is not a source failure.
    const capacity=error instanceof OperationError && error.code==='details_capacity';
    if (capacity && job.searchId && requests) requests.refundRequest(job.searchId,'detail');
    if (controller.signal.aborted) store.set(job.offerId,stopping.has(job.offerId)?'queued':'cancelled');
    else if (capacity) store.set(job.offerId,'queued');
    else store.set(job.offerId,'failed',failureCode(error));
   }).finally(() => { stopping.delete(job.offerId); active.delete(job.offerId); pending.delete(job.offerId); schedule(); });
   pending.set(job.offerId,task);
  }
 };
 schedule();
 return {
  async cancelSearch(searchId: string) {
   const waits: Promise<void>[] = [];
   for (const job of store.forSearch?.(searchId) ?? []) {
    stopping.delete(job.offerId);
    store.set(job.offerId,'cancelled');
    active.get(job.offerId)?.abort();
    const task = pending.get(job.offerId); if (task) waits.push(task);
   }
   await Promise.allSettled(waits);
   store.forgetCancelledSearch?.(searchId);
  },
  /** Returns the offers queued. `members` skips offers outside the search instead of refusing the batch. */
  async enqueue(searchId: string, ids: readonly string[], members = false) {
   const readable = await enrichment.details.readable(ids,lifetime.signal);
   if (closed) return [];
   const queued = store.enqueue(searchId,ids,{readable,members}); pump(); return queued;
  },
  poll(after=0) { const page=store.poll(after); return {...page,items:page.jobs.map(job=>(()=>{const result=enrichment.get(job.offerId);return {...result,offer:{...result.offer,text:''},autoDetailStatus:job.status,autoDetailStopReason:job.stopReason,...(job.searchId&&requests?{searchId:job.searchId,requestUsage:requests.requestUsage(job.searchId)}:{})};})())}; },
  pause(value: boolean) { store.pause(value); if (!value) pump(); },
  stop() { store.pause(true); for (const [id,controller] of active) { stopping.add(id); store.set(id,'queued'); controller.abort(); } },
  clear() { store.pause(true); store.clearQueued(); for (const [id,controller] of active) { stopping.delete(id); store.set(id,'cancelled'); controller.abort(); } },
  cancel(id: string) { const controller=active.get(id); if (controller) controller.abort(); store.set(id,'cancelled'); },
  close() { closed=true;lifetime.abort();if(timer)clearTimeout(timer);for(const controller of active.values())controller.abort(); }
 };
};
