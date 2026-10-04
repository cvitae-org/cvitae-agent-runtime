/**
 * The sink a chat run says what it was given through, and the two ports that say
 * what was read.
 *
 * A run's record is only as good as the three channels that feed it, and each of
 * them is a place where a quiet slip leaves a record that looks complete and is
 * not: an entry that never reaches the store, one that reaches it twice, one that
 * claims more than was sent, a field that is silently dropped because nobody
 * knew what it was. These tests run the real sink over a store that keeps what it
 * is given, says what it was asked, and can be made to fail, so every one of
 * those can be seen. What the record means for a whole run, and that it agrees
 * with what a model was sent, is `grounding-record.test.ts`.
 *
 * Digests are taken from literals in this file. The stored CV here is not the
 * document it parses to (parsing fills in defaults), so a read that digested the
 * stored body in place of the document has nothing to agree with.
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 67 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * which wells a sink is bound to:
 *   the conversation is not a scope                1
 *   the CV is scoped to the conversation           3
 *   the CV is scoped without a context             3
 *   an offer is scoped to the conversation         1
 *   an offer is scoped without an offer            1
 *
 * reading the record:
 *   the record is read when the sink is made       2
 *   the record is read on every use                1
 *   another run's record is read                   1
 *   what the store holds is forgotten              5
 *   an unreadable record is an empty one           2
 *   a run with no record fails                     1
 *
 * writing it:
 *   repeats are written again                      5
 *   everything is written again                    4
 *   the newest entries are written first           3
 *   nothing new is still written                   4
 *   entries are written to another run             3
 *   a failed use keeps its book                    3
 *   a failed use starts from nothing               1
 *   a failed use is swallowed                      5
 *
 * what a step sends:
 *   the history is the server's                    1
 *   the summary is the server's                    2
 *   a posting a chat was handed is the server's    2
 *   a posting of a saved offer is the client's     1
 *   the history is addressed as the summary        2
 *   the summary is addressed as the history        3
 *   a posting a chat was handed is addressed as the history 2
 *   a posting of a saved offer is addressed as attached 2
 *   an empty history is sent                       1
 *   a history that is not a list is sent           1
 *   a blank summary is sent                        1
 *   a summary that is not text is sent             1
 *   a blank posting is sent                        1
 *   a posting that is not text is sent             1
 *   the digest is of what was shown                1
 *   what was shown is stored as it is              2
 *   what was shown is not recorded                 1
 *   what was shown is the whole                    1
 *   a field nothing addresses is ignored           1
 *   a field nothing addresses is addressed by its name 1
 *   a field is said to come by another channel     5
 *   a field is said to be only read                5
 *   the fields of one call are written in reverse  1
 *   a call that fails writes its first half        2
 *
 * the documents port:
 *   a read hands back nothing                      3
 *   a read asks for another document               2
 *   any document is recorded as a CV               1
 *   a body that does not parse is recorded         1
 *   a read is recorded without a scope             1
 *   a read is recorded as included                 1
 *   a read is recorded by another channel          1
 *   a read is recorded at another revision         2
 *   a read is recorded as the stored body          2
 *   an update is dropped                           1
 *   an update loses its options                    1
 *
 * the retrieval port:
 *   a search returns nothing                       3
 *   a search is made of another query              1
 *   a search is made without the signal            1
 *   a search that fails is an empty one            1
 *   the document is read though nothing was found  1
 *   the document is read with no scope             1
 *   the document is read by another id             1
 *   a document of another kind is searched into    1
 *   a body that does not parse is searched into    1
 *   a passage is recorded as included              1
 *   a passage is recorded as shown                 1
 *   a passage is recorded by another channel       1
 *   a passage is recorded at another revision      1
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationError } from '../src/contracts/index.js';
import type {
  ChunkHit,
  DocumentRecord,
  DocumentStore,
  GroundingRecord,
  RecordEntry,
  RecordSink,
  RecordStore,
  Retriever
} from '../src/contracts/index.js';
import { digest } from '../src/grounding/index.js';
import { createRecorder, defaultWells, recordingDocuments, recordingRetrieval } from '../src/runtime/grounding.js';
import type { RecorderFacts } from '../src/runtime/grounding.js';

/* ---------------------------------------------------------------- fixtures */

const RUN = 'run-1';
const CHAT = 'chat-1';
const CTX = 'ctx-1';
const OFFER = 'offer-1';

/** The CV as the parsed, normalised document holds it, every default written out. */
const CV = {
  version: 1,
  personal: { name: '', email: '', phone: '', location: '', links: {} },
  role_description: '',
  skills: { role: '', groups: [], programming_languages: [], frameworks: [], libraries_and_tools: [] },
  experience: [
    { company: 'Acme', title: 'Engineer', started: '', finished: '', highlights: ['Built things.'], skills: [] },
    { company: 'Globex', title: 'Analyst', started: '', finished: '', highlights: ['Wrote reports.'], skills: [] }
  ],
  education: [],
  certificates: [],
  languages: [],
  sources: []
};

/** The same CV as it is stored: what was written, and none of what parsing adds. */
const STORED = {
  version: 1,
  experience: [
    { company: 'Acme', title: 'Engineer', highlights: ['Built things.'] },
    { company: 'Globex', title: 'Analyst', highlights: ['Wrote reports.'] }
  ]
};

const cvRecord = (revision: number, body: Record<string, unknown> = STORED, kind = 'cv'): DocumentRecord => ({
  id: 'cv',
  kind,
  revision,
  body,
  createdAt: 1,
  updatedAt: 2
});

/** An entry the CV well accepts, distinguished by `key`. */
const piece = (key: string, over: Partial<RecordEntry> = {}): RecordEntry => ({
  ref: `cv:${CTX}/experience/${key}`,
  version: '3',
  digest: digest(key),
  status: 'included',
  origin: 'server',
  via: 'tool:read_cv',
  ...over
});

/** A store that keeps what it is given, says what it was asked, and can be made to fail. */
const fakeStore = (held: RecordEntry[] = []) => {
  const seen = {
    appends: [] as { runId: string; entries: RecordEntry[] }[],
    reads: [] as string[],
    failNextAppend: false,
    failReads: false,
    hasRecord: true
  };

  const records: RecordStore = {
    append: (runId, entries) => {
      seen.appends.push({ runId, entries: [...entries] });
      if (seen.failNextAppend) {
        seen.failNextAppend = false;
        throw new Error('the disk is full');
      }
      held.push(...entries);
      return entries.length;
    },
    read: (runId) => {
      seen.reads.push(runId);
      if (seen.failReads) throw new Error('the file is gone');
      if (!seen.hasRecord) return undefined;
      const record: GroundingRecord = {
        v: 1,
        runId,
        conversationId: CHAT,
        state: 'open',
        openedAt: 1,
        entries: [...held]
      };
      return record;
    }
  };

  return { records, held, seen };
};

type Store = ReturnType<typeof fakeStore>;

const sinkOf = (store: Store, facts: Omit<RecorderFacts, 'runId' | 'conversationId'>): RecordSink =>
  createRecorder({ records: store.records, wells: defaultWells() }, { runId: RUN, conversationId: CHAT, ...facts });

/** A live chat run: a conversation and a CV context. */
const live = (store: Store, input: Record<string, unknown> = {}): RecordSink =>
  sinkOf(store, { contextId: CTX, input });

/** A snapshot run: the same, about a saved offer. */
const snapshot = (store: Store, input: Record<string, unknown> = {}): RecordSink =>
  sinkOf(store, { contextId: CTX, offerId: OFFER, input });

/** A run bound to nothing but its conversation. */
const bare = (store: Store, input: Record<string, unknown> = {}): RecordSink => sinkOf(store, { input });

/** Documents by id, saying which ids were asked for and what an update was given. */
const fakeDocuments = (documents: Record<string, DocumentRecord | undefined>) => {
  const seen = { reads: [] as string[], updates: [] as unknown[][] };
  const updated = cvRecord(9);
  const mutate = (): Record<string, unknown> => ({});
  const port: DocumentStore = {
    read: (id) => {
      seen.reads.push(id);
      return documents[id];
    },
    update: (...args) => {
      seen.updates.push(args);
      return updated;
    }
  };
  return { port, documents, seen, updated, mutate };
};

const hit = (text: string, meta: Record<string, unknown>): ChunkHit => ({
  id: `chunk-${text}`,
  documentId: 'cv',
  kind: 'highlight',
  text,
  position: 0,
  meta,
  score: 1,
  sourceRevision: 3,
  found: ['lexical']
});

const inEntry = (entry: number, company: string, title: string) => ({ section: 'experience', entry, company, title });

/** A retrieval port that answers with `hits`, saying what it was asked. */
const fakeRetrieval = (hits: ChunkHit[]) => {
  const seen = { asked: [] as { query: unknown; signal: AbortSignal }[], fail: false };
  const port: Retriever = {
    search: async (query, signal) => {
      seen.asked.push({ query, signal });
      if (seen.fail) throw new Error('the index is offline');
      return hits;
    }
  };
  return { port, seen };
};

const SIGNAL = new AbortController().signal;
const QUERY = { text: 'billing', limit: 3 } as const;

/* ----------------------------------------------------------------- the sink */

test('the stored CV in these tests is not the document it parses to, so a digest says which one was read', () => {
  assert.notEqual(digest(STORED), digest(CV));
});

test('a sink names the scope of each well its run is bound to, and no other', () => {
  const store = fakeStore();

  assert.deepEqual(bare(store).scopes, { conversation: CHAT });
  assert.deepEqual(live(store).scopes, { conversation: CHAT, cv: CTX });
  assert.deepEqual(snapshot(store).scopes, { conversation: CHAT, cv: CTX, offers: OFFER });
  assert.deepEqual(sinkOf(store, { offerId: OFFER, input: {} }).scopes, { conversation: CHAT, offers: OFFER });
});

test('making a sink touches nothing, so a store that is down fails the first use and not the start of the run', () => {
  const store = fakeStore();
  store.seen.failReads = true;

  const sink = live(store);

  assert.deepEqual(store.seen.reads, []);
  assert.deepEqual(store.seen.appends, []);
  assert.throws(() => sink.add([piece('a')]), /the file is gone/);
});

test('the record is read once, for the run it belongs to, however much is said', () => {
  const store = fakeStore();
  const sink = live(store);

  sink.add([piece('a')]);
  sink.add([piece('b')]);
  sink.add([piece('a'), piece('c')]);

  assert.deepEqual(store.seen.reads, [RUN]);
});

test('a run the store has no record of starts from nothing', () => {
  const store = fakeStore();
  store.seen.hasRecord = false;

  live(store).add([piece('a')]);

  assert.deepEqual(store.held, [piece('a')]);
});

test('what the store already holds, from before a pause, is not written again', () => {
  const store = fakeStore([piece('a')]);
  const sink = live(store);

  sink.add([piece('a')]);
  assert.deepEqual(store.seen.appends, []);

  sink.add([piece('a'), piece('b')]);
  assert.deepEqual(store.seen.appends, [{ runId: RUN, entries: [piece('b')] }]);
  assert.deepEqual(store.held, [piece('a'), piece('b')]);
});

test('entries are written in the order they were given, once each, to the run that said them', () => {
  const store = fakeStore();
  const sink = live(store);

  sink.add([piece('a'), piece('b'), piece('a')]);
  sink.add([piece('b'), piece('c')]);
  sink.add([piece('a'), piece('b'), piece('c')]);

  assert.deepEqual(store.seen.appends, [
    { runId: RUN, entries: [piece('a'), piece('b')] },
    { runId: RUN, entries: [piece('c')] }
  ]);
  assert.deepEqual(store.held, [piece('a'), piece('b'), piece('c')]);
});

test('saying nothing writes nothing', () => {
  const store = fakeStore();

  live(store).add([]);

  assert.deepEqual(store.seen.appends, []);
});

test('the same piece reached another way is another entry, and so is the same way at another version', () => {
  const store = fakeStore();
  const sink = live(store);

  sink.add([piece('a'), piece('a', { via: 'port:documents' }), piece('a', { version: '4' }), piece('a', { status: 'read' })]);

  assert.equal(store.held.length, 4);
});

test('an entry no well can place is refused, and nothing said in the same breath is written', () => {
  const store = fakeStore();
  const sink = live(store);

  assert.throws(
    () => sink.add([piece('a'), piece('b', { ref: 'tickets:7/open' })]),
    (error) => error instanceof OperationError && error.code === 'unknown_well'
  );
  assert.deepEqual(store.seen.appends, []);

  // The refused call leaves no trace in the sink either: the piece that was fine is still new.
  sink.add([piece('a')]);
  assert.deepEqual(store.held, [piece('a')]);
});

test('a store that will not write fails the call, and the same call made again is recorded', () => {
  const store = fakeStore();
  const sink = live(store);

  store.seen.failNextAppend = true;
  assert.throws(() => sink.add([piece('a')]), /the disk is full/);
  assert.deepEqual(store.held, []);

  sink.add([piece('a')]);
  assert.deepEqual(store.held, [piece('a')]);
});

test('after a failed write the sink starts again from what the store holds, and not from nothing', () => {
  const store = fakeStore();
  const sink = live(store);

  sink.add([piece('a')]);
  store.seen.failNextAppend = true;
  assert.throws(() => sink.add([piece('b')]), /the disk is full/);

  sink.add([piece('a'), piece('b')]);

  const last = store.seen.appends[store.seen.appends.length - 1];
  assert.deepEqual(last, { runId: RUN, entries: [piece('b')] });
  assert.deepEqual(store.held, [piece('a'), piece('b')]);
});

test('a store that cannot be read fails the use, and works once it can', () => {
  const store = fakeStore();
  const sink = live(store);

  store.seen.failReads = true;
  assert.throws(() => sink.add([piece('a')]), /the file is gone/);
  assert.deepEqual(store.seen.appends, []);

  store.seen.failReads = false;
  sink.add([piece('a')]);
  assert.deepEqual(store.held, [piece('a')]);
});

/* ------------------------------------------------------ what a step sends */

const HISTORY = [
  { role: 'user', text: 'What did I do at Acme?' },
  { role: 'assistant', text: 'You built things.' }
];
const SUMMARY = 'We have been talking about billing.';
const POSTING = 'We are hiring a staff engineer to own billing.';

test('a step that sends the history says so, as the host\'s words and as a whole', () => {
  const store = fakeStore();

  live(store, { history: HISTORY }).sent([{ field: 'history' }]);

  assert.deepEqual(store.held, [
    { ref: 'conversation:chat-1/history', digest: digest(HISTORY), status: 'included', origin: 'client', via: 'input' }
  ]);
});

test('a step that sends the summary says so, as the host\'s words', () => {
  const store = fakeStore();

  live(store, { summary: SUMMARY }).sent([{ field: 'summary' }]);

  assert.deepEqual(store.held, [
    { ref: 'conversation:chat-1/summary', digest: digest(SUMMARY), status: 'included', origin: 'client', via: 'input' }
  ]);
});

test('a posting a chat was handed is the host\'s, and a posting of a saved offer is the runtime\'s', () => {
  const given = fakeStore();
  const saved = fakeStore();

  live(given, { offerText: POSTING }).sent([{ field: 'offerText' }]);
  snapshot(saved, { offerText: POSTING }).sent([{ field: 'offerText' }]);

  assert.deepEqual(given.held, [
    { ref: 'conversation:chat-1/attached', digest: digest(POSTING), status: 'included', origin: 'client', via: 'input' }
  ]);
  assert.deepEqual(saved.held, [
    { ref: 'offers:offer-1/posting', digest: digest(POSTING), status: 'included', origin: 'server', via: 'input' }
  ]);
});

test('a field with nothing in it sends nothing', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['history', {}],
    ['history', { history: [] }],
    ['history', { history: 'earlier' }],
    ['summary', {}],
    ['summary', { summary: '' }],
    ['summary', { summary: ' \n\t ' }],
    ['summary', { summary: 42 }],
    ['offerText', {}],
    ['offerText', { offerText: '' }],
    ['offerText', { offerText: '  ' }],
    ['offerText', { offerText: 42 }]
  ];

  for (const [field, input] of cases) {
    for (const make of [live, snapshot]) {
      const store = fakeStore();
      make(store, input).sent([{ field }]);
      assert.deepEqual(store.seen.appends, [], `${field} ${JSON.stringify(input)}`);
    }
  }
});

test('the digest is of the field as it was sent, and what the model was shown of it is a second digest and never the text', () => {
  const store = fakeStore();
  const shown = 'We are hiring a staff engineer';

  live(store, { offerText: POSTING }).sent([{ field: 'offerText', shown }]);

  assert.deepEqual(store.held, [
    {
      ref: 'conversation:chat-1/attached',
      digest: digest(POSTING),
      shown: digest(shown),
      status: 'included',
      origin: 'client',
      via: 'input'
    }
  ]);
  const written = JSON.stringify(store.seen.appends);
  assert.ok(!written.includes(shown), 'the text that was shown is not in what was written');
  assert.ok(!written.includes('billing'), 'nor is any other part of the field');
});

test('a field shown whole is said to be shown whole, with nothing extra recorded', () => {
  const store = fakeStore();

  live(store, { summary: SUMMARY }).sent([{ field: 'summary', shown: SUMMARY }]);

  assert.deepEqual(store.held, [
    { ref: 'conversation:chat-1/summary', digest: digest(SUMMARY), status: 'included', origin: 'client', via: 'input' }
  ]);
});

test('every field of one call is written together, in the order the step listed them', () => {
  const store = fakeStore();

  snapshot(store, { history: HISTORY, summary: SUMMARY, offerText: POSTING }).sent([
    { field: 'history' },
    { field: 'summary' },
    { field: 'offerText' }
  ]);

  assert.equal(store.seen.appends.length, 1);
  assert.deepEqual(
    store.held.map((entry) => entry.ref),
    ['conversation:chat-1/history', 'conversation:chat-1/summary', 'offers:offer-1/posting']
  );
});

test('a field nothing says what it addresses fails the call, and nothing else in the call is written', () => {
  const store = fakeStore();
  const sink = live(store, { history: HISTORY, cv: 'Ada' });

  assert.throws(
    () => sink.sent([{ field: 'history' }, { field: 'cv' }]),
    (error) => error instanceof OperationError && error.code === 'invalid_entry' && /"cv"/.test(error.message)
  );
  assert.deepEqual(store.seen.appends, []);
});

/* --------------------------------------------------- the documents port */

test('reading the CV through the port records the whole CV as read, and hands back the very record', () => {
  const store = fakeStore();
  const inner = fakeDocuments({ cv: cvRecord(3) });

  const got = recordingDocuments(inner.port, live(store)).read('cv');

  assert.strictEqual(got, inner.documents.cv);
  assert.deepEqual(inner.seen.reads, ['cv']);
  assert.deepEqual(store.held, [
    { ref: 'cv:ctx-1', version: '3', digest: digest(CV), status: 'read', origin: 'server', via: 'port:documents' }
  ]);
});

test('the port asks for the document it was asked for', () => {
  const store = fakeStore();
  const inner = fakeDocuments({ photo: cvRecord(3, STORED, 'photo') });

  recordingDocuments(inner.port, live(store)).read('photo');

  assert.deepEqual(inner.seen.reads, ['photo']);
});

test('a second read of one revision is one entry, and a read of the next is another', () => {
  const store = fakeStore();
  const inner = fakeDocuments({ cv: cvRecord(3) });
  const documents = recordingDocuments(inner.port, live(store));

  documents.read('cv');
  documents.read('cv');
  assert.equal(store.held.length, 1);

  inner.documents.cv = cvRecord(4, { ...STORED, role_description: 'Now a lead.' });
  documents.read('cv');

  assert.deepEqual(
    store.held.map((entry) => [entry.version, entry.digest]),
    [
      ['3', digest(CV)],
      ['4', digest({ ...CV, role_description: 'Now a lead.' })]
    ]
  );
});

test('a document that is not a CV, or is not one that parses, or is not there, records nothing and comes back as it was', () => {
  const store = fakeStore();
  const inner = fakeDocuments({
    photo: cvRecord(3, STORED, 'photo'),
    future: cvRecord(3, { version: 2 }),
    broken: cvRecord(3, { experience: 'Acme' })
  });
  const documents = recordingDocuments(inner.port, live(store));

  for (const id of ['photo', 'future', 'broken', 'nothing']) {
    assert.strictEqual(documents.read(id), inner.documents[id], id);
  }
  assert.deepEqual(store.seen.appends, []);
});

test('a run bound to no CV records no read of one', () => {
  const store = fakeStore();
  const inner = fakeDocuments({ cv: cvRecord(3) });

  const got = recordingDocuments(inner.port, bare(store)).read('cv');

  assert.strictEqual(got, inner.documents.cv);
  assert.deepEqual(store.seen.appends, []);
});

test('an update goes through as it came, and is not a read', () => {
  const store = fakeStore();
  const inner = fakeDocuments({ cv: cvRecord(3) });
  const options = { expectedRevision: 3 };

  const got = recordingDocuments(inner.port, live(store)).update('cv', 'cv', inner.mutate, options);

  assert.strictEqual(got, inner.updated);
  assert.equal(inner.seen.updates.length, 1);
  const [id, kind, mutate, given] = inner.seen.updates[0] ?? [];
  assert.equal(id, 'cv');
  assert.equal(kind, 'cv');
  assert.strictEqual(mutate, inner.mutate);
  assert.strictEqual(given, options);
  assert.deepEqual(store.seen.appends, []);
});

/* ---------------------------------------------------------- the retrieval port */

test('a search records each passage it returns as read, in the piece it came from, and returns the very same hits', async () => {
  const store = fakeStore();
  const inner = fakeDocuments({ cv: cvRecord(3) });
  const hits = [
    hit('Built things.', inEntry(0, 'Acme', 'Engineer')),
    hit('Wrote reports.', inEntry(1, 'Globex', 'Analyst')),
    hit('Something that moved.', inEntry(0, 'Initech', 'Engineer'))
  ];
  const search = fakeRetrieval(hits);

  const got = await recordingRetrieval(search.port, inner.port, live(store)).search(QUERY, SIGNAL);

  assert.strictEqual(got, hits);
  assert.equal(search.seen.asked.length, 1);
  assert.deepEqual(search.seen.asked[0]?.query, QUERY);
  assert.strictEqual(search.seen.asked[0]?.signal, SIGNAL);
  assert.deepEqual(inner.seen.reads, ['cv']);
  assert.deepEqual(store.held, [
    {
      ref: 'cv:ctx-1/experience/acme~engineer',
      version: '3',
      digest: digest(CV.experience[0]),
      status: 'read',
      origin: 'server',
      via: 'port:retrieval'
    },
    {
      ref: 'cv:ctx-1/experience/globex~analyst',
      version: '3',
      digest: digest(CV.experience[1]),
      status: 'read',
      origin: 'server',
      via: 'port:retrieval'
    },
    { ref: 'cv:ctx-1', version: '3', digest: digest(CV), status: 'read', origin: 'server', via: 'port:retrieval' }
  ]);
});

test('a search that finds nothing records nothing, and does not go and read the document', async () => {
  const store = fakeStore();
  const inner = fakeDocuments({ cv: cvRecord(3) });
  const search = fakeRetrieval([]);

  const got = await recordingRetrieval(search.port, inner.port, live(store)).search(QUERY, SIGNAL);

  assert.deepEqual(got, []);
  assert.deepEqual(inner.seen.reads, []);
  assert.deepEqual(store.seen.appends, []);
});

test('a search with no CV to place its passages in records nothing, and still returns what it found', async () => {
  const hits = [hit('Built things.', inEntry(0, 'Acme', 'Engineer'))];
  const cases: Record<string, DocumentRecord | undefined> = {
    missing: undefined,
    photo: cvRecord(3, STORED, 'photo'),
    future: cvRecord(3, { version: 2 })
  };

  for (const [name, found] of Object.entries(cases)) {
    const store = fakeStore();
    const inner = fakeDocuments({ cv: found });

    const got = await recordingRetrieval(fakeRetrieval(hits).port, inner.port, live(store)).search(QUERY, SIGNAL);

    assert.strictEqual(got, hits, name);
    assert.deepEqual(store.seen.appends, [], name);
  }
});

test('a run bound to no CV records no search, and does not read the document either', async () => {
  const store = fakeStore();
  const inner = fakeDocuments({ cv: cvRecord(3) });
  const hits = [hit('Built things.', inEntry(0, 'Acme', 'Engineer'))];

  const got = await recordingRetrieval(fakeRetrieval(hits).port, inner.port, bare(store)).search(QUERY, SIGNAL);

  assert.strictEqual(got, hits);
  assert.deepEqual(inner.seen.reads, []);
  assert.deepEqual(store.seen.appends, []);
});

test('a search that fails fails the same way, and records nothing', async () => {
  const store = fakeStore();
  const inner = fakeDocuments({ cv: cvRecord(3) });
  const search = fakeRetrieval([hit('Built things.', inEntry(0, 'Acme', 'Engineer'))]);
  search.seen.fail = true;

  await assert.rejects(recordingRetrieval(search.port, inner.port, live(store)).search(QUERY, SIGNAL), /the index is offline/);

  assert.deepEqual(store.seen.appends, []);
});
