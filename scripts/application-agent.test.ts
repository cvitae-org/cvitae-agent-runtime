import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createHarness, type Harness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { cvDocumentSchema } from '../src/capabilities/cv/document.js';
import type { CapabilityMap, StepContext } from '../src/contracts/index.js';
import type { ApplicationField, ApplicationObservation } from '../src/contracts/application-agent.js';

const profileId='11111111-1111-4111-8111-111111111111';
const waitFor=async(check:()=>boolean)=>{for(let n=0;n<300;n++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Application fixture timed out');};
const capability=(name:string,run:(context:StepContext)=>Promise<Record<string,unknown>>):CapabilityMap[string]=>({name,describe:name,input:z.record(z.string(),z.unknown()),plan:()=>({capability:name,source:'declared',stages:[{name:'fixture',concurrency:1,steps:[{name:'fixture',kind:'transform',critical:true,run}]}]})});
const fixture=(options:{databasePath?:string;draft?:(context:StepContext)=>Promise<Record<string,unknown>>}={})=>{
  const drafts:StepContext[]=[];
  const harness=createHarness({databasePath:options.databasePath??':memory:',env:{},scraperUrl:'',boardReader:{resolve:async url=>({url,finalUrl:url,text:'Example builds accessible software. Engineer role uses TypeScript.'})},capabilities:{
    detect_offer_language:capability('detect_offer_language',async()=>({detected:'en',uncertain:false})),
    analyze_offer:capability('analyze_offer',async()=>({position:'Engineer',company:'Example'})),
    generate_evidence_summary:capability('generate_evidence_summary',async()=>({summary:'Prepared Board summary',claims:[],warnings:[]})),
    draft_application_fields:capability('draft_application_fields',async context=>{
      drafts.push(context);
      assert.throws(()=>context.documents.update('cv','cv',()=>({})),/read.only|snapshot|cannot|bound|immutable/i);
      return options.draft?options.draft(context):{answers:[{fieldId:'letter',value:'I would like to bring my TypeScript experience to Example’s accessible software team.',source:'draft',evidence:['profile.experience.0.title']}],missing:[]};
    })
  }});
  if(!harness.cvContexts.get(profileId)) {
    harness.cvContexts.create(profileId,'en');
    harness.profile.replaceContext(profileId,cvDocumentSchema.parse({personal:{name:'Ada Lovelace',email:'ada@example.org',phone:'+48123456789'},experience:[{company:'Example',title:'TypeScript engineer',highlights:['Built accessible interfaces']}]}),0,randomUUID());
  }
  return {harness,drafts,async ready(){
    harness.offers.sight([{id:'offer',url:'https://careers.example.org/job',position:'Engineer',company:'Example',text:'Discovery'}],1);
    const entry=harness.board.add({offerId:'offer',operationId:randomUUID()});
    await waitFor(()=>harness.board.requireEntry(entry.id).preparation.status==='ready');
    return harness.board.requireEntry(entry.id);
  }};
};
const field=(id:string,overrides:Partial<ApplicationField>={}):ApplicationField=>({id,key:id,label:id,type:'text',required:true,value:'',valid:false,options:[],autocomplete:'',maxLength:-1,cv:false,attached:false,...overrides});
const observation=(fields:ApplicationField[],controls:ApplicationObservation['frames'][number]['controls']=[],form=true):ApplicationObservation=>({id:randomUUID(),frames:[{id:'frame',url:'https://careers.example.org/application',title:'Application',text:'Application for Engineer at Example',form,blocked:'',fields,controls}]});
const start=(harness:Harness,entryId:string)=>harness.applicationAgent.start({entryId,sessionId:randomUUID(),cvVersionId:harness.board.requireEntry(entryId).currentCvId!,preferences:{location:{country:'Poland'},details:{'Work authorization':'Yes'}}});
const fill=(fields:ApplicationField[],values:{fieldId:string;value:string}[])=>fields.map(f=>values.some(v=>v.fieldId===f.id)?{...f,value:values.find(v=>v.fieldId===f.id)!.value,valid:true}:f);

test('separate application flow navigates, copies Profile, drafts, attaches and stops for review with DOM answers',async()=>{
  const {harness,ready,drafts}=fixture();try {
    const entry=await ready(),before=JSON.stringify(entry.preparation),profile=JSON.stringify(harness.documents.read(profileId));
    const session=start(harness,entry.id),owner={entryId:entry.id,sessionId:session.id};
    const inspect=observation([],[{id:'apply',kind:'apply',label:'Apply now',href:'https://careers.example.org/application'}],false);
    let action=await harness.applicationAgent.observe({...owner,observation:inspect});assert.equal(action.kind,'navigate');
    assert.deepEqual(await harness.applicationAgent.observe({...owner,observation:inspect}),action,'lost-reply retry keeps its action');
    harness.applicationAgent.report({...owner,actionId:action.id,ok:true,message:''});
    let fields=[field('name',{label:'Imię i nazwisko'}),field('email',{type:'email'}),field('country',{label:'Country',type:'select',options:[{value:'PL',label:'Poland'}]}),field('letter',{type:'textarea',label:'Cover letter'}),field('cv',{type:'file',label:'CV',cv:true}),field('note',{label:'Optional referral',required:false,valid:true}),field('portfolio',{type:'file',label:'Portfolio attachment',required:false,valid:true,value:'sample.pdf',attached:true})];
    const controls=[{id:'send',kind:'submit' as const,label:'Send application',href:''}];
    action=await harness.applicationAgent.observe({...owner,observation:observation(fields,controls)});assert.equal(action.kind,'fill');
    assert.equal(action.values!.find(v=>v.fieldId==='name')!.value,'Ada Lovelace');
    assert.equal(action.values!.find(v=>v.fieldId==='country')!.value,'PL');
    fields=fill(fields,action.values!);harness.applicationAgent.report({...owner,actionId:action.id,ok:true,message:'',observation:observation(fields,controls)});
    action=await harness.applicationAgent.observe({...owner,observation:observation(fields,controls)});assert.equal(action.kind,'fill');
    assert.equal(drafts.length,1);assert.match(String(drafts[0]!.input.offer),/accessible software/);
    fields=fill(fields,action.values!);harness.applicationAgent.report({...owner,actionId:action.id,ok:true,message:'',observation:observation(fields,controls)});
    action=await harness.applicationAgent.observe({...owner,observation:observation(fields,controls)});assert.equal(action.kind,'attach');assert.equal(action.targetId,'cv');
    fields=fields.map(f=>f.id==='cv'?{...f,value:'prepared.pdf',attached:true,valid:true}:f);
    harness.applicationAgent.report({...owner,actionId:action.id,ok:true,message:'',observation:observation(fields,controls)});
    action=await harness.applicationAgent.observe({...owner,observation:observation(fields,controls)});assert.equal(action.kind,'review');
    harness.applicationAgent.report({...owner,actionId:action.id,ok:true,message:'',observation:observation(fields,controls)});
    const after=harness.board.requireEntry(entry.id);
    assert.equal(after.applicationAgent!.status,'review');assert.equal(after.applicationStage,'applying');assert.equal(after.submissions.length,0);
    assert.equal(after.answers.length,6);assert.ok(!after.answers.some(a=>a.label==='CV'));assert.equal(after.answers.find(a=>a.label==='Portfolio attachment')?.value,'sample.pdf');
    assert.equal(after.answers.find(a=>a.label==='Optional referral')?.value,'');
    assert.equal(JSON.stringify(after.preparation),before);assert.equal(JSON.stringify(harness.documents.read(profileId)),profile);
  }finally{harness.close();}
});

test('unknown factual answers, unsupported inputs and consent pause; only actual browser values are saved',async()=>{
  const {harness,ready}=fixture({draft:async()=>({answers:[{fieldId:'years',value:'12',source:'profile',evidence:['profile.personal.name']}],missing:[]})});try{
    const entry=await ready(),session=start(harness,entry.id),owner={entryId:entry.id,sessionId:session.id};
    const fields=[field('years',{label:'Years of experience',type:'number'}),field('consent',{label:'Agree to processing',type:'checkbox',value:'No'}),field('custom',{label:'Custom selection',type:'unsupported'}),field('cv',{type:'file',cv:true,attached:true,valid:true,value:'cv.pdf'})];
    const action=await harness.applicationAgent.observe({...owner,observation:observation(fields)});
    assert.equal(action.kind,'pause');assert.match(action.message,/Years of experience.*Agree to processing.*Custom selection/);
    const answers=harness.board.requireEntry(entry.id).answers;assert.equal(answers.find(a=>a.label==='Years of experience')?.value,'');assert.ok(answers.some(a=>a.label==='Custom selection'));
    harness.applicationAgent.control({...owner,action:'resume'});
    const completed=fields.map(f=>({...f,value:f.id==='consent'?'Yes':f.id==='cv'?'cv.pdf':'User answer',valid:true}));
    const review=await harness.applicationAgent.observe({...owner,observation:observation(completed,[{id:'send',kind:'submit',label:'Submit',href:''}])});assert.equal(review.kind,'review');
  }finally{harness.close();}
});

test('unambiguous Next can continue before the CV upload appears, never Send',async()=>{
  const {harness,ready}=fixture();try{
    const entry=await ready(),session=start(harness,entry.id),owner={entryId:entry.id,sessionId:session.id};
    const action=await harness.applicationAgent.observe({...owner,observation:observation([field('email',{value:'manual@example.org',valid:true})],[{id:'next',kind:'next',label:'Next',href:''}])});
    assert.equal(action.kind,'navigate');assert.equal(action.targetId,'next');
    harness.applicationAgent.report({...owner,actionId:action.id,ok:true,message:''});
    const last=await harness.applicationAgent.observe({...owner,observation:observation([field('cv',{type:'file',cv:true,attached:true,valid:true,value:'cv.pdf'})],[{id:'send',kind:'submit',label:'Submit',href:''}])});assert.equal(last.kind,'review');
    assert.ok(harness.board.requireEntry(entry.id).answers.some(a=>a.value==='manual@example.org'));
  }finally{harness.close();}
});

test('cancellation invalidates late AI and never resumes preparation',async()=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  const {harness,ready,drafts}=fixture({draft:async()=>{await held;return {answers:[],missing:[]};}});
  try{
    const entry=await ready(),session=start(harness,entry.id),owner={entryId:entry.id,sessionId:session.id};
    const work=harness.applicationAgent.observe({...owner,observation:observation([field('letter',{label:'Cover letter',type:'textarea'})])});
    const check=assert.rejects(work);await waitFor(()=>drafts.length===1);
    harness.applicationAgent.control({...owner,action:'pause'});release();await check;
    const after=harness.board.requireEntry(entry.id);assert.equal(after.applicationAgent!.status,'paused');assert.equal(after.preparation.status,'ready');assert.equal(after.answers[0]!.value,'');
  }finally{release();await new Promise(r=>setTimeout(r,20));harness.close();}
});

test('changing the prepared CV while drafting prevents a stale fill plan',async()=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  const {harness,ready,drafts}=fixture({draft:async()=>{await held;return {answers:[],missing:[]};}});
  try{
    let entry=await ready();const session=start(harness,entry.id),owner={entryId:entry.id,sessionId:session.id};
    const work=harness.applicationAgent.observe({...owner,observation:observation([field('letter',{label:'Cover letter',type:'textarea'})])});await waitFor(()=>drafts.length===1);
    entry=harness.board.requireEntry(entry.id);harness.board.updateSummary({entryId:entry.id,expectedRevision:entry.revision,operationId:randomUUID(),cvVersionId:entry.currentCvId!,summary:'Changed manually'});
    release();assert.equal((await work).kind,'pause');assert.throws(()=>harness.applicationAgent.control({...owner,action:'resume'}),/current CV/);
  }finally{release();harness.close();}
});

test('removing from Board aborts application drafting and re-add starts with no application data',async()=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  const {harness,ready,drafts}=fixture({draft:async()=>{await held;return {answers:[],missing:[]};}});
  try{
    let entry=await ready();const session=start(harness,entry.id),owner={entryId:entry.id,sessionId:session.id};
    const work=harness.applicationAgent.observe({...owner,observation:observation([field('letter',{type:'textarea',label:'Cover letter'})])});const check=assert.rejects(work);await waitFor(()=>drafts.length===1);
    entry=harness.board.requireEntry(entry.id);harness.board.drop({entryId:entry.id,expectedRevision:entry.revision,operationId:randomUUID()});release();await check;
    assert.equal(harness.board.get(entry.id),undefined);
    const fresh=await ready();assert.equal(fresh.applicationAgent,undefined);assert.deepEqual(fresh.answers,[]);
  }finally{release();await new Promise(r=>setTimeout(r,20));harness.close();}
});

test('restart pauses the persisted application, keeping preparation and captured answers',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'application-agent-'));const databasePath=join(dir,'test.db');
  const first=fixture({databasePath});let id:string;
  try{const entry=await first.ready();id=entry.id;start(first.harness,id);}finally{first.harness.close();}
  const second=fixture({databasePath});try{const entry=second.harness.board.requireEntry(id!);assert.equal(entry.applicationAgent!.status,'paused');assert.equal(entry.preparation.status,'ready');assert.equal(second.drafts.length,0);}finally{second.harness.close();rmSync(dir,{recursive:true,force:true});}
});

test('protocol validates ownership, start idempotency, readiness and refuses arbitrary browser commands',async()=>{
  const {harness,ready}=fixture();try{
    const entry=await ready(),dispatch=createDispatch(harness),session=start(harness,entry.id),owner={entryId:entry.id,sessionId:session.id};
    assert.equal((await dispatch('protocol.get',{})).ok,true);
    assert.equal((await dispatch('board.application.observe',{...owner,observation:observation([]),script:'submit()'})).ok,false);
    assert.equal((await dispatch('board.application.observe',{...owner,sessionId:randomUUID(),observation:observation([])})).ok,false);
    assert.equal((await dispatch('board.application.start',{...owner,cvVersionId:entry.currentCvId!,preferences:{}})).ok,false);
    assert.equal((await dispatch('board.application.submit',owner)).ok,false);
    assert.equal((await dispatch('board.application.observe',{...owner,observation:{...observation([]),frames:[{...observation([]).frames[0]!,url:'file:///private/profile'}]}})).ok,false);
  }finally{harness.close();}
});


test('a fresh browser cannot reuse the previous window CV attachment acknowledgement',async()=>{
  const {harness,ready}=fixture();try{
    const entry=await ready(),session=start(harness,entry.id),owner={entryId:entry.id,sessionId:session.id};
    const upload=observation([field('cv',{type:'file',cv:true})]);
    const attach=await harness.applicationAgent.observe({...owner,observation:upload});assert.equal(attach.kind,'attach');
    harness.applicationAgent.report({...owner,actionId:attach.id,ok:true,message:'',observation:observation([field('cv',{type:'file',cv:true,attached:true,valid:true,value:'CV.pdf'})])});
    harness.applicationAgent.control({...owner,action:'pause'});
    harness.applicationAgent.control({...owner,action:'resume',resetBrowser:true});
    const action=await harness.applicationAgent.observe({...owner,observation:observation([field('email',{type:'email',value:'ada@example.org',valid:true})],[{id:'send',label:'Send application',kind:'submit',href:''}])});
    assert.equal(action.kind,'pause');assert.match(action.message,/CV upload/);
  }finally{harness.close();}
});
