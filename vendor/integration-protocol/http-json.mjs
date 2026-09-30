// Wire contract shared with cvitae-scrapper/src/core/http-json-contract.mts.
// The cross-repository acceptance check enforces byte-for-byte parity.
import { z } from 'zod';
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const text = z.string().min(1).max(2000);
const pointer = z.string().max(500).regex(/^(?:\/(?:[^~]|~[01])*)?$/);
const hostname = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/)
  .refine(value => !/\.(local|localhost|internal)$/.test(value));
const field = z.object({ pointer, operation: z.enum(['text', 'url', 'date', 'join']), required: z.boolean() }).strict();
const binding = z.union([z.object({ value: z.string().max(300) }).strict(), z.object({ input: z.enum(['keyword', 'page']) }).strict()]);
export const httpJsonRecipeSchema = z.object({
  kind: z.literal('http-json-v1'), sourceId: id, revision: text,
  hosts: z.array(hostname).min(1).max(10),
  request: z.object({ url: z.string().url().max(2000), apiVersion: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/).optional(),
    query: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/), binding).refine(value => Object.keys(value).length <= 20),
  }).strict(),
  itemsPointer: pointer,
  pagination: z.object({ pagePointer: pointer, totalPagesPointer: pointer, startPage: z.union([z.literal(0), z.literal(1)]), maxPages: z.number().int().min(1).max(5) }).strict(),
  fields: z.object({ title: field, url: field, external_id: field, company: field.optional(), description: field.optional(), location: field.optional(),
    employment_type: field.optional(), posted_at: field.optional(), valid_through: field.optional() }).strict(),
  eligibility: z.object({ locationsPointer: pointer, allowedLocations: z.array(z.string().min(1).max(100)).min(1).max(100), normalize: z.literal('latin-fold') }).strict().optional(),
  workMode: z.object({ remotePointer: pointer, hybridPointer: pointer }).strict().optional(),
  skills: z.object({ itemsPointer: pointer, namePointer: pointer, exclude: z.object({ pointer, value: text }).strict().optional() }).strict().optional(),
  salaries: z.object({ pointers: z.array(pointer).min(1).max(5), minPointer: pointer, maxPointer: pointer, currencyPointer: pointer, periodPointer: pointer,
    contractPointer: pointer, periods: z.record(z.string().max(80), z.enum(['hour', 'day', 'month', 'year'])), contracts: z.record(z.string().max(80), z.string().max(100)),
  }).strict().optional(),
}).strict().superRefine((recipe, context) => {
  let url;
  try { url = new URL(recipe.request.url); } catch { context.addIssue({ code: 'custom', message: 'Invalid recipe URL' }); return; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !recipe.hosts.includes(url.hostname)) {
    context.addIssue({ code: 'custom', message: 'Recipe URL must use an explicitly allowed public HTTPS host without credentials or query' });
  }
  for (const field of [recipe.fields.title, recipe.fields.url, recipe.fields.external_id]) if (!field.required) context.addIssue({ code: 'custom', message: 'Identity fields are required' });
  if (recipe.fields.url.operation !== 'url' || recipe.fields.title.operation !== 'text' || recipe.fields.external_id.operation !== 'text') context.addIssue({ code: 'custom', message: 'Invalid identity field operation' });
  for (const input of ['keyword', 'page']) if (Object.values(recipe.request.query).filter(binding => 'input' in binding && binding.input === input).length !== 1) context.addIssue({ code: 'custom', message: 'Bind keyword and page exactly once' });
});
