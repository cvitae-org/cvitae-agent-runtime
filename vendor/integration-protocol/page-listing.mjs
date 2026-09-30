import { z } from 'zod';
import { semanticDetailRecipeSchema, semanticRuleSchema } from './semantic-dom.mjs';
const base = semanticDetailRecipeSchema.shape;
const pointer = z.string().max(500).regex(/^(?:\/(?:[^~]|~[01])*)?$/);
const text = z.string().min(1).max(500);
const token = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/);
const path = z.string().max(500).regex(/^\/[A-Za-z0-9/_-]*$/);
const values = z.record(text, text).refine(value => Object.keys(value).length <= 100);
const condition = z.object({ pointer, equals: z.union([text, z.boolean()]).optional(), greaterThan: z.number().optional(), lessThan: z.number().optional() }).strict()
  .refine(value => value.equals !== undefined || value.greaterThan !== undefined || value.lessThan !== undefined);
const field = z.object({ pointer, parts:z.array(pointer).min(1).max(8).optional(), when:z.array(condition).max(5).optional(), items: pointer.optional(), where: condition.optional(),
  flags: z.array(z.object({ when: z.array(condition).min(1).max(5), value: text }).strict()).max(10).optional(),
  values: values.optional(), format: z.enum(['text', 'html', 'timestamp', 'unix-ms']).optional(),
}).strict();
const fields = z.object({ title: field, company: field.optional(), location: field.optional(),
  salary: field.optional(), contract_type: field.optional(), employment_type: field.optional(),
  required_skills: field.optional(), work_mode: field.optional(), posted_at: field.optional(),
}).strict();
export const listingRouteSchema = z.object({ path,
  keyword: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('query'), parameter: token, prefix: z.string().max(100) }).strict(),
    z.object({ kind: z.literal('path'), suffix: z.string().max(30).regex(/^[A-Za-z;,_-]*$/) }).strict(),
    z.object({ kind: z.literal('taxonomy'), segment: token, entries: z.array(z.object({ key: token, value: text, label: text, aliases: z.array(text).min(1).max(20) }).strict()).min(1).max(200),
      neutral: z.array(text).max(100), complex: z.array(text).max(50), filtersPointer: pointer, valuePointer: pointer }).strict(),
  ]),
  page: z.discriminatedUnion('kind', [z.object({kind:z.literal('query'), parameter:token}).strict(), z.object({kind:z.literal('segment'), prefix:z.string().regex(/^[A-Za-z]+,$/)}).strict()]),
}).strict().refine(route => route.keyword.kind === 'taxonomy' ? route.page.kind === 'segment' : route.page.kind === 'query')
  .refine(route => route.keyword.kind !== 'query' || route.page.kind !== 'query' || route.keyword.parameter !== route.page.parameter);
export const pageListingRecipeSchema = z.object({ kind: z.literal('page-listing-v1'), sourceId:base.sourceId, revision:base.revision, hosts:base.hosts,
  offer:base.offer, identity:base.identity, listing:listingRouteSchema,
  data: z.discriminatedUnion('kind', [
    z.object({ kind:z.literal('embedded'), scriptId:z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/), items:pointer, slug:pointer, fields,
      page:pointer.optional(), pages:pointer.optional(), total:pointer.optional(), pageSize:pointer.optional(),
      // Missing acknowledgements never establish exhaustion or permit a second page.
      acknowledgement:z.enum(['required','optional']), keyword:pointer.optional(),
      salaries:base.embedded.unwrap().shape.salaries,
    }).strict().refine(data => data.acknowledgement === 'optional' || data.page !== undefined && (data.pages !== undefined || data.total !== undefined && data.pageSize !== undefined)),
    z.object({ kind:z.literal('dom'), root:base.root, items:base.root, title:z.array(semanticRuleSchema).min(1).max(8), url:z.array(semanticRuleSchema).min(1).max(8),
      paginationLinks:base.root.optional(), empty:base.root.optional(),
    }).strict(),
  ]), maxPages:z.number().int().min(1).max(5),
}).strict().refine(recipe => recipe.listing.keyword.kind !== 'taxonomy' || recipe.data.kind === 'embedded');
