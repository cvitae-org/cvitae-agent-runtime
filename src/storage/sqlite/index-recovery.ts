import { randomUUID } from 'node:crypto';
import type { ChunkIndex, DocumentBody, IndexJob, IndexRecoveryStore, EmbeddingFingerprint, IndexedChunk } from '../../contracts/index.js';
import type { Db } from './open.js';

export const createIndexRecoveryStore = (db: Db, index: ChunkIndex, now: () => number = Date.now): IndexRecoveryStore => ({
  enqueue: (id) => {
    db.prepare(`INSERT INTO cv_index_jobs (document_id, revision)
      SELECT id, revision FROM documents WHERE id = ? AND kind = 'cv'
      ON CONFLICT(document_id) DO UPDATE SET revision = excluded.revision, attempts = 0,
        token = NULL, lease_until = 0, next_attempt_at = 0, last_error = NULL`).run(id);
  },
  status: (id) => {
    const row = db.prepare('SELECT * FROM cv_index_jobs WHERE document_id = ?').get(id) as
      { revision: number; attempts: number; next_attempt_at: number; last_error: string | null } | undefined;
    return row ? { revision: row.revision, attempts: row.attempts, nextAttemptAt: row.next_attempt_at, lastError: row.last_error } : undefined;
  },
  claim: db.transaction((): IndexJob | undefined => {
    // Imports already attempt their own embedding. Retry only once they settle.
    const row = db.prepare(`SELECT j.*, d.body FROM cv_index_jobs j JOIN documents d ON d.id = j.document_id
      WHERE j.next_attempt_at <= ? AND j.lease_until <= ? AND j.revision = d.revision
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
  fail: (job, message, retryAfterMs) => {
    db.prepare(`UPDATE cv_index_jobs SET token = NULL, lease_until = 0, next_attempt_at = ?, last_error = ?
      WHERE document_id = ? AND token = ?`).run(now() + retryAfterMs, message.slice(0, 500), job.documentId, job.token);
  }
});
