import { publishedSalarySchema, type PublishedSalary } from '../../contracts/published-salary.js';
/** Contract form is distinct from FULL_TIME/PART_TIME/CONTRACTOR employment type. */
export const publishedContract = (value: unknown): string | undefined => {
 if (typeof value!=='string') return undefined;
 const key=value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 if (/^(b2b|business.to.business)$/.test(key)) return 'B2B';
 if (/^(uop|umowa o prace|employment contract)$/.test(key)) return 'UoP';
 if (/^(uoz|umowa zlecenie|zlecenie)$/.test(key)) return 'UoZ';
 if (/^(uod|umowa o dzielo)$/.test(key)) return 'UoD';
 return undefined;
};
export const publishedSalaries = (raw: unknown): PublishedSalary[] | undefined => {
 if (!Array.isArray(raw)) return undefined;
 const values=raw.slice(0,20).flatMap(value=>{
  const parsed=publishedSalarySchema.safeParse(value);
  return parsed.success?[{...parsed.data,currency:parsed.data.currency.toUpperCase(),contractType:publishedContract(parsed.data.contractType)}]:[];
 });
 return values.length?values:undefined;
};
