/**
 * `ChunkIndex` over SQLite: BM25 from FTS5, cosine from a scan.
 *
 * Two candidate lists, unfused. The fusion lives in `retrieval/`, because how
 * many candidates to pull and how to combine them is a retrieval strategy and
 * this file is a table.
 */

import type {
  ChunkIndex,
  EmbeddingFingerprint,
  IndexedChunk,
  LexicalQuery,
  ScoredChunk,
  TextChunk,
  VectorQuery
} from '../../contracts/index.js';
import { DocumentConflictError, fingerprintKey } from '../../contracts/index.js';
import type { Db } from './open.js';
import { foldForSearch, packVector, unpackVector } from './rows.js';

type ChunkRow = {
  id: string;
  local_id: string;
  source_revision: number;
  document_id: string;
  kind: string;
  text: string;
  meta: string;
  position: number;
  score: number;
};

type VectorRow = {
  id: string;
  local_id: string;
  source_revision: number;
  document_id: string;
  kind: string;
  text: string;
  meta: string;
  position: number;
  vector: Buffer;
};

const toScored = (row: ChunkRow): ScoredChunk => ({
  id: row.local_id,
  sourceRevision: row.source_revision,
  documentId: row.document_id,
  kind: row.kind,
  text: row.text,
  position: row.position,
  meta: JSON.parse(row.meta) as Record<string, unknown>,
  score: row.score
});

/**
 * FTS5 treats a bare query string as a query *expression*, so a user's text
 * containing `AND`, `*`, `-` or a quote is either a syntax error or a different
 * search than they asked for. Quoting each token turns the whole thing back
 * into a bag of literal words.
 */
const toMatchExpression = (text: string): string =>
  foldForSearch(text)
    .split(/\s+/u)
    .map((token) => token.replace(/["]/gu, ''))
    .filter((token) => token.length > 0)
    .map((token) => `"${token}"`)
    .join(' OR ');

/**
 * What `keepText` writes in place of a fingerprint. It has none of the `·`
 * separated parts of a real one, so no vector query can name it and
 * `fingerprintOf` reads it as absent.
 */
const TEXT_ONLY = 'text-only';
const NO_VECTOR = Buffer.alloc(0);

/** Both vectors are unit length when the fingerprint says `'l2'`, so this is cosine. */
const dot = (a: Float32Array, b: Float32Array): number => {
  let total = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    total += (a[i] as number) * (b[i] as number);
  }
  return total;
};

export const createChunkIndex = (db: Db, now: () => number = Date.now): ChunkIndex => {
  const deleteForDocument = db.prepare<[string]>(
    'DELETE FROM chunks WHERE document_id = ?'
  );

  const insertChunk = db.prepare<[
    string, string, string, string, string, string, number, string, number, Buffer, number, number, string
  ]>(
    `INSERT INTO chunks
       (id, document_id, kind, text, search_text, meta, position,
        fingerprint, dim, vector, created_at, source_revision, local_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const selectFingerprint = db.prepare<[string]>(
    'SELECT fingerprint, dim FROM chunks WHERE document_id = ? AND source_revision = (SELECT revision FROM documents WHERE id = chunks.document_id) LIMIT 1'
  );

  const revisionOf = (documentId: string, expected?: number): number => {
    const row = db.prepare('SELECT revision FROM documents WHERE id = ?').get(documentId) as { revision: number } | undefined;
    const actual = row?.revision ?? 0;
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 1)) {
      throw new RangeError('Index expectedRevision must be a positive safe integer.');
    }
    if (expected !== undefined && actual !== expected) {
      throw new DocumentConflictError(documentId, expected, actual);
    }
    return actual;
  };
  const clear = db.transaction((documentId: string, options?: { readonly expectedRevision: number }) => {
    revisionOf(documentId, options?.expectedRevision);
    const removed = deleteForDocument.run(documentId).changes;
    if (options) db.prepare('DELETE FROM cv_index_jobs WHERE document_id = ? AND revision = ?').run(documentId, options.expectedRevision);
    return removed;
  }).immediate;

  const replaceAll = db.transaction(
    (
      documentId: string,
      fingerprint: EmbeddingFingerprint,
      chunks: readonly IndexedChunk[],
      options?: { readonly expectedRevision: number }
    ): number => {
      const revision = revisionOf(documentId, options?.expectedRevision);
      deleteForDocument.run(documentId);

      const key = fingerprintKey(fingerprint);
      const at = now();

      for (const chunk of chunks) {
        if (chunk.vector.length !== fingerprint.dim) {
          throw new Error(
            `chunk ${chunk.id} has ${chunk.vector.length} dimensions, ` +
              `fingerprint declares ${fingerprint.dim}`
          );
        }

        insertChunk.run(
          JSON.stringify([documentId, chunk.id]),
          documentId,
          chunk.kind,
          chunk.text,
          foldForSearch(chunk.text),
          JSON.stringify(chunk.meta ?? {}),
          chunk.position,
          key,
          fingerprint.dim,
          packVector(chunk.vector),
          at,
          revision,
          chunk.id
        );
      }

      db.prepare('DELETE FROM cv_index_jobs WHERE document_id = ? AND revision = ?').run(documentId, revision);
      return chunks.length;
    }
  ).immediate;

  const keepText = db.transaction(
    (documentId: string, chunks: readonly TextChunk[], options: { readonly expectedRevision: number }): number => {
      const revision = revisionOf(documentId, options.expectedRevision);
      if (db.prepare('SELECT 1 FROM chunks WHERE document_id = ? AND source_revision = ? LIMIT 1').get(documentId, revision)) {
        return 0;
      }
      // What is left belongs to an older revision, which no query reads.
      deleteForDocument.run(documentId);

      const at = now();
      for (const chunk of chunks) {
        insertChunk.run(
          JSON.stringify([documentId, chunk.id]),
          documentId,
          chunk.kind,
          chunk.text,
          foldForSearch(chunk.text),
          JSON.stringify(chunk.meta ?? {}),
          chunk.position,
          TEXT_ONLY,
          0,
          NO_VECTOR,
          at,
          revision,
          chunk.id
        );
      }
      return chunks.length;
    }
  ).immediate;

  return {
    clear,
    keepText,

    lexical(query: LexicalQuery) {
      const match = toMatchExpression(query.text);
      if (match.length === 0) return [];

      // bm25() returns a negative number where more negative is better, so it
      // is negated here to make "higher is better" true of every score this
      // module returns. The fusion above ranks rather than compares magnitudes,
      // but a mixed sign convention is a trap waiting for whoever adds the next
      // scorer.
      const rows = db
        .prepare(
          `SELECT c.id, c.local_id, c.source_revision, c.document_id, c.kind, c.text, c.meta, c.position,
                  -bm25(chunks_fts) AS score
             FROM chunks_fts
             JOIN chunks c ON c.rowid = chunks_fts.rowid
            WHERE chunks_fts MATCH :match
              AND c.source_revision = (SELECT revision FROM documents WHERE id = c.document_id)
              AND (:documentId IS NULL OR c.document_id = :documentId)
              AND (:kinds IS NULL OR c.kind IN (SELECT value FROM json_each(:kinds)))
            ORDER BY score DESC
            LIMIT :limit`
        )
        .all({
          match,
          documentId: query.documentId ?? null,
          kinds: query.kinds ? JSON.stringify(query.kinds) : null,
          limit: query.limit
        }) as ChunkRow[];

      return rows.map(toScored);
    },

    neighbours(query: VectorQuery) {
      const rows = db
        .prepare(
          `SELECT id, local_id, source_revision, document_id, kind, text, meta, position, vector
             FROM chunks
            WHERE fingerprint = :fingerprint
              AND source_revision = (SELECT revision FROM documents WHERE id = chunks.document_id)
              AND (:documentId IS NULL OR document_id = :documentId)
              AND (:kinds IS NULL OR kind IN (SELECT value FROM json_each(:kinds)))`
        )
        .all({
          fingerprint: fingerprintKey(query.fingerprint),
          documentId: query.documentId ?? null,
          kinds: query.kinds ? JSON.stringify(query.kinds) : null
        }) as VectorRow[];

      // Filtering by fingerprint first is not an optimisation, it is the
      // correctness condition: vectors from a different model are numbers in a
      // different space, and scoring them against this query would rank noise.
      return rows
        .map((row) => ({
          id: row.local_id,
          sourceRevision: row.source_revision,
          documentId: row.document_id,
          kind: row.kind,
          text: row.text,
          position: row.position,
          meta: JSON.parse(row.meta) as Record<string, unknown>,
          score: dot(query.vector, unpackVector(row.vector))
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, query.limit);
    },

    fingerprintOf(documentId) {
      const row = selectFingerprint.get(documentId) as
        | { fingerprint: string; dim: number }
        | undefined;
      if (!row) return undefined;

      const [provider, model, dim, normalisation, chunker] = row.fingerprint.split('·');
      if (!provider || !model || !dim || !normalisation || !chunker) return undefined;

      return {
        provider,
        model,
        dim: Number(dim),
        normalisation: normalisation === 'l2' ? 'l2' : 'none',
        chunkerVersion: Number(chunker.slice(1))
      };
    },

    replace(documentId, fingerprint, chunks, options) {
      return replaceAll(documentId, fingerprint, chunks, options);
    }
  };
};
