import { z } from 'zod';
// A deliberately small CSS subset: no pseudo classes, wildcards, selector lists,
// substring attributes or executable expressions. '$' selects the current root.
const atom = String.raw`(?:[A-Za-z][A-Za-z0-9_-]*)?(?:[.#][A-Za-z_][A-Za-z0-9_-]*|\[[a-z][a-z0-9_-]*(?:="[A-Za-z0-9_:/.-]{1,100}")?\])*`;
export const selectorSchema = z.string().min(1).max(400).refine(value => value === '$' ||
  value.split(/\s*>\s*|\s+/).length <= 8 && value.split(/\s*>\s*|\s+/).every(part => part.length > 0 && new RegExp(`^${atom}$`).test(part)), 'Unsupported selector');
const text = z.string().min(1).max(2000);
const host = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/).refine(value => !/\.(local|localhost|internal)$/.test(value));
const path = z.string().max(500).regex(/^\/[A-Za-z0-9/_-]*$/);
const parameter = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/);
export const domFieldSchema = z.object({ selector: selectorSchema,
  attribute: z.string().regex(/^(?:href|content|datetime|data-[a-z][a-z0-9_-]{0,80})$/).optional(),
  values: z.record(z.string().min(1).max(200), z.string().min(1).max(200)).refine(values => Object.keys(values).length <= 100).optional(),
}).strict();
const common = { kind: z.string(), sourceId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), revision: text,
  hosts: z.array(host).min(1).max(10), offer: z.object({ pathPrefix: path.refine(value => value.endsWith('/')) }).strict() };
const optionalFields = {
  company: domFieldSchema.optional(), location: domFieldSchema.optional(), salary: domFieldSchema.optional(),
  contract_type: domFieldSchema.optional(), employment_type: domFieldSchema.optional(), seniority: domFieldSchema.optional(),
  posted_at: domFieldSchema.optional(), valid_through: domFieldSchema.optional(), apply_url: domFieldSchema.optional(),
  work_mode: domFieldSchema.optional(),
};
const fields = z.object({ external_id: domFieldSchema, title: domFieldSchema, url: domFieldSchema, ...optionalFields }).strict();
export const domListingRecipeSchema = z.object({ ...common, kind: z.literal('dom-listing-v1'),
  listing: z.object({ path, pageParameter: parameter, keywordParameter: parameter }).strict()
    .refine(value => value.pageParameter !== value.keywordParameter),
  root: selectorSchema, items: selectorSchema, fields,
  pagination: z.object({ page: domFieldSchema, pages: domFieldSchema, keyword: domFieldSchema,
    empty: selectorSchema, maxPages: z.number().int().min(1).max(5) }).strict(),
}).strict();
export const domDetailRecipeSchema = z.object({ ...common, kind: z.literal('dom-detail-v1'), root: selectorSchema,
  fields: fields.extend({ description: domFieldSchema, required_skills: domFieldSchema.optional() }).strict(),
}).strict();
