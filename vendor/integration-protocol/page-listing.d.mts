export const listingRouteSchema: z.ZodObject<{
    path: z.ZodString;
    keyword: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"query">;
        parameter: z.ZodString;
        prefix: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"path">;
        suffix: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"taxonomy">;
        segment: z.ZodString;
        entries: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodString;
            label: z.ZodString;
            aliases: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        neutral: z.ZodArray<z.ZodString>;
        complex: z.ZodArray<z.ZodString>;
        filtersPointer: z.ZodString;
        valuePointer: z.ZodString;
    }, z.core.$strict>], "kind">;
    page: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"query">;
        parameter: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"segment">;
        prefix: z.ZodString;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>;
export const pageListingRecipeSchema: z.ZodObject<{
    kind: z.ZodLiteral<"page-listing-v1">;
    sourceId: z.ZodString;
    revision: z.ZodString;
    hosts: z.ZodArray<z.ZodString>;
    offer: z.ZodObject<{
        pathPrefix: z.ZodString;
    }, z.core.$strict>;
    identity: z.ZodObject<{
        part: z.ZodEnum<{
            prefix: "prefix";
            segment: "segment";
            suffix: "suffix";
        }>;
        delimiter: z.ZodOptional<z.ZodString>;
        format: z.ZodEnum<{
            slug: "slug";
            uuid: "uuid";
            integer: "integer";
        }>;
    }, z.core.$strict>;
    listing: z.ZodObject<{
        path: z.ZodString;
        keyword: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"query">;
            parameter: z.ZodString;
            prefix: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"path">;
            suffix: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"taxonomy">;
            segment: z.ZodString;
            entries: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                value: z.ZodString;
                label: z.ZodString;
                aliases: z.ZodArray<z.ZodString>;
            }, z.core.$strict>>;
            neutral: z.ZodArray<z.ZodString>;
            complex: z.ZodArray<z.ZodString>;
            filtersPointer: z.ZodString;
            valuePointer: z.ZodString;
        }, z.core.$strict>], "kind">;
        page: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"query">;
            parameter: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"segment">;
            prefix: z.ZodString;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>;
    data: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"embedded">;
        scriptId: z.ZodString;
        items: z.ZodString;
        slug: z.ZodString;
        fields: z.ZodObject<{
            title: z.ZodObject<{
                pointer: z.ZodString;
                parts: z.ZodOptional<z.ZodArray<z.ZodString>>;
                when: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>>;
                items: z.ZodOptional<z.ZodString>;
                where: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>;
                flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    when: z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                        greaterThan: z.ZodOptional<z.ZodNumber>;
                        lessThan: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>>;
                    value: z.ZodString;
                }, z.core.$strict>>>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                format: z.ZodOptional<z.ZodEnum<{
                    text: "text";
                    html: "html";
                    timestamp: "timestamp";
                    "unix-ms": "unix-ms";
                }>>;
            }, z.core.$strict>;
            company: z.ZodOptional<z.ZodObject<{
                pointer: z.ZodString;
                parts: z.ZodOptional<z.ZodArray<z.ZodString>>;
                when: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>>;
                items: z.ZodOptional<z.ZodString>;
                where: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>;
                flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    when: z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                        greaterThan: z.ZodOptional<z.ZodNumber>;
                        lessThan: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>>;
                    value: z.ZodString;
                }, z.core.$strict>>>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                format: z.ZodOptional<z.ZodEnum<{
                    text: "text";
                    html: "html";
                    timestamp: "timestamp";
                    "unix-ms": "unix-ms";
                }>>;
            }, z.core.$strict>>;
            location: z.ZodOptional<z.ZodObject<{
                pointer: z.ZodString;
                parts: z.ZodOptional<z.ZodArray<z.ZodString>>;
                when: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>>;
                items: z.ZodOptional<z.ZodString>;
                where: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>;
                flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    when: z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                        greaterThan: z.ZodOptional<z.ZodNumber>;
                        lessThan: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>>;
                    value: z.ZodString;
                }, z.core.$strict>>>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                format: z.ZodOptional<z.ZodEnum<{
                    text: "text";
                    html: "html";
                    timestamp: "timestamp";
                    "unix-ms": "unix-ms";
                }>>;
            }, z.core.$strict>>;
            salary: z.ZodOptional<z.ZodObject<{
                pointer: z.ZodString;
                parts: z.ZodOptional<z.ZodArray<z.ZodString>>;
                when: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>>;
                items: z.ZodOptional<z.ZodString>;
                where: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>;
                flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    when: z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                        greaterThan: z.ZodOptional<z.ZodNumber>;
                        lessThan: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>>;
                    value: z.ZodString;
                }, z.core.$strict>>>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                format: z.ZodOptional<z.ZodEnum<{
                    text: "text";
                    html: "html";
                    timestamp: "timestamp";
                    "unix-ms": "unix-ms";
                }>>;
            }, z.core.$strict>>;
            contract_type: z.ZodOptional<z.ZodObject<{
                pointer: z.ZodString;
                parts: z.ZodOptional<z.ZodArray<z.ZodString>>;
                when: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>>;
                items: z.ZodOptional<z.ZodString>;
                where: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>;
                flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    when: z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                        greaterThan: z.ZodOptional<z.ZodNumber>;
                        lessThan: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>>;
                    value: z.ZodString;
                }, z.core.$strict>>>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                format: z.ZodOptional<z.ZodEnum<{
                    text: "text";
                    html: "html";
                    timestamp: "timestamp";
                    "unix-ms": "unix-ms";
                }>>;
            }, z.core.$strict>>;
            employment_type: z.ZodOptional<z.ZodObject<{
                pointer: z.ZodString;
                parts: z.ZodOptional<z.ZodArray<z.ZodString>>;
                when: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>>;
                items: z.ZodOptional<z.ZodString>;
                where: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>;
                flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    when: z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                        greaterThan: z.ZodOptional<z.ZodNumber>;
                        lessThan: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>>;
                    value: z.ZodString;
                }, z.core.$strict>>>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                format: z.ZodOptional<z.ZodEnum<{
                    text: "text";
                    html: "html";
                    timestamp: "timestamp";
                    "unix-ms": "unix-ms";
                }>>;
            }, z.core.$strict>>;
            required_skills: z.ZodOptional<z.ZodObject<{
                pointer: z.ZodString;
                parts: z.ZodOptional<z.ZodArray<z.ZodString>>;
                when: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>>;
                items: z.ZodOptional<z.ZodString>;
                where: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>;
                flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    when: z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                        greaterThan: z.ZodOptional<z.ZodNumber>;
                        lessThan: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>>;
                    value: z.ZodString;
                }, z.core.$strict>>>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                format: z.ZodOptional<z.ZodEnum<{
                    text: "text";
                    html: "html";
                    timestamp: "timestamp";
                    "unix-ms": "unix-ms";
                }>>;
            }, z.core.$strict>>;
            work_mode: z.ZodOptional<z.ZodObject<{
                pointer: z.ZodString;
                parts: z.ZodOptional<z.ZodArray<z.ZodString>>;
                when: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>>;
                items: z.ZodOptional<z.ZodString>;
                where: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>;
                flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    when: z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                        greaterThan: z.ZodOptional<z.ZodNumber>;
                        lessThan: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>>;
                    value: z.ZodString;
                }, z.core.$strict>>>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                format: z.ZodOptional<z.ZodEnum<{
                    text: "text";
                    html: "html";
                    timestamp: "timestamp";
                    "unix-ms": "unix-ms";
                }>>;
            }, z.core.$strict>>;
            posted_at: z.ZodOptional<z.ZodObject<{
                pointer: z.ZodString;
                parts: z.ZodOptional<z.ZodArray<z.ZodString>>;
                when: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>>;
                items: z.ZodOptional<z.ZodString>;
                where: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                    greaterThan: z.ZodOptional<z.ZodNumber>;
                    lessThan: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>;
                flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    when: z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        equals: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>>;
                        greaterThan: z.ZodOptional<z.ZodNumber>;
                        lessThan: z.ZodOptional<z.ZodNumber>;
                    }, z.core.$strict>>;
                    value: z.ZodString;
                }, z.core.$strict>>>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                format: z.ZodOptional<z.ZodEnum<{
                    text: "text";
                    html: "html";
                    timestamp: "timestamp";
                    "unix-ms": "unix-ms";
                }>>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        page: z.ZodOptional<z.ZodString>;
        pages: z.ZodOptional<z.ZodString>;
        total: z.ZodOptional<z.ZodString>;
        pageSize: z.ZodOptional<z.ZodString>;
        acknowledgement: z.ZodEnum<{
            optional: "optional";
            required: "required";
        }>;
        keyword: z.ZodOptional<z.ZodString>;
        salaries: z.ZodOptional<z.ZodArray<z.ZodObject<{
            pointer: z.ZodString;
            array: z.ZodBoolean;
            min: z.ZodOptional<z.ZodString>;
            max: z.ZodOptional<z.ZodString>;
            range: z.ZodOptional<z.ZodString>;
            currency: z.ZodArray<z.ZodString>;
            period: z.ZodString;
            contract: z.ZodObject<{
                pointer: z.ZodOptional<z.ZodString>;
                value: z.ZodOptional<z.ZodString>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
            tax: z.ZodArray<z.ZodString>;
            hidden: z.ZodOptional<z.ZodString>;
            when: z.ZodArray<z.ZodObject<{
                pointer: z.ZodString;
                equals: z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"dom">;
        root: z.ZodString;
        items: z.ZodString;
        title: z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            text: z.ZodOptional<z.ZodArray<z.ZodString>>;
            steps: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                parent: "parent";
                next: "next";
                following: "following";
                children: "children";
            }>>>;
            within: z.ZodOptional<z.ZodString>;
            firstChild: z.ZodOptional<z.ZodBoolean>;
            omit: z.ZodOptional<z.ZodArray<z.ZodString>>;
            attribute: z.ZodOptional<z.ZodEnum<{
                href: "href";
                content: "content";
                datetime: "datetime";
            }>>;
        }, z.core.$strict>>;
        url: z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            text: z.ZodOptional<z.ZodArray<z.ZodString>>;
            steps: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                parent: "parent";
                next: "next";
                following: "following";
                children: "children";
            }>>>;
            within: z.ZodOptional<z.ZodString>;
            firstChild: z.ZodOptional<z.ZodBoolean>;
            omit: z.ZodOptional<z.ZodArray<z.ZodString>>;
            attribute: z.ZodOptional<z.ZodEnum<{
                href: "href";
                content: "content";
                datetime: "datetime";
            }>>;
        }, z.core.$strict>>;
        paginationLinks: z.ZodOptional<z.ZodString>;
        empty: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>], "kind">;
    maxPages: z.ZodNumber;
}, z.core.$strict>;
import { z } from 'zod';
