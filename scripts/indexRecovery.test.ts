import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDocumentStore } from '../src/storage/sqlite/document-store.js';
import { createChunkIndex } from '../src/storage/sqlite/chunk-index.js';
import { createIndexRecoveryStore } from '../src/storage/sqlite/index-recovery.js';
import { createIndexRebuilder } from '../src/runtime/index-recovery.js';
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
