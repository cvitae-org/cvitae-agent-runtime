export const selectorSchema: z.ZodString;
export const domFieldSchema: z.ZodObject<{
    selector: z.ZodString;
    attribute: z.ZodOptional<z.ZodString>;
    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strict>;
export const domListingRecipeSchema: z.ZodObject<{
    kind: z.ZodLiteral<"dom-listing-v1">;
    listing: z.ZodObject<{
        path: z.ZodString;
        pageParameter: z.ZodString;
        keywordParameter: z.ZodString;
    }, z.core.$strict>;
    root: z.ZodString;
    items: z.ZodString;
    fields: z.ZodObject<{
        company: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        location: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        salary: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        contract_type: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        employment_type: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        seniority: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        posted_at: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        valid_through: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        apply_url: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        work_mode: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        external_id: z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
        title: z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
        url: z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>;
    pagination: z.ZodObject<{
        page: z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
        pages: z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
        keyword: z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
        empty: z.ZodString;
        maxPages: z.ZodNumber;
    }, z.core.$strict>;
    sourceId: z.ZodString;
    revision: z.ZodString;
    hosts: z.ZodArray<z.ZodString>;
    offer: z.ZodObject<{
        pathPrefix: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export const domDetailRecipeSchema: z.ZodObject<{
    kind: z.ZodLiteral<"dom-detail-v1">;
    root: z.ZodString;
    fields: z.ZodObject<{
        company: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        location: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        salary: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        contract_type: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        employment_type: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        seniority: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        posted_at: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        valid_through: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        apply_url: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        work_mode: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
        external_id: z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
        title: z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
        url: z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
        description: z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
        required_skills: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            attribute: z.ZodOptional<z.ZodString>;
            values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    sourceId: z.ZodString;
    revision: z.ZodString;
    hosts: z.ZodArray<z.ZodString>;
    offer: z.ZodObject<{
        pathPrefix: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
import { z } from 'zod';
