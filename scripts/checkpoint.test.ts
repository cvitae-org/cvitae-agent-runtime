/**
 * The one transaction, tested from the outside.
 *
 * The claim is that a state change and the events announcing it either both
 * land or neither does. Both halves are checked: the happy one because it is
 * the contract, and the failing one because that is the half a convention would
 * have got wrong.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRunStore } from '../src/storage/sqlite/run-store.js';
import { createEventLog } from '../src/storage/sqlite/event-log.js';
import { scratch } from './support/db.js';

const now = () => Date.now();

test('a step patch and its event land together', () => {
  const s = scratch();
  const runs = createRunStore(s.db);
  const events = createEventLog(s.db);

  try {
    const run = runs.create(
      {
        id: 'r1',
        capability: 'noop',
        input: { a: 1 },
        traceId: 't1',
        createdAt: now()
      },
      [{ at: now(), type: 'run.queued', data: {} }]
    );

    assert.equal(run.status, 'queued');
    assert.equal(events.latest('r1'), 1);

    runs.checkpoint(
      {
        runId: 'r1',
        run: { status: 'running', startedAt: now() },
        declare: [{ name: 'facts', kind: 'extract', ordinal: 0, critical: true }]
      },
      [
        { at: now(), type: 'run.started', data: {} },
        { at: now(), type: 'run.planned', data: { steps: 1 } }
      ]
    );

    runs.checkpoint(
      {
        runId: 'r1',
        steps: [{ name: 'facts', status: 'ok', value: { company: 'Acme' }, endedAt: now() }]
      },
      [{ at: now(), type: 'step.succeeded', step: 'facts', data: {} }]
    );

    const steps = runs.steps('r1');
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.status, 'ok');
    assert.deepEqual(steps[0]?.value, { company: 'Acme' });

    const log = events.since('r1', 0);
    assert.deepEqual(
      log.map((e) => e.type),
      ['run.queued', 'run.started', 'run.planned', 'step.succeeded']
    );
    assert.deepEqual(
      log.map((e) => e.seq),
      [1, 2, 3, 4]
    );
  } finally {
    s.dispose();
  }
});

test('a throw between the state change and the events leaves neither', () => {
  const s = scratch();
  const runs = createRunStore(s.db);
  const events = createEventLog(s.db);

  try {
    runs.create(
      { id: 'r2', capability: 'noop', input: {}, traceId: 't2', createdAt: now() },
      [{ at: now(), type: 'run.queued', data: {} }]
    );

    runs.checkpoint(
      {
        runId: 'r2',
        declare: [{ name: 'facts', kind: 'extract', ordinal: 0, critical: true }]
      },
      []
    );

    const seqBefore = events.latest('r2');
    assert.equal(runs.steps('r2')[0]?.status, 'pending');

    // The step update runs first inside the transaction, then serialising this
    // event's data throws. If the two were separate writes, the step would be
    // 'ok' with nothing announcing it — a run that looks finished to a query
    // and unfinished to anyone tailing it.
    assert.throws(() =>
      runs.checkpoint(
        {
          runId: 'r2',
          run: { status: 'succeeded' },
          steps: [{ name: 'facts', status: 'ok', endedAt: now() }]
        },
        [{ at: now(), type: 'step.succeeded', step: 'facts', data: { bad: 1n } }]
      )
    );

    assert.equal(runs.steps('r2')[0]?.status, 'pending');
    assert.equal(runs.get('r2')?.status, 'queued');
    assert.equal(events.latest('r2'), seqBefore);
  } finally {
    s.dispose();
  }
});

test('a run records its result, degraded list and error together', () => {
  const s = scratch();
  const runs = createRunStore(s.db);

  try {
    runs.create(
      { id: 'r3', capability: 'noop', input: {}, traceId: 't3', createdAt: now() },
      []
    );

    runs.checkpoint(
      {
        runId: 'r3',
        run: {
          status: 'succeeded',
          result: { company: 'Acme' },
          degraded: ['salary', 'culture'],
          endedAt: now()
        }
      },
      [{ at: now(), type: 'run.succeeded', data: {} }]
    );

    const run = runs.get('r3');
    assert.equal(run?.status, 'succeeded');
    assert.deepEqual(run?.result, { company: 'Acme' });
    assert.deepEqual(run?.degraded, ['salary', 'culture']);
  } finally {
    s.dispose();
  }
});
