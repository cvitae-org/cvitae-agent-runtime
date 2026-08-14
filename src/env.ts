/**
 * Loads `.env` into the process, if there is one.
 *
 * Imported by the entry points — the server and the smoke script — and by
 * nothing else. A library that reads `.env` on import changes its host's
 * configuration as a side effect of being required, and cvitae is expected to
 * import `createRuntime` in-process, where Next.js has already loaded its own
 * environment and should win. Whoever owns the process owns the environment.
 *
 * Nothing here existed before, and the absence was silent in the worst way: the
 * README's quick start is `cp .env.example .env` followed by `pnpm dev`, but
 * neither `tsx` nor `node` reads that file on its own, so a correctly filled
 * `.env` produced "Missing OPENROUTER_API_KEY" and looked like a bad key rather
 * than an unread file.
 *
 * A missing file is the normal case, not an error: every setting has a default
 * and `AI_PROVIDER=local` needs no credential at all. Existing variables win,
 * which is what makes `AI_PROVIDER=local pnpm dev` work as an override.
 */

import { existsSync } from 'node:fs';

const path = process.env.ENV_FILE ?? '.env';

if (existsSync(path)) {
  // Node's own loader, so there is no dependency for this. It does not
  // overwrite variables that are already set.
  process.loadEnvFile(path);
}
