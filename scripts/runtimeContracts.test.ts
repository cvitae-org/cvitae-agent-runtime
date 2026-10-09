import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { bindOfferScope, snapshotInput } from '../src/runtime/offer-scope.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { open } from '../src/storage/sqlite/open.js';
import { scratch } from './support/db.js';
import { noop, stage, transform } from './support/spine.js';
import type { EffectSet, OfferSnapshot } from '../src/contracts/index.js';

const offer = { id: 'offer', text: 'Original posting', url: 'https://example.com/job', firstSeenAt: 1, lastSeenAt: 1,
  processing: 'fetched' as const, disposition: 'active' as const };
const body = { role_description: 'Original TypeScript engineer builds reliable production systems',
  sources: [{ kind: 'text', reference: 'original.txt', imported_at: '2026-09-10' }] };
function fixture(h: ReturnType<typeof createHarness>): OfferSnapshot {
  const pl = h.cvContexts.create(randomUUID(), 'pl');
  h.profile.replaceContext(pl.id, body, 0);
  h.offers.save(offer);
  return h.offerSnapshots.capture({ id: randomUUID(), offerId: offer.id, contextId: pl.id,
    expectedRevision: 1, expectedContextRevision: 1, expectedPhotoRevision: 0 });
}

test('copy is independent, keeps provenance and sources, excludes photo/chats, and survives lost response', () => {
  const s = scratch(); let h = createHarness({ databasePath: s.path, env: {} });
  try {
    const snapshot = fixture(h);
    h.photos.include(snapshot.context.id, true, 1, 'include');
    const request = { id: randomUUID(), language: 'en' as const, sourceContextId: snapshot.context.id, expectedSourceRevision: 1 };
    const copied = h.cvCopies.copy(request);
    assert.equal(copied.context.includePhoto, false);
    assert.deepEqual(copied.record.body, snapshot.document.body);
    assert.equal(copied.provenance.sourceRevision, 1);
    assert.equal(h.conversations.list({ kind: 'profile', id: copied.context.id }).length, 0);
    assert.ok(h.indexRecovery.status(copied.context.id));
    h.profile.replaceContext(copied.context.id, { role_description: 'Later English' }, 1);
    h.cvLifecycle.clearContent(snapshot.context.id, 1, 'clear-source');
    h.close(); h = createHarness({ databasePath: s.path, env: {} });
    assert.deepEqual(h.cvCopies.copy(request), copied);
    assert.equal(h.profile.readContext(copied.context.id).record?.body.role_description, 'Later English');
    assert.throws(() => h.cvCopies.copy({ ...request, expectedSourceRevision: 2 }), { code: 'context_conflict' });
    assert.throws(() => h.cvContexts.create(copied.context.id, 'en'), { code: 'context_conflict' });
  } finally { h.close(); s.dispose(); }
});

test('copy conflicts and transaction failure do not leave a destination or receipt', () => {
  const s = scratch(); const h = createHarness({ databasePath: s.path, env: {} });
  try {
    const snapshot = fixture(h);
    const request = { id: randomUUID(), language: 'en' as const, sourceContextId: snapshot.context.id, expectedSourceRevision: 2 };
    assert.throws(() => h.cvCopies.copy(request), { code: 'document_conflict' });
    s.db.exec("CREATE TRIGGER reject_copy BEFORE INSERT ON cv_copy_receipts BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => h.cvCopies.copy({ ...request, expectedSourceRevision: 1 }));
    assert.equal(h.cvContexts.get(request.id), undefined);
    assert.equal(h.documents.read(request.id), undefined);
    s.db.exec('DROP TRIGGER reject_copy');
    assert.equal(h.cvCopies.copy({ ...request, expectedSourceRevision: 1 }).record.revision, 1);
  } finally { h.close(); s.dispose(); }
});

test('snapshot ports cannot read live data or write; retrieval works after clear without embeddings', async () => {
  const s = scratch(); const h = createHarness({ databasePath: s.path, env: {} });
  try {
    const snapshot = fixture(h);
    h.cvLifecycle.clearContent(snapshot.context.id, 1, 'clear');
    const bound = bindOfferScope(snapshot, {} as EffectSet);
    assert.deepEqual(bound.documents.read('cv'), snapshot.document);
    assert.throws(() => bound.documents.update('cv', 'cv', () => ({})), { code: 'context_conflict' });
    assert.throws(() => bound.documents.read('other'), { code: 'context_conflict' });
    assert.throws(() => bound.index.clear('cv'), { code: 'context_conflict' });
    const hits = await bound.retrieval.search({ text: 'TypeScript', limit: 5 }, new AbortController().signal);
    assert.ok(hits.length > 0);
    assert.ok(hits.every((hit) => hit.documentId === snapshot.context.id && hit.sourceRevision === 1));
    // What it searches is the snapshot's own, so the live index being cleared
    // leaves it something to search.
    assert.ok((bound.retrieval.countOf?.('cv') ?? 0) > 0);
    assert.equal(bound.retrieval.countOf?.('cv'), bound.index.countOf('cv'));
    assert.throws(() => bound.retrieval.countOf?.('other'), { code: 'context_conflict' });
    assert.equal((await bound.effects.offers.resolve(offer.url, { traceId: 't', signal: new AbortController().signal })).text, offer.text);
    await assert.rejects(bound.effects.offers.resolve('https://example.com/other', { traceId: 't', signal: new AbortController().signal }), { code: 'context_conflict' });
  } finally { h.close(); s.dispose(); }
});

test('offer run retains snapshot during asynchronous live changes and persists artifact ownership', async () => {
  const s = scratch(); let release!: () => void; let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const pause = new Promise<void>((resolve) => { release = resolve; });
  const probe = noop('probe', [stage('work', [transform('read', async (ctx) => {
    enter(); await pause;
    assert.equal(ctx.documents.read('cv')?.body.role_description, body.role_description);
    assert.equal((await ctx.effects.offers.resolve(offer.url, { traceId: 't', signal: ctx.signal })).text, offer.text);
    return { saved: true };
  })])]);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try {
    const snapshot = fixture(h);
    const run = h.begin({ capability: 'probe', input: {}, contextId: snapshot.context.id,
      conversationId: snapshot.conversationId, offerSnapshotId: snapshot.id });
    await entered;
    h.cvLifecycle.clearContent(snapshot.context.id, 1, 'clear');
    h.offers.save({ ...offer, text: 'Changed posting' });
    release(); const result = await run.settled;
    assert.equal(result.data.offerSnapshotId, snapshot.id);
    assert.equal(h.runs.get(run.runId)?.offerSnapshotId, snapshot.id);
    h.conversations.append(snapshot.conversationId, { role: 'assistant', text: 'saved', runId: run.runId });
    const other = h.conversations.create({ kind: 'offer', id: offer.id });
    assert.throws(() => h.conversations.append(other.id, { role: 'assistant', text: 'wrong', runId: run.runId }), { code: 'context_conflict' });
  } finally { release(); h.close(); s.dispose(); }
});

test('snapshot execution validates all ownership and refuses caller replacements before creating a run', async () => {
  const s = scratch(); const probe = noop('probe', []);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try {
    const snapshot = fixture(h); const dispatch = createDispatch(h);
    const request = { protocolVersion: 2, runId: 'bad', capability: 'probe', input: {},
      contextId: snapshot.context.id, conversationId: snapshot.conversationId, offerSnapshotId: snapshot.id };
    for (const patch of [{ contextId: 'wrong' }, { conversationId: 'wrong' }, { protocolVersion: 1 }, { input: { document: {} } }, { input: { offerText: 'replacement' } }]) {
      assert.equal((await dispatch('run.offer.start', { ...request, ...patch })).ok, false);
      assert.equal(h.runs.get('bad'), undefined);
    }
    h.conversations.delete(snapshot.conversationId);
    assert.equal((await dispatch('run.offer.start', request)).ok, false);
    assert.equal(h.runs.get('bad'), undefined);
  } finally { h.close(); s.dispose(); }
});

test('snapshot run resumes after restart against original revision despite source reset', async () => {
  const s = scratch();
  const probe = noop('probe', [stage('work', [transform('approval', async (ctx) => {
    ctx.approvals.request({ key: 'go', kind: 'confirm', question: 'Continue?', payload: {} });
    assert.equal(ctx.documents.read('cv')?.body.role_description, body.role_description);
    return {};
  })])]);
  let h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try {
    const snapshot = fixture(h);
    const handle = h.begin({ runId: 'resume-snapshot', capability: 'probe', input: {},
      contextId: snapshot.context.id, conversationId: snapshot.conversationId, offerSnapshotId: snapshot.id });
    await assert.rejects(handle.settled);
    h.cvLifecycle.clearContent(snapshot.context.id, 1, 'clear');
    h.close(); h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
    const pending = h.approvals.pending('resume-snapshot')[0]!;
    h.approvals.decide(pending.id, { status: 'granted', decision: {}, decidedAt: 1 });
    const result = await h.resume({ runId: 'resume-snapshot' });
    assert.equal(result.data.offerSnapshotId, snapshot.id);
  } finally { h.close(); s.dispose(); }
});

test('protocol-gated lifecycle preserves unassigned data, absent versions and checked legacy transition', async () => {
  const s = scratch(); const h = createHarness({ databasePath: s.path, env: {} });
  try {
    const dispatch = createDispatch(h);
    h.profile.replace(body);
    assert.equal(h.cvContexts.get('cv')?.language, null);
    assert.equal((await dispatch('protocol.get', {})).ok, true);
    assert.equal((await dispatch('profile.contexts.create', { protocolVersion: 2, id: randomUUID(), language: 'en' })).ok, false);
    assert.equal((await dispatch('profile.contexts.assignLanguage', { protocolVersion: 2, contextId: 'cv', language: 'pl', expectedRevision: 1 })).ok, true);
    assert.equal(h.cvContexts.list().length, 1);
    assert.equal((await dispatch('profile.update', { document: {} })).ok, false);
    const id = randomUUID();
    assert.equal((await dispatch('profile.contexts.create', { protocolVersion: 1, id, language: 'en' })).ok, false);
    assert.equal(h.cvContexts.get(id), undefined);
    assert.equal((await dispatch('profile.contexts.create', { protocolVersion: 2, id, language: 'en' })).ok, true);
    assert.equal(h.profile.readContext(id).record, undefined);
    assert.equal(h.cvContexts.get(id)?.includePhoto, false);
    assert.equal(h.profile.readContext('cv').record?.body.role_description, body.role_description);
  } finally { h.close(); s.dispose(); }
});

test('repeated IPC run start recovers the same run after response loss without executing twice', async () => {
  const s = scratch(); let calls = 0;
  const probe = noop('probe', [stage('work', [transform('once', async () => { calls++; return {}; })])]);
  let h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try {
    const snapshot = fixture(h); let dispatch = createDispatch(h);
    const request = { protocolVersion: 2, runId: 'once', capability: 'probe', input: {},
      contextId: snapshot.context.id, conversationId: snapshot.conversationId, offerSnapshotId: snapshot.id };
    assert.equal((await dispatch('run.offer.start', request)).ok, true);
    assert.equal((await dispatch('run.offer.start', request)).ok, true);
    assert.equal((await dispatch('run.await', { runId: 'once' })).ok, true);
    h.close(); h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } }); dispatch = createDispatch(h);
    assert.equal((await dispatch('run.offer.start', request)).ok, true);
    assert.equal(calls, 1);
    assert.equal((await dispatch('run.offer.start', { ...request, contextId: 'wrong' })).ok, false);
  } finally { h.close(); s.dispose(); }
});

test('contract migration rolls back atomically and preserves historical run ownership', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((m) => m.version <= 14));
    db.exec("INSERT INTO runs (id, capability, status, input, trace_id, created_at) VALUES ('old', 'probe', 'succeeded', '{}', 'old', 1)");
    const step = migrations.find((m) => m.version === 15)!;
    assert.throws(() => migrate(db, [{ ...step, sql: step.sql + '; SELECT * FROM missing_table;' }]));
    assert.equal(db.pragma('user_version', { simple: true }), 14);
    migrate(db); migrate(db);
    assert.deepEqual(db.prepare('SELECT id, offer_snapshot_id FROM runs').all(), [{ id: 'old', offer_snapshot_id: null }]);
  } finally { db.close(); }
});

test('checked editor writes recover receipts without overwriting later edits', () => {
  const s = scratch(); let h = createHarness({ databasePath: s.path, env: {} });
  try {
    const context = h.cvContexts.create(randomUUID(), 'pl');
    const original = h.profile.replaceContext(context.id, body, 0, 'save-one');
    h.profile.replaceContext(context.id, { role_description: 'Later edit' }, 1, 'save-two');
    h.close(); h = createHarness({ databasePath: s.path, env: {} });
    assert.deepEqual(h.profile.replaceContext(context.id, body, 0, 'save-one'), original);
    assert.equal(h.profile.readContext(context.id).record?.body.role_description, 'Later edit');
    assert.throws(() => h.profile.replaceContext(context.id, {}, 1, 'stale-editor'), { code: 'document_conflict' });
    assert.throws(() => h.profile.replaceContext(context.id, {}, 0, 'save-one'), { code: 'context_conflict' });
  } finally { h.close(); s.dispose(); }
});

test('legacy queued work blocks assignment until startup recovery settles it without replay', () => {
  const s = scratch(); const h = createHarness({ databasePath: s.path, env: {} });
  try {
    h.profile.replace(body);
    h.runs.create({ id: 'interrupted-queued', capability: 'probe', input: {}, traceId: 'q', createdAt: 1 }, []);
    assert.throws(() => h.cvContexts.assignLanguage('cv', 'pl', 1), { code: 'context_conflict' });
    assert.equal(h.cvContexts.get('cv')?.language, null);
    assert.equal(h.recoverInterrupted()[0]?.errorCode, 'process_interrupted');
    assert.equal(h.cvContexts.assignLanguage('cv', 'pl', 1).language, 'pl');
    assert.equal(h.recoverInterrupted().length, 0);
  } finally { h.close(); s.dispose(); }
});

test('competing hosts cannot create a second language owner or reapply a copy', () => {
  const s = scratch(); const a = createHarness({ databasePath: s.path, env: {} });
  const b = createHarness({ databasePath: s.path, env: {} });
  try {
    const snapshot = fixture(a);
    const request = { id: randomUUID(), language: 'en' as const, sourceContextId: snapshot.context.id, expectedSourceRevision: 1 };
    const result = a.cvCopies.copy(request);
    assert.deepEqual(b.cvCopies.copy(request), result);
    assert.throws(() => b.cvContexts.create(randomUUID(), 'en'), { code: 'language_in_use' });
    assert.equal(b.cvContexts.list().length, 2);
  } finally { b.close(); a.close(); s.dispose(); }
});

test('built-in offer inputs come from captured facts and use document language by default', async () => {
  const { snapshotInput } = await import('../src/runtime/offer-scope.js');
  const { inputSchema: evidence } = await import('../src/capabilities/cv/evidence.js');
  const { inputSchema: draft } = await import('../src/capabilities/apply/draft.js');
  const { inputSchema: verify } = await import('../src/capabilities/recipient/verify.js');
  const s = scratch(); const h = createHarness({ databasePath: s.path, env: {} });
  try {
    const snapshot = fixture(h);
    const saved = { ...snapshot, offer: { ...snapshot.offer, company: 'Original company', position: 'Engineer', skills: ['TypeScript'] } };
    assert.deepEqual(evidence.parse(snapshotInput(saved, 'generate_evidence_summary', {})).offer.required_skills, ['TypeScript']);
    assert.equal(draft.parse(snapshotInput(saved, 'draft_application', {})).language, 'pl');
    assert.equal(draft.parse(snapshotInput(saved, 'draft_application', { language: 'en' })).language, 'en');
    assert.equal(verify.parse(snapshotInput(saved, 'verify_recipient', {})).company, 'Original company');
    assert.throws(() => snapshotInput(saved, 'verify_recipient', { company: 'Wrong company' }), { code: 'invalid_input' });
    assert.throws(() => snapshotInput(saved, 'extract_cv', {}), { code: 'invalid_input' });
  } finally { h.close(); s.dispose(); }
});

test('persisted suspended legacy work can be cancelled before language assignment', async () => {
  const s = scratch();
  const probe = noop('probe', [stage('work', [transform('approval', async (ctx) => {
    ctx.approvals.request({ key: 'go', kind: 'confirm', question: 'Continue?', payload: {} }); return {};
  })])]);
  let h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  try {
    h.profile.replace(body);
    await assert.rejects(h.run({ runId: 'legacy-suspended', capability: 'probe', input: {} }));
    h.close(); h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
    assert.throws(() => h.cvContexts.assignLanguage('cv', 'pl', 1), { code: 'context_conflict' });
    const result = await createDispatch(h)('run.cancel', { runId: 'legacy-suspended' });
    assert.equal(result.ok, true);
    assert.equal(h.runs.get('legacy-suspended')?.status, 'cancelled');
    assert.equal(h.cvContexts.assignLanguage('cv', 'pl', 1).language, 'pl');
    assert.throws(() => h.runs.create({ id: 'late-legacy', capability: 'probe', input: {}, traceId: 'l', createdAt: 2 }, []), { code: 'invalid_input' });
  } finally { h.close(); s.dispose(); }
});

test('snapshot question input supplies immutable posting and rejects caller replacement', () => {
  const s = scratch(); const h = createHarness({ databasePath: s.path, env: {} });
  try {
    const snapshot = fixture(h);
    h.offers.save({ ...offer, text: 'Changed posting' });
    assert.deepEqual(snapshotInput(snapshot, 'ask_profile', { question: 'Am I a fit?', history: [] }),
      { question: 'Am I a fit?', history: [], offerText: 'Original posting' });
    assert.throws(() => snapshotInput(snapshot, 'ask_profile', { question: 'Q', offerText: 'Override' }), { code: 'invalid_input' });
  } finally { h.close(); s.dispose(); }
});
