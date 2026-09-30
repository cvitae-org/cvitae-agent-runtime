// Opt-in only: DISCOVER_FACTS_LIVE=1 node --env-file=.env scripts/discovery-sql-live-smoke.mjs
// Synthetic public data, temporary database; configured provider only, no source collection.
import { open } from '../dist/storage/sqlite/open.js';
import process from 'node:process';
import console from 'node:console';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHarness } from '../dist/runtime/create.js';
if(process.env.DISCOVER_FACTS_LIVE!=='1') throw Error('Set DISCOVER_FACTS_LIVE=1 to opt in.');
const failures=[];const actualFetch=globalThis.fetch;
globalThis.fetch=async(...args)=>{const response=await actualFetch(...args);if(!response.ok)failures.push({status:response.status,body:(await response.clone().text()).slice(0,1000)});return response;};
const directory=mkdtempSync(join(tmpdir(),'discover-facts-live-'));
const h=createHarness({databasePath:join(directory,'runtime.sqlite'),env:process.env,scraperUrl:'',timeoutMs:60000});
try {
 const id='synthetic',identity={id,importKey:'smoke'};
 h.discoverySearches.begin({...identity,phrase:'React',boards:['vacancies'],filters:{},rowCount:3});
 h.discoverySearches.append({...identity,offset:0,items:[0,1,2].map(i=>({offer:{id:`synthetic-${i}`,text:i===0?'You will join an engineering team of 4 developers.':i===1?'Our company has 4 employees. The engineering team size is not specified.':'You will join an engineering team of 12 developers.',stated:{title:'React Engineer',work_mode:i===2?'onsite':'remote'}}}))});h.discoverySearches.finish(identity);
 const captured=await h.offerQueries.context(id,{kind:'search',searchId:id});
 h.discoveryChat.send({version:2,searchId:id,conversationId:h.discoveryChat.get(id).conversationId,runId:'smoke',question:'Use selective AI extraction to identify the number of developers in each engineering team, then list offers where that number is at most 5. Company size is not team size. Cite matching offers and report unknowns.',scope:'all',filterRevision:0,language:'en',snapshotId:captured.snapshotId,scopeRevision:captured.scopeRevision});
 while(['queued','running','suspended'].includes(h.runs.get('smoke')?.status)) await delay(100);
 const result=h.discoveryChat.get(id),answer=result.messages.find(m=>m.role==='assistant');
 const a=answer?.queryArtifact,pass=!!a?.extraction && a.rows.length===1 && a.rows[0].includes('synthetic-0') && a.extraction.notStated+a.extraction.ambiguous>=1;
 const debug=open(join(directory,'runtime.sqlite'));const queries=debug.prepare("SELECT request,state,error FROM offer_query_executions WHERE validation_only=0").all();debug.close();
 console.log(JSON.stringify({failures,queries,provider:process.env.AI_PROVIDER,model:process.env.AI_MODEL??'provider default',pass,latest:result.latest,query:a,answer:answer?.text},null,2));
 if(!pass) process.exitCode=1;
}finally{h.close();rmSync(directory,{recursive:true,force:true});}
