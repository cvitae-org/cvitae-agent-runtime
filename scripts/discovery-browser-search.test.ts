import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHarness} from '../src/runtime/create.js';
import { createDiscoverySource } from '../src/effects/discovery.js';
import {createDispatch} from '../src/adapters/ipc/dispatch.js';
test('browser search planning is local, bounded and independent of scraper/provider credentials', async()=>{
  const directory=mkdtempSync(join(tmpdir(),'cvitae-browser-search-'));
  const harness=createHarness({databasePath:join(directory,'test.db'),env:{},scraperUrl:'',discoverySource: createDiscoverySource({url:'', fetch:async()=>{throw new Error('Must not contact scraper');}})});
  const dispatch=createDispatch(harness);
  try {
    const result=await dispatch('discovery.browserSearch',{board:'bulldogjob',keyword:'Senior Frontend React developer'});
    assert.equal(result.ok,true,JSON.stringify(result));
    if(result.ok) {
      const plan=result.data as {url:string;needsReview:boolean;filters:unknown[]};
      assert.equal(plan.url,'https://bulldogjob.pl/companies/jobs/s/role,frontend/skills,React/experienceLevel,senior');assert.equal(plan.needsReview,false);
    }
    const protocol=await dispatch('discovery.browserSearch',{board:'theprotocol',keyword:'C# developer'});
    assert.equal(protocol.ok,true);
    if(protocol.ok) assert.equal(new URL((protocol.data as {url:string}).url).searchParams.get('kw'),'C# developer');
    const linkedin = await dispatch('discovery.browserSearch', {board:'linkedin',keyword:'C++ / C# & React Łódź'});
    assert.equal(linkedin.ok,true);
    if(linkedin.ok) assert.equal(new URL((linkedin.data as {url:string}).url).searchParams.get('keywords'),'C++ / C# & React Łódź');
    for(const payload of [{board:'evil',keyword:'React'},{board:'bulldogjob',keyword:'x'.repeat(301)},{board:'bulldogjob',keyword:'React',url:'https://evil.example'}]) assert.equal((await dispatch('discovery.browserSearch',payload)).ok,false);
  } finally {harness.close();rmSync(directory,{recursive:true,force:true});}
});
