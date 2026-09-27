import { setTimeout as delay } from 'node:timers/promises';
import type { DiscoverySqlPort, DiscoveryAnswerContext } from '../contracts/discovery-chat.js';
import { OperationError } from '../contracts/operation-error.js';
import type { createOfferQueryService } from './offer-query.js';
import type { OfferQueryStore } from '../storage/sqlite/offer-query-store.js';

export function createDiscoverySqlPort(service: ReturnType<typeof createOfferQueryService>, store: OfferQueryStore, record: (context:DiscoveryAnswerContext)=>DiscoveryAnswerContext, facts?:DiscoverySqlPort['facts'], collection?:DiscoverySqlPort['collection']): DiscoverySqlPort {
 return {
  record, facts, collection, schema: service.schema,
  async capture(context,signal) {
   if(context.queryContext) return context.queryContext;
   const scope={kind:'search' as const,searchId:context.request.searchId};
   // Legacy membership and metadata were captured at acceptance, never recaptured live.
   if(!context.capturedMembers) throw new OperationError('query_scope_expired','The original scope is unavailable. Resend this question.');
   const s=await store.capture(context.request.searchId,scope,signal,context.capturedMembers);
   return {snapshotId:s.id,scopeRevision:s.fingerprint!,scope};
  },
  async execute(context,sql,params,attempt,signal) {
   signal.throwIfAborted();
   const c=context.queryContext!, ownerSearchId=context.request.searchId;
   const request={ownerSearchId,scope:c.scope,snapshotId:c.snapshotId,expectedScopeRevision:c.scopeRevision,schemaVersion:1 as const,sql,params};
   await service.validate(request,signal);
   signal.throwIfAborted();
   const {executionId}=service.start({...request,requestId:`chat:${context.request.runId}:${attempt}`,origin:'chat'});
   const abort=()=>{void service.cancel(ownerSearchId,executionId).catch(()=>undefined);};
   signal.addEventListener('abort',abort,{once:true});
   try {
    while(['queued','capturing','running'].includes(service.get(ownerSearchId,executionId).state)) {
     if(signal.aborted) {await service.cancel(ownerSearchId,executionId); signal.throwIfAborted();}
     await delay(20);
    }
    signal.throwIfAborted();
    const execution=service.get(ownerSearchId,executionId);
    if(execution.error) throw new OperationError(execution.error.code,execution.error.message);
    const page=service.page(ownerSearchId,executionId,undefined,50);
    // Entire persisted SQL result stays accessible via paging. Only a bounded
    // prefix is supplied to the model; never truncate values silently.
    const rows:typeof page.rows=[]; let bytes=0;
    for(const row of page.rows) {const n=Buffer.byteLength(JSON.stringify(row)); if(bytes+n>12000) break; rows.push(row);bytes+=n;}
    const evidence=page.references.filter(ref=>ref.row<rows.length).map((ref,index)=>({
     reference:{offerId:ref.offerId,evidenceId:ref.evidenceId,marker:index+1,label:page.columns.flatMap((c,i)=>c.origin?.relation==='offers' && ['role','company'].includes(c.origin.column) && typeof rows[ref.row]?.[i]==='string' ? [rows[ref.row]![i]] : []).join(' · ') || ref.offerId},
     facts:{resultRow:ref.row},excerpt:''
    }));
    return record({...context,capturedMembers:undefined,evidence,
     limitations:[...(context.limitations??[]),...(page.truncated?['SQL output reached its row or byte limit.']:[]),...(rows.length<execution.returnedRowCount?['The model received only a bounded prefix of the stored SQL result; no exhaustive claim is supported.']:[])],
     sqlArtifact:{collection:context.collection,version:1,executionId,sql,params,schemaVersion:1,snapshotId:c.snapshotId,scope:c.scope,columns:page.columns,rows,
      returnedRowCount:execution.returnedRowCount,truncated:page.truncated,contextTruncated:rows.length<execution.returnedRowCount,elapsedMs:execution.timing?.totalMs??0,
      budget:{calls:0,chargedTokens:0,estimated:false}}
    });
   } finally {signal.removeEventListener('abort',abort);}
  }
 };
}
