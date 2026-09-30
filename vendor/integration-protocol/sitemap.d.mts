export const sitemapRecipeSchema: z.ZodObject<{
    kind: z.ZodLiteral<"sitemap-v1">;
    sourceId: z.ZodString;
    revision: z.ZodString;
    hosts: z.ZodArray<z.ZodString>;
    offer: z.ZodObject<{
        pathPrefix: z.ZodString;
    }, z.core.$strict>;
    seeds: z.ZodArray<z.ZodString>;
    maxDocuments: z.ZodNumber;
    maxDepth: z.ZodNumber;
    maxUrls: z.ZodNumber;
}, z.core.$strict>;
import { z } from 'zod';
