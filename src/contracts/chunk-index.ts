/**
 * Retrieval, split into a read type and a write type.
 *
 * The split is not stylistic. `retrieval/` is typed against `ChunkReader`, so
 * "retrieval holds no write handle" is a fact the compiler checks on every
 * build rather than a rule someone has to remember while adding a file. There
 * is no cast that recovers `replace` from a `ChunkReader`, and the object
 * `runtime/` hands to a step is only ever the reader.
 */

/**
 * What a set of vectors was produced by.
 *
 * Every part of this changes what the numbers mean, and none of it is visible
 * in the vectors themselves:
 *
 *   provider · model     a different model is a different space entirely
 *   dim                  a mismatch is a crash, not a bad result — which is the
 *                        lucky case
 *   normalisation        cosine assumes unit length; mixing normalised and raw
 *                        vectors silently ranks by magnitude
 *   chunkerVersion       the same text split differently produces different
 *                        neighbours, so the ids stay stable while the meaning
 *                        moves underneath them
 *
 * The previous runtime had no fingerprint, so content whose id had not changed
 * kept its old vectors after a model swap. Nothing failed; the ranking was just
 * quietly wrong, which is the expensive kind of wrong. Storing this per chunk
 * makes a stale row detectable with a `WHERE`.
 */
export type EmbeddingFingerprint = {
  readonly provider: string;
  readonly model: string;
  readonly dim: number;
  readonly normalisation: 'l2' | 'none';
  readonly chunkerVersion: number;
};

/** The canonical string form, used as the stored column and for equality. */
export const fingerprintKey = (f: EmbeddingFingerprint): string =>
  [f.provider, f.model, String(f.dim), f.normalisation, `c${f.chunkerVersion}`].join('·');

export type IndexedChunk = {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly position: number;
  readonly meta?: Readonly<Record<string, unknown>>;
  /** L2-normalised at write when the fingerprint says `'l2'`. */
  readonly vector: Float32Array;
};

/**
 * A raw lexical query. `limit` is a candidate count, not a result count — the
 * fusion above it decides how many survive.
 */
export type LexicalQuery = {
  readonly text: string;
  readonly documentId?: string;
  readonly kinds?: readonly string[];
  readonly limit: number;
};

export type VectorQuery = {
  readonly vector: Float32Array;
  readonly fingerprint: EmbeddingFingerprint;
  readonly documentId?: string;
  readonly kinds?: readonly string[];
  readonly limit: number;
};

/** A candidate with the engine's own score. Only meaningful within one list. */
export type ScoredChunk = {
  readonly id: string;
  readonly documentId: string;
  readonly kind: string;
  readonly text: string;
  readonly position: number;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly score: number;
  /** Document revision indexed; absent only on test/custom readers. */
  readonly sourceRevision?: number;
};

export type ChunkQuery = {
  readonly text: string;
  readonly documentId?: string;
  readonly kinds?: readonly string[];
  readonly limit: number;
  /** Skip the vector half. For a caller that has no embedder available. */
  readonly lexicalOnly?: boolean;
};

export type ChunkHit = ScoredChunk & {
  /** Which halves found it. Useful when a ranking looks wrong. */
  readonly found: readonly ('lexical' | 'vector')[];
};

/**
 * Raw candidate access. Two lists, unfused.
 *
 * The split from `Retriever` below is what keeps the layering honest. Deciding
 * how many candidates to pull from each half and how to combine them is a
 * retrieval strategy, and strategies belong in `retrieval/`. Getting rows out of
 * a table is storage. Merging the two into one `search()` here would have put
 * the ranking policy inside the SQLite adapter, where swapping the engine would
 * mean rewriting it.
 */
export interface ChunkReader {
  lexical(query: LexicalQuery): ScoredChunk[];

  /**
   * Nearest neighbours by cosine, over the chunks matching the fingerprint.
   *
   * Brute force, deliberately. A dedicated vector extension was measured at
   * 2.8ms against 4.7ms for a plain scan at the scale this actually runs at —
   * a two-millisecond win, paid for with a native extension to load, a second
   * index to keep in sync, and primary keys that have to be BigInts. At corpus
   * sizes measured in thousands of chunks the scan is not the bottleneck, and
   * the day it becomes one, this method is the only thing that changes.
   */
  neighbours(query: VectorQuery): ScoredChunk[];

  /** What a document's chunks were embedded with, so a caller can detect drift. */
  fingerprintOf(documentId: string): EmbeddingFingerprint | undefined;
}

export interface ChunkIndex extends ChunkReader {
  /**
   * Replaces every chunk for a document in one transaction. Replace rather than
   * upsert: a re-chunked document has a different number of pieces, and the
   * leftovers from the longer previous run would otherwise stay searchable.
   *
   * Async builders must supply the source document revision. Publication
   * checks it before clearing/replacing any rows. Omission is reserved for
   * synchronous trusted callers; scoped run ports require the precondition.
   *
   * Returns the number of chunks written.
   */
  replace(
    documentId: string,
    fingerprint: EmbeddingFingerprint,
    chunks: readonly IndexedChunk[],
    options?: { readonly expectedRevision: number }
  ): number;

  /**
   * Removes every chunk for a document. Returns how many were removed.
   *
   * Separate from `replace(id, fingerprint, [])` because a caller with nothing
   * to write has nothing to fingerprint either — there was no embedding call,
   * so there is no provider, model or dimension to name, and the alternatives
   * are inventing one or reading back the fingerprint of the rows about to be
   * deleted. Both describe a set of vectors that will not exist.
   *
   * This is the path a document takes when its searchable content is emptied
   * rather than changed. Leaving the old chunks in place would keep answering
   * queries about text the document no longer contains.
   */
  clear(documentId: string, options?: { readonly expectedRevision: number }): number;
}

/**
 * What a step is handed: one question, one ranked answer.
 *
 * Implemented in `retrieval/` over a `ChunkReader`, which is the whole of the
 * "retrieval holds a read handle and no write handle" claim — there is no cast
 * that recovers `replace` from the object it is given.
 *
 * Asynchronous because the query usually has to be embedded first, and that is
 * a model call.
 */
export interface Retriever {
  search(query: ChunkQuery, signal: AbortSignal): Promise<ChunkHit[]>;
}
