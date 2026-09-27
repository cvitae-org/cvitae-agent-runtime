import type { DiscoveryEvidence } from '../../contracts/discovery-search.js';
import { projectOffer } from './offer-query-projection.js';
import { queryTables } from './offer-query-schema.js';
export type OpportunitySource=DiscoveryEvidence & {note?:unknown;opportunityId?:string;published?:Record<string,unknown>};
const columns={role:'role',company:'company',salary:'salary_text',industry:'industry',size:'company_size',contract:'contract_type',start:'start_date',duration:'duration'};
export function groupOpportunities(items:OpportunitySource[],identity:(id:string)=>string|undefined,identityRevision:number){
 const groups=new Map<string,OpportunitySource[]>();
 for(const item of items){const id=identity(item.offer.id)??item.offer.id;const values=groups.get(id)??[];if(!values.some(v=>v.offer.id===item.offer.id))values.push(item);groups.set(id,values);}
 return [...groups].map(([id,sources])=>{
  const projected=sources.map(source=>{
   const values=projectOffer('',source).tables.offers![0]!;
   const published=source.published??Object.fromEntries(queryTables.offers.map((c,i)=>[c.name,values[i]]));
   const ranges=source.offer.stated?.salary_ranges??source.listing?.salary_ranges;
   if(!published.salary_text&&ranges?.length)published.salary_text=ranges.map(r=>[r.contractType,r.rawText,r.taxBasis].filter(Boolean).join(' · ')).join(' / ');
   if(!published.contract_type&&ranges?.length)published.contract_type=[...new Set(ranges.map(r=>r.contractType).filter(Boolean))].join(' / ')||null;
   return {...source,published};
  });
  const summary:Record<string,string|null>={},conflicts:string[]=[];
  for(const [key,column]of Object.entries(columns)){
   const values=[...new Set(projected.map(s=>s.published[column]).filter(v=>v!==undefined&&v!==null&&v!==''))];
   summary[key]=values.length===1?String(values[0]):null;
   if(values.length>1)conflicts.push(key);
  }
  return {...projected[0]!,opportunity:{id,identityRevision,representativeOfferId:projected[0]!.offer.id,summary,conflicts,sources:projected}};
 });
}
