import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
// After pnpm build: node --env-file=.env scripts/discovery-chat-live-smoke.mjs
// Uses the configured provider with synthetic offers only; at most two requests,
// a 60-second deadline, and no changes to the user database. Never print secrets.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHarness } from '../dist/runtime/create.js';
const originalFetch=globalThis.fetch;
globalThis.fetch=async (...args)=>{
 try {const response=await originalFetch(...args); console.log(JSON.stringify({upstreamStatus:response.status}));return response;}
 catch(error){console.log(JSON.stringify({transportError:error?.cause?.code ?? error?.name}));throw error;}
};
const directory=mkdtempSync(join(tmpdir(),'discover-live-'));
const h=createHarness({databasePath:join(directory,'runtime.sqlite'),env:process.env,scraperUrl:''});
const search='synthetic-live-smoke', run='synthetic-live-question';
let timedOut=false;
const timeout=setTimeout(()=>{timedOut=true;try{h.discoveryChat.cancel(search,run);}catch { /* The turn may already have settled. */ }},60000);
try {
 h.discoverySearches.create(search,'frontend',['justjoin']);
 const offers=[{id:'synthetic-a',position:'Frontend Engineer',company:'Synthetic Cedar',workMode:'remote',text:'Public synthetic fixture: remote frontend role.',salary:'10000–20000 PLN/month',salaryReading:{min:10000,max:20000,currency:'PLN',period:'month'}},{id:'synthetic-b',position:'Frontend Engineer',company:'Synthetic Birch',workMode:'remote',text:'Public synthetic fixture: remote frontend role.',salary:'20000–30000 PLN/month',salaryReading:{min:20000,max:30000,currency:'PLN',period:'month'}},{id:'synthetic-c',position:'Frontend Engineer',company:'Synthetic Elm',workMode:'onsite',text:'Public synthetic fixture: onsite frontend role.',salary:'1000–2000 EUR/month',salaryReading:{min:1000,max:2000,currency:'EUR',period:'month'}}];
 h.offers.sight(offers,Date.now());h.discoverySearches.add(search,offers.map(o=>({offer:h.offers.get(o.id)})));
 const {conversationId}=h.discoveryChat.get(search);
 h.discoveryChat.send({searchId:search,conversationId,runId:run,question:'What are the salary statistics for the remote frontend offers? Keep currencies and pay periods separate.',scope:'all',filterRevision:0,language:'en'});
 while(!timedOut && ['queued','running','suspended'].includes(h.runs.get(run)?.status)) await new Promise(resolve=>setTimeout(resolve,250));
 if(timedOut) await new Promise(resolve=>setTimeout(resolve,500));
 const result=h.discoveryChat.get(search);
 console.log(JSON.stringify({latest:result.latest,answer:result.messages.find(m=>m.role==='assistant')},null,2));
} finally { clearTimeout(timeout);h.close();rmSync(directory,{recursive:true,force:true}); }
