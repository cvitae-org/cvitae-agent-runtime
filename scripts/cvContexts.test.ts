import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CvContextError, type CvLanguage } from '../src/contracts/index.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createDocumentStore } from '../src/storage/sqlite/document-store.js';
import { createConversationStore } from '../src/storage/sqlite/conversations.js';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { scratch } from './support/db.js';

test('fresh storage has absent versions; creation and retry never reset content', () => {
  const s = scratch();
  try {
    const contexts = createCvContextStore(s.db);
    const documents = createDocumentStore(s.db);
    assert.deepEqual(contexts.list(), []);
    const id = randomUUID();
    const pl = contexts.create(id, 'pl');
    assert.equal(documents.read(id), undefined, 'empty context has document revision zero');
    const written = documents.update(id, 'cv', () => ({ summary: 'keep me' }));
    assert.deepEqual(contexts.create(id, 'pl'), pl);
    assert.deepEqual(documents.read(id), written);
    assert.throws(() => contexts.create(id, 'en'), { code: 'context_conflict' });
    assert.throws(() => contexts.create(randomUUID(), 'pl'), { code: 'language_in_use' });
    contexts.create(randomUUID(), 'en');
    assert.equal(contexts.list().length, 2);
    for (const bad of ['cv', 'cv_photo', '', 'PL']) {
      assert.throws(() => contexts.create(bad, 'pl'), { code: 'invalid_input' });
    }
    assert.throws(() => contexts.create(randomUUID(), 'de' as CvLanguage), { code: 'invalid_input' });
    assert.throws(() => s.db.prepare(`INSERT INTO cv_contexts
      (id, language, created_at, updated_at) VALUES ('extra', 'pl', 0, 0)`).run(), /UNIQUE/);
    assert.throws(() => s.db.prepare(`INSERT INTO cv_contexts
      (id, language, created_at, updated_at) VALUES ('unassigned', NULL, 0, 0)`).run(), /CHECK/);
  } finally { s.dispose(); }
});

test('legacy migration preserves documents, photo, transcripts, summaries, and source metadata', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((m) => m.version <= 8));
    const documents = createDocumentStore(db);
    documents.update('cv', 'cv', () => ({ role_description: 'Existing CV', sources: [{ id: 'source-1' }] }));
    documents.update('cv_photo', 'cv_photo', () => ({ photo: { base64: 'preserved' } }));
    // Seed the historical schema directly; current stores require current migrations.
    db.exec(`INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at, summary, summarised_through)
      VALUES ('legacy-chat', 'profile', '', 1, 2, 'Existing summary', 1);
      INSERT INTO messages (conversation_id, seq, id, role, text, created_at)
      VALUES ('legacy-chat', 1, 'legacy-message', 'user', 'Existing conversation', 2);`);
    const before = ['documents', 'conversations', 'messages'].map((table) =>
      db.prepare(`SELECT * FROM ${table}`).all());
    migrate(db);
    migrate(db);
    assert.deepEqual(['documents', 'conversations', 'messages'].map((table) =>
      db.prepare(`SELECT * FROM ${table}`).all()), before);
    const contexts = createCvContextStore(db);
    assert.equal(contexts.list().length, 1);
    assert.equal(contexts.get('cv')?.language, null);
    assert.throws(() => contexts.create(randomUUID(), 'en'), { code: 'language_assignment_required' });
    const assigned = contexts.assignLanguage('cv', 'pl', 1);
    assert.equal(assigned.revision, 2);
    assert.deepEqual(contexts.assignLanguage('cv', 'pl', 1), assigned, 'lost-response retry is safe');
    assert.throws(() => contexts.assignLanguage('cv', 'en', 2), { code: 'context_conflict' });
    assert.deepEqual(['documents', 'conversations', 'messages'].map((table) =>
      db.prepare(`SELECT * FROM ${table}`).all()), before);
    contexts.create(randomUUID(), 'en');
    assert.equal(contexts.list().length, 2);
  } finally { db.close(); }
});

test('photo-only and chat-only legacy databases migrate without inventing content', () => {
  for (const source of ['photo', 'chat']) {
    const db = open(':memory:');
    try {
      migrate(db, migrations.filter((m) => m.version <= 8));
      if (source === 'photo') createDocumentStore(db).update('cv_photo', 'cv_photo', () => ({ photo: null }));
      else db.exec("INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES ('legacy-chat', 'profile', '', 1, 1)");
      migrate(db);
      assert.equal(createCvContextStore(db).get('cv')?.language, null);
      assert.equal(createDocumentStore(db).read('cv'), undefined);
    } finally { db.close(); }
  }
});

test('legacy inserts after migration register once without resetting language assignment', () => {
  const s = scratch();
  try {
    const contexts = createCvContextStore(s.db);
    createConversationStore(s.db).create({ kind: 'offer', id: 'offer-1' });
    assert.deepEqual(contexts.list(), []);
    createConversationStore(s.db).create({ kind: 'profile', id: '' });
    assert.equal(contexts.get('cv')?.language, null);
    const assigned = contexts.assignLanguage('cv', 'en', 1);
    createDocumentStore(s.db).update('cv', 'cv', () => ({}));
    createDocumentStore(s.db).update('cv_photo', 'cv_photo', () => ({}));
    assert.deepEqual(contexts.get('cv'), assigned);
  } finally { s.dispose(); }
});

test('failed migration rolls back registry and triggers; retry succeeds', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((m) => m.version <= 8));
    const step = migrations.find((m) => m.version === 9)!;
    assert.throws(() => migrate(db, [{ version: 9, sql: `${step.sql}\nSELECT missing_column;` }]));
    assert.equal(db.pragma('user_version', { simple: true }), 8);
    assert.deepEqual(db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE 'cv_context%'`).all(), []);
    migrate(db);
    createDocumentStore(db).update('cv', 'cv', () => ({}));
    assert.equal(createCvContextStore(db).list().length, 1);
  } finally { db.close(); }
});

test('assignment rejects stale metadata, missing contexts and occupied languages', () => {
  const s = scratch();
  try {
    const contexts = createCvContextStore(s.db);
    const id = randomUUID();
    contexts.create(id, 'pl');
    createDocumentStore(s.db).update('cv', 'cv', () => ({}));
    assert.throws(() => contexts.assignLanguage('cv', 'en', 2), { code: 'context_conflict' });
    assert.throws(() => contexts.assignLanguage('cv', 'pl', 1), { code: 'language_in_use' });
    assert.throws(() => contexts.assignLanguage('missing', 'en', 1), { code: 'context_not_found' });
    assert.throws(() => contexts.assignLanguage('cv', 'en', 0), { code: 'invalid_input' });
    assert.equal(contexts.get('cv')?.language, null);
  } finally { s.dispose(); }
});

test('separate processes cannot create duplicate language contexts', async () => {
  const s = scratch();
  try {
    const run = promisify(execFile);
    const worker = fileURLToPath(new URL('./support/context-worker.ts', import.meta.url));
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      run(process.execPath, ['--import', 'tsx', worker, s.path, randomUUID()])));
    assert.equal(results.filter(({ stdout }) => stdout === 'created').length, 1);
    assert.equal(results.filter(({ stdout }) => stdout === 'language_in_use').length, 3);
    assert.equal(createCvContextStore(s.db).list().length, 1);
  } finally { s.dispose(); }
});

test('new context IDs cannot adopt unrelated stored documents', () => {
  const s = scratch();
  try {
    const id = randomUUID();
    createDocumentStore(s.db).update(id, 'unrelated', () => ({}));
    assert.throws(() => createCvContextStore(s.db).create(id, 'pl'), CvContextError);
    assert.deepEqual(createCvContextStore(s.db).list(), []);
  } finally { s.dispose(); }
});
