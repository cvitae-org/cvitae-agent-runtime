/**
 * Where the runtime keeps state.
 *
 * One directory, because the user should be able to see all of it, copy it to
 * back it up, and delete it to start over. `CVITAE_HOME` moves it; the default
 * is `~/.cvitae`.
 *
 * The split inside is between what is authored and what is derived:
 *
 *   cv.json      the canonical CV document. Small, mutable, hand-editable when
 *                a model gets something wrong.
 *   offers.jsonl the job postings the runtime has seen, one per line, plus what
 *                the user decided about each. Authored by accumulation rather
 *                than by hand, and unrebuildable for the same reason a diary
 *                is: it holds the text of postings that are taken down within
 *                weeks, and the source it would be rebuilt from is a 404.
 *   lance/       the derived index — chunk embeddings and a queryable
 *                projection of the offers. Every byte of it can be rebuilt from
 *                the two files above, so a schema change here is `rm -rf` and
 *                re-index rather than a migration.
 *
 * That last sentence used to be false. `lance/offers` held the only copy of
 * each posting's text, which made "delete the index and rebuild" a way to lose
 * data — and made every change to the offer shape a real migration. Moving the
 * records out is what lets the claim stand.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

export const runtimeHome = (): string =>
  process.env.CVITAE_HOME?.trim() || join(homedir(), '.cvitae');

export const documentPath = (): string => join(runtimeHome(), 'cv.json');

export const offersPath = (): string => join(runtimeHome(), 'offers.jsonl');

export const lancePath = (): string => join(runtimeHome(), 'lance');

/** Creates the home directory if it is missing. Safe to call repeatedly. */
export const ensureHome = async (): Promise<string> => {
  const home = runtimeHome();
  await mkdir(home, { recursive: true });
  return home;
};
