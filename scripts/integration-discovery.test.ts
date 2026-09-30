import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntegrationProviders } from '../src/effects/integration-providers.js';
import { createIntegrationDiscovery } from '../src/effects/integration-discovery.js';
import { createHarness } from '../src/runtime/create.js';
import { fixtureProvider } from './fixtures/integration-provider.js';

const signal = () => new AbortController().signal;
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'integration-discovery-')), now = Date.now();
  const first = fixtureProvider('first', now), second = fixtureProvider('second', now), received: Record<string, unknown>[] = [];
  let supported = true, wrongBoard = false;
  const providers = createIntegrationProviders([first.connection, second.connection], {cacheDirectory: directory, now: () => now,
    fetch: async url => Response.json((String(url) === first.connection.resolveUrl ? first : second).seal())});
  const source = createIntegrationDiscovery(providers, {token:'s'.repeat(40), now:()=>now,fetch:async(url,init)=>{
    assert.equal((init?.headers as Record<string,string>).Authorization,`Bearer ${'s'.repeat(40)}`);
    if(String(url).endsWith('/boards'))return Response.json({version:1,recipeEngines:['http-json-v1'],...(supported?{recipeBinding:'provider-source-v1'}:{}),boards:[]});
    assert.ok(String(url).endsWith('/recipes/search'));
    const body=JSON.parse(init!.body as string) as Record<string,unknown>;received.push(body);
    assert.equal((body.recipe as {sourceId:string}).sourceId,'jobs');
    return Response.json({status:'ok',data:{version:1,board:body.board,items:[{board:wrongBoard?'jobs':body.board,url:'https://jobs.example/offer/one',title:'Research Engineer',titleSource:'board',external_id:'one'}],
      nextCursor:body.cursor?null:'shared-inner-cursor',hasMore:!body.cursor,coverage:'paginated',retrievedAt:new Date(now).toISOString(),expiresAt:new Date(now+100000).toISOString(),effectiveFilters:[],unsupportedFilters:[],limitations:[],requestCount:body.cursor?0:2}});
  }});
  return {directory,now,first,second,providers,source,received,set supported(value:boolean){supported=value;},set wrongBoard(value:boolean){wrongBoard=value;},
    close:async()=>{providers.close();await rm(directory,{recursive:true,force:true});}};
}
test('independent providers collect overlapping source IDs using local keys and unchanged recipes',async()=>{
  const s=await setup();try{
    const catalogue=await s.source.boards(signal());assert.equal(catalogue.boards.length,2);
    const [a,b]=catalogue.boards;assert.notEqual(a!.id,b!.id);assert.equal(a!.integration?.sourceId,'jobs');assert.ok(a!.enabled&&b!.enabled);
    const query={board:a!.id,keyword:'Research',pageSize:1};
    const first=await s.source.search(query,signal());assert.equal(first.status,'ok');if(first.status!=='ok')return;
    const replay=await s.source.search(query,signal());if(replay.status==='ok')assert.equal(replay.data.nextCursor,first.data.nextCursor);
    assert.equal(first.data.integration?.provenance.providerId,'first.example');assert.equal(first.data.integration?.recipe.sourceId,'jobs');
    assert.equal(first.data.items[0]?.board,a!.id);assert.deepEqual(first.data.items[0]?.provenance,first.data.integration?.provenance);
    assert.equal((s.received[0]?.binding as {connectionId:string}).connectionId,'first');
    assert.equal((await s.source.search({...query,board:b!.id,cursor:first.data.nextCursor!},signal())).status,'expired_cursor');
    const second=await s.source.search({...query,board:b!.id},signal());assert.equal(second.status,'ok');
    if(second.status==='ok')assert.notEqual(first.data.nextCursor,second.data.nextCursor);
    assert.equal((await s.source.browserSearch!(b!.id,'C++ & C#',signal())).board,b!.id);
    s.providers.remove('first');assert.equal((await s.source.search(query,signal())).status,'unsupported');
    assert.equal((await s.source.search({...query,board:b!.id},signal())).status,'ok');
  }finally{await s.close();}
});
test('continuations pin release and recipe while new searches adopt updates and revocations stop old runs',async()=>{
  const s=await setup();try{
    const board=(await s.source.boards(signal())).boards[0]!.id,query={board,keyword:'Research',pageSize:1};
    const first=await s.source.search(query,signal());if(first.status!=='ok')assert.fail();
    const snapshot=structuredClone(s.first.snapshot),entry=snapshot.sources[0]!;
    snapshot.releaseSequence++;snapshot.revision='release-2';entry.revision='recipe-2';entry.health.recipeRevision='recipe-2';assert.equal(entry.recipe?.kind,'http-json-v1');if(entry.recipe?.kind!=='http-json-v1')assert.fail();entry.recipe.revision='recipe-2';entry.recipe.fields.title.pointer='/role';s.first.snapshot=snapshot;
    await s.providers.resolve(signal(),true);
    const next=await s.source.search({...query,cursor:first.data.nextCursor!},signal());if(next.status!=='ok')assert.fail();
    assert.equal(next.data.integration?.provenance.recipeRevision,'recipe-1');assert.equal(next.data.integration?.provenance.releaseSequence,1);
    const fresh=await s.source.search(query,signal());if(fresh.status!=='ok')assert.fail();assert.equal(fresh.data.integration?.provenance.recipeRevision,'recipe-2');
    s.first.snapshot={...s.first.snapshot,releaseSequence:3,revision:'release-3',revokedRecipes:[{sourceId:'jobs',revision:'recipe-1'}]};await s.providers.resolve(signal(),true);
    const before=s.received.length;assert.equal((await s.source.search({...query,cursor:first.data.nextCursor!},signal())).status,'unsupported');assert.equal(s.received.length,before);
  }finally{await s.close();}
});
test('old collectors and cross-source output cannot silently fall back to installed board adapters',async()=>{
  const s=await setup();try{
    s.supported=false;const boards=await s.source.boards(signal());assert.ok(boards.boards.every(board=>!board.enabled));
    assert.equal((await s.source.search({board:boards.boards[0]!.id,keyword:'Research',pageSize:1},signal())).status,'unsupported');assert.equal(s.received.length,0);
    s.supported=true;await s.source.boards(signal());s.wrongBoard=true;
    assert.equal((await s.source.search({board:boards.boards[0]!.id,keyword:'Research',pageSize:1},signal())).status,'error');
  }finally{await s.close();}
});
test('the runtime harness uses configured independent providers and an empty list has no implicit catalogue',async()=>{
  const s=await setup();try{
    const h=createHarness({databasePath:':memory:',env:{},scraperUrl:'',integrationProviders:s.providers});
    try{const boards=await h.discovery.boards();assert.deepEqual(boards.boards.map(board=>board.integration?.providerId),['first.example','second.example']);}finally{h.close();}
    const empty=createHarness({databasePath:':memory:',env:{INTEGRATION_PROVIDERS_JSON:'[]',INTEGRATION_PROVIDERS_CACHE_DIR:s.directory},scraperUrl:''});
    try{assert.deepEqual((await empty.discovery.boards()).boards,[]);}finally{empty.close();}
  }finally{await s.close();}
});
