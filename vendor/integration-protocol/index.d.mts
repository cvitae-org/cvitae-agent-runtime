export const protocol: "job-integrations";
export const sourceIdSchema: z.ZodString;
export const providerIdSchema: z.ZodString;
export const hostSchema: z.ZodString;
export const publicUrlSchema: z.ZodString;
export const scopeSchema: z.ZodObject<{
    categories: z.ZodArray<z.ZodString>;
    markets: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export const publicKeysSchema: z.ZodRecord<z.ZodString, z.ZodString>;
export const descriptorSchema: z.ZodObject<{
    protocol: z.ZodLiteral<"job-integrations">;
    schemaVersion: z.ZodLiteral<2>;
    providerId: z.ZodString;
    name: z.ZodString;
    website: z.ZodString;
    resolveUrl: z.ZodString;
    authentication: z.ZodEnum<{
        none: "none";
        bearer: "bearer";
    }>;
    capabilities: z.ZodArray<z.ZodString>;
    scope: z.ZodObject<{
        categories: z.ZodArray<z.ZodString>;
        markets: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    signing: z.ZodObject<{
        algorithm: z.ZodLiteral<"Ed25519">;
        publicKeys: z.ZodRecord<z.ZodString, z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
export const resolveSchema: z.ZodObject<{
    protocol: z.ZodLiteral<"job-integrations">;
    schemaVersion: z.ZodLiteral<2>;
    client: z.ZodObject<{
        id: z.ZodString;
        version: z.ZodString;
    }, z.core.$strict>;
    capabilities: z.ZodArray<z.ZodString>;
    scope: z.ZodObject<{
        categories: z.ZodArray<z.ZodString>;
        markets: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    knownRevision: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export const healthSchema: z.ZodObject<{
    status: z.ZodEnum<{
        unverified: "unverified";
        validated: "validated";
        empty: "empty";
        reachable: "reachable";
        blocked: "blocked";
        "rate-limited": "rate-limited";
        drift: "drift";
        unavailable: "unavailable";
        "not-probed": "not-probed";
    }>;
    detail: z.ZodString;
    checkedAt: z.ZodNullable<z.ZodISODateTime>;
    lastSuccessAt: z.ZodNullable<z.ZodISODateTime>;
    environment: z.ZodString;
    recipeRevision: z.ZodString;
}, z.core.$strict>;
export const sourceSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    website: z.ZodString;
    hosts: z.ZodArray<z.ZodString>;
    categories: z.ZodArray<z.ZodString>;
    markets: z.ZodArray<z.ZodString>;
    revision: z.ZodString;
    modes: z.ZodArray<z.ZodEnum<{
        "external-link": "external-link";
        "http-json-v1": "http-json-v1";
        "embedded-json-v1": "embedded-json-v1";
        "dom-listing-v1": "dom-listing-v1";
        "dom-detail-v1": "dom-detail-v1";
        "dom-detail-v2": "dom-detail-v2";
        "page-listing-v1": "page-listing-v1";
        "sitemap-v1": "sitemap-v1";
    }>>;
    defaultSelected: z.ZodBoolean;
    routes: z.ZodObject<{
        listing: z.ZodString;
        offerPathPrefix: z.ZodNullable<z.ZodString>;
        search: z.ZodObject<{
            kind: z.ZodEnum<{
                query: "query";
                browse: "browse";
            }>;
            parameter: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>;
    }, z.core.$strict>;
    recipe: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
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
    }, z.core.$strict>]>>;
    browserRecipe: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
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
    }, z.core.$strict>]>>;
    detailRecipe: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"dom-detail-v2">;
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
        root: z.ZodString;
        exclude: z.ZodArray<z.ZodString>;
        fields: z.ZodObject<{
            title: z.ZodObject<{
                rules: z.ZodArray<z.ZodObject<{
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
                multiple: z.ZodOptional<z.ZodBoolean>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>;
            company: z.ZodOptional<z.ZodObject<{
                rules: z.ZodArray<z.ZodObject<{
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
                multiple: z.ZodOptional<z.ZodBoolean>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>>;
            location: z.ZodOptional<z.ZodObject<{
                rules: z.ZodArray<z.ZodObject<{
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
                multiple: z.ZodOptional<z.ZodBoolean>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>>;
            work_mode: z.ZodOptional<z.ZodObject<{
                rules: z.ZodArray<z.ZodObject<{
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
                multiple: z.ZodOptional<z.ZodBoolean>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>>;
            contract_type: z.ZodOptional<z.ZodObject<{
                rules: z.ZodArray<z.ZodObject<{
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
                multiple: z.ZodOptional<z.ZodBoolean>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>>;
            employment_type: z.ZodOptional<z.ZodObject<{
                rules: z.ZodArray<z.ZodObject<{
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
                multiple: z.ZodOptional<z.ZodBoolean>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>>;
            seniority: z.ZodOptional<z.ZodObject<{
                rules: z.ZodArray<z.ZodObject<{
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
                multiple: z.ZodOptional<z.ZodBoolean>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>>;
            company_size: z.ZodOptional<z.ZodObject<{
                rules: z.ZodArray<z.ZodObject<{
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
                multiple: z.ZodOptional<z.ZodBoolean>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>>;
            start_date: z.ZodOptional<z.ZodObject<{
                rules: z.ZodArray<z.ZodObject<{
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
                multiple: z.ZodOptional<z.ZodBoolean>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        sections: z.ZodArray<z.ZodArray<z.ZodObject<{
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
        }, z.core.$strict>>>;
        skills: z.ZodOptional<z.ZodArray<z.ZodObject<{
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
        }, z.core.$strict>>>;
        salaries: z.ZodOptional<z.ZodArray<z.ZodObject<{
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
        }, z.core.$strict>>>;
        embedded: z.ZodOptional<z.ZodObject<{
            scriptId: z.ZodString;
            object: z.ZodString;
            slug: z.ZodString;
            checks: z.ZodArray<z.ZodObject<{
                pointer: z.ZodString;
                equals: z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>;
            }, z.core.$strict>>;
            fields: z.ZodObject<{
                title: z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>;
                company: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                location: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                work_mode: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                contract_type: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                employment_type: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                seniority: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                posted_at: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                valid_through: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                required_skills: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                apply_url: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                start_date: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                company_type: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                company_size: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
                engagement_length: z.ZodOptional<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            sections: z.ZodArray<z.ZodObject<{
                pointer: z.ZodString;
                flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    value: z.ZodString;
                }, z.core.$strict>>>;
                items: z.ZodOptional<z.ZodString>;
                join: z.ZodOptional<z.ZodString>;
                values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                format: z.ZodOptional<z.ZodEnum<{
                    text: "text";
                    html: "html";
                    timestamp: "timestamp";
                    "utc-timestamp": "utc-timestamp";
                }>>;
            }, z.core.$strict>>;
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
        }, z.core.$strict>>;
        jsonLd: z.ZodBoolean;
    }, z.core.$strict>]>>;
    routing: z.ZodOptional<z.ZodArray<z.ZodObject<{
        host: z.ZodString;
        kind: z.ZodEnum<{
            board: "board";
            ats: "ats";
            social: "social";
            directory: "directory";
        }>;
    }, z.core.$strict>>>;
    presentation: z.ZodObject<{
        icon: z.ZodOptional<z.ZodObject<{
            url: z.ZodString;
            sha256: z.ZodString;
            mimeType: z.ZodEnum<{
                "image/png": "image/png";
                "image/webp": "image/webp";
            }>;
            byteLength: z.ZodNumber;
        }, z.core.$strict>>;
        attribution: z.ZodArray<z.ZodObject<{
            text: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    health: z.ZodObject<{
        status: z.ZodEnum<{
            unverified: "unverified";
            validated: "validated";
            empty: "empty";
            reachable: "reachable";
            blocked: "blocked";
            "rate-limited": "rate-limited";
            drift: "drift";
            unavailable: "unavailable";
            "not-probed": "not-probed";
        }>;
        detail: z.ZodString;
        checkedAt: z.ZodNullable<z.ZodISODateTime>;
        lastSuccessAt: z.ZodNullable<z.ZodISODateTime>;
        environment: z.ZodString;
        recipeRevision: z.ZodString;
    }, z.core.$strict>;
    limitations: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export const snapshotSchema: z.ZodObject<{
    protocol: z.ZodLiteral<"job-integrations">;
    schemaVersion: z.ZodLiteral<2>;
    providerId: z.ZodString;
    scope: z.ZodObject<{
        categories: z.ZodArray<z.ZodString>;
        markets: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    releaseSequence: z.ZodNumber;
    revision: z.ZodString;
    publishedAt: z.ZodISODateTime;
    validUntil: z.ZodISODateTime;
    refreshAfterSeconds: z.ZodNumber;
    sources: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        website: z.ZodString;
        hosts: z.ZodArray<z.ZodString>;
        categories: z.ZodArray<z.ZodString>;
        markets: z.ZodArray<z.ZodString>;
        revision: z.ZodString;
        modes: z.ZodArray<z.ZodEnum<{
            "external-link": "external-link";
            "http-json-v1": "http-json-v1";
            "embedded-json-v1": "embedded-json-v1";
            "dom-listing-v1": "dom-listing-v1";
            "dom-detail-v1": "dom-detail-v1";
            "dom-detail-v2": "dom-detail-v2";
            "page-listing-v1": "page-listing-v1";
            "sitemap-v1": "sitemap-v1";
        }>>;
        defaultSelected: z.ZodBoolean;
        routes: z.ZodObject<{
            listing: z.ZodString;
            offerPathPrefix: z.ZodNullable<z.ZodString>;
            search: z.ZodObject<{
                kind: z.ZodEnum<{
                    query: "query";
                    browse: "browse";
                }>;
                parameter: z.ZodNullable<z.ZodString>;
            }, z.core.$strict>;
        }, z.core.$strict>;
        recipe: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
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
        }, z.core.$strict>]>>;
        browserRecipe: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
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
        }, z.core.$strict>]>>;
        detailRecipe: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"dom-detail-v2">;
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
            root: z.ZodString;
            exclude: z.ZodArray<z.ZodString>;
            fields: z.ZodObject<{
                title: z.ZodObject<{
                    rules: z.ZodArray<z.ZodObject<{
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
                    multiple: z.ZodOptional<z.ZodBoolean>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strict>;
                company: z.ZodOptional<z.ZodObject<{
                    rules: z.ZodArray<z.ZodObject<{
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
                    multiple: z.ZodOptional<z.ZodBoolean>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strict>>;
                location: z.ZodOptional<z.ZodObject<{
                    rules: z.ZodArray<z.ZodObject<{
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
                    multiple: z.ZodOptional<z.ZodBoolean>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strict>>;
                work_mode: z.ZodOptional<z.ZodObject<{
                    rules: z.ZodArray<z.ZodObject<{
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
                    multiple: z.ZodOptional<z.ZodBoolean>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strict>>;
                contract_type: z.ZodOptional<z.ZodObject<{
                    rules: z.ZodArray<z.ZodObject<{
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
                    multiple: z.ZodOptional<z.ZodBoolean>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strict>>;
                employment_type: z.ZodOptional<z.ZodObject<{
                    rules: z.ZodArray<z.ZodObject<{
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
                    multiple: z.ZodOptional<z.ZodBoolean>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strict>>;
                seniority: z.ZodOptional<z.ZodObject<{
                    rules: z.ZodArray<z.ZodObject<{
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
                    multiple: z.ZodOptional<z.ZodBoolean>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strict>>;
                company_size: z.ZodOptional<z.ZodObject<{
                    rules: z.ZodArray<z.ZodObject<{
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
                    multiple: z.ZodOptional<z.ZodBoolean>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strict>>;
                start_date: z.ZodOptional<z.ZodObject<{
                    rules: z.ZodArray<z.ZodObject<{
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
                    multiple: z.ZodOptional<z.ZodBoolean>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            sections: z.ZodArray<z.ZodArray<z.ZodObject<{
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
            }, z.core.$strict>>>;
            skills: z.ZodOptional<z.ZodArray<z.ZodObject<{
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
            }, z.core.$strict>>>;
            salaries: z.ZodOptional<z.ZodArray<z.ZodObject<{
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
            }, z.core.$strict>>>;
            embedded: z.ZodOptional<z.ZodObject<{
                scriptId: z.ZodString;
                object: z.ZodString;
                slug: z.ZodString;
                checks: z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    equals: z.ZodUnion<readonly [z.ZodString, z.ZodBoolean]>;
                }, z.core.$strict>>;
                fields: z.ZodObject<{
                    title: z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>;
                    company: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    location: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    work_mode: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    contract_type: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    employment_type: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    seniority: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    posted_at: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    valid_through: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    required_skills: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    apply_url: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    start_date: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    company_type: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    company_size: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                    engagement_length: z.ZodOptional<z.ZodObject<{
                        pointer: z.ZodString;
                        flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                            pointer: z.ZodString;
                            value: z.ZodString;
                        }, z.core.$strict>>>;
                        items: z.ZodOptional<z.ZodString>;
                        join: z.ZodOptional<z.ZodString>;
                        values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                        format: z.ZodOptional<z.ZodEnum<{
                            text: "text";
                            html: "html";
                            timestamp: "timestamp";
                            "utc-timestamp": "utc-timestamp";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                sections: z.ZodArray<z.ZodObject<{
                    pointer: z.ZodString;
                    flags: z.ZodOptional<z.ZodArray<z.ZodObject<{
                        pointer: z.ZodString;
                        value: z.ZodString;
                    }, z.core.$strict>>>;
                    items: z.ZodOptional<z.ZodString>;
                    join: z.ZodOptional<z.ZodString>;
                    values: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    format: z.ZodOptional<z.ZodEnum<{
                        text: "text";
                        html: "html";
                        timestamp: "timestamp";
                        "utc-timestamp": "utc-timestamp";
                    }>>;
                }, z.core.$strict>>;
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
            }, z.core.$strict>>;
            jsonLd: z.ZodBoolean;
        }, z.core.$strict>]>>;
        routing: z.ZodOptional<z.ZodArray<z.ZodObject<{
            host: z.ZodString;
            kind: z.ZodEnum<{
                board: "board";
                ats: "ats";
                social: "social";
                directory: "directory";
            }>;
        }, z.core.$strict>>>;
        presentation: z.ZodObject<{
            icon: z.ZodOptional<z.ZodObject<{
                url: z.ZodString;
                sha256: z.ZodString;
                mimeType: z.ZodEnum<{
                    "image/png": "image/png";
                    "image/webp": "image/webp";
                }>;
                byteLength: z.ZodNumber;
            }, z.core.$strict>>;
            attribution: z.ZodArray<z.ZodObject<{
                text: z.ZodString;
                url: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        health: z.ZodObject<{
            status: z.ZodEnum<{
                unverified: "unverified";
                validated: "validated";
                empty: "empty";
                reachable: "reachable";
                blocked: "blocked";
                "rate-limited": "rate-limited";
                drift: "drift";
                unavailable: "unavailable";
                "not-probed": "not-probed";
            }>;
            detail: z.ZodString;
            checkedAt: z.ZodNullable<z.ZodISODateTime>;
            lastSuccessAt: z.ZodNullable<z.ZodISODateTime>;
            environment: z.ZodString;
            recipeRevision: z.ZodString;
        }, z.core.$strict>;
        limitations: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    revokedRecipes: z.ZodArray<z.ZodObject<{
        sourceId: z.ZodString;
        revision: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export const envelopeSchema: z.ZodObject<{
    algorithm: z.ZodLiteral<"Ed25519">;
    keyId: z.ZodString;
    payloadBase64: z.ZodString;
    signatureBase64: z.ZodString;
}, z.core.$strict>;
export const connectionSchema: z.ZodObject<{
    id: z.ZodString;
    providerId: z.ZodString;
    name: z.ZodString;
    resolveUrl: z.ZodString;
    authentication: z.ZodEnum<{
        none: "none";
        bearer: "bearer";
    }>;
    credentialRef: z.ZodOptional<z.ZodString>;
    publicKeys: z.ZodRecord<z.ZodString, z.ZodString>;
    scope: z.ZodObject<{
        categories: z.ZodArray<z.ZodString>;
        markets: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    enabled: z.ZodBoolean;
    priority: z.ZodNumber;
}, z.core.$strict>;
export const connectionsSchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    providerId: z.ZodString;
    name: z.ZodString;
    resolveUrl: z.ZodString;
    authentication: z.ZodEnum<{
        none: "none";
        bearer: "bearer";
    }>;
    credentialRef: z.ZodOptional<z.ZodString>;
    publicKeys: z.ZodRecord<z.ZodString, z.ZodString>;
    scope: z.ZodObject<{
        categories: z.ZodArray<z.ZodString>;
        markets: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    enabled: z.ZodBoolean;
    priority: z.ZodNumber;
}, z.core.$strict>>;
import { pageListingRecipeSchema } from './page-listing.mjs';
import { httpJsonRecipeSchema } from './http-json.mjs';
import { embeddedJsonRecipeSchema } from './embedded-json.mjs';
import { domListingRecipeSchema } from './dom.mjs';
import { domDetailRecipeSchema } from './dom.mjs';
import { sitemapRecipeSchema } from './sitemap.mjs';
import { semanticDetailRecipeSchema } from './semantic-dom.mjs';
import { z } from 'zod';
export { pageListingRecipeSchema, httpJsonRecipeSchema, embeddedJsonRecipeSchema, domListingRecipeSchema, domDetailRecipeSchema, sitemapRecipeSchema, semanticDetailRecipeSchema };
