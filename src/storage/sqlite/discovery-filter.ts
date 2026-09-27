import type { z } from 'zod';
import type { discoveryFiltersSchema } from '../../contracts/discovery-search.js';
/** A salary and its contract must match the same published alternative. */
export const discoveryFilter = (f: z.infer<typeof discoveryFiltersSchema>, units: { currency?: string; period?: string } = {}): { sql: string; args: (string | number)[] } => {
 const clauses: string[]=[]; const args:(string|number)[]=[];
 const source="coalesce(json_extract(e.value,'$.offer.board'),json_extract(e.value,'$.listing.board'),'unknown')";
 if(f.sources.length){clauses.push(`${source} IN (${f.sources.map(()=>'?').join(',')})`);args.push(...f.sources);}
 if(f.contracts.length || f.minimum!==null || f.maximum!==null || units.currency || units.period){
  const contract="coalesce(json_extract(e.value,'$.offer.stated.contract_type'),json_extract(e.value,'$.offer.contractType'),json_extract(e.value,'$.offer.analysis.contract_type'),json_extract(e.value,'$.listing.contract_type'),'')";
  const alternatives=`CASE WHEN json_array_length(json_extract(e.value,'$.offer.stated.salary_ranges'))>0 THEN json_extract(e.value,'$.offer.stated.salary_ranges') ELSE json_array(json_object('min',json_extract(e.value,'$.offer.salaryReading.min'),'max',json_extract(e.value,'$.offer.salaryReading.max'),'currency',json_extract(e.value,'$.offer.salaryReading.currency'),'period',json_extract(e.value,'$.offer.salaryReading.period'),'contractType',${contract})) END`;
  const tests:string[]=[];
  if(f.contracts.length){
   const value=`coalesce(json_extract(sr.value,'$.contractType'),${contract})`;
   tests.push(`(CASE WHEN trim(${value}) IN ('','Not stated','Unknown','Untitled') THEN 'unknown' ELSE lower(trim(${value})) END) IN (${f.contracts.map(()=>'?').join(',')})`);args.push(...f.contracts);
  }
  if(f.minimum!==null || f.maximum!==null){
   const low="json_extract(sr.value,'$.min')",high="json_extract(sr.value,'$.max')";
   const currency="coalesce(json_extract(sr.value,'$.currency'),'')",period="coalesce(json_extract(sr.value,'$.period'),'')";
   const unknown=`(${currency}='' OR ${period}='' OR (${low} IS NULL AND ${high} IS NULL))`;
   const salary=[`NOT ${unknown}`,`upper(${currency})=?`,`${period}=?`];args.push(f.currency,f.period);
   if(f.minimum!==null){salary.push(`(${high} IS NULL OR ${high}>=?)`);args.push(f.minimum);}
   if(f.maximum!==null){salary.push(`(${low} IS NULL OR ${low}<=?)`);args.push(f.maximum);}
   tests.push(`(${salary.join(' AND ')}${f.includeUnknown?` OR ${unknown}`:''})`);
  } else {
   if(units.currency){tests.push("upper(json_extract(sr.value,'$.currency'))=?");args.push(units.currency);}
   if(units.period){tests.push("json_extract(sr.value,'$.period')=?");args.push(units.period);}
  }
  clauses.push(`EXISTS (SELECT 1 FROM json_each(${alternatives}) sr WHERE ${tests.join(' AND ')})`);
 }
 return {sql:clauses.length?clauses.join(' AND '):'1',args};
};
