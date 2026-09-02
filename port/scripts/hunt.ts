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
const { shortlist } = await import('../src/offers/shortlist.js');

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

// The ranking and the tallies come from `src/offers/shortlist.ts`, which the
// HTTP route reads too. Everything below this line is presentation.
const { offers, tally, unread_by_board } = shortlist(await store.offerRecords.all());

for (const offer of offers) {
  const salary =
    offer.salary_min && offer.salary_period
      ? `${offer.salary_min}\u2013${offer.salary_max ?? offer.salary_min} ${offer.salary_currency}/${offer.salary_period}`
      : 'not stated';

  console.log(
    `${offer.eligibility === 'eligible' ? '\u25cf' : '\u25cb'} ${(offer.company || '?').slice(0, 24).padEnd(24)} ` +
      `${offer.title.slice(0, 44).padEnd(44)} fit ${String(offer.fit ?? '-').padEnd(4)} ${salary}`
  );
  console.log(`  ${offer.url}`);

  // What kept it off the eligible list, and what a model claimed but could not
  // support. Both are the reason to read the posting yourself before applying.
  for (const criterion of offer.criteria) {
    if (criterion.verdict === 'unknown') console.log(`    ? ${criterion.because}`);
  }
  if (offer.unverified.length) {
    console.log(`    ! unverified claims dropped: ${offer.unverified.join(', ')}`);
  }
}

console.log(
  `\n${tally.shortlisted} worth a look ` +
    `(${tally.eligible} eligible, ${tally.provisional} undecided), ` +
    `${tally.ruled_out} ruled out, ${tally.unread} unread.`
);

if (tally.unanalysed > 0) {
  console.log(`${tally.unanalysed} fetched but not scored \u2014 a retry owes a model call, not a board.`);
}

if (tally.unread > 0) {
  console.log(
    `unread by board: ${unread_by_board.map(({ board, count }) => `${board} ${count}`).join(', ')}\n` +
      `  npx tsx scripts/hunt.ts --read ${tally.unread}   \u2014 about ${Math.round((tally.unread * 42) / 60)} min on gemma3:4b`
  );
}
