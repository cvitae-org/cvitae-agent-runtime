/**
 * Turns text into vectors.
 *
 * Thin on purpose. `embedMany` already batches, retries and preserves order, so
 * what is left here is the two things it does not do: keep the local server
 * from being asked for more than it can serve at once, and normalise the
 * result.
 *
 * Normalising at write time rather than at query time is worth the line it
 * costs. Cosine similarity over unit vectors is a dot product, so every
 * subsequent comparison skips two square roots — and more usefully, it makes
 * LanceDB's L2 distance rank identically to cosine, which means the same stored
 * column serves either metric without a re-index.
 */

import { embed, embedMany } from 'ai';
import type { EmbeddingModel } from 'ai';

/**
 * Ollama serves embeddings from one model instance, so a large parallel batch
 * queues internally and risks the request timeout rather than going faster.
 * Hosted providers are happy with more, but the ceiling only binds when it is
 * the smaller of the two.
 */
const LOCAL_PARALLEL_CALLS = 2;
const HOSTED_PARALLEL_CALLS = 8;

export const normalise = (vector: number[]): number[] => {
  let sum = 0;
  for (const value of vector) sum += value * value;

  const magnitude = Math.sqrt(sum);
  // A zero vector has no direction to preserve; returning it unchanged keeps
  // the dimension right and lets it rank last, which is the honest outcome.
  if (magnitude === 0) return vector;

  return vector.map((value) => value / magnitude);
};

export type Embedder = {
  one: (text: string) => Promise<number[]>;
  many: (texts: string[]) => Promise<number[][]>;
  modelId: string;
  /** Learned from the first response; nothing declares it up front. */
  dimensions: number | null;
};

export const createEmbedder = ({
  model,
  modelId,
  providerId
}: {
  model: EmbeddingModel<string>;
  modelId: string;
  providerId: string;
}): Embedder => {
  const maxParallelCalls =
    providerId === 'local' ? LOCAL_PARALLEL_CALLS : HOSTED_PARALLEL_CALLS;

  let dimensions: number | null = null;

  const remember = (vector: number[] | undefined): void => {
    if (vector && dimensions === null) dimensions = vector.length;
  };

  return {
    modelId,

    get dimensions() {
      return dimensions;
    },

    async one(text: string) {
      const { embedding } = await embed({ model, value: text });
      remember(embedding);
      return normalise(embedding);
    },

    async many(texts: string[]) {
      if (texts.length === 0) return [];

      const { embeddings } = await embedMany({
        model,
        values: texts,
        maxParallelCalls
      });

      remember(embeddings[0]);

      return embeddings.map(normalise);
    }
  };
};
