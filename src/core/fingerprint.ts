/**
 * A short deterministic hash of a string.
 *
 * Lifted out of `retrieval/chunk.ts`, which had it first and still uses it to
 * key chunk ids by content. The storage layer now needs the same function for a
 * different job — stamping which `cv.json` a rating was computed against — and
 * the two must agree, because the whole point of a fingerprint is that the same
 * input produces the same value everywhere. Duplicating eight lines would have
 * worked right up until someone tuned one copy.
 *
 * It lives in `core/` rather than in either caller because `store/` importing
 * from `retrieval/` would invert the dependency: retrieval reads the document
 * the store owns, not the other way round.
 *
 * FNV-1a: not cryptographic, and does not need to be. Both uses tolerate a
 * collision the same way — a reused embedding for two identical-length strings,
 * or a rating that looks current when it is one revision stale — and neither
 * input is adversarial.
 */

export const fingerprint = (value: string): string => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36);
};

/**
 * Fingerprints a value by its JSON, with object keys sorted.
 *
 * `JSON.stringify` preserves insertion order, so two documents that differ only
 * in the order their fields were assigned would hash differently and every
 * offer would look like it needed rescoring. Sorting makes the hash a function
 * of the content rather than of how the object was built.
 */
export const fingerprintValue = (value: unknown): string => {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);

    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, nested]) => [key, canonical(nested)])
      );
    }

    return input;
  };

  return fingerprint(JSON.stringify(canonical(value)));
};
