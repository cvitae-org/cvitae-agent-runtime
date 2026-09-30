/**
 * A copy of the database, taken before a migration changes it.
 *
 * A migration that succeeds and is wrong cannot be undone from inside the file,
 * and the file is the only place the person's CV, offers and conversations
 * live. So before the first pending migration runs, the file as it was is set
 * aside as `runtime.db.bak-<version>`, where `<version>` is the schema it
 * carried. Rolling the app back, or recovering from a bad migration, is then a
 * matter of moving one file, and the name says which build wrote it.
 *
 * Two ways of making the copy, because the fast one has a precondition:
 *
 *   checkpoint + clone   Folds the write-ahead log into the main file, after
 *                        which that file alone is the database, and copies it
 *                        with copy-on-write where the volume has it (APFS does:
 *                        a 400 MB file costs no time and no space until either
 *                        side changes). This runs while the app is starting, so
 *                        time matters: the parent gives the runtime a few
 *                        seconds to say hello.
 *   VACUUM INTO          Used when the checkpoint could not complete because
 *                        another connection still holds the file. Slower — it
 *                        rewrites every live page — but correct however the
 *                        file is being held.
 *
 * The copy is written under a name of its own and renamed into place, so a
 * process killed half way through never leaves something that looks like a
 * backup and is not one. It is created readable by its owner only.
 *
 * A backup that cannot be made stops the upgrade. Migrating anyway would be
 * choosing the person's only copy of their data over a full disk they can fix in
 * a minute.
 */

import { chmodSync, constants, copyFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { OperationError } from '../../contracts/operation-error.js';
import type { Db } from './open.js';

/**
 * How many backups are kept, the one just made included. Each is a whole
 * database, and a person's is not small.
 */
export const BACKUPS_KEPT = 2;

const suffix = (version: number): string => `.bak-${version}`;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The backup files beside [source], newest schema first. */
export const backupsOf = (source: string): { name: string; version: number }[] => {
  const pattern = new RegExp(`^${escapeRegExp(basename(source))}\\.bak-(\\d+)$`);
  return readdirSync(dirname(source))
    .flatMap((name) => {
      const match = pattern.exec(name);
      return match ? [{ name, version: Number(match[1]) }] : [];
    })
    .sort((a, b) => b.version - a.version);
};

/**
 * Sets the database aside as it is now, at [version], and returns where.
 * Throws `db_backup_failed` and leaves nothing behind when it cannot.
 */
export const backUp = (db: Db, version: number): string => {
  const source = db.name;
  const target = `${source}${suffix(version)}`;
  const partial = `${target}.partial`;

  try {
    rmSync(partial, { force: true });

    const [checkpoint] = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
    if (checkpoint?.busy === 0) {
      copyFileSync(source, partial, constants.COPYFILE_FICLONE);
    } else {
      // `VACUUM INTO` takes a file name and no bound parameter.
      db.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
    }

    chmodSync(partial, 0o600);
    renameSync(partial, target);
  } catch (error) {
    rmSync(partial, { force: true });
    throw new OperationError(
      'db_backup_failed',
      `The database could not be backed up before it was upgraded: ${(error as Error).message}`
    );
  }

  prune(source, target);
  return target;
};

/**
 * Removes the backups beyond [BACKUPS_KEPT]: [made], which is the one this
 * upgrade depends on and is never a candidate, and the newest schemas among the
 * rest. Ordering by schema alone would delete [made] whenever a lower-numbered
 * backup is taken after higher ones exist, which is what restoring an old
 * backup and upgrading again does.
 *
 * A failure here is not worth stopping for: the upgrade has its backup, and the
 * old ones are only taking up room.
 */
const prune = (source: string, made: string): void => {
  try {
    const others = backupsOf(source).filter((backup) => backup.name !== basename(made));
    for (const old of others.slice(BACKUPS_KEPT - 1)) {
      rmSync(join(dirname(source), old.name), { force: true });
    }
  } catch {
    // Keeping more than intended is the safe way to be wrong.
  }
};
