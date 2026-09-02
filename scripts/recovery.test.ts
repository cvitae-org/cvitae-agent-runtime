import assert from 'node:assert/strict';
import test from 'node:test';

import * as packageSurface from '../src/index.js';
import { createEventLog } from '../src/storage/sqlite/event-log.js';
import { createRunStore } from '../src/storage/sqlite/run-store.js';
import { recoverInterruptedRuns } from '../src/runtime/recover.js';
import { scratch } from './support/db.js';

test('the package root exposes the runtime and IPC surface', () => {
  assert.equal(typeof packageSurface.createHarness, 'function');
  assert.equal(typeof packageSurface.createDispatch, 'function');
  assert.ok(packageSurface.channels.includes('run.start'));
});

test('startup recovery settles an interrupted run and never replays it', () => {
  const s = scratch();
  const runs = createRunStore(s.db);
  const events = createEventLog(s.db);
  const began = 1_000;

  try {
    runs.create(
      { id: 'lost', capability: 'noop', input: {}, traceId: 'lost', createdAt: began },
      [{ at: began, type: 'run.queued', data: {} }]
    );
    runs.checkpoint(
      {
        runId: 'lost',
        run: { status: 'running', startedAt: began },
        declare: [
          { name: 'active', kind: 'transform', critical: true, ordinal: 0 },
          { name: 'waiting', kind: 'transform', critical: true, ordinal: 1 },
          { name: 'done', kind: 'transform', critical: true, ordinal: 2 }
        ],
        steps: [
          { name: 'active', status: 'running', startedAt: began },
          { name: 'done', status: 'ok', value: { kept: true }, endedAt: began }
        ]
      },
      [{ at: began, type: 'run.started', data: {} }]
    );

    const recovered = recoverInterruptedRuns(runs, () => 1_250);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.status, 'failed');
    assert.equal(recovered[0]?.errorCode, 'process_interrupted');
    assert.deepEqual(
      runs.steps('lost').map((step) => [step.name, step.status, step.value]),
      [
        ['active', 'stopped', undefined],
        ['waiting', 'skipped', undefined],
        ['done', 'ok', { kept: true }]
      ]
    );
    assert.deepEqual(
      events.since('lost', 0).slice(-3).map((event) => event.type),
      ['step.stopped', 'step.skipped', 'run.failed']
    );
    assert.deepEqual(recoverInterruptedRuns(runs, () => 1_500), []);
  } finally {
    s.dispose();
  }
});
