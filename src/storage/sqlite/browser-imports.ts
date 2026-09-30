import {qualifyDiscoveryItem} from '../../runtime/discovery-policy.js';
import {createHash, randomUUID} from 'node:crypto';
import {validateCapture, type BrowserCapture, type CapturedJob, type BrowserRecipe} from '@cvitae/job-pages';
import {OperationError} from '../../contracts/operation-error.js';
import type {Db} from './open.js';
import type {OfferStore, ResolvedOffer} from '../../contracts/index.js';
import type {DiscoveryCatalogue, DiscoveryBatch} from '../../contracts/discovery.js';
import type {IntegrationExecution} from '../../contracts/integration.js';
import type {EnrichmentStore} from '../../contracts/enrichment.js';
import type {createDiscoverySearchStore} from './discovery-searches.js';
import {normaliseUrl} from '../../capabilities/offers/identity.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Reading an unchanged page again changes evidence timestamps, not offer content.
const jobHash=(job:CapturedJob)=>hash({...job,field_evidence:job.field_evidence && Object.fromEntries(Object.entries(job.field_evidence).map(([field,evidence])=>[field,{...evidence,capturedAt:undefined}]))});
const browserVersion=(job:CapturedJob)=>`browser:${job.extractor_version??'v1'}`;
export type ImportReceipt={operationId:string;collectionId:string;seq:number;added:number;updated:number;unchanged:number;skipped:number;offerIds:string[];targetSearchId?:string};
export type ImportPage={recipe?:BrowserRecipe;integration?:IntegrationExecution;capture:BrowserCapture;indices:number[];capturedAt?:number};
export const createBrowserImportStore=(db:Db,offers:OfferStore,catalogue:DiscoveryCatalogue,searches:ReturnType<typeof createDiscoverySearchStore>,enrichments:EnrichmentStore,now=Date.now)=>{
 const latest=(id:string)=>db.prepare('SELECT value,content_hash AS hash FROM browser_captures WHERE offer_id=? ORDER BY rowid DESC LIMIT 1').get(id) as {value:string;hash:string}|undefined;
 const lookup=(url:string)=>offers.byUrl(normaliseUrl(url)??url);
 const source=(job:CapturedJob,at:number):ResolvedOffer=>({url:job.url,finalUrl:job.url,text:job.description??'',stated:{title:job.title,company:job.company,location:job.location,salary:job.salary,salary_ranges:job.salary_ranges,contract_type:job.contract_type,employment_type:job.employment_type,work_mode:job.work_mode,seniority:job.seniority,required_skills:job.required_skills,posted_at:job.posted_at,valid_through:job.valid_through,apply_url:job.apply_url,company_type:job.company_type,company_size:job.company_size,engagement_length:job.engagement_length,start_date:job.start_date,requisition_id:job.requisition_id,requisition_issuer:job.requisition_issuer,client_name:job.client_name,field_evidence:job.field_evidence,extractor_version:job.extractor_version??'browser:v1'},routes:{companyUrl:job.company_url,applicationEmail:job.application_email,applyUrl:job.apply_url},extractionWarnings:job.completeness==='partial'?['Posting text selected manually in the browser; completeness is unknown.']:[],sourceData:{acquisition:'browser',capturedAt:at,completeness:job.completeness}});
 const collection=()=>{
  const row=db.prepare("SELECT id FROM discovery_searches WHERE json_extract(manifest,'$.kind')='browser_import' AND status='ready' ORDER BY created_at LIMIT 1").get() as {id:string}|undefined;
  return row?.id;
 };
 const receipt=(operationId:string)=>{const row=db.prepare('SELECT value FROM browser_import_receipts WHERE operation_id=?').get(operationId) as {value:string}|undefined;return row?JSON.parse(row.value) as ImportReceipt:null;};
 const commitBatch=db.transaction((operationId:string,pages:ImportPage[],requestHash:string,targetSearchId?:string):ImportReceipt=>{
   const prior=db.prepare('SELECT request_hash,value FROM browser_import_receipts WHERE operation_id=?').get(operationId) as {request_hash:string;value:string}|undefined;
   if(prior){if(prior.request_hash!==requestHash)throw new OperationError('operation_conflict','This operation ID belongs to a different import.');return JSON.parse(prior.value) as ImportReceipt;}
   if(!pages.length||pages.length>20||Buffer.byteLength(JSON.stringify(pages))>24*1024*1024)throw new OperationError('collection_limit','Collection exceeds its page or data limit.');
   const validated=pages.map(p=>({...p,capture:validateCapture(p.capture,p.recipe)})), at=now();
   if(validated.reduce((n,p)=>n+p.indices.length,0)>1000)throw new OperationError('collection_limit','Select at most 1,000 jobs.');
   const destination=targetSearchId?searches.get(targetSearchId):undefined;
   if(destination && (!destination.boardThread || destination.boards.length!==1 || validated.some(p=>p.indices.some(i=>(p.integration?.provenance.sourceKey??p.capture.items[i]?.board)!==destination.boardThread!.boardId)))) {
     throw new OperationError('browser_destination_mismatch','Captured jobs must belong to the destination search board.');
   }
   let id=targetSearchId??collection();
   if(!id){id=randomUUID();searches.create(id,'Browser Imports',['browser'],{sourceMode:'cache',matchMode:'anywhere',matchingPolicyVersion:'browser-import-v1',kind:'browser_import'});}
   const result:ImportReceipt={operationId,collectionId:id,...(targetSearchId?{targetSearchId}:{}),seq:0,added:0,updated:0,unchanged:0,skipped:0,offerIds:[]};
   for(const {capture,indices,capturedAt,recipe,integration} of validated) for(const index of indices){
    const job=capture.items[index];if(!job)throw new OperationError('invalid_selection','The selection is not in this preview.');
    const existing=lookup(job.url); const previous=existing?latest(existing.id):undefined;
    const active=existing?enrichments.get(existing.id):undefined;
    if(active?.details?.status==='fetching'||active?.status==='analyzing')throw new OperationError('offer_busy','An offer is being refreshed or analyzed. Wait for it to finish, then import again.');
    const contentHash=jobHash(job);
    const board=integration?.provenance.sourceKey??job.board;
    const listing={...job,board,provenance:integration?.provenance,description:undefined,titleSource:'board' as const,adapter_id:recipe?.kind,adapter_version:recipe?.revision};
    const batch:DiscoveryBatch={version:1,board,integration,items:[listing],nextCursor:null,hasMore:false,coverage:'first-page',retrievedAt:new Date(capturedAt??at).toISOString(),expiresAt:new Date(at).toISOString(),effectiveFilters:[],unsupportedFilters:[],limitations:['Imported only from the page loaded in your browser.'],requestCount:0,sourceExhausted:false};
    const item=catalogue.ingest(batch,at)[0];if(!item){result.skipped++;continue;}
    const offerId=item.offer.id;result.offerIds.push(offerId);
    const unchanged=previous?.hash===contentHash;
    result[!existing?'added':unchanged?'unchanged':'updated']++;
    if(!unchanged){
     const captureId=randomUUID();
     db.prepare('INSERT INTO browser_captures(id,offer_id,value,content_hash,captured_at,completeness,source_url,parser,capture_method) VALUES(?,?,?,?,?,?,?,?,?)').run(captureId,offerId,JSON.stringify({...job,...(recipe?{integrationRecipe:recipe}:{}),...(integration?{integrationProvenance:integration.provenance}:{})}),contentHash,capturedAt??at,job.completeness,capture.url,capture.parser,capture.kind==='selection'?'selected_text':capture.parser==='jsonld-browser-v1'?'jsonld':job.extractor_version?'board_parser':'embedded_state');
     const previousEnrichment=enrichments.get(offerId);
     if(job.description && !(existing?.text && existing.text.length>job.description.length)){
      enrichments.source({...previousEnrichment,offerId,id:previousEnrichment?.id??randomUUID(),status:previousEnrichment?.status??'idle',updatedAt:at,extractorVersion:browserVersion(job),detailsFetchedAt:at,sourceHash:contentHash,details:{id:captureId,status:'succeeded',fetchedAt:at,updatedAt:at,requested:false}},source(job,at));
     } else if(!offers.get(offerId)?.text.trim()) {
      enrichments.write({...previousEnrichment,offerId,id:previousEnrichment?.id??randomUUID(),status:previousEnrichment?.status??'idle',updatedAt:at,extractorVersion:'browser:listing'});
     }
    }
    const updated={...item,offer:offers.get(offerId)!,enrichment:enrichments.get(offerId)};
    const qualified=destination?qualifyDiscoveryItem(updated,destination.phrase,destination.matchMode,'live',{
      unknownPolicy:destination.unknownPolicy,activity:destination.activity,maxPublishedAgeDays:destination.maxPublishedAgeDays
    },at):updated;
    if(qualified && !searches.suppressed(id,offerId)) searches.add(id,[qualified]);
    else result.skipped++;
    if(updated.enrichment)searches.refreshOffer(updated.offer,updated.enrichment);
   }
   // Browsers add sources to this collection; they never change search matching rules.
   if(!targetSearchId) db.prepare("UPDATE discovery_searches SET manifest=json_set(manifest,'$.boards',json(?)) WHERE id=?").run(JSON.stringify([...new Set([...searches.read({id,offset:0,limit:1}).search.boards,...validated.flatMap(p=>p.indices.map(i=>p.integration?.provenance.sourceKey??p.capture.items[i]!.board))])]),id);
   const row=db.prepare('INSERT INTO browser_import_receipts(operation_id,request_hash,value,created_at) VALUES(?,?,?,?)').run(operationId,requestHash,'{}',at);
   result.seq=Number(row.lastInsertRowid);db.prepare('UPDATE browser_import_receipts SET value=? WHERE seq=?').run(JSON.stringify(result),result.seq);
   return result;
  }).immediate;
 return {
  commitBatch,
  commit:(operationId:string,capture:BrowserCapture,indices:number[],requestHash:string,recipe?:BrowserRecipe,targetSearchId?:string,integration?:IntegrationExecution)=>commitBatch(operationId,[{capture,indices,recipe,integration}],requestHash,targetSearchId),
  destinationBoard:(id:string)=>searches.get(id).boardThread?.boardId,
  receipt,
  collection:()=>{const id=collection();return id?searches.read({id,offset:0,limit:1}).search:null;},
  poll:(after:number)=>{const rows=db.prepare('SELECT seq,value FROM browser_import_receipts WHERE seq>? ORDER BY seq LIMIT 100').all(after) as {seq:number;value:string}[];return {cursor:rows.at(-1)?.seq??after,imports:rows.map(r=>JSON.parse(r.value) as ImportReceipt),collectionId:collection()??null};},
  has:(url:string)=>{const offer=lookup(url);return !!offer&&!!latest(offer.id);},
  capture:(url:string):ResolvedOffer|undefined=>{const offer=lookup(url);if(!offer)return;const row=db.prepare("SELECT value,captured_at FROM browser_captures WHERE offer_id=? AND completeness!='listing' ORDER BY (completeness='complete') DESC,length(json_extract(value,'$.description')) DESC,rowid DESC LIMIT 1").get(offer.id) as {value:string;captured_at:number}|undefined;if(row){const captured=source(JSON.parse(row.value) as CapturedJob,row.captured_at);if(offer.text.length>captured.text.length)return {...captured,text:offer.text,stated:offer.stated,sourceData:{acquisition:'cache',browserCaptureAvailable:true}};return captured;}},

 };
};
