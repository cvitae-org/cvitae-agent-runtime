import { z } from 'zod';
import { domDetailRecipeSchema, selectorSchema } from './dom.mjs';
// Attribute prefix/substring matching is bounded by the same selector grammar.
// Functional pseudo selectors, wildcards and executable expressions stay invalid.
const semanticSelector = z.string().min(1).max(400).refine(value => selectorSchema.safeParse(value.replace(/([a-z][a-z0-9_-]*)[\^*]=/g, '$1=')).success);
const text = z.string().min(1).max(2000);
const pointer = z.string().max(500).regex(/^(?:\/(?:[^~]|~[01])*)?$/);
// Relations are explicit bounded steps, never arbitrary CSS expressions or code.
export const semanticRuleSchema = z.object({
  selector: semanticSelector, text: z.array(text).min(1).max(20).optional(),
  steps: z.array(z.enum(['parent', 'next', 'following', 'children'])).max(3).optional(),
  within: semanticSelector.optional(), firstChild: z.boolean().optional(), omit: z.array(semanticSelector).max(10).optional(),
  attribute: z.enum(['href', 'content', 'datetime']).optional(),
}).strict();
const rules = z.array(semanticRuleSchema).min(1).max(8);
const valueMap = z.record(z.string().min(1).max(500), text).refine(value => Object.keys(value).length <= 100);
export const semanticFieldSchema = z.object({ rules, multiple: z.boolean().optional(), values: valueMap.optional() }).strict();
const field = semanticFieldSchema;
const fields = z.object({ title: field, company: field.optional(), location: field.optional(),
  work_mode: field.optional(), contract_type: field.optional(), employment_type: field.optional(),
  seniority: field.optional(), company_size: field.optional(), start_date: field.optional(),
}).strict();
const embeddedField = z.object({ pointer, flags: z.array(z.object({ pointer, value: text }).strict()).max(10).optional(), items: pointer.optional(), join: z.string().max(4).optional(),
  values: valueMap.optional(), format: z.enum(['text', 'html', 'timestamp', 'utc-timestamp']).optional() }).strict();
const embedded = z.object({ scriptId: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/), object: pointer,
  slug: pointer, checks: z.array(z.object({ pointer, equals: z.union([text, z.boolean()]) }).strict()).max(10),
  fields: z.object({ title: embeddedField, company: embeddedField.optional(), location: embeddedField.optional(),
    work_mode: embeddedField.optional(), contract_type: embeddedField.optional(), employment_type: embeddedField.optional(),
    seniority: embeddedField.optional(), posted_at: embeddedField.optional(), valid_through: embeddedField.optional(),
    required_skills: embeddedField.optional(), apply_url: embeddedField.optional(), start_date: embeddedField.optional(),
    company_type: embeddedField.optional(), company_size: embeddedField.optional(), engagement_length: embeddedField.optional(),
  }).strict(),
  sections: z.array(embeddedField).min(1).max(20),
  salaries: z.array(z.object({ pointer, array: z.boolean(), min: pointer.optional(), max: pointer.optional(), range: pointer.optional(),
    currency: z.array(pointer).min(1).max(3), period: pointer,
    contract: z.object({ pointer: pointer.optional(), value: text.optional(), values: valueMap.optional() }).strict(),
    tax: z.array(pointer).max(3), hidden: pointer.optional(),
    when: z.array(z.object({ pointer, equals: z.union([text, z.boolean()]) }).strict()).max(5),
  }).strict()).max(8).optional(),
}).strict();
const base = domDetailRecipeSchema.shape;
export const semanticDetailRecipeSchema = z.object({ kind: z.literal('dom-detail-v2'), sourceId: base.sourceId,
  revision: base.revision, hosts: base.hosts, offer: base.offer,
  identity: z.object({ part: z.enum(['segment', 'prefix', 'suffix']), delimiter: z.string().min(1).max(30).optional(),
    format: z.enum(['slug', 'integer', 'uuid']) }).strict().refine(v => v.part === 'segment' || !!v.delimiter),
  root: semanticSelector, exclude: z.array(semanticSelector).max(20), fields,
  sections: z.array(rules).min(1).max(20), skills: rules.optional(), salaries: rules.optional(),
  embedded: embedded.optional(), jsonLd: z.boolean(),
}).strict();
