import { CvContextError } from '../contracts/index.js';
import type { ChunkIndex, DocumentStore, Retriever } from '../contracts/index.js';
import { CV_ID, CV_KIND } from '../capabilities/cv/document.js';

/** Capabilities use the canonical CV alias; storage sees only the captured ID. */
export const bindCvScope = (
  contextId: string,
  ports: { documents: DocumentStore; retrieval: Retriever; index: ChunkIndex },
  guard: <T>(write: () => T) => T = (write) => write()
): typeof ports => {
  const destination = (id?: string): string => {
    if (id !== undefined && id !== CV_ID && id !== contextId) {
      throw new CvContextError('context_conflict', 'The run cannot access another CV context.');
    }
    return contextId;
  };
  return {
    documents: {
      read: (id) => ports.documents.read(destination(id)),
      update: (id, kind, mutate, options) => {
        if (kind !== CV_KIND) throw new CvContextError('context_conflict', 'A CV-scoped run can only write CV content.');
        return guard(() => ports.documents.update(destination(id), kind, mutate, options));
      }
    },
    retrieval: {
      search: async (query, signal) => {
        const id = destination(query.documentId);
        const hits = await ports.retrieval.search({ ...query, documentId: id }, signal);
        // Embedding the query awaits a model. Reject results invalidated while
        // that happened, including custom retrievers that retained old hits.
        const revision = ports.documents.read(id)?.revision;
        return hits.filter((hit) => revision !== undefined && hit.documentId === id && hit.sourceRevision === revision);
      }
    },
    index: {
      lexical: (query) => ports.index.lexical({ ...query, documentId: destination(query.documentId) }),
      neighbours: (query) => ports.index.neighbours({ ...query, documentId: destination(query.documentId) }),
      fingerprintOf: (id) => ports.index.fingerprintOf(destination(id)),
      clear: (id, options) => {
        if (!options) throw new CvContextError('invalid_input', 'Index publication requires its source revision.');
        return guard(() => ports.index.clear(destination(id), options));
      },
      replace: (id, fingerprint, chunks, options) => {
        if (!options) throw new CvContextError('invalid_input', 'Index publication requires its source revision.');
        return guard(() => ports.index.replace(destination(id), fingerprint, chunks, options));
      }
    }
  };
};
