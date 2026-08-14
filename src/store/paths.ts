/**
 * Where the runtime keeps state.
 *
 * One directory, because the user should be able to see all of it, copy it to
 * back it up, and delete it to start over. `CVITAE_HOME` moves it; the default
 * is `~/.cvitae`.
 *
 * The split inside is between what is authored and what is derived:
 *
 *   cv.json   the canonical CV document. Small, mutable, hand-editable when a
 *             model gets something wrong, and the only file whose loss matters.
 *   lance/    the derived index — chunk embeddings and stored offers. Every
 *             byte of it can be rebuilt from cv.json and the offer records, so
 *             a schema change here is `rm -rf` and re-index rather than a
 *             migration.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

export const runtimeHome = (): string =>
  process.env.CVITAE_HOME?.trim() || join(homedir(), '.cvitae');

export const documentPath = (): string => join(runtimeHome(), 'cv.json');

export const lancePath = (): string => join(runtimeHome(), 'lance');

/** Creates the home directory if it is missing. Safe to call repeatedly. */
export const ensureHome = async (): Promise<string> => {
  const home = runtimeHome();
  await mkdir(home, { recursive: true });
  return home;
};
