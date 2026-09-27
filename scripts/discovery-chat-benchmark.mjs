import process from 'node:process';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers';
// After pnpm build: node scripts/discovery-chat-benchmark.mjs 10000
// Synthetic local data only; zero model/network calls. Each invocation is isolated.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHarness } from '../dist/runtime/create.js';
import { retrieveDiscovery } from '../dist/storage/sqlite/discovery-query.js';
import { emptyDiscoveryQuery } from '../dist/contracts/discovery-query.js';
const require=createRequire(import.meta.url);
const Database=require('better-sqlite3');
const count=Number(process.argv[2] ?? 1000);
if (![1000,10000].includes(count)) throw new Error('Choose 1000 or 10000 synthetic offers.');
const directory=mkdtempSync(join(tmpdir(),'discovery-scale-')), path=join(directory,'runtime.sqlite');
const h=createHarness({databasePath:path,env:{AI_PROVIDER:'local'},scraperUrl:''});
const baseline=process.memoryUsage().rss, started=performance.now();
try {
 h.discoverySearches.create('scope','engineering',['justjoin']);
 for(let offset=0;offset<count;offset+=100) {
  const batch=Array.from({length:Math.min(100,count-offset)},(_,j)=>{
   const i=offset+j,frontend=i%2===0;
   return {id:'synthetic-'+i,board:'justjoin',position:frontend?'Frontend Engineer':'Backend Engineer',company:'Synthetic company '+(i%73),workMode:i%3?'remote':'onsite',location:i%2?'Warsaw':'Krakow',skills:frontend?['React','TypeScript','Accessibility']:['Python','PostgreSQL','Docker'],text:(frontend?'Build accessible React interfaces using TypeScript. ':'Maintain Python services and PostgreSQL databases. ').repeat(35),salaryReading:i%7?{min:10000+i%15000,max:20000+i%15000,currency:i%5?'PLN':'EUR',period:i%5?'month':'year'}:{min:null,max:null,currency:'',period:''}};
  });
  h.offers.sight(batch,Date.now());h.discoverySearches.add('scope',batch.map(o=>({offer:h.offers.get(o.id)})));
 }
 const loadMs=performance.now()-started;
 const conversationId=h.discoveryChat.get('scope').conversationId, capture=performance.now();
 h.discoveryChat.send({searchId:'scope',conversationId,runId:'count',question:'How many offers?',scope:'all',filterRevision:0,language:'en'});
 const captureMs=performance.now()-capture;
 while(['queued','running'].includes(h.runs.get('count')?.status)) await new Promise(resolve=>setTimeout(resolve,1));
 const db=new Database(path);
 try {
  const context=JSON.parse(db.prepare('SELECT evidence FROM discovery_chat_turns WHERE run_id=?').get('count').evidence);
  const start=performance.now();
  const result=retrieveDiscovery(db,context,{...emptyDiscoveryQuery(),mode:'salary',termGroups:[['Frontend']],workMode:'remote'});
  const queryMs=performance.now()-start;
  console.log(JSON.stringify({offers:count,loadMs:Math.round(loadMs),captureMs:Math.round(captureMs),queryMs:Math.round(queryMs),matched:result.matchedCount,evidenceChars:JSON.stringify(result.evidence).length,resultChars:JSON.stringify(result).length,rssMb:Math.round(process.memoryUsage().rss/1024/1024),rssGrowthMb:Math.round((process.memoryUsage().rss-baseline)/1024/1024),databaseMb:Math.round((statSync(path).size+(statSync(path+'-wal').size))/1024/1024),modelCalls:db.prepare('SELECT count(*) AS n FROM ai_calls').get().n}));
 } finally {db.close();}
} finally {h.close();rmSync(directory,{recursive:true,force:true});}
