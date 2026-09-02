import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../src/storage/sqlite/open.js';
import { latestVersion, migrate, migrations } from '../src/storage/sqlite/migrate.js';

const fresh = (): { path: string; dispose: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-mig-'));
  return {
    path: join(dir, 'harness.db'),
    dispose: () => rmSync(dir, { recursive: true, force: true })
  };
};

test('a fresh file reaches the latest version', () => {
  const { path, dispose } = fresh();
  const db = open(path);

  try {
    assert.equal(db.pragma('user_version', { simple: true }), 0);
    assert.equal(migrate(db), latestVersion);
    assert.equal(db.pragma('user_version', { simple: true }), latestVersion);

    // The schema is really there, not just the version number.
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    for (const expected of [
      'runs', 'run_steps', 'events', 'effect_attempts',
      'approvals', 'documents', 'chunks', 'offers', 'ai_calls'
    ]) {
      assert.ok(names.includes(expected), `missing table ${expected}`);
    }
  } finally {
    db.close();
    dispose();
  }
});

/**
 * 0002 rebuilds `run_steps` to widen a `CHECK`, which in SQLite means copying
 * every row into a new table and dropping the old one. Two things can go wrong
 * with that and neither shows up as an error: rows can be lost, and the repair
 * the migration exists to perform can miss.
 *
 * So this applies 0001, writes the exact shape the bug produced — a terminal
 * run with a step still marked `running` — and then applies 0002 over it.
 */
test('the rebuild keeps every step and repairs the ones left running', () => {
  const { path, dispose } = fresh();
  const db = open(path);

  try {
    migrate(db, migrations.filter((m) => m.version <= 1));

    db.prepare(
      `INSERT INTO runs (id, capability, status, input, trace_id, created_at, ended_at)
       VALUES (?, 'probe', ?, '{}', 't', 1, 9)`
    ).run('terminal', 'cancelled');
    db.prepare(
      `INSERT INTO runs (id, capability, status, input, trace_id, created_at)
       VALUES (?, 'probe', 'running', '{}', 't', 1)`
    ).run('live');

    const step = db.prepare(
      `INSERT INTO run_steps (run_id, name, kind, critical, status, ordinal, started_at)
       VALUES (?, ?, 'transform', 1, ?, ?, 2)`
    );
    step.run('terminal', 'done', 'ok', 0);
    step.run('terminal', 'interrupted', 'running', 1);
    step.run('terminal', 'never-ran', 'skipped', 2);
    // Declared and never reached: its stage never got a turn.
    step.run('terminal', 'unreached', 'pending', 3);
    // The same shape under a run still in flight, which is a live step, not a
    // stale row — `RunStore.interrupted()` finds those, and 0002 must not.
    step.run('live', 'in-flight', 'running', 0);

    assert.equal(migrate(db), latestVersion);

    const rows = db
      .prepare('SELECT run_id, name, status, ended_at FROM run_steps ORDER BY run_id, ordinal')
      .all() as { run_id: string; name: string; status: string; ended_at: number | null }[];

    assert.equal(rows.length, 5, 'the rebuild lost a row');
    assert.deepEqual(
      rows.map((row) => [row.name, row.status]),
      [
        ['in-flight', 'running'],
        ['done', 'ok'],
        ['interrupted', 'stopped'],
        ['never-ran', 'skipped'],
        ['unreached', 'skipped']
      ]
    );

    // Borrowed from the run, which is the only honest timestamp available: the
    // step stopped no later than the run it belonged to.
    assert.equal(rows.find((row) => row.name === 'interrupted')?.ended_at, 9);

    // The widened constraint is really on the new table, not merely absent.
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO run_steps (run_id, name, kind, critical, status, ordinal)
             VALUES ('terminal', 'bogus', 'transform', 1, 'invented', 9)`
          )
          .run(),
      /CHECK constraint failed/
    );

    // And the index survived the rename, which is easy to drop by accident.
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'run_steps'`)
      .all() as { name: string }[];
    assert.ok(indexes.some((row) => row.name === 'run_steps_run_ordinal'));
  } finally {
    db.close();
    dispose();
  }
});

test('re-running is a no-op', () => {
  const { path, dispose } = fresh();
  const db = open(path);

  try {
    migrate(db);
    const before = db.prepare('SELECT count(*) AS n FROM sqlite_master').get() as {
      n: number;
    };

    assert.equal(migrate(db), latestVersion);
    assert.equal(migrate(db), latestVersion);

    const after = db.prepare('SELECT count(*) AS n FROM sqlite_master').get() as {
      n: number;
    };
    assert.equal(after.n, before.n);
  } finally {
    db.close();
    dispose();
  }
});

test('a failing migration rolls back and leaves the version untouched', () => {
  const { path, dispose } = fresh();
  const db = open(path);

  try {
    const broken = [
      ...migrations,
      {
        // One past the real head, so this stays a test about rollback rather
        // than turning into a version collision the next time one lands.
        version: latestVersion + 1,
        // The first statement succeeds and the second does not. If the
        // transaction were not per-migration, the table would survive.
        sql: `CREATE TABLE half_applied (id TEXT); SELECT nonexistent_function();`
      }
    ];

    assert.throws(() => migrate(db, broken));

    assert.equal(db.pragma('user_version', { simple: true }), latestVersion);
    const leftovers = db
      .prepare(`SELECT name FROM sqlite_master WHERE name = 'half_applied'`)
      .all();
    assert.deepEqual(leftovers, []);
  } finally {
    db.close();
    dispose();
  }
});
