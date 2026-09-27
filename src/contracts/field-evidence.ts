import { z } from 'zod';
export const publishedExtractorVersion='published-fields-v2';
export const fieldEvidenceSchema=z.object({status:z.enum(['stated','not_stated','ambiguous']),method:z.enum(['jsonld','embedded','labelled','text']),sourceUrl:z.string().max(10000),capturedAt:z.string().max(100),contentHash:z.string().max(100),extractorVersion:z.string().max(100),quote:z.string().max(10000).optional(),path:z.string().max(1000).optional(),candidates:z.array(z.object({value:z.string().max(10000),quote:z.string().max(10000).optional(),path:z.string().max(1000).optional()})).max(100).optional()});
export const fieldEvidenceMapSchema=z.record(z.string().max(100),fieldEvidenceSchema);
export type FieldEvidence=z.infer<typeof fieldEvidenceSchema>;
