import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { offerLanguageText } from '../src/capabilities/detectOfferLanguage.js';
import { createHarness, type Harness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { cvDocumentSchema } from '../src/capabilities/cv/document.js';
import type { CapabilityMap, StepContext, OfferReader } from '../src/contracts/index.js';
import type { BoardEntry } from '../src/contracts/board.js';

const profileId='11111111-1111-4111-8111-111111111111';
const waitFor = async (check:()=>boolean) => { for(let i=0;i<500;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Timed out waiting for Board'); };
const mutate = (entry: BoardEntry) => ({entryId:entry.id,expectedRevision:entry.revision,operationId:randomUUID()});
const capability = (name:string, run:(context:StepContext)=>Promise<Record<string,unknown>>):CapabilityMap[string] => ({name,describe:name,input:z.record(z.string(),z.unknown()),plan:()=>({capability:name,source:'declared',stages:[{name:'fixture',concurrency:1,steps:[{name:'fixture',kind:'transform',critical:true,run}]}]})});
const setup = (options: {language?:string; languageUncertain?:boolean; detect?:(context:StepContext)=>Promise<Record<string,unknown>>; reader?:OfferReader; summary?:(context:StepContext)=>Promise<Record<string,unknown>>; databasePath?:string}={}) => {
 const calls: string[]=[];
 const capabilities:CapabilityMap={
  detect_offer_language:capability('detect_offer_language',async(context)=>{calls.push('language');if(options.detect)return options.detect(context);return {detected:options.language ?? 'en',uncertain:options.languageUncertain ?? false,reason:'fixture'};}),
  analyze_offer:capability('analyze_offer',async()=>{calls.push('analyze');return {position:'Engineer',company:'Example',required_skills:['TypeScript'],responsibilities:['Build software']};}),
  generate_evidence_summary:capability('generate_evidence_summary',async context=>{calls.push('summary');assert.equal(context.documents.read('cv')?.body.role_description,'Original facts');assert.throws(()=>context.documents.update('cv','cv',()=>({})));return options.summary?options.summary(context):{summary:'A tailored, evidence-backed Summary.',claims:[],warnings:[]};})
 };
 const harness=createHarness({databasePath:options.databasePath ?? ':memory:',env:{},scraperUrl:'',capabilities,boardReader:options.reader ?? {resolve:async(url)=>({url,finalUrl:url,text:'English job requirements. '.repeat(1400),stated:{title:'Engineer',required_skills:['TypeScript']}})}});
 if(!harness.cvContexts.get(profileId))harness.cvContexts.create(profileId,'en');
 if(!harness.documents.read(profileId))harness.profile.replaceContext(profileId,cvDocumentSchema.parse({role_description:'Original facts',personal:{name:'Test'},experience:[{company:'Example',title:'Engineer',description:'Build software'}]}),0,randomUUID());
 const offer=(id:string)=>{harness.offers.sight([{id,url:`https://example.com/${id}`,position:`Engineer ${id}`,company:'Example',text:'Discovery original'}],1);};
 return {harness,calls,offer,add:(id='one')=>{offer(id);return harness.board.add({offerId:id,operationId:randomUUID()});}};
};
const ready=async(harness:Harness,id:string)=>{await waitFor(()=>['ready','failed','waiting'].includes(harness.board.requireEntry(id).preparation.status));const entry=harness.board.requireEntry(id);assert.equal(entry.preparation.status,'ready',entry.preparation.error);return entry;};

test('prepares isolated complete posting and Summary; duplicate add never restarts',async()=>{
 const {harness,calls,add}=setup();try{
 const profile=JSON.stringify(harness.documents.read(profileId));
 const added=add();const entry=await ready(harness,added.id);
 assert.ok(entry.postings[0]!.text.length>20000);assert.equal(harness.offers.get('one')!.text,'Discovery original');assert.equal(JSON.stringify(harness.documents.read(profileId)),profile);
 assert.equal(entry.applicationStage,'notApplied');assert.equal(entry.cvs.length,2);
 const original=entry.cvs[0]!.document.body,tailored=entry.cvs[1]!.document.body;
 assert.deepEqual({...tailored,role_description:original.role_description},original);
 const again=harness.board.add({offerId:'one',operationId:randomUUID()});assert.equal(again.id,entry.id);assert.deepEqual(calls,['language','analyze','summary']);
 }finally{harness.close();}
});
test('Polish language selects the Polish context, irrespective of Profile selection',async()=>{
 const {harness,add}=setup({language:'pl'});try{
 const id=randomUUID();harness.cvContexts.create(id,'pl');harness.profile.replaceContext(id,cvDocumentSchema.parse({role_description:'Original facts'}),0,randomUUID());
 const entry=await ready(harness,add().id);assert.equal(entry.cvs[0]!.sourceContext.id,id);
 }finally{harness.close();}
});
test('ambiguous or missing language pauses, explicit selection resumes',async()=>{
 for(const language of ['mixed','pl']){
 const {harness,add}=setup({language,languageUncertain:language==='mixed'});try{
 const added=add();await waitFor(()=>harness.board.requireEntry(added.id).preparation.status==='waiting');
 let entry=harness.board.requireEntry(added.id);assert.equal(entry.cvs.length,0);
 entry=harness.board.configure({...mutate(entry),contextId:profileId});entry=await ready(harness,entry.id);assert.equal(entry.language!.detected,language);assert.equal(entry.cvs[0]!.sourceContext.language,'en');
 }finally{harness.close();}}
});
test('unreadable source accepts manually pasted text and records partial provenance',async()=>{
 const {harness,add}=setup({reader:{resolve:async()=>{const {RuntimeError}=await import('../src/contracts/index.js');throw new RuntimeError('Paste the posting','unreadable_source');}}});try{
 const added=add();await waitFor(()=>harness.board.requireEntry(added.id).preparation.status==='waiting');
 const entry=harness.board.configure({...mutate(harness.board.requireEntry(added.id)),postingText:'Manual English requirements'});
 const done=await ready(harness,entry.id);assert.equal(done.postings[0]!.provenance,'manual');assert.equal(done.postings[0]!.completeness,'partial');
 }finally{harness.close();}
});
test('manual Summary and submitted answers remain isolated, immutable, and idempotent',async()=>{
 const {harness,add}=setup();try{
 let one=await ready(harness,add('one').id);const two=await ready(harness,add('two').id);
 one=harness.board.saveAnswers({...mutate(one),answers:[{id:'salary',label:'Salary expectations',value:'20 000 PLN / month'}]});
 const request={...mutate(one),kind:'application' as const,submittedAt:100,destination:'Employer form',channel:'website',answers:one.answers,note:'First submission',cvVersionId:one.currentCvId};
 one=harness.board.recordSubmission(request);assert.equal(harness.board.recordSubmission(request).submissions.length,1);
 one=harness.board.saveAnswers({...mutate(one),answers:[{id:'salary',label:'Salary expectations',value:'22 000 PLN / month'}]});
 one=harness.board.updateSummary({...mutate(one),cvVersionId:one.currentCvId!,summary:'Manually customized Summary'});
 assert.equal(one.submissions[0]!.answers[0]!.value,'20 000 PLN / month');assert.notEqual(one.submissions[0]!.cvVersionId,one.currentCvId);
 assert.deepEqual(harness.board.requireEntry(two.id),two);assert.equal(one.applicationStage,'applied');
 const correction=harness.board.recordSubmission({...mutate(one),kind:'correction',correctsId:one.submissions[0]!.id,submittedAt:100,destination:'Employer form',channel:'website',answers:one.answers,note:'Corrected transcription'});
 assert.equal(correction.submissions.length,2);assert.equal(correction.submissions[0]!.answers[0]!.value,'20 000 PLN / month');
 assert.throws(()=>harness.board.updateSummary({...mutate(one),cvVersionId:one.currentCvId!,summary:'Stale'}),/changed/);
 }finally{harness.close();}
});
test('late AI cannot overwrite a manual edit',async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 const {harness,add,calls}=setup({summary:async()=>{await held;return {summary:'Late generated Summary'};}});try{
 const added=add();await waitFor(()=>calls.includes('summary'));
 let entry=harness.board.requireEntry(added.id);entry=harness.board.updateSummary({...mutate(entry),cvVersionId:entry.currentCvId!,summary:'My manual Summary'});release();await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(harness.board.requireEntry(entry.id).cvs.at(-1)!.document.body.role_description,'My manual Summary');
 }finally{release();await new Promise(resolve=>setTimeout(resolve,20));harness.close();}
});
test('file bytes and hash are preserved and files cannot cross offers',async()=>{
 const {harness,add}=setup();try{
 let entry=await ready(harness,add().id);const other=await ready(harness,add('two').id);
 entry=harness.board.putArtifact({...mutate(entry),name:'sent.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-test').toString('base64'),cvVersionId:entry.currentCvId});
 const artifact=entry.artifacts[0]!;assert.equal(harness.board.artifact(entry.id,artifact.id).base64,Buffer.from('%PDF-test').toString('base64'));assert.equal(artifact.sha256.length,64);
 assert.throws(()=>harness.board.artifact(other.id,artifact.id));
 assert.throws(()=>harness.board.recordSubmission({...mutate(other),kind:'application',submittedAt:100,destination:'',channel:'',answers:[],note:'',artifactId:artifact.id}));
 }finally{harness.close();}
});
test('migration preserves unresolved historical data, never queues work, and repeats safely',()=>{
 const {harness,calls}=setup();try{
 const request={operationId:'migration-one',entries:[{offerId:'missing',addedAt:'2026-09-01T00:00:00Z',stage:'applied',cvDocumentId:'legacy-cv',application:{submittedAt:'2026-09-02T00:00:00Z',cvDocumentId:'legacy-cv',outcome:'interviewing',submitted:{Salary:'Original answer'},note:'HR note'}}]};
 const first=harness.board.importLegacy(request);assert.deepEqual(harness.board.importLegacy(request),first);
 const entry=harness.board.requireEntry(first.imported[0]!);assert.equal(entry.preparation.status,'notStarted');assert.equal(entry.applicationStage,'interviewing');assert.equal(entry.submissions[0]!.legacyCvDocumentId,'legacy-cv');assert.equal(entry.submissions[0]!.note,'HR note');assert.deepEqual(calls,[]);
 }finally{harness.close();}
});
test('restart recovers successful run receipts after the Summary checkpoint was lost',async()=>{
 const root=mkdtempSync(join(tmpdir(),'board-recovery-'));const path=join(root,'runtime.db');
 const first=setup({databasePath:path});let closed=false;
 try{
 let entry=await ready(first.harness,first.add().id);
 first.harness.board.internal(entry.id,entry.preparation.generation,current=>{current.preparation.status='running';current.preparation.steps.summary.status='running';current.currentCvId=current.cvs[0]!.id;current.cvs=current.cvs.slice(0,1);});
 first.harness.close();closed=true;
 const second=setup({databasePath:path});try{entry=await ready(second.harness,entry.id);assert.equal(entry.cvs.length,2);assert.deepEqual(second.calls,[]);}finally{second.harness.close();}
 }finally{if(!closed)first.harness.close();rmSync(root,{recursive:true,force:true});}
});
test('IPC enforces revisions, independent stages, and protocol support',async()=>{
 const {harness,add}=setup();try{
 let entry=await ready(harness,add().id);const dispatch=createDispatch(harness);
 const protocol=await dispatch('protocol.get',{});assert.match(JSON.stringify(protocol),/board-workspaces-v1/);
 const result=await dispatch('board.stage.set',{...mutate(entry),stage:'interviewing'});assert.equal(result.ok,true);
 entry=harness.board.requireEntry(entry.id);assert.equal(entry.applicationStage,'interviewing');assert.equal(entry.preparation.status,'ready');
 assert.equal((await dispatch('board.answers.save',{...mutate(entry),answers:[{id:'x',label:'a',value:'b'},{id:'x',label:'a',value:'b'}]})).ok,false);
 }finally{harness.close();}
});

test('two workers, durable pause/resume, and cancellation never publish late source data',async()=>{
 let running=0,max=0;const releases:Array<()=>void>=[];
 const reader:OfferReader={resolve:async(url,call)=>{running++;max=Math.max(max,running);try{await new Promise<void>((resolve,reject)=>{releases.push(resolve);call.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});return {url,finalUrl:url,text:'English description'};}finally{running--;}}};
 const {harness,add}=setup({reader});try{
 const a=add('a'),b=add('b'),c=add('c');await waitFor(()=>running===2);assert.equal(max,2);
 const entry=harness.board.requireEntry(a.id);harness.board.control({...mutate(entry),action:'pause'});
 releases[0]!();await waitFor(()=>running<2);assert.equal(harness.board.requireEntry(a.id).postings.length,0);
 harness.board.control({...mutate(harness.board.requireEntry(a.id)),action:'resume'});
 for(let i=0;i<100;i++){for(const release of releases.splice(0))release();if([a,b,c].every(item=>harness.board.requireEntry(item.id).preparation.status==='ready'))break;await new Promise(resolve=>setTimeout(resolve,20));}
 for(const item of [a,b,c])assert.equal(harness.board.requireEntry(item.id).preparation.status,'ready');assert.equal(max,2);
 }finally{for(const release of releases)release();await new Promise(resolve=>setTimeout(resolve,30));harness.close();}
});
test('opportunity merges and splits keep the chosen application source and history',async()=>{
 const {harness,offer,add}=setup();try{
 const first=await ready(harness,add('first').id);offer('sibling');harness.opportunities.link('first','sibling');
 const same=harness.board.add({offerId:'sibling',operationId:randomUUID()});assert.equal(same.id,first.id);assert.equal(same.offerId,'first');
 harness.opportunities.separate('sibling');const separate=harness.board.add({offerId:'sibling',operationId:randomUUID()});assert.notEqual(separate.id,first.id);await ready(harness,separate.id);
 assert.deepEqual(harness.board.requireEntry(first.id),first);
 }finally{harness.close();}
});
test('every completed step survives restart without refetching or repeating its model call',async()=>{
 for(const step of ['fetch','language','copyCv','analyze','summary'] as const){
  const root=mkdtempSync(join(tmpdir(),'board-checkpoint-'));const path=join(root,'runtime.db');const first=setup({databasePath:path});
  let id:string;
  try{
   const original=await ready(first.harness,first.add().id);id=original.id;
   first.harness.board.internal(id,original.preparation.generation,entry=>{
    const order=['fetch','language','copyCv','analyze','summary'];const at=order.indexOf(step);
    for(const [index,name] of order.entries())if(index>at)entry.preparation.steps[name as typeof step].status='pending';
    entry.preparation.status='running';
    if(step!=='summary'){entry.cvs=entry.cvs.slice(0,1);entry.currentCvId=entry.cvs[0]!.id;}
   });
  }finally{first.harness.close();}
  let fetched=0;const second=setup({databasePath:path,reader:{resolve:async url=>{fetched++;return {url,finalUrl:url,text:'Posting'};}}});
  try{await ready(second.harness,id);assert.equal(fetched,0);assert.deepEqual(second.calls,[]);}finally{second.harness.close();rmSync(root,{recursive:true,force:true});}
 }
});
test('transient failures stop after bounded retries and explicit retry can recover',async()=>{
 let fail=true;let requests=0;const {harness,add}=setup({reader:{resolve:async url=>{requests++;if(fail)throw new Error('Temporary network error');return {url,finalUrl:url,text:'Posting'};}}});try{
 const added=add();
 for(let i=0;i<3;i++){await waitFor(()=>harness.board.requireEntry(added.id).preparation.steps.fetch.attempts>=i+1);const entry=harness.board.requireEntry(added.id);harness.board.internal(entry.id,entry.preparation.generation,current=>{current.preparation.retryAt=0;});await new Promise(resolve=>setTimeout(resolve,550));}
 let entry=harness.board.requireEntry(added.id);assert.equal(requests,3);assert.equal(entry.preparation.status,'failed');fail=false;
 entry=harness.board.control({...mutate(entry),action:'retry'});await ready(harness,entry.id);assert.equal(requests,4);
 }finally{harness.close();}
});


test('replaying a lost preparation-control reply does not cancel its replacement work',async()=>{
 let release!:()=>void;let hold=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 const {harness,add}=setup({reader:{resolve:async(url)=>{if(hold)await gate;return {url,finalUrl:url,text:'English job requirements'};}}});
 try {
  const entry=await ready(harness,add().id);hold=true;
  const request={...mutate(entry),action:'refreshPosting' as const};
  const receipt=harness.board.control(request);
  assert.deepEqual(harness.board.control(request),receipt);
  release();const refreshed=await ready(harness,entry.id);
  assert.equal(refreshed.postings.length,2);assert.equal(refreshed.cvs.length,4);
 } finally {release();await new Promise(resolve=>setTimeout(resolve,20));harness.close();}
});


test('missing and empty CV documents wait for Profile setup and resume with the selected language',async()=>{
 for(const empty of [false,true]) {
  const {harness,add}=setup({language:'pl'});
  try {
   const contextId=randomUUID();harness.cvContexts.create(contextId,'pl');
   if(empty)harness.profile.replaceContext(contextId,cvDocumentSchema.parse({}),0,randomUUID());
   const added=add();await waitFor(()=>['waiting','failed'].includes(harness.board.requireEntry(added.id).preparation.status));
   const waiting=harness.board.requireEntry(added.id);
   assert.equal(waiting.preparation.status,'waiting');assert.equal(waiting.preparation.code,'selection_required');
   assert.equal(waiting.cvs.length,0);
   const revision=harness.documents.read(contextId)?.revision ?? 0;
   harness.profile.replaceContext(contextId,cvDocumentSchema.parse({role_description:'Original facts'}),revision,randomUUID());
   harness.board.control({...mutate(waiting),action:'resume'});
   const entry=await ready(harness,added.id);assert.equal(entry.cvs[0]!.sourceContext.id,contextId);
  }finally{harness.close();}
 }
});


test('language detection receives employer content, excluding Polish job-board furniture', async () => {
 const description = 'We are looking for an engineer to build reliable applications.\nYou will design cloud services and collaborate with our product team.';
 const chrome = 'Oferta pracy Senior Engineer\nPrzejdź do treści ogłoszenia\nWybrano język polski\nAplikuj';
 assert.equal(offerLanguageText(`${chrome}\nTwój zakres obowiązków\n${description}\nBenefity\nUbezpieczenie zdrowotne\nPodobne oferty\nProgramista`), description);
 assert.equal(offerLanguageText(chrome), '');
 const polish = 'Projektowanie aplikacji oraz rozwijanie usług dla klientów.\nWspółpraca z zespołem produktowym i utrzymywanie jakości kodu.';
 assert.equal(offerLanguageText(`Apply now\nYour responsibilities\n${polish}\nBenefits\nHealth insurance`), polish);
 const {harness,add}=setup({
  reader:{resolve:async url=>({url,finalUrl:url,text:`${chrome}\n${description}`,descriptionText:description})},
  detect:async context=>{assert.equal(context.input.text,description);return {detected:'en',uncertain:false,reason:'Employer description'};}
 });
 try {
  const entry=await ready(harness,add().id);
  assert.equal(entry.cvs.at(-1)!.sourceContext.language,'en');
  assert.ok(entry.postings[0]!.text.includes('Przejdź do'));
 }finally{harness.close();}
});

test('new detection updates automatic CV choice; manual PL/EN survives posting and CV refreshes', async () => {
 let detected='pl';
 const {harness,add}=setup({detect:async()=>({detected,uncertain:false,reason:'Employer description'})});
 try {
  const pl=randomUUID();harness.cvContexts.create(pl,'pl');
  harness.profile.replaceContext(pl,cvDocumentSchema.parse({role_description:'Original facts'}),0,randomUUID());
  let entry=await ready(harness,add().id);
  assert.equal(entry.cvs.at(-1)!.sourceContext.id,pl);
  assert.equal(entry.languageOverride,undefined);
  detected='en';
  entry=harness.board.control({...mutate(entry),action:'refreshPosting'});
  entry=await ready(harness,entry.id);
  assert.equal(entry.cvs.at(-1)!.sourceContext.id,profileId);
  entry=harness.board.configure({...mutate(entry),language:'pl'});
  entry=await ready(harness,entry.id);
  assert.equal(entry.languageOverride,'pl');
  assert.equal(entry.cvs.at(-1)!.sourceContext.id,pl);
  for(const action of ['refreshPosting','refreshCv'] as const) {
   entry=harness.board.control({...mutate(entry),action});
   entry=await ready(harness,entry.id);
   assert.equal(entry.language!.detected,'en');
   assert.equal(entry.languageOverride,'pl');
   assert.equal(entry.cvs.at(-1)!.sourceContext.id,pl);
  }
 }finally{harness.close();}
});

test('only navigation leaves language unresolved instead of choosing a CV', async () => {
 const {harness,add,calls}=setup({reader:{resolve:async url=>({url,finalUrl:url,text:'Oferta pracy\nPrzejdź do treści ogłoszenia\nAplikuj'})}});
 try {
  const added=add();await waitFor(()=>harness.board.requireEntry(added.id).preparation.status==='waiting');
  const entry=harness.board.requireEntry(added.id);
  assert.equal(entry.language!.detected,'unknown');assert.equal(entry.cvs.length,0);assert.deepEqual(calls,[]);
 }finally{harness.close();}
});

test('removing an offer purges its workspace and run data, survives restart, and re-adds fresh', async () => {
 const directory = mkdtempSync(join(tmpdir(), 'board-removal-'));
 const databasePath = join(directory, 'runtime.db');
 const fixture = setup({databasePath});
 let harness = fixture.harness;
 try {
  fixture.offer('one');
  const addRequest = {offerId:'one', operationId:randomUUID()};
  let entry = await ready(harness, harness.board.add(addRequest).id);
  const other = await ready(harness, fixture.add('two').id);
  const source = harness.offers.get('one');
  const profile = harness.documents.read(profileId);
  const answerRequest = {...mutate(entry), answers:[{id:'salary',label:'Salary',value:'REMOVED PRIVATE ANSWER'}]};
  entry = harness.board.saveAnswers(answerRequest);
  entry = harness.board.addNote({...mutate(entry),text:'REMOVED PRIVATE NOTE',at:100});
  entry = harness.board.putArtifact({...mutate(entry),name:'private.pdf',mime:'application/pdf',base64:Buffer.from('REMOVED FILE').toString('base64'),cvVersionId:entry.currentCvId});
  entry = harness.board.recordSubmission({...mutate(entry),kind:'application',submittedAt:100,destination:'Employer',channel:'website',answers:entry.answers,note:'REMOVED APPLICATION',artifactId:entry.artifacts[0]!.id,cvVersionId:entry.currentCvId});
  const runs = harness.board.runsFor(entry.id).map(run => run.runId);
  const request = mutate(entry);
  const removed = harness.board.drop(request);
  assert.deepEqual(removed,{id:entry.id,offerId:'one',archived:true,removed:true});
  assert.equal(harness.board.get(entry.id),undefined);
  assert.equal(harness.board.internal(entry.id,entry.preparation.generation,()=>assert.fail('Late work must not commit')),undefined);
  assert.throws(() => harness.board.artifact(entry.id,entry.artifacts[0]!.id), /unavailable/);
  for (const runId of runs) assert.equal(harness.runs.get(runId),undefined);
  assert.deepEqual(harness.board.requireEntry(other.id),other);
  assert.deepEqual(harness.offers.get('one'),source);
  assert.deepEqual(harness.documents.read(profileId),profile);
  assert.ok(harness.board.poll(0).entries.some(row => row.id===entry.id && row.archived));
  assert.throws(() => harness.board.add(addRequest), /removed/);
  assert.throws(() => harness.board.saveAnswers(answerRequest), /removed/);
  const {default:Database} = await import('better-sqlite3');
  const db = new Database(databasePath,{readonly:true});
  try {
   for (const table of ['board_artifacts','board_run_inputs']) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE entry_id=?`).get(entry.id) as {count:number}).count,0);
   }
   for (const runId of runs) assert.equal(db.prepare('SELECT 1 FROM board_run_authorizations WHERE run_id=?').get(runId),undefined);
   const receipts=JSON.stringify(db.prepare('SELECT result FROM board_operations').all());
   assert.ok(!receipts.includes('REMOVED PRIVATE'));
   assert.ok(!receipts.includes('REMOVED APPLICATION'));
  } finally {db.close();}
  harness.close();
  harness = setup({databasePath}).harness;
  assert.equal(harness.board.get(entry.id),undefined);
  assert.deepEqual(harness.board.drop(request),removed);
  const fresh = harness.board.add({offerId:'one',operationId:randomUUID()});
  assert.notEqual(fresh.id,entry.id);
  assert.equal(fresh.applicationStage,'notApplied');
  for (const key of ['cvs','answers','artifacts','submissions','postings'] as const) assert.deepEqual(fresh[key],[]);
  assert.equal(fresh.history.length,1);
  assert.deepEqual(harness.board.drop(request),removed);
  assert.ok(harness.board.get(fresh.id));
  await ready(harness,fresh.id);
 } finally {harness.close();rmSync(directory,{recursive:true,force:true});}
});

test('removal cancels active preparation and rejects late model results without restoring data', async () => {
 let release!:()=>void;
 const held = new Promise<void>(resolve => {release=resolve;});
 const {harness,add,calls} = setup({summary:async()=>{await held;return {summary:'Late Summary'};}});
 try {
  const initial=add();
  await waitFor(()=>calls.includes('summary'));
  const entry=harness.board.requireEntry(initial.id);
  const runs=harness.board.runsFor(entry.id).map(run=>run.runId);
  assert.throws(()=>harness.board.drop({...mutate(entry),expectedRevision:1}), /changed/);
  assert.ok(harness.board.get(entry.id));
  harness.board.drop(mutate(entry));
  release();
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(harness.board.get(entry.id),undefined);
  assert.deepEqual(harness.board.runsFor(entry.id),[]);
  for(const id of runs) assert.equal(harness.runs.get(id),undefined);
  assert.deepEqual(harness.board.list(),[]);
 } finally {release();await new Promise(resolve=>setTimeout(resolve,20));harness.close();}
});


test('the board keeps no conversation: its channels are gone and migration 39 drops its messages', async () => {
 const { open } = await import('../src/storage/sqlite/open.js');
 const { migrate, migrations } = await import('../src/storage/sqlite/migrate.js');
 const db = open(':memory:');
 try {
  migrate(db, migrations.filter(m => m.version <= 38));
  db.prepare("INSERT INTO board_chat_messages VALUES ('m','entry','run','user','{}')").run();
  migrate(db);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'board_chat%'").get(), undefined);
 } finally { db.close(); }
 const {harness}=setup();
 try {
  const dispatch=createDispatch(harness);
  for (const channel of ['board.chat.start','board.chat.get','board.chat.cancel']) {
   const response=await dispatch(channel,{entryId:'entry'});
   assert.ok(!response.ok && response.error.code==='unknown_channel',channel);
  }
 } finally { harness.close(); }
});
