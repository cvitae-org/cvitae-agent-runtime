/**
 * The one place a database connection is made.
 *
 * `better-sqlite3` is imported here and in this directory's siblings, and
 * nowhere else in the codebase — a rule the boundary checker enforces. That is
 * what makes the engine a decision rather than an assumption: everything above
 * talks to the ports in `contracts/`, and the day this becomes a different
 * driver, this directory is the whole of the change.
 */

import Database from 'better-sqlite3';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';

export type Db = Database.Database;

/**
 * Pragmas, and why each one.
 *
 *   journal_mode = WAL   readers do not block the writer and the writer does
 *                        not block readers. A UI tailing a run's events while
 *                        the run writes them is the normal case here, not an
 *                        edge one.
 *   busy_timeout = 5000  under WAL a second writer still has to wait. Without
 *                        this it gets SQLITE_BUSY immediately instead of
 *                        waiting the few milliseconds a checkpoint takes.
 *   synchronous = NORMAL safe under WAL: a crash can lose the tail of the most
 *                        recent transactions but cannot corrupt the file. FULL
 *                        costs an fsync per commit, and this system commits
 *                        once per step.
 *   foreign_keys = ON    off by default in SQLite, which surprises everyone
 *                        once. The cascades from runs to steps and events are
 *                        load-bearing for deletion.
 *
 *   secure_delete = FAST rows that are deleted stop being readable from the
 *                        file's free pages whenever overwriting them costs no
 *                        extra I/O. The file holds a CV, and a deleted offer or
 *                        conversation should not linger in it until the space
 *                        happens to be reused.
 *
 * `journal_mode` is a property of the file and persists; the rest are
 * per-connection and have to be set every time one is opened.
 *
 * The file is the person's CV, offers and conversations, so it is private to
 * them: created readable by its owner only, and made so on installs from before
 * that was true. See `prepareDirectory` and `keepPrivate`.
 */
export const open = (path: string): Db => {
  const onDisk = path !== ':memory:' && path !== '';
  if (onDisk) {
    prepareDirectory(dirname(path));
    // Made before SQLite would make it, because SQLite gives its `-wal` and
    // `-shm` files the permissions of the main file. Owner-only from the first
    // byte means the whole family is, with nothing to fix up afterwards.
    closeSync(openSync(path, 'a', PRIVATE_FILE));
  }

  const db = new Database(path);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = FAST');

  if (onDisk) keepPrivate(path);

  return db;
};

const PRIVATE_FILE = 0o600;
const PRIVATE_DIRECTORY = 0o700;

/**
 * The directory the database lives in.
 *
 * One this process creates is private. One that already exists is the user's
 * and is left alone — `CVITAE_DB` can point anywhere, including a folder that
 * holds other things — with one exception: `~/.cvitae`, the default home of this
 * runtime's data, which older builds created readable by every account on the
 * machine. That one is tightened, and only ever tightened: bits are removed,
 * never added.
 */
const prepareDirectory = (directory: string): void => {
  const existed = existsSync(directory);
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY });
  if (existed && basename(directory) === '.cvitae') {
    tighten(directory, 0o077);
  }
};

/** The database file and the files SQLite keeps beside it, owner-only. */
const keepPrivate = (path: string): void => {
  for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
    if (existsSync(file)) tighten(file, 0o077);
  }
};

/**
 * Removes the [strip] bits from a path's mode. Best effort: a file that belongs
 * to someone else cannot be changed, and refusing to start over it would take
 * the app down to protect nothing.
 */
const tighten = (path: string, strip: number): void => {
  try {
    const mode = statSync(path).mode & 0o777;
    if ((mode & strip) !== 0) chmodSync(path, mode & ~strip);
  } catch {
    // Not ours to change.
  }
};
