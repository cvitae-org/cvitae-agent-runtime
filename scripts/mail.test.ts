/**
 * The one effect that can do something in the world that cannot be undone.
 *
 * Everything here is about a single question — after this call, does the
 * attempt row say "did not happen" or does it say "we cannot tell"? — because
 * that is the only thing standing between a crash and a second copy of a job
 * application arriving in someone's inbox.
 *
 * The `upstream_error` test is the one that matters. It is tempting to file
 * every non-2xx answer under "the send failed", and Google failing partway is
 * exactly the case where the message may already be gone. Recording that as a
 * definite failure would turn the one state the attempt log exists to preserve
 * into a lie, so the row stays open and a person is asked.
 *
 * Confirmed by breaking it: adding `upstream_error` to `NOTHING_SENT` makes
 * that test fail, with the row settled `failed` and `unsettled()` empty — the
 * shape in which a resumed run would send the message a second time without
 * anyone being asked.
 *
 * The guard underneath is the real `createGuard` over a real database, so
 * these assertions are about rows on disk rather than about a double.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeError } from '../src/contracts/index.js';
import type { Mail } from '../src/contracts/index.js';
import { createGuard } from '../src/effects/attempts.js';
import { createMailSender } from '../src/effects/mail.js';
import { createAttemptLog } from '../src/storage/sqlite/attempts.js';
import { scratch, seedRun } from './support/db.js';

const call = { traceId: 'trace-1', runId: 'run-1', step: 'send', signal: new AbortController().signal };

const mail: Mail = {
  to: 'recruiter@example.com',
  subject: 'Application: Senior TypeScript Engineer',
  body: 'Dear hiring team,\n\nI am writing about the posting…'
};

const codeOf = (error: unknown): string =>
  error instanceof RuntimeError ? error.code : `not a RuntimeError: ${String(error)}`;

/** A sender over a real guard and a real database, plus the rows to inspect. */
const harness = (reply: () => Response) => {
  const s = scratch();

  seedRun(s.db);

  const log = createAttemptLog(s.db);
  const asked: string[] = [];

  const mailer = createMailSender({
    url: 'http://127.0.0.1:8789',
    guard: createGuard(log),
    fetch: (async (input: string | URL | Request) => {
      asked.push(typeof input === 'string' ? input : input.toString());
      return reply();
    }) as unknown as typeof globalThis.fetch
  });

  const rows = () =>
    s.db.prepare('SELECT * FROM effect_attempts').all() as {
      effect: string;
      request: string;
      outcome: string | null;
      settled_at: number | null;
    }[];

  return { mailer, log, rows, asked, dispose: () => s.dispose() };
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

test('a sent message is recorded, without a copy of what was sent', async () => {
  const h = harness(() => json(200, { status: 'ok', data: { id: 'gmail-1' } }));

  try {
    assert.deepEqual(await h.mailer.send(mail, call), { id: 'gmail-1' });
    assert.deepEqual(h.asked, ['http://127.0.0.1:8789/send']);

    const [row] = h.rows();

    assert.equal(row?.effect, 'mail.send');
    assert.equal(row?.outcome, 'ok');

    // The body is a length, not a copy. The attempt table answers "did this
    // happen", and every letter ever sent is not part of that answer.
    assert.deepEqual(JSON.parse(row?.request ?? '{}'), {
      to: 'recruiter@example.com',
      subject: 'Application: Senior TypeScript Engineer',
      bodyChars: mail.body.length
    });
  } finally {
    h.dispose();
  }
});

test('a refusal the service names is settled as a definite failure', async () => {
  const h = harness(() => json(403, { status: 'not_allowed', detail: 'Sending is switched off.' }));

  try {
    const error = await h.mailer.send(mail, call).then(() => undefined, (r: unknown) => r);

    assert.equal(codeOf(error), 'step_failed');
    assert.match((error as Error).message, /switched off/);

    // The service refused before it dialled out, so it knows. The row closes.
    assert.equal(h.rows()[0]?.outcome, 'failed');
    assert.deepEqual(h.log.unsettled('run-1'), []);
  } finally {
    h.dispose();
  }
});

test('an upstream failure leaves the row open, because it may have gone out', async () => {
  const h = harness(() => json(502, { status: 'upstream_error', detail: 'Gmail returned 500.' }));

  try {
    const error = await h.mailer.send(mail, call).then(() => undefined, (r: unknown) => r);

    assert.equal(codeOf(error), 'step_failed');

    // Not settled. This is the "we cannot tell" state, and it is the reason
    // the table exists at all.
    assert.equal(h.rows()[0]?.outcome, null);
    assert.equal(h.rows()[0]?.settled_at, null);
    assert.deepEqual(
      h.log.unsettled('run-1').map((attempt) => attempt.effect),
      ['mail.send']
    );

    // And the next attempt at the same message stops rather than resending.
    const again = await h.mailer.send(mail, call).then(() => undefined, (r: unknown) => r);

    assert.equal(codeOf(again), 'unsettled_attempt');
    assert.equal(h.asked.length, 1, 'the message was sent a second time');
  } finally {
    h.dispose();
  }
});

test('an unreachable service leaves the row open too', async () => {
  const h = harness(() => {
    throw new Error('ECONNREFUSED');
  });

  try {
    const error = await h.mailer.send(mail, call).then(() => undefined, (r: unknown) => r);

    assert.equal(codeOf(error), 'step_failed');
    assert.match((error as Error).message, /could not be reached/);

    // A socket that closed here says nothing about what the other end did.
    assert.equal(h.rows()[0]?.settled_at, null);
  } finally {
    h.dispose();
  }
});

test('an answer in an unrecognised shape is not read as a refusal', async () => {
  // A proxy error page, not the service talking. Guessing at it either way
  // would be inventing an answer about whether a message was sent.
  const h = harness(() => json(500, { error: 'Bad Gateway' }));

  try {
    const error = await h.mailer.send(mail, call).then(() => undefined, (r: unknown) => r);

    assert.equal(codeOf(error), 'step_failed');
    assert.match((error as Error).message, /unrecognised shape/);
    assert.equal(h.rows()[0]?.settled_at, null);
  } finally {
    h.dispose();
  }
});

test('drafting and sending the same words are different pieces of work', async () => {
  const h = harness(() => json(200, { status: 'ok', data: { id: 'gmail-1' } }));

  try {
    await h.mailer.draft(mail, call);
    await h.mailer.send(mail, call);

    assert.deepEqual(h.asked, ['http://127.0.0.1:8789/draft', 'http://127.0.0.1:8789/send']);
    assert.deepEqual(
      h.rows().map((row) => row.effect).sort(),
      ['mail.draft', 'mail.send']
    );
  } finally {
    h.dispose();
  }
});

test('a non-loopback mail service is refused at wiring time, not at the first message', () => {
  const s = scratch();

  try {
    // Thrown while building the sender, so a misconfigured runtime fails at
    // startup rather than the first time someone tries to send something. A
    // remote URL here would hand every outgoing message to a host the user
    // did not choose.
    assert.throws(
      () =>
        createMailSender({
          url: 'https://mail.example.com',
          guard: createGuard(createAttemptLog(s.db)),
          fetch: (() => {
            throw new Error('a request was made to a remote mail service');
          }) as unknown as typeof globalThis.fetch
        }),
      (error: unknown) => codeOf(error) === 'misconfigured' && /localhost/.test(String(error))
    );
  } finally {
    s.dispose();
  }
});
