import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentStore } from '../src/storage/sqlite/document-store.js';
import { createChunkIndex } from '../src/storage/sqlite/chunk-index.js';
import { createRetriever } from '../src/retrieval/search.js';
import { bindCvScope } from '../src/runtime/cv-scope.js';
import { searchProfileTool } from '../src/tools/index.js';
import type { EffectSet, EmbeddingFingerprint, IndexedChunk } from '../src/contracts/index.js';
import { stubGateway } from './support/spine.js';
import { scratch } from './support/db.js';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';

const fingerprint: EmbeddingFingerprint = { provider: 'test', model: 'test', dim: 1, normalisation: 'l2', chunkerVersion: 1 };
const chunk = (text = 'Engineer works with TypeScript'): IndexedChunk => ({
  id: 'identical-content-id', kind: 'role', text, position: 0, vector: new Float32Array([1])
});
const signal = new AbortController().signal;

test('migration namespaces legacy chunk IDs without collisions or FTS loss and leaves unknown revisions stale', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((m) => m.version < 10));
    const documents = createDocumentStore(db);
    for (const id of ['doc-a', 'doc-b']) documents.update(id, 'cv', () => ({}));
    const insert = db.prepare(`INSERT INTO chunks
      (id, document_id, kind, text, search_text, meta, position, fingerprint, dim, vector, created_at)
      VALUES (?, ?, 'role', 'Engineer', 'engineer', '{}', 0, 'test·test·1·l2·c1', 1, ?, 1)`);
    insert.run('same', 'doc-a', Buffer.from(new Float32Array([1]).buffer));
    insert.run(JSON.stringify(['doc-a', 'same']), 'doc-b', Buffer.from(new Float32Array([1]).buffer));
    const step = migrations.find((m) => m.version === 10)!;
    const oldChunks = db.prepare('SELECT * FROM chunks ORDER BY document_id').all();
    assert.throws(() => migrate(db, [{ ...step, sql: `${step.sql}\nSELECT nonexistent_column;` }]));
    assert.equal(db.pragma('user_version', { simple: true }), 9);
    assert.deepEqual(db.prepare('SELECT * FROM chunks ORDER BY document_id').all(), oldChunks);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_temp_master WHERE name = 'cv_context_chunks'").all(), []);
    migrate(db);
    migrate(db);
    assert.equal(db.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'engineer'").all().length, 2);
    const rows = db.prepare('SELECT id, document_id, local_id, source_revision FROM chunks ORDER BY document_id').all();
    assert.deepEqual(rows, [
      { id: JSON.stringify(['doc-a', 'same']), document_id: 'doc-a', local_id: 'same', source_revision: null },
      { id: JSON.stringify(['doc-b', JSON.stringify(['doc-a', 'same'])]), document_id: 'doc-b', local_id: JSON.stringify(['doc-a', 'same']), source_revision: null }
    ]);
    const index = createChunkIndex(db);
    assert.deepEqual(index.lexical({ text: 'Engineer', limit: 4 }), []);
    index.replace('doc-a', fingerprint, [chunk()], { expectedRevision: 1 });
    assert.equal(index.lexical({ text: 'Engineer', limit: 4 }).length, 1);
  } finally { db.close(); }
});

test('identical copies index independently and fusion does not collapse their local chunk IDs', async () => {
  const s = scratch();
  try {
    const docs = createDocumentStore(s.db);
    const index = createChunkIndex(s.db);
    for (const id of ['pl', 'en']) {
      docs.update(id, 'cv', () => ({}));
      index.replace(id, fingerprint, [chunk()], { expectedRevision: 1 });
    }
    assert.equal((s.db.prepare('SELECT count(*) AS n FROM chunks').get() as { n: number }).n, 2);
    const reader = createRetriever({ reader: index, ai: stubGateway(), traceId: 'test' });
    const hits = await reader.search({ text: 'Engineer', lexicalOnly: true, limit: 4 }, signal);
    assert.deepEqual(hits.map((h) => h.documentId).sort(), ['en', 'pl']);
    index.clear('pl', { expectedRevision: 1 });
    assert.equal(index.lexical({ text: 'Engineer', documentId: 'en', limit: 4 }).length, 1);
  } finally { s.dispose(); }
});

test('late index publication and late empty clearing cannot replace a newer index', () => {
  const s = scratch();
  try {
    const docs = createDocumentStore(s.db);
    const index = createChunkIndex(s.db);
    docs.update('cv', 'cv', () => ({}));
    index.replace('cv', fingerprint, [chunk('Old Engineer')], { expectedRevision: 1 });
    docs.update('cv', 'cv', () => ({}));
    index.replace('cv', fingerprint, [chunk('Current Engineer')], { expectedRevision: 2 });
    assert.throws(() => index.replace('cv', fingerprint, [chunk('Late Engineer')], { expectedRevision: 1 }), { code: 'document_conflict' });
    assert.throws(() => index.clear('cv', { expectedRevision: 1 }), { code: 'document_conflict' });
    assert.equal(index.lexical({ text: 'Engineer', limit: 4 })[0]?.text, 'Current Engineer');
  } finally { s.dispose(); }
});

test('stale or unknown-revision rows are excluded from lexical, vector and fingerprint reads', () => {
  const s = scratch();
  try {
    const docs = createDocumentStore(s.db);
    const index = createChunkIndex(s.db);
    docs.update('cv', 'cv', () => ({}));
    index.replace('cv', fingerprint, [chunk()], { expectedRevision: 1 });
    docs.update('cv', 'cv', () => ({}));
    for (const reader of [index, createChunkIndex(s.connect())]) {
      assert.deepEqual(reader.lexical({ text: 'Engineer', limit: 4 }), []);
      assert.deepEqual(reader.neighbours({ vector: new Float32Array([1]), fingerprint, limit: 4 }), []);
      assert.equal(reader.fingerprintOf('cv'), undefined);
    }
    index.replace('cv', fingerprint, [chunk()], { expectedRevision: 2 });
    assert.equal(index.lexical({ text: 'Engineer', limit: 4 }).length, 1, 'rebuilding restores retrieval');
    s.db.prepare('UPDATE chunks SET source_revision = NULL').run();
    assert.deepEqual(index.lexical({ text: 'Engineer', limit: 4 }), []);
  } finally { s.dispose(); }
});

test('an edit while embedding a query cannot leak pre-edit lexical candidates', async () => {
  const s = scratch();
  try {
    const docs = createDocumentStore(s.db);
    const index = createChunkIndex(s.db);
    docs.update('cv', 'cv', () => ({}));
    index.replace('cv', fingerprint, [chunk()], { expectedRevision: 1 });
    const ai = stubGateway({ embed: async () => {
      docs.update('cv', 'cv', () => ({}));
      return { vectors: [new Float32Array([1])], provider: 'test', model: 'test', dim: 1 };
    } });
    const retrieval = createRetriever({ reader: index, ai, traceId: 'test' });
    assert.deepEqual(await retrieval.search({ text: 'Engineer', limit: 4 }, signal), []);
  } finally { s.dispose(); }
});

test('the default model search tool receives only its bound context', async () => {
  const s = scratch();
  try {
    const documents = createDocumentStore(s.db);
    const index = createChunkIndex(s.db);
    for (const id of ['pl', 'en']) {
      documents.update(id, 'cv', () => ({}));
      index.replace(id, fingerprint, [chunk(`${id} Engineer`) ], { expectedRevision: 1 });
    }
    const ai = stubGateway({ embed: async () => ({ vectors: [new Float32Array([1])], provider: 'test', model: 'test', dim: 1 }) });
    const retrieval = createRetriever({ reader: index, ai, traceId: 'test' });
    const scoped = bindCvScope('pl', { documents, retrieval, index });
    const result = await searchProfileTool.execute({ query: 'Engineer', limit: 4 }, {
      ...scoped, effects: {} as EffectSet, signal, traceId: 'test', runId: 'test', step: 'search'
    }) as { results: { text: string }[] };
    assert.deepEqual(result.results.map((r) => r.text), ['pl Engineer']);
    assert.throws(() => scoped.index.replace('cv', fingerprint, [chunk()]), { code: 'invalid_input' });
  } finally { s.dispose(); }
});
