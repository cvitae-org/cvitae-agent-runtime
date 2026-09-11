/** Competing callers carrying the same editor base into independent processes. */
import { DocumentConflictError } from '../../src/contracts/document-store.js';
import { createDocumentStore } from '../../src/storage/sqlite/document-store.js';
import { open } from '../../src/storage/sqlite/open.js';

const [path, target, expected] = process.argv.slice(2);
if (!path || !target || expected === undefined) {
  throw new Error('usage: revision-worker.ts <db> <documentId> <expectedRevision>');
}
const db = open(path);
try {
  createDocumentStore(db).update(target, 'cv', () => ({ writer: process.pid }), {
    expectedRevision: Number(expected)
  });
  process.stdout.write('saved');
} catch (error) {
  if (!(error instanceof DocumentConflictError)) throw error;
  process.stdout.write('conflict');
} finally {
  db.close();
}
