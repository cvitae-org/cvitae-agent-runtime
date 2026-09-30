import {z} from 'zod';
import {directoryConnectionSchema} from '../../vendor/integration-protocol/directory.mjs';
import {sourceIdSchema,scopeSchema} from '../../vendor/integration-protocol/index.mjs';
export const directoryPayloads={
  'directories.list':z.object({}).strict(),
  'directories.save':directoryConnectionSchema.omit({id:true}).extend({id:sourceIdSchema.optional()}).strict(),
  'directories.remove':z.object({id:sourceIdSchema}).strict(),
  'directories.search':z.object({query:z.string().trim().max(200).default(''),scope:scopeSchema.default({categories:[],markets:[]}),
    capabilities:z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)).max(128).default([]),refresh:z.boolean().default(false)}).strict(),
  'directories.inspect':z.object({id:sourceIdSchema,entryId:sourceIdSchema}).strict(),
};
export type DirectoryInput<K extends keyof typeof directoryPayloads>=z.infer<(typeof directoryPayloads)[K]>;
