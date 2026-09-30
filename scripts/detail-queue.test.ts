import test from 'node:test';
import assert from 'node:assert/strict';
import { open } from '../src/storage/sqlite/open.js';
import { migrate } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createDiscoverySearchStore } from '../src/storage/sqlite/discovery-searches.js';
import { createEnrichmentStore } from '../src/storage/sqlite/enrichment.js';
import { createEnrichmentService } from '../src/runtime/enrichment.js';
import { createDetailQueueStore } from '../src/storage/sqlite/detail-queue.js';
import { createDetailQueue } from '../src/runtime/detail-queue.js';
import { parseSalary } from '../src/capabilities/offers/salary.js';
import { publishedContract } from '../src/capabilities/offers/published.js';
import { discoveryFilter } from '../src/storage/sqlite/discovery-filter.js';
import { discoveryFiltersSchema } from '../src/contracts/discovery-search.js';
import { OperationError, RuntimeError, type ResolvedOffer } from '../src/contracts/index.js';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const setup=(maxRequestsTotal=500)=>{
 const db=open(':memory:');migrate(db);const offers=createOfferStore(db);
 const searches=createDiscoverySearchStore(db,offers);searches.create('s','React',['vacancies'],{
  sourceMode:'hybrid',matchMode:'anywhere',matchingPolicyVersion:'test',budget:{targetAcceptedTotal:null,maxCandidatesTotal:10000,maxPagesPerSource:100,maxRequestsTotal,deadlineMs:720000,maxConcurrentRequests:3}
 });
 for(let i=0;i<5;i++) offers.sight([{id:`a${i}`,url:`https://vacancies.example/job-offer/a${i}`,text:''}],1);
 searches.add('s',offers.recent(10).map(offer=>({offer})));
 return {db,offers,searches,store:createEnrichmentStore(db,offers),queueStore:createDetailQueueStore(db)};
};
const source=(url:string):ResolvedOffer=>({url,finalUrl:url,text:'Published React role',stated:{title:'React Engineer'}});

test('automatic queue bounds workers, deduplicates and persists pause/recovery without AI', async()=>{
 const {db,offers,store,queueStore}=setup();const pending:((value:ResolvedOffer)=>void)[]=[];let reads=0;
 const enrichment=createEnrichmentService(offers,store,{resolve:async url=>{reads++;return new Promise(resolve=>pending.push(()=>resolve(source(url))));}},()=>{assert.fail('automatic details must not use AI');});
 const queue=createDetailQueue(queueStore,enrichment);
 try {
  queue.enqueue('s',['a0','a1','a2','a0']);await tick();assert.equal(reads,2);
  assert.equal(queue.poll().queued,1);assert.equal(queue.poll().running,2);
  queue.pause(true);pending[0]!(source(''));pending[1]!(source(''));await tick();
  assert.equal(queue.poll().queued,1);assert.equal(queue.poll().running,0);
  assert.equal(offers.get('a0')?.position,'React Engineer');
  queue.enqueue('s',['a0']);assert.equal(queue.poll().queued,1);
  assert.throws(()=>queue.enqueue('other',['a0']),/does not belong/);
  queue.close();enrichment.close();
  const recovered=createDetailQueueStore(db);assert.equal(recovered.paused(),true);
  recovered.set('a2','running');recovered.recover();assert.equal(recovered.next()?.offerId,'a2');
  recovered.pause(false);assert.equal(recovered.paused(),false);
 } finally {queue.close();enrichment.close();db.close();}
});

test('failed automatic reads are not retried; manual consumer survives clearing automatic work',async()=>{
 const {db,offers,store,queueStore}=setup();let reads=0;let resolve:(source:ResolvedOffer)=>void=()=>undefined;
 const enrichment=createEnrichmentService(offers,store,{resolve:async url=>{reads++;if(url.endsWith('a0'))throw new Error('Source refused');return new Promise(done=>{resolve=done;});}},()=>{assert.fail('no model');});
 const queue=createDetailQueue(queueStore,enrichment);
 try {
  queue.enqueue('s',['a0']);await tick();assert.equal(queue.poll().jobs[0]?.status,'failed');
  queue.enqueue('s',['a0']);await tick();assert.equal(reads,1);
  queue.enqueue('s',['a1']);enrichment.details.start('a1');await tick();
  queue.clear();resolve(source('https://vacancies.example/job-offer/a1'));await tick();
  assert.equal(store.get('a1')?.details?.status,'succeeded');assert.equal(offers.get('a1')?.text,'Published React role');
  const first=queue.poll();assert.equal(queue.poll(first.after).jobs.length,0);
 } finally {queue.close();enrichment.close();db.close();}
});

// Mutations run, not assumed: `failed` without a reason; every reason `unknown`;
// a `RuntimeError` not read for its code. Each fails this test.
test('a failed automatic read keeps its error code as the reason, beside the message the offer shows',async()=>{
 const {db,offers,store,queueStore}=setup();
 const errors:Record<string,Error>={a0:new OperationError('unreadable_source','The offer contained no readable text.'),
  a1:new RuntimeError('SCRAPER_URL is not a valid URL.','misconfigured'),a2:new Error('socket hang up')};
 const enrichment=createEnrichmentService(offers,store,{resolve:async url=>{throw errors[url.slice(-2)]!;}},()=>{assert.fail('no model');});
 const queue=createDetailQueue(queueStore,enrichment);
 try {
  queue.enqueue('s',['a0','a1']);await tick();
  queue.enqueue('s',['a2']);await tick();
  const reasons=Object.fromEntries(queue.poll().items.map(item=>[item.offer.id,[item.autoDetailStatus,item.autoDetailStopReason]]));
  assert.deepEqual(reasons,{a0:['failed','unreadable_source'],a1:['failed','misconfigured'],a2:['failed','unknown']});
  assert.equal(store.get('a0')?.details?.error,'The offer contained no readable text.');
  assert.equal(createDetailQueueStore(db).poll(0).jobs.find(job=>job.offerId==='a1')?.stopReason,'misconfigured');
 } finally {queue.close();enrichment.close();db.close();}
});

test('stop preserves active jobs for resume and clear discards the stopped queue',async()=>{
 const {db,offers,store,queueStore}=setup();const pending:((value:ResolvedOffer)=>void)[]=[];let reads=0;
 const enrichment=createEnrichmentService(offers,store,{resolve:async url=>{reads++;return new Promise(resolve=>pending.push(()=>resolve(source(url))));}},()=>{assert.fail('no model');});
 const queue=createDetailQueue(queueStore,enrichment);
 try {
  queue.enqueue('s',['a0','a1','a2']);await tick();assert.equal(queue.poll().running,2);assert.equal(queue.poll().queued,1);
  queue.stop();await tick();assert.equal(queue.poll().paused,true);assert.equal(queue.poll().running,0);assert.equal(queue.poll().queued,3);
  queue.clear();assert.equal(queue.poll().queued,0);assert.equal(queue.poll().running,0);
  queue.pause(false);await tick();assert.equal(reads,2);
 } finally {queue.close();enrichment.close();db.close();}
});

test('listing and automatic detail workers share one durable request ledger',async()=>{
 const {db,offers,store,queueStore,searches}=setup(2);let reads=0;let resolve:(source:ResolvedOffer)=>void=()=>undefined;
 const enrichment=createEnrichmentService(offers,store,{resolve:async ()=>{reads++;return new Promise(done=>{resolve=done;});}},()=>{assert.fail('no model');});
 const queue=createDetailQueue(queueStore,enrichment,searches);
 try {
  assert.equal(searches.reserveRequest('s','search'),true);
  queue.enqueue('s',['a0','a1']);await tick();
  assert.equal(reads,1);
  const jobs=queue.poll().jobs;
  assert.equal(jobs.find(job=>job.offerId==='a1')?.stopReason,'request_budget');
  assert.deepEqual(searches.requestUsage('s'),{search:1,details:1,total:2,limit:2,remaining:0,exhausted:true});
  assert.equal(searches.reserveRequest('s','search'),false);
  resolve(source('https://vacancies.example/job-offer/a0'));await tick();
  assert.equal(queue.poll().items.find(item=>item.offer.id==='a1')?.autoDetailStopReason,'request_budget');
 } finally {queue.close();enrichment.close();db.close();}
});

test('internal detail capacity requeue refunds its reservation',async()=>{
 const {db,offers,store,queueStore,searches}=setup(3);
 const enrichment=createEnrichmentService(offers,store,{resolve:async url=>source(url)},()=>{assert.fail('no model');});
 const queue=createDetailQueue(queueStore,enrichment,searches);
 try {
  // Occupy all three detail-service slots explicitly before the two queue workers start.
  enrichment.details.start('a2');enrichment.details.start('a3');enrichment.details.start('a4');
  queue.enqueue('s',['a0']);await tick();
  assert.equal(searches.requestUsage('s').total,0);
  assert.equal(queue.poll().queued,1);
 } finally {queue.close();enrichment.close();db.close();}
});

test('published alternatives preserve contract/tax basis and filter the same range without fabricating a single salary',async()=>{
 const {db,offers,store,searches}=setup();
 const ranges=[{min:20000,max:25000,currency:'PLN',period:'month' as const,contractType:'B2B',taxBasis:'net + VAT',rawText:'20000–25000 PLN/month'},
 {min:16000,max:18000,currency:'PLN',period:'month' as const,contractType:'UoP',taxBasis:'gross',rawText:'16000–18000 PLN/month'}];
 const enrichment=createEnrichmentService(offers,store,{resolve:async url=>({...source(url),stated:{contract_type:'B2B',employment_type:'FULL_TIME',company_type:'Fintech',company_size:'50–200',engagement_length:'P6M',salary_ranges:ranges}})},()=>{assert.fail('no model');},Date.now,value=>searches.refreshOffer(offers.get(value.offerId)!,value));
 try {
  enrichment.details.start('a0');await tick();const offer=offers.get('a0')!;
  assert.deepEqual(offer.stated?.salary_ranges,ranges);assert.equal(offer.salaryReading,undefined);
  assert.equal(offer.analysis?.company_type,'Fintech');assert.equal(store.get('a0')?.provenance?.contract_type?.source,'board');
  const count=(contract:string,minimum:number)=>{const f=discoveryFilter(discoveryFiltersSchema.parse({contracts:[contract],minimum}));return (db.prepare(`SELECT count(*) AS n FROM discovery_search_members m JOIN discovery_offer_evidence e ON e.id=m.evidence_id WHERE m.offer_id='a0' AND ${f.sql}`).get(...f.args) as {n:number}).n;};
  assert.equal(count('b2b',22000),1);assert.equal(count('uop',22000),0);assert.equal(count('uop',17000),1);
  assert.equal(publishedContract('FULL_TIME'),undefined);assert.equal(publishedContract('CONTRACTOR'),undefined);
 } finally {enrichment.close();db.close();}
});


test('published scalar salary units are parsed without guessing month or day',()=>{
 assert.equal(parseSalary('20000–25000 PLN month').period,'month');
 assert.equal(parseSalary('1000 PLN day').period,'day');
 assert.equal(parseSalary('20000 PLN').period,'');
});


test('refetch cancels and drains only its search jobs and allows fresh enqueue',async()=>{
 const {db,offers,store,queueStore,searches}=setup();
 searches.create('other','React',['vacancies']); searches.add('other',[{offer:offers.get('a4')!}]);
 const enrichment=createEnrichmentService(offers,store,{resolve:async()=>new Promise(()=>{})},()=>{assert.fail('no model');});
 const queue=createDetailQueue(queueStore,enrichment,searches);
 try {
  queue.enqueue('s',['a0','a1','a2']); queue.enqueue('other',['a4']); await tick();
  await queue.cancelSearch('s');
  assert.equal(queue.poll().jobs.filter(job=>job.searchId==='s').length,0);
  assert.equal(queue.poll().jobs.find(job=>job.searchId==='other')?.status,'queued');
  queue.enqueue('s',['a0']); await tick();
  assert.equal(queue.poll().jobs.find(job=>job.offerId==='a0')?.status,'running');
 } finally {queue.close();enrichment.close();await tick();db.close();}
});
