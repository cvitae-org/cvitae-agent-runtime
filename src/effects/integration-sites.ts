import type { SiteReader, IntegrationSourceInfo, Listing } from '../contracts/effects.js';
import type { DiscoverySource } from '../contracts/discovery.js';
import type { IntegrationProviders } from './integration-providers.js';
/** Each reader owns its provider catalogue; nothing is registered process-wide. */
export function withIntegrationSites(web: SiteReader, providers: IntegrationProviders, discovery: DiscoverySource): SiteReader {
  return {...web,
    async integrationSources(call): Promise<IntegrationSourceInfo[]> {
      const resolved=await providers.resolve(call.signal);
      return resolved.sources.map(source=>({domain:new URL(source.source.website).hostname,name:source.source.label,routing:source.source.routing,hosts:source.source.hosts,
        scraperId:source.source.recipe?source.key:undefined,fetchable:source.source.detailRecipe?'ok':'refused',
        markets:source.source.markets.map(market=>market.toLowerCase()),search:!!source.source.detailRecipe}));
    },
    async listBoard(request,call){
      const available=await discovery.boards(call.signal);
      if(!available.boards.some(board=>board.id===request.board&&board.enabled))return {status:'unavailable',detail:'Select an enabled provider integration.'};
      const limit=Math.min(200,Math.max(1,Math.floor(request.limit))),rows:Listing[]=[];let cursor:string|undefined;
      for(let page=0;page<2;page++){
        const result=await discovery.search({board:request.board,keyword:request.keyword,pageSize:Math.min(limit,100),...(cursor?{cursor}:{})},call.signal);
        if(result.status!=='ok')return {status:result.status==='blocked'||result.status==='disallowed'?'failed':'unavailable',detail:result.detail};
        rows.push(...result.data.items.map(item=>({board:request.board,title:item.title,url:item.url,company:item.company,location:item.location,salary:item.salary})));
        if(rows.length>=limit||!result.data.nextCursor)break;cursor=result.data.nextCursor;
      }
      return {status:'ok',data:rows.slice(0,limit)};
    }
  };
}
