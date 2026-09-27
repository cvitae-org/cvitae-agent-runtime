import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../src/storage/sqlite/open.js';
import { migrate } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createDiscoveryCatalogue } from '../src/storage/sqlite/discovery.js';
import { createDiscoverySearchStore } from '../src/storage/sqlite/discovery-searches.js';
import { createOfferQueryStore } from '../src/storage/sqlite/offer-query-store.js';
import type { DiscoveryBatch } from '../src/contracts/discovery.js';

const batch: DiscoveryBatch = {version:1,board:'justjoin',items:[{board:'justjoin',url:'https://justjoin.it/job-offer/react',external_id:'react',title:'React Developer',titleSource:'board',company:'Example'}],nextCursor:null,hasMore:false,coverage:'sitemap',retrievedAt:'2026-09-21T00:00:00Z',expiresAt:'2026-09-22T00:00:00Z',effectiveFilters:[],unsupportedFilters:[],limitations:[]};
const setup = (path = ':memory:') => {
 const db = open(path); migrate(db);
 const offers = createOfferStore(db), catalogue=createDiscoveryCatalogue(db,offers), searches=createDiscoverySearchStore(db,offers);
 return {db,offers,catalogue,searches};
};
test('hide, delete and blacklist have separate scopes and preserve Board offer details', async () => {
 const {db,offers,catalogue,searches}=setup();
 try {
  const items=catalogue.ingest(batch,100), id=items[0]!.offer.id;
  for(const key of ['a','b']) { searches.create(key,'React',['justjoin']); searches.add(key,items); }
  offers.save({...offers.get(id)!,text:'Saved Board details'});
  db.prepare('INSERT INTO offer_notes VALUES(?,?,?,?)').run(id,'Keep my note',1,100);
  const visible=(key:string)=>searches.read({id:key}).count;
  searches.manage('a',[id],'hide');
  assert.equal(visible('a'),0); assert.equal(visible('b'),1);
  assert.equal(searches.read({id:'a'}).total,0);
  searches.add('a',items); assert.equal(visible('a'),0);
  const hiddenQuery=createOfferQueryStore(db);
  const hiddenSnapshot=await hiddenQuery.capture('a',{kind:'catalogue'});
  assert.equal(hiddenQuery.members('a',hiddenSnapshot.id).length,0);
  searches.manage('a',[id],'restore'); assert.equal(visible('a'),1);
  searches.manage('a',[id],'delete'); searches.add('a',items);
  assert.equal(visible('a'),0); assert.equal(visible('b'),1);
  searches.refetch('a',true); searches.add('a',items); assert.equal(visible('a'),0);
  searches.manage('b',[id],'blacklist');
  assert.equal(visible('b'),0);
  assert.equal(catalogue.ingest(batch,200).length,0);
  assert.equal(catalogue.search({keyword:'React',boards:['justjoin'],limit:10,offset:0}).items.length,0);
  searches.create('new','React',['justjoin']); searches.add('new',items); assert.equal(visible('new'),0);
  const queries=createOfferQueryStore(db);
  const snapshot=await queries.capture('new',{kind:'catalogue'});
  assert.equal(queries.members('new',snapshot.id).length,0);
  assert.equal(offers.get(id)?.text,'Saved Board details');
  assert.equal(offers.get(id)?.firstSeenAt,100);
  assert.equal((db.prepare('SELECT text FROM offer_notes WHERE offer_id=?').get(id) as {text:string}).text,'Keep my note');
  searches.manage('b',[id],'unblacklist'); assert.equal(visible('b'),1);
  assert.equal(catalogue.ingest(batch,300).length,1);
  assert.equal(offers.get(id)?.firstSeenAt,100);
  assert.equal(visible('a'),0);
 } finally {db.close();}
});
test('blacklist survives runtime restart and deletion of its originating search', () => {
 const dir=mkdtempSync(join(tmpdir(),'discover-actions-')),path=join(dir,'runtime.sqlite');
 try {
  let state=setup(path);
  const items=state.catalogue.ingest(batch,100),id=items[0]!.offer.id;
  state.searches.create('a','React',['justjoin']);state.searches.add('a',items);
  state.searches.manage('a',[id],'blacklist');state.searches.delete('a');state.db.close();
  state=setup(path);
  try {assert.equal(state.catalogue.ingest(batch,200).length,0);assert.ok(state.offers.get(id));}
  finally {state.db.close();}
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('a blacklisted-only live page does not prevent collecting later pages', async () => {
 const {db,catalogue,searches}=setup();
 const blocked=catalogue.ingest(batch,100)[0]!;
 searches.create('old','React',['justjoin']);searches.add('old',[blocked]);searches.manage('old',[blocked.offer.id],'blacklist');
 let calls=0;
 const {createDiscoveryService}=await import('../src/runtime/discovery.js');
 const service=createDiscoveryService(catalogue,{
  boards:async()=>({version:1,boards:[]}),
  search:async()=>{
   calls++;
   return {status:'ok',data:calls===1 ? {...batch,hasMore:true,nextCursor:'page-2'} : {...batch,items:[{...batch.items[0]!,external_id:'fresh',url:'https://justjoin.it/job-offer/fresh'}]}};
  }
 },Date.now,searches);
 try {
  const session=service.start({keyword:'React',boards:['justjoin'],pageSize:30,searchId:'new'});
  for(let i=0;i<20;i++) {
   await new Promise(resolve=>setImmediate(resolve));
   if(service.poll(session.id).boards.every(b=>b.status==='exhausted')) break;
  }
  assert.equal(calls,2);
  assert.equal(searches.read({id:'new'}).count,1);
  const events=service.poll(session.id).events;
  assert.equal(events.flatMap(e=>e.items??[]).some(i=>i.offer.id===blocked.offer.id),false);
 } finally {service.close();db.close();}
});

for (const action of ['hide', 'delete', 'blacklist'] as const) {
 test(`${action}: mixed excluded and repeated listings do not stop later pages or consume the candidate budget`, async () => {
  const {db,catalogue,searches}=setup();
  const {defaultDiscoveryBudget}=await import('../src/contracts/discovery.js');
  const budget={...defaultDiscoveryBudget,maxCandidatesTotal:2,targetAcceptedTotal:2};
  const blocked=catalogue.ingest(batch,100)[0]!;
  searches.create('search','React',['justjoin'],{sourceMode:'live',matchMode:'anywhere',matchingPolicyVersion:'discovery-match-v2',budget});
  searches.add('search',[blocked]);
  searches.manage('search',[blocked.offer.id],action);
  const listing=(id:string)=>({...batch.items[0]!,external_id:id,url:`https://justjoin.it/job-offer/${id}`});
  const pages:DiscoveryBatch[]=[
   {...batch,items:[listing('first')],hasMore:true,nextCursor:'mixed'},
   {...batch,items:[batch.items[0]!,listing('first')],hasMore:true,nextCursor:'fresh'},
   {...batch,items:[listing('fresh')]}
  ];
  const cursors:(string|undefined)[]=[];
  const {createDiscoveryService}=await import('../src/runtime/discovery.js');
  const service=createDiscoveryService(catalogue,{
   boards:async()=>({version:1,boards:[]}),
   search:async query=>{cursors.push(query.cursor);return {status:'ok',data:pages[cursors.length-1]!};}
  },Date.now,searches);
  try {
   const session=service.start({keyword:'React',boards:['justjoin'],pageSize:30,searchId:'search',budget});
   for(let i=0;i<50;i++) {
    await new Promise(resolve=>setImmediate(resolve));
    if(service.poll(session.id).boards.every(b=>b.status==='exhausted')) break;
   }
   assert.deepEqual(cursors,[undefined,'mixed','fresh']);
   const page=searches.read({id:'search'});
   assert.equal(page.count,2);
   assert.equal(page.items.some(item=>item.offer.id===blocked.offer.id),false);
   assert.equal(service.poll(session.id).boards[0]!.candidates,2);
  } finally {service.close();db.close();}
 });
}
