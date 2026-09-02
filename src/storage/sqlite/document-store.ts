/**
 * `DocumentStore` over SQLite.
 *
 * The whole file exists to make one interleaving impossible. The previous
 * runtime read a document, merged into it, and wrote it back with nothing
 * holding the gap — and every write went through the same `<path>.<pid>.tmp`
 * filename, so two extractions running at once fought over the temp file as
 * well as the document. Twenty concurrent pairs produced twenty rejected
 * writes. Unique temp names would have removed the rejection and kept the lost
 * update, which is the worse of the two failures because nothing reports it.
 *
 * Here the read, the merge and the write happen inside one `BEGIN IMMEDIATE`,
 * with the revision checked on the way out. The mutator runs while the write
 * lock is held, which is why the interface says it must be pure — an effect in
 * there would be holding a database lock across a network call.
 */

import type {
  DocumentBody,
  DocumentRecord,
  DocumentStore
} from '../../contracts/index.js';
import type { Db } from './open.js';

type DocumentRow = {
  id: string;
  kind: string;
  revision: number;
  body: string;
  created_at: number;
  updated_at: number;
};

const toDocument = (row: DocumentRow): DocumentRecord => ({
  id: row.id,
  kind: row.kind,
  revision: row.revision,
  body: JSON.parse(row.body) as DocumentBody,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const createDocumentStore = (db: Db, now: () => number = Date.now): DocumentStore => {
  const select = db.prepare<[string]>('SELECT * FROM documents WHERE id = ?');

  const insert = db.prepare<[string, string, string, number, number]>(
    `INSERT INTO documents (id, kind, revision, body, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`
  );

  // The revision in the WHERE clause is the compare-and-swap. Inside a write
  // transaction it can never fail, which is the point: the guard is there so
  // that if this is ever called outside one, the write is rejected rather than
  // silently overwriting a concurrent change.
  const update = db.prepare<[string, number, string, number]>(
    `UPDATE documents SET body = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?`
  );

  const apply = db.transaction(
    (
      id: string,
      kind: string,
      mutate: (current: DocumentBody | undefined) => DocumentBody
    ): DocumentRecord => {
      const existing = select.get(id) as DocumentRow | undefined;
      const at = now();

      if (!existing) {
        const body = mutate(undefined);
        insert.run(id, kind, JSON.stringify(body), at, at);
        return { id, kind, revision: 1, body, createdAt: at, updatedAt: at };
      }

      const body = mutate(JSON.parse(existing.body) as DocumentBody);
      const result = update.run(JSON.stringify(body), at, id, existing.revision);

      if (result.changes !== 1) {
        throw new Error(
          `document ${id} changed underneath revision ${existing.revision}`
        );
      }

      return {
        id,
        kind: existing.kind,
        revision: existing.revision + 1,
        body,
        createdAt: existing.created_at,
        updatedAt: at
      };
    }
  ).immediate;

  return {
    read(id) {
      const row = select.get(id) as DocumentRow | undefined;
      return row ? toDocument(row) : undefined;
    },

    update(id, kind, mutate) {
      return apply(id, kind, mutate);
    }
  };
};
