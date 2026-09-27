import {embeddedJsonRecipeSchema} from '@cvitae/job-pages/recipes';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readEmbeddedListing,validateCapture,type EmbeddedJsonRecipe} from '@cvitae/job-pages';
import {createHarness} from '../src/runtime/create.js';
import type {ProviderSnapshot} from '../src/effects/discovery-provider.js';
import type {ImportReceipt} from '../src/storage/sqlite/browser-imports.js';
const recipe=embeddedJsonRecipeSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/theprotocol-browser-recipe.json',import.meta.url),'utf8')) as unknown);
const base='https://theprotocol.it/praca?kw=React&workModes=remote';
const target=(url=base)=>({tabId:1,documentId:randomUUID(),url});
const page=(recipe:EmbeddedJsonRecipe,number=1,changed=false)=>{
 const id=`00000000-0000-0000-0000-${String(number).padStart(12,'0')}`,url=base+(number>1?`&pageNumber=${number}`:'');
 const raw={props:{pageProps:{filters:{keywords:['React']},offersResponse:{page:{number,count:2},offers:[{id,offerUrlName:`react,oferta,${id}`,...(changed?{role:'React updated'}:{title:'React original'})}]}}}};
 const data=readEmbeddedListing(recipe,JSON.stringify(raw),url);
 return validateCapture({version:1,url,title:'Jobs',kind:'listing',recipe:{sourceId:recipe.sourceId,revision:recipe.revision},items:data.items},recipe);
};
function setup(){
 let now=Date.now();
 let snapshot:ProviderSnapshot={schemaVersion:1,providerId:'jobboards.info',scope:{categories:['it'],markets:['PL','remote']},releaseSequence:1,revision:'fixture',publishedAt:new Date(now).toISOString(),validUntil:new Date(now+3600000).toISOString(),refreshAfterSeconds:300,revokedRecipes:[],sources:[{id:'theprotocol',label:'the:protocol',hosts:recipe.hosts,revision:recipe.revision,modes:['embedded-json-v1'],adapterId:null,browserRecipe:recipe,health:{status:'validated',detail:'Fixture'},limitations:[]}]};
 const h=createHarness({databasePath:':memory:',env:{},scraperUrl:'',now:()=>now,discoveryProvider:{resolve:async()=>snapshot}});
 const session='studio:'+randomUUID();
 const call=async(method:string,payload:unknown)=>await h.browser.dispatch(session,method,payload);
 const resolve=async()=>await call('browser.recipe',{target:target()}) as {recipe:EmbeddedJsonRecipe;recipeToken:string};
 return {h,call,resolve,session,get snapshot(){return snapshot;},set snapshot(v:ProviderSnapshot){snapshot=v;},advance:()=>{now+=3600001;}};
}
test('browser recipes are session scoped and cannot be bypassed through legacy capture or modified navigation',async()=>{
 const s=setup();try{
  const pin=await s.resolve(),capture=page(pin.recipe),t=target();
  await assert.rejects(s.call('capture.preview',{capture,target:t}),/Resolve/);
  await assert.rejects(Promise.resolve(s.h.browser.dispatch('other','capture.preview',{capture,target:t,recipeToken:pin.recipeToken})),/different session/);
  const started=await s.call('collection.start',{target:t,recipeToken:pin.recipeToken}) as {collectionId:string};
  await s.call('collection.append',{collectionId:started.collectionId,capture,target:t});
  const next=base+'&pageNumber=2';
  assert.deepEqual(await s.call('collection.navigation',{collectionId:started.collectionId,from:base,to:next}),{allowed:true,url:next});
  for(const to of [next.replace('remote','onsite'),next.replace('=2','=3'),'https://evil.example/praca'])await assert.rejects(s.call('collection.navigation',{collectionId:started.collectionId,from:base,to}),/next page/);
  const second=page(pin.recipe,2);await s.call('collection.append',{collectionId:started.collectionId,capture:second,target:target(second.url)});
  assert.equal(s.h.browser.store.collection(),null);
  const result=await s.call('collection.commit',{collectionId:started.collectionId,operationId:randomUUID(),selected:[0,1]}) as ImportReceipt;assert.equal(result.added,2);
 }finally{s.h.close();}
});
test('new provider mapping applies to new previews; ongoing collections retain old recipe and saved offer identity',async()=>{
 const s=setup();try{
  const pin=await s.resolve(),capture=page(pin.recipe),t=target();
  const started=await s.call('collection.start',{target:t,recipeToken:pin.recipeToken}) as {collectionId:string};
  await s.call('collection.append',{collectionId:started.collectionId,capture,target:t});
  const changed=structuredClone(recipe);changed.revision='next';changed.fields.title='/role';
  s.snapshot={...s.snapshot,sources:[{...s.snapshot.sources[0]!,revision:'next',browserRecipe:changed}]};
  await s.call('collection.append',{collectionId:started.collectionId,capture:page(pin.recipe,2),target:target(base+'&pageNumber=2')});
  const first=await s.call('collection.commit',{collectionId:started.collectionId,operationId:randomUUID(),selected:[0,1]}) as ImportReceipt;
  const id=first.offerIds[0]!;s.h.offerNotes.save(id,'Keep note',0);s.h.offers.save({...s.h.offers.get(id)!,disposition:'applied'});
  const newer=await s.resolve(),newTarget=target();assert.equal(newer.recipe.revision,'next');
  const preview=await s.call('capture.preview',{capture:page(newer.recipe,1,true),target:newTarget,recipeToken:newer.recipeToken}) as {captureId:string};
  const second=await s.call('import.commit',{captureId:preview.captureId,operationId:randomUUID(),selected:[0],target:newTarget}) as ImportReceipt;
  assert.equal(second.offerIds[0],id);assert.equal(s.h.offers.get(id)?.position,'React updated');assert.equal(s.h.offerNotes.get(id)?.text,'Keep note');assert.equal(s.h.offers.get(id)?.disposition,'applied');
 }finally{s.h.close();}
});
test('revocation and expiry stop further capture/navigation but retained drafts can still be reviewed and imported',async()=>{
 const s=setup();try{
  const pin=await s.resolve(),capture=page(pin.recipe);
  const {collectionId}=await s.call('collection.start',{target:target(),recipeToken:pin.recipeToken}) as {collectionId:string};
  await s.call('collection.append',{collectionId,capture,target:target()});
  s.snapshot={...s.snapshot,revokedRecipes:[{sourceId:recipe.sourceId,revision:recipe.revision}]};
  await assert.rejects(s.call('collection.navigation',{collectionId,from:base,to:base+'&pageNumber=2'}),/withdrew/);
  await assert.rejects(s.call('collection.append',{collectionId,capture:page(pin.recipe,2),target:target(base+'&pageNumber=2')}),/withdrew/);
  const preview=await s.call('collection.preview',{collectionId}) as {jobs:number};assert.equal(preview.jobs,1);
  const receipt=await s.call('collection.commit',{collectionId,operationId:randomUUID(),selected:[0]}) as ImportReceipt;assert.equal(receipt.added,1);
  s.snapshot={...s.snapshot,revokedRecipes:[]};const fresh=await s.resolve();s.advance();
  await assert.rejects(s.call('capture.preview',{capture,target:target(),recipeToken:fresh.recipeToken}),/expired/);
 }finally{s.h.close();}
});

test('cancellation during a registry refresh cannot create a late preview or recipe pin',async()=>{
 const s=setup();try{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const h=createHarness({databasePath:':memory:',env:{},scraperUrl:'',discoveryProvider:{resolve:async()=>{await gate;return s.snapshot;}}});
  try{
   const pending=h.browser.dispatch(s.session,'browser.recipe',{target:target()});
   h.browser.dispatch(s.session,'capture.cancel',{});release();
   await assert.rejects(Promise.resolve(pending),/cancelled/);
   assert.equal(h.browser.store.collection(),null);
  }finally{h.close();}
 }finally{s.h.close();}
});
