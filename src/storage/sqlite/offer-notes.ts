import type { Db } from './open.js';
import { OperationError } from '../../contracts/index.js';
export const createOfferNotes = (db: Db, now = Date.now) => {
  const exists = db.prepare('SELECT id FROM offers WHERE id=?');
  const read = db.prepare('SELECT text, revision, updated_at AS updatedAt FROM offer_notes WHERE offer_id=?');
  const get = (offerId: string): { text: string; revision: number; updatedAt: number | null } => {
    if (!exists.get(offerId)) throw new OperationError('offer_missing', 'This offer is no longer stored.');
    return read.get(offerId) as ReturnType<typeof get> | undefined ?? { text: '', revision: 0, updatedAt: null };
  };
  return { get, save: db.transaction((offerId: string, text: string, revision: number) => {
    if (text.length > 10000 || !Number.isSafeInteger(revision) || revision < 0) throw new OperationError('invalid_note', 'Invalid note.');
    const current = get(offerId);
    // A replay after a lost response is safe; a different stale edit is rejected.
    if (current.text === text && current.revision === revision + 1) return current;
    if (current.revision !== revision) throw new OperationError('note_conflict', 'This note changed elsewhere. Reload the saved note before saving.');
    db.prepare(`INSERT INTO offer_notes(offer_id,text,revision,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(offer_id) DO UPDATE SET text=excluded.text, revision=excluded.revision, updated_at=excluded.updated_at`)
      .run(offerId, text, revision + 1, now());
    // Empty text is a revisioned tombstone, so stale clients cannot resurrect a deleted note.
    return get(offerId);
  }).immediate };
};
