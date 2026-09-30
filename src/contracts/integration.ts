import { z } from 'zod';
import { discoveryBoardIdSchema } from './discovery-board.js';

export const integrationReferenceSchema = z.object({
  connectionId: discoveryBoardIdSchema, providerId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/), sourceId: discoveryBoardIdSchema,
}).strict();
export const integrationProvenanceSchema = integrationReferenceSchema.extend({
  sourceKey: discoveryBoardIdSchema, recipeRevision: z.string().min(1).max(2000),
  releaseRevision: z.string().min(1).max(2000), releaseSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  engine: z.enum(['http-json-v1', 'embedded-json-v1', 'dom-listing-v1', 'dom-detail-v1', 'page-listing-v1', 'dom-detail-v2', 'sitemap-v1']), engineVersion: z.literal('1'),
  recipeHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type IntegrationReference = z.infer<typeof integrationReferenceSchema>;
export type IntegrationProvenance = z.infer<typeof integrationProvenanceSchema>;
/** Trusted local execution context; never supplied by an offer or a browser page. */
export type IntegrationExecution = { provenance: IntegrationProvenance; recipe: Record<string, unknown> };
export const integrationAcquisitionSchema = z.object({ provenance: integrationProvenanceSchema,
  firstRetrievedAt: z.string().datetime(), lastRetrievedAt: z.string().datetime(), firstSeenAt: z.number(), lastSeenAt: z.number(),
}).strict();
export type IntegrationAcquisition = z.infer<typeof integrationAcquisitionSchema>;
