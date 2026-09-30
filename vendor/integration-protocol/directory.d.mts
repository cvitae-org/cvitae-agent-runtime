/** @param {import('zod').infer<typeof directoryEntrySchema>} entry @param {readonly string[]} supported */
export function directoryCompatibility(entry: import("zod").infer<typeof directoryEntrySchema>, supported: readonly string[]): {
    status: string;
    missing: string[];
    unsupported: string[];
};
export const directoryEntrySchema: z.ZodObject<{
    id: z.ZodString;
    providerId: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    website: z.ZodString;
    descriptorUrl: z.ZodString;
    providerSchemaVersion: z.ZodNumber;
    scope: z.ZodObject<{
        categories: z.ZodArray<z.ZodString>;
        markets: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    capabilities: z.ZodArray<z.ZodString>;
    requiredCapabilities: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export const directorySchema: z.ZodObject<{
    protocol: z.ZodLiteral<"job-provider-directory">;
    schemaVersion: z.ZodLiteral<1>;
    directoryId: z.ZodString;
    name: z.ZodString;
    website: z.ZodString;
    generatedAt: z.ZodISODateTime;
    validUntil: z.ZodISODateTime;
    entries: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        providerId: z.ZodString;
        name: z.ZodString;
        description: z.ZodString;
        website: z.ZodString;
        descriptorUrl: z.ZodString;
        providerSchemaVersion: z.ZodNumber;
        scope: z.ZodObject<{
            categories: z.ZodArray<z.ZodString>;
            markets: z.ZodArray<z.ZodString>;
        }, z.core.$strict>;
        capabilities: z.ZodArray<z.ZodString>;
        requiredCapabilities: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export const directoryConnectionSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    url: z.ZodString;
    enabled: z.ZodBoolean;
}, z.core.$strict>;
export const directoryConnectionsSchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    url: z.ZodString;
    enabled: z.ZodBoolean;
}, z.core.$strict>>;
import { z } from 'zod';
