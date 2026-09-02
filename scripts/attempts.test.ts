/**
 * The ordering that makes an outward call answerable after a crash.
 *
 * The first test is the one the whole design rests on, and it is written to be
 * hard to fool: it reads the attempt row from a *second connection* while the
 * call is still in flight. A row visible to another connection is a row that
 * survived the commit, which is the property "written before the call" actually
 * means — an uncommitted row would be invisible there and equally invisible to
 * a process that started after a crash.
 *
 * Confirmed by breaking it, twice.
 *
 * Moving `log.begin` to after the call fails five of the six tests; the first
 * one fails on exactly the durability read, with nothing visible to the second
 * connection while the call was in flight.
 *
 * Inferring re-entry from `startedAt` instead of from the insert-versus-
 * collision answer — `existing: attempt.startedAt !== existing.started_at` —
 * fails four, and the frozen-clock test is the one that fails *by construction*
 * rather than by timing: with a clock that never moves, a re-entry is
 * indistinguishable from a fresh attempt, and the guard passes a second call
 * straight through to the service. The other three fail for the same reason
 * incidentally, because they too complete inside one millisecond.
 *
 * Nothing here touches a network. The "call" is a function this file controls,
 * which is the only way to assert on what happens strictly between the commit
 * and the response.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeError } from '../src/contracts/index.js';
import { createGuard, idempotencyKeyFor, attemptId } from '../src/effects/attempts.js';
import { createAttemptLog } from '../src/storage/sqlite/attempts.js';
import type { Db } from '../src/storage/sqlite/open.js';
import { scratch, seedRun } from './support/db.js';

const call = { traceId: 'trace-1', runId: 'run-1', step: 'send', signal: new AbortController().signal };

const spec = (key = 'mail.send:run-1:send:abc') => ({
  effect: 'mail.send',
  idempotencyKey: key,
  request: { to: 'someone@example.com', subject: 'Hello', bodyChars: 412 }
});

const rowFrom = (db: Db, key: string) =>
  db.prepare('SELECT * FROM effect_attempts WHERE idempotency_key = ?').get(key) as
    | { id: string; effect: string; request: string; outcome: string | null; settled_at: number | null }
    | undefined;

const codeOf = (error: unknown): string =>
  error instanceof RuntimeError ? error.code : `not a RuntimeError: ${String(error)}`;

test('the attempt is committed before the call, not alongside it', async () => {
  const s = scratch();

  try {
    seedRun(s.db);
    const guard = createGuard(createAttemptLog(s.db));
    const observer = s.connect();
    let seenMidCall: ReturnType<typeof rowFrom>;

    await guard(spec(), call, async () => {
      // Another connection entirely. It can only see committed rows, which is
      // exactly what a process recovering from a crash can see.
      seenMidCall = rowFrom(observer, spec().idempotencyKey);
      return { id: 'gmail-1' };
    });

    assert.ok(seenMidCall, 'the row was not durable while the call was in flight');
    assert.equal(seenMidCall.settled_at, null);
    assert.equal(seenMidCall.effect, 'mail.send');

    // And the summary is all that was written. A body in this table would
    // outlive the message and answer a question nobody asked it.
    assert.deepEqual(JSON.parse(seenMidCall.request), {
      to: 'someone@example.com',
      subject: 'Hello',
      bodyChars: 412
    });

    assert.equal(rowFrom(s.db, spec().idempotencyKey)?.outcome, 'ok');
  } finally {
    s.dispose();
  }
});

test('an unsettled row on recovery refuses; it never retries', async () => {
  const s = scratch();

  try {
    seedRun(s.db);
    const log = createAttemptLog(s.db);
    const guard = createGuard(log);

    // A crash mid-call, reproduced exactly: the row is committed, the call
    // throws, and nothing claims to know whether it landed.
    const first = await guard(spec(), call, async () => {
      throw new Error('socket hang up');
    }).then(() => undefined, (reason: unknown) => reason);

    assert.match((first as Error).message, /socket hang up/);
    assert.deepEqual(
      log.unsettled('run-1').map((attempt) => attempt.effect),
      ['mail.send']
    );

    // The next process starts, the step re-runs, and the same key comes back.
    let calledAgain = false;

    const second = await guard(spec(), call, async () => {
      calledAgain = true;
      return { id: 'gmail-2' };
    }).then(() => undefined, (reason: unknown) => reason);

    assert.equal(codeOf(second), 'unsettled_attempt');
    assert.equal(calledAgain, false, 'the call was retried; it may now have happened twice');
  } finally {
    s.dispose();
  }
});

test('a settled success is replayed from disk, not asked for twice', async () => {
  const s = scratch();

  try {
    seedRun(s.db);
    const guard = createGuard(createAttemptLog(s.db));
    let calls = 0;

    const perform = async () => {
      calls += 1;
      return { id: 'gmail-1', threadId: 't-9' };
    };

    const first = await guard(spec(), call, perform);
    const second = await guard(spec(), call, perform);

    assert.equal(calls, 1);
    // The caller gets what the first call returned — the reason the result is
    // stored whole rather than summarised.
    assert.deepEqual(second, first);
    assert.deepEqual(second, { id: 'gmail-1', threadId: 't-9' });
  } finally {
    s.dispose();
  }
});

test('only an error that proves nothing happened settles the row', async () => {
  const s = scratch();

  try {
    seedRun(s.db);
    const log = createAttemptLog(s.db);
    const guard = createGuard(log);

    const refused = new RuntimeError('The recipient is not allowed.', 'step_failed');

    await guard(
      { ...spec('definite'), didNotHappen: (error) => error === refused },
      call,
      async () => {
        throw refused;
      }
    ).then(() => undefined, () => undefined);

    const row = rowFrom(s.db, 'definite');

    assert.equal(row?.outcome, 'failed');
    assert.notEqual(row?.settled_at, null);

    // Recorded as a code and a message, never the underlying error's own text
    // — which for a model or a mail service carries the payload with it.
    assert.deepEqual(log.unsettled('run-1'), []);

    // A definite failure keeps the key spent. A legitimate second try comes
    // from a fresh run building a fresh key, not from reusing this one.
    let calledAgain = false;

    const again = await guard({ ...spec('definite') }, call, async () => {
      calledAgain = true;
      return { id: 'gmail-2' };
    }).then(() => undefined, (reason: unknown) => reason);

    assert.equal(codeOf(again), 'step_failed');
    assert.equal(calledAgain, false);
  } finally {
    s.dispose();
  }
});

test('two attempts in the same millisecond are still told apart', async () => {
  const s = scratch();

  try {
    seedRun(s.db);
    // A clock that never moves. `startedAt` cannot distinguish anything here,
    // so only the insert-versus-collision answer from `begin` can.
    const guard = createGuard(createAttemptLog(s.db), () => 1_000);
    let calls = 0;

    await guard(spec(), call, async () => {
      calls += 1;
      throw new Error('socket hang up');
    }).then(() => undefined, () => undefined);

    const second = await guard(spec(), call, async () => {
      calls += 1;
      return { id: 'gmail-2' };
    }).then(() => undefined, (reason: unknown) => reason);

    assert.equal(codeOf(second), 'unsettled_attempt');
    assert.equal(calls, 1);
  } finally {
    s.dispose();
  }
});

test('keys are built so two different calls cannot share a row', () => {
  // The separator has to be one no component can contain, or these two are the
  // same string and one call answers for the other.
  assert.notEqual(idempotencyKeyFor(['a', 'b:c']), idempotencyKeyFor(['a:b', 'c']));

  // Derived, not random: a step re-running after a resume computes the same id
  // and collides with its own earlier row rather than opening a second one.
  assert.equal(attemptId('mail.send:run-1'), attemptId('mail.send:run-1'));
  assert.notEqual(attemptId('mail.send:run-1'), attemptId('mail.send:run-2'));
  assert.match(attemptId('mail.send:run-1'), /^[0-9a-f]{32}$/);
});
