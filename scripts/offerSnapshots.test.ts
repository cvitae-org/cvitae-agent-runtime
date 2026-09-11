import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../src/runtime/create.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { scratch } from './support/db.js';

const offer = { id: 'offer', text: 'Original posting', firstSeenAt: 1, lastSeenAt: 1,
  processing: 'fetched' as const, disposition: 'active' as const };
const photo = { mime: 'image/png' as const, base64: 'iVBORw0KGgo=', width: 10, height: 10 };

test('offer snapshots retain original CV, posting, language, photo and conversation across edits and restart', () => {
  const s = scratch();
  const pl = createCvContextStore(s.db).create(randomUUID(), 'pl');
  let h = createHarness({ databasePath: s.path, env: {} });
  try {
    h.offers.save(offer);
    h.profile.replaceContext(pl.id, { role_description: 'Original CV' }, 0);
    h.photos.replace(photo, 0, 'photo');
    const included = h.photos.include(pl.id, true, 1, 'include');
    const legacy = h.conversations.open({ kind: 'offer', id: offer.id });
    const request = { id: randomUUID(), offerId: offer.id, contextId: pl.id,
      expectedRevision: 1, expectedContextRevision: included.revision, expectedPhotoRevision: 1 };
    const snapshot = h.offerSnapshots.capture(request);
    assert.notEqual(snapshot.conversationId, legacy.id);
    assert.equal(h.conversations.read(snapshot.conversationId)?.conversation.offerSnapshotId, snapshot.id);
    assert.equal(h.conversations.open({ kind: 'offer', id: offer.id }).id, legacy.id);
    h.profile.replaceContext(pl.id, { role_description: 'Later CV' }, 1);
    h.photos.replace(null, 1, 'remove');
    h.offers.save({ ...offer, text: 'Later posting' });
    h.close(); h = createHarness({ databasePath: s.path, env: {} });
    assert.deepEqual(h.offerSnapshots.capture(request), snapshot);
    assert.equal(snapshot.document.body.role_description, 'Original CV');
    assert.equal(snapshot.context.language, 'pl');
    assert.equal(snapshot.offer.text, 'Original posting');
    assert.deepEqual(snapshot.photo.photo, photo);
    assert.equal(h.offerSnapshots.list(offer.id, pl.id).length, 1);
    assert.throws(() => h.offerSnapshots.capture({ ...request, expectedRevision: 2 }), { code: 'context_conflict' });
    h.conversations.delete(snapshot.conversationId);
    assert.deepEqual(h.offerSnapshots.capture(request), snapshot);
    assert.equal(h.conversations.read(snapshot.conversationId), undefined);
    assert.equal(h.offerSnapshots.get(snapshot.id)?.conversationId, snapshot.conversationId);
  } finally { h.close(); s.dispose(); }
});

test('capture preconditions and failures leave no partial conversation or snapshot', () => {
  const s = scratch();
  const pl = createCvContextStore(s.db).create(randomUUID(), 'pl');
  const h = createHarness({ databasePath: s.path, env: {} });
  try {
    h.offers.save(offer);
    h.profile.replaceContext(pl.id, {}, 0);
    const request = { id: randomUUID(), offerId: offer.id, contextId: pl.id,
      expectedRevision: 1, expectedContextRevision: 1, expectedPhotoRevision: 0 };
    for (const changed of [{ expectedRevision: 0 }, { expectedContextRevision: 2 }, { expectedPhotoRevision: 1 }, { offerId: 'missing' }]) {
      assert.throws(() => h.offerSnapshots.capture({ ...request, ...changed }));
    }
    s.db.exec("CREATE TRIGGER reject_snapshot BEFORE INSERT ON offer_snapshots BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => h.offerSnapshots.capture(request));
    assert.equal(h.conversations.list().length, 0);
    assert.equal(h.offerSnapshots.list(offer.id).length, 0);
    s.db.exec('DROP TRIGGER reject_snapshot');
    assert.equal(h.offerSnapshots.capture(request).photo.photo, null);
  } finally { h.close(); s.dispose(); }
});

test('two contexts get distinct offer history; legacy run attachments are refused', async () => {
  const s = scratch();
  const contexts = createCvContextStore(s.db);
  const pl = contexts.create(randomUUID(), 'pl');
  const en = contexts.create(randomUUID(), 'en');
  const h = createHarness({ databasePath: s.path, env: {} });
  const second = createHarness({ databasePath: s.path, env: {} });
  try {
    h.offers.save(offer);
    h.profile.replaceContext(pl.id, {}, 0); h.profile.replaceContext(en.id, {}, 0);
    const request = { id: randomUUID(), offerId: offer.id, contextId: pl.id,
      expectedRevision: 1, expectedContextRevision: 1, expectedPhotoRevision: 0 };
    const a = h.offerSnapshots.capture(request);
    assert.deepEqual(second.offerSnapshots.capture(request), a);
    const b = h.offerSnapshots.capture({ ...request, id: randomUUID(), contextId: en.id });
    assert.notEqual(a.conversationId, b.conversationId);
    h.conversations.append(a.conversationId, { role: 'user', text: 'Polish history' });
    assert.equal(h.conversations.read(b.conversationId)?.messages.length, 0);
    assert.throws(() => h.conversations.append(a.conversationId, { role: 'assistant', text: 'wrong run', runId: 'unknown' }), { code: 'context_conflict' });
    const dispatch = createDispatch(h);
    assert.equal((await dispatch('conversations.open', { subject: { kind: 'offer', id: offer.id, snapshotId: a.id } })).ok, false);
    assert.equal((await dispatch('conversations.create', { subject: { kind: 'offer', id: offer.id }, contextId: en.id })).ok, false);
    assert.equal((await dispatch('offers.snapshots.capture', request)).ok, true);
    assert.equal((await dispatch('offers.snapshots.capture', { ...request, activeContext: en.id })).ok, false);
  } finally { second.close(); h.close(); s.dispose(); }
});

test('snapshot migration preserves unbound offer history and rolls back failures', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((m) => m.version <= 13));
    db.exec("INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES ('old', 'offer', 'offer', 1, 1)");
    const old = db.prepare('SELECT * FROM conversations').all();
    const step = migrations.find((m) => m.version === 14)!;
    assert.throws(() => migrate(db, [{ ...step, sql: step.sql + '; SELECT * FROM missing_table;' }]));
    assert.equal(db.pragma('user_version', { simple: true }), 13);
    migrate(db); migrate(db);
    assert.deepEqual(db.prepare('SELECT * FROM conversations').all(), old);
    assert.equal((db.prepare('SELECT count(*) AS n FROM offer_snapshots').get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('offer IPC reads persisted facts with bounded strict inputs and survives restart', async () => {
  const s = scratch();
  let h = createHarness({ databasePath: s.path, env: {} });
  try {
    h.offers.save({ ...offer, position: 'Engineer', company: 'Fixture' });
    h.close(); h = createHarness({ databasePath: s.path, env: {} });
    const dispatch = createDispatch(h);
    const listed = await dispatch('offers.list', { limit: 1 });
    assert.equal(listed.ok, true);
    if (listed.ok) assert.equal((listed.data as { offers: { position: string }[] }).offers[0]?.position, 'Engineer');
    const missing = await dispatch('offers.get', { id: 'missing' });
    assert.deepEqual(missing, { ok: true, data: { offer: null } });
    assert.equal((await dispatch('offers.get', { id: offer.id })).ok, true);
    for (const input of [{ limit: 0 }, { limit: 1001 }, { limit: 1, sql: 'SELECT *' }]) {
      assert.equal((await dispatch('offers.list', input)).ok, false);
    }
    assert.equal((await dispatch('offers.get', { id: offer.id, text: 'replacement' })).ok, false);
    assert.equal(h.offers.get(offer.id)?.text, offer.text);
  } finally { h.close(); s.dispose(); }
});
