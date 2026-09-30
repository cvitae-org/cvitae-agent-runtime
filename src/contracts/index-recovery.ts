import type { DocumentBody } from './document-store.js';
import type { EmbeddingFingerprint, IndexedChunk, TextChunk } from './chunk-index.js';
export type IndexJob = {
  readonly documentId: string; readonly revision: number; readonly body: DocumentBody;
  readonly token: string; readonly attempts: number;
};
export type IndexJobStatus = {
  readonly revision: number; readonly attempts: number; readonly nextAttemptAt: number;
  readonly lastError: string | null;
  /** The runtime error code of the last failure, when it had one. */
  readonly errorCode: string | null;
  /**
   * Stopped until something changes, because trying again cannot help: a key
   * that is missing or refused. A saved key or setting, a new CV revision or a
   * rebuild asked for starts it again.
   */
  readonly parked: boolean;
};
export type IndexFailure = {
  /** Already redacted by the gateway: the model, the host and the status. */
  readonly message: string;
  readonly code: string | null;
  /** When to try again. `null` parks the job ({@link IndexJobStatus.parked}). */
  readonly retryAfterMs: number | null;
  /** What the attempt chunked, kept for keyword search (`ChunkIndex.keepText`). */
  readonly text?: readonly TextChunk[];
};
/** What a CV's current revision holds for search. */
export type IndexedSummary = {
  readonly chunks: number;
  /** Rows kept by `keepText`: findable by keyword and not by meaning. */
  readonly keywordOnly: boolean;
};
export interface IndexRecoveryStore {
  enqueue(documentId: string): void;
  status(documentId: string): IndexJobStatus | undefined;
  claim(): IndexJob | undefined;
  complete(job: IndexJob, embedded?: { readonly fingerprint: EmbeddingFingerprint; readonly chunks: readonly IndexedChunk[] }): boolean;
  fail(job: IndexJob, failure: IndexFailure): void;
  /** Starts every parked job again, after a change that may have fixed it. */
  resume(): void;
  indexed(documentId: string): IndexedSummary;
}
