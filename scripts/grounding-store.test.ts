/**
 * The record of a run, as the file keeps it.
 *
 * A record is opened by the transaction that creates a chat run and settled by
 * the transaction that writes each status, so these tests drive the real run
 * store, the real checkpointer and the real recovery over a real file, and read
 * the record back through the store. What they pin is that no way for a run to
 * end can leave its record unsettled: success, failure, cancellation, a pause
 * for an approval and the run that continues from it, and a crash. A crash is
 * the one that cannot run any code of its own, so the record it leaves says
 * "open" until the next start finds the run, and then says "interrupted" and not
 * "failed", because a run whose process died knows only what was written before.
 *
 * Two of the tests drop the tables and write anyway. They are there for the
 * claim that the status and the record land together or neither does, which
 * nothing else can show: a hook that ran after the transaction would look the
 * same as one inside it until the day the second write fails.
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 61 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * what each status means for a record:
 *   running settles as suspended                   10
 *   suspended settles as open                      4
 *   success settles as failed                      3
 *   cancellation settles as failed                 3
 *   a crash settles as an ordinary failure         3
 *   an ordinary failure settles as interrupted     5
 *   any failure settles as interrupted             3
 *   interrupted settles with an outcome            5
 *   interrupted is not an ending                   1
 *   closing time never written                     2
 *   closing time is the start                      2
 *   a status with no value still settles           1
 *   an ended record can be settled again           1
 *   a parked record cannot continue                3
 *   an interrupted record can be settled again     1
 *   recovery writes another code                   2
 *
 * opening, and doing it in the run's own transactions:
 *   every run gets a record                        2
 *   no run gets a record                           15
 *   the record is opened outside the creating transaction 1
 *   the record is settled outside the checkpoint transaction 1
 *   no status change settles the record            10
 *   the record opens at the wrong time             4
 *   a record opens at the wrong time               4
 *   a record opens with the wrong version          4
 *
 * what may be added to a record:
 *   any record takes entries                       2
 *   a parked record takes entries                  2
 *   an ended record takes entries                  1
 *   a repeated entry is an error                   3
 *   entries are counted as given                   5
 *   entries come back in index order               3
 *   entries come back newest first                 3
 *   an entry is written with another run's id      7
 *   an entry's origin is written as server         2
 *   an entry's status is written as included       3
 *   an entry's channel is dropped                  5
 *   shown is written as absent                     3
 *   version is written as absent                   3
 *
 * what is read back:
 *   a record is read without its entries           7
 *   an absent version is read as null              4
 *   an absent shown is dropped                     2
 *   version is dropped on read                     2
 *   the closing time is dropped on read            2
 *   the outcome is dropped on read                 4
 *   the conversation is read wrong                 4
 *
 * the tables:
 *   equal entries with no version are two          3
 *   equal entries with no shown digest are two     3
 *   the index ignores the channel                  1
 *   the index ignores the origin                   1
 *   the index ignores the status                   1
 *   the index ignores the digest                   2
 *   the index ignores the address                  2
 *   the index is not per run                       1
 *   the index is not unique                        3
 *   a closed record may have no outcome            1
 *   any state is accepted                          1
 *   interrupted is not a state                     4
 *   any outcome is accepted                        1
 *   an entry's status is constrained               1
 *   a record outlives its run                      1
 *   entries outlive their record                   1
 *   a record has no link to its run                1
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PROCESS_INTERRUPTED, RECORD_VERSION } from '../src/contracts/index.js';
import type { NewRun, RecordEntry, RunPatch, StepRef } from '../src/contracts/index.js';
import { digest } from '../src/grounding/index.js';
import { createCheckpointer } from '../src/runs/checkpoint.js';
import { recoverInterruptedRuns } from '../src/runtime/recover.js';
import { createRecordStore, settlementOf } from '../src/storage/sqlite/grounding-record.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { open } from '../src/storage/sqlite/open.js';
import { createRunStore } from '../src/storage/sqlite/run-store.js';
import { scratch } from './support/db.js';

/* ---------------------------------------------------------------- fixtures */

const CREATED = 1_000;
const ENDED = 2_000;

/** One CV context with one conversation in it, which is what a chat run needs to exist. */
const world = () => {
  const s = scratch();
  s.db.prepare("INSERT INTO cv_contexts (id, language, created_at, updated_at) VALUES ('ctx', 'en', 1, 1)").run();
  s.db.prepare(
    "INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES ('chat', 'profile', 'ctx', 1, 1)"
  ).run();
  return { s, runs: createRunStore(s.db), records: createRecordStore(s.db) };
};

type World = ReturnType<typeof world>;

const begin = (w: World, id: string, over: Partial<NewRun> = {}): string => {
  w.runs.create(
    {
      id,
      capability: 'noop',
      input: {},
      traceId: id,
      createdAt: CREATED,
      contextId: 'ctx',
      contextGeneration: 0,
      contextRevision: 0,
      conversationId: 'chat',
      ...over
    },
    [{ at: CREATED, type: 'run.queued', data: {} }]
  );
  return id;
};

const checkpointer = (w: World, id: string) => createCheckpointer(w.runs, id, () => ENDED);

const STEP: StepRef = { name: 'answer', kind: 'tool_loop', ordinal: 0, critical: true };

const entry = (over: Partial<RecordEntry> = {}): RecordEntry => ({
  ref: 'tickets:support/open/t-1042',
  digest: digest('original'),
  status: 'included',
  origin: 'server',
  via: 'tool:read',
  ...over
});

/** A run that is started, so it is `running` and its record is open. */
const running = (w: World, id: string) => {
  begin(w, id);
  const checkpoint = checkpointer(w, id);
  checkpoint.started({ providerId: 'p', modelId: 'm' });
  return checkpoint;
};

/* -------------------------------------------------------------- opening */

test('a run in a conversation is given an open record by the transaction that creates it', () => {
  const w = world();
  try {
    begin(w, 'r1');
    assert.deepEqual(w.records.read('r1'), {
      v: RECORD_VERSION,
      runId: 'r1',
      conversationId: 'chat',
      state: 'open',
      openedAt: CREATED,
      entries: []
    });
  } finally {
    w.s.dispose();
  }
});

test('a run in no conversation has no record, and a creation that fails leaves none', () => {
  const w = world();
  try {
    begin(w, 'bare', { conversationId: undefined });
    assert.equal(w.records.read('bare'), undefined);

    // Refused after the checks, before the insert: the context is not the
    // conversation's, so nothing about the run may survive, record included.
    assert.throws(() => begin(w, 'refused', { contextId: 'elsewhere' }), { code: 'context_conflict' });
    assert.equal(w.records.read('refused'), undefined);
    assert.equal(w.runs.get('refused'), undefined);
    assert.equal((w.s.db.prepare('SELECT count(*) AS n FROM grounding_record').get() as { n: number }).n, 0);
  } finally {
    w.s.dispose();
  }
});

/* ------------------------------------------------------------- settling */

type Ending = {
  readonly name: string;
  readonly end: (checkpoint: ReturnType<typeof checkpointer>) => void;
  readonly settled: { state: 'closed'; outcome: 'succeeded' | 'failed' | 'cancelled' };
};

const endings: readonly Ending[] = [
  { name: 'success', end: (c) => c.succeeded({ answer: 'ok' }, [], 5), settled: { state: 'closed', outcome: 'succeeded' } },
  { name: 'failure', end: (c) => c.failed({ code: 'step_failed', message: 'boom' }), settled: { state: 'closed', outcome: 'failed' } },
  { name: 'cancellation', end: (c) => c.cancelled(), settled: { state: 'closed', outcome: 'cancelled' } }
];

test('every way a run ends settles its record with the time the run ended', () => {
  for (const ending of endings) {
    const w = world();
    try {
      const checkpoint = running(w, 'r1');
      assert.equal(w.records.read('r1')?.state, 'open', `${ending.name}: open while running`);

      ending.end(checkpoint);

      assert.deepEqual(
        w.records.read('r1'),
        {
          v: RECORD_VERSION,
          runId: 'r1',
          conversationId: 'chat',
          ...ending.settled,
          openedAt: CREATED,
          closedAt: ENDED,
          entries: []
        },
        ending.name
      );
      assert.equal(w.runs.get('r1')?.endedAt, ENDED, `${ending.name}: the run says the same`);
    } finally {
      w.s.dispose();
    }
  }
});

test('a run waiting for an approval has a suspended record, and the record is open again when it continues', () => {
  const w = world();
  try {
    const checkpoint = running(w, 'r1');

    checkpoint.suspended(STEP, 'approval-1');
    assert.deepEqual(w.records.read('r1'), {
      v: RECORD_VERSION,
      runId: 'r1',
      conversationId: 'chat',
      state: 'suspended',
      openedAt: CREATED,
      entries: []
    });

    // A write that does not change the status does not change the record.
    w.runs.checkpoint({ runId: 'r1', run: { modelId: 'other' } }, []);
    assert.equal(w.records.read('r1')?.state, 'suspended');

    checkpoint.resumed('approval-1');
    assert.equal(w.records.read('r1')?.state, 'open');
    assert.equal(w.records.read('r1')?.closedAt, undefined);

    checkpoint.succeeded({ answer: 'ok' }, [], 5);
    assert.equal(w.records.read('r1')?.outcome, 'succeeded');
  } finally {
    w.s.dispose();
  }
});

test('a suspended run that is abandoned closes its record as cancelled', () => {
  const w = world();
  try {
    const checkpoint = running(w, 'r1');
    checkpoint.suspended(STEP, 'approval-1');
    checkpoint.cancelled();
    assert.equal(w.records.read('r1')?.state, 'closed');
    assert.equal(w.records.read('r1')?.outcome, 'cancelled');
  } finally {
    w.s.dispose();
  }
});

test('a crash leaves the record open, and recovery settles it as interrupted rather than failed', () => {
  const w = world();
  try {
    running(w, 'lost');
    w.records.append('lost', [entry()]);

    // The process died here. Nothing has settled anything, and the record says
    // exactly that: it is open, with what was written before the end.
    assert.equal(w.records.read('lost')?.state, 'open');

    recoverInterruptedRuns(w.runs, () => 1_250);

    // The code is stored with the run and read back by anything that wants to
    // tell a crash from a failure, so the literal is part of the format.
    assert.equal(w.runs.get('lost')?.errorCode, 'process_interrupted');
    assert.equal(PROCESS_INTERRUPTED, 'process_interrupted');
    assert.deepEqual(w.records.read('lost'), {
      v: RECORD_VERSION,
      runId: 'lost',
      conversationId: 'chat',
      state: 'interrupted',
      openedAt: CREATED,
      closedAt: 1_250,
      entries: [entry()]
    });
  } finally {
    w.s.dispose();
  }
});

test('a run that never started when the process died is interrupted too', () => {
  const w = world();
  try {
    begin(w, 'queued');
    recoverInterruptedRuns(w.runs, () => 1_250);
    assert.equal(w.records.read('queued')?.state, 'interrupted');
  } finally {
    w.s.dispose();
  }
});

test('a run that failed is a failure unless the process was the reason', () => {
  const w = world();
  try {
    const checkpoint = running(w, 'r1');
    // The wording is the one recovery uses; only the code decides.
    checkpoint.failed({ code: 'step_failed', message: 'The process ended while this run was active.' });
    assert.equal(w.records.read('r1')?.state, 'closed');
    assert.equal(w.records.read('r1')?.outcome, 'failed');
  } finally {
    w.s.dispose();
  }
});

test('what each status means for a record is one table', () => {
  const rows: ReadonlyArray<[Parameters<typeof settlementOf>[0], string | undefined, string, string | null]> = [
    ['queued', undefined, 'open', null],
    ['running', undefined, 'open', null],
    ['suspended', undefined, 'suspended', null],
    ['succeeded', undefined, 'closed', 'succeeded'],
    ['cancelled', undefined, 'closed', 'cancelled'],
    ['failed', undefined, 'closed', 'failed'],
    ['failed', 'step_failed', 'closed', 'failed'],
    ['failed', PROCESS_INTERRUPTED, 'interrupted', null]
  ];
  for (const [status, code, state, outcome] of rows) {
    const got = settlementOf(status, code);
    assert.deepEqual([got.state, got.outcome], [state, outcome], `${status} ${code ?? ''}`);
  }

  // The same code on a run that did not fail is not an interruption.
  assert.equal(settlementOf('succeeded', PROCESS_INTERRUPTED).state, 'closed');
});

test('a record that has ended never changes, whatever status is written after it', () => {
  const stray: readonly RunPatch['run'][] = [
    { status: 'running' },
    { status: 'suspended' },
    { status: 'failed', errorCode: 'late', endedAt: 9_999 },
    { status: 'cancelled', endedAt: 9_999 },
    { status: 'succeeded', endedAt: 9_999 }
  ];
  const finals: ReadonlyArray<[string, (w: World) => void]> = [
    ['success', (w) => checkpointer(w, 'r1').succeeded({}, [], 1)],
    ['failure', (w) => checkpointer(w, 'r1').failed({ code: 'step_failed', message: 'x' })],
    ['cancellation', (w) => checkpointer(w, 'r1').cancelled()],
    ['interruption', (w) => recoverInterruptedRuns(w.runs, () => 1_250)]
  ];

  for (const [name, finish] of finals) {
    const w = world();
    try {
      running(w, 'r1');
      w.records.append('r1', [entry()]);
      finish(w);
      const before = w.records.read('r1');
      assert.ok(before && before.state !== 'open' && before.state !== 'suspended', name);

      // Written straight to the store, past the transition table that would
      // refuse it: the record must hold on its own account.
      for (const fields of stray) w.runs.checkpoint({ runId: 'r1', run: fields }, []);

      assert.deepEqual(w.records.read('r1'), before, name);
    } finally {
      w.s.dispose();
    }
  }
});

test('a run and its record are made together, or neither is', () => {
  const w = world();
  try {
    // A record that cannot be opened takes the run with it. Without that, a chat
    // run could exist, and answer, with nothing saying what it was given.
    w.s.db.exec('DROP TABLE grounding_entry; DROP TABLE grounding_record;');

    assert.throws(() => begin(w, 'r1'), /grounding_record/);
    assert.equal(w.runs.get('r1'), undefined);
  } finally {
    w.s.dispose();
  }
});

test('the status and the record settle together, or neither does', () => {
  const w = world();
  try {
    const checkpoint = running(w, 'r1');

    // A record table that cannot be written makes the status write fail, and the
    // status stays where it was. Without that, a run could read "succeeded"
    // beside a record that says it is still open.
    w.s.db.exec('DROP TABLE grounding_entry; DROP TABLE grounding_record;');

    assert.throws(() => checkpoint.succeeded({ answer: 'ok' }, [], 5), /grounding_record/);
    assert.equal(w.runs.get('r1')?.status, 'running');
    assert.equal(w.runs.get('r1')?.endedAt, undefined);
  } finally {
    w.s.dispose();
  }
});

/* -------------------------------------------------------------- entries */

test('entries are kept in the order they were recorded, once each, however often they are offered', () => {
  const w = world();
  try {
    running(w, 'r1');

    // Not in alphabetical order, so a read that sorted would show it.
    const late = entry({ ref: 'tickets:support/open/t-9000' });
    const early = entry({ ref: 'kb:main/faq/refunds', version: '3' });
    const clipped = entry({ ref: 'kb:main/faq/refunds', version: '3', shown: digest('clipped') });
    const edited = entry({ ref: 'tickets:support/open/t-9000', digest: digest('edited') });

    assert.equal(w.records.append('r1', [late, early]), 2);
    assert.equal(w.records.append('r1', [early, clipped, late, edited]), 2, 'equal entries are not added again');
    assert.equal(w.records.append('r1', [late, late, early]), 0, 'nor are repeats within one call');

    assert.deepEqual(w.records.read('r1')?.entries, [late, early, clipped, edited]);
  } finally {
    w.s.dispose();
  }
});

test('entries that differ in any one field are different entries', () => {
  const w = world();
  try {
    running(w, 'r1');
    const base = entry({ version: '3' });
    const variants: RecordEntry[] = [
      { ...base, ref: 'tickets:support/open/t-1043' },
      { ...base, version: '4' },
      { ...base, digest: digest('other') },
      { ...base, shown: digest('clipped') },
      { ...base, status: 'read' },
      { ...base, origin: 'client' },
      { ...base, via: 'port:documents' }
    ];

    assert.equal(w.records.append('r1', [base]), 1);
    for (const variant of variants) assert.equal(w.records.append('r1', [variant]), 1, JSON.stringify(variant));
    assert.equal(w.records.read('r1')?.entries.length, 1 + variants.length);

    // And an entry with no version, offered twice, is one entry: two NULLs are
    // never equal to a unique index, so the file has to be told they are.
    const bare = entry({ ref: 'tickets:support/open/t-7' });
    assert.equal(w.records.append('r1', [bare, bare]), 1);
    assert.equal(w.records.append('r1', [bare]), 0);
  } finally {
    w.s.dispose();
  }
});

test('what is stored comes back exactly as given, absent fields staying absent', () => {
  const w = world();
  try {
    running(w, 'r1');
    const entries: RecordEntry[] = [
      entry(),
      entry({ ref: 'kb:main/faq/refunds', version: '3', shown: digest('clipped'), status: 'read', origin: 'client', via: 'input' })
    ];
    w.records.append('r1', entries);
    assert.deepEqual(w.records.read('r1')?.entries, entries);
    assert.ok(!('version' in (w.records.read('r1')?.entries[0] ?? {})));
    assert.ok(!('shown' in (w.records.read('r1')?.entries[0] ?? {})));
  } finally {
    w.s.dispose();
  }
});

test('only an open record takes entries; every other record, and a run with none, takes nothing and says nothing', () => {
  const w = world();
  try {
    // One record in each state that is not open.
    const paused = running(w, 'paused');
    paused.suspended(STEP, 'approval-1');

    const closed = ['succeeded', 'failed', 'cancelled'].map((outcome) => {
      const id = `closed-${outcome}`;
      const checkpoint = running(w, id);
      if (outcome === 'succeeded') checkpoint.succeeded({}, [], 1);
      else if (outcome === 'failed') checkpoint.failed({ code: 'step_failed', message: 'x' });
      else checkpoint.cancelled();
      return id;
    });

    running(w, 'dead');
    recoverInterruptedRuns(w.runs, () => 1_250);
    begin(w, 'bare', { conversationId: undefined });

    for (const id of ['paused', ...closed, 'dead', 'bare', 'no-such-run']) {
      const before = w.records.read(id);
      assert.equal(w.records.append(id, [entry()]), 0, id);
      assert.deepEqual(w.records.read(id), before, id);
    }
  } finally {
    w.s.dispose();
  }
});

test('an empty list adds nothing', () => {
  const w = world();
  try {
    running(w, 'r1');
    assert.equal(w.records.append('r1', []), 0);
  } finally {
    w.s.dispose();
  }
});

test('what was recorded before a pause is still there when the run continues, and it can add to it', () => {
  const w = world();
  try {
    const checkpoint = running(w, 'r1');
    const first = entry();
    const second = entry({ ref: 'kb:main/faq/refunds' });

    w.records.append('r1', [first]);
    checkpoint.suspended(STEP, 'approval-1');
    assert.equal(w.records.append('r1', [second]), 0, 'nothing is recorded while it waits');

    checkpoint.resumed('approval-1');
    assert.equal(w.records.append('r1', [first, second]), 1, 'the entry it had is not added again');
    assert.deepEqual(w.records.read('r1')?.entries, [first, second]);
  } finally {
    w.s.dispose();
  }
});

/* ----------------------------------------------------------------- file */

test('deleting a run deletes its record and what was recorded', () => {
  const w = world();
  try {
    running(w, 'r1');
    running(w, 'r2');
    w.records.append('r1', [entry()]);
    w.records.append('r2', [entry()]);

    w.s.db.prepare('DELETE FROM runs WHERE id = ?').run('r1');

    assert.equal(w.records.read('r1'), undefined);
    assert.equal((w.s.db.prepare("SELECT count(*) AS n FROM grounding_entry WHERE run_id = 'r1'").get() as { n: number }).n, 0);
    assert.equal(w.records.read('r2')?.entries.length, 1, 'another run keeps its own');
  } finally {
    w.s.dispose();
  }
});

test('the file refuses a record that contradicts itself, and accepts a status a later build adds', () => {
  const w = world();
  try {
    running(w, 'r1');
    const put = (state: string, outcome: string | null) =>
      w.s.db
        .prepare('UPDATE grounding_record SET state = ?, outcome = ? WHERE run_id = ?')
        .run(state, outcome, 'r1');

    assert.throws(() => put('closed', null), /CHECK/);
    assert.throws(() => put('open', 'failed'), /CHECK/);
    assert.throws(() => put('interrupted', 'failed'), /CHECK/);
    assert.throws(() => put('finished', null), /CHECK/);
    assert.throws(() => put('closed', 'abandoned'), /CHECK/);

    // No constraint on the entry's status: a reader treats one it does not know
    // as not reaching the model, and a refused write would hide it instead.
    assert.equal(w.records.append('r1', [entry({ status: 'compact' as never })]), 1);
    assert.equal(w.records.read('r1')?.entries[0]?.status, 'compact');
  } finally {
    w.s.dispose();
  }
});

test('the migration adds the tables and leaves a run from before it with no record', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((step) => step.version <= 39));
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'grounding_%'").get(), undefined);
    db.prepare(
      "INSERT INTO runs (id, capability, status, input, trace_id, created_at) VALUES ('old', 'noop', 'succeeded', '{}', 't', 1)"
    ).run();

    // Up to this migration and no further: later ones add tables of their own.
    migrate(db, migrations.filter((step) => step.version <= 40));

    assert.deepEqual(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'grounding_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name),
      ['grounding_entry', 'grounding_record']
    );
    assert.equal((db.prepare('SELECT count(*) AS n FROM runs').get() as { n: number }).n, 1);
    // The store is written for the file as it is now, so it is read at the latest version.
    migrate(db);
    assert.equal(createRecordStore(db).read('old'), undefined);
  } finally {
    db.close();
  }
});
