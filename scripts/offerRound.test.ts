import {boards} from './fixtures/source-catalogue.js';
/**
 * A discovery round, end to end, with no network and no model.
 *
 * Every seam the round takes — search, read, analyse — is a function parameter,
 * which is the property that makes this possible and the reason they are
 * parameters. What is exercised here is the part that is genuinely the round's
 * own: the three dedupes, the fetch budget, the trust boundary between what a
 * model claimed and what the posting says, and the states a record moves
 * through when any of it goes wrong.
 *
 * None of this had a test before. The pipeline was 4,372 lines and its checks
 * lived in a smoke script the `scripts/*.test.ts` glob does not match.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  EffectCall,
  Listing,
  OfferReader,
  ResolvedOffer,
  SearchHit,
  SiteOutcome,
  SiteReader
} from '../src/contracts/index.js';
import { RuntimeError } from '../src/contracts/index.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { emptyDocument } from '../src/capabilities/cv/document.js';
import type { CvDocument } from '../src/capabilities/cv/document.js';
import { emptyPreferences, preferencesSchema } from '../src/capabilities/offers/preferences.js';
import type { Preferences } from '../src/capabilities/offers/preferences.js';
import { boardSearch } from '../src/capabilities/offers/boardSearch.js';
import type { DiscoveryOutcome, DiscoverySource } from '../src/capabilities/offers/round.js';
import { runRound, runRounds } from '../src/capabilities/offers/round.js';
import { scratch } from './support/db.js';

const call = (): EffectCall => ({ traceId: 'trace-1', signal: new AbortController().signal });

const cv = (over: Partial<CvDocument['skills']> = {}): CvDocument => ({
  ...emptyDocument(),
  skills: {
    role: 'Flutter Developer',
    groups: [
      { label: 'Languages', items: ['Dart'] },
      { label: 'Frameworks', items: ['Flutter'] }
    ],
    programming_languages: ['Dart'],
    frameworks: ['Flutter'],
    libraries_and_tools: [],
    ...over
  }
});

const wants = (over: Partial<Preferences> = {}): Preferences =>
  preferencesSchema.parse({ ...emptyPreferences(), ...over });

const hit = (url: string, title = 'Flutter Developer', snippet = ''): SearchHit => ({
  url,
  title,
  snippet
});

/** A search that answers the same way whatever it is asked. */
const answers = (...hits: SearchHit[]): DiscoverySource => {
  const source: DiscoverySource & { calls: string[] } = Object.assign(
    async (query: string): Promise<DiscoveryOutcome> => {
      source.calls.push(query);
      return { status: 'ok', hits };
    },
    { calls: [] as string[] }
  );
  return source;
};

const POSTING = [
  'Senior Flutter Developer at Kowalski.',
  'Kraków, praca hybrydowa.',
  '20 000 - 25 000 PLN netto / mies. B2B.',
  'Wymagania: Flutter, Dart.'
].join('\n');

/** A reader with a body for each URL. Anything else is unreadable. */
const readerOver = (pages: Record<string, string>): OfferReader & { reads: string[] } => {
  const reads: string[] = [];
  return {
    reads,
    async resolve(url: string): Promise<ResolvedOffer> {
      reads.push(url);
      const text = pages[url];
      if (text === undefined) throw new RuntimeError('nothing to read', 'unreadable_source');
      return { url, finalUrl: url, text };
    }
  };
};

/** An extraction that reports what the posting above says. */
const extracts = async (): Promise<Record<string, unknown>> => ({
  position: 'Senior Flutter Developer',
  company: 'Kowalski',
  location: 'Kraków',
  work_mode: 'hybrid',
  seniority: 'senior',
  contract_type: 'B2B',
  salary: '20 000 - 25 000 PLN netto / mies.',
  required_skills: ['Flutter', 'Dart']
});

const OFFER = 'https://vacancies.example/offers/kowalski-senior-flutter-developer-krakow';

test('a round searches, reads, grounds and scores in one pass', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const read = readerOver({ [OFFER]: POSTING });

    const report = await runRound({boards,
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read,
      search: answers(hit(OFFER)),
      call: call(),
      queries: ['flutter developer']
    });

    assert.equal(report.hits, 1);
    assert.equal(report.discovered, 1);
    assert.equal(report.requested, 1);
    assert.equal(report.rated, 1);
    assert.equal(report.added, 1);
    assert.equal(report.saturated, false);

    const [scored] = report.scored;
    assert.equal(scored?.company, 'Kowalski');

    const stored = store.recent(10)[0]!;
    assert.equal(stored.processing, 'rated');
    assert.equal(stored.workMode, 'hybrid');
    assert.equal(stored.contractType, 'B2B');
    // Derived by the round, from the line the posting states. The store used to
    // do this, which put a parser for Polish payroll behind an INSERT.
    assert.deepEqual(stored.salaryReading, {
      min: 20000,
      max: 25000,
      currency: 'PLN',
      period: 'month'
    });
    assert.equal(stored.rating?.scorerVersion !== undefined, true);
  } finally {
    s.dispose();
  }
});

test('a claim the posting does not support is dropped, and named', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);

    const report = await runRound({boards,
      store,
      cv: cv(),
      preferences: wants(),
      // The salary is invented: no such figure appears in the text.
      analyse: async () => ({ ...(await extracts()), salary: '40 000 PLN / mies.' }),
      read: readerOver({ [OFFER]: POSTING }),
      search: answers(hit(OFFER)),
      call: call(),
      queries: ['flutter developer']
    });

    assert.deepEqual(report.scored[0]?.unverified, ['salary']);
    // Gating facts that fail verification are not stored at all — a salary the
    // scorer could act on must be one the posting actually states.
    assert.equal(store.recent(10)[0]?.salary, undefined);
  } finally {
    s.dispose();
  }
});

test('two queries returning one posting is one candidate', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const read = readerOver({ [OFFER]: POSTING });

    const report = await runRound({boards,
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read,
      // The same offer under two spellings of the same URL.
      search: answers(hit(OFFER), hit(`${OFFER}?utm_source=newsletter`)),
      call: call(),
      queries: ['a', 'b']
    });

    assert.equal(report.hits, 4);
    assert.equal(report.discovered, 1);
    assert.equal(read.reads.length, 1);
  } finally {
    s.dispose();
  }
});

test('what the fetch budget does not reach is still recorded', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const read = readerOver({ [OFFER]: POSTING });

    const report = await runRound({boards,
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read,
      search: answers(hit(OFFER), hit('https://vacancies.example/offers/other-flutter-role')),
      call: call(),
      queries: ['flutter'],
      fetchLimit: 1
    });

    assert.equal(report.fetched, 1);
    assert.equal(report.added, 2);

    // The one not read is a candidate, so the next round starts from it rather
    // than rediscovering and re-ranking it from scratch.
    const waiting = store.recent(10).filter((offer) => offer.processing === 'candidate');
    assert.equal(waiting.length, 1);
  } finally {
    s.dispose();
  }
});

test('a board whose terms refuse automation is recorded and never read', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const read = readerOver({});

    const report = await runRound({boards,
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read,
      search: answers(hit('https://www.manual.example/jobs/view/123456789')),
      call: call(),
      queries: ['flutter']
    });

    assert.equal(report.refused, 1);
    assert.equal(report.unreadable, 1);
    assert.deepEqual(read.reads, []);
    assert.equal(store.recent(10)[0]?.processing, 'unreadable');
  } finally {
    s.dispose();
  }
});

test('a posting read but not extracted is left for the next round to finish', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const read = readerOver({ [OFFER]: POSTING });

    const failing = await runRound({boards,
      store,
      cv: cv(),
      preferences: wants(),
      analyse: async () => {
        throw new Error('the provider is rate limiting');
      },
      read,
      search: answers(hit(OFFER)),
      call: call(),
      queries: ['flutter']
    });

    assert.equal(failing.rated, 0);
    const stranded = store.recent(10)[0]!;
    assert.equal(stranded.processing, 'fetched');
    assert.equal(stranded.text, POSTING);

    // The second round finishes it with a model call and no request to the
    // board. An earlier version read `fetched` as finished and left these
    // stranded forever: read, unscored, never looked at again.
    const finishing = await runRound({boards,
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read,
      search: answers(hit(OFFER)),
      call: call(),
      queries: ['flutter']
    });

    assert.equal(finishing.fetched, 1);
    assert.equal(finishing.requested, 0);
    assert.equal(finishing.rated, 1);
    assert.deepEqual(read.reads, [OFFER]);
    assert.equal(store.recent(10)[0]?.processing, 'rated');
  } finally {
    s.dispose();
  }
});

test('an offer the user dismissed is not re-read, and stays dismissed', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const read = readerOver({ [OFFER]: POSTING });
    const options = {
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read,
      search: answers(hit(OFFER)),
      queries: ['flutter']
    };

    await runRound({boards, ...options, call: call() });
    const id = store.recent(10)[0]!.id;
    store.setDisposition(id, 'dismissed');

    const second = await runRound({boards, ...options, call: call() });

    assert.equal(second.fetched, 0);
    assert.equal(read.reads.length, 1);
    assert.equal(store.get(id)?.disposition, 'dismissed');
    // Seen again, and said so. That is the whole reason `sight` refuses to
    // write the disposition column.
    assert.equal(store.get(id)!.lastSeenAt >= store.get(id)!.firstSeenAt, true);
  } finally {
    s.dispose();
  }
});

test('a rated offer seen again costs nothing but a re-score', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const read = readerOver({ [OFFER]: POSTING });
    const options = {
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read,
      search: answers(hit(OFFER)),
      queries: ['flutter']
    };

    await runRound({boards, ...options, call: call() });
    const second = await runRound({boards, ...options, call: call() });

    assert.equal(second.fetched, 0);
    assert.equal(second.discovered, 0);
    assert.equal(second.saturated, true);
    assert.equal(read.reads.length, 1);
  } finally {
    s.dispose();
  }
});

test('the audit trail survives a round that only re-saw the offer', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const read = readerOver({ [OFFER]: POSTING });
    const options = {
      store,
      cv: cv(),
      preferences: wants(),
      read,
      search: answers(hit(OFFER)),
      queries: ['flutter']
    };

    await runRound({boards,
      ...options,
      call: call(),
      analyse: async () => ({ ...(await extracts()), salary: '40 000 PLN / mies.' })
    });
    const second = await runRound({boards, ...options, call: call(), analyse: extracts });

    // The second round re-checked nothing. Defaulting to an empty list here
    // erased the audit trail on the strength of not having looked.
    assert.deepEqual(second.scored[0]?.unverified, ['salary']);
  } finally {
    s.dispose();
  }
});

test('finding nothing at all is not saturation', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);

    const report = await runRound({boards,
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read: readerOver({}),
      search: answers(),
      call: call(),
      queries: ['flutter']
    });

    assert.equal(report.hits, 0);
    // A round that got no results has established that this engine answered
    // with nothing, not that the market is exhausted. Reading it as saturation
    // stops the loop on round one and reports the run as complete.
    assert.equal(report.saturated, false);
  } finally {
    s.dispose();
  }
});

test('a search that cannot run at all is reported once per query it owed', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    let asked = 0;

    const report = await runRound({boards,
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read: readerOver({}),
      search: async () => {
        asked++;
        return { status: 'unavailable', detail: 'no engine is configured' };
      },
      call: call(),
      queries: ['a', 'b', 'c']
    });

    // Asked once: every remaining query would fail identically.
    assert.equal(asked, 1);
    assert.equal(report.searchFailures.length, 3);
    assert.ok(report.searchFailures[2]?.startsWith('c: '));
  } finally {
    s.dispose();
  }
});

test('the same job on two boards is reported, never merged', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const elsewhere = 'https://html.example/job/senior-flutter-developer-kowalski-krakow';
    const read = readerOver({ [OFFER]: POSTING, [elsewhere]: POSTING });
    const options = {
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read,
      call: call(),
      queries: ['flutter']
    };

    await runRound({boards, ...options, search: answers(hit(OFFER)) });
    const second = await runRound({boards,
      ...options,
      call: call(),
      search: answers(hit(elsewhere))
    });

    assert.equal(second.duplicates.length, 1);
    // Both rows survive. Collapsing them needs a column saying which absorbed
    // which, and inventing one to make a round tidier is the wrong order.
    assert.equal(store.recent(10).length, 2);
  } finally {
    s.dispose();
  }
});

test('a near-miss title is not called a repost', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    const junior = 'https://html.example/job/junior-flutter-developer-kowalski';
    const read = readerOver({ [OFFER]: POSTING, [junior]: POSTING });
    const options = { store, cv: cv(), preferences: wants(), read, queries: ['flutter'] };

    await runRound({boards, ...options, call: call(), analyse: extracts, search: answers(hit(OFFER)) });
    const second = await runRound({boards,
      ...options,
      call: call(),
      analyse: async () => ({ ...(await extracts()), position: 'Flutter Developer' }),
      search: answers(hit(junior))
    });

    // The full-text index matches every record carrying these terms, so
    // "Flutter Developer" comes back for "Senior Flutter Developer". Identity
    // is exact; the index only narrows the search.
    assert.deepEqual(second.duplicates, []);
  } finally {
    s.dispose();
  }
});

test('rounds stop once a round finds nothing new', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);

    const reports = await runRounds({boards,
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read: readerOver({ [OFFER]: POSTING }),
      search: answers(hit(OFFER)),
      call: call(),
      queries: ['flutter'],
      rounds: 5
    });

    assert.equal(reports.length, 2);
    assert.equal(reports[1]?.saturated, true);
  } finally {
    s.dispose();
  }
});

test('rounds stop when every query failed, which proves nothing about the market', async () => {
  const s = scratch();
  try {
    const store = createOfferStore(s.db);
    let asked = 0;

    const reports = await runRounds({boards,
      store,
      cv: cv(),
      preferences: wants(),
      analyse: extracts,
      read: readerOver({}),
      search: async () => {
        asked++;
        return { status: 'failed', detail: 'rate limited' };
      },
      call: call(),
      queries: ['flutter'],
      rounds: 5
    });

    assert.equal(reports.length, 1);
    assert.equal(asked, 1);
  } finally {
    s.dispose();
  }
});

/* ------------------------------------------------------------ board search */

const listing = (url: string): Listing => ({
  board: 'vacancies',
  url,
  title: 'Senior Flutter Developer'
});

const listerOver = (
  answer: (board: string) => SiteOutcome<readonly Listing[]>
): SiteReader => ({
  integrationSources:async()=>boards,
  async listBoard({ board }) {
    return answer(board);
  },
  async readPage() {
    throw new Error('not used');
  },
  async readCompany() {
    throw new Error('not used');
  }
});

test('board search asks every board it can and pools the rows', async () => {
  const asked: string[] = [];
  const source = boardSearch(
    listerOver((board) => {
      asked.push(board);
      return { status: 'ok', data: [listing(`https://${board}.example/a`)] };
    })
  );

  const outcome = await source('flutter', { limit: 10, call: call() });

  assert.equal(outcome.status, 'ok');
  assert.ok(asked.length >= 2, `expected several boards, asked ${JSON.stringify(asked)}`);
  assert.equal(outcome.status === 'ok' ? outcome.hits.length : 0, asked.length);
});

test('a scraper that is not running is unavailable, not a market with no jobs', async () => {
  const source = boardSearch(
    listerOver(() => ({ status: 'unavailable', detail: 'connection refused' }))
  );

  const outcome = await source('flutter', { limit: 10, call: call() });

  // The distinction the round acts on: `unavailable` stops it asking, and says
  // to a person that something needs starting. `failed` would read as a fact
  // about the market.
  assert.equal(outcome.status, 'unavailable');
});

test('one board answering nothing is an answer, not a failure', async () => {
  let first = true;
  const source = boardSearch(
    listerOver(() => {
      if (first) {
        first = false;
        return { status: 'failed', detail: 'the board changed its markup' };
      }
      return { status: 'ok', data: [] };
    })
  );

  const outcome = await source('flutter', { limit: 10, call: call() });

  assert.equal(outcome.status, 'ok');
  assert.equal(outcome.status === 'ok' ? outcome.hits.length : -1, 0);
});
