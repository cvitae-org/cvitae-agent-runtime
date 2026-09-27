import { setTimeout as delay } from 'node:timers/promises';
import type { DiscoverySqlPort } from '../contracts/discovery-chat.js';
import { collectionLimits as limits, type CollectionCoverage } from '../contracts/offer-collection.js';
import { OperationError } from '../contracts/operation-error.js';
import type { createDiscoveryService } from './discovery.js';
import type { createDiscoverySearchStore } from '../storage/sqlite/discovery-searches.js';
import type { OfferQueryStore } from '../storage/sqlite/offer-query-store.js';

/** Uses existing ingestion and published-details paths; no canonical AI analysis. */
export function createCollectionPort(discovery:ReturnType<typeof createDiscoveryService>,searches:ReturnType<typeof createDiscoverySearchStore>,queries:OfferQueryStore,fetchDetails:(id:string,signal:AbortSignal)=>Promise<unknown>,timing={searchMs:limits.deadlineMs as number,detailsMs:limits.detailDeadlineMs as number}):NonNullable<DiscoverySqlPort['collection']> {
 return {
  defaults:id=>{const s=searches.get(id);return {phrase:s.phrase,boards:s.boards};},
  async run(context,keyword,signal,progress) {
   signal.throwIfAborted();
   if(!context.request.collection || context.request.scope!=='all' || context.request.version!==2) throw new OperationError('query_scope_conflict','Explicit collection in saved-search scope is required.');
   const owner=context.request.searchId, search=searches.get(owner), boards=[...new Set(search.boards)];
   if(search.kind==='browser_import'||search.boardThread?.mode==='browser') throw new OperationError('browser_capture_required','Open this search in Cvitae Browser to import jobs.');
   if(!boards.length || boards.length>limits.boards || !keyword.trim() || keyword.length>300) throw new OperationError('invalid_query','Invalid collection keyword or sources.');
   const coverage:CollectionCoverage={keyword,status:'searching',sources:boards.map(board=>({board,attempts:1,batches:0,received:0,state:{board,status:'loading'}})),received:0,added:0,detailsCompleted:0,detailsUnavailable:0,partial:false,limitations:[]};
   const ids=new Set<string>();
   await discovery.boards();
   signal.throwIfAborted();
   const session=discovery.start({searchId:owner,keyword,boards,pageSize:limits.pageSize,collection:true});
   const abort=()=>discovery.cancel(session.id);
   signal.addEventListener('abort',abort,{once:true});
   let after=0;const deadline=Date.now()+timing.searchMs;
   try {
    progress(structuredClone(coverage));
    while(true) {
     signal.throwIfAborted();
     const page=discovery.poll(session.id,after);after=page.after;
     for(const event of page.events) if(event.kind==='batch') {
      const source=coverage.sources.find(s=>s.board===event.board)!;source.batches++;source.received+=event.items!.length;coverage.added+=event.added??0;
      for(const item of event.items!) ids.add(item.offer.id);
     }
     for(const state of page.boards) {
      const source=coverage.sources.find(s=>s.board===state.board)!;
      source.state={...state,coverage:source.state.coverage==='first-page'?'first-page':state.coverage,
       limitations:[...new Set([...(source.state.limitations??[]),...(state.limitations??[])])]};
     }
     coverage.received=ids.size;
     if(page.events.length) progress(structuredClone(coverage));
     if(Date.now()>=deadline) {coverage.partial=true;coverage.limitations.push('collection_deadline');
      for(const source of coverage.sources) if(source.state.status==='loading') source.state={...source.state,status:'cancelled'};
      break;}
     if(page.hasMoreEvents) continue;
     let waiting=false;
     for(const source of coverage.sources) {
      const state=source.state;
      if(state.status==='loading') {waiting=true;continue;}
      const retries=source.attempts-source.batches;
      const retry=state.status==='error' && ['error','unavailable'].includes(state.error?.status??'') && retries<=limits.retriesPerBoard;
      if((state.status==='ready' || retry) && source.batches<limits.batchesPerBoard && source.attempts<limits.batchesPerBoard+limits.retriesPerBoard) {
       source.attempts++;discovery.next(session.id,source.board);waiting=true;
      }
     }
     if(!waiting) break;
     await delay(20,undefined,{signal});
    }
   } finally {signal.removeEventListener('abort',abort);discovery.cancel(session.id);}
   signal.throwIfAborted();
   coverage.partial ||= coverage.sources.some(s=>s.state.status!=='exhausted' && s.state.error?.status!=='empty');
   // Adapter first-page/sitemap limitations apply even when pagination is exhausted.
   for(const source of coverage.sources) for(const limitation of source.state.limitations??[]) if(!coverage.limitations.includes(limitation)) coverage.limitations.push(limitation);
   coverage.partial ||= coverage.limitations.length>0 || coverage.sources.some(s=>s.state.coverage==='first-page');
   coverage.status='fetching';progress(structuredClone(coverage));
   const detailsSignal=AbortSignal.any([signal,AbortSignal.timeout(timing.detailsMs)]);
   const selected=[...ids];let next=0;
   await Promise.all([0,1].map(async()=>{
    while(next<selected.length && !detailsSignal.aborted) {
     const id=selected[next++]!;
     try {await fetchDetails(id,detailsSignal);detailsSignal.throwIfAborted();coverage.detailsCompleted++;}
     catch { /* A missing source stays unknown. No automatic analysis or retries. */ }
     if(!signal.aborted) progress(structuredClone(coverage));
    }
   }));
   signal.throwIfAborted();
   coverage.detailsUnavailable=ids.size-coverage.detailsCompleted;
   if(coverage.detailsUnavailable) {coverage.partial=true;coverage.limitations.push('published_details_incomplete');}
   coverage.status='complete';progress(structuredClone(coverage));
   const scope={kind:'search' as const,searchId:owner};
   const snapshot=await queries.capture(owner,scope,signal);
   return {...context,collection:coverage,scopeCount:queries.members(owner,snapshot.id).length,revision:searches.get(owner).revision,capturedMembers:undefined,evidence:[],sqlArtifact:undefined,
    queryContext:{scope,snapshotId:snapshot.id,scopeRevision:snapshot.fingerprint!},
    limitations:[...(context.limitations??[]),'Collection covers only the listed source requests and their adapter coverage, never the entire job market. Final SQL includes previously saved offers as well as collected offers. Published fetching may reuse cached details.']};
  }
 };
}
