/**
 * Imports a CV into the store, which is the thing everything else waits on.
 *
 * Without `cv.json` the runtime runs half-configured, and quietly: discovery
 * still works, but `buildKeywords` has only `preferences.skills.require` to
 * draw on, so it emits one term and the search saturates after a single round.
 * Drafting an application has nothing to draft from at all.
 *
 *   npx tsx scripts/import-cv.ts ~/Documents/cv.pdf
 *
 * Takes any number of files. PDF, DOCX and text are read by `sources/`; several
 * partial sources are merged rather than overwriting each other, which is why
 * an old CV and a newer LinkedIn export can both be passed.
 */

import '../src/env.js';
import { resolve } from 'node:path';

const { createRuntime } = await import('../src/index.js');
const { fingerprintValue } = await import('../src/core/fingerprint.js');

const paths = process.argv.slice(2).filter((argument) => !argument.startsWith('-'));

if (paths.length === 0) {
  console.error('Usage: npx tsx scripts/import-cv.ts <cv.pdf> [more files...]');
  process.exit(1);
}

const runtime = createRuntime();
const store = await runtime.store();

const before = await store.documents.read();
const started = Date.now();

const result = await runtime.run('extract_cv', {
  sources: paths.map((path) => ({ kind: 'file' as const, path: resolve(path) }))
});

const cv = await store.documents.read();
const data = result.data as { degraded?: string[] } | undefined;

console.log(`\nimported in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (data?.degraded?.length) console.log(`degraded steps: ${data.degraded.join(', ')}`);

console.log(`  name       ${cv.personal?.name || '(none)'}`);
console.log(`  role       ${cv.skills?.role || '(none)'}`);
console.log(`  experience ${cv.experience?.length ?? 0} roles`);
console.log(`  education  ${cv.education?.length ?? 0} entries`);
console.log(`  languages  ${(cv.skills?.programming_languages ?? []).join(', ') || '(none)'}`);
console.log(`  frameworks ${(cv.skills?.frameworks ?? []).join(', ') || '(none)'}`);

// The fingerprint is what `rescoreOffers` compares against, so a CV import
// makes every score on file stale by definition.
const moved =
  fingerprintValue({ ...before, updated_at: '' }) !== fingerprintValue({ ...cv, updated_at: '' });

if (moved) {
  const rescored = await runtime.rescoreOffers();
  console.log(
    `\nthe CV changed, so scores were stale: ${rescored.stale} of ${rescored.examined} rechecked, ${rescored.rescored} moved`
  );
}

const { buildKeywords } = await import('../src/offers/queries.js');
const keywords = buildKeywords(cv, await store.preferences.read());
console.log(`\ndiscovery now has ${keywords.length} search terms (was 1 with no CV):`);
console.log(`  ${keywords.slice(0, 12).join(' · ')}${keywords.length > 12 ? ' …' : ''}`);
