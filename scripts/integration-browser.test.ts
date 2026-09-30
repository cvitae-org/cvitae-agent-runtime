import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEmbeddedListing, validateCapture, type EmbeddedJsonRecipe } from '@cvitae/job-pages';
import { createHarness } from '../src/runtime/create.js';
import { createIntegrationProviders } from '../src/effects/integration-providers.js';
import { sourceKey } from '../vendor/integration-protocol/node.mjs';
import type { ImportReceipt } from '../src/storage/sqlite/browser-imports.js';
import { fixtureProvider } from './fixtures/integration-provider.js';
const url='https://jobs.example/find?q=Research';
const target=()=>({tabId:1,documentId:randomUUID(),url});
const capture=(recipe:EmbeddedJsonRecipe)=>{
  const id='00000000-0000-0000-0000-000000000001';
  const payload={jobs:[{id,title:'Research Engineer',slug:`research-id-${id}`}],page:1,pages:1,keywords:['Research']};
  return validateCapture({version:1,url,title:'Research',kind:'listing',recipe:{sourceId:recipe.sourceId,revision:recipe.revision},items:readEmbeddedListing(recipe,JSON.stringify(payload),url).items},recipe);
};
test('browser selection resolves overlap explicitly and records both providers without duplicating a saved offer',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'integration-browser-')),now=Date.now();
  const first=fixtureProvider('first',now,true),second=fixtureProvider('second',now,true);
  const providers=createIntegrationProviders([first.connection,second.connection],{cacheDirectory:directory,fetch:async address=>Response.json((String(address)===first.connection.resolveUrl?first:second).seal())});
  const h=createHarness({databasePath:':memory:',env:{},scraperUrl:'',integrationProviders:providers}),session='studio:'+randomUUID();
  const call=async(method:string,payload:unknown)=>await h.browser.dispatch(session,method,payload);
  try{
    await assert.rejects(call('browser.recipe',{target:target()}),/Several providers/);
    const destination='provider-bound-search';
    h.discoverySearches.createBatch({phrase:'Research',children:[{id:destination,boardId:sourceKey('second','jobs'),label:'Second jobs',mode:'browser'}]});
    const bound=await h.browser.dispatch(session,'browser.recipe',{target:target()},destination) as {recipe:EmbeddedJsonRecipe;recipeToken:string;sourceKey:string};
    assert.equal(bound.sourceKey,sourceKey('second','jobs'));
    const boundTarget=target(),boundPreview=await h.browser.dispatch(session,'capture.preview',{target:boundTarget,capture:capture(bound.recipe),recipeToken:bound.recipeToken},destination) as {captureId:string};
    await h.browser.dispatch(session,'import.commit',{target:boundTarget,captureId:boundPreview.captureId,operationId:randomUUID(),selected:[0]},destination);
    const boundSaved=h.discoverySearches.read({id:destination,offset:0,limit:10});
    assert.equal(boundSaved.items[0]?.listing?.provenance?.connectionId,'second');
    await assert.rejects(Promise.resolve().then(()=>h.browser.dispatch(session,'browser.recipe',{target:target(),sourceKey:sourceKey('first','jobs')},destination)),/belonging to this search/);
    let id:string|undefined;
    for(const name of ['first','second']){
      const pin=await call('browser.recipe',{target:target(),sourceKey:sourceKey(name,'jobs')}) as {recipe:EmbeddedJsonRecipe;recipeToken:string};
      assert.equal(pin.recipe.sourceId,'jobs');const t=target(),page=capture(pin.recipe);
      await assert.rejects(call('capture.preview',{target:t,capture:page}),/Resolve/);
      const preview=await call('capture.preview',{target:t,capture:page,recipeToken:pin.recipeToken}) as {captureId:string};
      const receipt=await call('import.commit',{target:t,captureId:preview.captureId,operationId:randomUUID(),selected:[0]}) as ImportReceipt;
      if(id)assert.equal(receipt.offerIds[0],id);else{id=receipt.offerIds[0]!;h.offerNotes.save(id,'Keep browser note',0);h.offers.save({...h.offers.get(id)!,disposition:'applied'});}
    }
    const collection=h.browser.store.collection()!;
    const saved=h.discoverySearches.read({id:collection.id,offset:0,limit:10});
    assert.equal(saved.items[0]?.acquisitions?.length,2);assert.equal(h.offerNotes.get(id!)?.text,'Keep browser note');assert.equal(h.offers.get(id!)?.disposition,'applied');
    providers.remove('first');
    await assert.rejects(call('browser.recipe',{target:target(),sourceKey:sourceKey('first','jobs')}),/selected provider/);
    const remaining=await call('browser.recipe',{target:target()}) as {recipeToken:string};assert.ok(remaining.recipeToken);
  }finally{h.close();await rm(directory,{recursive:true,force:true});}
});
test('browser runs retain their recipe and provider release; withdrawal stops acquisition but not committing a retained preview',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'integration-browser-pin-')),now=Date.now(),provider=fixtureProvider('first',now,true);
  const providers=createIntegrationProviders([provider.connection],{cacheDirectory:directory,fetch:async()=>Response.json(provider.seal())});
  const h=createHarness({databasePath:':memory:',env:{},scraperUrl:'',integrationProviders:providers}),session='studio:'+randomUUID();
  const call=async(method:string,payload:unknown)=>await h.browser.dispatch(session,method,payload);
  try{
    const pin=await call('browser.recipe',{target:target()}) as {recipe:EmbeddedJsonRecipe;recipeToken:string};
    const t=target(),preview=await call('capture.preview',{target:t,capture:capture(pin.recipe),recipeToken:pin.recipeToken}) as {captureId:string};
    provider.snapshot={...provider.snapshot,releaseSequence:2,revision:'release-2',revokedRecipes:[{sourceId:'jobs',revision:'recipe-1'}]};await providers.resolve(new AbortController().signal,true);
    await assert.rejects(call('capture.preview',{target:target(),capture:capture(pin.recipe),recipeToken:pin.recipeToken}),/withdrawn/);
    const receipt=await call('import.commit',{target:t,captureId:preview.captureId,operationId:randomUUID(),selected:[0]}) as ImportReceipt;
    const saved=h.discoverySearches.read({id:receipt.collectionId,offset:0,limit:10}).items[0]!;
    assert.equal(saved.acquisitions?.[0]?.provenance.releaseSequence,1);assert.equal(saved.acquisitions?.[0]?.provenance.recipeRevision,'recipe-1');
  }finally{h.close();await rm(directory,{recursive:true,force:true});}
});
