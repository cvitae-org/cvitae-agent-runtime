/**
 * The IPC surface, driven as a function.
 *
 * Every test here calls `dispatch(channel, payload)` directly. There is no
 * Electron in this repo and none is needed — which is the claim being tested as
 * much as anything else. If a channel needed `ipcMain` to be exercised, the
 * transport would be load-bearing and the next host would have to reimplement
 * the surface rather than wire it up.
 *
 * The harness underneath is the real one: real SQLite, real core, real
 * composition root, with test capabilities and a model gateway that throws.
 * Only the subject is substituted, so what these tests prove about the envelope
 * they prove about the envelope production uses.
 *
 * Confirmed by breaking things, each mutation run and reverted:
 *
 *   dispatch rethrows instead of returning `{ ok: false }` — four tests die
 *     with the error rather than reading its code, which is roughly what a
 *     renderer would experience: every path that can go wrong goes wrong the
 *     same unreadable way.
 *   the payload is passed through unvalidated — the bad-payload test gets an
 *     `internal` error out of zod inside the capability instead of
 *     `invalid_input` at the boundary, which is the distinction the whole
 *     validate-first rule exists to make.
 *   `run.cancel` returns `{ cancelled: true }` for a run it never started —
 *     the not-running-here test fails, and with it the only signal a caller has
 *     that its cancel did nothing.
 *   the in-flight map is not cleared in `finally` — the map still holds a
 *     controller for a finished run, so cancelling it reports success.
 *   `RunSuspension` is treated as an error — the suspend test gets
 *     `{ ok: false }` where a parked run should read as an answer.
 *   `run.start` awaits the run before answering — the cancel test deadlocks.
 *     The id a caller needs in order to cancel arrives only once there is
 *     nothing left to cancel, which is the whole reason the front door is
 *     shaped this way.
 *   `run.await` reads only the in-flight map — a run that settled before the
 *     call was made reads as `not_found`, so whether a caller ever sees its
 *     result depends on how quickly it asked.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { channels, type Response } from '../src/adapters/ipc/channels.js';
import {
  CV_ID,
  CV_KIND,
  cvDocumentSchema
} from '../src/capabilities/cv/document.js';
import { createHarness, silentLogger, type Harness } from '../src/runtime/create.js';
import type { CapabilityMap, RunEvent, RunRecord } from '../src/contracts/index.js';
import { noop, stage, transform, untilAborted } from './support/spine.js';

/* ------------------------------------------------------------------- setup */

const harnessFor = (capabilities: CapabilityMap): { harness: Harness; dispose(): void } => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-ipc-'));
  const harness = createHarness({
    databasePath: join(dir, 'harness.db'),
    capabilities,
    logger: silentLogger,
    // Nothing inherited and nothing dialled. These tests are about the
    // envelope, and a channel sweep that opens a socket would pass or fail
    // depending on what is running on the machine.
    env: {},
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });

  return {
    harness,
    dispose: () => {
      harness.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

const capabilities = (): CapabilityMap => ({
  fine: noop('fine', [stage('only', [transform('work', async () => ({ answer: 42 }))])]),

  broken: noop('broken', [
    stage('only', [
      transform('work', async () => {
        throw new Error('the step gave up');
      })
    ])
  ]),

  asks: noop('asks', [
    stage('only', [
      transform('work', async (context) => {
        const decision = context.approvals.request({
          key: 'go',
          kind: 'confirm',
          question: 'Proceed?',
          payload: {}
        });
        return { went: decision.status };
      })
    ])
  ]),

  slow: noop('slow', [
    stage('only', [transform('work', (context) => untilAborted(context.signal))])
  ])
});

/** Asserts the envelope succeeded and hands back its data, typed by the caller. */
const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

/* ------------------------------------------------------------------- tests */

test('every declared channel answers, and an undeclared one is refused by name', async () => {
  const { harness, dispose } = harnessFor(capabilities());
  const dispatch = createDispatch(harness);

  try {
    // Not a smoke test: a channel added to the table and never wired would be
    // a `TypeError` on a live IPC call and nothing at all until then.
    for (const channel of channels) {
      const response = await dispatch(channel, { runId: 'nope', capability: 'fine', approvalId: 'x', status: 'granted' });
      assert.ok('ok' in response, `${channel} answered with something that is not an envelope`);
    }

    const unknown = await dispatch('runs.delete', {});
    assert.deepEqual(unknown, {
      ok: false,
      error: { code: 'unknown_channel', message: 'No such channel: "runs.delete".' }
    });
  } finally {
    dispose();
  }
});

test('profile channels distinguish absence and atomically replace the canonical CV', async () => {
  const { harness, dispose } = harnessFor(capabilities());
  const dispatch = createDispatch(harness);

  try {
    assert.deepEqual(data(await dispatch('profile.get', {})), {
      present: false,
      record: null
    });

    harness.documents.update(CV_ID, CV_KIND, () => cvDocumentSchema.parse({
      role_description: 'Old profile'
    }));
    harness.chunks.replace(
      CV_ID,
      {
        provider: 'test',
        model: 'old-profile',
        dim: 2,
        normalisation: 'l2',
        chunkerVersion: 1
      },
      [{
        id: 'old-highlight',
        kind: 'highlight',
        text: 'Text that must not survive the edit.',
        position: 0,
        vector: Float32Array.of(1, 0)
      }]
    );

    const document = cvDocumentSchema.parse({
      personal: { name: 'Ada Lovelace' },
      role_description: 'Computing pioneer'
    });
    const updated = data<{
      present: boolean;
      record: { revision: number; body: typeof document };
      clearedChunks: number;
    }>(await dispatch('profile.update', { document }));

    assert.equal(updated.present, true);
    assert.equal(updated.record.revision, 2);
    assert.deepEqual(updated.record.body, document, 'the edit was merged instead of replacing');
    assert.equal(updated.clearedChunks, 1);
    assert.equal(harness.chunks.fingerprintOf(CV_ID), undefined);

    const read = data<{
      present: boolean;
      record: { revision: number; body: typeof document };
    }>(await dispatch('profile.get', {}));
    assert.equal(read.present, true);
    assert.equal(read.record.revision, 2);
    assert.deepEqual(read.record.body, document);
  } finally {
    dispose();
  }
});

test('an invalid profile edit is refused before it can change the CV or its index', async () => {
  const { harness, dispose } = harnessFor(capabilities());
  const dispatch = createDispatch(harness);

  try {
    harness.documents.update(CV_ID, CV_KIND, () => cvDocumentSchema.parse({
      role_description: 'Keep me'
    }));
    harness.chunks.replace(
      CV_ID,
      {
        provider: 'test',
        model: 'still-current',
        dim: 1,
        normalisation: 'l2',
        chunkerVersion: 1
      },
      [{
        id: 'current-highlight',
        kind: 'highlight',
        text: 'Still current.',
        position: 0,
        vector: Float32Array.of(1)
      }]
    );

    const response = await dispatch('profile.update', {
      document: { version: 2, role_description: 'Do not write me' }
    });

    assert.equal(response.ok, false);
    assert.ok(!response.ok && response.error.code === 'invalid_input');
    assert.equal(harness.documents.read(CV_ID)?.body.role_description, 'Keep me');
    assert.equal(harness.documents.read(CV_ID)?.revision, 1);
    assert.equal(harness.chunks.fingerprintOf(CV_ID)?.model, 'still-current');
  } finally {
    dispose();
  }
});

test('profile replacement rolls its document write back if index invalidation fails', async () => {
  const { harness, dispose } = harnessFor(capabilities());
  const dispatch = createDispatch(harness);
  const originalClear = harness.chunks.clear;

  try {
    harness.documents.update(CV_ID, CV_KIND, () => cvDocumentSchema.parse({
      role_description: 'Committed profile'
    }));

    Object.assign(harness.chunks, {
      clear: () => {
        throw new Error('simulated index failure');
      }
    });

    const response = await dispatch('profile.update', {
      document: cvDocumentSchema.parse({ role_description: 'Half-written profile' })
    });

    assert.equal(response.ok, false);
    assert.ok(!response.ok && response.error.code === 'internal');
    assert.equal(harness.documents.read(CV_ID)?.body.role_description, 'Committed profile');
    assert.equal(harness.documents.read(CV_ID)?.revision, 1);
  } finally {
    Object.assign(harness.chunks, { clear: originalClear });
    dispose();
  }
});

test('a run answers with its id first, and with its result when asked for it', async () => {
  const { harness, dispose } = harnessFor(capabilities());
  const dispatch = createDispatch(harness);

  try {
    const { runId } = data<{ runId: string }>(
      await dispatch('run.start', { capability: 'fine', input: {} })
    );

    // The load-bearing assertion in this file. The run exists, is executing,
    // and is nameable — so it can be cancelled, its events subscribed to and
    // its approvals answered — all while it is still going. A front door that
    // answered with the result would have nothing to say until it was too late
    // for any of the three.
    assert.equal(harness.runs.get(runId)?.status, 'running');

    const result = data<{ runId: string; data: Record<string, unknown> }>(
      await dispatch('run.await', { runId })
    );

    assert.equal(result.runId, runId);
    assert.deepEqual(result.data, { answer: 42 });

    const seen = data<{ run: RunRecord }>(await dispatch('runs.get', { runId }));
    assert.equal(seen.run.status, 'succeeded');

    // Asked again, past the point where this dispatcher was still holding it.
    // The row is the durable copy of the same answer, so the second reading
    // agrees with the first rather than being a different kind of thing.
    assert.deepEqual(data(await dispatch('run.await', { runId })), result);
  } finally {
    dispose();
  }
});

test('a failing run is an envelope with a code, not a rejected promise', async () => {
  const { harness, dispose } = harnessFor(capabilities());
  const dispatch = createDispatch(harness);

  try {
    // Starting a doomed run still succeeds. The request was well formed and a
    // row exists; the failure belongs to the outcome, and conflating the two
    // would leave a real run with no id to look it up by.
    const { runId } = data<{ runId: string }>(
      await dispatch('run.start', { capability: 'broken', input: {} })
    );

    // The assertion is as much that this line completes as what it returns: a
    // rejection here would cross a real IPC boundary as an empty object.
    const response = await dispatch('run.await', { runId });

    assert.equal(response.ok, false);
    assert.ok(!response.ok && response.error.code, 'the failure carried no code');
    assert.ok(!response.ok && response.error.message.includes('gave up'));

    // And again from the row, once the promise that carried it is gone. A
    // reason that survives only as long as the process held the run is a reason
    // a caller can lose by reconnecting.
    assert.deepEqual(await dispatch('run.await', { runId }), response);
  } finally {
    dispose();
  }
});

test('a bad payload is refused at the boundary, before anything is asked to run', async () => {
  const { harness, dispose } = harnessFor(capabilities());
  const dispatch = createDispatch(harness);

  try {
    const response = await dispatch('run.start', { capability: '' });

    assert.equal(response.ok, false);
    // `invalid_input` and not whatever the capability would have said: the
    // difference between the boundary refusing a payload and the domain
    // refusing an input is the difference this rule exists to keep.
    assert.ok(!response.ok && response.error.code === 'invalid_input');
    assert.ok(!response.ok && response.error.message.includes('capability'));

    assert.deepEqual(harness.runs.list({ limit: 10 }), []);
  } finally {
    dispose();
  }
});

test('a run that stops to ask reads as an answer, not as a failure', async () => {
  const { harness, dispose } = harnessFor(capabilities());
  const dispatch = createDispatch(harness);

  try {
    const { runId } = data<{ runId: string }>(
      await dispatch('run.start', { capability: 'asks', input: {} })
    );

    const parked = data<{ suspended: boolean; runId: string; step: string }>(
      await dispatch('run.await', { runId })
    );

    assert.equal(parked.suspended, true);
    assert.equal(parked.runId, runId);
    assert.equal(parked.step, 'work');

    // The same question asked twice, once off the promise this dispatcher was
    // holding and once off the log after it let go. Two readings that disagreed
    // would mean a window showed a different question depending on whether it
    // was open when the run stopped, which is the case a person actually hits.
    assert.deepEqual(data(await dispatch('run.await', { runId })), parked);

    const [waiting] = data<{ id: string; question: string }[]>(
      await dispatch('approvals.pending', { runId })
    );
    assert.equal(waiting?.question, 'Proceed?');

    data(await dispatch('approvals.decide', { approvalId: waiting!.id, status: 'granted' }));

    const resumed = data<{ runId: string }>(await dispatch('run.resume', { runId }));
    assert.equal(resumed.runId, runId);

    const finished = data<{ data: Record<string, unknown> }>(
      await dispatch('run.await', { runId })
    );
    assert.deepEqual(finished.data, { went: 'granted' });
  } finally {
    dispose();
  }
});

test('cancelling reaches the running step; cancelling anything else says so', async () => {
  const { harness, dispose } = harnessFor(capabilities());
  const dispatch = createDispatch(harness);

  try {
    // The id is the harness's, not the caller's. Inventing one up front used to
    // be the only way to have something to cancel while a run was still going;
    // now the front door hands it back, and a caller that never thought about
    // ids can still stop the work.
    const { runId } = data<{ runId: string }>(
      await dispatch('run.start', { capability: 'slow', input: {} })
    );
    const settling = dispatch('run.await', { runId });

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(data(await dispatch('run.cancel', { runId })), { cancelled: true });

    const response = await settling;
    assert.equal(response.ok, false);

    const seen = data<{ run: RunRecord }>(await dispatch('runs.get', { runId }));
    assert.equal(seen.run.status, 'cancelled');

    // Finished, so no longer this dispatcher's to cancel. Told, rather than
    // reported as a success that did nothing.
    assert.deepEqual(data(await dispatch('run.cancel', { runId })), {
      cancelled: false,
      reason: 'not running here'
    });
  } finally {
    dispose();
  }
});

test('the event tail pages from a cursor, and the same cursor twice is not a replay', async () => {
  const { harness, dispose } = harnessFor(capabilities());
  const dispatch = createDispatch(harness);

  try {
    const { runId } = data<{ runId: string }>(
      await dispatch('run.start', { capability: 'fine', input: {} })
    );

    // Read the log only once the run is over. A tail compared against a log
    // that is still growing tests the timing of the test, not the cursor.
    data(await dispatch('run.await', { runId }));

    const whole = data<{ events: RunEvent[]; caughtUp: boolean }>(
      await dispatch('runs.events', { runId })
    );

    // Gapless from 1, which is what makes a cursor mean anything at all.
    assert.deepEqual(
      whole.events.map((event) => event.seq),
      whole.events.map((_, index) => index + 1)
    );
    assert.equal(whole.caughtUp, true);

    const first = data<{ events: RunEvent[]; cursor: number; caughtUp: boolean }>(
      await dispatch('runs.events', { runId, after: 0, limit: 2 })
    );
    assert.equal(first.events.length, 2);
    assert.equal(first.caughtUp, false);

    const rest = data<{ events: RunEvent[] }>(
      await dispatch('runs.events', { runId, after: first.cursor, limit: 50 })
    );

    // Reconnecting is this call with the number the caller already had, so the
    // two halves join with no overlap and nothing missing.
    assert.deepEqual(
      [...first.events, ...rest.events].map((event) => event.seq),
      whole.events.map((event) => event.seq)
    );
  } finally {
    dispose();
  }
});

test('no channel offers mail', () => {
  // The structural half of this is `no-channel-wraps-mail` in the boundary
  // rules, which forbids the import outright — the same rule as
  // `no-tool-wraps-mail`, one step further out, because a page that can reach
  // a channel is further from trusted than a model that can reach a tool.
  // This is the cheaper half: a channel named for it would be a mistake worth
  // catching before the import that makes it real.
  assert.deepEqual(
    channels.filter((channel) => /mail|send/i.test(channel)),
    []
  );
});
