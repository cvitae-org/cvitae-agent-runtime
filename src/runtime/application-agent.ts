import { createHash, randomUUID } from 'node:crypto';
import { OperationError } from '../contracts/operation-error.js';
import type { BoardEntry, BoardRunInput } from '../contracts/board.js';
import type { OfferSnapshot } from '../contracts/offer-snapshot.js';
import { fieldDraftSchema, type ApplicationAction, type ApplicationAgentState, type ApplicationObservation } from '../contracts/application-agent.js';
import { directAnswer, factCatalogue, protectedField, proseField, normalizeField } from '../capabilities/apply/fields.js';
import { currentCv, currentPosting, boardEvent, type createBoardStore } from '../storage/sqlite/board.js';
import type { RunHandle } from './run.js';
import { isPublicUrl as publicUrl } from '../public-url.js';

type Store=ReturnType<typeof createBoardStore>;
type Owner={entryId:string;sessionId:string};
type Ports={captureProfile:(contextId:string)=>Pick<OfferSnapshot,'context'|'document'|'photo'>;execute:(input:BoardRunInput,signal:AbortSignal)=>RunHandle;now?:()=>number};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const activeStatus=(status:string)=>['running','paused','needsInput'].includes(status);

/** Browser application work has its own state machine and cancellation scope.
 * It never advances, resumes or invokes Board preparation. */
export const createApplicationAgent=(store:Store,ports:Ports)=>{
  const now=ports.now??Date.now;
  const active=new Map<string,AbortController>();
  let closed=false;
  const update=(entryId:string,change:(entry:BoardEntry)=>void)=>store.updateWorkspace(entryId,change);
  const cancelEntry=(id:string)=>{active.get(id)?.abort();active.delete(id);};
  const requireSession=({entryId,sessionId}:Owner)=>{
    const entry=store.requireEntry(entryId),state=entry.applicationAgent;
    if(!state||state.id!==sessionId) throw new OperationError('application_session_changed','This application session is no longer active.');
    return {entry,state};
  };
  const stateOf=(entry:BoardEntry)=>entry.applicationAgent!;
  const save=(owner:Owner,change:(state:ApplicationAgentState,entry:BoardEntry)=>void)=>stateOf(update(owner.entryId,entry=>{
    if(entry.applicationAgent?.id!==owner.sessionId)throw new OperationError('application_session_changed','The application session changed.');
    change(entry.applicationAgent,entry);entry.applicationAgent.updatedAt=now();
  }));
  const captureAnswers=(entry:BoardEntry,observation:ApplicationObservation)=>{
    const answers=new Map(entry.answers.map(answer=>[answer.id,answer]));
    for(const frame of observation.frames.filter(frame=>frame.form && !frame.blocked)){
      const url=new URL(frame.url);const scope=url.origin+url.pathname;
      for(const field of frame.fields.filter(field=>!field.cv)){
        const id='application:'+digest([scope,field.key,field.label]).slice(0,32);
        answers.set(id,{id,label:field.label,value:field.value});
      }
    }
    if(answers.size>300)throw new OperationError('application_limit','This form exceeds the Board answer limit. Continue manually.');
    entry.answers=[...answers.values()];
  };
  // A restarted sidecar never drives a browser based on a stale document.
  for(const entry of store.all())if(entry.applicationAgent?.status==='running')update(entry.id,current=>{
    current.applicationAgent!.status='paused';current.applicationAgent!.message='Studio restarted. Reopen the application browser to continue.';
    current.applicationAgent!.generation++;delete current.applicationAgent!.action;
  });
  const plan=(owner:Owner,observation:ApplicationObservation,action:Omit<ApplicationAction,'id'|'observationId'>)=>{
    const value:ApplicationAction={id:randomUUID(),observationId:observation.id,...action};
    save(owner,state=>{state.action=value;state.step=action.kind;state.message=action.message;if(action.kind==='pause')state.status='needsInput';});
    return value;
  };
  const observe=async(owner:Owner & {observation:ApplicationObservation}):Promise<ApplicationAction>=>{
    if(closed)throw new OperationError('unavailable','Application agent is closed.');
    const {entry,state}=requireSession(owner),observation=owner.observation;
    if(state.observation?.id===observation.id&&state.action)return state.action;
    if(state.status!=='running')return {id:randomUUID(),observationId:observation.id,kind:'pause',message:state.message};
    if(entry.currentCvId!==state.cvVersionId||entry.preparation.status!=='ready')return plan(owner,observation,{kind:'pause',message:'The prepared CV changed. Start Apply again with the current CV.'});
    if(active.has(entry.id))throw new OperationError('application_busy','The application agent is already planning this page.');
    if(state.iterations>=30)return plan(owner,observation,{kind:'pause',message:'The agent reached its action limit. Review the browser before continuing.'});
    for(const frame of observation.frames)if(!publicUrl(frame.url))throw new OperationError('application_origin','Application forms must be on a public HTTPS site.');
    save(owner,(current,workspace)=>{current.observation=observation;delete current.action;current.iterations++;captureAnswers(workspace,observation);});
    const blocked=observation.frames.find(frame=>frame.blocked);
    if(blocked)return plan(owner,observation,{kind:'pause',message:blocked.blocked});
    const forms=observation.frames.filter(frame=>frame.form);
    if(!forms.length){
      const candidates=observation.frames.flatMap(frame=>frame.controls.filter(control=>control.kind==='apply').map(control=>({frame,control})));
      const next=candidates.find(({frame,control})=>!state.visited.includes(digest([frame.url,control.label,control.href])));
      if(!next)return plan(owner,observation,{kind:'pause',message:'Open the application form in this browser, then choose Resume. No unambiguous Apply control was found.'});
      return plan(owner,observation,{kind:'navigate',frameId:next.frame.id,targetId:next.control.id,message:'Opening the application form…'});
    }
    const allFields=forms.flatMap(frame=>frame.fields.map(field=>({frame,field})));
    const facts=factCatalogue(state.profile.document.body,state.preferences);
    const empty=allFields.filter(({field})=>!field.value.trim()&&field.type!=='file');
    const direct=empty.flatMap(({field})=>{const value=directAnswer(field,facts);return value ? [{fieldId:field.id,value}] : [];});
    if(direct.length){
      const frame=allFields.find(({field})=>field.id===direct[0]!.fieldId)!.frame;
      const values=direct.filter(value=>frame.fields.some(field=>field.id===value.fieldId));
      return plan(owner,observation,{kind:'fill',frameId:frame.id,values,message:'Filling fields from Profile…'});
    }
    const eligible=empty.filter(({field})=>!protectedField(field)&&!state.filled.includes(field.id));
    const missing=eligible.filter(({frame})=>frame.id===eligible[0]?.frame.id);
    if(missing.length){
      const controller=new AbortController();active.set(entry.id,controller);
      const generation=state.generation;
      try{
        const runId=randomUUID();
        const input:BoardRunInput={runId,entryId:entry.id,generation,step:'application',capability:'draft_application_fields',snapshot:state.profile,input:{
          fields:missing.map(({field})=>field),facts,offer:state.profile.offer.text.slice(0,30000),company:entry.discovery.company??'',
          page:forms.map(frame=>frame.text).join('\n').slice(0,16000),language:currentCv(entry)?.sourceContext.language??'en'
        }};
        store.storeRun(input);
        save(owner,current=>{current.modelRunId=runId;current.step='draft';current.message='Drafting answers for this offer…';});
        const result=await ports.execute(input,controller.signal).settled;
        const latestEntry=requireSession(owner),latest=latestEntry.state;
        if(latestEntry.entry.currentCvId!==latest.cvVersionId||latestEntry.entry.preparation.status!=='ready')return plan(owner,observation,{kind:'pause',message:'The prepared CV changed. Stop this session and start Apply again.'});
        if(controller.signal.aborted||latest.generation!==generation||latest.status!=='running')throw new OperationError('application_cancelled','Application drafting was paused.');
        const draft=fieldDraftSchema.parse(result.data);
        const values=draft.answers.filter(answer=>{
          const field=missing.find(item=>item.field.id===answer.fieldId)?.field;
          if(!field||!answer.value.trim()||protectedField(field))return false;
          if(field.maxLength>=0&&answer.value.length>field.maxLength)return false;
          if(/\[(?:your |company|name|insert|date)|\{\{|<insert|lorem ipsum/i.test(answer.value))return false;
          if(field.options.length&&!field.options.some(option=>option.value===answer.value))return false;
          if(!answer.evidence.length||answer.evidence.some(path=>!facts[path]))return false;
          if(answer.source==='draft')return proseField(field);
          // Factual claims are copied, not inferred. Option labels may translate
          // the same fact, but do not turn missing facts into guesses.
          return answer.evidence.some(path=>normalizeField(facts[path]!)===normalizeField(answer.value)||field.options.some(option=>option.value===answer.value&&normalizeField(option.label)===normalizeField(facts[path]!)));
        });
        save(owner,current=>{current.filled=[...new Set([...current.filled,...missing.map(({field})=>field.id)])];});
        if(values.length){
          const frame=allFields.find(({field})=>field.id===values[0]!.fieldId)!.frame;
          return plan(owner,observation,{kind:'fill',frameId:frame.id,values:values.filter(value=>frame.fields.some(field=>field.id===value.fieldId)).map(({fieldId,value})=>({fieldId,value})),message:'Filling the drafted answers…'});
        }
      }catch(error){
        if(controller.signal.aborted)throw error;
        if(store.get(entry.id)?.applicationAgent?.id===owner.sessionId)save(owner,current=>{current.status='failed';current.message=error instanceof Error?error.message:'Could not draft application answers.';});
        throw error;
      }finally{if(active.get(entry.id)===controller)active.delete(entry.id);}
    }
    const cv=allFields.find(({field})=>field.type==='file'&&field.cv&&!field.attached);
    if(cv)return plan(owner,observation,{kind:'attach',frameId:cv.frame.id,targetId:cv.field.id,message:'Attaching the prepared CV…'});
    const required=allFields.filter(({field})=>(field.required||!!field.value)&&!field.valid);
    if(required.length)return plan(owner,observation,{kind:'pause',message:'Complete these fields in the browser, then Resume: '+required.map(({field})=>field.label).join(', ').slice(0,1500)});
    const next=forms.flatMap(frame=>frame.controls.filter(control=>control.kind==='next').map(control=>({frame,control})))[0];
    if(next)return plan(owner,observation,{kind:'navigate',frameId:next.frame.id,targetId:next.control.id,message:'Continuing to the next application step…'});
    if(!allFields.some(({field})=>field.type==='file'&&field.cv&&field.attached)&&!state.attached)return plan(owner,observation,{kind:'pause',message:'No supported CV upload was found. Attach the prepared CV in the browser, then Resume.'});
    const submit=forms.flatMap(frame=>frame.controls.filter(control=>control.kind==='submit').map(control=>({frame,control})))[0];
    if(submit)return plan(owner,observation,{kind:'review',frameId:submit.frame.id,targetId:submit.control.id,message:'Ready for your review. Check the answers and press Send yourself.'});
    return plan(owner,observation,{kind:'pause',message:'The form is filled, but no sending button was identified. Review the browser and continue manually.'});
  };
  return {
    observe,cancelEntry,
    start(request:{entryId:string;sessionId:string;cvVersionId:string;preferences:Record<string,unknown>}){
      const entry=store.requireEntry(request.entryId),cv=currentCv(entry),posting=currentPosting(entry);
      if(entry.applicationAgent?.id===request.sessionId){
        if(entry.applicationAgent.cvVersionId!==request.cvVersionId||digest(entry.applicationAgent.preferences)!==digest(request.preferences))throw new OperationError('application_session_changed','This session was started with different application data.');
        return entry.applicationAgent;
      }
      if(entry.applicationAgent&&activeStatus(entry.applicationAgent.status))throw new OperationError('application_busy','Resume or stop the current application session before starting another.');
      if(entry.preparation.status!=='ready'||!cv||cv.id!==request.cvVersionId||!posting)throw new OperationError('application_not_ready','Finish preparation with a current CV before applying.');
      const url=posting.finalUrl??posting.url;if(!publicUrl(url))throw new OperationError('application_url','This offer has no usable application URL.');
      const profile=ports.captureProfile(cv.sourceContext.id),at=now();
      const state:ApplicationAgentState={id:request.sessionId,status:'running',step:'open',message:'Opening the offer in CVitae Browser…',startedAt:at,updatedAt:at,cvVersionId:cv.id,url,iterations:0,generation:1,preferences:request.preferences,
        profile:{...profile,id:randomUUID(),conversationId:'board:'+entry.id,createdAt:at,offer:{...entry.discovery,text:posting.text,url:posting.url}},visited:[],filled:[],attached:false};
      update(entry.id,current=>{current.applicationAgent=state;if(current.applicationStage==='notApplied')current.applicationStage='applying';boardEvent(current,'applicationAgentStarted',{sessionId:state.id},at);});
      return state;
    },
    report(request:Owner & {actionId:string;ok:boolean;message:string;observation?:ApplicationObservation}){
      const {state}=requireSession(request),action=state.action;
      if(!action||action.id!==request.actionId)throw new OperationError('application_action_changed','The page action is no longer current.');
      if(state.status!=='running')return state;
      return save(request,(current,entry)=>{
        if(request.observation){
          if(request.observation.frames.some(frame=>!publicUrl(frame.url)))throw new OperationError('application_origin','Application forms must be on a public HTTPS site.');
          captureAnswers(entry,request.observation);
        }
        if(!request.ok){current.status='needsInput';current.message=request.message||'The page changed. Check the browser, then Resume.';return;}
        if(action.kind==='navigate'){
          const frame=current.observation?.frames.find(frame=>frame.id===action.frameId),control=frame?.controls.find(control=>control.id===action.targetId);
          if(frame&&control)current.visited.push(digest([frame.url,control.label,control.href]));
        }
        if(action.kind==='attach')current.attached=!!request.observation?.frames.some(frame=>frame.fields.some(field=>field.id===action.targetId&&field.cv&&field.attached));
        if(action.kind==='review'){
          if(!request.observation||request.observation.frames.some(frame=>frame.form&&frame.fields.some(field=>(field.required||!!field.value)&&!field.valid)))throw new OperationError('application_incomplete','Review found an incomplete required field.');
          current.status='review';current.message=action.message;boardEvent(entry,'applicationAgentReady',{sessionId:current.id},now());
        }
      });
    },
    control(request:Owner & {action:'pause'|'resume'|'cancel';resetBrowser?:boolean;message?:string}){
      const {entry,state}=requireSession(request);
      cancelEntry(entry.id);
      if(request.action==='resume'&&(entry.currentCvId!==state.cvVersionId||entry.preparation.status!=='ready'))throw new OperationError('application_cv_changed','Stop this session and start Apply again with the current CV.');
      return save(request,current=>{
        current.generation++;delete current.action;delete current.observation;
        current.status=request.action==='resume'?'running':request.action==='cancel'?'cancelled':'paused';
        current.message=request.message??(request.action==='resume'?'Checking the current application page…':request.action==='cancel'?'Application assistance stopped. Nothing was submitted.':'Application assistance paused.');
        if(request.action==='resume'){if(request.resetBrowser)current.attached=false;current.filled=[];current.visited=[];current.iterations=0;}
      });
    },
    close(){closed=true;for(const id of active.keys())cancelEntry(id);}
  };
};
