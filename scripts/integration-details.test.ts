import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { OperationError } from '../src/contracts/operation-error.js';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readDomDetail, readDomListing, validateCapture, type BrowserRecipe } from '@cvitae/job-pages';
import { domListingRecipeSchema, domDetailRecipeSchema, sourceSchema } from '../vendor/integration-protocol/index.mjs';
import { sourceKey } from '../vendor/integration-protocol/node.mjs';
import { fixtureProvider } from './fixtures/integration-provider.js';
import { createIntegrationProviders } from '../src/effects/integration-providers.js';
import { createIntegrationOfferReader } from '../src/effects/integration-offers.js';
import { createHarness } from '../src/runtime/create.js';
import { open } from '../src/storage/sqlite/open.js';
import { migrate } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createEnrichmentStore } from '../src/storage/sqlite/enrichment.js';
import { createIntegrationAcquisitions } from '../src/storage/sqlite/integration-acquisitions.js';
import { createOfferDetailsService } from '../src/runtime/offer-details.js';
import type { ImportReceipt } from '../src/storage/sqlite/browser-imports.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/generic-provider.json',import.meta.url),'utf8')) as {listing:unknown;detail:unknown;listingHtml:string;detailHtml:string};
const listing=domListingRecipeSchema.parse(fixture.listing),detail=domDetailRecipeSchema.parse(fixture.detail);
const url='https://careers.example/position/research-1',listingUrl='https://careers.example/opportunities?term=Research';
const call=()=>({traceId:randomUUID(),signal:new AbortController().signal});
async function setup() {
  const directory=await mkdtemp(join(tmpdir(),'integration-details-')),provider=fixtureProvider('independent',Date.now());
  provider.snapshot={...provider.snapshot,sources:[sourceSchema.parse({...provider.snapshot.sources[0],id:'vacancies',website:'https://careers.example',hosts:['careers.example'],revision:'r1',modes:['external-link','dom-listing-v1','dom-detail-v1'],
    recipe:listing,browserRecipe:listing,detailRecipe:detail,routes:{listing:listingUrl,offerPathPrefix:'/position/',search:{kind:'query',parameter:'term'}},health:{...provider.snapshot.sources[0]!.health,recipeRevision:'r1'}})]};
  const providers=createIntegrationProviders([provider.connection],{cacheDirectory:directory,fetch:async()=>Response.json(provider.seal())});
  return {provider,providers,close:async()=>{providers.close();await rm(directory,{recursive:true,force:true});}};
}
test('provider DOM browser listing and detail imports retain source/release provenance and private history',async()=>{
  const s=await setup(),h=createHarness({databasePath:':memory:',env:{},scraperUrl:'',integrationProviders:s.providers});
  const session='studio:'+randomUUID(),key=sourceKey('independent','vacancies');
  const dispatch=(method:string,payload:unknown)=>h.browser.dispatch(session,method,payload);
  try{
    let id='';
    for(const kind of ['listing','offer'] as const){
      const target={tabId:1,documentId:randomUUID(),url:kind==='listing'?listingUrl:url};
      const pin=await dispatch('browser.recipe',{target,sourceKey:key}) as {recipe:BrowserRecipe;recipeToken:string};
      assert.equal(pin.recipe.kind,kind==='listing'?'dom-listing-v1':'dom-detail-v1');
      const items=kind==='listing'?readDomListing(listing,fixture.listingHtml,listingUrl).items:[readDomDetail(detail,fixture.detailHtml,url)];
      const capture=validateCapture({version:1,url:target.url,kind,recipe:{sourceId:'vacancies',revision:'r1'},items},pin.recipe);
      const preview=await dispatch('capture.preview',{target,capture,recipeToken:pin.recipeToken}) as {captureId:string};
      if(kind==='offer')await assert.rejects(Promise.resolve().then(()=>dispatch('capture.preview',{target:{...target,url:url.replace('research-1','different')},capture,recipeToken:pin.recipeToken})),/pinned provider/);
      const saved=await dispatch('import.commit',{target,captureId:preview.captureId,operationId:randomUUID(),selected:[0]}) as ImportReceipt;
      if(!id){id=saved.offerIds[0]!;h.offerNotes.save(id,'Preserve note',0);h.offers.save({...h.offers.get(id)!,disposition:'applied'});}else assert.equal(saved.offerIds[0],id);
      const acquisitions=h.discoverySearches.read({id:saved.collectionId,offset:0,limit:10}).items[0]!.acquisitions!;
      assert.equal(acquisitions.length,kind==='listing'?1:2);assert.ok(acquisitions.some(item=>item.provenance.engine===pin.recipe.kind));
    }
    assert.equal(h.offerNotes.get(id)?.text,'Preserve note');assert.equal(h.offers.get(id)?.disposition,'applied');assert.match(h.offers.get(id)!.text,/scientific instruments/);
  }finally{h.close();await s.close();}
});
test('HTTP detail reader pins saved identity, checks withdrawal and fails without a provider instead of falling back',async()=>{
  const s=await setup();let calls=0,wrongId=false,withdraw=false,withdrawRecipe=false;
  const original=structuredClone(s.provider.snapshot);
  const reader=createIntegrationOfferReader(s.providers,{url:'http://127.0.0.1:8787',token:'x'.repeat(32),lookup:()=>({sourceKey:sourceKey('independent','vacancies'),externalId:'R-1'}),fetch:async(_url,init)=>{
    calls++;const query=JSON.parse(String(init?.body));assert.equal(query.recipe.kind,'dom-detail-v1');assert.equal(query.binding.connectionId,'independent');assert.equal(query.expectedId,'R-1');
    if(withdraw)s.providers.setEnabled('independent',false);
    if(withdrawRecipe){
      const changed=structuredClone(s.provider.snapshot);changed.releaseSequence++;changed.revision='withdrawn-detail';delete changed.sources[0]!.detailRecipe;changed.sources[0]!.modes=changed.sources[0]!.modes.filter(mode=>mode!=='dom-detail-v1');s.provider.snapshot=changed;
      await s.providers.resolve(call().signal,true);
    }
    return Response.json({status:'ok',requestCount:1,data:{...readDomDetail(detail,fixture.detailHtml,url),...(wrongId?{external_id:'wrong'}:{})}});
  }});
  try{
    const offer=await reader.resolve(url,call());assert.equal(offer.integration?.provenance.engine,'dom-detail-v1');assert.equal(offer.stated?.company,'Example Laboratory');
    wrongId=true;await assert.rejects(reader.resolve(url,call()),/identity/);wrongId=false;
    withdrawRecipe=true;await assert.rejects(reader.resolve(url,call()),/withdrawn/);withdrawRecipe=false;
    s.provider.snapshot={...original,releaseSequence:3,revision:'restored-detail'};await s.providers.resolve(call().signal,true);
    withdraw=true;await assert.rejects(reader.resolve(url,call()),/withdrawn/);
    const before=calls;await assert.rejects(reader.resolve(url,call()),/No enabled provider/);assert.equal(calls,before);
  }finally{await s.close();}
});
test('successful HTTP detail enrichment persists recipe provenance atomically with facts',async()=>{
  const s=await setup(),db=open(':memory:');migrate(db);
  const offers=createOfferStore(db),store=createEnrichmentStore(db,offers);
  offers.save({id:'saved',url,text:'',processing:'candidate',disposition:'active',firstSeenAt:1,lastSeenAt:1});
  const reader=createIntegrationOfferReader(s.providers,{url:'http://127.0.0.1:8787',token:'x'.repeat(32),fetch:async()=>Response.json({status:'ok',requestCount:1,data:readDomDetail(detail,fixture.detailHtml,url)})});
  const details=createOfferDetailsService(offers,store,reader);
  try{
    await details.ensure('saved',false,new AbortController().signal);
    assert.ok(createIntegrationAcquisitions(db).list('saved').some(entry=>entry.provenance.engine==='dom-detail-v1'));
    assert.match(offers.get('saved')!.text,/scientific instruments/);
    const resolved=await reader.resolve(url,call()),before=offers.get('saved');
    assert.throws(()=>store.source(store.get('saved')!,{...resolved,text:'Corrupted',integration:{...resolved.integration!,provenance:{...resolved.integration!.provenance,recipeHash:'0'.repeat(64)}}}),/Invalid acquisition/);
    assert.deepEqual(offers.get('saved'),before);
  }finally{details.close();db.close();await s.close();}
});

const settleFetch=async(h:ReturnType<typeof createHarness>,id:string)=>{
  for(let n=0;n<100;n++){
    const entry=h.board.requireEntry(id);
    if(['complete','failed'].includes(entry.preparation.steps.fetch.status))return entry;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('Board fetch did not settle');
};
const stopBeforeModels={detect_offer_language:{name:'detect_offer_language',describe:'No model or profile access in this fixture',input:z.record(z.string(),z.unknown()),
  plan:()=>({capability:'detect_offer_language',source:'declared' as const,stages:[{name:'stop',concurrency:1,steps:[{name:'stop',kind:'transform' as const,critical:true,
    run:async()=>{throw new OperationError('selection_required','Fixture stops after the posting is captured.');}}]}]})}};

test('Board fetches provider-linked browser listings, retries a previous failure and retains source identity',async()=>{
  const s=await setup(),key=sourceKey('independent','vacancies');let calls=0,fail=true;
  const reader=createIntegrationOfferReader(s.providers,{url:'http://127.0.0.1:8787',token:'x'.repeat(32),lookup:()=>({sourceKey:key,externalId:'R-1'}),fetch:async(_url,init)=>{
    calls++;const query=JSON.parse(String(init?.body));assert.equal(query.board,key);assert.equal(query.expectedId,'R-1');
    if(fail)return Response.json({status:'error',requestCount:1,detail:'Temporary fixture failure'});
    return Response.json({status:'ok',requestCount:1,data:readDomDetail(detail,fixture.detailHtml,url)});
  }});
  const h=createHarness({databasePath:':memory:',env:{},scraperUrl:'',integrationProviders:s.providers,boardReader:reader,capabilities:stopBeforeModels});
  try{
    const target={tabId:1,documentId:randomUUID(),url:listingUrl},session='studio:'+randomUUID();
    const pin=await h.browser.dispatch(session,'browser.recipe',{target,sourceKey:key}) as {recipe:BrowserRecipe;recipeToken:string};
    const capture=validateCapture({version:1,url:listingUrl,kind:'listing',recipe:{sourceId:listing.sourceId,revision:listing.revision},items:readDomListing(listing,fixture.listingHtml,listingUrl).items},pin.recipe);
    const preview=await h.browser.dispatch(session,'capture.preview',{target,capture,recipeToken:pin.recipeToken}) as {captureId:string};
    const receipt=await h.browser.dispatch(session,'import.commit',{target,captureId:preview.captureId,operationId:randomUUID(),selected:[0]}) as ImportReceipt;
    const id=receipt.offerIds[0]!;assert.equal(h.offers.get(id)!.text,'');assert.equal(h.browser.store.has(url),true);assert.equal(h.browser.store.capture(url),undefined);
    h.offerNotes.save(id,'Keep my note',0);
    let entry=await settleFetch(h,h.board.add({offerId:id,operationId:randomUUID()}).id);
    assert.equal(calls,1,'A trusted listing must reach the detail reader instead of the blanket browser-only guard');
    assert.equal(entry.preparation.status,'waiting');assert.equal(entry.postings.length,0);
    fail=false;
    h.board.control({entryId:entry.id,expectedRevision:entry.revision,operationId:randomUUID(),action:'retry'});
    entry=await settleFetch(h,entry.id);
    assert.equal(entry.preparation.steps.fetch.status,'complete');assert.equal(calls,2);
    assert.match(entry.postings[0]!.text,/scientific instruments/);
    assert.equal(entry.postings[0]!.integration?.provenance.sourceKey,key);
    assert.equal(h.offerNotes.get(id)?.text,'Keep my note');
    assert.equal(h.offers.get(id)!.text,'','Board captures its own posting version without overwriting the discovery listing');
  }finally{h.close();await s.close();}
});

test('a provider-pinned listing import queues the detail read its provider covers',async()=>{
  const s=await setup(),key=sourceKey('independent','vacancies');let calls=0;
  const reader=createIntegrationOfferReader(s.providers,{url:'http://127.0.0.1:8787',token:'x'.repeat(32),lookup:()=>({sourceKey:key,externalId:'R-1'}),fetch:async()=>{
    calls++;return Response.json({status:'ok',requestCount:1,data:readDomDetail(detail,fixture.detailHtml,url)});
  }});
  const h=createHarness({databasePath:':memory:',env:{},scraperUrl:'',integrationProviders:s.providers,offerReader:reader});
  try{
    const target={tabId:1,documentId:randomUUID(),url:listingUrl},session='studio:'+randomUUID();
    const pin=await h.browser.dispatch(session,'browser.recipe',{target,sourceKey:key}) as {recipe:BrowserRecipe;recipeToken:string};
    const capture=validateCapture({version:1,url:listingUrl,kind:'listing',recipe:{sourceId:listing.sourceId,revision:listing.revision},items:readDomListing(listing,fixture.listingHtml,listingUrl).items},pin.recipe);
    const preview=await h.browser.dispatch(session,'capture.preview',{target,capture,recipeToken:pin.recipeToken}) as {captureId:string};
    const receipt=await h.browser.dispatch(session,'import.commit',{target,captureId:preview.captureId,operationId:randomUUID(),selected:[0]}) as ImportReceipt;
    const id=receipt.offerIds[0]!;
    for(let n=0;n<100 && h.enrichment.get(id).enrichment?.details?.status!=='succeeded';n++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls,1);assert.match(h.offers.get(id)!.text,/scientific instruments/);assert.equal(h.offers.get(id)!.company,'Example Laboratory');
    assert.equal(h.detailQueue.poll().jobs.find(job=>job.offerId===id)?.status,'succeeded');
  }finally{h.close();await s.close();}
});
test('Board never authorizes HTTP from a legacy browser listing or a disabled/missing provider recipe',async()=>{
  for(const mode of ['legacy','disabled','no-detail'] as const){
    const s=await setup(),key=sourceKey('independent','vacancies');let calls=0;
    const reader=createIntegrationOfferReader(s.providers,{url:'http://127.0.0.1:8787',token:'x'.repeat(32),lookup:()=>({sourceKey:key,externalId:'R-1'}),fetch:async()=>{calls++;throw new Error('No HTTP is authorized');}});
    const h=createHarness({databasePath:':memory:',env:{},scraperUrl:'',integrationProviders:s.providers,boardReader:reader,capabilities:stopBeforeModels});
    try{
      const capture=validateCapture({version:1,url:listingUrl,kind:'listing',recipe:{sourceId:listing.sourceId,revision:listing.revision},items:readDomListing(listing,fixture.listingHtml,listingUrl).items},listing);
      let receipt:ImportReceipt;
      if(mode==='legacy') receipt=h.browser.store.commit(randomUUID(),capture,[0],'legacy-fixture',listing);
      else{
        const target={tabId:1,documentId:randomUUID(),url:listingUrl},session='studio:'+randomUUID();
        const pin=await h.browser.dispatch(session,'browser.recipe',{target,sourceKey:key}) as {recipeToken:string};
        const preview=await h.browser.dispatch(session,'capture.preview',{target,capture,recipeToken:pin.recipeToken}) as {captureId:string};
        receipt=await h.browser.dispatch(session,'import.commit',{target,captureId:preview.captureId,operationId:randomUUID(),selected:[0]}) as ImportReceipt;
      }
      if(mode==='disabled')s.providers.setEnabled('independent',false);
      if(mode==='no-detail'){
        const next=structuredClone(s.provider.snapshot);next.releaseSequence++;next.revision='no-detail';delete next.sources[0]!.detailRecipe;next.sources[0]!.modes=next.sources[0]!.modes.filter(value=>value!=='dom-detail-v1');s.provider.snapshot=next;
        await s.providers.resolve(call().signal,true);
      }
      const entry=await settleFetch(h,h.board.add({offerId:receipt.offerIds[0]!,operationId:randomUUID()}).id);
      assert.equal(calls,0);assert.equal(entry.postings.length,0);assert.equal(entry.preparation.status,'waiting');
      assert.equal(entry.preparation.code,mode==='legacy'?'browser_capture_required':'unreadable_source');
    }finally{h.close();await s.close();}
  }
});
