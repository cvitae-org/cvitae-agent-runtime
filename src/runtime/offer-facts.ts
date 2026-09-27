import { setTimeout as delay } from 'node:timers/promises';
import type { FactPort } from '../contracts/discovery-chat.js';
import type { FactSource } from '../contracts/offer-facts.js';
import { factLimits } from '../contracts/offer-facts.js';
import { OperationError } from '../contracts/operation-error.js';
import type { OfferQueryStore } from '../storage/sqlite/offer-query-store.js';
import type { createOfferFactStore } from '../storage/sqlite/offer-facts.js';
import { hash } from '../storage/sqlite/offer-query-projection.js';
export function createFactPort(queries:OfferQueryStore,facts:ReturnType<typeof createOfferFactStore>,fetch:(offerId:string,signal:AbortSignal)=>Promise<void>,configuration:()=>string=()=>"default"):FactPort {
 const locks=new Set<string>();
 return {
  modelVersion:choice=>JSON.stringify({...choice,configurationHash:hash(configuration())}),
  cached:facts.cached,save:facts.save,
  async lock(key,signal) {
   while(locks.has(key)||locks.size>=factLimits.concurrency) {signal.throwIfAborted();await delay(20,undefined,{signal});}
   signal.throwIfAborted();locks.add(key);return ()=>{locks.delete(key);};
  },
  async prepare(context,signal) {
   const artifact=context.sqlArtifact!,owner=context.request.searchId;
   const execution=queries.get(owner,artifact.executionId);
   // Conservative identifier check after child validation; do not parse SQL on the parent.
   if(/\boffer_extracted_facts\b/i.test(execution.request.sql)) throw new OperationError('query_invalid_sql','Extraction candidates must use published data only. Do not filter by offer_extracted_facts before extracting the criterion. Return SELECT o.offer_id FROM offers o with only published predicates.');
   if(execution.state!=='succeeded'||execution.result?.identityIndex===null||execution.result?.identityIndex===undefined) throw new OperationError('query_scope_not_offers','Extraction requires a simple single-offers SELECT of o.offer_id FROM offers o with published WHERE predicates. No aggregates, joins, CTEs or computed identities.');
   const result=queries.readResult(owner,artifact.executionId),index=result.identityIndex!;
   const ids=[...new Set(result.rows.map(row=>row[index] as string))];
   const members=queries.members(owner,context.queryContext!.snapshotId), sources:FactSource[]=[];let unavailable=0;
   for(const id of ids.slice(0,factLimits.offers)) {
    signal.throwIfAborted();const member=members.find(m=>m.offer_id===id);
    if(!member) throw new OperationError('query_scope_conflict','An extraction candidate is outside the captured scope.');
    let evidence=queries.source(member.evidence_id,id);
    if(!evidence.offer.text?.trim()) {
     try {
      await fetch(id,signal);signal.throwIfAborted();
      const current=queries.currentEvidence(owner,id);
      if(current) {member.evidence_id=current;evidence=queries.source(current,id);}
     } catch(error) {if(signal.aborted)throw error;unavailable++;continue;}
    }
    const text=evidence.offer.text??'';
    if(!text.trim()||Buffer.byteLength(text)>factLimits.sourceBytes) {unavailable++;continue;}
    sources.push({offerId:id,evidenceId:member.evidence_id,text,sourceHash:hash(text)});
   }
   return {sources,candidates:ids.length,unavailable,members:members.filter(m=>ids.includes(m.offer_id))};
  },
  async refresh(context,batch,signal) {
   // Preserve accepted membership/metadata, updating only evidence fetched for a
   // selected candidate. Facts are captured transactionally into a new snapshot.
   const snapshot=await queries.capture(context.request.searchId,context.queryContext!.scope,signal,batch.members);
   return {...context,queryContext:{...context.queryContext!,snapshotId:snapshot.id,scopeRevision:snapshot.fingerprint!}};
  }
 };
}
