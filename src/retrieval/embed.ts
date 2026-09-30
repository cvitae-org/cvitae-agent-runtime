/**
 * Turning chunks into rows an index can store.
 *
 * Thin, because the gateway already does the work that used to live here: it
 * batches, it limits how many calls a provider gets at once, it propagates
 * cancellation, and it L2-normalises every vector on the way out. What is left
 * is the part the gateway has no business knowing — that these vectors belong
 * to a document, and that they are only meaningful alongside a record of what
 * produced them.
 *
 * That record is the whole point of this file existing rather than the caller
 * calling `ai.embed` directly. Vectors whose provenance is not stored beside
 * them are vectors that keep answering queries after a model swap: nothing
 * fails, dimensions still match, and the ranking is quietly wrong.
 */

import type {
  AiGateway,
  EffectCall,
  EmbeddingFingerprint,
  IndexedChunk
} from '../contracts/index.js';
import type { Chunk } from './chunk.js';
import { fingerprintOf } from './fingerprint.js';

export type Embedded = {
  readonly fingerprint: EmbeddingFingerprint;
  readonly chunks: readonly IndexedChunk[];
};

/**
 * Embeds a document's chunks and pairs them with their fingerprint.
 *
 * Returns `undefined` for an empty input rather than inventing a fingerprint
 * from nothing. There is no call to make, so there is nothing to describe, and
 * a caller clearing a document's index does not need one — the distinction is
 * real and the type makes the caller face it.
 *
 * Throws whatever the gateway raises, and does not catch it. Embedding is not
 * something this layer can degrade: the alternative to a vector is not a worse
 * vector, it is a search with half its evidence missing. What a caller does
 * about that is its own choice, and the ones that exist make it out loud: the
 * index keeps the text without vectors (`ChunkIndex.keepText`), and a search
 * whose query cannot be embedded reads the keyword half alone, as
 * `ChunkQuery.lexicalOnly` asks for on purpose.
 */
export const embedChunks = async (
  chunks: readonly Chunk[],
  ai: AiGateway,
  call: EffectCall
): Promise<Embedded | undefined> => {
  if (chunks.length === 0) return undefined;

  const result = await ai.embed({ ...call, values: chunks.map((chunk) => chunk.text) });

  // A short result would silently pair chunk n with chunk n+1's vector, and
  // every one of them would still be a valid vector of the right width.
  if (result.vectors.length !== chunks.length) {
    throw new Error(
      `The embedder returned ${result.vectors.length} vectors for ${chunks.length} chunks.`
    );
  }

  return {
    fingerprint: fingerprintOf(result),
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      vector: result.vectors[index] as Float32Array
    }))
  };
};
