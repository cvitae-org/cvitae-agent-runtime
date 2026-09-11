/**
 * Schema versioning on `PRAGMA user_version`.
 *
 * No migration table, no filenames scanned at runtime, no checksums. The
 * version is an integer SQLite already stores in the file header, and the
 * migrations are an array in this file. That is the whole mechanism, and it is
 * enough for a database that ships inside one application and is never
 * administered by anyone else.
 */

import { contextPhotos0013 } from './migrations/0013-context-photos.js';
import { offerSnapshots0014 } from './migrations/0014-offer-snapshots.js';
import { contextContracts0015 } from './migrations/0015-context-contracts.js';
import type { Db } from './open.js';
import { init0001 } from './migrations/0001-init.js';
import { stepStopped0002 } from './migrations/0002-step-stopped.js';
import { offerDiscovery0003 } from './migrations/0003-offer-discovery.js';
import { aiCalls0004 } from './migrations/0004-ai-calls.js';
import { settings0005 } from './migrations/0005-settings.js';
import { conversations0006 } from './migrations/0006-conversations.js';
import { manyConversations0007 } from './migrations/0007-many-conversations.js';
import { conversationNote0008 } from './migrations/0008-conversation-note.js';
import { indexRecovery0012 } from './migrations/0012-index-recovery.js';
import { cvLifecycle0011 } from './migrations/0011-cv-lifecycle.js';
import { contextIsolation0010 } from './migrations/0010-context-isolation.js';
import { cvContexts0009 } from './migrations/0009-cv-contexts.js';

export type Migration = { readonly version: number; readonly sql: string };

export const migrations: readonly Migration[] = [
  { version: 1, sql: init0001 },
  { version: 2, sql: stepStopped0002 },
  { version: 3, sql: offerDiscovery0003 },
  { version: 4, sql: aiCalls0004 },
  { version: 5, sql: settings0005 },
  { version: 6, sql: conversations0006 },
  { version: 7, sql: manyConversations0007 },
  { version: 8, sql: conversationNote0008 },
  { version: 9, sql: cvContexts0009 },
  { version: 10, sql: contextIsolation0010 },
  { version: 11, sql: cvLifecycle0011 },
  { version: 12, sql: indexRecovery0012 },
  { version: 13, sql: contextPhotos0013 },
  { version: 14, sql: offerSnapshots0014 },
  { version: 15, sql: contextContracts0015 }
];

export const latestVersion = migrations.reduce((max, m) => Math.max(max, m.version), 0);

/**
 * Applies every migration newer than the file's version, each in its own
 * transaction, and returns the version reached.
 *
 * `steps` is a parameter only so a test can hand in a failing migration and
 * check that the rollback claim is true. Every caller uses the default.
 *
 * Per-migration transactions rather than one around all of them: a failure part
 * way through a series should leave the file at the last version that fully
 * applied, not roll back work that succeeded. Either way the file is at a
 * version that some code in this repo was written against.
 */
export const migrate = (db: Db, steps: readonly Migration[] = migrations): number => {
  let current = db.pragma('user_version', { simple: true }) as number;

  for (const step of steps) {
    if (step.version <= current) continue;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(step.sql);
      // PRAGMA takes no bound parameters, so this is string interpolation by
      // necessity. The value is a number literal from the static array above
      // and never anything a caller supplied.
      db.pragma(`user_version = ${step.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    current = step.version;
  }

  return current;
};
