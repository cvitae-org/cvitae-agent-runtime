/**
 * Canonical JSON: one byte string for one value, whoever built it and in
 * whatever order its keys were added.
 *
 * It is RFC 8785 for the data this system holds: object keys sorted by UTF-16
 * code unit, no whitespace, and numbers and strings written as `JSON.stringify`
 * writes them. A digest is only as stable as this is, so the rule is stricter
 * than JSON in one place. Whatever two writers could disagree about is refused,
 * not normalised: a hole or an `undefined` in an array (JSON would turn it into
 * `null`, and `[undefined]` would then digest like `[null]`), a number that is
 * not finite, an object with a prototype, a cycle.
 *
 * An `undefined` object member is the one thing dropped, as `JSON.stringify`
 * drops it, because optional fields are written that way everywhere in this tree.
 */

import { OperationError } from '../contracts/index.js';

const refuse = (what: string): never => {
  throw new OperationError('not_canonical', `Cannot take the canonical form of ${what}.`);
};

const write = (value: unknown, ancestors: readonly object[]): string => {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : refuse('a number that is not finite');
    case 'string':
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      return refuse(`a value of type ${typeof value}`);
  }

  const object = value as object;
  if (ancestors.includes(object)) return refuse('a cyclic value');
  const inside = [...ancestors, object];

  if (Array.isArray(object)) {
    // `Array.from` visits holes as `undefined`, where `map` would skip them and
    // `join` would write them as nothing.
    const items = Array.from(object as unknown[], (item) =>
      item === undefined ? refuse('an undefined array item') : write(item, inside)
    );
    return `[${items.join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) return refuse('an object that is not plain');

  const record = object as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${write(record[key], inside)}`);
  return `{${members.join(',')}}`;
};

export const canonicalJson = (value: unknown): string => write(value, []);
