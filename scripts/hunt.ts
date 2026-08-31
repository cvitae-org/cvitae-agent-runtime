/**
 * One pass of the job hunt: discover, read the backlog, and print the shortlist.
 *
 *   npx tsx scripts/hunt.ts                    # one round, reads 5 postings
 *   npx tsx scripts/hunt.ts --rounds 4 --read 50
 *   npx tsx scripts/hunt.ts --report           # no model, no network: just look
 *
 * Reading is the expensive half and the only half that needs a model — roughly
 * 40s per posting on `gemma3:4b`, so `--read 200` is an overnight job, not a
 * coffee break. Discovery itself is cheap: 216 offers in 33s, no API key.
 *
 * Everything here is resumable. A round persists as it goes, an offer already
 * read is never read again, and an offer whose extraction failed keeps its text
 * so the next pass owes a model call and nothing to the board.
 */

import '../src/env.js';

const { createRuntime } = await import('../src/index.js');
const { boardFor } = await import('../src/offers/boards.js');

const flag = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  return Number.isFinite(value) ? value : fallback;
};

const reportOnly = process.argv.includes('--report');
const rounds = flag('rounds', 1);
const read = flag('read', 5);

const runtime = createRuntime();
const store = await runtime.store();

if (!reportOnly) {
  const started = Date.now();
  const reports = await runtime.discoverOffers({ rounds, fetchLimit: read });

  for (const report of reports) {
    console.log(
      `round ${report.round}  [${report.queries.join(', ')}]  ` +
        `${report.hits} hits, ${report.discovered} new, ${report.fetched} read ` +
        `(${report.requested} fetched), ${report.rated} rated, ${report.unreadable} unreadable`
    );
    for (const failure of report.searchFailures) console.log(`   search failed — ${failure}`);
    for (const duplicate of report.duplicates) {
      console.log(`   duplicate of ${duplicate.of}: ${duplicate.id}`);
    }
  }

  console.log(`\n${((Date.now() - started) / 1000).toFixed(1)}s\n`);
}

/* ------------------------------------------------------------- report -- */

const all = await store.offerRecords.all();
const unread = all.filter((r) => r.processing === 'candidate' && r.disposition === 'active');
const rated = all.filter((r) => r.processing === 'rated' && r.disposition === 'active');

const order = { eligible: 0, provisional: 1, ineligible: 2, unrated: 3 } as const;
const shortlist = rated
  .filter((r) => r.eligibility === 'eligible' || r.eligibility === 'provisional')
  .sort(
    (a, b) =>
      order[a.eligibility] - order[b.eligibility] ||
      (b.fit ?? 0) - (a.fit ?? 0) ||
      b.completeness - a.completeness
  );

for (const record of shortlist) {
  const salary =
    record.salary_min && record.salary_period
      ? `${record.salary_min}–${record.salary_max ?? record.salary_min} ${record.salary_currency}/${record.salary_period}`
      : 'not stated';

  console.log(
    `${record.eligibility === 'eligible' ? '●' : '○'} ${(record.company || '?').slice(0, 24).padEnd(24)} ` +
      `${record.title.slice(0, 44).padEnd(44)} fit ${String(record.fit ?? '-').padEnd(4)} ${salary}`
  );
  console.log(`  ${record.url}`);

  // What kept it off the eligible list, and what a model claimed but could not
  // support. Both are the reason to read the posting yourself before applying.
  const detail = record.score_detail as {
    criteria?: { criterion: string; verdict: string; because: string }[];
    unverified?: string[];
  };
  for (const criterion of detail.criteria ?? []) {
    if (criterion.verdict === 'unknown') console.log(`    ? ${criterion.because}`);
  }
  if (detail.unverified?.length) {
    console.log(`    ! unverified claims dropped: ${detail.unverified.join(', ')}`);
  }
}

const byBoard = new Map<string, number>();
for (const record of unread) {
  const board = boardFor(record.url)?.name ?? 'elsewhere';
  byBoard.set(board, (byBoard.get(board) ?? 0) + 1);
}

console.log(
  `\n${shortlist.length} worth a look ` +
    `(${shortlist.filter((r) => r.eligibility === 'eligible').length} eligible, ` +
    `${shortlist.filter((r) => r.eligibility === 'provisional').length} undecided), ` +
    `${rated.length - shortlist.length} ruled out, ${unread.length} unread.`
);

if (unread.length > 0) {
  console.log(
    `unread by board: ${[...byBoard].map(([b, n]) => `${b} ${n}`).join(', ')}\n` +
      `  npx tsx scripts/hunt.ts --read ${unread.length}   — about ${Math.round((unread.length * 42) / 60)} min on gemma3:4b`
  );
}
