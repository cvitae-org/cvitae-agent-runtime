import type { DocumentBody } from './document-store.js';
import type { EmbeddingFingerprint, IndexedChunk } from './chunk-index.js';
export type IndexJob = {
  readonly documentId: string; readonly revision: number; readonly body: DocumentBody;
  readonly token: string; readonly attempts: number;
};
export type IndexJobStatus = {
  readonly revision: number; readonly attempts: number; readonly nextAttemptAt: number;
  readonly lastError: string | null;
};
export interface IndexRecoveryStore {
  enqueue(documentId: string): void;
  status(documentId: string): IndexJobStatus | undefined;
  claim(): IndexJob | undefined;
  complete(job: IndexJob, embedded?: { readonly fingerprint: EmbeddingFingerprint; readonly chunks: readonly IndexedChunk[] }): boolean;
  fail(job: IndexJob, message: string, retryAfterMs: number): void;
}
