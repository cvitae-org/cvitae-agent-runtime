import { publishedExtractorVersion } from '../src/contracts/field-evidence.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../src/storage/sqlite/open.js';
import { migrate,migrations } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createOpportunityStore } from '../src/storage/sqlite/opportunities.js';
import { createDiscoverySearchStore } from '../src/storage/sqlite/discovery-searches.js';
import { createOfferQueryStore } from '../src/storage/sqlite/offer-query-store.js';
import { createOfferQueryService } from '../src/runtime/offer-query.js';
import { opportunityFeatures,matchingEvidence } from '../src/capabilities/offers/opportunity-matching.js';
import { createEnrichmentStore } from '../src/storage/sqlite/enrichment.js';
import { createOfferDetailsService } from '../src/runtime/offer-details.js';
import { createDetailQueueStore } from '../src/storage/sqlite/detail-queue.js';
import type { StatedFacts } from '../src/contracts/offer.js';

const body='About us\nACME is an international recruitment company.\nResponsibilities\n'+Array.from({length:130},(_,i)=>`engineering${i}`).join(' ')+'\nBenefits\nShared company boilerplate';
const facts={company:'ACME',title:'Senior React Developer',posted_at:'2026-09-01',valid_through:'2026-10-01',start_date:'ASAP'};
function setup(path=':memory:'){
 const db=open(path);migrate(db);const offers=createOfferStore(db),identities=createOpportunityStore(db),searches=createDiscoverySearchStore(db,offers),queries=createOfferQueryStore(db);
 const add=(id:string,board='vacancies',overrides:StatedFacts={},text=body)=>{offers.sight([{id,url:`https://${board}.test/jobs/${id}`,board,text,stated:{...facts,...overrides}}],Number(id.replace(/\D/g,''))||1);return offers.get(id)!;};
 return {db,offers,identities,searches,queries,add};
}
test('headline policy matches only published normalized role and company',()=>{
 const base=opportunityFeatures('a','vacancies','',facts);
 const cases:[string,boolean,ReturnType<typeof opportunityFeatures>][]=[
  ['same board with no description or dates',true,opportunityFeatures('b','vacancies','',{company:'ACME',title:'Senior React Developer'})],
  ['other board, different salary and work mode',true,opportunityFeatures('b','rendered_jobs','',{...facts,salary:'25000 PLN',work_mode:'remote'})],
  ['different description',true,opportunityFeatures('b','rendered_jobs','A completely different description',facts)],
  ['different dates',true,opportunityFeatures('b','rendered_jobs','',{...facts,posted_at:'2027-01-01',valid_through:'2027-02-01'})],
  ['different detail clients and requisitions',true,opportunityFeatures('b','rendered_jobs','',{...facts,client_name:'A client',requisition_id:'42',requisition_issuer:'ACME'})],
  ['headline case and spacing',true,opportunityFeatures('b','rendered_jobs','',{company:' ACME Ltd. ',title:' SENIOR   React Developer '})],
  ['company differs',false,opportunityFeatures('b','rendered_jobs','',{...facts,company:'Other'})],
  ['seniority in headline differs',false,opportunityFeatures('b','rendered_jobs','',{...facts,title:'Junior React Developer'})],
  ['technology in headline differs',false,opportunityFeatures('b','rendered_jobs','',{...facts,title:'Senior C++ Developer'})],
  ['missing company',false,opportunityFeatures('b','rendered_jobs','',{...facts,company:undefined})],
  ['missing role',false,opportunityFeatures('b','rendered_jobs','',{...facts,title:undefined})],
  ['unknown role',false,opportunityFeatures('b','rendered_jobs','',{...facts,title:'Unknown'})],
  ['unknown company',false,opportunityFeatures('b','rendered_jobs','',{...facts,company:'Unknown'})],
 ];
 for(const [name,expected,other] of cases) assert.equal(!!matchingEvidence(base,other),expected,name);
 console.log(JSON.stringify({fixture:'opportunity-headlines-v3',cases:cases.length,passed:cases.length}));
});
test('published search headlines can group before details are fetched; slugs and unknowns cannot',()=>{
 const source={title:'Frontend Developer (Angular)',titleSource:'board',company:'Upvanta sp. z o.o.'};
 const a=opportunityFeatures('a','vacancies','',{},source),b=opportunityFeatures('b','vacancies','',{}, {...source,company:'UPVANTA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ'});
 assert.equal(matchingEvidence(a,b)?.kind,'headline');
 assert.equal(matchingEvidence(a,opportunityFeatures('c','vacancies','',{}, {...source,titleSource:'slug'})),undefined);
 const unknown=opportunityFeatures('d','vacancies','',{company:'Unknown',title:'Unknown'});
 assert.equal(matchingEvidence(unknown,unknown),undefined);
 assert.equal(matchingEvidence(opportunityFeatures('x','vacancies','',{company:'ACME',title:'C# developer'}),opportunityFeatures('y','vacancies','',{company:'ACME',title:'C++ developer'})),undefined);
});
test('automatic grouping requires every member to match, including manually linked groups',()=>{
 const s=setup();try{
  s.add('a');s.add('b','rendered_jobs',{title:'A different role'});s.identities.link('a','b');s.add('c','html_jobs');
  assert.notEqual(s.identities.identity('a'),s.identities.identity('c'));
 }finally{s.db.close();}
});
test('singleton backfill, stable identity, aliases and manual separation survive restart',()=>{
 const directory=mkdtempSync(join(tmpdir(),'opportunity-test-')),path=join(directory,'db');
 try{
  const legacy=open(path);migrate(legacy,migrations.filter(m=>m.version<27));createOfferStore(legacy).sight([{id:'legacy',text:''}],1);legacy.close();
  let s=setup(path);const old=s.identities.identity('legacy');assert.ok(old?.startsWith('opp-'));migrate(s.db);assert.equal(s.identities.identity('legacy'),old);
  s.add('b','rendered_jobs',{},'');const other=s.identities.identity('b')!;s.identities.link('legacy','b');const merged=s.identities.identity('b');assert.equal(s.identities.resolve([other]).identities[0]?.opportunityId,merged);
  const separated=s.identities.separate('b').opportunityId;assert.notEqual(separated,merged);
  s.offers.save({...s.offers.get('b')!,text:'Updated public description'});s.identities.sync();s.db.close();
  s=setup(path);assert.equal(s.identities.identity('b'),separated);assert.equal(s.identities.identity('legacy'),merged);s.db.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('manual separation prevents automatic regrouping after evidence updates',()=>{
 const s=setup();try{s.add('a');s.add('b','rendered_jobs');assert.equal(s.identities.identity('a'),s.identities.identity('b'));
  s.identities.separate('b');s.offers.save({...s.offers.get('b')!,text:body+'\nBenefits\nNew benefit'});
  assert.notEqual(s.identities.identity('a'),s.identities.identity('b'));
  s.identities.link('a','b');assert.equal(s.identities.identity('a'),s.identities.identity('b'));
 }finally{s.db.close();}
});
test('groups before pagination and filters per listing; summaries expose conflicts',()=>{
 const s=setup();try{
  const a=s.add('a'),b=s.add('b','rendered_jobs',{start_date:'2026-10-01'}),c=s.add('c','vacancies',{title:'Different job'});
  s.searches.create('s','React',['vacancies','rendered_jobs']);s.searches.add('s',[{offer:a},{offer:c},{offer:b}]);
  const first=s.searches.read({id:'s',presentation:'opportunities',limit:1});assert.equal(first.count,2);assert.equal(first.listingCount,3);
  assert.equal(first.items[0]!.opportunity.sources.length,2);assert.ok(first.items[0]!.opportunity.conflicts.includes('start'));
  const second=s.searches.read({id:'s',presentation:'opportunities',limit:1,offset:1,pageRevision:first.pageRevision});assert.equal(second.items[0]!.offer.id,'c');
  s.identities.separate('b');assert.throws(()=>s.searches.read({id:'s',presentation:'opportunities',offset:1,pageRevision:first.pageRevision}),/changed/);
  s.identities.link('a','b');
  s.searches.filters('s',{sources:['vacancies']},0);
  const filtered=s.searches.read({id:'s',filtered:true,presentation:'opportunities'});assert.equal(filtered.listingCount,2);assert.equal(filtered.items[0]!.opportunity.sources.length,1);assert.equal(filtered.items[0]!.opportunity.summary.start,'ASAP');
  const identity=s.identities.identity('a');s.searches.delete('s');assert.equal(s.identities.identity('a'),identity);
 }finally{s.db.close();}
});
test('immutable grouped SQL pages retain their identity and evidence after merge and source updates',async()=>{
 const s=setup(),service=createOfferQueryService(s.queries);try{
  const a=s.add('a'),b=s.add('b','rendered_jobs'),c=s.add('c','vacancies',{title:'Another role'});s.searches.create('s','React',['vacancies','rendered_jobs']);s.searches.add('s',[{offer:a},{offer:c},{offer:b}]);
  const context=await service.context('s',{kind:'search',searchId:'s'});
  const {executionId}=service.start({ownerSearchId:'s',scope:{kind:'search',searchId:'s'},snapshotId:context.snapshotId,expectedScopeRevision:context.scopeRevision,schemaVersion:1,requestId:'run',sql:'SELECT offer_id FROM offers ORDER BY search_rank'});
  while(['queued','capturing','running'].includes(service.get('s',executionId).state))await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(service.get('s',executionId).state,'succeeded');
  const page=service.opportunities('s',executionId,undefined,1);assert.equal(page.returnedRowCount,2);assert.equal(page.listingCount,3);assert.equal(page.opportunityItems[0]!.opportunity.sources.length,2);
  s.identities.separate('b');s.offers.save({...s.offers.get('a')!,stated:{...facts,start_date:'2027-01-01'}});
  const replay=service.opportunities('s',executionId,undefined,1);assert.deepEqual(replay.opportunityItems,page.opportunityItems);assert.equal(replay.identityStale,true);
  assert.equal(service.opportunities('s',executionId,page.nextCursor!,1).opportunityItems[0]!.offer.id,'c');
  assert.equal(service.page('s',executionId,undefined,100).rows.length,3);
  assert.throws(()=>service.opportunities('wrong',executionId,undefined,1));
 }finally{service.close();s.db.close();}
});
test('an extractor upgrade invalidates recent details and refreshes once; ambiguity clears old facts',async()=>{
 const s=setup();let reads=0;const enrichment=createEnrichmentStore(s.db,s.offers);s.add('a');
 enrichment.write({offerId:'a',id:'old',status:'idle',updatedAt:Date.now(),detailsFetchedAt:Date.now(),extractorVersion:'published-fields-v2'});
 const evidence={status:'ambiguous' as const,method:'text' as const,sourceUrl:'https://example.test/jobs/a',capturedAt:new Date().toISOString(),contentHash:'hash',extractorVersion:publishedExtractorVersion};
 const service=createOfferDetailsService(s.offers,enrichment,{resolve:async url=>{reads++;return {url,finalUrl:url,text:body,stated:{extractor_version:publishedExtractorVersion,field_evidence:{start_date:evidence}}};}});
 try{
  s.searches.create('s','React',['vacancies']);s.searches.add('s',[{offer:s.offers.get('a')!}]);const queue=createDetailQueueStore(s.db);queue.enqueue('s',['a']);queue.set('a','succeeded');queue.enqueue('s',['a']);assert.equal(queue.next()?.offerId,'a');
  await service.ensure('a',false,new AbortController().signal);assert.equal(reads,1);assert.equal(s.offers.get('a')!.stated?.start_date,undefined);
  await service.ensure('a',false,new AbortController().signal);assert.equal(reads,1);
  assert.equal(s.offers.get('a')!.stated?.field_evidence?.start_date?.status,'ambiguous');
 }finally{service.close();s.db.close();}
});

test('pre-opportunity snapshots upgrade wire columns from captured evidence only',async()=>{
 const s=setup();try{
  const a=s.add('a');s.searches.create('s','React',['vacancies']);s.searches.add('s',[{offer:a}]);
  const snapshot=await s.queries.capture('s',{kind:'search',searchId:'s'});
  s.db.prepare("UPDATE offer_query_members SET metadata=json_remove(metadata,'$.projectionVersion','$.opportunityId','$.identityRevision') WHERE snapshot_id=?").run(snapshot.id);
  s.offers.save({...s.offers.get('a')!,stated:{...facts,title:'A newer title'}});
  const frames=[];for await(const batch of s.queries.batches(snapshot.id))frames.push(...batch);
  assert.equal(frames[0]!.tables.offers![0]![1],'a');
  assert.ok(frames[0]!.tables.offers![0]!.includes('Senior React Developer'));
  assert.ok(!frames[0]!.tables.offers![0]!.includes('A newer title'));
 }finally{s.db.close();}
});

test('headline matching is re-evaluated on upgrade without losing manual exclusions',()=>{
 const db=open(':memory:');try {
  migrate(db,migrations.filter(m=>m.version<=28));const offers=createOfferStore(db);
  for(const id of ['remote','hybrid','separated']) offers.sight([{id,board:'vacancies',text:'',stated:{company:'ACME',title:'React Developer',work_mode:id==='remote'?'remote':'hybrid'}}],1);
  // Simulate the completed v2 matcher, which could not match without descriptions and dates.
  db.prepare('DELETE FROM opportunity_dirty').run();
  db.prepare('INSERT INTO opportunity_exclusions VALUES(?,?)').run('remote','separated');
  db.prepare('INSERT INTO opportunity_exclusions VALUES(?,?)').run('hybrid','separated');
  const identities=createOpportunityStore(db),old=identities.resolve(['remote','hybrid','separated']).identities;
  assert.equal(new Set(old.map(v=>v.opportunityId)).size,3);
  migrate(db);const now=identities.resolve(['remote','hybrid','separated']).identities;
  assert.equal(now[0]!.opportunityId,now[1]!.opportunityId);assert.notEqual(now[0]!.opportunityId,now[2]!.opportunityId);
  assert.ok(old.slice(0,2).some(v=>v.opportunityId===now[0]!.opportunityId));
  migrate(db);assert.equal((db.prepare('SELECT count(*) AS n FROM opportunity_dirty').get() as {n:number}).n,0);
 }finally{db.close();}
});

test('Remote and combined predicates filter same-board listings before grouping, summaries, and pagination',async()=>{
 const s=setup(),service=createOfferQueryService(s.queries);try{
  const listings=[
   s.add('hybrid','vacancies',{work_mode:'hybrid',contract_type:'B2B',salary:'40000 PLN/month',start_date:'2026-12-01'}),
   s.add('remote','vacancies',{work_mode:'remote',contract_type:'UoP',salary:'20000 PLN/month',start_date:'ASAP'}),
   s.add('other','rendered_jobs',{title:'Different role',work_mode:'remote',contract_type:'B2B',salary:'25000 PLN/month'}),
  ];
  s.searches.create('s','React',['vacancies','rendered_jobs']);s.searches.add('s',listings.map(offer=>({offer})));
  const context=await service.context('s',{kind:'search',searchId:'s'});let request=0;
  const run=async(predicate:string)=>{
   const {executionId}=service.start({ownerSearchId:'s',scope:{kind:'search',searchId:'s'},snapshotId:context.snapshotId,expectedScopeRevision:context.scopeRevision,schemaVersion:1,requestId:'filter-'+(++request),sql:`SELECT offer_id FROM offers WHERE ${predicate} ORDER BY search_rank`});
   while(['queued','capturing','running'].includes(service.get('s',executionId).state))await new Promise(resolve=>setTimeout(resolve,5));
   assert.equal(service.get('s',executionId).state,'succeeded');return {executionId,page:service.opportunities('s',executionId,undefined,1)};
  };
  const all=await run('1');assert.equal(all.page.returnedRowCount,2);assert.equal(all.page.listingCount,3);assert.equal(all.page.opportunityItems[0]!.opportunity.sources.length,2);
  const remote=await run("work_mode='remote'");assert.equal(remote.page.returnedRowCount,2);assert.equal(remote.page.listingCount,2);
  const group=remote.page.opportunityItems[0]!;assert.equal(group.offer.id,'remote');assert.deepEqual(group.opportunity.sources.map(v=>v.offer.id),['remote']);
  assert.equal(group.opportunity.id,all.page.opportunityItems[0]!.opportunity.id);assert.equal(group.opportunity.summary.salary,'20000 PLN/month');assert.equal(group.opportunity.summary.start,'ASAP');assert.deepEqual(group.opportunity.conflicts,[]);
  assert.equal(service.opportunities('s',remote.executionId,remote.page.nextCursor!,1).opportunityItems[0]!.offer.id,'other');
  const combined:[string,string[]][]=[
   ["work_mode='remote' AND contract_type='B2B'",['other']],
   ["work_mode='remote' AND start_date='2026-12-01'",[]],
   ["work_mode='remote' AND EXISTS (SELECT 1 FROM offer_salaries s WHERE s.offer_id=offers.offer_id AND s.min_amount>=30000)",[]],
  ];
  for(const [predicate,expected] of combined){
   const result=await run(predicate);assert.deepEqual(result.page.opportunityItems.map(v=>v.offer.id),expected,predicate);assert.equal(result.page.returnedRowCount,expected.length);
  }
  const contract=await run("contract_type='B2B'");assert.deepEqual(contract.page.opportunityItems[0]!.opportunity.sources.map(v=>v.offer.id),['hybrid']);
  const location=await run("work_mode='hybrid'");assert.deepEqual(location.page.opportunityItems[0]!.opportunity.sources.map(v=>v.offer.id),['hybrid']);
  // Saved-search salary/contract filters also keep only qualifying source facts.
  s.searches.filters('s',{contracts:['uop']},0);const saved=s.searches.read({id:'s',filtered:true,presentation:'opportunities'});
  assert.equal(saved.count,1);assert.equal(saved.listingCount,1);assert.equal(saved.items[0]!.offer.id,'remote');
 }finally{service.close();s.db.close();}
});

test('the reported Upvanta Angular headlines stack immediately and retain both source IDs',()=>{
 const s=setup();try {
  const company='Upvanta sp. z o.o.',title='Frontend Developer (Angular)',salary='1 000 – 1 100 PLN/day (B2B)';
  const listings=['offer-1vilzju','offer-tt2twx'].map((id,i)=>s.add(id,'vacancies',{company,title,salary,posted_at:undefined,valid_through:undefined,work_mode:i?'remote':'hybrid'},''));
  s.searches.create('upvanta','frontend',['vacancies']);s.searches.add('upvanta',listings.map(offer=>({offer})));
  const page=s.searches.read({id:'upvanta',presentation:'opportunities'});
  assert.equal(page.count,1);assert.equal(page.listingCount,2);assert.deepEqual(page.items[0]!.opportunity.sources.map(source=>source.offer.id),['offer-1vilzju','offer-tt2twx']);
 }finally{s.db.close();}
});
