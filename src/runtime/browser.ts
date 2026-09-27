import { createBrowserRecipes } from '../effects/browser-recipes.js';
import type { BrowserRecipePin } from '../effects/browser-recipes.js';
import type { DiscoveryProvider } from '../effects/discovery-provider.js';
import {createBrowserCollection} from './browser-collection.js';
import {randomUUID,createHash} from 'node:crypto';
import {validateCapture, type BrowserCapture} from '@cvitae/job-pages';
import {z} from 'zod';
import {OperationError} from '../contracts/operation-error.js';
import type {createBrowserImportStore} from '../storage/sqlite/browser-imports.js';
const target=z.object({tabId:z.number().int().nonnegative(),documentId:z.string().min(1).max(200),url:z.string().max(8000)}).strict();
const commitSchema=z.object({captureId:z.string().uuid(),operationId:z.string().uuid(),selected:z.array(z.number().int().min(0).max(199)).min(1).max(200),target}).strict();
export const createBrowserService=(store:ReturnType<typeof createBrowserImportStore>,now=Date.now,provider?:DiscoveryProvider)=>{
 const collection=createBrowserCollection(store,now), recipes=createBrowserRecipes(provider,now);
 let bridge: {status:()=>unknown;configure:(enabled:boolean)=>Promise<unknown>;close:()=>void}|undefined;
 const previews=new Map<string,{sessionId:string;capture:BrowserCapture;pin?:BrowserRecipePin;target:z.infer<typeof target>;expiresAt:number;targetSearchId?:string}>();
 const generations=new Map<string,number>();let closed=false;
 const generation=(session:string)=>generations.get(session)??0;
 const prune=()=>{for(const [key,p] of previews)if(p.expiresAt<=now())previews.delete(key);};
 return {
  store,
  attach(value:NonNullable<typeof bridge>){bridge=value;},
  status(){return bridge?.status()??{supported:false,enabled:false,connected:false};},
  async configure(enabled:boolean){if(!bridge)throw new OperationError('bridge_unavailable','Open the desktop app to configure Browser Companion.');return bridge.configure(enabled);},
  disconnect(sessionId:string){generations.set(sessionId,generation(sessionId)+1);recipes.disconnect(sessionId);collection.cancel(sessionId);for(const [key,p] of previews)if(p.sessionId===sessionId)previews.delete(key);},
  dispatch(sessionId:string,method:string,payload:unknown,targetSearchId?:string):unknown{
   const current=generation(sessionId);
   const active=()=>{if(closed||generation(sessionId)!==current)throw new OperationError('browser_cancelled','Browser operation cancelled. Preview the current page again.');};
   if(method==='browser.recipe')return recipes.prepare(sessionId,z.object({target}).strict().parse(payload).target).then(result=>{
    try{active();return result;}catch(error){if(result.recipeToken)recipes.release(result.recipeToken);throw error;}
   });
   const acquisition=['capture.preview','collection.start','collection.append','collection.navigation'].includes(method);
   if(recipes.enabled && acquisition)return recipes.refresh().then(()=>{active();return this.perform(sessionId,method,payload,targetSearchId);});
   return this.perform(sessionId,method,payload,targetSearchId);
  },
  perform(sessionId:string,method:string,payload:unknown,targetSearchId?:string):unknown{
   prune();
   if(method.startsWith('collection.')){
    let pin:BrowserRecipePin|undefined;
    if(method==='collection.start'){
     const p=z.object({target,recipeToken:z.string().uuid().optional()}).strict().parse(payload); pin=recipes.require(sessionId,p.recipeToken,p.target);
    }else if(['collection.append','collection.navigation'].includes(method)){
     const token=collection.token(sessionId,payload);pin=recipes.require(sessionId,token);
    }
    return collection.dispatch(sessionId,method,payload,pin,targetSearchId);
   }
   if(method==='browser.hello'){z.object({version:z.literal(1)}).strict().parse(payload);return {version:1,sessionId,capabilities:['browser.recipe','capture.preview','import.commit','operation.read','capture.cancel',...(sessionId.startsWith('studio:')?['collection.navigation','collection.start','collection.append','collection.preview','collection.commit','collection.cancel']:[])],limits:{jobs:200,captureBytes:4194304,previewLifetimeMs:600000}};}
   if(method==='capture.preview'){
    const p=z.object({capture:z.unknown(),target,recipeToken:z.string().uuid().optional()}).strict().parse(payload);
    const kind=z.object({kind:z.string()}).parse(p.capture).kind;
    const pin=kind==='listing'?recipes.require(sessionId,p.recipeToken,p.target):undefined;
    const capture=validateCapture(p.capture,pin?.recipe);
    if(capture.url!==p.target.url)throw new OperationError('stale_document','The captured page changed. Preview this page again.');
    if(previews.size>=20)throw new OperationError('preview_capacity','Close an earlier preview before capturing another page.');
    collection.cancel(sessionId);for(const [key,value] of previews)if(value.sessionId===sessionId)previews.delete(key);const captureId=randomUUID(),expiresAt=now()+600000;
    const response={captureId,expiresAt,...(targetSearchId?{targetSearchId}:{}),target:p.target,kind:capture.kind,sourceUrl:capture.url,items:capture.items.map((j,index)=>({index,title:j.title,company:j.company?.slice(0,250),location:j.location?.slice(0,250),salary:j.salary?.slice(0,250),url:j.url,completeness:j.completeness,description:capture.kind==='listing'?undefined:j.description?.slice(0,12000)}))};
    if(Buffer.byteLength(JSON.stringify(response),'utf8')>850_000)throw new OperationError('preview_too_large','This page contains too much preview data. Open an individual offer and import it.');
    previews.set(captureId,{sessionId,capture,pin,target:p.target,expiresAt,targetSearchId});return response;
   }
   if(method==='import.commit'){
    const p=commitSchema.parse(payload),requestHash=createHash('sha256').update(JSON.stringify({...p,...(targetSearchId?{targetSearchId}:{})})).digest('hex');
    const receipt=store.receipt(p.operationId);
    // The persisted receipt is authoritative after a lost reply, even after restart.
    if(receipt)return store.commit(p.operationId,{} as BrowserCapture,[],requestHash);
    const preview=previews.get(p.captureId);
    if(!preview || preview.sessionId!==sessionId)throw new OperationError('preview_expired','This preview expired. Preview this page again.');
    if(targetSearchId!==preview.targetSearchId)throw new OperationError('browser_destination_mismatch','The import destination changed. Preview this page again.');
    if(JSON.stringify(p.target)!==JSON.stringify(preview.target))throw new OperationError('stale_document','The page changed. Capture it again.');
    if(new Set(p.selected).size!==p.selected.length)throw new OperationError('invalid_selection','An offer was selected twice.');
    const result=store.commit(p.operationId,preview.capture,p.selected,requestHash,preview.pin?.recipe,preview.targetSearchId);previews.delete(p.captureId);return result;
   }
   if(method==='operation.read'){const p=z.object({operationId:z.string().uuid()}).strict().parse(payload);return store.receipt(p.operationId);}
   if(method==='capture.cancel'){this.disconnect(sessionId);return {cancelled:true};}
   throw new OperationError('unsupported_operation','This browser operation is not supported.');
  },
  close(){closed=true;generations.clear();recipes.close();collection.close();previews.clear();bridge?.close();}
 };
};
