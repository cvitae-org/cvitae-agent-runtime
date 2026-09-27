import { recipeListingContext, recipeNextUrl } from '@cvitae/job-pages';
import type { BrowserRecipePin } from '../effects/browser-recipes.js';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {listingContext,validateCapture,type BrowserCapture} from '@cvitae/job-pages';
import {OperationError} from '../contracts/operation-error.js';
import {normaliseUrl} from '../capabilities/offers/identity.js';
import type {createBrowserImportStore} from '../storage/sqlite/browser-imports.js';
const target=z.object({tabId:z.number().int().nonnegative(),documentId:z.string().min(1).max(200),url:z.string().max(8000)}).strict();
const idSchema=z.object({collectionId:z.string().uuid()}).strict();
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const limits={pages:20,jobs:1000,bytes:24*1024*1024,lifetimeMs:600000};
type Draft={targetSearchId?:string;pin?:BrowserRecipePin;session:string;scope:string;tabId:number;expiresAt:number;pages:{capture:BrowserCapture;capturedAt:number;hash:string;documentId:string}[];jobs:{page:number;index:number}[];keys:Map<string,number>;bytes:number};
/** Ephemeral browsing drafts; only an explicit commit changes the database. */
export const createBrowserCollection=(store:ReturnType<typeof createBrowserImportStore>,now=Date.now)=>{
 const drafts=new Map<string,Draft>();
 const prune=()=>{for(const [id,d] of drafts)if(d.expiresAt<=now())drafts.delete(id);};
 const requireDraft=(id:string,session:string)=>{const d=drafts.get(id);if(!d||d.session!==session)throw new OperationError('collection_expired','This collection expired or Studio restarted. Start collecting again.');return d;};
 const cancel=(session:string)=>{for(const [id,d] of drafts)if(d.session===session)drafts.delete(id);};
 const summary=(id:string,d:Draft)=>({collectionId:id,pages:d.pages.length,jobs:d.jobs.length,expiresAt:d.expiresAt,...(d.targetSearchId?{targetSearchId:d.targetSearchId}:{}),limits});
 return {
  cancel,close:()=>drafts.clear(),limits,
  token(session:string,payload:unknown){const parsed=z.object({collectionId:z.string().uuid()}).safeParse(payload);return parsed.success?requireDraft(parsed.data.collectionId,session).pin?.token:undefined;},
  dispatch(session:string,method:string,payload:unknown,pin?:BrowserRecipePin,targetSearchId?:string):unknown {
   prune();
   if(!session.startsWith('studio:'))throw new OperationError('unsupported_operation','Collection requires the built-in Cvitae Browser.');
   if(method==='collection.start'){
    const p=z.object({target,recipeToken:z.string().uuid().optional()}).strict().parse(payload),context=pin?recipeListingContext(pin.recipe,p.target.url):listingContext(p.target.url);
    if(!context)throw new OperationError('unsupported_listing','Open Bulldogjob or the:protocol search results to collect pages.');
    cancel(session);if(drafts.size>=20)throw new OperationError('collection_capacity','Close another collection first.');
    const id=randomUUID(),d:Draft={pin,session,targetSearchId,scope:context.scope,tabId:p.target.tabId,expiresAt:now()+limits.lifetimeMs,pages:[],jobs:[],keys:new Map(),bytes:0};
    drafts.set(id,d);return {...summary(id,d),...(pin?{recipeScope:d.scope}:{})};
   }
   if(method==='collection.append'){
    const p=idSchema.extend({capture:z.unknown(),target}).parse(payload),d=requireDraft(p.collectionId,session),capture=validateCapture(p.capture,d.pin?.recipe);
    if(capture.kind!=='listing'||capture.url!==p.target.url||d.tabId!==p.target.tabId||(d.pin?recipeListingContext(d.pin.recipe,capture.url):listingContext(capture.url))?.scope!==d.scope)throw new OperationError('collection_scope','The search or page changed. Collected jobs are retained; return to the same results to continue.');
    const digest=hash(capture),previous=d.pages.find(page=>page.hash===digest&&page.documentId===p.target.documentId);
    if(previous)return {...summary(p.collectionId,d),added:0,replayed:true};
    if(d.pin && d.pages.length){
     const prior=d.pages.at(-1)!.capture.url, a=recipeListingContext(d.pin.recipe,prior)!, b=recipeListingContext(d.pin.recipe,capture.url)!;
     if(b.page!==a.page+1)throw new OperationError('collection_scope','Recipe collection must advance exactly one page without repeats.');
    }
    const bytes=Buffer.byteLength(JSON.stringify(capture));
    if(d.pages.length>=limits.pages||d.bytes+bytes>limits.bytes)throw new OperationError('collection_limit','Collection reached its page or data limit. Review and import the collected jobs.');
    // Prepare the entire append before changing the draft; failed requests are atomic.
    const keys=new Map(d.keys),jobs=d.jobs.slice();let added=0;
    capture.items.forEach((j,index)=>{
     const identities=[normaliseUrl(j.url)??j.url,...(j.external_id?[j.board+':'+j.external_id]:[])];
     const existing=identities.map(k=>keys.get(k)).find(i=>i!==undefined);
     const slot=existing??jobs.length;
     if(existing===undefined){jobs.push({page:d.pages.length,index});added++;}
     for(const key of identities)keys.set(key,slot);
    });
    if(jobs.length>limits.jobs)throw new OperationError('collection_limit','Collection reached 1,000 jobs. Review and import before starting another run.');
    d.keys=keys;d.jobs=jobs;d.bytes+=bytes;d.pages.push({capture,capturedAt:now(),hash:digest,documentId:p.target.documentId});d.expiresAt=now()+limits.lifetimeMs;
    return {...summary(p.collectionId,d),added,replayed:false};
   }
   if(method==='collection.navigation'){
    const p=idSchema.extend({from:z.string().max(2048),to:z.string().max(2048)}).parse(payload),d=requireDraft(p.collectionId,session);
    const latest=d.pages.at(-1)?.capture.url;
    if(!d.pin||!latest||latest!==p.from||recipeNextUrl(d.pin.recipe,p.from,9999)!==p.to)throw new OperationError('collection_scope','Navigation must be the next page of the pinned search.');
    return {allowed:true,url:p.to};
   }
   if(method==='collection.preview'){
    const p=idSchema.parse(payload),d=requireDraft(p.collectionId,session);
    const items=d.jobs.map((ref,index)=>{const j=d.pages[ref.page]!.capture.items[ref.index]!;return {index,title:j.title,company:j.company?.slice(0,250),location:j.location?.slice(0,250),salary:j.salary?.slice(0,250),completeness:j.completeness};});
    const result={...summary(p.collectionId,d),kind:'collection',items};
    if(Buffer.byteLength(JSON.stringify(result))>1_500_000)throw new OperationError('preview_too_large','Collected preview exceeds its response limit.');
    return result;
   }
   if(method==='collection.commit'){
    const p=idSchema.extend({operationId:z.string().uuid(),selected:z.array(z.number().int().min(0).max(999)).min(1).max(1000)}).parse(payload),requestHash=hash({...p,...(targetSearchId?{targetSearchId}:{})});
    if(store.receipt(p.operationId))return store.commitBatch(p.operationId,[],requestHash);
    const d=requireDraft(p.collectionId,session);
    if(d.targetSearchId!==targetSearchId)throw new OperationError('browser_destination_mismatch','The import destination changed. Start collecting again.');
    if(new Set(p.selected).size!==p.selected.length)throw new OperationError('invalid_selection','A job was selected twice.');
    const pages=d.pages.map(p=>({capture:p.capture,capturedAt:p.capturedAt,recipe:d.pin?.recipe,indices:[] as number[]}));
    for(const index of p.selected){const ref=d.jobs[index];if(!ref)throw new OperationError('invalid_selection','The selection is not in this collection.');pages[ref.page]!.indices.push(ref.index);}
    const receipt=store.commitBatch(p.operationId,pages.filter(p=>p.indices.length),requestHash,d.targetSearchId);drafts.delete(p.collectionId);return receipt;
   }
   if(method==='collection.cancel'){const p=idSchema.parse(payload);requireDraft(p.collectionId,session);drafts.delete(p.collectionId);return {cancelled:true};}
   throw new OperationError('unsupported_operation','This collection operation is not supported.');
  }
 };
};
