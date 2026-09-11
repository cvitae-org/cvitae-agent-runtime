import { CvContextError } from '../../contracts/index.js';
import type { CaptureOfferSnapshot, OfferSnapshot, OfferSnapshotStore, CvContextStore, DocumentStore, OfferStore, ConversationStore } from '../../contracts/index.js';
import { asCvPhotoBody, CV_PHOTO_ID } from '../../capabilities/cv/photo.js';
import type { Db } from './open.js';

export const createOfferSnapshots = (db: Db, contexts: CvContextStore, documents: DocumentStore,
  offers: OfferStore, conversations: ConversationStore, now = Date.now): OfferSnapshotStore => {
  const get = (id: string): OfferSnapshot | undefined => {
    const row = db.prepare('SELECT snapshot FROM offer_snapshots WHERE id = ?').get(id) as { snapshot: string } | undefined;
    return row ? JSON.parse(row.snapshot) as OfferSnapshot : undefined;
  };
  return {
    get,
    list: (offerId, contextId) => {
      const rows = contextId === undefined
        ? db.prepare('SELECT snapshot FROM offer_snapshots WHERE offer_id = ? ORDER BY created_at DESC, id').all(offerId)
        : db.prepare('SELECT snapshot FROM offer_snapshots WHERE offer_id = ? AND context_id = ? ORDER BY created_at DESC, id').all(offerId, contextId);
      return (rows as { snapshot: string }[]).map((row) => JSON.parse(row.snapshot) as OfferSnapshot);
    },
    capture: db.transaction((request: CaptureOfferSnapshot): OfferSnapshot => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(request.id) ||
          ![request.expectedRevision, request.expectedContextRevision, request.expectedPhotoRevision]
            .every((n) => Number.isSafeInteger(n) && n >= 0)) {
        throw new CvContextError('invalid_input', 'Snapshot capture requires a UUID and original revisions.');
      }
      const key = JSON.stringify([request.offerId, request.contextId, request.expectedRevision,
        request.expectedContextRevision, request.expectedPhotoRevision]);
      const existing = db.prepare('SELECT request FROM offer_snapshots WHERE id = ?').get(request.id) as { request: string } | undefined;
      if (existing) {
        if (existing.request !== key) throw new CvContextError('context_conflict', 'Snapshot ID belongs to a different request.');
        return get(request.id)!;
      }
      const context = contexts.get(request.contextId);
      if (!context) throw new CvContextError('context_not_found', 'No such CV context.');
      if (context.language === null) throw new CvContextError('language_assignment_required', 'Assign the CV language before capturing offer work.');
      const document = documents.read(request.contextId);
      const asset = documents.read(CV_PHOTO_ID);
      if (!document || document.revision !== request.expectedRevision || context.revision !== request.expectedContextRevision ||
          (asset?.revision ?? 0) !== request.expectedPhotoRevision) {
        throw new CvContextError('context_conflict', 'CV or photo changed before snapshot capture.');
      }
      const offer = offers.get(request.offerId);
      if (!offer) throw new CvContextError('context_not_found', 'No such offer.');
      // A new snapshot always gets a new conversation. Existing offer history is never rebound.
      const conversation = conversations.create({ kind: 'offer', id: request.offerId });
      const snapshot: OfferSnapshot = { id: request.id, conversationId: conversation.id,
        context, document, offer, photo: { revision: asset?.revision ?? 0,
          photo: context.includePhoto ? asCvPhotoBody(asset?.body).photo : null }, createdAt: now() };
      db.prepare('INSERT INTO offer_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)').run(request.id, request.offerId,
        context.id, conversation.id, key, JSON.stringify(snapshot), snapshot.createdAt);
      return get(request.id)!;
    }).immediate
  };
};
