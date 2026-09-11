import { CvContextError, DocumentConflictError } from '../../contracts/index.js';
import type { CopyCvContext, CvCopyReceipt, CvCopyStore, CvContextStore, DocumentStore } from '../../contracts/index.js';
import type { Db } from './open.js';

/** Sources are value metadata inside the copied document, never shared mutable rows. */
export const createCvCopies = (db: Db, contexts: CvContextStore, documents: DocumentStore, now = Date.now): CvCopyStore => {
  const get = (id: string): CvCopyReceipt | undefined => {
    const row = db.prepare('SELECT result FROM cv_copy_receipts WHERE context_id = ?').get(id) as { result: string } | undefined;
    return row ? JSON.parse(row.result) as CvCopyReceipt : undefined;
  };
  return { get, copy: db.transaction((request: CopyCvContext): CvCopyReceipt => {
    const key = JSON.stringify([request.language, request.sourceContextId, request.expectedSourceRevision]);
    const prior = db.prepare('SELECT request FROM cv_copy_receipts WHERE context_id = ?').get(request.id) as { request: string } | undefined;
    if (prior) {
      if (prior.request !== key) throw new CvContextError('context_conflict', 'Copy ID belongs to another request.');
      return get(request.id)!;
    }
    if (!Number.isSafeInteger(request.expectedSourceRevision) || request.expectedSourceRevision < 1) {
      throw new CvContextError('invalid_input', 'Copy requires the original source revision.');
    }
    const source = contexts.get(request.sourceContextId);
    if (!source) throw new CvContextError('context_not_found', 'No such source context.');
    if (source.language === null) throw new CvContextError('language_assignment_required', 'Assign the source language before copying.');
    const record = documents.read(source.id);
    if (record?.revision !== request.expectedSourceRevision) {
      throw new DocumentConflictError(source.id, request.expectedSourceRevision, record?.revision ?? 0);
    }
    if (contexts.get(request.id)) throw new CvContextError('context_conflict', 'Copy destination already exists.');
    const context = contexts.create(request.id, request.language);
    const copied = documents.update(context.id, record.kind, () => structuredClone(record.body), { expectedRevision: 0 });
    const receipt: CvCopyReceipt = { context, record: copied, provenance: {
      sourceContextId: source.id, sourceRevision: record.revision, copiedAt: now()
    } };
    db.prepare('INSERT INTO cv_copy_receipts VALUES (?, ?, ?)').run(request.id, key, JSON.stringify(receipt));
    return receipt;
  }).immediate };
};
