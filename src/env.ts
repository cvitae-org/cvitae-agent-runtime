/**
 * Loads `.env`, if there is one.
 *
 * Only entry points import this, as a bare side-effect import placed before
 * anything that reads `process.env`. Library code never loads a `.env` file, so
 * an in-process consumer's own environment always wins.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const explicit = process.env.ENV_FILE?.trim();
const paths = explicit
  ? [explicit]
  : ['.env', fileURLToPath(new URL('../.env', import.meta.url)), join(homedir(), '.cvitae', 'runtime.env')];

for (const path of new Set(paths)) {
  if (existsSync(path)) {
    // Node's own loader does not overwrite existing variables. This lets a
    // service manager win, then the launch working directory, then the runtime
    // package's development checkout. The package-relative fallback matters
    // when Studio launches the sidecar from Studio's working directory.
    process.loadEnvFile(path);
  }
}
