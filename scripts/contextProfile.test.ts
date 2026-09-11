import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { scratch } from './support/db.js';

const data = <T>(response: Response): T => {
  assert.ok(response.ok, JSON.stringify(response));
  return response.data as T;
};
const error = (response: Response, code: string) => {
  assert.equal(response.ok, false);
  if (response.ok) throw new Error('expected error');
  assert.equal(response.error.code, code);
  return response.error;
};

test('context profile API distinguishes absent versions, unknown IDs, and empty contexts', async () => {
  const s = scratch();
  const h = createHarness({ databasePath: s.path, env: {} });
  const dispatch = createDispatch(h);
  try {
    assert.deepEqual(data(await dispatch('profile.contexts.list')), { contexts: [] });
    error(await dispatch('profile.context.get', { contextId: 'missing' }), 'context_not_found');
    const id = randomUUID();
    createCvContextStore(s.db).create(id, 'pl');
    const empty = data<{ present: boolean; record: unknown }>(await dispatch('profile.context.get', { contextId: id }));
    assert.equal(empty.present, false);
    assert.equal(empty.record, null);
    error(await dispatch('profile.context.update', {
      contextId: id, expectedRevision: 1, document: {}
    }), 'document_conflict');
    assert.equal(h.documents.read(id), undefined);
    assert.equal(data<{ record: { revision: number } }>(await dispatch('profile.context.update', {
      contextId: id, expectedRevision: 0, document: {}
    })).record.revision, 1);
  } finally { h.close(); s.dispose(); }
});

test('checked context writes return conflict details, preserve other contexts, and clear only their own index', async () => {
  const s = scratch();
  const h = createHarness({ databasePath: s.path, env: {} });
  const dispatch = createDispatch(h);
  try {
    const contexts = createCvContextStore(s.db);
    const pl = contexts.create(randomUUID(), 'pl');
    const en = contexts.create(randomUUID(), 'en');
    for (const context of [pl, en]) {
      data(await dispatch('profile.context.update', {
        contextId: context.id, expectedRevision: 0, document: { role_description: context.language }
      }));
      h.chunks.replace(context.id, {
        provider: 'test', model: 'test', dim: 1, normalisation: 'l2', chunkerVersion: 1
      }, [{ id: context.id, kind: 'role', text: 'Engineer', position: 0, meta: {}, vector: new Float32Array([1]) }]);
    }
    const oldEn = h.documents.read(en.id);
    data(await dispatch('profile.context.update', {
      contextId: pl.id, expectedRevision: 1, document: { role_description: 'New Polish content' }
    }));
    assert.deepEqual(h.documents.read(en.id), oldEn);
    const chunksBefore = s.db.prepare('SELECT * FROM chunks').all();
    assert.equal(chunksBefore.length, 1);
    const conflict = error(await dispatch('profile.context.update', {
      contextId: en.id, expectedRevision: 0, document: {}
    }), 'document_conflict');
    assert.deepEqual(conflict.details, { contextId: en.id, expectedRevision: 0, actualRevision: 1 });
    assert.deepEqual(s.db.prepare('SELECT * FROM chunks').all(), chunksBefore);
    assert.deepEqual(h.documents.read(en.id), oldEn);
  } finally { h.close(); s.dispose(); }
});

test('new writes require identity and a base; legacy channels reject context-aware payloads', async () => {
  const s = scratch();
  const h = createHarness({ databasePath: s.path, env: {} });
  const dispatch = createDispatch(h);
  try {
    for (const payload of [{ document: {} }, { contextId: 'cv', document: {} }, {
      contextId: 'cv', expectedRevision: -1, document: {}
    }]) error(await dispatch('profile.context.update', payload), 'invalid_input');
    for (const [channel, payload] of [
      ['profile.get', { contextId: 'en' }],
      ['profile.update', { contextId: 'en', expectedRevision: 0, document: {} }],
      ['profile.update', { expectedRevision: 0, document: {} }],
      ['profile.photo.clear', { contextId: 'en' }]
    ] as const) error(await dispatch(channel, payload), 'invalid_input');
    error(await dispatch('profile.context.update', {
      contextId: 'missing', expectedRevision: 0, document: {}
    }), 'context_not_found');
    assert.deepEqual(h.cvContexts.list(), []);
    assert.equal(h.documents.read('cv'), undefined);
  } finally { h.close(); s.dispose(); }
});

test('legacy callers keep working and register one unassigned context; creation requires the checked protocol', async () => {
  const s = scratch();
  const h = createHarness({ databasePath: s.path, env: {} });
  const dispatch = createDispatch(h);
  try {
    data(await dispatch('profile.update', { document: { role_description: 'Existing UI' } }));
    assert.equal(h.cvContexts.get('cv')?.language, null);
    data(await dispatch('profile.context.update', {
      contextId: 'cv', expectedRevision: 1, document: { role_description: 'Checked editor' }
    }));
    assert.equal(data<{ record: { revision: number } }>(await dispatch('profile.get')).record.revision, 2);
    error(await dispatch('profile.contexts.create', { language: 'en' }), 'invalid_input');
    error(await dispatch('profile.contexts.assignLanguage', { contextId: 'cv', language: 'en' }), 'invalid_input');
  } finally { h.close(); s.dispose(); }
});

test('trusted-host checked writes cannot omit the expected revision', () => {
  const s = scratch();
  const h = createHarness({ databasePath: s.path, env: {} });
  try {
    h.profile.replace({ role_description: 'original' });
    assert.throws(() => h.profile.replaceContext('cv', {}, undefined as unknown as number), { code: 'invalid_input' });
    assert.equal(h.documents.read('cv')?.revision, 1);
  } finally { h.close(); s.dispose(); }
});

test('registry identity and checked profile content survive reopening the runtime', async () => {
  const s = scratch();
  let h = createHarness({ databasePath: s.path, env: {} });
  try {
    h.profile.replace({ role_description: 'original' });
    data(await createDispatch(h)('profile.context.update', {
      contextId: 'cv', expectedRevision: 1, document: { role_description: 'durable' }
    }));
    h.close();
    h = createHarness({ databasePath: s.path, env: {} });
    assert.equal(h.cvContexts.get('cv')?.language, null);
    const restored = h.profile.readContext('cv');
    assert.equal(restored.record?.revision, 2);
    assert.equal(restored.record?.body.role_description, 'durable');
  } finally { h.close(); s.dispose(); }
});
