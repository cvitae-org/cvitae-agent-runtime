// Opt-in only: DISCOVER_SQL_LIVE=1 node --env-file=.env scripts/discovery-sql-live-smoke.mjs
// Synthetic public data, temporary database; configured provider only, no source collection.
import process from 'node:process';
import console from 'node:console';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHarness } from '../dist/runtime/create.js';
if(process.env.DISCOVER_SQL_LIVE!=='1') throw Error('Set DISCOVER_SQL_LIVE=1 to opt in.');
const directory=mkdtempSync(join(tmpdir(),'discover-sql-live-'));
const h=createHarness({databasePath:join(directory,'runtime.sqlite'),env:process.env,scraperUrl:'',timeoutMs:60000});
try {
 const id='synthetic',identity={id,importKey:'smoke'};
 h.discoverySearches.begin({...identity,phrase:'React',boards:['vacancies'],filters:{},rowCount:3});
 h.discoverySearches.append({...identity,offset:0,items:[0,1,2].map(i=>({offer:{id:`synthetic-${i}`,text:'Synthetic public job.',stated:{title:'React Engineer',work_mode:i===2?'onsite':'remote'}}}))});h.discoverySearches.finish(identity);
 const captured=await h.offerQueries.context(id,{kind:'search',searchId:id});
 h.discoveryChat.send({version:2,searchId:id,conversationId:h.discoveryChat.get(id).conversationId,runId:'smoke',question:process.env.DISCOVER_SQL_QUESTION || 'How many saved roles explicitly offer remote work? Return the exact count.',scope:'all',filterRevision:0,language:'en',snapshotId:captured.snapshotId,scopeRevision:captured.scopeRevision});
 while(['queued','running','suspended'].includes(h.runs.get('smoke')?.status)) await delay(100);
 const result=h.discoveryChat.get(id),answer=result.messages.find(m=>m.role==='assistant');
 const a=answer?.queryArtifact,pass=!!a && (process.env.DISCOVER_SQL_QUESTION ? a.rows.length===2 && answer.references.length>0 : a.rows.length===1 && a.rows[0].length===1 && a.rows[0][0]===2 && /2|two/i.test(answer.text));
 console.log(JSON.stringify({provider:process.env.AI_PROVIDER,model:process.env.AI_MODEL??'provider default',pass,latest:result.latest,query:a,answer:answer?.text},null,2));
 if(!pass) process.exitCode=1;
}finally{h.close();rmSync(directory,{recursive:true,force:true});}
