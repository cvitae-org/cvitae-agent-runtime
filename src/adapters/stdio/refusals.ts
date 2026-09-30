/**
 * Startup failures that starting again cannot fix, and the exit status that
 * says so.
 *
 * A parent that supervises this process restarts it when it dies, because most
 * deaths are transient: a crash, a killed process, a machine that slept. Two
 * are not. A database written by a newer build will be just as newer on the
 * next attempt, and a disk with no room for the backup an upgrade needs will
 * still be full. Told only "exited with code 1" the parent retries, fails the
 * same way, and spends its whole restart budget on a sentence it could have said
 * once.
 *
 * So these end the process with a status of their own, after one line on stderr
 * naming the code, and the parent recognises the status. The numbers are from
 * `sysexits.h`, the nearest thing to a convention for a process telling its
 * parent why it refused: 78 is `EX_CONFIG`, 73 is `EX_CANTCREAT`.
 *
 * The parent keeps the same two numbers — `lib/core/harness/sidecar_harness_client.dart`
 * in the desktop app — so changing one is changing both.
 */

import { OperationError } from '../../contracts/operation-error.js';

export const STARTUP_REFUSALS: Readonly<Record<string, number>> = {
  db_newer_than_app: 78,
  db_backup_failed: 73
};

export type StartupRefusal = { readonly code: string; readonly message: string; readonly status: number };

/** The refusal an error amounts to, or undefined for anything that is a crash. */
export const startupRefusal = (error: unknown): StartupRefusal | undefined => {
  if (!(error instanceof OperationError)) return undefined;
  const status = STARTUP_REFUSALS[error.code];
  return status === undefined ? undefined : { code: error.code, message: error.message, status };
};
