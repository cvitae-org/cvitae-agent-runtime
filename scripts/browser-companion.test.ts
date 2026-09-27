import {z} from 'zod';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readLoadedPage} from '@cvitae/job-pages';
import {createHarness} from '../src/runtime/create.js';
import {createDispatch} from '../src/adapters/ipc/dispatch.js';
import {encodeFrame,decodeFrames} from '../src/adapters/browser/framing.js';
import type {ImportReceipt} from '../src/storage/sqlite/browser-imports.js';
const url='https://careers.example.org/jobs/react';
const job={ '@type':'JobPosting',url,title:'React developer',description:'Build accessible React interfaces with TypeScript. '.repeat(12),hiringOrganization:{name:'Example'},baseSalary:{currency:'PLN',value:{minValue:120,maxValue:180,unitText:'HOUR'}},jobLocationType:'TELECOMMUTE'};
const capture=()=>readLoadedPage({url,title:'React role',jsonLd:[job]});
const target={tabId:1,documentId:'document-one',url};
const setup=(databasePath=':memory:',now=()=>Date.now())=>createHarness({databasePath,now,env:{},scraperUrl:'',capabilities:{detect_offer_language:{name:'detect_offer_language',describe:'fixture',input:z.record(z.string(),z.unknown()),plan:()=>({capability:'detect_offer_language',source:'declared',stages:[{name:'fixture',concurrency:1,steps:[{name:'fixture',kind:'transform',critical:true,run:async()=>({detected:'en',uncertain:false})}]}]})}},boardReader:{resolve:async()=>{throw new Error('Unexpected network call');},capture:async()=>{throw new Error('Unexpected network call');}}});
const preview=(h:ReturnType<typeof setup>,value=capture(),session='browser-one')=>h.browser.dispatch(session,'capture.preview',{capture:value,target:{...target,url:value.url}}) as {captureId:string};
const commit=(h:ReturnType<typeof setup>,value=capture(),operationId=randomUUID())=>{const p=preview(h,value);const request={captureId:p.captureId,operationId,selected:[0],target:{...target,url:value.url}};return {request,receipt:h.browser.dispatch('browser-one','import.commit',request) as ImportReceipt};};
test('browser import is atomic, stable, preserves notes and disposition, and recovers lost replies after restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cvitae-browser-'));let h=setup(join(dir,'test.db'));
 try{
  const {request,receipt}=commit(h);assert.equal(receipt.added,1);const id=receipt.offerIds[0]!;
  h.offerNotes.save(id,'PRIVATE NOTE',0);const offer=h.offers.get(id)!;h.offers.save({...offer,disposition:'applied'});
  const again=commit(h);assert.equal(again.receipt.unchanged,1);assert.deepEqual(again.receipt.offerIds,[id]);assert.equal(h.offers.get(id)!.text,job.description.trim());assert.equal(h.offers.get(id)!.disposition,'applied');
  const collection=h.browser.store.collection()!;assert.equal(collection.kind,'browser_import');assert.equal(collection.count,1);assert.throws(()=>h.discoverySearches.refetch(receipt.collectionId,false),/browser extension/);
  h.close();h=setup(join(dir,'test.db'));
  assert.deepEqual(h.browser.dispatch('new-session','import.commit',request),receipt);
  assert.equal(h.browser.store.poll(0).imports.length,2);assert.equal(h.offerNotes.get(id)?.text,'PRIVATE NOTE');
  assert.throws(()=>h.browser.dispatch('browser-one','import.commit',{...request,selected:[1]}),/different import/);
 }finally{h.close();rmSync(dir,{recursive:true,force:true});}
});
test('browser description is reused in details and Board without fetching the source',async()=>{
 const h=setup();try{
  const {receipt}=commit(h);const id=receipt.offerIds[0]!;
  h.detailQueue.enqueue(receipt.collectionId,[id]);assert.equal(h.detailQueue.poll(0).queued,0);
  await h.enrichment.details.ensure(id,false,new AbortController().signal);
  assert.throws(()=>h.enrichment.details.start(id,true),/browser/);
  const entry=h.board.add({offerId:id,operationId:randomUUID()});
  for(let n=0;n<100&&!h.board.requireEntry(entry.id).postings.length;n++)await new Promise(r=>setTimeout(r,10));
  const posting=h.board.requireEntry(entry.id).postings[0]!;assert.ok(posting);assert.equal(posting.text,job.description.trim());assert.equal(posting.sourceData?.acquisition,'browser');
 }finally{h.close();}
});
test('previews reject stale documents, expire, cancel, and expose no arbitrary runtime operation',()=>{
 let now=1_800_000_000_000;const h=setup(':memory:',()=>now);try{
  assert.throws(()=>h.browser.dispatch('s','browser.hello',{version:2}));
  assert.throws(()=>h.browser.dispatch('s','secrets.set',{}),/not supported/);
  const p=preview(h);const req={captureId:p.captureId,operationId:randomUUID(),selected:[0],target};
  assert.throws(()=>h.browser.dispatch('wrong-session','import.commit',req),/expired/);
  assert.throws(()=>h.browser.dispatch('browser-one','import.commit',{...req,target:{...target,documentId:'changed'}}),/page changed/);
  now+=600001;assert.throws(()=>h.browser.dispatch('browser-one','import.commit',req),/expired/);
  const q=preview(h);h.browser.dispatch('browser-one','capture.cancel',{});assert.throws(()=>h.browser.dispatch('browser-one','import.commit',{...req,captureId:q.captureId}),/expired/);
  assert.equal(h.browser.store.poll(0).imports.length,0);
 }finally{h.close();}
});
test('native message framing handles fragments, Unicode, multiple frames and invalid lengths',()=>{
 const values:unknown[]=[],errors:Error[]=[];const decode=decodeFrames(v=>values.push(v),e=>errors.push(e));const frame=encodeFrame({text:'Zażółć gęślą jaźń 👋'});
 for(const byte of frame)decode(Buffer.from([byte]));decode(Buffer.concat([encodeFrame({n:1}),encodeFrame({n:2})]));assert.equal(values.length,3);assert.equal((values[0] as {text:string}).text,'Zażółć gęślą jaźń 👋');
 const bad=Buffer.alloc(4);bad.writeUInt32LE(4194305);decode(bad);assert.equal(errors.length,1);assert.throws(()=>encodeFrame({text:'x'.repeat(20)},10));
});
test('only additive Studio browser channels are advertised',async()=>{
 const h=setup();try{const dispatch=createDispatch(h);const result=await dispatch('protocol.get',{});assert.ok(JSON.stringify(result).includes('browser-companion-v1'));assert.deepEqual(await dispatch('browser.poll',{after:0}),{ok:true,data:{cursor:0,imports:[],collectionId:null}});}finally{h.close();}
});

test('native bridge setup, authorized session, disabled connection and unknown callers',async()=>{
 const {createBrowserBridge}=await import('../src/adapters/browser/bridge.js');
 const {extensionOrigin}=await import('../src/adapters/browser/settings.js');
 const {connect}=await import('node:net');
 const root=mkdtempSync(join(tmpdir(),'cvitae-browser-bridge-'));const dir=join(root,'bridge');const sessions:string[]=[];
 const bridge=createBrowserBridge(dir,(session,method)=>{sessions.push(session);return {method};},()=>undefined,{home:root,platform:'darwin',extensionPath:'/example/extension'});
 try{
  const status=await bridge.configure(true);assert.equal(status.enabled,true);
  const endpoint=JSON.parse(readFileSync(join(dir,'endpoint.json'),'utf8')) as {socketPath:string;token:string};
  const response=await new Promise<Record<string,unknown>>((resolve,reject)=>{
   const socket=connect(endpoint.socketPath);const timer=setTimeout(()=>reject(new Error('socket timeout')),2000);
   socket.on('error',reject);socket.on('connect',()=>socket.write(encodeFrame({type:'connect',origin:extensionOrigin,token:endpoint.token})));
   socket.on('data',decodeFrames(raw=>{const r=raw as Record<string,unknown>;if(r.connected){socket.write(encodeFrame({id:'one',method:'browser.hello',payload:{version:1}}));}else {clearTimeout(timer);resolve(r);socket.destroy();}},reject));
  });
  assert.deepEqual(response.data,{method:'browser.hello'});assert.equal(sessions.length,1);
  await new Promise<void>((resolve,reject)=>{const socket=connect(endpoint.socketPath);const timer=setTimeout(()=>reject(new Error('unauthorized socket did not close')),2000);socket.on('error',reject);socket.on('connect',()=>socket.write(encodeFrame({type:'connect',origin:'chrome-extension://untrusted/',token:endpoint.token})));socket.on('close',()=>{clearTimeout(timer);resolve();});});
  assert.equal(sessions.length,1);assert.equal((await bridge.configure(false)).enabled,false);
  await bridge.configure(true);assert.ok(JSON.parse(readFileSync(join(dir,'endpoint.json'),'utf8')).token);
  rmSync(join(dir,'endpoint.json'));await bridge.configure(true);assert.ok(JSON.parse(readFileSync(join(dir,'endpoint.json'),'utf8')).token);
  await bridge.configure(false);
 }finally{bridge.close();rmSync(root,{recursive:true,force:true});}
});


test('failed selections roll back offers, collection, capture and receipt together',()=>{
 const h=setup();try{
  const p=preview(h);const operationId=randomUUID();
  assert.throws(()=>h.browser.dispatch('browser-one','import.commit',{captureId:p.captureId,operationId,selected:[0,1],target}),/not in this preview/);
  assert.equal(h.offers.byUrl(url),undefined);assert.equal(h.browser.store.collection(),null);assert.equal(h.browser.store.receipt(operationId),null);assert.equal(h.browser.store.has(url),false);
 }finally{h.close();}
});
test('listing and shorter detail reimports preserve rich text and freeze the richer capture',async()=>{
 const h=setup();try{
  const input={url:'https://bulldogjob.pl/companies/jobs/123-react-developer',title:'React',selection:job.description,selectionTitle:'React developer'};
  const initial=readLoadedPage(input);const {receipt}=commit(h,{...initial,kind:'offer'});const id=receipt.offerIds[0]!;
  const listing={...initial,url:'https://bulldogjob.pl/companies/jobs',kind:'listing' as const,items:initial.items.map(j=>({...j,description:undefined,completeness:'listing' as const}))};
  commit(h,listing);assert.equal(h.offers.get(id)!.text,job.description.trim());
  h.detailQueue.enqueue(receipt.collectionId,[id]);assert.equal(h.detailQueue.poll(0).queued,0);
  commit(h,{...initial,kind:'offer',items:initial.items.map(j=>({...j,description:'Build accessible React interfaces. '.repeat(3)}))});
  assert.equal(h.offers.get(id)!.text,job.description.trim());assert.equal(h.browser.store.capture(input.url)!.text,job.description.trim());
  await h.enrichment.details.ensure(id,false,new AbortController().signal);
 }finally{h.close();}
});
test('disconnect removes uncommitted previews, and large previews fail with an actionable error',()=>{
 const h=setup();try{
  const p=preview(h);h.browser.disconnect('browser-one');assert.throws(()=>h.browser.dispatch('browser-one','import.commit',{captureId:p.captureId,operationId:randomUUID(),selected:[0],target}),/expired/);
  const listing={version:1,url:'https://bulldogjob.pl/companies/jobs',title:'Jobs',kind:'listing',items:Array.from({length:200},(_,i)=>({url:`https://bulldogjob.pl/companies/jobs/${i}-developer?x=`+'x'.repeat(1800),title:'🧑'.repeat(250),company:'🧑'.repeat(200),location:'🧑'.repeat(200),salary:'🧑'.repeat(200)}))};
  assert.throws(()=>h.browser.dispatch('browser-one','capture.preview',{capture:listing,target:{...target,url:listing.url}}),/too much preview data/);
 }finally{h.close();}
});


test('internal Studio browser uses the import contract without a native host and rejects other actions',async()=>{
 const h=setup();try{
  const dispatch=createDispatch(h),sessionId=randomUUID();
  const hello=await dispatch('browser.internal.dispatch',{sessionId,method:'browser.hello',payload:{version:1}});assert.equal(hello.ok,true);
  const p=await dispatch('browser.internal.dispatch',{sessionId,method:'capture.preview',payload:{capture:capture(),target}});assert.equal(p.ok,true);if(!p.ok)throw new Error('preview failed');
  const captureId=(p.data as {captureId:string}).captureId;
  const committed=await dispatch('browser.internal.dispatch',{sessionId,method:'import.commit',payload:{captureId,operationId:randomUUID(),selected:[0],target}});assert.equal(committed.ok,true);
  const unknown=await dispatch('browser.internal.dispatch',{sessionId,method:'secrets.get',payload:{}});assert.equal(unknown.ok,false);
  assert.equal(h.browser.store.collection()!.count,1);assert.equal(h.browser.status() && (h.browser.status() as {enabled:boolean}).enabled,false);
 }finally{h.close();}
});
