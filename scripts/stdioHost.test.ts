/**
 * The runtime as something a Flutter app can actually talk to.
 *
 * Every test here drives the host over a pair of in-memory pipes rather than by
 * spawning a process. That is not only speed: a spawned child's failures are
 * reported as an exit code and a blob of stderr, and the properties under test
 * are about *frame ordering*, which is exactly what a process boundary makes
 * hardest to observe. The host takes its streams as arguments precisely so this
 * is possible, and the fact that it does is itself the claim that the transport
 * is not load-bearing.
 *
 * The runtime underneath is real: real SQLite, real dispatcher, real event log.
 * Only the capabilities are substituted, so what these tests prove about the
 * wire they prove about the wire production uses.
 *
 * Confirmed by breaking things, each mutation run and reverted:
 *
 *   a run watched before its reply is written, with a `watch` that catches up
 *     at once rather than waiting for the first tick — the obvious latency
 *     optimisation, and the ordering test then finds event frames ahead of the
 *     id they refer to, which is a client being told about a run it cannot name.
 *   `drain` answering "quiet" for any quiet event in a page rather than for the
 *     last one — a run answered between two ticks is abandoned mid-flight, and
 *     the frames saying it finished never arrive.
 *   `drain` reading from 0 instead of the stored cursor — the log is replayed
 *     on every tick, so a client sees the same seq, and the same question, twice.
 *   a malformed line parsed unguarded — the read loop dies with it, and every
 *     later request in that test goes unanswered rather than refused.
 *   `bridge.shutdown` waiting on in-flight work before cancelling it — quitting
 *     costs the whole five-second grace period for a run that would have
 *     stopped immediately if anyone had asked it to.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHost } from '../src/adapters/stdio/host.js';
import { PROTOCOL_VERSION, type Frame } from '../src/adapters/stdio/protocol.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import type { CapabilityMap } from '../src/contracts/index.js';
import { noop, stage, transform, untilAborted } from './support/spine.js';

/* ------------------------------------------------------------------- setup */

const capabilities = (gate: Promise<void>): CapabilityMap => ({
  fine: noop('fine', [stage('only', [transform('work', async () => ({ answer: 42 }))])]),

  // A transform can reach the delta sink directly, which is what makes this
  // test offline: the property being checked is that a fragment reaches the
  // wire, and nothing about that belongs to a model.
  talks: noop('talks', [
    stage('only', [
      transform('speak', async (context) => {
        for (const text of ['tick ', 'tock']) {
          context.deltas({ step: context.step.name, text });
        }
        return { said: 'tick tock' };
      })
    ])
  ]),

  asks: noop('asks', [
    stage('only', [
      transform('work', async (context) => ({
        went: context.approvals.request({
          key: 'go',
          kind: 'confirm',
          question: 'Proceed?',
          payload: {}
        }).status
      }))
    ])
  ]),

  /**
   * Asks, and then keeps working once answered.
   *
   * The `gate` is what makes the resumed half observable: without it the run
   * finishes inside the same tick it resumed in, and a host that stopped
   * watching at the suspension would look identical to one that did not.
   */
  paced: noop('paced', [
    stage('only', [
      transform('work', async (context) => {
        const decision = context.approvals.request({
          key: 'go',
          kind: 'confirm',
          question: 'Proceed?',
          payload: {}
        });
        await gate;
        return { went: decision.status };
      })
    ])
  ]),

  slow: noop('slow', [stage('only', [transform('work', (context) => untilAborted(context.signal))])])
});

type Driver = {
  /** Sends a request and resolves with the reply to it, ignoring pushes. */
  send(channel: string, payload?: unknown): Promise<Frame>;
  /**
   * Sends several requests in one write, so they reach the reader together.
   *
   * The only way to test what happens to a request that arrives *during* a
   * shutdown: sent separately it either lands before the close, which is
   * ordinary, or after it, when nobody is reading any more.
   */
  pipeline(...requests: { channel: string; payload?: unknown }[]): Promise<Frame>[];
  /** Sends a raw line, for the cases where a well-formed request is the thing under test. */
  raw(line: string): void;
  /** Every frame seen so far, in the order it arrived. */
  readonly frames: readonly Frame[];
  until(match: (frame: Frame) => boolean): Promise<Frame>;
  /** Lets the `paced` capability finish. */
  release(): void;
  dispose(): Promise<void>;
};

const drive = (options: { pollMs?: number } = {}): Driver => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-stdio-'));
  const input = new PassThrough();
  const output = new PassThrough();

  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = () => resolve();
  });

  const host = createHost({
    open: (deltas) =>
      createHarness({
        databasePath: join(dir, 'harness.db'),
        capabilities: capabilities(gate),
        logger: silentLogger,
        deltas
      }),
    input,
    output,
    log: () => undefined,
    // Fast enough that a test is not mostly sleeping, and still a poll rather
    // than a hook — the pump has no privileged path to the log.
    pollMs: options.pollMs ?? 2
  });

  const frames: Frame[] = [];
  const waiting: { match: (frame: Frame) => boolean; resolve: (frame: Frame) => void }[] = [];

  createInterface({ input: output, crlfDelay: Infinity }).on('line', (line) => {
    // Every line on stdout is a frame. A stray `console.log` anywhere in the
    // tree would land here and fail this parse, which is the cheapest possible
    // guard on the rule that stdout carries frames and nothing else.
    const frame = JSON.parse(line) as Frame;
    assert.ok(typeof frame.kind === 'string', `a line on stdout was not a frame: ${line}`);
    frames.push(frame);

    for (const [index, waiter] of [...waiting.entries()].reverse()) {
      if (waiter.match(frame)) {
        waiting.splice(index, 1);
        waiter.resolve(frame);
      }
    }
  });

  const until = (match: (frame: Frame) => boolean): Promise<Frame> => {
    const already = frames.find(match);
    if (already) return Promise.resolve(already);
    return new Promise((resolve) => waiting.push({ match, resolve }));
  };

  let counter = 0;

  const compose = (
    channel: string,
    payload: unknown
  ): { line: string; reply: Promise<Frame> } => {
    counter += 1;
    const id = `req-${counter}`;
    return {
      line: `${JSON.stringify({ id, channel, payload })}\n`,
      reply: until((frame) => frame.kind === 'reply' && frame.id === id)
    };
  };

  return {
    frames,
    until,
    release: () => release(),
    raw: (line) => input.write(`${line}\n`),
    send(channel, payload) {
      const { line, reply } = compose(channel, payload);
      input.write(line);
      return reply;
    },
    pipeline(...requests) {
      const composed = requests.map(({ channel, payload }) => compose(channel, payload));
      input.write(composed.map(({ line }) => line).join(''));
      return composed.map(({ reply }) => reply);
    },
    async dispose() {
      input.end();
      await host.closed;
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

/** Asserts a reply succeeded and hands back its data, typed by the caller. */
const data = <T>(frame: Frame): T => {
  assert.equal(frame.kind, 'reply');
  assert.ok(frame.kind === 'reply' && frame.ok, `expected ok, got ${JSON.stringify(frame)}`);
  return frame.data as T;
};

/* ------------------------------------------------------------------- tests */

test('the handshake says which protocol this is and what it can do', async () => {
  const host = drive();

  try {
    const hello = data<{
      protocolVersion: number;
      runtimeVersion: string;
      capabilities: { name: string }[];
    }>(await host.send('bridge.hello'));

    // Checked once, before anything else is sent. A version negotiated per
    // message is a version nobody checks; this one is a mismatch that fails at
    // startup rather than as a missing field twenty minutes in.
    assert.equal(hello.protocolVersion, PROTOCOL_VERSION);
    assert.match(hello.runtimeVersion, /^\d+\.\d+\.\d+/);
    assert.ok(hello.capabilities.some((capability) => capability.name === 'fine'));
  } finally {
    await host.dispose();
  }
});

test('the id comes back first, and then the run narrates itself', async () => {
  const host = drive();

  try {
    const { runId } = data<{ runId: string }>(await host.send('run.start', {
      capability: 'fine',
      input: {}
    }));

    await host.until(
      (frame) => frame.kind === 'event' && frame.runId === runId && frame.event.type === 'run.succeeded'
    );

    const events = host.frames.filter((frame) => frame.kind === 'event' && frame.runId === runId);

    // The ordering a client depends on: it can attach a handler the moment it
    // has the id, without racing the first frame that uses it.
    const firstEvent = host.frames.findIndex((frame) => frame.kind === 'event');
    const reply = host.frames.findIndex((frame) => frame.kind === 'reply');
    assert.ok(reply < firstEvent, 'a run was narrated before its id was handed out');

    // Gapless from 1. A client that sees 7 after 5 has found a bug here, and
    // that is only a useful thing to conclude if this holds.
    assert.deepEqual(
      events.map((frame) => (frame.kind === 'event' ? frame.event.seq : 0)),
      events.map((_, index) => index + 1)
    );

    assert.deepEqual(
      events.map((frame) => (frame.kind === 'event' ? frame.event.type : '')),
      ['run.queued', 'run.started', 'run.planned', 'step.started', 'step.succeeded', 'run.succeeded']
    );

    const outcome = data<{ data: Record<string, unknown> }>(await host.send('run.await', { runId }));
    assert.deepEqual(outcome.data, { answer: 42 });
  } finally {
    await host.dispose();
  }
});

test('prose arrives as it is written, and is never written down', async () => {
  const host = drive();

  try {
    const { runId } = data<{ runId: string }>(await host.send('run.start', {
      capability: 'talks',
      input: {}
    }));

    const settled = await host.send('run.await', { runId });
    assert.deepEqual(data<{ data: Record<string, unknown> }>(settled).data, { said: 'tick tock' });

    const deltas = host.frames.filter((frame) => frame.kind === 'delta');

    assert.deepEqual(
      deltas.map((frame) => (frame.kind === 'delta' ? frame.text : '')),
      ['tick ', 'tock']
    );
    assert.deepEqual(
      deltas.map((frame) => (frame.kind === 'delta' ? frame.seq : 0)),
      [1, 2]
    );
    assert.deepEqual([...new Set(deltas.map((f) => (f.kind === 'delta' ? f.step : '')))], ['speak']);

    await host.until(
      (frame) => frame.kind === 'event' && frame.event.type === 'run.succeeded'
    );

    // And nothing in the log about any of it. The fragments were a preview; the
    // answer is in the result, which is what a client that missed them reads.
    const logged = data<{ events: { type: string }[] }>(await host.send('runs.events', { runId }));
    assert.ok(
      logged.events.every((event) => !event.type.includes('delta')),
      'a fragment was checkpointed as an event'
    );
  } finally {
    await host.dispose();
  }
});

test('a run that stops to ask can be answered over the wire and carries on', async () => {
  const host = drive();

  try {
    const { runId } = data<{ runId: string }>(await host.send('run.start', {
      capability: 'asks',
      input: {}
    }));

    const parked = data<{ suspended: boolean; step: string }>(
      await host.send('run.await', { runId })
    );
    assert.equal(parked.suspended, true);
    assert.equal(parked.step, 'work');

    const [waiting] = data<{ id: string }[]>(await host.send('approvals.pending', { runId }));
    data(await host.send('approvals.decide', { approvalId: waiting!.id, status: 'granted' }));
    data(await host.send('run.resume', { runId }));

    const finished = data<{ data: Record<string, unknown> }>(
      await host.send('run.await', { runId })
    );
    assert.deepEqual(finished.data, { went: 'granted' });

    // The resumed half of the log continues rather than replaying. A client
    // that saw the question twice would ask a person twice.
    await host.until((frame) => frame.kind === 'event' && frame.event.type === 'run.succeeded');
    const seqs = host.frames
      .filter((frame) => frame.kind === 'event')
      .map((frame) => (frame.kind === 'event' ? frame.event.seq : 0));
    assert.deepEqual(seqs, seqs.map((_, index) => index + 1));
  } finally {
    await host.dispose();
  }
});

test('a run that is answered inside one tick keeps narrating afterwards', async () => {
  // A pump slow enough that the whole ask-and-answer cycle happens between two
  // looks. The page that arrives next therefore holds the suspension *and* the
  // resumption, which is the case that separates "this run has gone quiet" from
  // "this run said something quiet at some point".
  const host = drive({ pollMs: 400 });

  try {
    const { runId } = data<{ runId: string }>(await host.send('run.start', {
      capability: 'paced',
      input: {}
    }));

    const parked = data<{ suspended: boolean }>(await host.send('run.await', { runId }));
    assert.equal(parked.suspended, true);

    const [waiting] = data<{ id: string }[]>(await host.send('approvals.pending', { runId }));
    data(await host.send('approvals.decide', { approvalId: waiting!.id, status: 'granted' }));
    data(await host.send('run.resume', { runId }));

    // Now held mid-step, so the first page a client sees ends on a resumption
    // rather than an ending. A host that stopped watching there would deliver
    // every frame in this page and then go silent forever.
    await host.until((frame) => frame.kind === 'event' && frame.event.type === 'run.resumed');
    host.release();

    await host.until((frame) => frame.kind === 'event' && frame.event.type === 'run.succeeded');

    // Gapless *across* ticks, which is the half a single-tick run cannot show.
    // A pump that forgot where it had read to would replay the whole log every
    // time it looked, and the client would render the question again.
    const seqs = host.frames
      .filter((frame) => frame.kind === 'event' && frame.runId === runId)
      .map((frame) => (frame.kind === 'event' ? frame.event.seq : 0));

    assert.ok(seqs.length > 0);
    assert.deepEqual(seqs, seqs.map((_, index) => index + 1));
  } finally {
    await host.dispose();
  }
});

test('a bad request is answered, and the process keeps taking work', async () => {
  const host = drive();

  try {
    const unknown = await host.send('runs.delete', {});
    assert.ok(unknown.kind === 'reply' && !unknown.ok);
    assert.equal(unknown.kind === 'reply' && !unknown.ok ? unknown.error.code : '', 'unknown_channel');

    const malformed = host.until(
      (frame) => frame.kind === 'reply' && frame.id === '' && !frame.ok
    );
    host.raw('{not json at all');
    assert.ok(await malformed, 'a line that was not a request went unanswered');

    // The point of both. A client sends a bad frame — a version skew, a bug in
    // its own encoder — and the runtime it is talking to must not be the thing
    // that dies. Somebody's run is in that process.
    const hello = await host.send('bridge.hello');
    assert.ok(hello.kind === 'reply' && hello.ok);
  } finally {
    await host.dispose();
  }
});

test('an oversized attachment is refused before anything decodes it', async () => {
  const host = drive();

  try {
    const refused = await host.send('run.start', {
      capability: 'fine',
      // 'A' repeated: valid base64, and over the ten-megabyte file ceiling.
      input: { sources: [{ base64: 'A'.repeat(16 * 1024 * 1024) }] }
    });

    assert.ok(refused.kind === 'reply' && !refused.ok);
    assert.match(
      refused.kind === 'reply' && !refused.ok ? refused.error.message : '',
      /10 MB/
    );
  } finally {
    await host.dispose();
  }
});

test('shutting down stops the work, drains what is left, and then says so', async () => {
  const host = drive();

  try {
    const { runId } = data<{ runId: string }>(await host.send('run.start', {
      capability: 'slow',
      input: {}
    }));

    // A client waiting on the run, which is what makes the drain mean anything:
    // without it there is nothing in flight for shutdown to wait for.
    const waiting = host.send('run.await', { runId });

    const began = Date.now();
    const stopped = data<{ shuttingDown: boolean; cancelled: string[] }>(
      await host.send('bridge.shutdown')
    );

    // Promptly, not eventually. Waiting for a run before telling it to stop
    // spends the whole grace period on a run that would have ended instantly,
    // and a quit button that takes five seconds is a quit button people learn
    // to force-kill instead.
    assert.ok(Date.now() - began < 1_000, `shutdown took ${Date.now() - began}ms`);
    assert.equal(stopped.shuttingDown, true);
    assert.deepEqual(stopped.cancelled, [runId]);

    const outcome = await waiting;
    assert.ok(outcome.kind === 'reply' && !outcome.ok);
    assert.equal(outcome.kind === 'reply' && !outcome.ok ? outcome.error.code : '', 'aborted');

    // The final frames went out before the process stopped answering. A client
    // that asked to quit still learns how the run it started ended.
    assert.ok(
      host.frames.some(
        (frame) => frame.kind === 'event' && frame.event.type === 'run.cancelled'
      ),
      'the run ended after nobody was listening'
    );
  } finally {
    await host.dispose();
  }
});

test('a request pipelined behind a quit is refused rather than started', async () => {
  const host = drive();

  try {
    // One write, so both lines reach the reader before it closes. A client that
    // sends a request and then decides to quit produces exactly this, and the
    // request must not start work in a process that is already tearing down —
    // it would be work nobody could collect, on a database about to be closed.
    const [quit, late] = host.pipeline(
      { channel: 'bridge.shutdown' },
      { channel: 'run.start', payload: { capability: 'fine', input: {} } }
    );

    data(await quit!);

    const refused = await late!;
    assert.ok(refused.kind === 'reply' && !refused.ok);
    assert.equal(refused.kind === 'reply' && !refused.ok ? refused.error.code : '', 'closing');

    // And the run genuinely never happened, rather than being started and
    // abandoned. A refusal that leaves a row behind is a lie with a receipt.
    assert.ok(
      !host.frames.some((frame) => frame.kind === 'event'),
      'a refused request still produced a run'
    );
  } finally {
    await host.dispose();
  }
});
