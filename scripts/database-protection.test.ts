/**
 * What the runtime does to protect the file that holds someone's CV, offers and
 * conversations: refuse a database from a newer build, set the file aside before
 * an upgrade changes it, keep it private, and tell the parent, in a way it can
 * act on, when it has refused to start.
 *
 * Every test is about a way this could lose or expose data without an error, so
 * each one checks the file rather than the return value.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OperationError } from '../src/contracts/operation-error.js';
import { STARTUP_REFUSALS, startupRefusal } from '../src/adapters/stdio/refusals.js';
import { BACKUPS_KEPT, backupsOf } from '../src/storage/sqlite/backup.js';
import { open } from '../src/storage/sqlite/open.js';
import { latestVersion, migrate, migrations } from '../src/storage/sqlite/migrate.js';

const posix = process.platform !== 'win32';

const directory = (): { dir: string; dispose: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-protect-'));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

const at = (version: number) => migrations.filter((step) => step.version <= version);

const mode = (path: string): number => statSync(path).mode & 0o777;

const version = (db: { pragma: (source: string, options: { simple: true }) => unknown }): unknown =>
  db.pragma('user_version', { simple: true });

const backupsBeside = (path: string): string[] =>
  readdirSync(join(path, '..')).filter((name) => name.includes('.bak-')).sort();

/* ---------------------------------------------------- a database from the future */

test('a database from a newer build is refused, and nothing in it is touched', () => {
  const { dir, dispose } = directory();
  const path = join(dir, 'runtime.db');

  try {
    const db = open(path);
    migrate(db);
    db.exec(`CREATE TABLE later (note TEXT); INSERT INTO later VALUES ('written by the next build')`);
    db.pragma(`user_version = ${latestVersion + 4}`);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    const before = readFileSync(path);

    const again = open(path);
    try {
      assert.throws(
        () => migrate(again),
        (error: unknown) => error instanceof OperationError && error.code === 'db_newer_than_app'
      );
      assert.equal(version(again), latestVersion + 4, 'the version is not lowered');
      assert.deepEqual(
        again.prepare('SELECT note FROM later').all(),
        [{ note: 'written by the next build' }]
      );
    } finally {
      again.close();
    }

    assert.deepEqual(readFileSync(path), before, 'the file is byte for byte what it was');
    assert.deepEqual(backupsBeside(path), [], 'and a refusal does not leave a backup behind');
  } finally {
    dispose();
  }
});

test('the message says which schema it found and which it understands', () => {
  const { dir, dispose } = directory();
  const db = open(join(dir, 'runtime.db'));

  try {
    migrate(db);
    db.pragma(`user_version = ${latestVersion + 1}`);

    assert.throws(
      () => migrate(db),
      (error: unknown) =>
        error instanceof OperationError
        && error.message.includes(String(latestVersion + 1))
        && error.message.includes(String(latestVersion))
    );
  } finally {
    db.close();
    dispose();
  }
});

/* ----------------------------------------------------------- a backup first */

test('an upgrade sets the file aside first, including what is still in the write-ahead log', () => {
  const { dir, dispose } = directory();
  const path = join(dir, 'runtime.db');
  const db = open(path);

  try {
    migrate(db, at(1));
    db.exec(`CREATE TABLE marker (note TEXT); INSERT INTO marker VALUES ('written before the upgrade')`);
    assert.ok(statSync(`${path}-wal`).size > 0, 'the row is only in the log, not yet in the main file');

    assert.equal(migrate(db), latestVersion);

    const backup = `${path}.bak-1`;
    assert.ok(existsSync(backup), 'the backup is named for the schema it holds');
    assert.deepEqual(backupsBeside(path), ['runtime.db.bak-1'], 'and no partial file is left');
    if (posix) assert.equal(mode(backup), 0o600, 'and is as private as the database');

    const copy = new Database(backup, { readonly: true });
    try {
      assert.equal(version(copy), 1, 'it is the file as it was, not as it became');
      assert.deepEqual(
        copy.prepare('SELECT note FROM marker').all(),
        [{ note: 'written before the upgrade' }]
      );
    } finally {
      copy.close();
    }

    assert.equal(version(db), latestVersion, 'while the live file did upgrade');
  } finally {
    db.close();
    dispose();
  }
});

test('a new file, and a file that is already current, are not backed up', () => {
  const { dir, dispose } = directory();
  const path = join(dir, 'runtime.db');
  const db = open(path);

  try {
    migrate(db);
    migrate(db);
    assert.deepEqual(backupsBeside(path), []);
  } finally {
    db.close();
    dispose();
  }
});

test('an in-memory database has nothing to set aside and does not try', () => {
  const db = open(':memory:');

  try {
    migrate(db, at(1));
    assert.equal(migrate(db), latestVersion);
  } finally {
    db.close();
  }
});

test('when the backup cannot be made the upgrade does not start', () => {
  const { dir, dispose } = directory();
  const path = join(dir, 'runtime.db');
  const db = open(path);

  try {
    migrate(db, at(1));
    // A directory where the backup has to go: the rename cannot succeed, on
    // any platform and for any user, which a full disk cannot promise in a test.
    mkdirSync(join(`${path}.bak-1`, 'in-the-way'), { recursive: true });

    assert.throws(
      () => migrate(db),
      (error: unknown) => error instanceof OperationError && error.code === 'db_backup_failed'
    );
    assert.equal(version(db), 1, 'no migration ran');
    assert.deepEqual(backupsBeside(path), ['runtime.db.bak-1'], 'and no partial copy was left behind');
  } finally {
    db.close();
    dispose();
  }
});

test('only the newest backups are kept', () => {
  const { dir, dispose } = directory();
  const path = join(dir, 'runtime.db');
  const db = open(path);

  try {
    migrate(db, at(36));
    writeFileSync(`${path}.bak-33`, 'old');
    writeFileSync(`${path}.bak-35`, 'older');

    migrate(db);

    assert.deepEqual(
      backupsOf(path).map((backup) => backup.version),
      [36, 35].slice(0, BACKUPS_KEPT)
    );
  } finally {
    db.close();
    dispose();
  }
});

test('the backup just made is never the one that is dropped', () => {
  // A lower schema is backed up after higher ones exist, which is what
  // restoring an old backup and upgrading again produces. Ordering by schema
  // alone would delete the very backup this upgrade depends on.
  const { dir, dispose } = directory();
  const path = join(dir, 'runtime.db');
  const db = open(path);

  try {
    migrate(db, at(30));
    writeFileSync(`${path}.bak-40`, 'from a later build');
    writeFileSync(`${path}.bak-39`, 'from a later build too');

    migrate(db);

    const kept = backupsOf(path).map((backup) => backup.version);
    assert.ok(kept.includes(30), `the backup just made survives: ${kept.join(', ')}`);
    assert.equal(kept.length, BACKUPS_KEPT);
  } finally {
    db.close();
    dispose();
  }
});

/* ------------------------------------------------------------- kept private */

test('the database and the files beside it are readable by their owner only', { skip: !posix }, () => {
  const { dir, dispose } = directory();
  const created = join(dir, 'nested', 'deeper');
  const path = join(created, 'runtime.db');
  const db = open(path);

  try {
    migrate(db);
    db.exec(`CREATE TABLE touched (x); INSERT INTO touched VALUES (1)`);

    assert.equal(mode(join(dir, 'nested')), 0o700, 'a directory this process made is private');
    assert.equal(mode(created), 0o700);
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      assert.ok(existsSync(file), `${file} exists`);
      assert.equal(mode(file) & 0o077, 0, `${file} has no group or world access`);
    }
  } finally {
    db.close();
    dispose();
  }
});

test('a file from an earlier build that anyone could read is tightened', { skip: !posix }, () => {
  const { dir, dispose } = directory();
  const path = join(dir, 'runtime.db');
  writeFileSync(path, '');
  chmodSync(path, 0o644);

  const db = open(path);
  try {
    assert.equal(mode(path), 0o600);
  } finally {
    db.close();
    dispose();
  }
});

test('the default home is tightened, and a folder the user chose is left as it was', { skip: !posix }, () => {
  const { dir, dispose } = directory();
  const home = join(dir, '.cvitae');
  const chosen = join(dir, 'my-documents');
  for (const folder of [home, chosen]) {
    mkdirSync(folder);
    chmodSync(folder, 0o755);
  }

  try {
    open(join(home, 'runtime.db')).close();
    open(join(chosen, 'runtime.db')).close();

    assert.equal(mode(home), 0o700, 'the runtime owns ~/.cvitae, so it closes it');
    assert.equal(mode(chosen), 0o755, 'CVITAE_DB can name any folder, and that one holds other things');
  } finally {
    dispose();
  }
});

test('rows that are deleted do not linger in the file', () => {
  const { dir, dispose } = directory();
  const path = join(dir, 'runtime.db');
  const db = open(path);
  const marker = 'unmistakable-marker-8c41d2';

  try {
    assert.equal(db.pragma('secure_delete', { simple: true }), 2, 'FAST: free when it costs no extra I/O');

    db.exec('CREATE TABLE secret (note TEXT)');
    db.prepare('INSERT INTO secret VALUES (?)').run(marker);
    db.pragma('wal_checkpoint(TRUNCATE)');
    assert.ok(readFileSync(path).includes(marker), 'it is in the file to begin with');

    db.prepare('DELETE FROM secret').run();
    db.pragma('wal_checkpoint(TRUNCATE)');
    assert.ok(!readFileSync(path).includes(marker), 'and is overwritten once the row is gone');
  } finally {
    db.close();
    dispose();
  }
});

/* ------------------------------------------------- telling the parent why */

test('the two refusals have the exit statuses the desktop app looks for', () => {
  // The app keeps the same numbers in `sidecar_harness_client.dart`. Changing
  // one side without the other turns a clear message back into "exited with
  // code 78", so the values are pinned here rather than derived.
  assert.deepEqual(STARTUP_REFUSALS, { db_newer_than_app: 78, db_backup_failed: 73 });

  assert.deepEqual(
    startupRefusal(new OperationError('db_newer_than_app', 'newer')),
    { code: 'db_newer_than_app', message: 'newer', status: 78 }
  );
  assert.equal(startupRefusal(new OperationError('db_backup_failed', 'full'))?.status, 73);
});

test('anything else that goes wrong at startup is a crash, not a refusal', () => {
  assert.equal(startupRefusal(new OperationError('something_else', 'no')), undefined);
  assert.equal(startupRefusal(new Error('db_newer_than_app')), undefined);
  assert.equal(startupRefusal('db_newer_than_app'), undefined);
  assert.equal(startupRefusal(undefined), undefined);
});

const entry = fileURLToPath(new URL('../src/adapters/stdio/main.ts', import.meta.url));

/** Starts the real entry point against [databasePath] and waits for it to exit. */
const start = (dir: string, databasePath: string) =>
  spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), entry], {
    cwd: dir,
    encoding: 'utf8',
    input: '',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: dir,
      USERPROFILE: dir,
      CVITAE_DB: databasePath,
      ENV_FILE: join(dir, 'no-env-file')
    }
  });

test('the process refuses a newer database with status 78 and one line saying why', { timeout: 90_000 }, () => {
  const { dir, dispose } = directory();
  const path = join(dir, 'runtime.db');

  try {
    const db = open(path);
    migrate(db);
    db.pragma(`user_version = ${latestVersion + 1}`);
    db.close();

    const run = start(dir, path);

    assert.equal(run.status, 78, run.stderr);
    assert.equal(run.stdout, '', 'nothing reaches the protocol stream');
    assert.match(run.stderr, /^cvitae-runtime: db_newer_than_app: /m);
  } finally {
    dispose();
  }
});

test('the process refuses an upgrade it cannot back up with status 73', { timeout: 90_000 }, () => {
  const { dir, dispose } = directory();
  const path = join(dir, 'runtime.db');

  try {
    const db = open(path);
    migrate(db, at(1));
    db.close();
    mkdirSync(join(`${path}.bak-1`, 'in-the-way'), { recursive: true });

    const run = start(dir, path);

    assert.equal(run.status, 73, run.stderr);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /^cvitae-runtime: db_backup_failed: /m);

    const check = new Database(path, { readonly: true });
    try {
      assert.equal(version(check), 1, 'and the file is still at the version it had');
    } finally {
      check.close();
    }
  } finally {
    dispose();
  }
});

test('a crash at startup is still a crash: not 78, not 73, and no refusal line', { timeout: 90_000 }, () => {
  const { dir, dispose } = directory();
  // The database's folder is a file, which no amount of retrying will fix
  // either, but which is not something the runtime has a sentence for.
  const blocker = join(dir, 'a-file');
  writeFileSync(blocker, '');

  try {
    const run = start(dir, join(blocker, 'runtime.db'));

    assert.notEqual(run.status, 0);
    assert.ok(![78, 73].includes(run.status ?? -1), `unexpected status ${run.status}`);
    assert.doesNotMatch(run.stderr, /^cvitae-runtime: /m);
  } finally {
    dispose();
  }
});
