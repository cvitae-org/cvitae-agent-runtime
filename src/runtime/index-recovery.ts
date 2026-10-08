import type { AiGateway, IndexJob, IndexRecoveryStore } from '../contracts/index.js';
import { RuntimeError } from '../contracts/index.js';
import { asCvDocument } from '../capabilities/cv/document.js';
import { cvPieces } from '../capabilities/cv/pieces.js';
import { chunkPieces, type Chunk } from '../retrieval/chunk.js';
import { embedChunks } from '../retrieval/embed.js';

/**
 * Failures that trying again cannot fix: the same key, or the same missing
 * one, gets the same answer. The job waits for a person to change something
 * (`IndexJobStatus.parked`).
 */
const needsAPerson: ReadonlySet<string> = new Set(['credential_rejected', 'misconfigured']);

export type IndexRebuilderOptions = {
  /**
   * Whether a job may be taken now, asked before each. False leaves every job
   * where it is, waiting and not failed, until it is true: the runtime is not yet
   * told what an embedding has to keep (`MaskTerms.declared`).
   */
  readonly ready?: () => boolean;
};

/** No polling in library/tests unless explicitly started by a host. */
export const createIndexRebuilder = (jobs: IndexRecoveryStore, ai: AiGateway, options: IndexRebuilderOptions = {}) => {
  let stopped = false;
  let active: IndexJob | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const abort = new AbortController();
  const runOnce = async (): Promise<void> => {
    if (stopped || active) return;
    if (options.ready !== undefined && !options.ready()) return;
    const job = jobs.claim();
    if (!job) return;
    active = job;
    let chunks: readonly Chunk[] | undefined;
    try {
      chunks = chunkPieces(cvPieces(asCvDocument(job.body)));
      const embedded = await embedChunks(chunks, ai, {
        traceId: `index:${job.documentId}:${job.revision}`, step: 'index_recovery', signal: abort.signal
      });
      if (!stopped) jobs.complete(job, embedded);
    } catch (error) {
      if (!stopped) {
        const code = error instanceof RuntimeError ? error.code : null;
        jobs.fail(job, {
          message: String((error as Error)?.message ?? error),
          code,
          retryAfterMs: code !== null && needsAPerson.has(code)
            ? null
            : Math.min(300_000, 5000 * 2 ** Math.min(job.attempts - 1, 6)),
          ...(chunks ? { text: chunks } : {})
        });
      }
    } finally { active = undefined; }
  };
  return {
    runOnce,
    start: () => {
      if (timer || stopped) return;
      // Storage is local but a transient claim failure must not crash the host.
      timer = setInterval(() => { void runOnce().catch(() => undefined); }, 1000);
      timer.unref();
    },
    close: () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      if (active) jobs.fail(active, { message: 'Index rebuild interrupted; retry pending.', code: null, retryAfterMs: 0 });
      abort.abort();
    }
  };
};
