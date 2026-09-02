/**
 * A separate process that writes to a database the test also has open.
 *
 * Necessary because better-sqlite3 is synchronous: two connections inside one
 * process cannot interleave, so a single-process test of concurrent writes
 * proves only that sequential writes work. Real contention needs real
 * processes, and it is contention that BEGIN IMMEDIATE and busy_timeout exist
 * for.
 *
 *   worker.ts events   <db> <runId> <count>
 *   worker.ts document <db> <docId> <count>
 */

import { open } from '../../src/storage/sqlite/open.js';
import { createRunStore } from '../../src/storage/sqlite/run-store.js';
import { createDocumentStore } from '../../src/storage/sqlite/document-store.js';

const [mode, path, target, countRaw] = process.argv.slice(2);

if (!mode || !path || !target || !countRaw) {
  throw new Error('usage: worker.ts <events|document> <db> <target> <count>');
}

const count = Number(countRaw);
const db = open(path);

try {
  if (mode === 'events') {
    const runs = createRunStore(db);
    for (let i = 0; i < count; i += 1) {
      runs.checkpoint({ runId: target }, [
        { at: Date.now(), type: 'step.started', data: { pid: process.pid, i } }
      ]);
    }
  } else {
    const documents = createDocumentStore(db);
    for (let i = 0; i < count; i += 1) {
      documents.update(target, 'counter', (current) => ({
        n: typeof current?.n === 'number' ? current.n + 1 : 1
      }));
    }
  }
} finally {
  db.close();
}
