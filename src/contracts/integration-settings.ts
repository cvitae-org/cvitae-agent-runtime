import { z } from 'zod';
import { descriptorSchema, scopeSchema, sourceIdSchema, publicUrlSchema } from '../../vendor/integration-protocol/index.mjs';

const id = sourceIdSchema;
export const integrationPayloads = {
  'integrations.list': z.object({}).strict(),
  'integrations.inspect': z.object({ url: publicUrlSchema.optional(), descriptor: descriptorSchema.optional() }).strict()
    .refine(value => !!value.url !== !!value.descriptor, 'Supply a descriptor URL or descriptor JSON.'),
  'integrations.save': z.object({ id: id.optional(), inspectionId: z.string().uuid(), trusted: z.literal(true),
    name: z.string().trim().min(1).max(200), scope: scopeSchema, priority: z.number().int().min(0).max(10000) }).strict(),
  'integrations.configure': z.object({ id, name: z.string().trim().min(1).max(200), scope: scopeSchema,
    priority: z.number().int().min(0).max(10000) }).strict(),
  'integrations.enabled': z.object({ id, enabled: z.boolean() }).strict(),
  'integrations.remove': z.object({ id }).strict(),
  'integrations.refresh': z.object({ id }).strict(),
  'integrations.secret': z.object({ id, token: z.string().max(4096).regex(/^[-._~+/A-Za-z0-9]+=*$/).nullable() }).strict(),
  'integrations.icon': z.object({ sourceKey: id }).strict(),
};
export type IntegrationInput<K extends keyof typeof integrationPayloads> = z.infer<(typeof integrationPayloads)[K]>;
