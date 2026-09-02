/**
 * Loads `.env`, if there is one.
 *
 * Only entry points import this, as a bare side-effect import placed before
 * anything that reads `process.env`. Library code never loads a `.env` file, so
 * an in-process consumer's own environment always wins.
 */

import { existsSync } from 'node:fs';

const path = process.env.ENV_FILE ?? '.env';

if (existsSync(path)) {
  // Node's own loader, so there is no dependency for this. It does not
  // overwrite variables that are already set.
  process.loadEnvFile(path);
}
