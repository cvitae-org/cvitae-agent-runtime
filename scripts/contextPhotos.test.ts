import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../src/runtime/create.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { scratch } from './support/db.js';

const photo = { mime: 'image/png' as const, base64: 'iVBORw0KGgo=', width: 10, height: 10 };

test('shared photo inclusion is independent; metadata changes never edit content or create a legacy context', () => {
  const s = scratch();
  const contexts = createCvContextStore(s.db);
  const pl = contexts.create(randomUUID(), 'pl');
  const en = contexts.create(randomUUID(), 'en');
  const h = createHarness({ databasePath: s.path, env: {} });
  try {
    const content = h.profile.replaceContext(pl.id, { role_description: 'Keep content' }, 0).record;
    assert.equal(pl.includePhoto, false);
    h.photos.replace(photo, 0, 'upload');
    const enabled = h.photos.include(pl.id, true, pl.revision, 'enable');
    assert.equal(enabled.revision, pl.revision + 1);
    assert.deepEqual(h.photos.snapshot(pl.id).photo, photo);
    assert.equal(h.photos.snapshot(en.id).photo, null);
    assert.equal(h.cvContexts.get('cv'), undefined);
    assert.deepEqual(h.documents.read(pl.id), content);
    assert.throws(() => h.photos.include(pl.id, false, pl.revision, 'stale'), { code: 'context_conflict' });
    h.cvLifecycle.clearContent(pl.id, content.revision, 'clear');
    assert.deepEqual(h.photos.asset().photo, photo);
    assert.equal(h.cvContexts.get(en.id)?.revision, en.revision);
    assert.throws(() => h.photos.snapshot('missing'), { code: 'context_not_found' });
  } finally { h.close(); s.dispose(); }
});

test('photo replacement and inclusion receipts survive restart and preserve newer changes', () => {
  const s = scratch();
  const pl = createCvContextStore(s.db).create(randomUUID(), 'pl');
  let h = createHarness({ databasePath: s.path, env: {} });
  try {
    const upload = h.photos.replace(photo, 0, 'upload');
    const enabled = h.photos.include(pl.id, true, 1, 'enable');
    h.photos.include(pl.id, false, enabled.revision, 'disable');
    h.photos.replace(null, upload.revision, 'delete');
    h.close(); h = createHarness({ databasePath: s.path, env: {} });
    assert.deepEqual(h.photos.replace(photo, 0, 'upload'), upload);
    assert.deepEqual(h.photos.include(pl.id, true, 1, 'enable'), enabled);
    assert.equal(h.photos.asset().photo, null);
    assert.equal(h.cvContexts.get(pl.id)?.includePhoto, false);
    assert.throws(() => h.photos.replace(photo, 1, 'stale'), { code: 'document_conflict' });
    assert.throws(() => h.photos.replace(null, 0, 'upload'), { code: 'context_conflict' });
    assert.throws(() => h.photos.include(pl.id, false, 1, 'enable'), { code: 'context_conflict' });
  } finally { h.close(); s.dispose(); }
});

test('two runtime connections cannot replace the same photo base and failed validation makes no write', () => {
  const s = scratch();
  const a = createHarness({ databasePath: s.path, env: {} });
  const b = createHarness({ databasePath: s.path, env: {} });
  try {
    a.photos.replace(photo, 0, 'first');
    assert.throws(() => b.photos.replace(null, 0, 'second'), { code: 'document_conflict' });
    assert.throws(() => a.photos.replace({ ...photo, base64: 'AAAA' }, 1, 'invalid'));
    assert.equal(a.photos.asset().revision, 1);
    assert.equal(a.cvContexts.get('cv')?.includePhoto, true);
  } finally { a.close(); b.close(); s.dispose(); }
});

test('photo migration preserves legacy asset and inclusion and rolls back cleanly', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((m) => m.version <= 12));
    db.prepare("INSERT INTO documents VALUES ('cv_photo', 'cv_photo', 4, ?, 1, 2)").run(JSON.stringify({ photo }));
    const original = db.prepare("SELECT * FROM documents WHERE id = 'cv_photo'").get();
    const step = migrations.find((m) => m.version === 13)!;
    assert.throws(() => migrate(db, [{ ...step, sql: step.sql + '; SELECT * FROM absent_table;' }]));
    assert.equal(db.pragma('user_version', { simple: true }), 12);
    migrate(db); migrate(db);
    assert.deepEqual(db.prepare("SELECT * FROM documents WHERE id = 'cv_photo'").get(), original);
    assert.equal(createCvContextStore(db).get('cv')?.includePhoto, true);
  } finally { db.close(); }
});

test('checked photo IPC validates payloads and blocks ambiguous legacy writes', async () => {
  const s = scratch();
  const pl = createCvContextStore(s.db).create(randomUUID(), 'pl');
  const h = createHarness({ databasePath: s.path, env: {} });
  const dispatch = createDispatch(h);
  try {
    assert.equal((await dispatch('profile.photo.set', { photo })).ok, false);
    assert.equal((await dispatch('profile.photo.clear', {})).ok, false);
    assert.equal((await dispatch('profile.photoAsset.replace', { photo, expectedRevision: 0, operationId: 'ipc' })).ok, true);
    assert.equal((await dispatch('profile.context.photo.include', { contextId: pl.id, includePhoto: true, expectedRevision: 1, operationId: 'include' })).ok, true);
    assert.equal((await dispatch('profile.context.photo.get', { contextId: pl.id })).ok, true);
    assert.equal((await dispatch('profile.photoAsset.replace', { photo })).ok, false);
    assert.equal((await dispatch('profile.context.photo.include', { contextId: pl.id, includePhoto: true, expectedRevision: 2, operationId: 'other', activeContext: pl.id })).ok, false);
  } finally { h.close(); s.dispose(); }
});
