import { groundingLimits0044 } from './migrations/0044-grounding-limits.js';
import { cvProposalChanges0045 } from './migrations/0045-cv-proposal-changes.js';
import { groundingPins0043 } from './migrations/0043-grounding-pins.js';
import { discoveryTurnScope0042 } from './migrations/0042-discovery-turn-scope.js';
import { groundingSelection0041 } from './migrations/0041-grounding-selection.js';
import { groundingRecord0040 } from './migrations/0040-grounding-record.js';
import { boardChatRemoval0039 } from './migrations/0039-board-chat-removal.js';
import { indexParking0038 } from './migrations/0038-index-parking.js';
import { integrationDirectories0037 } from './migrations/0037-integration-directories.js';
import { integrationSettings0036 } from './migrations/0036-integration-settings.js';
import { boardRemoval0034 } from './migrations/0034-board-removal.js';
import { browserCompanion0033 } from './migrations/0033-browser-companion.js';
import { discoveryRegistry0032 } from './migrations/0032-discovery-registry.js';
import { boardWorkspaces0031 } from './migrations/0031-board-workspaces.js';
import { discoveryOfferActions0030 } from './migrations/0030-discovery-offer-actions.js';
import { headlineOpportunities0029 } from './migrations/0029-headline-opportunities.js';
import { sameBoardOpportunities0028 } from './migrations/0028-same-board-opportunities.js';
import { opportunities0027 } from './migrations/0027-opportunities.js';
import { offerFacts0024 } from './migrations/0024-offer-facts.js';
import { discoveryDecisions0025 } from './migrations/0025-discovery-decisions.js';
import { discoveryRequestLedger0026 } from './migrations/0026-discovery-request-ledger.js';
import { offerQueries0023 } from './migrations/0023-offer-queries.js';
import { detailQueue0022 } from './migrations/0022-detail-queue.js';
import { discoveryEvidenceIndex0021 } from './migrations/0021-discovery-evidence-index.js';
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
import { discoveryCatalogue0016 } from './migrations/0016-discovery-catalogue.js';
import { offerEnrichment0017 } from './migrations/0017-offer-enrichment.js';
import { offerNotes0018 } from './migrations/0018-offer-notes.js';
import { discoverySearches0019 } from './migrations/0019-discovery-searches.js';
import { discoveryChat0020 } from './migrations/0020-discovery-chat.js';
import type { Db } from './open.js';
import { OperationError } from '../../contracts/operation-error.js';
import { backUp } from './backup.js';
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
  { version: 15, sql: contextContracts0015 },
  { version: 16, sql: discoveryCatalogue0016 },
  { version: 17, sql: offerEnrichment0017 },
  { version: 18, sql: offerNotes0018 },
  { version: 19, sql: discoverySearches0019 },
  { version: 20, sql: discoveryChat0020 },
  { version: 21, sql: discoveryEvidenceIndex0021 },
  { version: 22, sql: detailQueue0022 },
  { version: 23, sql: offerQueries0023 },
  { version: 24, sql: offerFacts0024 },
  { version: 25, sql: discoveryDecisions0025 },
  { version: 26, sql: discoveryRequestLedger0026 },
  { version: 27, sql: opportunities0027 },
  { version: 28, sql: sameBoardOpportunities0028 },
  { version: 29, sql: headlineOpportunities0029 },
  { version: 30, sql: discoveryOfferActions0030 },
  { version: 31, sql: boardWorkspaces0031 },
  { version: 32, sql: discoveryRegistry0032 },
  { version: 33, sql: browserCompanion0033 },
  { version: 34, sql: boardRemoval0034 },
  { version: 35, sql: integrationAcquisitions0035 },
  { version: 36, sql: integrationSettings0036 },
  { version: 37, sql: integrationDirectories0037 },
  { version: 38, sql: indexParking0038 },
  { version: 39, sql: boardChatRemoval0039 },
  { version: 40, sql: groundingRecord0040 },
  { version: 41, sql: groundingSelection0041 },
  { version: 42, sql: discoveryTurnScope0042 },
  { version: 43, sql: groundingPins0043 },
  { version: 44, sql: groundingLimits0044 },
  { version: 45, sql: cvProposalChanges0045 }
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
 *
 * Two things happen before the first migration, and both protect a file that
 * holds the only copy of someone's data:
 *
 *   - A file whose version is *newer* than any step here is refused with
 *     `db_newer_than_app`. It was written by a later build, and running this
 *     one's queries against a schema it has never seen is how a rolled-back app
 *     corrupts what a newer one saved. Nothing in the file is changed.
 *   - When migrations are pending on a file that has content, the file is first
 *     set aside as `<file>.bak-<version>` (see `backup.ts`). If that cannot be
 *     done, `db_backup_failed` stops the upgrade before it starts.
 *
 * An in-memory database has no file to protect and is never backed up.
 */
export const migrate = (db: Db, steps: readonly Migration[] = migrations): number => {
  let current = db.pragma('user_version', { simple: true }) as number;

  const head = steps.reduce((max, step) => Math.max(max, step.version), 0);
  if (current > head) {
    throw new OperationError(
      'db_newer_than_app',
      `The database is at schema ${current}, and this build understands up to ${head}. `
        + 'It was written by a newer version of the app.'
    );
  }

  if (current > 0 && !db.memory && steps.some((step) => step.version > current)) {
    backUp(db, current);
  }

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
import { integrationAcquisitions0035 } from './migrations/0035-integration-acquisitions.js';
