import type { AiGateway, IndexJob, IndexRecoveryStore } from '../contracts/index.js';
import { asCvDocument } from '../capabilities/cv/document.js';
import { cvPieces } from '../capabilities/cv/pieces.js';
import { chunkPieces } from '../retrieval/chunk.js';
import { embedChunks } from '../retrieval/embed.js';

/** No polling in library/tests unless explicitly started by a host. */
export const createIndexRebuilder = (jobs: IndexRecoveryStore, ai: AiGateway) => {
  let stopped = false;
  let active: IndexJob | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const abort = new AbortController();
  const runOnce = async (): Promise<void> => {
    if (stopped || active) return;
    const job = jobs.claim();
    if (!job) return;
    active = job;
    try {
      const embedded = await embedChunks(chunkPieces(cvPieces(asCvDocument(job.body))), ai, {
        traceId: `index:${job.documentId}:${job.revision}`, step: 'index_recovery', signal: abort.signal
      });
      if (!stopped) jobs.complete(job, embedded);
    } catch (error) {
      if (!stopped) jobs.fail(job, String((error as Error)?.message ?? error), Math.min(300_000, 5000 * 2 ** Math.min(job.attempts - 1, 6)));
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
      if (active) jobs.fail(active, 'Index rebuild interrupted; retry pending.', 0);
      abort.abort();
    }
  };
};
