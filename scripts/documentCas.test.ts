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
import { DocumentConflictError } from '../src/contracts/document-store.js';
import { scratch } from './support/db.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

test('a stale editor or proposal cannot replace a newer document', () => {
  const s = scratch();
  const documents = createDocumentStore(s.db);
  const another = createDocumentStore(s.connect());
  try {
    const base = documents.update('pl', 'cv', () => ({ summary: 'original' }));
    const newer = another.update('pl', 'cv', () => ({ summary: 'manual edit' }), {
      expectedRevision: base.revision
    });
    let invoked = false;
    assert.throws(() => documents.update('pl', 'cv', () => {
      invoked = true;
      return { summary: 'stale proposal' };
    }, { expectedRevision: base.revision }), (error: unknown) => {
      assert.ok(error instanceof DocumentConflictError);
      assert.equal(error.code, 'document_conflict');
      assert.equal(error.documentId, 'pl');
      assert.equal(error.expectedRevision, base.revision);
      assert.equal(error.actualRevision, newer.revision);
      return true;
    });
    assert.equal(invoked, false, 'a rejected write must not run the mutator');
    assert.deepEqual(documents.read('pl'), newer);
  } finally {
    s.dispose();
  }
});

test('revision zero means absent, and a missing positive base is a conflict', () => {
  const s = scratch();
  const documents = createDocumentStore(s.db);
  try {
    assert.throws(() => documents.update('pl', 'cv', () => ({}), {
      expectedRevision: 1
    }), (error: unknown) => error instanceof DocumentConflictError && error.actualRevision === 0);
    assert.equal(documents.read('pl'), undefined);
    const created = documents.update('pl', 'cv', () => ({ summary: 'first' }), {
      expectedRevision: 0
    });
    assert.equal(created.revision, 1);
    assert.throws(() => documents.update('pl', 'cv', () => ({}), {
      expectedRevision: 0
    }), DocumentConflictError);
    assert.deepEqual(documents.read('pl'), created);
  } finally {
    s.dispose();
  }
});

test('revision checks are independent per document and reject invalid bases', () => {
  const s = scratch();
  const documents = createDocumentStore(s.db);
  try {
    const pl = documents.update('pl', 'cv', () => ({ summary: 'Polski' }));
    const en = documents.update('en', 'cv', () => ({ summary: 'English' }));
    documents.update('pl', 'cv', () => ({ summary: 'Changed' }), { expectedRevision: pl.revision });
    const saved = documents.update('en', 'cv', () => ({ summary: 'Independent' }), {
      expectedRevision: en.revision
    });
    assert.equal(saved.revision, 2);
    for (const expectedRevision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => documents.update('en', 'cv', () => ({}), { expectedRevision }), RangeError);
    }
    assert.deepEqual(documents.read('en'), saved);
  } finally {
    s.dispose();
  }
});

test('a conflict rolls back the surrounding transaction and successful checked writes remain usable', () => {
  const s = scratch();
  const documents = createDocumentStore(s.db);
  try {
    const base = documents.update('pl', 'cv', () => ({ summary: 'original' }));
    const mutate = s.db.transaction(() => {
      documents.update('en', 'cv', () => ({ summary: 'must roll back' }));
      documents.update('pl', 'cv', () => ({}), { expectedRevision: 0 });
    });
    assert.throws(() => mutate(), DocumentConflictError);
    assert.equal(documents.read('en'), undefined);
    assert.deepEqual(documents.read('pl'), base);
    assert.throws(() => documents.update('pl', 'cv', () => {
      throw new Error('invalid content');
    }, { expectedRevision: base.revision }), /invalid content/);
    assert.deepEqual(documents.read('pl'), base);
    assert.equal(documents.update('pl', 'cv', () => ({}), {
      expectedRevision: base.revision
    }).revision, base.revision + 1);
  } finally {
    s.dispose();
  }
});

test('competing processes with the same base have exactly one winner, including creation', async () => {
  const s = scratch();
  const documents = createDocumentStore(s.db);
  try {
    for (const expected of [0, 1]) {
      const results = await Promise.all(Array.from({ length: 4 }, () => run(process.execPath, [
        '--import', 'tsx', join(here, 'support/revision-worker.ts'), s.path, 'shared', String(expected)
      ])));
      const statuses = results.map(({ stdout }) => stdout.trim());
      assert.equal(statuses.filter((status) => status === 'saved').length, 1);
      assert.equal(statuses.filter((status) => status === 'conflict').length, 3);
      assert.equal(documents.read('shared')?.revision, expected + 1);
    }
  } finally {
    s.dispose();
  }
});

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
