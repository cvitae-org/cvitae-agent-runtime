import { discoveryVisibility } from './discovery-visibility.js';
import { publishedExtractorVersion } from '../../contracts/field-evidence.js';
import type { DetailJob, DetailJobStatus, DetailQueueStore } from '../../contracts/detail-queue.js';
import { OperationError } from '../../contracts/operation-error.js';
import type { Db } from './open.js';
export const createDetailQueueStore = (db: Db): DetailQueueStore => {
 const visibility = discoveryVisibility(db);
 const sequence = () => (db.prepare('UPDATE discovery_detail_queue_state SET revision=revision+1 WHERE id=1 RETURNING revision AS n').get() as {n:number}).n;
 const set = (id: string, status: DetailJobStatus, stopReason?: DetailJob['stopReason']) => { db.prepare('UPDATE discovery_detail_queue SET status=?,stop_reason=?,revision=? WHERE offer_id=?').run(status,stopReason??null,sequence(),id); };
 const paused = () => !!(db.prepare('SELECT paused FROM discovery_detail_queue_state WHERE id=1').get() as {paused:number}).paused;
 return {
  enqueue: db.transaction((searchId: string, requested: readonly string[], options: { readable?: ReadonlySet<string>; members?: boolean } = {}) => {
   const belongs = db.prepare("SELECT 1 FROM discovery_search_members m JOIN discovery_searches s ON s.id=m.search_id WHERE m.search_id=? AND m.offer_id=? AND s.status='ready'");
   const ids = options.members ? requested.filter(id => belongs.get(searchId,id)) : requested;
   if (ids.some(id => !belongs.get(searchId,id))) throw new OperationError('offer_out_of_scope','An offer does not belong to this saved search.');
   const existing = db.prepare('SELECT status FROM discovery_detail_queue WHERE offer_id=?');
   const pending = (db.prepare("SELECT count(*) AS n FROM discovery_detail_queue WHERE status IN ('queued','running')").get() as {n:number}).n;
   const unique = [...new Set(ids)].filter(id => {
    // Feed and browser captures are refreshed through their acquisition flow,
    // except a listing row whose page a provider reads.
    const source = db.prepare('SELECT value FROM offer_enrichments WHERE offer_id=?').get(id) as {value:string}|undefined;
    if (source && /^(listing|browser):/.test((JSON.parse(source.value) as {extractorVersion?:string}).extractorVersion??'') && !options.readable?.has(id)) return false;
    const prior=existing.get(id) as {status:string}|undefined;
    if(!prior) return true;
    if(prior.status!=='succeeded') return false;
    const row=db.prepare('SELECT value FROM offer_enrichments WHERE offer_id=?').get(id) as {value:string}|undefined;
    const fetched=row?(JSON.parse(row.value) as {detailsFetchedAt?:number}).detailsFetchedAt:undefined;
    const version=row?(JSON.parse(row.value) as {extractorVersion?:string}).extractorVersion:undefined;
    return ![publishedExtractorVersion,'reader-v1'].includes(version??'') || fetched===undefined || Date.now()-fetched>=7*24*60*60*1000;
   });
   if (pending + unique.length > 10000) throw new OperationError('details_queue_full','The detail queue is full. Wait for current offers to finish.');
   for (const id of unique) db.prepare("INSERT INTO discovery_detail_queue(offer_id,search_id,status,stop_reason,revision) VALUES(?,?,'queued',NULL,?) ON CONFLICT(offer_id) DO UPDATE SET search_id=excluded.search_id,status='queued',stop_reason=NULL,revision=excluded.revision").run(id,searchId,sequence());
   return unique;
  }).immediate,
  forgetCancelledSearch: (searchId: string) => { db.prepare("DELETE FROM discovery_detail_queue WHERE search_id=? AND status IN ('cancelled','failed')").run(searchId); },
  forSearch: (searchId: string) => db.prepare("SELECT offer_id AS offerId,search_id AS searchId,status,revision FROM discovery_detail_queue WHERE search_id=? AND status IN ('queued','running')").all(searchId) as DetailJob[],
  next: () => {
   for (const job of db.prepare("SELECT offer_id AS offerId,search_id AS searchId,status,stop_reason AS stopReason,revision FROM discovery_detail_queue WHERE status='queued' ORDER BY revision").all() as DetailJob[]) {
    if (job.searchId && visibility.suppressed(job.searchId,job.offerId)) { set(job.offerId,'cancelled'); continue; }
    return job;
   }
   return undefined;
  },
  set,
  poll(after) {
   const jobs = db.prepare('SELECT offer_id AS offerId,search_id AS searchId,status,stop_reason AS stopReason,revision FROM discovery_detail_queue WHERE revision>? ORDER BY revision LIMIT 51').all(after) as DetailJob[];
   const page = jobs.slice(0,50);
   const count = (status: string) => (db.prepare('SELECT count(*) AS n FROM discovery_detail_queue WHERE status=?').get(status) as {n:number}).n;
   return { jobs:page,after:page.at(-1)?.revision ?? after,hasMore:jobs.length>50,queued:count('queued'),running:count('running'),paused:paused() };
  },
  pause(value) { db.prepare('UPDATE discovery_detail_queue_state SET paused=? WHERE id=1').run(value?1:0); },
  clearQueued: db.transaction(() => {
   const jobs=db.prepare("SELECT offer_id AS offerId FROM discovery_detail_queue WHERE status='queued'").all() as {offerId:string}[];
   for (const job of jobs) set(job.offerId,'cancelled');
   return jobs.length;
  }).immediate,
  paused,
  recover() { for (const row of db.prepare("SELECT offer_id FROM discovery_detail_queue WHERE status='running'").all() as {offer_id:string}[]) set(row.offer_id,'queued'); }
 };
};
