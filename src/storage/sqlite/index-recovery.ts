import { randomUUID } from 'node:crypto';
import type { ChunkIndex, DocumentBody, IndexJob, IndexRecoveryStore, EmbeddingFingerprint, IndexedChunk, IndexFailure } from '../../contracts/index.js';
import { DocumentConflictError } from '../../contracts/index.js';
import type { Db } from './open.js';

export const createIndexRecoveryStore = (db: Db, index: ChunkIndex, now: () => number = Date.now): IndexRecoveryStore => ({
  enqueue: (id) => {
    db.prepare(`INSERT INTO cv_index_jobs (document_id, revision)
      SELECT id, revision FROM documents WHERE id = ? AND kind = 'cv'
      ON CONFLICT(document_id) DO UPDATE SET revision = excluded.revision, attempts = 0,
        token = NULL, lease_until = 0, next_attempt_at = 0, last_error = NULL,
        error_code = NULL, parked = 0`).run(id);
  },
  status: (id) => {
    const row = db.prepare('SELECT * FROM cv_index_jobs WHERE document_id = ?').get(id) as
      { revision: number; attempts: number; next_attempt_at: number; last_error: string | null;
        error_code: string | null; parked: number } | undefined;
    return row ? {
      revision: row.revision, attempts: row.attempts, nextAttemptAt: row.next_attempt_at, lastError: row.last_error,
      errorCode: row.error_code, parked: row.parked === 1
    } : undefined;
  },
  claim: db.transaction((): IndexJob | undefined => {
    // Imports already attempt their own embedding. Retry only once they settle.
    const row = db.prepare(`SELECT j.*, d.body FROM cv_index_jobs j JOIN documents d ON d.id = j.document_id
      WHERE j.parked = 0 AND j.next_attempt_at <= ? AND j.lease_until <= ? AND j.revision = d.revision
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.capability = 'extract_cv' AND r.status IN ('queued', 'running')
        AND (r.context_id = j.document_id OR (r.context_id IS NULL AND j.document_id = 'cv')))
      ORDER BY j.next_attempt_at, j.document_id LIMIT 1`).get(now(), now()) as
        { document_id: string; revision: number; body: string; attempts: number } | undefined;
    if (!row) return undefined;
    const token = randomUUID();
    db.prepare('UPDATE cv_index_jobs SET token = ?, lease_until = ?, attempts = attempts + 1 WHERE document_id = ?')
      .run(token, now() + 300_000, row.document_id);
    return { documentId: row.document_id, revision: row.revision, body: JSON.parse(row.body) as DocumentBody, token, attempts: row.attempts + 1 };
  }).immediate,
  complete: db.transaction((job: IndexJob, embedded?: { fingerprint: EmbeddingFingerprint; chunks: readonly IndexedChunk[] }) => {
    if (!db.prepare('SELECT 1 FROM cv_index_jobs WHERE document_id = ? AND token = ? AND revision = ?')
      .get(job.documentId, job.token, job.revision)) return false;
    if (embedded) index.replace(job.documentId, embedded.fingerprint, embedded.chunks, { expectedRevision: job.revision });
    else index.clear(job.documentId, { expectedRevision: job.revision });
    db.prepare('DELETE FROM cv_index_jobs WHERE document_id = ? AND token = ?').run(job.documentId, job.token);
    return true;
  }).immediate,
  fail: db.transaction((job: IndexJob, failure: IndexFailure) => {
    // A claim that was superseded, by a newer revision or an expired lease,
    // owns nothing: neither the job's state nor the index.
    if (!db.prepare('SELECT 1 FROM cv_index_jobs WHERE document_id = ? AND token = ? AND revision = ?')
      .get(job.documentId, job.token, job.revision)) return;
    if (failure.text) {
      try {
        index.keepText(job.documentId, failure.text, { expectedRevision: job.revision });
      } catch (error) {
        // The CV moved on while the embedder was failing; its own job will
        // index the newer text.
        if (!(error instanceof DocumentConflictError)) throw error;
      }
    }
    const parked = failure.retryAfterMs === null;
    db.prepare(`UPDATE cv_index_jobs SET token = NULL, lease_until = 0, next_attempt_at = ?, last_error = ?,
        error_code = ?, parked = ?
      WHERE document_id = ? AND token = ?`).run(
      parked ? 0 : now() + (failure.retryAfterMs ?? 0), failure.message.slice(0, 500), failure.code,
      parked ? 1 : 0, job.documentId, job.token
    );
  }).immediate,
  resume: () => {
    db.prepare(`UPDATE cv_index_jobs SET attempts = 0, next_attempt_at = 0, last_error = NULL,
        error_code = NULL, parked = 0
      WHERE parked = 1`).run();
  },
  indexed: (id) => {
    const row = db.prepare(`SELECT COUNT(*) AS chunks, COALESCE(SUM(dim > 0), 0) AS vectors FROM chunks
      WHERE document_id = ? AND source_revision = (SELECT revision FROM documents WHERE id = ?)`)
      .get(id, id) as { chunks: number; vectors: number };
    return { chunks: row.chunks, keywordOnly: row.chunks > 0 && row.vectors === 0 };
  }
});
