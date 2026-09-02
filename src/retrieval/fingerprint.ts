/**
 * What a set of vectors was produced by.
 *
 * The parts are listed in `contracts/chunk-index.ts`; this file only builds and
 * compares them. Both halves matter and neither is interesting on its own —
 * a fingerprint nobody checks is a column, and a check with nothing to compare
 * against is a guess.
 *
 * `CHUNKER_VERSION` is the part that is easy to forget, because it is the only
 * component not reported by the embedding service. The same text split
 * differently produces different neighbours while every id stays stable, so a
 * change to `chunk.ts` that alters what a piece contains has to bump this or
 * the old vectors keep answering queries about text that no longer exists.
 */

import type { EmbeddingFingerprint, EmbedResult } from '../contracts/index.js';
import { fingerprintKey } from '../contracts/index.js';

/**
 * Bump when `chunk.ts` changes what a chunk contains.
 *
 * Not when it changes how it is formatted for a caller, and not when a new
 * `kind` is added — only when the text handed to the embedder for the same
 * input would come out different.
 */
export const CHUNKER_VERSION = 1;

/**
 * The fingerprint for vectors that have just been produced.
 *
 * Reads the provider, model and dimension off the result rather than off a
 * setting: what the runtime asked for and what answered are not guaranteed to
 * be the same thing, and it is what answered that the numbers came from.
 */
export const fingerprintOf = (result: EmbedResult): EmbeddingFingerprint => ({
  provider: result.provider,
  model: result.model,
  dim: result.dim,
  // The gateway normalises on the way out, without exception. If that ever
  // becomes conditional, this has to become conditional with it.
  normalisation: 'l2',
  chunkerVersion: CHUNKER_VERSION
});

/** Whether two sets of vectors are in the same space and comparable. */
export const sameFingerprint = (
  a: EmbeddingFingerprint,
  b: EmbeddingFingerprint
): boolean => fingerprintKey(a) === fingerprintKey(b);
