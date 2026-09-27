import { OperationError } from '../src/contracts/operation-error.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { spine, stubGateway } from './support/spine.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createDiscoverySearchStore } from '../src/storage/sqlite/discovery-searches.js';
import { createOfferQueryStore } from '../src/storage/sqlite/offer-query-store.js';
import { createOfferFactStore, factRows } from '../src/storage/sqlite/offer-facts.js';
import { createOfferQueryService } from '../src/runtime/offer-query.js';
import { createFactPort } from '../src/runtime/offer-facts.js';
import { hash } from '../src/storage/sqlite/offer-query-projection.js';
import { criterionHash, extractTargetedFacts, validateFacts } from '../src/capabilities/offers/targeted-facts.js';
import { criteriaSchema, extractorVersion, type Criterion, type FactSource, type StoredFact } from '../src/contracts/offer-facts.js';
import { createConversationStore } from '../src/storage/sqlite/conversations.js';
import { createDiscoveryChatStore } from '../src/storage/sqlite/discovery-chat.js';
import { createDiscoveryChatService } from '../src/runtime/discovery-chat.js';
import { createDiscoverySqlPort } from '../src/runtime/discovery-sql.js';
import { askDiscoverySql } from '../src/capabilities/askDiscoverySql.js';
import { beginRun } from '../src/runtime/run.js';
import { bindDiscoveryScope } from '../src/runtime/discovery-scope.js';
import type { DiscoverySqlArtifact } from '../src/contracts/discovery-chat.js';
const criterion:Criterion={key:'team_size',question:'How many engineers are in this role’s team?',valueType:'number'};
const controller=new AbortController();
const source:FactSource={offerId:'o0',evidenceId:'e',text:'Our team has 4 engineers.',sourceHash:hash('Our team has 4 engineers.')};
const fact:StoredFact={criterionKey:criterion.key,status:'stated',value:4,evidenceQuote:source.text,...source,criterion,criterionHash:criterionHash(criterion),modelVersion:'test',extractorVersion,extractedAt:1};
function fixture(count=3) {
 const s=spine({}),offers=createOfferStore(s.db),searches=createDiscoverySearchStore(s.db,offers),qs=createOfferQueryStore(s.db),q=createOfferQueryService(qs),facts=createOfferFactStore(s.db);
 searches.create('s','engineers',['justjoin']);
 for(let i=0;i<count;i++){offers.sight([{id:`o${i}`,text:i===1?'We are a company of 100 people.':'Our team has 4 engineers.'}],1);searches.add('s',[{offer:offers.get(`o${i}`)!,listing:{url:'https://example.test/job',title:'Engineer',titleSource:'board',board:'justjoin'}}]);}
 return {s,offers,searches,qs,q,facts,close(){q.close();s.dispose();}};
}
test('criteria and quote validation preserve unknown, enforce types and reject fabricated quotes',()=>{
 assert.throws(()=>criteriaSchema.parse([criterion,criterion]));assert.throws(()=>criteriaSchema.parse(Array.from({length:6},(_,i)=>({...criterion,key:`k${i}`}))));
 assert.throws(()=>validateFacts(source,[criterion],[{...fact,value:'4'}]));
 assert.throws(()=>validateFacts(source,[criterion],[{...fact,evidenceQuote:'5 engineers'}]));
 assert.throws(()=>validateFacts(source,[criterion],[{...fact,status:'not_stated',value:0}]));
 assert.deepEqual(validateFacts(source,[criterion],[{...fact,status:'not_stated',value:null,evidenceQuote:null}])[0]?.value,null);
 assert.equal(validateFacts({...source,text:'Our team\n has 4 engineers.'},[criterion],[fact])[0]?.value,4);
});
test('semantic verification downgrades matching but non-entailing quotes, negation and conditional claims',async()=>{
 for(const text of ['Our company has 4 engineers.','Our team does not have 4 engineers.','If approved, our team may grow to 4 engineers.','Our team has 4 engineers. Another section says it has 7.']) {
  let calls=0;
  const facts=await extractTargetedFacts({...source,text},[criterion],'test',async(schema,system,prompt)=>{
   calls++;assert.ok(prompt.includes(text));
   if(calls===2)assert.match(system,/negation, conditional/);
   return schema.parse(calls===1?{facts:[{criterionKey:'team_size',status:'stated',value:4,evidenceQuote:text}]}:{checks:[{criterionKey:'team_size',entailed:false}]});
  },controller.signal);
  assert.equal(calls,2);assert.equal(facts[0]?.status,'ambiguous');assert.equal(facts[0]?.value,null);
 }
});
test('fact cache keys definition, source and model; snapshots remain immutable and canonical offers unchanged',async()=>{
 const f=fixture();try {
  const before=f.offers.get('o0'),scope={kind:'search' as const,searchId:'s'},a=await f.qs.capture('s',scope);
  f.facts.save(source,[fact],controller.signal);
  assert.equal(f.facts.cached(source,[criterion],'test')?.length,1);
  assert.equal(f.facts.cached(source,[{...criterion,question:'How many engineers in the company?'}],'test'),null);
  assert.equal(f.facts.cached(source,[criterion],'different-model'),null);
  assert.equal(f.facts.cached({...source,sourceHash:'changed'},[criterion],'test'),null);
  const b=await f.qs.capture('s',scope);assert.notEqual(a.id,b.id);assert.notEqual(a.fingerprint,b.fingerprint);
  const batches=async(id:string)=>{const out=[];for await(const batch of f.qs.batches(id))out.push(...batch);return out;};
  assert.equal((await batches(a.id))[0]?.tables.offer_extracted_facts?.length,0);
  assert.equal((await batches(b.id))[0]?.tables.offer_extracted_facts?.length,1);
  assert.deepEqual(f.offers.get('o0'),before);
  assert.equal(factRows(f.s.db,'o0','changed description')[0]?.[10],1);
  assert.equal(createOfferFactStore(f.s.scratch.connect()).cached(source,[criterion],'test')?.[0]?.value,4);
  const aborted=new AbortController();aborted.abort();assert.throws(()=>f.facts.save(source,[{...fact,modelVersion:'cancelled'}],aborted.signal));
  assert.equal(f.facts.cached(source,[criterion],'cancelled'),null);
 }finally{f.close();}
});
test('shared extraction locks bound concurrency, cancellation and deduplicate cache after waiting',async()=>{
 const f=fixture();try {
  const port=createFactPort(f.qs,f.facts,async()=>assert.fail('unexpected fetch'));
  const release=await port.lock('o0',controller.signal),second=await port.lock('o1',controller.signal);
  const cancel=new AbortController();const pending=port.lock('o2',cancel.signal);cancel.abort();await assert.rejects(pending);
  let acquired=false;const waiter=port.lock('o0',controller.signal).then(unlock=>{acquired=true;unlock();});
  await delay(30);assert.equal(acquired,false);release();second();await waiter;
 }finally{f.close();}
});
async function chatFixture(count=3,slow=false,invalidFirst:boolean|'premature'=false,failExtraction=false) {
 const f=fixture(count),store=createDiscoveryChatStore(f.s.db,createConversationStore(f.s.db),Date.now,f.qs);
 let plans=0,extractions=0;
 const ai=stubGateway({
  async generateObject(request) {
   let value:unknown;
   if(request.system?.startsWith('Plan')) {
    plans++;const after=JSON.parse(request.prompt).extraction;
    value=after?{sql:'SELECT o.offer_id FROM offers o WHERE EXISTS (SELECT 1 FROM offer_extracted_facts f WHERE f.offer_id=o.offer_id AND f.criterion_hash=:criterion AND f.status=\'stated\' AND f.stale=0 AND f.value_number<=:size)',params:[{name:'criterion',value:criterionHash(criterion)},{name:'size',value:5}],clarification:null,extraction:null}:{sql:'SELECT o.offer_id FROM offers o ORDER BY o.offer_id',params:[],clarification:null,extraction:{criteria:[criterion]}};
    if(invalidFirst && plans===1) value={...(value as object),sql:invalidFirst==='premature'?"SELECT o.offer_id FROM offers o WHERE EXISTS (SELECT 1 FROM offer_extracted_facts f WHERE f.offer_id=o.offer_id)":'SELECT count(*) FROM offers'};
   } else if(request.system?.startsWith('Extract')) {
    extractions++;if(failExtraction)throw new OperationError('model_call_failed','Synthetic provider failure');if(slow)await delay(100,undefined,{signal:request.signal});
    const description=JSON.parse(request.prompt).description as string;
    value={facts:[description.includes('company')?{criterionKey:'team_size',status:'not_stated',value:null,evidenceQuote:null}:{criterionKey:'team_size',status:'stated',value:4,evidenceQuote:description}]};
   } else value={checks:[{criterionKey:'team_size',entailed:true}]};
   return {object:request.schema.parse(value),finishReason:'stop',usage:{totalTokens:50}};
  },
  async generateText(){return {text:'Matching offers based on explicit team size.',usage:{totalTokens:50},finishReason:'stop'};}
 });
 const handles:Promise<unknown>[]=[];
 const port=createFactPort(f.qs,f.facts,async()=>assert.fail('unexpected fetch'));
 const chat=createDiscoveryChatService(store,(scope,signal)=>{
  const handle=beginRun({...bindDiscoveryScope({...f.s.deps,effects:{...f.s.deps.effects,ai}}),timeoutMs:10000,capabilities:{ask_discovery:askDiscoverySql(scope,createDiscoverySqlPort(f.q,f.qs,store.recordSql,port))},finish:(id,result,commit)=>store.finish(id,result,commit)},{capability:'ask_discovery',input:{question:scope.request.question},runId:scope.request.runId,signal});
  handles.push(handle.settled.catch(()=>undefined));return handle;
 });
 const send=async(runId:string)=>{const c=await f.q.context('s',{kind:'search',searchId:'s'});chat.send({version:2,searchId:'s',conversationId:chat.get('s').conversationId,runId,question:'Find roles in teams of at most 5 engineers',scope:'all',filterRevision:0,language:'en',snapshotId:c.snapshotId,scopeRevision:c.scopeRevision!});return c;};
 return {...f,chat,send,settle:()=>Promise.all(handles),calls:()=>({plans,extractions}),close(){chat.close();f.close();}};
}
test('real chat → candidates → extract → new snapshot → requery, cache replay and published invariance',async()=>{
 const f=await chatFixture();try {
  const before=f.offers.get('o0');const initial=await f.send('r');await f.settle();
  assert.equal(f.s.runs.get('r')?.status,'succeeded',JSON.stringify(f.s.runs.get('r')));
  const a=(f.chat.get('s').messages.at(-1) as unknown as {queryArtifact:DiscoverySqlArtifact}).queryArtifact;
  assert.notEqual(a.snapshotId,initial.snapshotId);assert.deepEqual(a.rows,[['o0'],['o2']]);assert.equal(a.extraction?.notStated,1);assert.equal(a.extraction?.completed,3);assert.deepEqual(f.offers.get('o0'),before);
  await f.send('again');await f.settle();assert.equal(f.calls().extractions,3);
  const replay=(f.chat.get('s').messages.at(-1) as unknown as {queryArtifact:DiscoverySqlArtifact}).queryArtifact;assert.equal(replay.extraction?.cached,3);
 }finally{await f.settle();f.close();}
});
test('over ten candidates reports partial coverage and budgets do not treat unassessed as false',async()=>{
 const f=await chatFixture(12);try {
  await f.send('r');await f.settle();assert.equal(f.s.runs.get('r')?.status,'succeeded',JSON.stringify(f.s.runs.get('r')));
  const a=(f.chat.get('s').messages.at(-1) as unknown as {queryArtifact:DiscoverySqlArtifact;text:string});
  assert.equal(a.queryArtifact.extraction?.candidates,12);assert.equal(a.queryArtifact.extraction?.limited,true);assert.ok(a.queryArtifact.extraction!.completed<=10);assert.ok(a.queryArtifact.budget.calls<=24);assert.match(a.text,/Partial coverage/);
 }finally{await f.settle();f.close();}
});
test('cancelled extraction does not publish late facts or an answer',async()=>{
 const f=await chatFixture(3,true);try {
  await f.send('r');for(let i=0;i<400 && f.calls().extractions===0;i++)await delay(5);assert.ok(f.calls().extractions>0,JSON.stringify(f.s.runs.get('r')));f.chat.cancel('s','r');await f.settle();
  assert.equal(f.s.runs.get('r')?.status,'cancelled');assert.equal(f.chat.get('s').messages.length,1);
  assert.equal((f.s.db.prepare('SELECT count(*) AS n FROM offer_targeted_facts').get() as {n:number}).n,0);
 }finally{await f.settle();f.close();}
});

test('fetch-if-needed uses selected membership only, then new source hash excludes stale facts',async()=>{
 const f=fixture();try {
  const empty=f.offers.get('o0')!;
  f.searches.refreshOffer({...empty,text:''},{offerId:'o0',id:'details',status:'idle',updatedAt:1});
  const snap=await f.q.context('s',{kind:'search',searchId:'s'});
  const exec=f.q.start({ownerSearchId:'s',requestId:'candidate',schemaVersion:1,scope:{kind:'search',searchId:'s'},snapshotId:snap.snapshotId,expectedScopeRevision:snap.scopeRevision,sql:"SELECT o.offer_id FROM offers o WHERE o.offer_id='o0'",params:[],origin:'chat'});
  while(['queued','capturing','running'].includes(f.q.get('s',exec.executionId).state))await delay(10);
  let fetched=0;
  const port=createFactPort(f.qs,f.facts,async(id,signal)=>{signal.throwIfAborted();fetched++;assert.equal(id,'o0');f.searches.refreshOffer({...empty,text:'The team has 8 engineers.'},{offerId:'o0',id:'details',status:'idle',updatedAt:2,detailsFetchedAt:2});});
  const context={request:{searchId:'s'},queryContext:{snapshotId:snap.snapshotId,scopeRevision:snap.scopeRevision!,scope:{kind:'search',searchId:'s'}},sqlArtifact:{executionId:exec.executionId}} as Parameters<typeof port.prepare>[0];
  const batch=await port.prepare(context,controller.signal);
  assert.equal(fetched,1);assert.equal(batch.sources[0]?.text,'The team has 8 engineers.');assert.equal(batch.members.length,1);
  f.facts.save(source,[fact],controller.signal);
  const next=await port.refresh(context,batch,controller.signal);
  assert.notEqual(next.queryContext?.snapshotId,snap.snapshotId);
  const rows=f.qs.batches(next.queryContext!.snapshotId);const first=await rows.next();assert.equal(first.value?.[0]?.tables.offer_extracted_facts?.[0]?.[10],1);
 }finally{f.close();}

});

test('an aggregate candidate query is repaired before extraction within the SQL repair budget',async()=>{
 const f=await chatFixture(3,false,true);try {
  await f.send('r');await f.settle();assert.equal(f.s.runs.get('r')?.status,'succeeded',JSON.stringify(f.s.runs.get('r')));
  assert.equal(f.calls().plans,3);assert.equal(f.calls().extractions,3);
 }finally{await f.settle();f.close();}
});

test('premature extracted-fact filters cannot silently reduce the extraction candidate set to zero',async()=>{
 const f=await chatFixture(3,false,'premature');try {
  await f.send('r');await f.settle();assert.equal(f.s.runs.get('r')?.status,'succeeded',JSON.stringify(f.s.runs.get('r')));
  assert.equal(f.calls().plans,3);assert.equal(f.calls().extractions,3);
 }finally{await f.settle();f.close();}
});

test('all provider extraction failures produce an unknown outcome, never a no-matches claim',async()=>{
 const f=await chatFixture(3,false,false,true);try {
  await f.send('r');await f.settle();assert.equal(f.s.runs.get('r')?.status,'succeeded',JSON.stringify(f.s.runs.get('r')));
  const message=f.chat.get('s').messages.at(-1) as unknown as {text:string;queryArtifact:DiscoverySqlArtifact};
  assert.match(message.text,/Whether matching offers exist is unknown/);assert.equal(message.queryArtifact.extraction?.unavailable,3);assert.equal(message.queryArtifact.extraction?.limited,true);
 }finally{await f.settle();f.close();}
});
test('model cache namespace changes with the configured local endpoint without exposing it',()=>{
 const f=fixture();try {
  let endpoint='http://localhost:11434/v1';const port=createFactPort(f.qs,f.facts,async()=>{},()=>endpoint);
  const a=port.modelVersion({providerId:'local',modelId:'same-name'});endpoint='http://localhost:9999/v1';
  assert.notEqual(a,port.modelVersion({providerId:'local',modelId:'same-name'}));assert.ok(!a.includes('http://'));
 }finally{f.close();}
});

test('switching back to an earlier cached model exposes its facts instead of a newer model reading',()=>{
 const f=fixture();try {
  f.facts.save(source,[fact],controller.signal);
  f.facts.save(source,[{...fact,modelVersion:'newer',value:9,extractedAt:2}],controller.signal);
  assert.equal(factRows(f.s.db,'o0',source.text)[0]?.[3],9);
  assert.equal(factRows(f.s.db,'o0',source.text,'test')[0]?.[3],4);
 }finally{f.close();}
});
