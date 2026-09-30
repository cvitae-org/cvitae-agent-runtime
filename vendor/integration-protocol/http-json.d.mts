export const httpJsonRecipeSchema: z.ZodObject<{
    kind: z.ZodLiteral<"http-json-v1">;
    sourceId: z.ZodString;
    revision: z.ZodString;
    hosts: z.ZodArray<z.ZodString>;
    request: z.ZodObject<{
        url: z.ZodString;
        apiVersion: z.ZodOptional<z.ZodString>;
        query: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodObject<{
            value: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            input: z.ZodEnum<{
                page: "page";
                keyword: "keyword";
            }>;
        }, z.core.$strict>]>>;
    }, z.core.$strict>;
    itemsPointer: z.ZodString;
    pagination: z.ZodObject<{
        pagePointer: z.ZodString;
        totalPagesPointer: z.ZodString;
        startPage: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
        maxPages: z.ZodNumber;
    }, z.core.$strict>;
    fields: z.ZodObject<{
        title: z.ZodObject<{
            pointer: z.ZodString;
            operation: z.ZodEnum<{
                date: "date";
                url: "url";
                join: "join";
                text: "text";
            }>;
            required: z.ZodBoolean;
        }, z.core.$strict>;
        url: z.ZodObject<{
            pointer: z.ZodString;
            operation: z.ZodEnum<{
                date: "date";
                url: "url";
                join: "join";
                text: "text";
            }>;
            required: z.ZodBoolean;
        }, z.core.$strict>;
        external_id: z.ZodObject<{
            pointer: z.ZodString;
            operation: z.ZodEnum<{
                date: "date";
                url: "url";
                join: "join";
                text: "text";
            }>;
            required: z.ZodBoolean;
        }, z.core.$strict>;
        company: z.ZodOptional<z.ZodObject<{
            pointer: z.ZodString;
            operation: z.ZodEnum<{
                date: "date";
                url: "url";
                join: "join";
                text: "text";
            }>;
            required: z.ZodBoolean;
        }, z.core.$strict>>;
        description: z.ZodOptional<z.ZodObject<{
            pointer: z.ZodString;
            operation: z.ZodEnum<{
                date: "date";
                url: "url";
                join: "join";
                text: "text";
            }>;
            required: z.ZodBoolean;
        }, z.core.$strict>>;
        location: z.ZodOptional<z.ZodObject<{
            pointer: z.ZodString;
            operation: z.ZodEnum<{
                date: "date";
                url: "url";
                join: "join";
                text: "text";
            }>;
            required: z.ZodBoolean;
        }, z.core.$strict>>;
        employment_type: z.ZodOptional<z.ZodObject<{
            pointer: z.ZodString;
            operation: z.ZodEnum<{
                date: "date";
                url: "url";
                join: "join";
                text: "text";
            }>;
            required: z.ZodBoolean;
        }, z.core.$strict>>;
        posted_at: z.ZodOptional<z.ZodObject<{
            pointer: z.ZodString;
            operation: z.ZodEnum<{
                date: "date";
                url: "url";
                join: "join";
                text: "text";
            }>;
            required: z.ZodBoolean;
        }, z.core.$strict>>;
        valid_through: z.ZodOptional<z.ZodObject<{
            pointer: z.ZodString;
            operation: z.ZodEnum<{
                date: "date";
                url: "url";
                join: "join";
                text: "text";
            }>;
            required: z.ZodBoolean;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    eligibility: z.ZodOptional<z.ZodObject<{
        locationsPointer: z.ZodString;
        allowedLocations: z.ZodArray<z.ZodString>;
        normalize: z.ZodLiteral<"latin-fold">;
    }, z.core.$strict>>;
    workMode: z.ZodOptional<z.ZodObject<{
        remotePointer: z.ZodString;
        hybridPointer: z.ZodString;
    }, z.core.$strict>>;
    skills: z.ZodOptional<z.ZodObject<{
        itemsPointer: z.ZodString;
        namePointer: z.ZodString;
        exclude: z.ZodOptional<z.ZodObject<{
            pointer: z.ZodString;
            value: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    salaries: z.ZodOptional<z.ZodObject<{
        pointers: z.ZodArray<z.ZodString>;
        minPointer: z.ZodString;
        maxPointer: z.ZodString;
        currencyPointer: z.ZodString;
        periodPointer: z.ZodString;
        contractPointer: z.ZodString;
        periods: z.ZodRecord<z.ZodString, z.ZodEnum<{
            hour: "hour";
            day: "day";
            month: "month";
            year: "year";
        }>>;
        contracts: z.ZodRecord<z.ZodString, z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
import { z } from 'zod';
