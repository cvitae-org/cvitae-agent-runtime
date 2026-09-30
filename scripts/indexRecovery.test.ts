import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDocumentStore } from '../src/storage/sqlite/document-store.js';
import { createChunkIndex } from '../src/storage/sqlite/chunk-index.js';
import { createIndexRecoveryStore } from '../src/storage/sqlite/index-recovery.js';
import { createIndexRebuilder } from '../src/runtime/index-recovery.js';
import { DocumentConflictError, RuntimeError, type IndexJobStatus } from '../src/contracts/index.js';
import { scratch } from './support/db.js';
import { stubGateway } from './support/spine.js';

const prose = { role_description: 'An engineer building resilient TypeScript services for customers.' };
const embed = async (request: { values: readonly string[] }) => ({
  vectors: request.values.map(() => new Float32Array([1])), provider: 'test', model: 'test', dim: 1
});

test('document writes queue a durable rebuild; failures back off and retry without reimport', async () => {
  const s = scratch();
  let clock = 100;
  const docs = createDocumentStore(s.db);
  const index = createChunkIndex(s.db);
  const jobs = createIndexRecoveryStore(s.db, index, () => clock);
  let fail = true;
  const worker = createIndexRebuilder(jobs, stubGateway({ embed: async (request) => {
    if (fail) throw new Error('embedder offline');
    return embed(request);
  } }));
  try {
    const original = docs.update('cv', 'cv', () => prose);
    assert.equal(jobs.status('cv')?.revision, 1);
    await worker.runOnce();
    assert.equal(jobs.status('cv')?.attempts, 1);
    assert.equal(jobs.status('cv')?.nextAttemptAt, 5100);
    assert.equal(jobs.claim(), undefined);
    assert.deepEqual(docs.read('cv'), original);
    fail = false; clock = 5100;
    await worker.runOnce();
    assert.equal(jobs.status('cv'), undefined);
    assert.equal(index.lexical({ text: 'engineer', limit: 3 }).length, 1);
    assert.deepEqual(docs.read('cv'), original);
  } finally { worker.close(); s.dispose(); }
});

test('a newer document supersedes an in-flight rebuild without publishing stale chunks', async () => {
  const s = scratch();
  const docs = createDocumentStore(s.db);
  const index = createChunkIndex(s.db);
  const jobs = createIndexRecoveryStore(s.db, index);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const worker = createIndexRebuilder(jobs, stubGateway({ embed: async (request) => {
    await gate; return embed(request);
  } }));
  try {
    docs.update('cv', 'cv', () => prose);
    const active = worker.runOnce();
    docs.update('cv', 'cv', () => ({ ...prose, role_description: 'A different engineer building reliable applications.' }));
    release(); await active;
    assert.equal(jobs.status('cv')?.revision, 2);
    assert.deepEqual(index.lexical({ text: 'engineer', limit: 3 }), []);
    await worker.runOnce();
    assert.equal(jobs.status('cv'), undefined);
    assert.equal(index.lexical({ text: 'different', limit: 3 }).length, 1);
  } finally { release(); worker.close(); s.dispose(); }
});

test('leases survive another store opening and expire after a crashed worker; obsolete claims cannot commit', () => {
  const s = scratch();
  let clock = 1;
  const index = createChunkIndex(s.db);
  const first = createIndexRecoveryStore(s.db, index, () => clock);
  try {
    createDocumentStore(s.db).update('cv', 'cv', () => prose);
    const old = first.claim()!;
    const connection = s.connect();
    const restarted = createIndexRecoveryStore(connection, createChunkIndex(connection), () => clock);
    assert.equal(restarted.claim(), undefined);
    clock += 300_001;
    const current = restarted.claim()!;
    assert.notEqual(current.token, old.token);
    assert.equal(first.complete(old), false);
    assert.equal(restarted.status('cv')?.attempts, 2);
  } finally { s.dispose(); }
});

test('graceful shutdown releases the job and late embedding completion never accesses closed storage', async () => {
  const s = scratch();
  const docs = createDocumentStore(s.db);
  const index = createChunkIndex(s.db);
  const jobs = createIndexRecoveryStore(s.db, index);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const worker = createIndexRebuilder(jobs, stubGateway({ embed: async (request) => { await gate; return embed(request); } }));
  docs.update('cv', 'cv', () => prose);
  const pending = worker.runOnce();
  worker.close();
  assert.ok(jobs.claim(), 'the interrupted claim can be retried immediately');
  s.dispose();
  release();
  await pending;
});

test('the automatic pump rebuilds while idle, including empty content without a model call', { timeout: 4000 }, async () => {
  const s = scratch();
  const jobs = createIndexRecoveryStore(s.db, createChunkIndex(s.db));
  const worker = createIndexRebuilder(jobs, stubGateway());
  try {
    createDocumentStore(s.db).update('cv', 'cv', () => ({}));
    worker.start();
    await delay(1200);
    assert.equal(jobs.status('cv'), undefined);
  } finally { worker.close(); s.dispose(); }
});

test('recovery waits for an import; successful inline indexing satisfies the queued job', () => {
  const s = scratch();
  const index = createChunkIndex(s.db);
  const jobs = createIndexRecoveryStore(s.db, index);
  try {
    createDocumentStore(s.db).update('cv', 'cv', () => ({}));
    s.db.prepare("INSERT INTO runs (id, capability, status, input, trace_id, created_at) VALUES ('import', 'extract_cv', 'running', '{}', 't', 0)").run();
    assert.equal(jobs.claim(), undefined);
    index.clear('cv', { expectedRevision: 1 });
    assert.equal(jobs.status('cv'), undefined);
  } finally { s.dispose(); }
});

const parking = (status: IndexJobStatus | undefined) => status && {
  parked: status.parked, errorCode: status.errorCode, nextAttemptAt: status.nextAttemptAt
};

test('a refused key parks the rebuild, keeps the CV findable by keyword, and a new key resumes it', async () => {
  const s = scratch();
  let clock = 100;
  const docs = createDocumentStore(s.db);
  const index = createChunkIndex(s.db);
  const jobs = createIndexRecoveryStore(s.db, index, () => clock);
  let refuse = true;
  let calls = 0;
  const worker = createIndexRebuilder(jobs, stubGateway({ embed: async (request) => {
    calls += 1;
    if (refuse) throw new RuntimeError('embedder: the provider refused the key', 'credential_rejected');
    return embed(request);
  } }));
  try {
    docs.update('cv', 'cv', () => prose);
    await worker.runOnce();
    assert.deepEqual(parking(jobs.status('cv')), { parked: true, errorCode: 'credential_rejected', nextAttemptAt: 0 });

    // A day of polling sends the refused key nowhere.
    clock += 86_400_000;
    await worker.runOnce();
    assert.equal(calls, 1);
    assert.equal(jobs.claim(), undefined);

    // The text is searchable meanwhile, and nothing in the index claims a
    // vector it does not have.
    assert.deepEqual(jobs.indexed('cv'), { chunks: 1, keywordOnly: true });
    assert.equal(index.lexical({ text: 'engineer', limit: 3 }).length, 1);
    assert.equal(index.fingerprintOf('cv'), undefined);
    assert.deepEqual(index.neighbours({
      vector: Float32Array.of(1), limit: 3,
      fingerprint: { provider: 'test', model: 'test', dim: 1, normalisation: 'l2', chunkerVersion: 1 }
    }), []);

    refuse = false;
    jobs.resume();
    await worker.runOnce();
    assert.equal(calls, 2);
    assert.equal(jobs.status('cv'), undefined);
    assert.deepEqual(jobs.indexed('cv'), { chunks: 1, keywordOnly: false });
  } finally { worker.close(); s.dispose(); }
});

test('only a failure a person has to fix parks; the rest keep backing off', async () => {
  const cases: readonly [Error, { parked: boolean; errorCode: string | null; nextAttemptAt: number }][] = [
    [new RuntimeError('no key for the embedder', 'misconfigured'), { parked: true, errorCode: 'misconfigured', nextAttemptAt: 0 }],
    [new RuntimeError('the embedder timed out', 'model_call_failed'), { parked: false, errorCode: 'model_call_failed', nextAttemptAt: 5100 }],
    [new Error('connect ECONNREFUSED'), { parked: false, errorCode: null, nextAttemptAt: 5100 }]
  ];
  for (const [error, expected] of cases) {
    const s = scratch();
    const jobs = createIndexRecoveryStore(s.db, createChunkIndex(s.db), () => 100);
    const worker = createIndexRebuilder(jobs, stubGateway({ embed: async () => { throw error; } }));
    try {
      createDocumentStore(s.db).update('cv', 'cv', () => prose);
      await worker.runOnce();
      assert.deepEqual(parking(jobs.status('cv')), expected, error.message);
      // Every one of them leaves the text behind for keyword search.
      assert.deepEqual(jobs.indexed('cv'), { chunks: 1, keywordOnly: true }, error.message);
    } finally { worker.close(); s.dispose(); }
  }
});

test('a parked rebuild starts again on new text, a settings save or Rebuild, and resume leaves the others alone', async () => {
  const s = scratch();
  const docs = createDocumentStore(s.db);
  const jobs = createIndexRecoveryStore(s.db, createChunkIndex(s.db), () => 100);
  const worker = createIndexRebuilder(jobs, stubGateway({ embed: async () => {
    throw new RuntimeError('no key for the embedder', 'misconfigured');
  } }));
  const park = async () => {
    await worker.runOnce();
    assert.equal(jobs.status('cv')?.parked, true);
  };
  const waiting = { parked: false, errorCode: null, nextAttemptAt: 0 };
  try {
    docs.update('cv', 'cv', () => prose);
    await park();
    docs.update('cv', 'cv', () => ({ ...prose, role_description: 'An engineer who rewrote the CV.' }));
    assert.deepEqual(parking(jobs.status('cv')), waiting, 'a new revision');
    assert.equal(jobs.status('cv')?.attempts, 0);

    await park();
    jobs.enqueue('cv');
    assert.deepEqual(parking(jobs.status('cv')), waiting, 'enqueue');

    await park();
    jobs.resume();
    assert.deepEqual(parking(jobs.status('cv')), waiting, 'resume');

    // A job that is only backing off keeps its schedule.
    s.db.prepare('UPDATE cv_index_jobs SET next_attempt_at = 9000, last_error = ? WHERE document_id = ?').run('offline', 'cv');
    jobs.resume();
    assert.deepEqual({ next: jobs.status('cv')?.nextAttemptAt, error: jobs.status('cv')?.lastError }, { next: 9000, error: 'offline' });
  } finally { worker.close(); s.dispose(); }
});

test('keyword rows never replace vectors, and a stale failure writes none', async () => {
  const s = scratch();
  const docs = createDocumentStore(s.db);
  const index = createChunkIndex(s.db);
  const jobs = createIndexRecoveryStore(s.db, index);
  const text = [{ id: 'c0', kind: 'role', text: 'An engineer.', position: 0 }];
  try {
    docs.update('cv', 'cv', () => prose);
    index.replace('cv', { provider: 'test', model: 'test', dim: 1, normalisation: 'l2', chunkerVersion: 1 },
      [{ ...text[0]!, vector: Float32Array.of(1) }], { expectedRevision: 1 });
    assert.equal(index.keepText('cv', text, { expectedRevision: 1 }), 0);
    assert.deepEqual(jobs.indexed('cv'), { chunks: 1, keywordOnly: false });
    assert.ok(index.fingerprintOf('cv'));
    assert.throws(() => index.keepText('cv', text, { expectedRevision: 2 }), DocumentConflictError);

    // The embedder fails after the CV has moved on: the failure owns nothing.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const worker = createIndexRebuilder(jobs, stubGateway({ embed: async () => {
      await gate; throw new RuntimeError('refused', 'credential_rejected');
    } }));
    try {
      docs.update('cv', 'cv', () => ({ role_description: 'A designer.' }));
      const active = worker.runOnce();
      docs.update('cv', 'cv', () => ({ role_description: 'A gardener.' }));
      release(); await active;
      assert.deepEqual(parking(jobs.status('cv')), { parked: false, errorCode: null, nextAttemptAt: 0 });
      assert.deepEqual(jobs.indexed('cv'), { chunks: 0, keywordOnly: false });
    } finally { release(); worker.close(); }
  } finally { s.dispose(); }
});

test('migration 38 adds parking to jobs already queued and to the triggers', async () => {
  const { open } = await import('../src/storage/sqlite/open.js');
  const { migrate, migrations } = await import('../src/storage/sqlite/migrate.js');
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((m) => m.version <= 37));
    db.prepare("INSERT INTO documents (id, kind, revision, body, created_at, updated_at) VALUES ('cv', 'cv', 3, '{}', 1, 2)").run();
    db.prepare("UPDATE cv_index_jobs SET attempts = 4, last_error = 'offline' WHERE document_id = 'cv'").run();
    migrate(db);
    assert.deepEqual(db.prepare('SELECT revision, attempts, error_code, parked FROM cv_index_jobs').all(),
      [{ revision: 3, attempts: 4, error_code: null, parked: 0 }]);
    db.prepare("UPDATE cv_index_jobs SET parked = 1, error_code = 'misconfigured' WHERE document_id = 'cv'").run();
    db.prepare("UPDATE documents SET revision = 4 WHERE id = 'cv'").run();
    assert.deepEqual(db.prepare('SELECT revision, attempts, error_code, parked FROM cv_index_jobs').all(),
      [{ revision: 4, attempts: 0, error_code: null, parked: 0 }]);
  } finally { db.close(); }
});
