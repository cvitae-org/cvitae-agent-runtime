import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {spine} from './support/spine.js';
import {createOfferStore} from '../src/storage/sqlite/offers.js';
import {createDiscoverySearchStore} from '../src/storage/sqlite/discovery-searches.js';
import {createDiscoveryCatalogue} from '../src/storage/sqlite/discovery.js';
import {createOfferQueryStore} from '../src/storage/sqlite/offer-query-store.js';
import {createDiscoveryService} from '../src/runtime/discovery.js';
import {createCollectionPort} from '../src/runtime/offer-collection.js';
import type {DiscoverySource,DiscoveryBoardId} from '../src/contracts/discovery.js';
import type {DiscoveryAnswerContext} from '../src/contracts/discovery-chat.js';
import type {CollectionCoverage} from '../src/contracts/offer-collection.js';

function fixture(source:DiscoverySource['search'],boards:DiscoveryBoardId[]=['vacancies'],fetchDetails: (id:string,signal:AbortSignal)=>Promise<unknown>=async()=>{},timing={searchMs:2000,detailsMs:1000}) {
 const s=spine({}),offers=createOfferStore(s.db),searches=createDiscoverySearchStore(s.db,offers),queries=createOfferQueryStore(s.db);
 searches.create('s','Original phrase',boards);
 const calls:Parameters<DiscoverySource['search']>[0][]=[];
 const discovery=createDiscoveryService(createDiscoveryCatalogue(s.db,offers),{boards:async()=>({version:1,boards:[]}),search:async(q,signal)=>{calls.push(q);return source(q,signal);}},Date.now,searches);
 const port=createCollectionPort(discovery,searches,queries,fetchDetails,timing);
 const context=async():Promise<DiscoveryAnswerContext>=>{
  const scope={kind:'search' as const,searchId:'s'},snapshot=await queries.capture('s',scope,new AbortController().signal);
  return {request:{version:2,collection:true,runId:'r',searchId:'s',conversationId:'c',question:'Find new React offers',scope:'all',filterRevision:0,language:'en'},queryContext:{scope,snapshotId:snapshot.id,scopeRevision:snapshot.fingerprint!},scopeCount:0,revision:1,evidence:[],history:[]};
 };
 return {s,searches,queries,port,calls,context,close:()=>{discovery.close();s.dispose();}};
}
const batch=(q:Parameters<DiscoverySource['search']>[0],hasMore=false,n=1)=>({status:'ok' as const,data:{version:1 as const,board:q.board,items:Array.from({length:n},(_,i)=>({board:q.board,url:`https://vacancies.example/offers/${q.board}-${q.cursor??'first'}-${i}`,title:'React engineer',titleSource:'board' as const})),nextCursor:hasMore?`${q.cursor??'first'}-next`:null,hasMore,coverage:'sitemap' as const,retrievedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),effectiveFilters:[{id:'keyword' as const,support:'local' as const,stage:'source' as const,requested:q.keyword,applied:true,detail:'Slug match.'}],unsupportedFilters:[],limitations:[]}});

test('collection persists through existing ingestion, changes snapshot, preserves manifest and reports selected sources',async()=>{
 const f=fixture(async q=>batch(q),['vacancies','rendered_jobs']);try {
  const c=await f.context(),progress:CollectionCoverage[]=[];
  const result=await f.port.run(c,'React',new AbortController().signal,v=>progress.push(v));
  assert.equal(result.scopeCount,2);assert.notEqual(result.queryContext!.snapshotId,c.queryContext!.snapshotId);
  assert.equal(f.queries.members('s',c.queryContext!.snapshotId).length,0);
  assert.equal(f.searches.get('s').phrase,'Original phrase');assert.deepEqual(f.calls.map(c=>c.board),['vacancies','rendered_jobs']);
  assert.equal(result.collection!.added,2);assert.equal(result.collection!.detailsCompleted,2);
  const repeated=await f.port.run(c,'React',new AbortController().signal,()=>{});
  assert.equal(repeated.collection!.added,0);assert.equal(repeated.scopeCount,2);
  assert.deepEqual([...new Set(progress.map(p=>p.status))],['searching','fetching','complete']);
  assert.equal((f.s.db.prepare('SELECT count(*) n FROM offer_targeted_facts').get() as {n:number}).n,0);
 }finally{f.close();}
});
test('two batches per source and sixty offers bound even sources with unlimited pagination',async()=>{
 const f=fixture(async q=>batch(q,true,10),['vacancies','rendered_jobs','html_jobs']);try {
  const result=await f.port.run(await f.context(),'React',new AbortController().signal,()=>{});
  assert.equal(f.calls.length,6);assert.equal(result.scopeCount,60);assert.equal(result.collection!.partial,true);
  assert.ok(result.collection!.sources.every(s=>s.attempts===2 && s.batches===2 && s.received===20));
 }finally{f.close();}
});
test('transient failures retry once; refusal, expired cursor and unsupported never retry',async()=>{
 for(const status of ['blocked','disallowed','expired_cursor','unsupported','error','unavailable'] as const) {
  const f=fixture(async()=>({status,detail:'fixture'}));try {
   const result=await f.port.run(await f.context(),'React',new AbortController().signal,()=>{});
   assert.equal(f.calls.length,['error','unavailable'].includes(status)?2:1,status);
   assert.equal(result.collection!.partial,true);assert.equal(result.collection!.sources[0]!.state.error!.status,status);
  }finally{f.close();}
 }
});
test('one retry total across pages; received offers survive later source refusal',async()=>{
 let n=0;const f=fixture(async q=>++n===1?{status:'unavailable',detail:'temporary'}:n===2?batch(q,true):{status:'blocked',detail:'refused'});try {
  const result=await f.port.run(await f.context(),'React',new AbortController().signal,()=>{});
  assert.equal(f.calls.length,3);assert.equal(result.collection!.received,1);assert.equal(result.collection!.sources[0]!.batches,1);assert.equal(result.scopeCount,1);
 }finally{f.close();}
});
test('parent cancellation aborts source, rejects result and ignores late non-cooperative completion',async()=>{
 let finish!:()=>void,sourceSignal!:AbortSignal;
 const f=fixture(async(q,signal)=>{sourceSignal=signal;await new Promise<void>(resolve=>finish=resolve);return batch(q);});try {
  const controller=new AbortController();const pending=f.port.run(await f.context(),'React',controller.signal,()=>{});
  await delay(25);controller.abort();await assert.rejects(pending);assert.equal(sourceSignal.aborted,true);
  finish();await delay(10);assert.equal(f.searches.get('s').count,0);
 }finally{f.close();}
});
test('deadline reports partial and aborts slow source; failed or timed-out details remain unknown',async()=>{
 let aborted=false;const f=fixture(async(q,signal)=>{await delay(500,undefined,{signal}).catch(()=>{aborted=true;});return batch(q);},['vacancies'],async()=>{}, {searchMs:25,detailsMs:25});try {
  const result=await f.port.run(await f.context(),'React',new AbortController().signal,()=>{});
  await delay(5);assert.equal(aborted,true);assert.equal(result.scopeCount,0);assert.ok(result.collection!.limitations.includes('collection_deadline'));
 }finally{f.close();}
 const g=fixture(async q=>batch(q,false,5),['vacancies'],async(_id,signal)=>{await delay(500,undefined,{signal});},{searchMs:1000,detailsMs:25});try {
  const result=await g.port.run(await g.context(),'React',new AbortController().signal,()=>{});
  assert.equal(result.collection!.detailsCompleted,0);assert.equal(result.collection!.detailsUnavailable,5);assert.equal(result.collection!.partial,true);
 }finally{g.close();}
});
test('detail stage uses two consumers; cancel preserves collected membership but publishes no final context',async()=>{
 let active=0,peak=0,aborted=0;
 const f=fixture(async q=>batch(q,false,5),['vacancies'],async(_id,signal)=>{active++;peak=Math.max(peak,active);try{await delay(500,undefined,{signal});}catch{aborted++;throw Error('cancelled');}finally{active--;}});try {
  const controller=new AbortController();const pending=f.port.run(await f.context(),'React',controller.signal,()=>{});
  await delay(40);controller.abort();await assert.rejects(pending);assert.equal(peak,2);assert.equal(aborted,2);assert.equal(f.searches.get('s').count,5);
 }finally{f.close();}
});
test('unrequested collection and result scope are rejected before external calls; oversized batches cannot persist',async()=>{
 const f=fixture(async q=>batch(q,false,11));try {
  const c=await f.context();await assert.rejects(f.port.run({...c,request:{...c.request,collection:undefined}},'React',new AbortController().signal,()=>{}),{code:'query_scope_conflict'});
  await assert.rejects(f.port.run({...c,request:{...c.request,scope:'results'}},'React',new AbortController().signal,()=>{}),{code:'query_scope_conflict'});
  assert.equal(f.calls.length,0);
  const result=await f.port.run(c,'React',new AbortController().signal,()=>{});assert.equal(result.scopeCount,0);assert.equal(result.collection!.partial,true);
 }finally{f.close();}
});

test('later batches cannot erase earlier adapter limitations or first-page coverage',async()=>{
 const f=fixture(async q=>{const result=batch(q,!q.cursor);if(!q.cursor){return {...result,data:{...result.data,coverage:'first-page' as const,limitations:['Only a subset of listings is available.']}};}return result;});try {
  const result=await f.port.run(await f.context(),'React',new AbortController().signal,()=>{});
  assert.equal(result.collection!.sources[0]!.state.coverage,'first-page');
  assert.deepEqual(result.collection!.sources[0]!.state.limitations,['Only a subset of listings is available.']);
  assert.equal(result.collection!.partial,true);
 }finally{f.close();}
});
