/**
 * The lost update, inverted.
 *
 * The previous runtime's read-merge-write reproduced a rejected write in twenty
 * of twenty concurrent pairs, and the rejection was the *lucky* outcome — the
 * silent one was two extractions reading the same revision and the second
 * overwriting the first's section. This asserts the opposite: a hundred blind
 * increments from four processes leave a counter reading exactly one hundred.
 *
 * It has to be four processes rather than four handles. better-sqlite3 is
 * synchronous, so two connections in one process cannot interleave and a
 * single-process version of this test would pass against the broken
 * implementation too.
 *
 * Confirmed by removing the guard: with the transaction left DEFERRED the run
 * dies on `SQLITE_BUSY_SNAPSHOT`, because a transaction that starts reading and
 * then asks to write cannot have its snapshot upgraded — `busy_timeout` has
 * nothing to wait for. That is the failure `.immediate` exists to prevent.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDocumentStore } from '../src/storage/sqlite/document-store.js';
import { scratch } from './support/db.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

test('concurrent updates serialise, and none is lost', async () => {
  const s = scratch();
  const documents = createDocumentStore(s.db);

  try {
    const writers = 4;
    const each = 25;

    await Promise.all(
      Array.from({ length: writers }, () =>
        run(process.execPath, [
          '--import',
          'tsx',
          join(here, 'support/worker.ts'),
          'document',
          s.path,
          'shared',
          String(each)
        ])
      )
    );

    const record = documents.read('shared');
    assert.ok(record, 'the first writer to arrive creates the document');
    assert.equal(
      record.body.n,
      writers * each,
      'every increment read the value the previous one wrote'
    );

    // One revision per successful update, and the first one is the insert.
    assert.equal(record.revision, writers * each);
  } finally {
    s.dispose();
  }
});

test('the mutator sees the stored body, and a throw inside it changes nothing', () => {
  const s = scratch();
  const documents = createDocumentStore(s.db);

  try {
    const created = documents.update('cv', 'cv', () => ({ sections: ['a'] }));
    assert.equal(created.revision, 1);

    const seen: (unknown | undefined)[] = [];
    documents.update('cv', 'cv', (current) => {
      seen.push(current);
      return { sections: [...(current?.sections as string[]), 'b'] };
    });
    assert.deepEqual(seen, [{ sections: ['a'] }]);

    // A mutator that throws — a bad merge, a schema check — must leave the
    // document exactly as it was, not half-merged.
    assert.throws(() =>
      documents.update('cv', 'cv', () => {
        throw new Error('bad merge');
      })
    );

    const after = documents.read('cv');
    assert.deepEqual(after?.body, { sections: ['a', 'b'] });
    assert.equal(after?.revision, 2);
  } finally {
    s.dispose();
  }
});
