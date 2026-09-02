/**
 * A minimal value that satisfies a schema, derived from the schema itself.
 *
 * This is what makes the smoke tests cost nothing per capability. A step
 * declares the shape it expects back from a model; that declaration is enough
 * to build an answer of that shape, so a capability added to the map next month
 * is covered the moment it lands, with no fixture written by hand and none to
 * go stale when a field is renamed.
 *
 * It goes through `z.toJSONSchema` rather than reading zod's internals. The
 * internals are not API and have changed shape across minor versions; the JSON
 * Schema output is the documented projection, and a walk over it is a walk over
 * a data format instead of over a library's private fields.
 *
 * *Minimal* is the operative word. Optional properties are left out, arrays get
 * one element rather than several, and strings are a placeholder rather than
 * anything that reads like real content. A smoke test asks whether the machinery
 * carries a value from a step to a result — inventing convincing offer text
 * here would only make a failing assertion harder to read.
 *
 * Anything this cannot represent is a loud failure, not a quiet `{}`: the caller
 * checks every sample back through the schema it came from, so an unhandled
 * node type shows up as a named parse error rather than as a step that passes
 * for the wrong reason.
 */

import { z } from 'zod';

/** A JSON Schema node, as far as this file needs to understand one. */
type Node = {
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, Node>>;
  readonly required?: readonly string[];
  readonly items?: Node;
  readonly prefixItems?: readonly Node[];
  readonly minItems?: number;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly anyOf?: readonly Node[];
  readonly oneOf?: readonly Node[];
  readonly allOf?: readonly Node[];
  readonly minLength?: number;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;
  readonly multipleOf?: number;
  readonly format?: string;
  readonly additionalProperties?: Node | boolean;
};

const PLACEHOLDER = 'sample';

const text = (node: Node): string => {
  switch (node.format) {
    case 'email':
      return 'sample@example.test';
    case 'uri':
    case 'url':
      return 'https://example.test/sample';
    case 'date-time':
      return new Date(0).toISOString();
    case 'uuid':
      return '00000000-0000-4000-8000-000000000000';
    default: {
      const min = node.minLength ?? 0;
      return PLACEHOLDER.length >= min ? PLACEHOLDER : PLACEHOLDER.padEnd(min, 'x');
    }
  }
};

const number = (node: Node): number => {
  const floor = node.minimum ?? (node.exclusiveMinimum === undefined ? 0 : node.exclusiveMinimum + 1);
  const step = node.multipleOf ?? 1;
  return Math.ceil(floor / step) * step;
};

/** The declared type, whether it arrived bare or as a one-element list. */
const typeOf = (node: Node): string | undefined =>
  Array.isArray(node.type) ? node.type[0] : (node.type as string | undefined);

const valueOf = (node: Node): unknown => {
  if (node.const !== undefined) return node.const;
  if (node.enum && node.enum.length > 0) return node.enum[0];

  // A union answers as its first branch. Which branch is arbitrary and that is
  // fine — the point is that *a* valid value exists, not that every shape a
  // model might return is exercised.
  const branches = node.anyOf ?? node.oneOf;
  if (branches && branches.length > 0) return valueOf(branches[0] as Node);

  // `allOf` is an intersection, so every branch has to be satisfied at once.
  // Merging the objects is right for the only way zod emits it — an object
  // extended by another object.
  if (node.allOf && node.allOf.length > 0) {
    return node.allOf.reduce<Record<string, unknown>>(
      (merged, part) => ({ ...merged, ...(valueOf(part) as Record<string, unknown>) }),
      {}
    );
  }

  switch (typeOf(node)) {
    case 'object': {
      const built: Record<string, unknown> = {};
      const required = new Set(node.required ?? []);

      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (required.has(key)) built[key] = valueOf(child);
      }

      // A record — no named properties, a schema for the values. One entry, so
      // the value schema is exercised rather than skipped by an empty object.
      if (!node.properties && typeof node.additionalProperties === 'object') {
        built[PLACEHOLDER] = valueOf(node.additionalProperties);
      }

      return built;
    }

    case 'array': {
      if (node.prefixItems) return node.prefixItems.map(valueOf);
      const count = Math.max(node.minItems ?? 1, 1);
      const item = node.items ?? {};
      return Array.from({ length: count }, () => valueOf(item));
    }

    case 'string':
      return text(node);
    case 'number':
    case 'integer':
      return number(node);
    case 'boolean':
      return false;
    case 'null':
      return null;

    // No type at all: `z.unknown()`, `z.any()`, or something `toJSONSchema`
    // could not describe. An empty object satisfies the first two and is the
    // honest answer for the third — and the caller's parse check is what stops
    // it passing for something it is not.
    default:
      return {};
  }
};

/**
 * Builds a value of the shape `schema` describes.
 *
 * `unrepresentable: 'any'` rather than the default throw: `z.custom()` appears
 * in real input schemas and has no JSON Schema form, and an unconstrained node
 * is a better outcome than a capability that cannot be smoke-tested at all.
 */
export const sampleOf = <T>(schema: z.ZodType<T>): T =>
  valueOf(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as Node) as T;
