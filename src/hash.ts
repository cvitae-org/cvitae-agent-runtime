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
 * would be the wrong home now that a capability needs it — offer identity
 * importing from the retrieval tier reads as a mistake — and `contracts/` is
 * vocabulary, which this is not. It imports nothing, so anything may import it.
 *
 * Not cryptographic, and does not need to be. Its inputs are not adversarial —
 * the user's own documents and the postings they collected — and a collision
 * costs a reused embedding for two different strings, two URLs sharing an
 * offer id, or an offer's details that look current when their source moved.
 */

export const fingerprint = (value: string): string => {
  let digest = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    digest ^= value.charCodeAt(index);
    digest = Math.imul(digest, 0x01000193) >>> 0;
  }

  return digest.toString(36);
};
