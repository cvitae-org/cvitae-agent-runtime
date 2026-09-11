import { createHash } from 'node:crypto';
import { CvContextError } from '../../contracts/index.js';
import type { CvContextStore, DocumentStore } from '../../contracts/index.js';
import { CV_PHOTO_ID, CV_PHOTO_KIND, cvPhotoSchema, asStorablePhoto, asCvPhotoBody, type CvPhoto } from '../../capabilities/cv/photo.js';
import type { Db } from './open.js';

export const createContextPhotos = (db: Db, contexts: CvContextStore, documents: DocumentStore, now = Date.now) => {
  const context = (id: string) => {
    const value = contexts.get(id);
    if (!value) throw new CvContextError('context_not_found', `No such CV context: ${id}`);
    return value;
  };
  const asset = () => {
    const record = documents.read(CV_PHOTO_ID);
    return { revision: record?.revision ?? 0, ...asCvPhotoBody(record?.body) };
  };
  const retry = <T>(operationId: string, request: unknown, perform: () => T): T => {
    if (!operationId.trim() || operationId.length > 200) throw new CvContextError('invalid_input', 'A photo operation requires an operation ID.');
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const receipt = db.prepare('SELECT request, result FROM cv_photo_receipts WHERE operation_id = ?').get(operationId) as { request: string; result: string } | undefined;
    if (receipt) {
      if (receipt.request !== digest) throw new CvContextError('context_conflict', 'Operation ID belongs to a different photo request.');
      return JSON.parse(receipt.result) as T;
    }
    const result = perform();
    db.prepare('INSERT INTO cv_photo_receipts VALUES (?, ?, ?)').run(operationId, digest, JSON.stringify(result));
    return result;
  };
  return {
    asset,
    snapshot: db.transaction((id: string) => {
      const selected = context(id);
      const shared = asset();
      return { context: selected, assetRevision: shared.revision, photo: selected.includePhoto ? shared.photo : null };
    }).deferred,
    replace: db.transaction((photo: CvPhoto | null, expectedRevision: number, operationId: string) => {
      const value = photo === null ? null : asStorablePhoto(cvPhotoSchema.parse(photo));
      return retry(operationId, ['asset', expectedRevision, value], () => {
        const record = documents.update(CV_PHOTO_ID, CV_PHOTO_KIND, () => ({ photo: value }), { expectedRevision });
        return { revision: record.revision, ...asCvPhotoBody(record.body) };
      });
    }).immediate,
    include: db.transaction((id: string, includePhoto: boolean, expectedRevision: number, operationId: string) => {
      if (typeof includePhoto !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new CvContextError('invalid_input', 'Photo inclusion requires a boolean and metadata revision.');
      }
      return retry(operationId, ['inclusion', id, includePhoto, expectedRevision], () => {
        const selected = context(id);
        if (selected.revision !== expectedRevision) throw new CvContextError('context_conflict', 'CV settings changed since this operation started.');
        db.prepare('UPDATE cv_contexts SET include_photo = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
          .run(includePhoto ? 1 : 0, now(), id);
        return context(id);
      });
    }).immediate
  };
};
