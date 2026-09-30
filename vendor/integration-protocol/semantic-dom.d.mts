export const semanticRuleSchema: z.ZodObject<{
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
}, z.core.$strict>;
export const semanticDetailRecipeSchema: z.ZodObject<{
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
}, z.core.$strict>;
import { z } from 'zod';
