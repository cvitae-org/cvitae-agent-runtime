/**
 * A short deterministic hash, in one place.
 *
 * There were two identical copies of FNV-1a in the two codebases this repo is
 * the merge of — one keying chunk ids by content in `retrieval/chunk.ts`, one
 * stamping which CV a rating was computed against. They agreed by coincidence,
 * and the entire value of a fingerprint is that the same input produces the
 * same value everywhere. Duplicating eight lines works right up until someone
 * tunes one copy.
 *
 * At the root beside `env.ts` rather than inside either caller. `retrieval/`
 * would be the wrong home now that a capability needs it — a scorer importing
 * from the retrieval tier reads as a mistake — and `contracts/` is vocabulary,
 * which this is not. It imports nothing, so anything may import it.
 *
 * Not cryptographic, and does not need to be. Both uses tolerate a collision
 * the same way: a reused embedding for two different strings, or a rating that
 * looks current when it is one revision stale. Neither input is adversarial —
 * they are the user's own documents.
 */

export const fingerprint = (value: string): string => {
  let digest = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    digest ^= value.charCodeAt(index);
    digest = Math.imul(digest, 0x01000193) >>> 0;
  }

  return digest.toString(36);
};

/**
 * Fingerprints a value by its JSON, with object keys sorted.
 *
 * `JSON.stringify` preserves insertion order, so two documents differing only
 * in the order their fields were assigned would hash differently — and every
 * offer on disk would look like it needed rescoring. Sorting makes the hash a
 * function of the content rather than of how the object was built.
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
