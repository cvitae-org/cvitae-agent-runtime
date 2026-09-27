import { OperationError, RuntimeError } from '../contracts/index.js';
import type { DiscoveryChatRequest } from '../contracts/discovery-search.js';
import type { DiscoveryAnswerContext } from '../contracts/discovery-chat.js';
import type { RunHandle } from './run.js';
import type { createDiscoveryChatStore } from '../storage/sqlite/discovery-chat.js';

export const createDiscoveryChatService = (store: ReturnType<typeof createDiscoveryChatStore>, execute: (scope: DiscoveryAnswerContext,signal: AbortSignal,onText:(text:string)=>void)=>RunHandle) => {
 const active=new Map<string,{searchId:string;controller:AbortController;text:string}>(); let closed=false;
 return {
  send(request: DiscoveryChatRequest) {
   if (closed) throw new OperationError('unavailable','Discover chat is closed.');
   return store.start(request,(context)=>{
    const controller=new AbortController(), state={searchId:request.searchId,controller,text:''};
    active.set(request.runId,state);
    try {
     const handle=execute(context,controller.signal,(text)=>{ if (!closed && !controller.signal.aborted) state.text=(state.text+text).slice(0,24000); });
     void handle.settled.catch(()=>undefined).finally(()=>active.delete(request.runId));
    } catch(error) { active.delete(request.runId); throw error; }
   });
  },
  get(searchId:string,before?:number) { const record=store.get(searchId,before); const state=[...active.values()].find(s=>s.searchId===searchId); return {...record,streamText:state?.text ?? ''}; },
  cancel(searchId:string,runId:string) { store.owner(runId,searchId); active.get(runId)?.controller.abort(new RuntimeError('Cancelled','aborted')); },
  delete(searchId:string) { for (const state of active.values()) if(state.searchId===searchId) state.controller.abort(); },
  close() { closed=true; for (const state of active.values()) state.controller.abort(); active.clear(); }
 };
};
