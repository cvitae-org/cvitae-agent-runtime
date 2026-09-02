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
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
 * `journal_mode` is a property of the file and persists; the rest are
 * per-connection and have to be set every time one is opened.
 */
export const open = (path: string): Db => {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  return db;
};
