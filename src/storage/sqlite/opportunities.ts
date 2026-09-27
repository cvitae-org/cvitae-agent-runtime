import { randomUUID } from 'node:crypto';
import type { Db } from './open.js';
import { OperationError } from '../../contracts/operation-error.js';
import { opportunityFeatures, matchingEvidence, opportunityRuleVersion, type OpportunityFeatures } from '../../capabilities/offers/opportunity-matching.js';
export function createOpportunityStore(db:Db,now=Date.now){
 const supported=()=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='opportunities'").get();
 const revision=()=>supported()?(db.prepare('SELECT revision FROM opportunity_revision WHERE id=1').get() as {revision:number}).revision:0;
 const bump=()=>db.prepare('UPDATE opportunity_revision SET revision=revision+1 WHERE id=1').run();
 const group=(id:string)=>(db.prepare('SELECT opportunity_id FROM opportunity_members WHERE offer_id=?').get(id) as {opportunity_id:string}|undefined)?.opportunity_id;
 const members=(id:string)=>(db.prepare('SELECT offer_id FROM opportunity_members WHERE opportunity_id=? ORDER BY offer_id').all(id) as {offer_id:string}[]).map(r=>r.offer_id);
 const excluded=(a:string,b:string)=>!!db.prepare('SELECT 1 FROM opportunity_exclusions WHERE left_id=? AND right_id=?').get(...[a,b].sort());
 const feature=(id:string)=>{const r=db.prepare('SELECT value FROM opportunity_features WHERE offer_id=?').get(id) as {value:string}|undefined;return r?JSON.parse(r.value) as OpportunityFeatures:undefined;};
 const record=(kind:string,a:string,b:string,evidence:unknown)=>db.prepare('INSERT INTO opportunity_decisions(kind,left_id,right_id,evidence,rule_version,created_at) VALUES(?,?,?,?,?,?)').run(kind,a,b,JSON.stringify(evidence),opportunityRuleVersion,now());
 function merge(a:string,b:string,manual:boolean){
  const ga=group(a),gb=group(b);if(!ga||!gb)throw new OperationError('offer_missing','Both listings must be stored.');if(ga===gb)return ga;
  const left=members(ga),right=members(gb),proof:unknown[]=[];
  for(const x of left)for(const y of right){
   if(!manual){const fx=feature(x),fy=feature(y),e=fx&&fy?matchingEvidence(fx,fy):undefined;if(excluded(x,y)||!e)return undefined;proof.push({left:x,right:y,...e});}
   else db.prepare('DELETE FROM opportunity_exclusions WHERE left_id=? AND right_id=?').run(...[x,y].sort());
  }
  const groups=db.prepare('SELECT id FROM opportunities WHERE id IN (?,?) ORDER BY created_at,id').all(ga,gb) as {id:string}[];
  const target=groups[0]!.id,old=groups[1]!.id;
  db.prepare('UPDATE opportunity_members SET opportunity_id=? WHERE opportunity_id=?').run(target,old);
  db.prepare('UPDATE opportunity_aliases SET target_id=? WHERE target_id=?').run(target,old);
  db.prepare('INSERT OR REPLACE INTO opportunity_aliases VALUES(?,?)').run(old,target);
  record(manual?'manual_link':'auto_link',a,b,proof);bump();return target;
 }
 const sync=db.transaction(()=>{
  if(!supported())return;
  const dirty=(db.prepare('SELECT offer_id FROM opportunity_dirty ORDER BY offer_id').all() as {offer_id:string}[]).map(r=>r.offer_id);
  for(const id of dirty){
   const row=db.prepare('SELECT board,stated FROM offers WHERE id=?').get(id) as {board:string;stated:string|null};
   const source=db.prepare('SELECT listing FROM discovery_sources WHERE offer_id=? ORDER BY seen_at DESC LIMIT 1').get(id) as {listing:string}|undefined;
   const f=opportunityFeatures(id,row.board??'','',JSON.parse(row.stated??'{}'),source?JSON.parse(source.listing):{});
   db.prepare('INSERT OR REPLACE INTO opportunity_features VALUES(?,?,?,?,?,?)').run(id,f.company,f.role,'','',JSON.stringify(f));
  }
  for(const id of dirty){const f=feature(id)!;
   if(!f.company||!f.role)continue;
   const ids=(db.prepare('SELECT offer_id FROM opportunity_features WHERE company=? AND role=?').all(f.company,f.role) as {offer_id:string}[]).map(row=>row.offer_id);
   for(const other of ids)if(other!==id&&group(id)!==group(other))merge(id,other,false);
  }
  db.prepare('DELETE FROM opportunity_dirty').run();
 }).immediate;
 return {sync,revision,
  identity(id:string){sync();return supported()?group(id):undefined;},
  resolve(ids:string[]){sync();return {identityRevision:revision(),identities:ids.map(id=>({id,opportunityId:supported()?(group(id)??(db.prepare('SELECT target_id FROM opportunity_aliases WHERE id=?').get(id) as {target_id:string}|undefined)?.target_id??((db.prepare('SELECT id FROM opportunities WHERE id=?').get(id) as {id:string}|undefined)?.id)??null):null}))};},
  link:db.transaction((a:string,b:string)=>{sync();const opportunityId=merge(a,b,true);return {opportunityId,identityRevision:revision()};}).immediate,
  separate:db.transaction((id:string)=>{sync();const old=group(id);if(!old)throw new OperationError('offer_missing','Listing does not exist.');const others=members(old).filter(v=>v!==id);if(!others.length)return {opportunityId:old,identityRevision:revision()};
   for(const other of others)db.prepare('INSERT OR IGNORE INTO opportunity_exclusions VALUES(?,?)').run(...[id,other].sort());
   const opportunityId='opp-'+randomUUID();db.prepare('INSERT INTO opportunities VALUES(?,?)').run(opportunityId,now());db.prepare('UPDATE opportunity_members SET opportunity_id=? WHERE offer_id=?').run(opportunityId,id);record('manual_separate',id,old,{excluded:others});bump();return {opportunityId,identityRevision:revision()};}).immediate,
  members(id:string){sync();return members(id);},
  candidates(offerId:string,term:string){sync();const like='%'+term.replace(/[\\%_]/g,'\\$&')+'%';return db.prepare(`SELECT o.id AS offerId,o.url,f.company,f.role,m.opportunity_id AS opportunityId FROM opportunity_features f JOIN offers o ON o.id=f.offer_id JOIN opportunity_members m ON m.offer_id=o.id WHERE o.id<>? AND (f.company LIKE ? ESCAPE '\\' OR f.role LIKE ? ESCAPE '\\' OR o.url=? OR o.id=?) AND EXISTS(SELECT 1 FROM discovery_search_members sm JOIN discovery_searches s ON s.id=sm.search_id WHERE sm.offer_id=o.id AND s.status='ready') ORDER BY o.last_seen_at DESC,o.id LIMIT 30`).all(offerId,like,like,term,term);}
 };
}
