/**
 * What a host sees of a run's record: the flag that says the feature is there,
 * the channel that serves the record, and the view of the store behind it.
 *
 * Whether a record is true to what a model was handed is `grounding-record.test.ts`.
 * This file drives the same record through `dispatch`, the way Studio does, and
 * asks what a window asks. Is the feature there. What did this run read, while it
 * is still going and after it has ended however it ended. What does the channel
 * say when there is nothing to say, and is that told apart from a wrong id. Is
 * the answer plain data a transport can carry. Can a host change it.
 *
 * The runs are real: a real harness over a real database, conversation and CV
 * context, with small capabilities in place of the model. Each reads the CV
 * through the port its run was handed, so each leaves one entry whose address,
 * version and digest come from the literal CV in this file and not from the code
 * under test.
 *
 * In the order of the tests:
 *
 *   the door          the feature is listed once and the earlier ones are still
 *                     there; a payload that is not exactly one run id is refused
 *   what it answers   a finished run, a failed one, one cancelled while it ran,
 *                     one waiting for an approval and the same one resumed
 *   what it will not  a run with no conversation has no record, and that is not
 *                     the answer for a run that does not exist
 *   what it hands out plain data; a store a host can read and cannot write
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 23 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * the feature flag:
 *   the feature is not listed                      1
 *   the feature is the only one listed             1
 *   the feature is listed twice                    1
 *   the selection feature is not listed            1
 *   the history feature is not listed              1
 *   the history feature is listed twice            1
 *
 * the payload:
 *   the channel takes more than a run id           1
 *   the channel takes an empty run id              1
 *   the channel takes no run id                    1
 *   the channel takes a number for a run id        1
 *
 * the answer:
 *   the answer is the record with nothing around it 5
 *   the answer carries a field that is undefined   1
 *   a run that is still going is not answered      1
 *
 * what it will not say:
 *   a run that does not exist is not looked for    1
 *   a run that does not exist is said to have no record 1
 *   a run with no record is said not to exist      1
 *   a run with no record is answered ok            1
 *   a run that does not exist is another code      1
 *   a run with no record is another code           1
 *
 * the view of the store:
 *   a host is handed the whole store               1
 *   a host reads nothing                           5
 *   an open record carries an end that is undefined 2
 *   an open record carries an outcome that is undefined 2
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { CV_ID } from '../src/capabilities/cv/document.js';
import { cvOf } from '../src/capabilities/cv/well.js';
import type { CapabilityMap, GroundingRecord, StepContext } from '../src/contracts/index.js';
import { digest } from '../src/grounding/index.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { scratch } from './support/db.js';
import { noop, stage, transform, untilAborted } from './support/spine.js';

/* ---------------------------------------------------------------- fixtures */

/** Asserts the envelope succeeded and hands back its data, typed by the caller. */
const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

/** Asserts the envelope refused and hands back why. */
const refused = (response: Response): { code: string; message: string } => {
  assert.ok(!response.ok, `expected a refusal, got ${JSON.stringify(response)}`);
  return response.error;
};

/** A capability whose one step reads the CV through the port its run was handed, then does `then`. */
const reading = (
  name: string,
  then: (context: StepContext) => Promise<Record<string, unknown>> | Record<string, unknown> = () => ({})
) =>
  noop(name, [
    stage('only', [
      transform('work', async (context) => {
        context.documents.read(CV_ID);
        return then(context);
      })
    ])
  ]);

/**
 * A harness with one CV context holding one document and one conversation about
 * it, over a database on disk. Nothing is inherited and nothing is dialled.
 */
const world = (capabilities: CapabilityMap) => {
  const s = scratch();
  const cv = createCvContextStore(s.db).create(randomUUID(), 'en');
  const harness = createHarness({
    databasePath: s.path,
    capabilities,
    logger: silentLogger,
    env: {},
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });

  harness.profile.replaceContext(cv.id, { role_description: 'Original CV' }, 0);

  const stored = harness.documents.read(cv.id);
  assert.ok(stored);

  const chat = harness.conversations.create({ kind: 'profile', id: cv.id });
  const dispatch = createDispatch(harness);

  return {
    harness,
    dispatch,
    cv,
    chat,
    /** The one entry a run that read the CV leaves, worked out from the literal document. */
    looked: {
      ref: `cv:${cv.id}`,
      version: String(stored.revision),
      digest: digest(cvOf(stored.body)),
      status: 'read',
      origin: 'server',
      via: 'port:documents'
    },
    /** Starts a run in the conversation and answers with its id. */
    async start(capability: string, over: Record<string, unknown> = {}): Promise<string> {
      const started = await dispatch('run.context.start', {
        contextId: cv.id,
        conversationId: chat.id,
        capability,
        input: {},
        ...over
      });
      return data<{ runId: string }>(started).runId;
    },
    /**
     * The record of a run, as a host receives it. Every record fetched here has to
     * be plain data in whatever state it is in: `deepEqual` is strict about a
     * property that exists and is undefined, and a JSON round trip drops it, so
     * equality is the claim that there are none. An open record is the one that
     * has fields to leave out.
     */
    async record(runId: string): Promise<GroundingRecord> {
      const { record } = data<{ record: GroundingRecord }>(await dispatch('runs.grounding', { runId }));

      assert.deepEqual(JSON.parse(JSON.stringify(record)), record, `a ${record.state} record is not plain data`);
      assert.deepEqual(structuredClone(record), record);

      return record;
    },
    dispose() {
      harness.close();
      s.dispose();
    }
  };
};

/* ------------------------------------------------------------------- tests */

test('the feature is listed once, and the ones before it are still listed', async () => {
  const w = world({});

  try {
    const { features } = data<{ features: string[] }>(await w.dispatch('protocol.get', {}));

    assert.equal(features.filter((feature) => feature === 'grounding-record').length, 1);
    assert.equal(features.filter((feature) => feature === 'grounding-selection').length, 1);
    assert.equal(features.filter((feature) => feature === 'grounding-history').length, 1);
    assert.ok(features.includes('provider-connection-test-v1'), 'the list was replaced, not added to');
    assert.ok(features.includes('cv-contexts'));
  } finally {
    w.dispose();
  }
});

test('a payload that is not exactly one run id is refused at the door', async () => {
  const w = world({});

  try {
    for (const payload of [{}, { runId: '' }, { runId: 7 }, { runId: 'run', after: 1 }]) {
      assert.equal(
        refused(await w.dispatch('runs.grounding', payload)).code,
        'invalid_input',
        `accepted ${JSON.stringify(payload)}`
      );
    }
  } finally {
    w.dispose();
  }
});

test('a finished run answers with the record it left', async () => {
  const w = world({ reads: reading('reads') });

  try {
    const runId = await w.start('reads');
    data(await w.dispatch('run.await', { runId }));

    const record = await w.record(runId);

    assert.equal(record.v, 1);
    assert.equal(record.runId, runId);
    assert.equal(record.conversationId, w.chat.id);
    assert.equal(record.state, 'closed');
    assert.equal(record.outcome, 'succeeded');
    assert.ok(record.closedAt !== undefined && record.closedAt >= record.openedAt);
    assert.deepEqual(record.entries, [w.looked]);
  } finally {
    w.dispose();
  }
});

test('a run that failed leaves its record, with what it read before it failed', async () => {
  const w = world({
    breaks: reading('breaks', () => {
      throw new Error('the step gave up');
    })
  });

  try {
    const runId = await w.start('breaks');
    refused(await w.dispatch('run.await', { runId }));

    const record = await w.record(runId);

    assert.equal(record.state, 'closed');
    assert.equal(record.outcome, 'failed');
    assert.deepEqual(record.entries, [w.looked]);
  } finally {
    w.dispose();
  }
});

test('while a run is going its record is open and has what was read so far, and a cancelled run closes it', async () => {
  let reached!: () => void;
  const read = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const w = world({
    waits: reading('waits', (context) => {
      reached();
      return untilAborted(context.signal);
    })
  });

  try {
    const runId = await w.start('waits');
    await read;

    const during = await w.record(runId);

    assert.equal(during.state, 'open');
    assert.equal(during.outcome, undefined, 'an open record has no outcome');
    assert.equal(during.closedAt, undefined, 'an open record has no end');
    assert.deepEqual(during.entries, [w.looked]);

    assert.deepEqual(data(await w.dispatch('run.cancel', { runId })), { cancelled: true });
    refused(await w.dispatch('run.await', { runId }));

    const after = await w.record(runId);

    assert.equal(after.state, 'closed');
    assert.equal(after.outcome, 'cancelled');
    assert.deepEqual(after.entries, [w.looked]);
  } finally {
    w.dispose();
  }
});

test('a run that stops to ask has a suspended record, and the same record closes when it resumes', async () => {
  const w = world({
    asks: reading('asks', (context) => {
      const decision = context.approvals.request({
        key: 'go',
        kind: 'confirm',
        question: 'Proceed?',
        payload: {}
      });
      return { went: decision.status };
    })
  });

  try {
    const runId = await w.start('asks');
    assert.equal(data<{ suspended: boolean }>(await w.dispatch('run.await', { runId })).suspended, true);

    const parked = await w.record(runId);

    assert.equal(parked.state, 'suspended');
    assert.equal(parked.outcome, undefined, 'a parked run has not ended');
    assert.deepEqual(parked.entries, [w.looked]);

    const [waiting] = data<{ id: string }[]>(await w.dispatch('approvals.pending', { runId }));
    data(await w.dispatch('approvals.decide', { approvalId: waiting!.id, status: 'granted' }));
    data(await w.dispatch('run.resume', { runId }));
    data(await w.dispatch('run.await', { runId }));

    const resumed = await w.record(runId);

    assert.equal(resumed.state, 'closed');
    assert.equal(resumed.outcome, 'succeeded');
    assert.equal(resumed.openedAt, parked.openedAt, 'the record was reopened, not started over');
    assert.deepEqual(resumed.entries, [w.looked], 'the run read the CV again and the record says it once');
  } finally {
    w.dispose();
  }
});

test('a run with no conversation has no record, and that is not what a run that does not exist gets', async () => {
  const w = world({ reads: reading('reads') });

  try {
    const runId = await w.start('reads', { conversationId: undefined });
    data(await w.dispatch('run.await', { runId }));

    const bare = refused(await w.dispatch('runs.grounding', { runId }));
    const unknown = refused(await w.dispatch('runs.grounding', { runId: 'nope' }));

    assert.equal(bare.code, 'not_found');
    assert.equal(unknown.code, 'not_found');
    assert.match(bare.message, /has no record/);
    assert.match(unknown.message, /No such run/);
    assert.ok(!bare.message.includes('No such run'), 'a run that exists was called a run that does not');
    assert.ok(!unknown.message.includes('has no record'), 'a run that does not exist was called a run with no record');
  } finally {
    w.dispose();
  }
});

test('the whole answer, not only the record in it, is plain data a transport can carry', async () => {
  const w = world({ reads: reading('reads') });

  try {
    const runId = await w.start('reads');
    data(await w.dispatch('run.await', { runId }));

    const response = await w.dispatch('runs.grounding', { runId });

    assert.deepEqual(JSON.parse(JSON.stringify(response)), response);
    assert.deepEqual(structuredClone(response), response);
  } finally {
    w.dispose();
  }
});

test('a host can read a record and cannot write one, and reads what the channel serves', async () => {
  const w = world({ reads: reading('reads') });

  try {
    assert.deepEqual(Object.keys(w.harness.groundingRecords), ['read']);
    assert.equal(w.harness.groundingRecords.read('nope'), undefined);

    const runId = await w.start('reads');
    data(await w.dispatch('run.await', { runId }));

    assert.deepEqual(w.harness.groundingRecords.read(runId), await w.record(runId));
  } finally {
    w.dispose();
  }
});
