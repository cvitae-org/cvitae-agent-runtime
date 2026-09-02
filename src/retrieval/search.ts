/**
 * One question, one ranked answer, from two engines that disagree.
 *
 * BM25 and cosine both return numbers and the numbers mean nothing to each
 * other. A BM25 score depends on the corpus and on how rare the query's terms
 * happen to be; a cosine score is bounded and clusters tightly near the top.
 * Blending them needs a weight, and any weight needs the two scales to be
 * comparable, which they are not — normalising each list per query only moves
 * the problem, because then the weight depends on how good that query's best
 * hit happened to be.
 *
 * Reciprocal rank fusion sidesteps all of it by throwing the scores away and
 * keeping only the order: a document scores `1 / (K + rank)` in each list it
 * appears in, and the scores add. A chunk both halves rank third beats one that
 * a single half ranks first, which is the behaviour worth having — agreement
 * between two engines that fail differently is stronger evidence than either
 * engine's confidence in itself.
 *
 * The fused score is not a similarity. It is bounded by the number of lists and
 * has no meaning outside one query's results, so it is for ordering and for
 * looking at when a ranking seems wrong — never for a threshold.
 */

import type {
  AiGateway,
  ChunkHit,
  ChunkQuery,
  ChunkReader,
  Retriever,
  ScoredChunk
} from '../contracts/index.js';
import { fingerprintOf } from './fingerprint.js';

/**
 * The rank-fusion constant, from the paper the method comes from.
 *
 * It sets how quickly a list's contribution decays: large enough that the top
 * few ranks are not overwhelmingly separated, so a strong second opinion still
 * counts for something. 60 is the published default and there is no local
 * evidence for moving it — a tuned constant with nothing measured behind it is
 * a worse default than an unmodified one.
 */
const K = 60;

/**
 * How many candidates each half contributes, as a multiple of the limit.
 *
 * Fusion needs depth to work with. If each half returned exactly `limit` rows,
 * a chunk ranked just below the cut in both lists would be invisible, even
 * though agreeing near-misses are exactly what fusion exists to promote.
 */
const OVERFETCH = 4;
const MIN_POOL = 20;

export type RetrieverOptions = {
  readonly reader: ChunkReader;
  readonly ai: AiGateway;
  /** Carried into the embedding call, so a search is attributable to its run. */
  readonly traceId: string;
  readonly runId?: string;
  readonly overfetch?: number;
};

type Fused = {
  chunk: ScoredChunk;
  score: number;
  found: ('lexical' | 'vector')[];
};

/**
 * Adds one engine's ranking into the running fusion.
 *
 * Rank is the position in that engine's own list, so the caller must pass the
 * lists already ordered — which both `ChunkReader` methods promise.
 */
const fold = (
  into: Map<string, Fused>,
  candidates: readonly ScoredChunk[],
  half: 'lexical' | 'vector'
): void => {
  candidates.forEach((chunk, index) => {
    const contribution = 1 / (K + index + 1);
    const existing = into.get(chunk.id);

    if (existing) {
      existing.score += contribution;
      existing.found.push(half);
      return;
    }

    into.set(chunk.id, { chunk, score: contribution, found: [half] });
  });
};

export const createRetriever = (options: RetrieverOptions): Retriever => {
  const { reader, ai } = options;
  const overfetch = options.overfetch ?? OVERFETCH;

  return {
    async search(query: ChunkQuery, signal: AbortSignal): Promise<ChunkHit[]> {
      const text = query.text.trim();

      if (!text || query.limit <= 0) return [];

      const pool = Math.max(query.limit * overfetch, MIN_POOL);
      const filter = {
        ...(query.documentId ? { documentId: query.documentId } : {}),
        ...(query.kinds ? { kinds: query.kinds } : {}),
        limit: pool
      };

      const fused = new Map<string, Fused>();

      fold(fused, reader.lexical({ text, ...filter }), 'lexical');

      if (!query.lexicalOnly) {
        // Embedded here rather than by the caller: the query has to go through
        // the same model as the stored chunks, and the fingerprint that proves
        // it comes from the same call.
        const embedded = await ai.embed({ ...call(options, signal), values: [text] });
        const vector = embedded.vectors[0];

        if (vector) {
          // A fingerprint the index does not hold matches nothing, so a model
          // swap degrades this search to its lexical half rather than ranking
          // by vectors from a different space. Silent, but visible: no hit
          // comes back marked `vector`.
          fold(
            fused,
            reader.neighbours({ vector, fingerprint: fingerprintOf(embedded), ...filter }),
            'vector'
          );
        }
      }

      return [...fused.values()]
        .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
        .slice(0, query.limit)
        .map(({ chunk, score, found }) => ({ ...chunk, score, found }));
    }
  };
};

const call = (options: RetrieverOptions, signal: AbortSignal) => ({
  traceId: options.traceId,
  ...(options.runId ? { runId: options.runId } : {}),
  step: 'retrieval',
  signal
});
