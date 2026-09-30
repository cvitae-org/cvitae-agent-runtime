import { z } from 'zod';
import { sourceIdSchema, providerIdSchema, publicUrlSchema, scopeSchema } from './index.mjs';
const capabilities = z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)).max(128)
  .refine(values => new Set(values).size === values.length, 'Duplicate capabilities');
export const directoryEntrySchema = z.object({
  id: sourceIdSchema, providerId: providerIdSchema, name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000), website: publicUrlSchema, descriptorUrl: publicUrlSchema,
  providerSchemaVersion: z.number().int().positive().max(100), scope: scopeSchema,
  capabilities, requiredCapabilities: capabilities,
}).strict().refine(entry => entry.requiredCapabilities.every(value => entry.capabilities.includes(value)), 'Requirements must be advertised capabilities');
// A public catalogue is discovery metadata. It carries no credentials, trusted
// keys, recipes, offers, or authorization. Search happens locally after GET.
export const directorySchema = z.object({
  protocol: z.literal('job-provider-directory'), schemaVersion: z.literal(1),
  directoryId: providerIdSchema, name: z.string().trim().min(1).max(200), website: publicUrlSchema,
  generatedAt: z.iso.datetime(), validUntil: z.iso.datetime(), entries: z.array(directoryEntrySchema).max(128),
}).strict().superRefine((value,context) => {
  const ttl = Date.parse(value.validUntil)-Date.parse(value.generatedAt);
  if (ttl<=0 || ttl>7*86400000) context.addIssue({code:'custom',message:'Directory validity must be at most seven days'});
  if (new Set(value.entries.map(entry=>entry.id)).size!==value.entries.length) context.addIssue({code:'custom',message:'Duplicate directory entry IDs'});
});
export const directoryConnectionSchema = z.object({
  id:sourceIdSchema,name:z.string().trim().min(1).max(200),url:publicUrlSchema,enabled:z.boolean(),
}).strict();
export const directoryConnectionsSchema = z.array(directoryConnectionSchema).max(8)
  .refine(values=>new Set(values.map(value=>value.id)).size===values.length,'Duplicate directory connections')
  .refine(values=>new Set(values.map(value=>new URL(value.url).href)).size===values.length,'Duplicate directory URLs');
/** @param {import('zod').infer<typeof directoryEntrySchema>} entry @param {readonly string[]} supported */
export function directoryCompatibility(entry,supported) {
  const missing=entry.requiredCapabilities.filter(value=>!supported.includes(value));
  const unsupported=entry.capabilities.filter(value=>!supported.includes(value));
  return {status:entry.providerSchemaVersion!==2?'unsupported-version':missing.length?'unsupported':unsupported.length?'partial':'compatible',missing,unsupported};
}
