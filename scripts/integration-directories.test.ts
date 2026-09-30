import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHarness} from '../src/runtime/create.js';
import {createDispatch} from '../src/adapters/ipc/dispatch.js';
import {fixtureProvider} from './fixtures/integration-provider.js';
import {directorySchema} from '../vendor/integration-protocol/directory.mjs';
import {descriptorSchema} from '../vendor/integration-protocol/index.mjs';

const scope={categories:['science'],markets:['CA']};
async function setup(){
  const root=await mkdtemp(join(tmpdir(),'integration-directories-')),fixture=fixtureProvider('research',Date.now());
  let clock=Date.now(),behavior:typeof globalThis.fetch|undefined;
  const requests:{url:string;headers:Headers;body:string;method:string|undefined}[]=[];
  const descriptor=descriptorSchema.parse({protocol:'job-integrations',schemaVersion:2,providerId:fixture.connection.providerId,name:'Research sources',website:'https://research.example',resolveUrl:fixture.connection.resolveUrl,authentication:'none',scope,capabilities:['http-json-v1'],signing:{algorithm:'Ed25519',publicKeys:fixture.connection.publicKeys}});
  const catalogue=()=>directorySchema.parse({protocol:'job-provider-directory',schemaVersion:1,directoryId:'independent.example',name:'Independent directory',website:'https://directory.example',generatedAt:new Date(clock).toISOString(),validUntil:new Date(clock+3600000).toISOString(),entries:[{
    id:'research',providerId:descriptor.providerId,name:'Research sources',description:'Science opportunities in Canada',website:descriptor.website,descriptorUrl:'https://research.example/descriptor',providerSchemaVersion:2,scope,capabilities:['http-json-v1'],requiredCapabilities:['http-json-v1'],
  }]});
  const fetch:typeof globalThis.fetch=async(url,init)=>{
    requests.push({url:String(url),headers:new Headers(init?.headers),body:String(init?.body??''),method:init?.method});
    assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');assert.equal(init?.referrerPolicy,'no-referrer');
    if(behavior)return behavior(url,init);
    if(String(url).endsWith('/descriptor'))return Response.json(descriptor);
    if(new URL(String(url)).hostname.endsWith('directory.example'))return Response.json(catalogue());
    return Response.json(fixture.seal());
  };
  const options={databasePath:join(root,'runtime.db'),env:{},now:()=>clock,scraperUrl:'',integrationFetch:fetch,integrationCacheDirectory:join(root,'cache')};
  let h=createHarness(options);
  const search=(input={})=>h.integrationDirectories.search({query:'',scope:{categories:[],markets:[]},capabilities:[],refresh:false,...input});
  return {root,fixture,descriptor,catalogue,requests,search,get h(){return h;},get dispatch(){return createDispatch(h);},get clock(){return clock;},set clock(value:number){clock=value;},set behavior(value:typeof globalThis.fetch|undefined){behavior=value;},
    add(name='Independent directory',url='https://directory.example/catalogue'){return h.integrationDirectories.save({name,url,enabled:true}).directories.find(value=>value.url===url)!;},
    restart(){h.close();h=createHarness(options);},async close(){h.close();await rm(root,{recursive:true,force:true});},
  };
}

test('directories have no default, persist across restart, and cannot store secrets or private URLs',async()=>{
  const s=await setup();try{
    assert.deepEqual(s.h.integrationDirectories.list().directories,[]);assert.equal(s.requests.length,0);
    for(const url of ['http://directory.example','https://localhost/catalogue','https://127.0.0.1/catalogue','https://user:pass@directory.example/catalogue'])assert.equal((await s.dispatch('directories.save',{name:'Bad',url,enabled:true})).ok,false);
    assert.equal((await s.dispatch('directories.save',{name:'Bad',url:'https://directory.example',enabled:true,token:'private'})).ok,false);
    const saved=s.add();assert.equal(s.requests.length,0);
    s.restart();assert.equal(s.h.integrationDirectories.list().directories[0]!.id,saved.id);assert.equal(s.requests.length,0);
    assert.throws(()=>s.add(),/Duplicate directory URLs/);
    s.h.integrationDirectories.remove(saved.id);s.restart();assert.deepEqual(s.h.integrationDirectories.list().directories,[]);
  }finally{await s.close();}
});

test('directory search filters locally without private request data and discovery grants no trust',async()=>{
  const s=await setup();try{
    s.add();const result=await s.search({query:'science Canada',scope});assert.equal(result.results.length,1);assert.equal(result.results[0]!.compatibility.status,'compatible');
    assert.equal((await s.search({query:'private personal phrase absent'})).results.length,0);
    assert.equal((await s.search({scope:{categories:['art'],markets:[]}})).results.length,0);
    assert.equal((await s.search({capabilities:['dom-detail-v2']})).results.length,0);
    assert.equal(s.requests.length,1);assert.equal(s.requests[0]!.url,'https://directory.example/catalogue');assert.equal(s.requests[0]!.method,'GET');assert.equal(s.requests[0]!.body,'');
    for(const request of s.requests){assert.equal(request.headers.has('authorization'),false);assert.equal(request.headers.has('cookie'),false);}
    assert.equal(s.h.integrations.list().connections.length,0);
    const entry=result.results[0]!;
    const review=await s.h.integrationDirectories.inspect({id:entry.directoryId,entryId:entry.id});
    assert.equal(s.requests.at(-1)!.url,'https://research.example/descriptor');assert.equal(review.fingerprints[0]!.sha256.length,64);
    assert.equal(s.h.integrations.list().connections.length,0);
    const input={inspectionId:review.inspectionId,name:'Reviewed',scope,priority:1};
    assert.equal((await s.dispatch('integrations.save',{...input,trusted:false})).ok,false);
    review.descriptor.resolveUrl='https://other.example/resolve';
    const connection=s.h.integrations.save({...input,trusted:true});assert.equal(connection.resolveUrl,s.descriptor.resolveUrl);assert.equal(connection.enabled,false);
    s.h.offers.save({id:'retained',url:'https://jobs.example/retained',position:'Saved',board:'old',text:'Private offer',processing:'fetched',disposition:'applied',firstSeenAt:1,lastSeenAt:2});
    s.h.integrationDirectories.remove(entry.directoryId);s.restart();assert.equal(s.h.integrations.list().connections[0]!.id,connection.id);assert.equal(s.h.offers.get('retained')!.disposition,'applied');
  }finally{await s.close();}
});

test('independent directories isolate overlapping result IDs and surface optional and required incompatibilities',async()=>{
  const s=await setup();try{
    s.add();s.add('Another directory','https://second.directory.example/catalogue');
    s.behavior=async url=>{const catalog=s.catalogue();if(String(url).includes('second.')){
      catalog.entries=[...catalog.entries,{...catalog.entries[0]!,id:'partial',capabilities:['http-json-v1','future-v9']},{...catalog.entries[0]!,id:'unsupported',capabilities:['future-v9'],requiredCapabilities:['future-v9']},{...catalog.entries[0]!,id:'version',providerSchemaVersion:3}];
    }return Response.json(catalog);};
    const results=(await s.search()).results;assert.equal(results.length,5);assert.equal(new Set(results.filter(entry=>entry.id==='research').map(entry=>entry.directoryId)).size,2);
    assert.equal(results.find(entry=>entry.id==='partial')!.compatibility.status,'partial');
    for(const id of ['unsupported','version']){const result=results.find(entry=>entry.id===id)!;await assert.rejects(s.h.integrationDirectories.inspect({id:result.directoryId,entryId:result.id}),/newer/);}
    assert.equal(s.requests.length,2);assert.equal(s.h.integrations.list().connections.length,0);
  }finally{await s.close();}
});

test('outages retain only unexpired metadata and cannot suppress independent directories',async()=>{
  const s=await setup();try{
    const first=s.add();s.add('Another','https://second.directory.example/catalogue');await s.search();
    s.behavior=async url=>String(url).includes('second.')?Response.json(s.catalogue()):new Response('',{status:503});
    let result=await s.search({refresh:true});assert.equal(result.results.length,2);assert.equal(result.directories.find(item=>item.id===first.id)!.status,'cached');
    s.clock+=3600001;result=await s.search({refresh:true});assert.equal(result.results.length,1);assert.equal(result.results[0]!.directoryName,'Another');
    await assert.rejects(s.h.integrationDirectories.inspect({id:first.id,entryId:'research'}),/Refresh/);
  }finally{await s.close();}
});

test('a directory cannot substitute a different provider identity during descriptor inspection',async()=>{
  const s=await setup();try{
    const item=s.add();await s.search();s.behavior=async()=>Response.json({...s.descriptor,providerId:'substituted.example'});
    await assert.rejects(s.h.integrationDirectories.inspect({id:item.id,entryId:'research'}),/identity differs/);
    assert.equal(s.h.integrations.list().connections.length,0);
  }finally{await s.close();}
});

test('malformed, oversized, duplicate and future catalogues never supply results',async()=>{
  const s=await setup();try{
    s.add();
    const cases=[()=>new Response('x'.repeat(500001),{headers:{'content-type':'application/json'}}),()=>Response.json({...s.catalogue(),schemaVersion:2}),()=>{const value=s.catalogue();value.entries.push(value.entries[0]!);return Response.json(value);},()=>Response.json({...s.catalogue(),generatedAt:new Date(s.clock+86400000).toISOString(),validUntil:new Date(s.clock+2*86400000).toISOString()})];
    for(const response of cases){s.behavior=async()=>response();const result=await s.search({refresh:true});assert.deepEqual(result.results,[]);assert.equal(result.directories[0]!.status,'unavailable');}
  }finally{await s.close();}
});

test('disable/re-enable during another directory fetch cannot revive an earlier result or reconnect a provider',async()=>{
  const s=await setup();let release!:()=>void;try{
    const first=s.add();s.add('Slow directory','https://second.directory.example/catalogue');
    let entered!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    s.behavior=async url=>{if(String(url).includes('second.')){entered();await waiting;}return Response.json(s.catalogue());};
    const pending=s.search();await started;
    const input={id:first.id,name:first.name,url:first.url};
    s.h.integrationDirectories.save({...input,enabled:false});s.h.integrationDirectories.save({...input,enabled:true});release();
    const result=await pending;assert.equal(result.results.length,1);assert.equal(result.results[0]!.directoryName,'Slow directory');
    assert.equal(s.h.integrations.list().connections.length,0);
  }finally{release?.();await s.close();}
});
