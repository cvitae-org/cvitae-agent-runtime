import {randomUUID} from 'node:crypto';
import type {z} from 'zod';
import {directorySchema,directoryConnectionsSchema,directoryCompatibility} from '../../vendor/integration-protocol/directory.mjs';
import type {DirectoryInput} from '../contracts/integration-directories.js';
import {OperationError} from '../contracts/operation-error.js';
import {integrationCapabilities} from './integration-providers.js';
import type {createIntegrationManagement} from './integration-management.js';

type Connections=z.infer<typeof directoryConnectionsSchema>;
type Catalogue=z.infer<typeof directorySchema>;
type Store={read():Connections;write(value:Connections):void};
type Management=ReturnType<typeof createIntegrationManagement>;
type State={generation:number;controller:AbortController;catalogue?:Catalogue;checkedAt?:number;status:'not-checked'|'ready'|'cached'|'unavailable';pending?:Promise<void>};
const fail=(message:string):never=>{throw new OperationError('misconfigured',message);};
const fold=(text:string)=>text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en');

/** Local discovery metadata only: no recipes, trust grants or provider secrets. */
export function createIntegrationDirectories(store:Store,management:Management,options:{fetch?:typeof globalThis.fetch;now?:()=>number}={}){
  let connections=directoryConnectionsSchema.parse(store.read()),generation=0,closed=false;
  const states=new Map<string,State>(),request=options.fetch??globalThis.fetch,now=options.now??Date.now;
  const stateFor=(id:string)=>{let state=states.get(id);if(!state){state={generation:++generation,controller:new AbortController(),status:'not-checked'};states.set(id,state);}return state;};
  const connection=(id:string)=>connections.find(value=>value.id===id)??fail('This provider directory is no longer configured.');
  const active=(id:string,state:State)=>!closed&&states.get(id)===state&&!state.controller.signal.aborted&&connections.some(value=>value.id===id&&value.enabled);
  const fresh=(state:State)=>state.catalogue&&Date.parse(state.catalogue.validUntil)>now();
  const summary=()=>({directories:connections.map(value=>{const state=states.get(value.id);return{...value,status:!value.enabled?'disabled':state?.catalogue&&!fresh(state)?'expired':state?.status??'not-checked',
    checkedAt:state?.checkedAt?new Date(state.checkedAt).toISOString():null,validUntil:state?.catalogue?.validUntil??null,entryCount:state&&fresh(state)?state.catalogue!.entries.length:0};}),supportedCapabilities:[...integrationCapabilities]});
  async function refresh(id:string,force:boolean){
    const item=connection(id);if(!item.enabled||closed)return;
    const state=stateFor(id);
    if(state.pending)return state.pending;
    if(!force&&fresh(state)&&now()-(state.checkedAt??0)<300000)return;
    const task=(async()=>{
      try{
        const response=await request(item.url,{method:'GET',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json'},signal:AbortSignal.any([state.controller.signal,AbortSignal.timeout(8000)])});
        if(!response.ok||!response.body||!response.headers.get('content-type')?.includes('json')){await response.body?.cancel();throw new Error('Invalid directory response');}
        const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
        try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>500000)throw new Error('Directory exceeds its bound');chunks.push(part.value);}}
        finally{await reader.cancel().catch(()=>{});}
        const catalogue=directorySchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
        if(Date.parse(catalogue.generatedAt)>now()+300000||Date.parse(catalogue.validUntil)<=now())throw new Error('Directory is expired or from the future');
        if(!active(id,state))return;
        state.catalogue=catalogue;state.status='ready';state.checkedAt=now();
      }catch{if(active(id,state)){state.status=fresh(state)?'cached':'unavailable';state.checkedAt=now();}}
    })();
    state.pending=task;try{await task;}finally{if(state.pending===task)delete state.pending;}
  }
  const invalidate=(id:string)=>{states.get(id)?.controller.abort();states.delete(id);};
  return {
    list:summary,
    save(input:DirectoryInput<'directories.save'>){
      if(closed)return fail('Provider directories are closed.');
      if(input.id)connection(input.id);
      const value={...input,id:input.id??'d_'+randomUUID().replaceAll('-',''),url:new URL(input.url).href};
      const next=directoryConnectionsSchema.parse([...connections.filter(item=>item.id!==value.id),value]);
      store.write(next);invalidate(value.id);connections=next;return summary();
    },
    remove(id:string){connection(id);const next=connections.filter(value=>value.id!==id);store.write(next);invalidate(id);connections=next;return summary();},
    async search(input:DirectoryInput<'directories.search'>){
      // Capture generations before awaiting any directory. An edit/removal while
      // another directory is slow cannot revive a stale result from the first.
      const selected=connections.filter(value=>value.enabled).map(value=>({id:value.id,state:stateFor(value.id)}));
      let cursor=0;
      await Promise.all(Array.from({length:3},async()=>{while(cursor<selected.length){const item=selected[cursor++]!;if(active(item.id,item.state))await refresh(item.id,input.refresh);}}));
      const words=fold(input.query).split(/\s+/).filter(Boolean);
      const results=selected.flatMap(({id,state})=>{
        if(!active(id,state)||!fresh(state))return[];
        const directory=connection(id);
        return state.catalogue!.entries.filter(entry=>{
          const text=fold([entry.name,entry.description,entry.providerId,...entry.scope.categories,...entry.scope.markets,...entry.capabilities].join(' '));
          return words.every(word=>text.includes(word))&&(['categories','markets'] as const).every(field=>!input.scope[field].length||entry.scope[field].some(tag=>input.scope[field].includes(tag)))
            && input.capabilities.every(capability=>entry.capabilities.includes(capability));
        }).map(entry=>({...structuredClone(entry),directoryId:id,directoryName:directory.name,directoryUrl:directory.url,
          compatibility:directoryCompatibility(entry,integrationCapabilities)}));
      }).sort((a,b)=>a.name.localeCompare(b.name)||a.directoryId.localeCompare(b.directoryId)||a.id.localeCompare(b.id));
      return{...summary(),results};
    },
    async inspect(input:DirectoryInput<'directories.inspect'>){
      const item=connection(input.id),state=states.get(item.id);
      if(!item.enabled||!state||!active(item.id,state)||!fresh(state))return fail('Refresh the directory results before inspecting this provider.');
      const entry=state.catalogue!.entries.find(entry=>entry.id===input.entryId)??fail('This provider is no longer listed.');
      const compatibility=directoryCompatibility(entry,integrationCapabilities);
      if(['unsupported','unsupported-version'].includes(compatibility.status))return fail('This listing requires a newer integration capability or provider protocol.');
      const inspected=await management.inspect({url:entry.descriptorUrl},{expectedProviderId:entry.providerId,signal:state.controller.signal});
      if(!active(item.id,state)||!fresh(state))return fail('The directory changed while the provider was being inspected.');
      if(entry.requiredCapabilities.some(value=>!inspected.descriptor.capabilities.includes(value)))return fail('The provider descriptor no longer matches this listing. Refresh the directory.');
      return {...inspected,directory:{id:item.id,name:item.name,entryId:entry.id}};
    },
    close(){closed=true;for(const state of states.values())state.controller.abort();states.clear();},
  };
}
