/**
 * A throwaway database per test, on disk rather than in memory.
 *
 * `:memory:` would be faster and would not test the thing that matters: WAL is
 * a file-level journal mode and a second connection to `:memory:` is a second
 * database. Every test here that opens two connections needs a real file.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../../src/storage/sqlite/open.js';
import { open } from '../../src/storage/sqlite/open.js';
import { migrate } from '../../src/storage/sqlite/migrate.js';

export type Scratch = {
  readonly path: string;
  readonly db: Db;
  connect(): Db;
  dispose(): void;
};

export const scratch = (): Scratch => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-'));
  const path = join(dir, 'harness.db');
  const extra: Db[] = [];

  const db = open(path);
  migrate(db);

  return {
    path,
    db,
    connect() {
      const another = open(path);
      extra.push(another);
      return another;
    },
    dispose() {
      for (const handle of extra) handle.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

/** A run row, so the foreign keys on events and steps have something to point at. */
export const seedRun = (db: Db, id = 'run-1'): string => {
  db.prepare(
    `INSERT INTO runs (id, capability, status, input, trace_id, created_at)
     VALUES (?, 'noop', 'running', '{}', 'trace-1', ?)`
  ).run(id, Date.now());
  return id;
};

/** A document row, so the foreign key on chunks has something to point at. */
export const seedDocument = (db: Db, id = 'cv-1', kind = 'cv'): string => {
  const at = Date.now();
  db.prepare(
    `INSERT INTO documents (id, kind, revision, body, created_at, updated_at)
     VALUES (?, ?, 1, '{}', ?, ?)`
  ).run(id, kind, at, at);
  return id;
};
