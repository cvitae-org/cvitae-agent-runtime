export const embeddedJsonRecipeSchema: z.ZodObject<{
    kind: z.ZodLiteral<"embedded-json-v1">;
    sourceId: z.ZodString;
    revision: z.ZodString;
    hosts: z.ZodArray<z.ZodString>;
    listing: z.ZodObject<{
        path: z.ZodString;
        pageParameter: z.ZodString;
        keywordParameter: z.ZodString;
    }, z.core.$strict>;
    embedded: z.ZodObject<{
        scriptId: z.ZodString;
        items: z.ZodString;
        page: z.ZodString;
        pages: z.ZodString;
        keywords: z.ZodString;
    }, z.core.$strict>;
    fields: z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        company: z.ZodString;
        location: z.ZodObject<{
            items: z.ZodString;
            value: z.ZodString;
        }, z.core.$strict>;
        skills: z.ZodString;
        postedAt: z.ZodString;
        assumeUTC: z.ZodBoolean;
        workModes: z.ZodString;
        workModeValues: z.ZodRecord<z.ZodString, z.ZodEnum<{
            remote: "remote";
            hybrid: "hybrid";
            onsite: "onsite";
        }>>;
    }, z.core.$strict>;
    offer: z.ZodObject<{
        pathPrefix: z.ZodString;
        slug: z.ZodString;
        idSuffix: z.ZodString;
        idFormat: z.ZodLiteral<"uuid">;
    }, z.core.$strict>;
    salaries: z.ZodObject<{
        items: z.ZodString;
        min: z.ZodString;
        max: z.ZodString;
        currencies: z.ZodArray<z.ZodString>;
        period: z.ZodString;
        contractId: z.ZodString;
        contractName: z.ZodString;
        tax: z.ZodArray<z.ZodString>;
        contractValues: z.ZodRecord<z.ZodString, z.ZodString>;
        contractAliases: z.ZodRecord<z.ZodString, z.ZodString>;
        currencyValues: z.ZodRecord<z.ZodString, z.ZodString>;
        periodValues: z.ZodRecord<z.ZodString, z.ZodEnum<{
            hour: "hour";
            day: "day";
            month: "month";
            year: "year";
        }>>;
    }, z.core.$strict>;
}, z.core.$strict>;
import { z } from 'zod';
