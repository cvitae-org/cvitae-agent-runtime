/**
 * The digest of a piece: the first 16 hex characters of the SHA-256 of its
 * canonical JSON, encoded as UTF-8.
 *
 * One rule for every value, text included: a string digests as the JSON string
 * it is (quotes and escapes), not as bare bytes, so there is no second
 * definition to keep in step. `src/hash.ts` is a 32-bit FNV-1a that returns
 * base 36. That is fine for naming a row and wrong here, where two different
 * pieces agreeing is a wrong citation and not a collision in a table.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.js';

export const DIGEST_LENGTH = 16;

const SHAPE = /^[0-9a-f]{16}$/;

export const digest = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex').slice(0, DIGEST_LENGTH);

export const isDigest = (value: unknown): value is string => typeof value === 'string' && SHAPE.test(value);
