// Shared verbatim with job-pages/src/embedded-json-contract.mts.
import { z } from 'zod';
const pointer = z.string().max(500).regex(/^(?:\/(?:[^~]|~[01])*)?$/);
const word = z.string().min(1).max(100);
const text = z.string().min(1).max(2000);
const host = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/).refine(value => !/\.(local|localhost|internal)$/.test(value));
const path = z.string().max(500).regex(/^\/[A-Za-z0-9/_-]*$/);
const values = z.record(word, z.string().min(1).max(100)).refine(value => Object.keys(value).length <= 50);
export const embeddedJsonRecipeSchema = z.object({
  kind: z.literal('embedded-json-v1'), sourceId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), revision: text,
  hosts: z.array(host).min(1).max(10),
  listing: z.object({ path, pageParameter: word.regex(/^[A-Za-z][A-Za-z0-9_-]*$/), keywordParameter: word.regex(/^[A-Za-z][A-Za-z0-9_-]*$/) }).strict(),
  embedded: z.object({ scriptId: word.regex(/^[A-Za-z_][A-Za-z0-9_-]*$/), items: pointer, page: pointer, pages: pointer, keywords: pointer }).strict(),
  fields: z.object({ id: pointer, title: pointer, company: pointer, location: z.object({ items: pointer, value: pointer }).strict(), skills: pointer,
    postedAt: pointer, assumeUTC: z.boolean(), workModes: pointer, workModeValues: z.record(word, z.enum(['remote','hybrid','onsite'])).refine(value => Object.keys(value).length <= 50) }).strict(),
  offer: z.object({ pathPrefix: path.refine(value => value.endsWith('/')), slug: pointer, idSuffix: word.regex(/^[A-Za-z,_-]+$/), idFormat: z.literal('uuid') }).strict(),
  salaries: z.object({ items: pointer, min: pointer, max: pointer, currencies: z.array(pointer).min(1).max(3), period: pointer,
    contractId: pointer, contractName: pointer, tax: z.array(pointer).min(1).max(3),
    contractValues: values, contractAliases: values, currencyValues: values,
    periodValues: z.record(word, z.enum(['hour','day','month','year'])).refine(value => Object.keys(value).length <= 50) }).strict(),
}).strict().refine(value => value.listing.pageParameter !== value.listing.keywordParameter, 'Page and keyword parameters must differ');
