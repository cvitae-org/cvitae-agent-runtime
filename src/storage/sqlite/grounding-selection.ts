/**
 * `SelectionStore` over SQLite.
 *
 * Every change is one immediate transaction that checks the revision, applies
 * the change and moves the revision, so a change is either all of it against the
 * revision the caller saw or none of it. Reading the revision and writing in two
 * steps would let two windows each pass the check and then each write.
 */

import { OperationError, MAX_EXCLUSIONS } from '../../contracts/index.js';
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

  const read = (conversationId: string): Selection => {
    const row = revisionOf.get(conversationId) as { revision: number } | undefined;
    const refs = (refsOf.all(conversationId, EXCLUDE) as { ref: string }[]).map((entry) => entry.ref);
    return { conversationId, revision: row?.revision ?? 0, exclude: refs };
  };

  const change = db.transaction(
    (conversationId: string, request: SelectionChange): { applied: boolean; selection: Selection } => {
      const before = read(conversationId);
      if (before.revision !== request.expectedRevision) return { applied: false, selection: before };

      const revision = before.revision + 1;
      let changed = 0;
      for (const ref of request.clear) changed += remove.run(conversationId, ref, EXCLUDE).changes;
      // Counted from the largest still there, so a ref cleared and excluded again goes last.
      let ordinal = (lastOrdinal.get(conversationId) as { last: number }).last;
      for (const ref of request.exclude) {
        const added = insert.run(conversationId, ref, EXCLUDE, ordinal + 1).changes;
        ordinal += added;
        changed += added;
      }
      if (changed === 0) return { applied: true, selection: before };

      const after = read(conversationId);
      if (after.exclude.length > MAX_EXCLUSIONS) {
        // Thrown inside the transaction, so every row written above is undone.
        throw new OperationError(
          'selection_limit',
          `A conversation can exclude at most ${MAX_EXCLUSIONS} pieces. Exclude a section instead of each of its items.`
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
      (refsOf.all(conversationId, EXCLUDE) as { ref: string }[]).map((entry) => parseRef(entry.ref))
  };
};
