import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHarness} from '../src/runtime/create.js';
import {createDiscoverySource} from '../src/effects/discovery.js';
import {createDispatch} from '../src/adapters/ipc/dispatch.js';
import {createIntegrationProviders} from '../src/effects/integration-providers.js';
import {fixtureProvider} from './fixtures/integration-provider.js';
import {sourceKey} from '../vendor/integration-protocol/node.mjs';
test('the default has no implicit provider and performs no discovery requests',async()=>{
 const h=createHarness({databasePath:':memory:',env:{},scraperUrl:''});
 try{
  const response=await h.discovery.boards();assert.deepEqual(response.boards,[]);
  assert.equal((await createDispatch(h)('discovery.browserSearch',{board:'unknown',keyword:'Research'})).ok,false);
 }finally{h.close();}
});
test('a signed provider owns browser query routes, including technical tokens',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'browser-provider-')),provider=fixtureProvider('laboratory',Date.now());
 const source=provider.snapshot.sources[0]!;source.routes={listing:'https://jobs.example/vacancies',offerPathPrefix:'/offer/',search:{kind:'query',parameter:'search'}};
 source.website='https://jobs.example';source.hosts=['jobs.example'];source.modes=['external-link'];delete source.recipe;
 const providers=createIntegrationProviders([provider.connection],{cacheDirectory:dir,fetch:async()=>Response.json(provider.seal())});
 const discovery=createDiscoverySource({url:'',providers,fetch:async()=>assert.fail('Browser planning must not request the collector')});
 const h=createHarness({databasePath:':memory:',env:{},scraperUrl:'',integrationProviders:providers,discoverySource:discovery});
 try{
  const dispatch=createDispatch(h),board=sourceKey('laboratory',source.id),keyword='C++ / C# & Research Łódź';
  const result=await dispatch('discovery.browserSearch',{board,keyword});assert.equal(result.ok,true,JSON.stringify(result));if(!result.ok)assert.fail();
  assert.equal(new URL((result.data as {url:string}).url).searchParams.get('search'),keyword);
  for(const payload of [{board:'unknown',keyword},{board,keyword:'x'.repeat(301)},{board,keyword,url:'https://evil.example'}])assert.equal((await dispatch('discovery.browserSearch',payload)).ok,false);
 }finally{h.close();rmSync(dir,{recursive:true,force:true});}
});
