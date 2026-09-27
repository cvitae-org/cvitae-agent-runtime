import { discoveryBoardIdSchema, maxDiscoveryBoards } from './discovery-board.js';
import { z } from 'zod';

/** Model output is data only. Scope/run IDs and SQL never come from a model. */
export const discoveryQuerySchema = z.object({
  mode: z.enum(['search', 'compare', 'count', 'group', 'salary', 'help', 'clarify']),
  termGroups: z.array(z.array(z.string().trim().min(1).max(80)).min(1).max(4)).max(6),
  references: z.array(z.number().int().min(1).max(12)).max(12),
  sources: z.array(discoveryBoardIdSchema).max(maxDiscoveryBoards),
  contracts: z.array(z.string().trim().min(1).max(80)).max(5),
  workMode: z.enum(['remote', 'hybrid', 'onsite']).nullable(),
  minimum: z.number().nonnegative().nullable(),
  maximum: z.number().nonnegative().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  period: z.enum(['hour', 'day', 'month', 'year']).nullable(),
  groupBy: z.enum(['company', 'source', 'contract', 'workMode']).nullable(),
  sort: z.enum(['relevance', 'salaryDescending']),
  clarification: z.string().max(600).nullable()
}).strict().refine(v => v.minimum === null || v.maximum === null || v.minimum <= v.maximum, 'Invalid salary range');
export type DiscoveryQuery = z.infer<typeof discoveryQuerySchema>;
export const emptyDiscoveryQuery = (): DiscoveryQuery => ({ mode: 'search', termGroups: [], references: [], sources: [], contracts: [], workMode: null, minimum: null, maximum: null, currency: null, period: null, groupBy: null, sort: 'relevance', clarification: null });
