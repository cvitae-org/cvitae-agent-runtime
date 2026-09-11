import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../src/runtime/create.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { cvDocumentSchema } from '../src/capabilities/cv/document.js';
import { scratch } from './support/db.js';
import { noop, stage, transform } from './support/spine.js';

test('clear rejects late run commits, leaves the other CV/photo intact, and retries without clearing newer work', async () => {
  const s = scratch();
  const contexts = createCvContextStore(s.db);
  const pl = contexts.create(randomUUID(), 'pl');
  const en = contexts.create(randomUUID(), 'en');
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const probe = noop('probe', [stage('work', [transform('commit', async (context) => {
    entered(); await gate;
    context.documents.update('cv', 'cv', () => ({ role_description: 'late import' }));
    return {};
  })])]);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try {
    h.profile.replaceContext(pl.id, { role_description: 'original' }, 0);
    const other = h.profile.replaceContext(en.id, { role_description: 'English' }, 0).record;
    const photo = h.documents.update('cv_photo', 'cv_photo', () => ({ photo: null }));
    const run = h.begin({ capability: 'probe', input: {}, contextId: pl.id });
    const rejected = assert.rejects(run.settled, { code: 'context_conflict' });
    await ready;
    const cleared = h.cvLifecycle.clearContent(pl.id, 1, 'clear-1');
    assert.equal(cleared.context.generation, 1);
    release(); await rejected;
    assert.equal(h.documents.read(pl.id)?.body.role_description, '');
    assert.deepEqual(h.documents.read(en.id), other);
    assert.deepEqual(h.documents.read('cv_photo'), photo);
    h.profile.replaceContext(pl.id, { role_description: 'new work' }, 2);
    assert.deepEqual(h.cvLifecycle.clearContent(pl.id, 1, 'clear-1'), cleared);
    assert.equal(h.documents.read(pl.id)?.body.role_description, 'new work');
    assert.throws(() => h.cvLifecycle.clearContent(en.id, 1, 'clear-1'), { code: 'context_conflict' });
    assert.throws(() => h.begin({ capability: 'probe', input: {}, contextId: pl.id, contextGeneration: 0 }), { code: 'context_conflict' });
  } finally { release(); h.close(); s.dispose(); }
});

test('stale clear leaves generation unchanged and outstanding legacy runs block clear', async () => {
  const s = scratch();
  const probe = noop('probe', [stage('wait', [transform('approval', async (context) => {
    context.approvals.request({ key: 'go', kind: 'confirm', question: 'go?', payload: {} });
    return {};
  })])]);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try {
    h.profile.replace({ role_description: 'keep' });
    assert.throws(() => h.cvLifecycle.clearContent('cv', 0, 'stale'), { code: 'document_conflict' });
    assert.equal(h.cvContexts.get('cv')?.generation, 0);
    await assert.rejects(h.run({ capability: 'probe', input: {} }));
    assert.throws(() => h.cvLifecycle.clearContent('cv', 1, 'legacy'), { code: 'context_conflict' });
    assert.equal(h.documents.read('cv')?.revision, 1);
  } finally { h.close(); s.dispose(); }
});

test('a suspended scoped run cannot resume across a clear and process restart', async () => {
  const s = scratch();
  const id = createCvContextStore(s.db).create(randomUUID(), 'pl').id;
  const probe = noop('probe', [stage('wait', [transform('approval', async (context) => {
    context.approvals.request({ key: 'go', kind: 'confirm', question: 'go?', payload: {} });
    return {};
  })])]);
  let h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try {
    await assert.rejects(h.run({ capability: 'probe', input: {}, contextId: id, runId: 'suspended' }));
    assert.equal(h.runs.get('suspended')?.contextGeneration, 0);
    h.cvLifecycle.clearContent(id, 0, 'clear');
    h.close(); h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
    await assert.rejects(h.resume({ runId: 'suspended' }), { code: 'context_conflict' });
    assert.equal(h.documents.read(id)?.revision, 1);
  } finally { h.close(); s.dispose(); }
});

test('generated proposals persist with run success; acceptance is durable, scoped, and repeatable', async () => {
  const s = scratch();
  const contexts = createCvContextStore(s.db);
  const pl = contexts.create(randomUUID(), 'pl');
  const en = contexts.create(randomUUID(), 'en');
  const edit = noop('edit_cv', [stage('work', [transform('proposal', async (context) => {
    const record = context.documents.read('cv');
    return { document: cvDocumentSchema.parse({ role_description: 'proposal' }), changed: true,
      base: { contextId: context.contextId, generation: context.contextGeneration, revision: record?.revision ?? 0 } };
  })])]);
  let h = createHarness({ databasePath: s.path, env: {}, capabilities: { edit_cv: edit } });
  try {
    const result = await h.run({ capability: 'edit_cv', input: {}, contextId: pl.id, runId: 'proposal-1' });
    assert.equal(result.data.proposalId, 'proposal-1');
    assert.equal(h.runs.get('proposal-1')?.result?.proposalId, 'proposal-1');
    assert.equal(h.documents.read(pl.id), undefined);
    h.close(); h = createHarness({ databasePath: s.path, env: {} });
    const dispatch = createDispatch(h);
    assert.equal(h.cvLifecycle.list(pl.id)[0]?.base.revision, 0);
    assert.throws(() => h.cvLifecycle.accept(en.id, 'proposal-1'), { code: 'context_not_found' });
    const accepted = await dispatch('profile.proposals.accept', { contextId: pl.id, proposalId: 'proposal-1' });
    assert.equal(accepted.ok, true);
    assert.equal(h.documents.read(pl.id)?.revision, 1);
    h.profile.replaceContext(pl.id, { role_description: 'later edit' }, 1);
    h.close(); h = createHarness({ databasePath: s.path, env: {} });
    const receipt = h.cvLifecycle.accept(pl.id, 'proposal-1');
    assert.equal(receipt.revision, 1);
    assert.equal(h.documents.read(pl.id)?.revision, 2);
    assert.equal(h.documents.read(pl.id)?.body.role_description, 'later edit');
  } finally { h.close(); s.dispose(); }
});

test('a proposal based on older content stays pending on conflict and clear invalidates it', async () => {
  const s = scratch();
  const id = createCvContextStore(s.db).create(randomUUID(), 'pl').id;
  const edit = noop('edit_cv', [stage('work', [transform('proposal', async (context) => ({
    document: cvDocumentSchema.parse({ role_description: 'proposal' }), changed: true,
    base: { contextId: context.contextId, generation: context.contextGeneration, revision: 0 }
  }))])]);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { edit_cv: edit } });
  try {
    await h.run({ capability: 'edit_cv', input: {}, contextId: id, runId: 'stale' });
    h.profile.replaceContext(id, { role_description: 'manual' }, 0);
    assert.throws(() => h.cvLifecycle.accept(id, 'stale'), { code: 'document_conflict' });
    assert.equal(h.cvLifecycle.list(id)[0]?.status, 'pending');
    h.cvLifecycle.clearContent(id, 1, 'clear');
    assert.equal(h.cvLifecycle.list(id)[0]?.status, 'invalidated');
    assert.throws(() => h.cvLifecycle.accept(id, 'stale'), { code: 'context_conflict' });
    assert.equal(h.cvLifecycle.discard(id, 'stale').status, 'discarded');
    assert.equal(h.cvLifecycle.discard(id, 'stale').status, 'discarded');
  } finally { h.close(); s.dispose(); }
});

test('failed proposal persistence rolls back run success without storing a proposal', async () => {
  const s = scratch();
  const id = createCvContextStore(s.db).create(randomUUID(), 'pl').id;
  const edit = noop('edit_cv', [stage('work', [transform('proposal', async () => ({
    document: cvDocumentSchema.parse({}), changed: true,
    base: { contextId: id, generation: 999, revision: 0 }
  }))])]);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { edit_cv: edit } });
  try {
    await assert.rejects(h.run({ capability: 'edit_cv', input: {}, contextId: id, runId: 'bad-base' }));
    assert.equal(h.runs.get('bad-base')?.status, 'failed');
    assert.deepEqual(h.cvLifecycle.list(id), []);
  } finally { h.close(); s.dispose(); }
});


test('lifecycle migrations preserve old data, roll back failures, and queue stale indexes once', async () => {
  const { open } = await import('../src/storage/sqlite/open.js');
  const { migrate, migrations } = await import('../src/storage/sqlite/migrate.js');
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((m) => m.version <= 10));
    db.prepare("INSERT INTO documents (id, kind, revision, body, created_at, updated_at) VALUES ('cv', 'cv', 7, ?, 1, 2)")
      .run(JSON.stringify({ role_description: 'preserved' }));
    db.exec("INSERT INTO runs (id, capability, status, input, trace_id, created_at, context_id) VALUES ('old', 'extract_cv', 'suspended', '{}', 'trace', 1, 'cv')");
    const document = db.prepare("SELECT * FROM documents WHERE id = 'cv'").get();
    const step = migrations.find((m) => m.version === 11)!;
    assert.throws(() => migrate(db, [{ ...step, sql: step.sql + '; SELECT * FROM missing_table;' }]));
    assert.equal(db.pragma('user_version', { simple: true }), 10);
    migrate(db);
    migrate(db);
    assert.deepEqual(db.prepare("SELECT * FROM documents WHERE id = 'cv'").get(), document);
    assert.deepEqual(db.prepare("SELECT context_generation, context_revision FROM runs WHERE id = 'old'").get(),
      { context_generation: 0, context_revision: null });
    assert.deepEqual(db.prepare('SELECT document_id, revision, attempts FROM cv_index_jobs').all(),
      [{ document_id: 'cv', revision: 7, attempts: 0 }]);
  } finally { db.close(); }
});
