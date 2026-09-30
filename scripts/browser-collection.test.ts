import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateCapture,browserRecipeContext,browserRecipeNextUrl,domListingRecipeSchema} from '@cvitae/job-pages';
import {readFileSync} from 'node:fs';
import {createBrowserCollection} from '../src/runtime/browser-collection.js';
import type {BrowserRecipePin} from '../src/effects/browser-recipes.js';
import {createHarness} from '../src/runtime/create.js';
import type {ImportReceipt} from '../src/storage/sqlite/browser-imports.js';
const recipe=domListingRecipeSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/generic-provider.json',import.meta.url),'utf8')).listing);
const base='https://careers.example/opportunities';
const offerBase='https://careers.example/position';
const pin:BrowserRecipePin={token:randomUUID(),recipe,validUntil:'2035-01-01T00:00:00.000Z',expiresAt:Date.now()+3600000,scope:base,tabId:1,session:'test'};
const page=(number:number,ids:number[])=>validateCapture({version:1,url:base+(number>1?'?page='+number:''),title:'Jobs',kind:'listing',recipe:{sourceId:recipe.sourceId,revision:recipe.revision},items:ids.map(id=>({board:recipe.sourceId,external_id:String(id),url:`${offerBase}/${id}-react`,title:`React ${id}`,completeness:'listing'}))},recipe);
const target=(url:string,documentId=randomUUID())=>({tabId:1,documentId,url});
const setup=(databasePath=':memory:',now=Date.now)=>{const h=createHarness({databasePath,now,env:{},scraperUrl:''}),collection=createBrowserCollection(h.browser.store,now);const dispatch=(session:string,method:string,payload:unknown)=>method==='capture.cancel'?collection.cancel(session):collection.dispatch(session,method,payload,pin);return {...h,browser:{...h.browser,dispatch},close:()=>{collection.close();h.close();}};};
const session='studio:'+randomUUID();
const start=(h:ReturnType<typeof setup>)=>(h.browser.dispatch(session,'collection.start',{target:target(base)}) as {collectionId:string}).collectionId;
const append=(h:ReturnType<typeof setup>,collectionId:string,capture=page(1,[1,2]),t=target(capture.url))=>h.browser.dispatch(session,'collection.append',{collectionId,capture,target:t}) as {jobs:number;pages:number;added:number;replayed:boolean};
const preview=(h:ReturnType<typeof setup>,collectionId:string)=>h.browser.dispatch(session,'collection.preview',{collectionId}) as {items:{index:number;title:string}[]};
test('collection merges overlapping pages and saves one durable receipt, preserving state after restart',()=>{
 const directory=mkdtempSync(join(tmpdir(),'cvitae-collection-'));let h=setup(join(directory,'test.db'));
 try {
  const id=start(h),a=page(1,[1,2]),t=target(a.url);
  assert.equal(append(h,id,a,t).jobs,2);assert.equal(append(h,id,a,t).replayed,true);
  assert.equal(append(h,id,page(2,[2,3])).jobs,3);assert.equal(h.browser.store.collection(),null);
  assert.equal(preview(h,id).items.length,3);
  const request={collectionId:id,operationId:randomUUID(),selected:[0,1,2]};
  const receipt=h.browser.dispatch(session,'collection.commit',request) as ImportReceipt;
  assert.equal(receipt.added,3);assert.equal(h.browser.store.poll(0).imports.length,1);
  const offerId=receipt.offerIds[0]!;h.offerNotes.save(offerId,'Private note',0);h.offers.save({...h.offers.get(offerId)!,disposition:'applied'});
  const second=start(h);append(h,second,page(1,[1,2]));append(h,second,page(2,[2,3]));
  const same=h.browser.dispatch(session,'collection.commit',{collectionId:second,operationId:randomUUID(),selected:[0,1,2]}) as ImportReceipt;
  assert.equal(same.unchanged,3);assert.equal(h.offerNotes.get(offerId)?.text,'Private note');assert.equal(h.offers.get(offerId)?.disposition,'applied');
  h.close();h=setup(join(directory,'test.db'));
  assert.deepEqual(h.browser.dispatch('studio:'+randomUUID(),'collection.commit',request),receipt);
  assert.throws(()=>h.browser.dispatch(session,'collection.commit',{...request,selected:[0]}),/different import/);
  assert.equal(h.browser.store.collection()?.count,3);
 }finally{h.close();rmSync(directory,{recursive:true,force:true});}
});
test('collection scope, session, expiry and cancellation are enforced without losing existing draft on invalid append',()=>{
 let now=1_800_000_000_000;const h=setup(':memory:',()=>now);
 try {
  assert.throws(()=>h.browser.dispatch('extension','collection.start',{target:target(base)}),/built-in/);
  const id=start(h);append(h,id);
  assert.throws(()=>append(h,id,{...page(2,[3]),url:base+'?term=other&page=2'}),/search or page changed|pinned recipe/);
  assert.throws(()=>append(h,id,page(2,[3]),target(base)),/search or page changed|pinned recipe/);
  assert.throws(()=>h.browser.dispatch('studio:other','collection.preview',{collectionId:id}),/expired/);
  assert.equal(preview(h,id).items.length,2);
  h.browser.dispatch(session,'capture.cancel',{});assert.throws(()=>preview(h,id),/expired/);
  const second=start(h);append(h,second);now+=600001;assert.throws(()=>preview(h,second),/expired/);
  assert.equal(h.browser.store.poll(0).imports.length,0);
 }finally{h.close();}
});
test('multi-page selection failure rolls back the entire save and receipt',()=>{
 const h=setup();try{
  assert.throws(()=>h.browser.store.commitBatch(randomUUID(),[{capture:page(1,[1]),recipe,indices:[0]},{capture:page(2,[2]),recipe,indices:[0,99]}],'rollback'),/selection/);
  assert.equal(h.browser.store.collection(),null);assert.equal(h.offers.byUrl(offerBase+'/1-react'),undefined);assert.equal(h.browser.store.poll(0).imports.length,0);
  const id=start(h);append(h,id);assert.throws(()=>h.browser.dispatch(session,'collection.commit',{collectionId:id,operationId:randomUUID(),selected:[0,0]}),/twice/);
  assert.equal(preview(h,id).items.length,2);
 }finally{h.close();}
});
test('collection accepts more than one-page limit and rejects excess pages without corrupting its draft',()=>{
 const h=setup();try{
  const id=start(h);for(let n=1;n<=20;n++)append(h,id,page(n,Array.from({length:50},(_,i)=>n*100+i)));
  assert.equal(preview(h,id).items.length,1000);
  assert.throws(()=>append(h,id,page(21,[9999])),/limit/);assert.equal(preview(h,id).items.length,1000);
  const receipt=h.browser.dispatch(session,'collection.commit',{collectionId:id,operationId:randomUUID(),selected:Array.from({length:1000},(_,i)=>i)}) as ImportReceipt;
  assert.equal(receipt.added,1000);assert.equal(h.browser.store.poll(0).imports.length,1);
 }finally{h.close();}
});
test('pagination policy permits only the next page of the same declared search',()=>{
 assert.equal(browserRecipeNextUrl(recipe,base,2),base+'?page=2');
 assert.equal(browserRecipeNextUrl(recipe,base+'?term=Research&region=north',2),base+'?term=Research&region=north&page=2');
 for(const url of ['https://evil.example/opportunities','https://user:pass@careers.example/opportunities',base+'?page=2&page=3'])assert.equal(browserRecipeContext(recipe,url),null);
});
