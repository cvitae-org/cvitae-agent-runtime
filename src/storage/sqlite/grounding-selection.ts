/**
 * `SelectionStore` over SQLite.
 *
 * Every change is one immediate transaction that checks the revision, applies
 * the change and moves the revision, so a change is either all of it against the
 * revision the caller saw or none of it. Reading the revision and writing in two
 * steps would let two windows each pass the check and then each write.
 */

import { OperationError, MAX_EXCLUSIONS, MAX_PINS } from '../../contracts/index.js';
import type { PieceRef, Selection, SelectionChange, SelectionStore } from '../../contracts/index.js';
import { parseRef } from '../../grounding/index.js';
import type { Db } from './open.js';

const EXCLUDE = 'exclude';

export const createSelectionStore = (db: Db): SelectionStore => {
  const revisionOf = db.prepare<[string]>(
    'SELECT revision FROM grounding_selection_revision WHERE conversation_id = ?'
  );
  const setRevision = db.prepare<[string, number]>(
    `INSERT INTO grounding_selection_revision (conversation_id, revision) VALUES (?, ?)
     ON CONFLICT (conversation_id) DO UPDATE SET revision = excluded.revision`
  );
  const refsOf = db.prepare<[string, string]>(
    'SELECT ref FROM grounding_selection WHERE conversation_id = ? AND kind = ? ORDER BY ordinal'
  );
  const insert = db.prepare<[string, string, string, number]>(
    `INSERT INTO grounding_selection (conversation_id, ref, kind, ordinal) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  );
  const lastOrdinal = db.prepare<[string]>(
    'SELECT coalesce(max(ordinal), 0) AS last FROM grounding_selection WHERE conversation_id = ?'
  );
  const remove = db.prepare<[string, string, string]>(
    'DELETE FROM grounding_selection WHERE conversation_id = ? AND ref = ? AND kind = ?'
  );
  const pinsOf = db.prepare<[string]>('SELECT ref FROM grounding_pin WHERE conversation_id = ? ORDER BY ordinal');
  const insertPin = db.prepare<[string, string, number]>(
    `INSERT INTO grounding_pin (conversation_id, ref, ordinal) VALUES (?, ?, ?)
     ON CONFLICT DO NOTHING`
  );
  const lastPin = db.prepare<[string]>(
    'SELECT coalesce(max(ordinal), 0) AS last FROM grounding_pin WHERE conversation_id = ?'
  );
  const removePin = db.prepare<[string, string]>(
    'DELETE FROM grounding_pin WHERE conversation_id = ? AND ref = ?'
  );

  const read = (conversationId: string): Selection => {
    const row = revisionOf.get(conversationId) as { revision: number } | undefined;
    const refs = (refsOf.all(conversationId, EXCLUDE) as { ref: string }[]).map((entry) => entry.ref);
    const pinned = (pinsOf.all(conversationId) as { ref: string }[]).map((entry) => entry.ref);
    return { conversationId, revision: row?.revision ?? 0, exclude: refs, pin: pinned };
  };

  const change = db.transaction(
    (conversationId: string, request: SelectionChange): { applied: boolean; selection: Selection } => {
      const before = read(conversationId);
      if (before.revision !== request.expectedRevision) return { applied: false, selection: before };

      const revision = before.revision + 1;
      let changed = 0;
      for (const ref of request.clear) changed += remove.run(conversationId, ref, EXCLUDE).changes;
      for (const ref of request.unpin ?? []) changed += removePin.run(conversationId, ref).changes;
      // Counted from the largest still there, so a ref cleared and excluded again goes last.
      let ordinal = (lastOrdinal.get(conversationId) as { last: number }).last;
      for (const ref of request.exclude) {
        const added = insert.run(conversationId, ref, EXCLUDE, ordinal + 1).changes;
        ordinal += added;
        changed += added;
      }
      // The same count from the largest still there, in a table of their own.
      let pinOrdinal = (lastPin.get(conversationId) as { last: number }).last;
      for (const ref of request.pin ?? []) {
        const added = insertPin.run(conversationId, ref, pinOrdinal + 1).changes;
        pinOrdinal += added;
        changed += added;
      }
      if (changed === 0) return { applied: true, selection: before };

      const after = read(conversationId);
      // Thrown inside the transaction, so every row written above is undone.
      if (after.exclude.length > MAX_EXCLUSIONS) {
        throw new OperationError(
          'selection_limit',
          `A conversation can exclude at most ${MAX_EXCLUSIONS} pieces. Exclude a section instead of each of its items.`
        );
      }
      if (after.pin.length > MAX_PINS) {
        throw new OperationError(
          'selection_limit',
          `A conversation can pin at most ${MAX_PINS} pieces. Unpin one before pinning another.`
        );
      }

      setRevision.run(conversationId, revision);
      return { applied: true, selection: { ...after, revision } };
    }
  ).immediate;

  return {
    read: (conversationId) => db.transaction(() => read(conversationId))(),
    change: (conversationId, request) => change(conversationId, request),
    walls: (conversationId): readonly PieceRef[] =>
      (refsOf.all(conversationId, EXCLUDE) as { ref: string }[]).map((entry) => parseRef(entry.ref)),
    pins: (conversationId): readonly PieceRef[] =>
      (pinsOf.all(conversationId) as { ref: string }[]).map((entry) => parseRef(entry.ref))
  };
};
