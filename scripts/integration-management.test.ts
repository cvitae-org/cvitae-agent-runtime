import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHarness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { descriptorSchema } from '../vendor/integration-protocol/index.mjs';
import { sourceKey } from '../vendor/integration-protocol/node.mjs';
import { fixtureProvider } from './fixtures/integration-provider.js';
import { open } from '../src/storage/sqlite/open.js';
import { createIntegrationBrowserRecipes } from '../src/effects/integration-browser-recipes.js';
import { createIntegrationProviders } from '../src/effects/integration-providers.js';
import { connectionEnabled } from '../src/effects/integration-execution.js';
import { createIntegrationSettingsStore } from '../src/storage/sqlite/integration-settings.js';

const descriptor = (fixture: ReturnType<typeof fixtureProvider>, bearer=false) => descriptorSchema.parse({
  protocol:'job-integrations',schemaVersion:2,providerId:fixture.connection.providerId,name:fixture.connection.name,
  website:'https://'+fixture.connection.providerId,resolveUrl:fixture.connection.resolveUrl,
  authentication:bearer?'bearer':'none',capabilities:['external-link','http-json-v1','embedded-json-v1'],scope:fixture.connection.scope,
  signing:{algorithm:'Ed25519',publicKeys:fixture.connection.publicKeys},
});
async function setup(bearer=false,browser=false) {
  const dir=await mkdtemp(join(tmpdir(),'integration-management-')), fixture=fixtureProvider('independent',Date.now(),browser);
  const requests:{url:string;headers:Headers;body:string}[]=[];
  let image:Buffer|undefined, descriptorFailure=false;
  const fetch:typeof globalThis.fetch=async(url,init)=>{
    requests.push({url:String(url),headers:new Headers(init?.headers),body:String(init?.body??'')});
    if(String(url).endsWith('/icon.png'))return new Response(image??'bad',{headers:{'content-type':'image/png'}});
    if(String(url).endsWith('/descriptor'))return descriptorFailure?new Response('bad',{status:503}):Response.json(descriptor(fixture,bearer));
    return Response.json(fixture.seal());
  };
  const options={databasePath:join(dir,'runtime.db'),env:{},scraperUrl:'',integrationCacheDirectory:join(dir,'cache'),integrationFetch:fetch};
  let h=createHarness(options);
  return {dir,fixture,requests, get h(){return h;}, get dispatch(){return createDispatch(h);},
    set image(value:Buffer){image=value;},set descriptorFailure(value:boolean){descriptorFailure=value;},
    restart(){h.close();h=createHarness(options);},
    async add(){
      const inspected=await h.integrations.inspect({url:'https://independent.example/descriptor'});
      return h.integrations.save({inspectionId:inspected.inspectionId,trusted:true,name:'Research provider',scope:fixture.connection.scope,priority:10});
    },
    async close(){h.close();await rm(dir,{recursive:true,force:true});},
  };
}

test('descriptor review is bounded, explicit, immutable and separate from trust or credentials',async()=>{
  const s=await setup();try{
    assert.equal((await s.dispatch('integrations.inspect',{url:'http://localhost/descriptor'})).ok,false);
    const review=await s.h.integrations.inspect({url:'https://independent.example/descriptor'});
    assert.equal(s.h.integrations.list().connections.length,0);
    assert.equal(review.fingerprints[0]!.sha256.length,64);
    review.descriptor.resolveUrl='https://attacker.example/resolve';
    const input={inspectionId:review.inspectionId,name:'Verified',scope:s.fixture.connection.scope,priority:0};
    assert.equal((await s.dispatch('integrations.save',{...input,trusted:false})).ok,false);
    const saved=s.h.integrations.save({...input,trusted:true});
    assert.equal(saved.resolveUrl,s.fixture.connection.resolveUrl);assert.equal(saved.enabled,false);
    assert.throws(()=>s.h.integrations.save({...input,trusted:true}),/Inspect/);
    assert.ok(s.requests.every(request=>!request.headers.has('authorization')&&!request.headers.has('cookie')));
  }finally{await s.close();}
});

test('connections survive restart without tokens; refresh and removal preserve saved private history',async()=>{
  const s=await setup(true);try{
    const saved=await s.add(), id=saved.id, token='private-test-credential';
    s.h.integrations.secret(id,token);s.h.integrations.enabled(id,true);
    const refreshed=await s.h.integrations.refresh(id);assert.equal(refreshed.status,'ready');assert.equal(refreshed.sources.length,1);
    assert.equal(s.requests.at(-1)!.headers.get('authorization'),'Bearer '+token);
    s.h.offers.save({id:'saved',url:'https://jobs.example/offer/saved',position:'Engineer',board:'historic',text:'Private offer',processing:'fetched',disposition:'applied',firstSeenAt:1,lastSeenAt:2});
    s.h.offerNotes.save('saved','Private note',0);
    const db=open(join(s.dir,'runtime.db'));
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM integration_settings').all()).includes(token));db.close();
    assert.ok(!JSON.stringify(s.h.integrations.list()).includes(token));
    s.restart();const restored=s.h.integrations.list().connections[0]!;
    assert.equal(restored.id,id);assert.equal(restored.enabled,true);assert.equal(restored.credentialConfigured,false);
    assert.equal((await s.h.integrations.refresh(id)).status,'cached');
    await s.h.integrations.remove(id);s.restart();assert.deepEqual(s.h.integrations.list().connections,[]);
    assert.equal(s.h.offers.get('saved')!.disposition,'applied');assert.equal(s.h.offerNotes.get('saved')!.text,'Private note');
    assert.deepEqual((await readdir(join(s.dir,'cache'))).filter(name=>name.endsWith('.json')),[]);
  }finally{await s.close();}
});

test('configuration and disable/re-enable invalidate browser authority and retain provider selection',async()=>{
  const s=await setup(false,true);try{
    const saved=await s.add();s.h.integrations.enabled(saved.id,true);
    const recipes=createIntegrationBrowserRecipes(s.h.integrations.providers);
    const target={tabId:1,documentId:'fixture-document',url:'https://jobs.example/find?q=Research'};
    const pin=await recipes.prepare('session',target,sourceKey(saved.id,'jobs'));
    assert.ok(pin.recipeToken);
    s.h.integrations.enabled(saved.id,false);s.h.integrations.enabled(saved.id,true);
    await recipes.refresh();assert.throws(()=>recipes.require('session',pin.recipeToken!,target),/withdrawn/);
    s.h.integrations.configure({id:saved.id,name:'Renamed',scope:s.fixture.connection.scope,priority:2});
    s.restart();assert.equal(s.h.integrations.list().connections[0]!.priority,2);
    assert.equal(s.h.integrations.list().connections[0]!.name,'Renamed');
    recipes.close();
  }finally{await s.close();}
});

test('signed icons are verified and cached without credentials; tampering falls back safely',async()=>{
  const s=await setup(true);try{
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=','base64');
    s.image=bytes;
    const icon={url:'https://independent.example/icon.png',mimeType:'image/png' as const,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    s.fixture.snapshot={...s.fixture.snapshot,sources:s.fixture.snapshot.sources.map(source=>({...source,presentation:{attribution:[],icon}}))};
    const saved=await s.add();s.h.integrations.secret(saved.id,'only-for-provider');s.h.integrations.enabled(saved.id,true);
    const key=sourceKey(saved.id,'jobs');
    assert.equal((await s.h.integrations.icon(key))!.base64,bytes.toString('base64'));
    const asset=s.requests.find(item=>item.url===icon.url)!;assert.equal(asset.headers.has('authorization'),false);assert.equal(asset.body,'');
    assert.ok(await s.h.integrations.icon(key));assert.equal(s.requests.filter(item=>item.url===icon.url).length,1);
    const path=join(s.dir,'cache','assets',saved.id,icon.sha256+'.raster');assert.deepEqual(await readFile(path),bytes);
    await rm(path);s.image=Buffer.from('wrong bytes');assert.equal(await s.h.integrations.icon(key),null);
    await s.h.integrations.remove(saved.id);assert.equal(await s.h.integrations.icon(key),null);
  }finally{await s.close();}
});

test('changing endpoints or signing keys requires fresh review and forgets the old credential',async()=>{
  const s=await setup(true);try{
    const saved=await s.add();s.h.integrations.secret(saved.id,'old-credential');s.h.integrations.enabled(saved.id,true);
    assert.equal((await s.dispatch('integrations.configure',{id:saved.id,name:'Bad',scope:s.fixture.connection.scope,priority:1,resolveUrl:'https://elsewhere.example/resolve'})).ok,false);
    const next=descriptor(s.fixture,true);next.resolveUrl='https://new-endpoint.example/resolve';
    const inspected=await s.h.integrations.inspect({descriptor:next});
    const revised=s.h.integrations.save({id:saved.id,inspectionId:inspected.inspectionId,trusted:true,name:'Rotated',scope:next.scope,priority:1});
    assert.equal(revised.id,saved.id);assert.equal(revised.enabled,false);assert.equal(revised.credentialConfigured,false);
    assert.equal(revised.resolveUrl,next.resolveUrl);
    const stranger=descriptor(fixtureProvider('stranger',Date.now()));
    const other=await s.h.integrations.inspect({descriptor:stranger});
    assert.throws(()=>s.h.integrations.save({id:saved.id,inspectionId:other.inspectionId,trusted:true,name:'Wrong identity',scope:next.scope,priority:1}),/different provider/);
  }finally{await s.close();}
});

test('a slow second provider cannot renew an old first-provider result after disable and re-enable',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'provider-batch-generation-'));
  const first=fixtureProvider('first',Date.now()),second=fixtureProvider('second',Date.now());
  let release!:()=>void,started!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  const providers=createIntegrationProviders([first.connection,second.connection],{cacheDirectory:directory,fetch:async url=>{
    if(String(url)===second.connection.resolveUrl){started();await waiting;return Response.json(second.seal());}
    return Response.json(first.seal());
  }});
  try{
    await providers.resolveConnection('first',AbortSignal.timeout(5000));
    const batch=providers.resolve(AbortSignal.timeout(5000));await entered;
    providers.setEnabled('first',false);providers.setEnabled('first',true);release();
    const stale=(await batch).sources.find(source=>source.reference.connectionId==='first')!;
    assert.equal(connectionEnabled(providers,stale),false);
    const fresh=(await providers.resolve(AbortSignal.timeout(5000))).sources.find(source=>source.reference.connectionId==='first')!;
    assert.equal(connectionEnabled(providers,fresh),true);
  }finally{release();providers.close();await rm(directory,{recursive:true,force:true});}
});

test('host defaults persist once, accept signed updates without credentials, and stay removed after restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'provider-defaults-')), fixture=fixtureProvider('default',Date.now());
  const seeded={...fixture.connection,authentication:'none' as const,credentialRef:undefined};
  const replacement=fixtureProvider('replacement',Date.now());
  const requests:Headers[]=[];
  const env:Record<string,string>={INTEGRATION_PROVIDERS_DEFAULTS_JSON:JSON.stringify([seeded])};
  const options={databasePath:join(dir,'runtime.db'),env,scraperUrl:'',integrationCacheDirectory:join(dir,'cache'),
    integrationFetch:async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
      requests.push(new Headers(init?.headers));return Response.json(fixture.seal());
    }};
  let h=createHarness(options);
  try{
    assert.equal(requests.length,0);
    assert.equal(h.integrations.list().connections[0]!.id,seeded.id);
    const db=open(options.databasePath);
    assert.equal(createIntegrationSettingsStore(db).read()![0]!.id,seeded.id);db.close();
    assert.equal((await h.integrations.refresh(seeded.id)).status,'ready');
    fixture.snapshot={...fixture.snapshot,releaseSequence:2,revision:'server-update',sources:fixture.snapshot.sources.map(source=>({...source,label:'Updated on the provider'}))};
    assert.equal((await h.integrations.refresh(seeded.id)).sources[0]!.label,'Updated on the provider');
    assert.ok(requests.every(headers=>!headers.has('authorization')));
    h.integrations.enabled(seeded.id,false);h.close();
    env.INTEGRATION_PROVIDERS_DEFAULTS_JSON=JSON.stringify([replacement.connection]);
    h=createHarness(options);
    assert.equal(h.integrations.list().connections[0]!.id,seeded.id);
    assert.equal(h.integrations.list().connections[0]!.enabled,false);
    await h.integrations.remove(seeded.id);h.close();h=createHarness(options);
    assert.deepEqual(h.integrations.list().connections,[]);
  }finally{h.close();await rm(dir,{recursive:true,force:true});}
});

test('explicit provider configuration and previously saved empty settings take precedence over host defaults',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'provider-default-precedence-'));
  const preset=fixtureProvider('preset',Date.now()),custom=fixtureProvider('custom',Date.now());
  let h:ReturnType<typeof createHarness>|undefined;
  try{
    for(const explicit of [[],[custom.connection]]){
      h=createHarness({databasePath:':memory:',env:{INTEGRATION_PROVIDERS_DEFAULTS_JSON:JSON.stringify([preset.connection]),INTEGRATION_PROVIDERS_JSON:JSON.stringify(explicit)},integrationCacheDirectory:dir,scraperUrl:''});
      assert.deepEqual(h.integrations.providers.connections(),explicit);h.close();h=undefined;
    }
    const options={databasePath:join(dir,'runtime.db'),env:{},integrationCacheDirectory:dir,scraperUrl:''};
    h=createHarness(options);h.close();h=undefined;
    const db=open(options.databasePath);createIntegrationSettingsStore(db).write([]);db.close();
    h=createHarness({...options,env:{INTEGRATION_PROVIDERS_DEFAULTS_JSON:JSON.stringify([preset.connection])}});
    assert.deepEqual(h.integrations.list().connections,[]);
  }finally{h?.close();await rm(dir,{recursive:true,force:true});}
});
