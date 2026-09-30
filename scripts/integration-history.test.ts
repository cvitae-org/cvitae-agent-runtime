import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { createDiscoveryCatalogue } from '../src/storage/sqlite/discovery.js';
import { discoveryEvidenceSchema } from '../src/contracts/discovery-search.js';
import type { DiscoveryBatch } from '../src/contracts/discovery.js';
import { executionFor } from '../src/effects/integration-execution.js';
import type { ScopedIntegration } from '../src/effects/integration-providers.js';
import { sourceKey } from '../vendor/integration-protocol/node.mjs';
import { fixtureProvider } from './fixtures/integration-provider.js';

test('migration and repeat acquisitions retain canonical offers, private history and every provider provenance after restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'integration-history-')),path=join(directory,'runtime.db'),now=Date.now();
  let db=open(path);
  try{
    migrate(db,migrations.filter(m=>m.version<=34));const oldOffers=createOfferStore(db),oldCatalogue=createDiscoveryCatalogue(db,oldOffers);
    const url='https://jobs.example/offer/one';
    oldOffers.save({id:'existing-user-id',url,board:'legacy_jobs',position:'Research Engineer',text:'Saved offer detail',processing:'fetched',disposition:'applied',firstSeenAt:1,lastSeenAt:2});
    db.prepare('INSERT INTO offer_notes VALUES(?,?,?,?)').run('existing-user-id','Keep my application notes',1,2);
    assert.equal(oldCatalogue.search({keyword:'Research',boards:['legacy_jobs'],limit:10,offset:0}).items[0]?.acquisitions,undefined);
    migrate(db);const offers=createOfferStore(db),catalogue=createDiscoveryCatalogue(db,offers);
    const identities=['first','second'].map(name=>fixtureProvider(name,now));
    const scoped:ScopedIntegration[]=identities.map(provider=>({key:sourceKey(provider.connection.id,'jobs'),reference:{connectionId:provider.connection.id,providerId:provider.connection.providerId,sourceId:'jobs'},
      source:provider.snapshot.sources[0]!,validUntil:provider.snapshot.validUntil,releaseSequence:1,releaseRevision:'release-1'}));
    const batch=(source:ScopedIntegration,offerUrl=url):DiscoveryBatch=>({version:1,board:source.key,integration:executionFor(source,'http-json-v1'),
      items:[{board:source.key,url:offerUrl,title:'Research Engineer',titleSource:'board',external_id:'same-local-id',provenance:executionFor(source,'http-json-v1').provenance}],nextCursor:null,hasMore:false,
      coverage:'paginated',retrievedAt:new Date(now).toISOString(),expiresAt:new Date(now+10000).toISOString(),effectiveFilters:[],unsupportedFilters:[],limitations:[]});
    for(const source of scoped)assert.equal(catalogue.ingest(batch(source),now)[0]?.offer.id,'existing-user-id');
    const repeated=catalogue.ingest(batch(scoped[0]!),now+1)[0]!;assert.equal(repeated.acquisitions?.length,2);
    assert.deepEqual(discoveryEvidenceSchema.parse(repeated).acquisitions,repeated.acquisitions);
    assert.equal(offers.get('existing-user-id')?.board,'legacy_jobs');assert.equal(offers.get('existing-user-id')?.disposition,'applied');assert.equal(offers.get('existing-user-id')?.text,'Saved offer detail');
    assert.equal(repeated.note?.text,'Keep my application notes');
    // A matching external ID at a different provider and URL does not merge offers.
    const third={...scoped[1]!,key:sourceKey('third','jobs'),reference:{connectionId:'third',providerId:'third.example',sourceId:'jobs'}};
    assert.notEqual(catalogue.ingest(batch(third,'https://jobs.example/offer/two'),now)[0]?.offer.id,'existing-user-id');
    for(const source of scoped){const item=catalogue.search({keyword:'Research',boards:[source.key],limit:10,offset:0}).items[0]!;
      assert.equal(item.offer.id,'existing-user-id');assert.equal(item.listing?.board,source.key);assert.equal(item.acquisitions?.length,2);}
    const retained=db.prepare('SELECT recipe FROM discovery_integration_definitions').all() as {recipe:string}[];
    assert.ok(retained.every(row=>JSON.parse(row.recipe).sourceId==='jobs'));
    db.close();db=open(path);
    const after=createDiscoveryCatalogue(db,createOfferStore(db)).search({keyword:'Research',boards:[scoped[1]!.key],limit:10,offset:0}).items[0]!;
    assert.equal(after.offer.id,'existing-user-id');assert.equal(after.acquisitions?.length,2);assert.equal(after.note?.text,'Keep my application notes');
  }finally{db.close();await rm(directory,{recursive:true,force:true});}
});
