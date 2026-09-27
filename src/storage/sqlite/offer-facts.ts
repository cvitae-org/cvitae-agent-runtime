import type { Db } from './open.js';
import { hash } from './offer-query-projection.js';
import { criterionHash } from '../../capabilities/offers/targeted-facts.js';
import { extractorVersion, type Criterion, type FactSource, type StoredFact } from '../../contracts/offer-facts.js';
const key=(source:FactSource,c:Criterion,model:string)=>hash(JSON.stringify([source.offerId,source.sourceHash,criterionHash(c),extractorVersion,model]));
export function createOfferFactStore(db:Db) {
 return {
  cached(source:FactSource,criteria:Criterion[],model:string) {
   const facts=criteria.map(c=>db.prepare('SELECT value FROM offer_targeted_facts WHERE cache_key=?').get(key(source,c,model)) as {value:string}|undefined);
   return facts.every(Boolean)?facts.map(f=>JSON.parse(f!.value) as StoredFact):null;
  },
  save(source:FactSource,facts:StoredFact[],signal:AbortSignal) {
   signal.throwIfAborted();
   db.transaction(()=>{for(const f of facts) db.prepare('INSERT OR IGNORE INTO offer_targeted_facts VALUES(?,?,?,?,?,?,?,?)').run(key(source,f.criterion,f.modelVersion),f.offerId,f.sourceHash,f.criterionHash,f.modelVersion,JSON.stringify(f),source.text,f.extractedAt);})();
  }
 };
}
// Captured inside the query snapshot transaction. Old snapshots never gain new facts.
export function factRows(db:Db,offerId:string,sourceText:string,modelVersion?:string):(string|number|null)[][] {
 const sourceHash=hash(sourceText);
 return (db.prepare('SELECT value FROM (SELECT value,created_at,cache_key,row_number() OVER(PARTITION BY criterion_hash,source_hash ORDER BY created_at DESC,cache_key DESC) AS rank FROM offer_targeted_facts WHERE offer_id=? AND (? IS NULL OR model_version=?)) WHERE rank=1 ORDER BY created_at,cache_key').all(offerId,modelVersion??null,modelVersion??null) as {value:string}[]).map(row=>{
  const f=JSON.parse(row.value) as StoredFact;
  return [f.offerId,f.criterion.key,typeof f.value==='string'?f.value:null,typeof f.value==='number'?f.value:null,typeof f.value==='boolean'?Number(f.value):null,f.status,f.evidenceQuote,f.sourceHash,f.extractedAt,f.extractorVersion,Number(f.sourceHash!==sourceHash),f.criterionHash,f.criterion.question,f.criterion.valueType,f.modelVersion,f.evidenceId];
 });
}
