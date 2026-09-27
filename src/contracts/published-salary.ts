import { z } from 'zod';
export const publishedSalarySchema = z.object({
 min: z.number().finite().nonnegative().nullable(), max: z.number().finite().nonnegative().nullable(),
 currency: z.string().max(20), period: z.enum(['','hour','day','month','year']),
 contractType: z.string().max(200).optional(), taxBasis: z.string().max(100).optional(), rawText: z.string().max(2000)
}).refine(v=>v.min===null||v.max===null||v.min<=v.max);
export type PublishedSalary = z.infer<typeof publishedSalarySchema>;
