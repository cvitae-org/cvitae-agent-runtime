import { CvContextError } from '../../src/contracts/index.js';
import { createCvContextStore } from '../../src/storage/sqlite/cv-contexts.js';
import { open } from '../../src/storage/sqlite/open.js';
const [path, id] = process.argv.slice(2);
if (!path || !id) throw new Error('usage: context-worker.ts <db> <contextId>');
const db = open(path);
try {
  createCvContextStore(db).create(id, 'pl');
  process.stdout.write('created');
} catch (error) {
  if (!(error instanceof CvContextError)) throw error;
  process.stdout.write(error.code);
} finally { db.close(); }
