import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { scratch } from './support/db.js';
import { noop, stage, transform } from './support/spine.js';

test('a run captures its context across an asynchronous pause and persists its conversation', async () => {
  const s = scratch();
  const contexts = createCvContextStore(s.db);
  const pl = contexts.create(randomUUID(), 'pl');
  const en = contexts.create(randomUUID(), 'en');
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const probe = noop('probe', [stage('work', [transform('write', async (context) => {
    entered();
    await gate;
    const saved = context.documents.update('cv', 'cv', () => ({ role_description: 'Polish result' }));
    assert.equal(saved.id, pl.id);
    return {};
  })])]);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try {
    const chat = h.conversations.create({ kind: 'profile', id: pl.id });
    const handle = h.begin({ capability: 'probe', input: {}, contextId: pl.id, conversationId: chat.id });
    await paused;
    h.profile.replaceContext(en.id, { role_description: 'English edit' }, 0);
    release();
    await handle.settled;
    assert.equal(h.documents.read(en.id)?.body.role_description, 'English edit');
    assert.equal(h.documents.read(pl.id)?.body.role_description, 'Polish result');
    assert.equal(h.runs.get(handle.runId)?.contextId, pl.id);
    assert.equal(h.runs.get(handle.runId)?.conversationId, chat.id);
  } finally { release(); h.close(); s.dispose(); }
});

test('context mismatch is refused before creating a run and cannot be appended to another chat', async () => {
  const s = scratch();
  const contexts = createCvContextStore(s.db);
  const pl = contexts.create(randomUUID(), 'pl');
  const en = contexts.create(randomUUID(), 'en');
  const probe = noop('probe', []);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  const dispatch = createDispatch(h);
  try {
    const chat = h.conversations.create({ kind: 'profile', id: pl.id });
    const other = h.conversations.create({ kind: 'profile', id: en.id });
    const legacy = await dispatch('run.start', {
      capability: 'probe', input: {}, contextId: pl.id, runId: 'legacy-mistake'
    });
    assert.equal(legacy.ok, false, 'old channel must not silently drop context identity');
    assert.equal(h.runs.get('legacy-mistake'), undefined);
    assert.equal((await dispatch('run.context.start', { capability: 'probe', input: {} })).ok, false);
    const refused = await dispatch('run.context.start', {
      capability: 'probe', input: {}, runId: 'bad', contextId: en.id, conversationId: chat.id
    });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error.code, 'context_conflict');
    assert.equal(h.runs.get('bad'), undefined);
    await h.run({ capability: 'probe', input: {}, runId: 'good', contextId: pl.id, conversationId: chat.id });
    assert.throws(() => h.conversations.append(other.id, { role: 'assistant', text: 'wrong', runId: 'good' }), { code: 'context_conflict' });
    const sameContext = h.conversations.create({ kind: 'profile', id: pl.id });
    assert.throws(() => h.conversations.append(sameContext.id, { role: 'assistant', text: 'wrong chat', runId: 'good' }), { code: 'context_conflict' });
    h.conversations.delete(chat.id);
    assert.equal(h.runs.get('good'), undefined, 'a deleted conversation takes its settled runs with it');
    assert.throws(() => h.conversations.append(sameContext.id, { role: 'assistant', text: 'reattached', runId: 'good' }), { code: 'context_conflict' });
    assert.equal(h.conversations.read(other.id)?.messages.length, 0);
    assert.throws(() => h.begin({ capability: 'probe', input: {} }), { code: 'invalid_input' });
    assert.throws(() => h.begin({ capability: 'probe', input: {}, contextId: 'missing' }), { code: 'context_not_found' });
    assert.throws(() => h.profile.replace({}), { code: 'invalid_input' });
  } finally { h.close(); s.dispose(); }
});

test('profile conversations and summaries remain isolated; explicit legacy ID restores old chats', () => {
  const s = scratch();
  const h = createHarness({ databasePath: s.path, env: {} });
  try {
    const old = h.conversations.create({ kind: 'profile', id: '' });
    const registry = createCvContextStore(s.db);
    registry.assignLanguage('cv', 'pl', 1);
    const en = registry.create(randomUUID(), 'en');
    const second = h.conversations.create({ kind: 'profile', id: en.id });
    h.conversations.append(old.id, { role: 'user', text: 'Polish chat' });
    h.conversations.append(second.id, { role: 'user', text: 'English chat' });
    h.conversations.summarise(old.id, 'Polish note', 1);
    h.conversations.summarise(second.id, 'English note', 1);
    assert.deepEqual(h.conversations.list({ kind: 'profile', id: 'cv' }).map((c) => c.id), [old.id]);
    assert.deepEqual(h.conversations.list({ kind: 'profile', id: en.id }).map((c) => c.id), [second.id]);
    assert.equal(h.conversations.read(old.id)?.conversation.summary, 'Polish note');
    assert.equal(h.conversations.read(second.id)?.conversation.summary, 'English note');
  } finally { h.close(); s.dispose(); }
});

test('resuming after reopening restores the persisted context, without any UI selection', async () => {
  const s = scratch();
  const registry = createCvContextStore(s.db);
  const pl = registry.create(randomUUID(), 'pl');
  const en = registry.create(randomUUID(), 'en');
  const probe = noop('probe', [stage('work', [transform('approval', async (context) => {
    context.approvals.request({ key: 'go', kind: 'confirm', question: 'Continue?', payload: {} });
    context.documents.update('cv', 'cv', () => ({ role_description: 'Resumed Polish' }));
    return {};
  })])]);
  let h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try {
    const dispatch = createDispatch(h);
    const started = await dispatch('run.context.start', { capability: 'probe', input: {}, contextId: pl.id, runId: 'resume-me' });
    assert.equal(started.ok, true);
    await dispatch('run.await', { runId: 'resume-me' });
    assert.equal(h.runs.get('resume-me')?.status, 'suspended');
    h.close();
    h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
    h.profile.replaceContext(en.id, { role_description: 'English' }, 0);
    const restarted = createDispatch(h);
    const pending = await restarted('approvals.pending', { runId: 'resume-me' });
    assert.ok(pending.ok);
    const approval = (pending.data as { id: string }[])[0]!;
    assert.equal((await restarted('approvals.decide', { approvalId: approval.id, status: 'granted' })).ok, true);
    await h.resume({ runId: 'resume-me' });
    assert.equal(h.documents.read(pl.id)?.body.role_description, 'Resumed Polish');
    assert.equal(h.documents.read(en.id)?.body.role_description, 'English');
  } finally { h.close(); s.dispose(); }
});

test('a capability cannot read or write a different context through its document port', async () => {
  const s = scratch();
  const registry = createCvContextStore(s.db);
  const pl = registry.create(randomUUID(), 'pl');
  const en = registry.create(randomUUID(), 'en');
  const probe = noop('probe', [stage('work', [transform('guard', async (context) => {
    assert.throws(() => context.documents.read(en.id), { code: 'context_conflict' });
    assert.throws(() => context.documents.update(en.id, 'cv', () => ({})), { code: 'context_conflict' });
    assert.throws(() => context.index.clear(en.id, { expectedRevision: 1 }), { code: 'context_conflict' });
    await assert.rejects(context.retrieval.search({ text: 'private', documentId: en.id, lexicalOnly: true, limit: 4 }, context.signal), { code: 'context_conflict' });
    return {};
  })])]);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try { await h.run({ capability: 'probe', input: {}, contextId: pl.id }); }
  finally { h.close(); s.dispose(); }
});
