/**
 * The boundary rules, as a test.
 *
 * They already run in CI. Running them here too means a violation shows up in
 * the same `pnpm test` a developer runs before pushing, rather than four minutes
 * after — and a rule you find out about from a red build is a rule you start
 * resenting.
 *
 * The second test is not something dependency-cruiser can express. It checks
 * where a *value* is read rather than where a module is imported: every API key
 * in this process comes through `secrets/env.ts`, and a key read in five places
 * is a key that leaks from whichever of the five forgot. A grep is a blunt
 * instrument, and exactly the right shape for the rule.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const cruise = (): { ok: boolean; output: string } => {
  try {
    execFileSync(
      join(root, 'node_modules/.bin/depcruise'),
      ['src', '--config', '.dependency-cruiser.cjs'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { ok: true, output: '' };
  } catch (error) {
    // depcruise signals violations with a non-zero exit and writes the report to
    // stdout, so the report is on the error rather than the return value.
    const shelled = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${shelled.stdout ?? ''}${shelled.stderr ?? ''}` };
  }
};

test('no module crosses a boundary it should not', () => {
  const { ok, output } = cruise();
  assert.ok(ok, `dependency-cruiser reported violations:\n\n${output}`);
});

/** The variables that are credentials. Settings like AI_PROVIDER are not. */
const KEY_VARIABLES = ['OPENROUTER_API_KEY', 'HF_TOKEN', 'OPENAI_API_KEY'];

test('an API key is named in one directory and read in one function', () => {
  const files = execFileSync('git', ['ls-files', 'src'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path.endsWith('.ts'));

  const offenders = files.filter((path) => {
    if (path.startsWith('src/secrets/') || path === 'src/providers/resolve.ts') return false;
    const source = readFileSync(join(root, path), 'utf8');
    return KEY_VARIABLES.some((name) => source.includes(name));
  });

  assert.deepEqual(
    offenders,
    [],
    'these name an API key outside secrets/ and the provider catalogue'
  );

  // The catalogue may name the variables — that is what it is for — but must
  // not read one. `process.env` appears there only for settings.
  const catalogue = readFileSync(join(root, 'src/providers/resolve.ts'), 'utf8');
  for (const name of KEY_VARIABLES) {
    assert.ok(
      !catalogue.includes(`process.env.${name}`) && !catalogue.includes(`env.${name}`),
      `${name} is read in the catalogue rather than in secrets/`
    );
  }
});
