/**
 * A chat run's record, from the message to the end of the run, against what the
 * model was actually handed.
 *
 * The engine, the store, the wells and the recorder each have a file of their
 * own, and each can pass while the whole is wrong: a step that forgets to say a
 * field, a tool that reports the piece it meant to return and not the piece it
 * did, a store that fails and a run that carries on. This file asks what a reader
 * of a record is asking, which is whether the model saw what the record says.
 *
 * So the gateway here is a spy. It is handed every request the real `ask_profile`
 * makes, drives the real tools, and keeps what each of them returned. The
 * expected record is worked out from that: the digest of a piece comes from the
 * literal CV in this file, and the digest of what the model saw of it from what
 * the spy was given. Nothing here digests what the code under test reported.
 *
 * In the order of the tests:
 *
 *   what a message brings   the history and the summary come from the host and
 *                           say so; a posting is the server's when a snapshot
 *                           supplied it and the host's when it was attached
 *   what the tools hand     pieces, and what was kept of them; a passage the tool
 *                           cut was read and not handed over; asking twice says
 *                           it once
 *   what a record may not   fail open: a store that will not write, a field
 *                           nothing names, a tool that cannot say what it hands
 *                           over
 *   how a run ends          succeeded, failed, cancelled, parked and resumed, and
 *                           a process that died; a write that comes late is
 *                           dropped
 *   what it leaves alone    no conversation, no sink; no grounding, an empty
 *                           record; the payloads a model gets are the same with
 *                           and without it
 *   the production runtime  wires it, for a live run and for a snapshot run
 *
 * One thing is not covered and is not meant to be: the call that chooses the
 * tools sends the user's own last words and the question, never the CV or a
 * posting, and one test below holds it to that.
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * (table filled in after the run)
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { capabilities } from '../src/capabilities/index.js';
import { CV_ID, CV_KIND } from '../src/capabilities/cv/document.js';
import { cvOf } from '../src/capabilities/cv/well.js';
import { RECORD_VERSION, isRunSuspension } from '../src/contracts/index.js';
import type {
  AiGateway,
  CapabilityMap,
  ChunkHit,
  RecordEntry,
  RecordStore,
  Retriever,
  Step,
  ToolLoopRequest
} from '../src/contracts/index.js';
import { digest } from '../src/grounding/index.js';
import { createHarness } from '../src/runtime/create.js';
import { bindCvScope } from '../src/runtime/cv-scope.js';
import { defaultWells } from '../src/runtime/grounding.js';
import { recoverInterruptedRuns } from '../src/runtime/recover.js';
import { resumeRun } from '../src/runtime/resume.js';
import { beginRun } from '../src/runtime/run.js';
import type { RunHandle, RunRequest, RuntimeDeps } from '../src/runtime/run.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createRecordStore } from '../src/storage/sqlite/grounding-record.js';
import { defaultTools } from '../src/tools/index.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { scratch } from './support/db.js';
import type { Scratch } from './support/db.js';
import { noop, spine, stage, transform, untilAborted } from './support/spine.js';
import type { Spine } from './support/spine.js';

/* ---------------------------------------------------------------- fixtures */

const CONTEXT = 'ctx';
const CHAT = 'chat';
const OFFER = 'offer-1';
const OFFER_CHAT = 'offer-chat';
const SNAPSHOT = 'snap-1';

/** Longer than one `read_cv` page has room for, so the tool keeps part of it. */
const LONG = 'Halved p99 latency. '.repeat(400);

const SKILLS = {
  role: 'Engineer',
  groups: [
    { label: 'Languages', items: ['TypeScript', 'Go'] },
    { label: 'Frameworks', items: ['React'] },
    { label: 'Libraries & Tools', items: ['Postgres'] }
  ],
  programming_languages: ['TypeScript', 'Go'],
  frameworks: ['React'],
  libraries_and_tools: ['Postgres']
};

/**
 * The stored CV, written in the shape the document parses to. The digests below
 * are taken from these literals, so they only mean something while parsing
 * changes nothing, which the guard underneath checks.
 */
const BODY = {
  version: 1,
  personal: { name: 'Ada Example', email: 'ada@example.com', phone: '', location: 'Krakow', links: {} },
  role_description: 'Backend engineer focused on billing systems.',
  skills: SKILLS,
  experience: [
    {
      company: 'Acme',
      title: 'Senior Engineer',
      started: '2021',
      finished: null,
      highlights: ['Rewrote the billing pipeline.', LONG],
      skills: ['Go']
    },
    {
      company: 'Globex',
      title: 'Engineer',
      started: '2018',
      finished: '2021',
      highlights: ['Built the design system.'],
      skills: []
    },
    {
      company: 'Acme',
      title: 'Senior Engineer',
      started: '2016',
      finished: '2018',
      highlights: ['An earlier stint.'],
      skills: []
    }
  ],
  education: [{ university: 'MIT', degree: 'BSc Computer Science', started: '2012', finished: '2016', thesis: '', mark: '' }],
  certificates: [{ name: 'AWS Solutions Architect', issuer: 'Amazon', started: '2020', finished: '' }],
  languages: [
    { name: 'Polish', level: 'native' },
    { name: 'English', level: 'C1' }
  ],
  sources: []
};

assert.deepEqual(cvOf(BODY), BODY, 'the fixture CV is in the shape the document parses to');

const HISTORY = [
  { role: 'user', text: 'What did I do at Acme?' },
  { role: 'assistant', text: 'You rewrote the billing pipeline.' }
];
const SUMMARY = 'The user is a backend engineer asking about billing work.';

const SHORT_POSTING = 'Senior Go engineer for a billing platform team.';
const LONG_POSTING = `Senior Go engineer. ${'Billing platform work. '.repeat(2_500)}`;

const SUMMARY_LABEL = 'EARLIER IN THIS CONVERSATION:\n';
const POSTING_LABEL = 'CAPTURED JOB POSTING — SOURCE DATA:\n';

/** What follows a label in text the model was given, up to the next blank line. */
const after = (text: string, label: string): string => {
  const start = text.indexOf(label);
  assert.ok(start >= 0, `the model was not given ${label.trim()}`);
  const rest = text.slice(start + label.length);
  const end = rest.indexOf('\n\n');
  return end < 0 ? rest : rest.slice(0, end);
};

const question = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  question: 'What did I do with billing?',
  ...over
});

const hit = (revision: number, position: number, text: string, meta: Record<string, unknown>): ChunkHit => ({
  id: `c${position}`,
  documentId: CONTEXT,
  kind: 'highlight',
  text,
  position,
  meta,
  score: 1,
  sourceRevision: revision,
  found: ['lexical']
});

/** Four passages: two placed in an entry, one in the description, one that belongs to no piece. */
const passages = (revision: number): ChunkHit[] => [
  hit(revision, 0, 'Rewrote the billing pipeline.', { section: 'experience', entry: 0, company: 'Acme', title: 'Senior Engineer' }),
  hit(revision, 1, 'Built the design system.', { section: 'experience', entry: 1, company: 'Globex', title: 'Engineer' }),
  hit(revision, 2, BODY.role_description, { section: 'role_description' }),
  hit(revision, 3, 'BSc Computer Science at MIT', { section: 'education' })
];

/* ----------------------------------------------------------------- runtime */

/** What a tool returned to the model, in the order the model asked. */
type Received = { readonly tool: string; readonly input: unknown; readonly result: unknown };
type Call = (tool: string, input: unknown) => Promise<unknown>;

type Options = {
  /** Capabilities that exist only in a test, next to the real ones. */
  readonly probes?: CapabilityMap;
  /** What the model does inside the tool loop. By default it answers at once. */
  readonly loop?: (request: ToolLoopRequest, call: Call) => Promise<string>;
  /** What the retriever finds, given the revision of the CV. */
  readonly hits?: (revision: number) => readonly ChunkHit[];
  /** The posting a snapshot supplies. */
  readonly posting?: string;
  /** `false` builds a runtime with nothing to keep records with. */
  readonly grounding?: boolean;
  /** Stands between the runtime and its record store. */
  readonly records?: (real: RecordStore) => RecordStore;
  /** Replaces parts of the gateway, for a test that drives a step of its own. */
  readonly ai?: Partial<AiGateway>;
  /** A database an earlier runtime already seeded, which is what a second process opens. */
  readonly on?: Scratch;
};

type Runtime = {
  readonly s: Spine;
  /** The real store, whatever stands between it and the runtime. */
  readonly records: RecordStore;
  /** Every request the model's tool loop was handed. */
  readonly loops: ToolLoopRequest[];
  /** What the call that chooses the tools was asked. */
  readonly goals: string[];
  readonly received: Received[];
  /** The revision of the stored CV, as a record states it. */
  readonly version: string;
  begin(input: Record<string, unknown>, over?: Omit<RunRequest, 'capability' | 'input'>, capability?: string): RunHandle;
  resume(runId: string): Promise<unknown>;
  dispose(): void;
};

const CHAT_RUN = { contextId: CONTEXT, conversationId: CHAT } as const;

/**
 * The runtime the tests run in: the real database, the real `ask_profile` and
 * the real tools, a CV stored under a context, a conversation in it and a saved
 * offer snapshot, with the model and the retriever replaced by spies.
 */
const runtime = (options: Options = {}): Runtime => {
  const loops: ToolLoopRequest[] = [];
  const goals: string[] = [];
  const received: Received[] = [];

  const call = (request: ToolLoopRequest): Call => async (name, input) => {
    const tool = request.tools.find((each) => each.name === name);
    assert.ok(tool, `the model was not granted ${name}`);
    const result = await tool.invoke(input);
    // Only what the tool returned is kept: a call that threw handed nothing over.
    received.push({ tool: name, input, result });
    return result;
  };

  const s = spine(
    { ...capabilities, ...options.probes },
    {
      ai: {
        generateObject: async (request) => {
          // The call that chooses the tools is the only structured call `ask_profile` makes.
          assert.equal(request.step, 'plan');
          goals.push(request.prompt);
          return { object: { tools: ['search_profile', 'read_cv'] } as never, finishReason: 'stop', usage: {} };
        },
        runToolLoop: async (request) => {
          loops.push(request);
          const text = await (options.loop ?? (async () => 'An answer.'))(request, call(request));
          return { text, steps: 1, finishReason: 'stop', usage: {} };
        },
        ...options.ai
      },
      tools: createToolRegistry(defaultTools),
      ...(options.on === undefined ? {} : { on: options.on })
    }
  );

  const generation = (): number =>
    (s.db.prepare('SELECT generation FROM cv_contexts WHERE id = ?').get(CONTEXT) as { generation: number }).generation;
  const revision = (): number => s.deps.documents.read(CONTEXT)?.revision ?? 0;

  if (options.on === undefined) {
    s.db.prepare("INSERT INTO cv_contexts (id, language, created_at, updated_at) VALUES (?, 'en', 1, 1)").run(CONTEXT);
    const conversation = s.db.prepare(
      'INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1)'
    );
    conversation.run(CHAT, 'profile', CONTEXT);
    conversation.run(OFFER_CHAT, 'offer', OFFER);
    s.deps.documents.update(CONTEXT, CV_KIND, () => BODY);
    s.db
      .prepare(
        'INSERT INTO offer_snapshots (id, offer_id, context_id, conversation_id, request, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, 1)'
      )
      .run(SNAPSHOT, OFFER, CONTEXT, OFFER_CHAT, '{}', JSON.stringify({ context: { generation: generation() }, document: { revision: revision() } }));
  }

  const retrieval: Retriever = { search: async () => [...(options.hits?.(revision()) ?? [])] };
  const ports = () => bindCvScope(CONTEXT, { documents: s.deps.documents, retrieval, index: s.deps.index });
  const real = createRecordStore(s.db);

  const deps: RuntimeDeps = {
    ...s.deps,
    scopeCv: () => ({ ...ports(), contextGeneration: generation(), contextRevision: revision() }),
    scopeOffer: () => ({
      ...ports(),
      effects: s.deps.effects,
      offerId: OFFER,
      contextGeneration: generation(),
      contextRevision: revision()
    }),
    offerInput: (_snapshot, _capability, input) => ({
      ...(input as Record<string, unknown>),
      offerText: options.posting ?? SHORT_POSTING
    }),
    ...(options.grounding === false
      ? {}
      : { grounding: { records: options.records?.(real) ?? real, wells: defaultWells() } })
  };

  return {
    s,
    records: real,
    loops,
    goals,
    received,
    version: String(revision()),
    begin: (input, over = CHAT_RUN, capability = 'ask_profile') => beginRun(deps, { capability, input, ...over }),
    resume: (runId) => resumeRun(deps, { runId }),
    dispose: () => s.dispose()
  };
};

/** The record of a run without its two clock readings, which the store's own tests pin down. */
const kept = (rt: Runtime, run: RunHandle) => {
  const record = rt.records.read(run.runId);
  assert.ok(record, 'a chat run has a record');
  const { openedAt, closedAt, ...rest } = record;
  assert.ok(openedAt > 0, 'opened with the run');
  if (record.state === 'closed' || record.state === 'interrupted') {
    assert.ok(closedAt !== undefined && closedAt >= openedAt, 'closed when the run ended');
  } else {
    assert.equal(closedAt, undefined, 'a record that is still going has not closed');
  }
  return rest;
};

/** The record a chat run that ended the given way has, when it recorded these entries. */
const record = (run: RunHandle, ending: 'succeeded' | 'failed' | 'cancelled', entries: readonly RecordEntry[]) => ({
  v: RECORD_VERSION,
  runId: run.runId,
  conversationId: CHAT,
  state: 'closed' as const,
  outcome: ending,
  entries
});

/** A field the host sent, as the record states it. */
const sent = (ref: string, original: unknown, shown?: unknown): RecordEntry => ({
  ref,
  digest: digest(original),
  ...(shown === undefined ? {} : { shown: digest(shown) }),
  status: 'included',
  origin: 'client',
  via: 'input'
});

/** A piece of the CV a tool handed to the model, and what was left of it when it was cut. */
const handed = (rt: Runtime, ref: string, original: unknown, via: string, shown?: unknown): RecordEntry => {
  if (shown !== undefined) assert.notEqual(digest(shown), digest(original), `${ref} was not cut, so there is nothing to show`);
  return {
    ref,
    version: rt.version,
    digest: digest(original),
    ...(shown === undefined ? {} : { shown: digest(shown) }),
    status: 'included',
    origin: 'server',
    via
  };
};

/** Something a port was asked for, which says it left the store and nothing more. */
const read = (rt: Runtime, ref: string, original: unknown, via: string): RecordEntry => ({
  ref,
  version: rt.version,
  digest: digest(original),
  status: 'read',
  origin: 'server',
  via
});

/**
 * What a search for "billing" finds in the fixture CV: where each passage was
 * read, and what the search then handed to the model. The fourth passage belongs
 * to no piece and is placed in the whole CV, which is less exact and never wrong.
 */
const searched = (rt: Runtime) => ({
  reads: [
    read(rt, 'cv:ctx/experience/acme~senior-engineer', BODY.experience[0], 'port:retrieval'),
    read(rt, 'cv:ctx/experience/globex~engineer', BODY.experience[1], 'port:retrieval'),
    read(rt, 'cv:ctx/overview/role_description', BODY.role_description, 'port:retrieval'),
    read(rt, 'cv:ctx', BODY, 'port:retrieval')
  ],
  handed: [
    // Each with the passage the model got of the piece it came from.
    handed(rt, 'cv:ctx/experience/acme~senior-engineer', BODY.experience[0], 'tool:search_profile', 'Rewrote the billing pipeline.'),
    handed(rt, 'cv:ctx/experience/globex~engineer', BODY.experience[1], 'tool:search_profile', 'Built the design system.'),
    // This passage is the whole description, so there is nothing less to say.
    handed(rt, 'cv:ctx/overview/role_description', BODY.role_description, 'tool:search_profile'),
    handed(rt, 'cv:ctx', BODY, 'tool:search_profile', 'BSc Computer Science at MIT')
  ]
});

/** The model's visit to the CV: both tools, a page that does not fit, and the same questions asked twice. */
const consult: NonNullable<Options['loop']> = async (_request, call) => {
  await call('read_cv', { section: 'overview' });
  await call('read_cv', { section: 'experience' });
  await call('read_cv', { section: 'experience', offset: 1 });
  await call('search_profile', { query: 'billing' });
  await call('read_cv', { section: 'overview' });
  await call('search_profile', { query: 'billing' });
  return 'You did billing at Acme.';
};

/* --------------------------------------------------------------- a message */

test('a run says what the host sent with the message, as the host sent it', async () => {
  const rt = runtime();
  try {
    const summary = `  ${SUMMARY}\n`;
    const run = rt.begin(question({ history: HISTORY, summary }));
    await run.settled;

    // What the model was handed, from the spy.
    const [loop] = rt.loops;
    assert.ok(loop);
    assert.deepEqual(loop.history, HISTORY);
    const seen = after(loop.system, SUMMARY_LABEL);
    assert.equal(seen, SUMMARY, 'the summary reaches the model trimmed');

    assert.deepEqual(kept(rt, run), record(run, 'succeeded', [
      // The host's words, so the record says it does not vouch for them.
      sent('conversation:chat/history', HISTORY),
      // Digested as the host sent it. The model saw less, and the record says that too.
      sent('conversation:chat/summary', summary, seen)
    ]));
  } finally {
    rt.dispose();
  }
});

test('a message that brings nothing along has a closed record with nothing in it', async () => {
  const rt = runtime();
  try {
    // An empty history and a summary of spaces are not sent: the model is given neither.
    const run = rt.begin(question({ history: [], summary: '  \n ' }));
    await run.settled;

    const [loop] = rt.loops;
    assert.ok(loop);
    assert.equal(loop.history, undefined, 'an empty history is left out of the request');
    assert.ok(!loop.system.includes(SUMMARY_LABEL.trim()), 'no summary was sent');

    assert.deepEqual(kept(rt, run), record(run, 'succeeded', []));
  } finally {
    rt.dispose();
  }
});

test('each run in a conversation has a record of its own', async () => {
  const rt = runtime();
  try {
    const first = rt.begin(question({ history: HISTORY }));
    await first.settled;
    // The same history again. What the first run recorded is not the second's to leave out.
    const second = rt.begin(question({ history: HISTORY, summary: SUMMARY }));
    await second.settled;

    assert.deepEqual(kept(rt, first), record(first, 'succeeded', [sent('conversation:chat/history', HISTORY)]));
    assert.deepEqual(kept(rt, second), record(second, 'succeeded', [
      sent('conversation:chat/history', HISTORY),
      sent('conversation:chat/summary', SUMMARY)
    ]));
  } finally {
    rt.dispose();
  }
});

test('a posting the host attached to a live run is the host\'s, under the conversation', async () => {
  const rt = runtime();
  try {
    const attached = 'Pasted by the user: senior Go engineer wanted.';
    const run = rt.begin(question({ offerText: attached }));
    await run.settled;

    const [loop] = rt.loops;
    assert.ok(loop);
    assert.equal(after(loop.prompt, POSTING_LABEL), attached);

    // No offer is involved, so nothing is claimed about one.
    assert.deepEqual(kept(rt, run), record(run, 'succeeded', [sent('conversation:chat/attached', attached)]));
    // And the call that chose the tools was not told the posting.
    assert.ok(rt.goals.every((goal) => !goal.includes(attached)));
  } finally {
    rt.dispose();
  }
});

test('a posting a snapshot supplied is the server\'s, under the offer', async () => {
  const rt = runtime({
    posting: SHORT_POSTING,
    loop: async (_request, call) => {
      await call('read_cv', { section: 'overview' });
      return 'Answered from the posting.';
    }
  });
  try {
    const run = rt.begin(question({ history: HISTORY, summary: SUMMARY }), {
      offerSnapshotId: SNAPSHOT,
      contextId: CONTEXT,
      conversationId: OFFER_CHAT
    });
    await run.settled;

    const [loop] = rt.loops;
    assert.ok(loop);
    assert.equal(after(loop.prompt, POSTING_LABEL), SHORT_POSTING);

    const overview = rt.received[0]?.result as { data: Record<string, unknown> };
    assert.deepEqual(overview.data.personal, BODY.personal);

    assert.deepEqual(kept(rt, run), {
      ...record(run, 'succeeded', [
        // Said before the call, in the order the step lists them. The chat is the snapshot's own.
        sent('conversation:offer-chat/history', HISTORY),
        sent('conversation:offer-chat/summary', SUMMARY),
        { ...sent('offers:offer-1/posting', SHORT_POSTING), origin: 'server' },
        read(rt, 'cv:ctx', BODY, 'port:documents'),
        handed(rt, 'cv:ctx/overview/personal', BODY.personal, 'tool:read_cv'),
        handed(rt, 'cv:ctx/overview/role_description', BODY.role_description, 'tool:read_cv'),
        handed(rt, 'cv:ctx/overview/skills', BODY.skills, 'tool:read_cv')
      ]),
      conversationId: OFFER_CHAT
    });

    // The call that chose the tools was never told the posting or the CV. This is the
    // one send that is not recorded, and it holds only because of that.
    assert.ok(rt.goals.length > 0);
    assert.ok(rt.goals.every((goal) => !goal.includes('billing platform') && !goal.includes('Ada Example')));
  } finally {
    rt.dispose();
  }
});

test('a posting the model was shown only part of is recorded whole, with the part it saw', async () => {
  const rt = runtime({ posting: LONG_POSTING });
  try {
    const run = rt.begin(question(), { offerSnapshotId: SNAPSHOT, contextId: CONTEXT, conversationId: OFFER_CHAT });
    await run.settled;

    const [loop] = rt.loops;
    assert.ok(loop);
    const seen = after(loop.prompt, POSTING_LABEL);
    assert.ok(seen.length < LONG_POSTING.length / 1.2, 'the model was shown a part of it');
    assert.ok(seen.endsWith('…'), 'and was not told how much is missing, only that it stops');

    assert.deepEqual(kept(rt, run), {
      ...record(run, 'succeeded', [{ ...sent('offers:offer-1/posting', LONG_POSTING, seen), origin: 'server' }]),
      conversationId: OFFER_CHAT
    });
  } finally {
    rt.dispose();
  }
});

/* ---------------------------------------------------------------- the tools */

test('what the tools hand to the model is what the record says, piece by piece', async () => {
  const rt = runtime({ loop: consult, hits: passages });
  try {
    const run = rt.begin(question());
    await run.settled;

    const [overview, cut, rest, search] = rt.received.map((each) => each.result) as [
      { data: { personal: unknown; role_description: unknown; skills: unknown } },
      { data: { items: unknown[] }; truncated?: boolean },
      { data: { items: unknown[] } },
      { results: { text: string }[] }
    ];

    // What the model saw: the overview whole, then one entry of three and only part of it.
    assert.deepEqual(overview.data.personal, BODY.personal);
    assert.deepEqual(overview.data.role_description, BODY.role_description);
    assert.deepEqual(overview.data.skills, BODY.skills);
    assert.equal(cut.data.items.length, 1, 'the page had room for one entry');
    assert.equal(cut.truncated, true);
    assert.deepEqual(rest.data.items, [BODY.experience[1], BODY.experience[2]]);
    assert.deepEqual(search.results.map((each) => each.text), passages(1).map((each) => each.text));

    assert.deepEqual(kept(rt, run), record(run, 'succeeded', [
      // The CV was read, which the port says and the tool does not.
      read(rt, 'cv:ctx', BODY, 'port:documents'),
      handed(rt, 'cv:ctx/overview/personal', BODY.personal, 'tool:read_cv'),
      handed(rt, 'cv:ctx/overview/role_description', BODY.role_description, 'tool:read_cv'),
      handed(rt, 'cv:ctx/overview/skills', BODY.skills, 'tool:read_cv'),
      // One entry of three was handed over and part of it was cut, so it says what was left.
      handed(rt, 'cv:ctx/experience/acme~senior-engineer', BODY.experience[0], 'tool:read_cv', cut.data.items[0]),
      handed(rt, 'cv:ctx/experience/globex~engineer', BODY.experience[1], 'tool:read_cv'),
      handed(rt, 'cv:ctx/experience/acme~senior-engineer-2', BODY.experience[2], 'tool:read_cv'),

      // The search: each passage was read, placed in the piece it was cut from, and then handed over.
      ...searched(rt).reads,
      ...searched(rt).handed
      // Then the model asked for the overview and the search again, and nothing is said twice.
    ]));
  } finally {
    rt.dispose();
  }
});

test('a passage the tool cut from its result was read and was not handed over', async () => {
  const big = (revision: number): ChunkHit[] => [
    hit(revision, 0, 'a'.repeat(3_500), { section: 'experience', entry: 0, company: 'Acme', title: 'Senior Engineer' }),
    hit(revision, 1, 'b'.repeat(2_400), { section: 'experience', entry: 1, company: 'Globex', title: 'Engineer' }),
    hit(revision, 2, 'c'.repeat(300), { section: 'experience', entry: 2, company: 'Acme', title: 'Senior Engineer' })
  ];
  const rt = runtime({
    hits: big,
    loop: async (_request, call) => {
      await call('search_profile', { query: 'billing' });
      return 'Found some.';
    }
  });
  try {
    const run = rt.begin(question());
    await run.settled;

    const result = rt.received[0]?.result as { results: { text: string }[]; truncated?: number };
    assert.deepEqual(result.results.map((each) => each.text.length), [3_500, 2_400]);
    assert.equal(result.truncated, 1, 'the third passage did not fit');

    assert.deepEqual(kept(rt, run), record(run, 'succeeded', [
      read(rt, 'cv:ctx/experience/acme~senior-engineer', BODY.experience[0], 'port:retrieval'),
      read(rt, 'cv:ctx/experience/globex~engineer', BODY.experience[1], 'port:retrieval'),
      read(rt, 'cv:ctx/experience/acme~senior-engineer-2', BODY.experience[2], 'port:retrieval'),
      read(rt, 'cv:ctx', BODY, 'port:documents'),
      handed(rt, 'cv:ctx/experience/acme~senior-engineer', BODY.experience[0], 'tool:search_profile', 'a'.repeat(3_500)),
      handed(rt, 'cv:ctx/experience/globex~engineer', BODY.experience[1], 'tool:search_profile', 'b'.repeat(2_400))
      // Nothing handed over for the third: the model never saw it.
    ]));
  } finally {
    rt.dispose();
  }
});

/* ------------------------------------------------------------ failing closed */

test('a run whose record cannot be written does not send what it could not record', async () => {
  const rt = runtime({
    records: (real) => ({
      ...real,
      append: () => {
        throw new Error('the disk is full');
      }
    })
  });
  try {
    const run = rt.begin(question({ history: HISTORY }));
    await assert.rejects(run.settled, /the disk is full/);

    assert.equal(rt.loops.length, 0, 'the model was never called');
    assert.deepEqual(kept(rt, run), record(run, 'failed', []));
  } finally {
    rt.dispose();
  }
});

test('a tool that could not say what it hands over hands nothing, and says it when asked again', async () => {
  let appends = 0;
  const rt = runtime({
    // The first write is the port saying the CV was read. The second is the tool
    // saying what it is handing over, and that one fails.
    records: (real) => ({
      ...real,
      append: (runId, entries) => {
        appends += 1;
        if (appends === 2) throw new Error('the file is locked');
        return real.append(runId, entries);
      }
    }),
    loop: async (_request, call) => {
      await assert.rejects(() => call('read_cv', { section: 'overview' }), /the file is locked/);
      await call('read_cv', { section: 'overview' });
      return 'Read it on the second try.';
    }
  });
  try {
    const run = rt.begin(question());
    await run.settled;

    // The model received the overview once, and the record has it once.
    assert.equal(rt.received.length, 1);
    assert.deepEqual(kept(rt, run), record(run, 'succeeded', [
      read(rt, 'cv:ctx', BODY, 'port:documents'),
      handed(rt, 'cv:ctx/overview/personal', BODY.personal, 'tool:read_cv'),
      handed(rt, 'cv:ctx/overview/role_description', BODY.role_description, 'tool:read_cv'),
      handed(rt, 'cv:ctx/overview/skills', BODY.skills, 'tool:read_cv')
    ]));
  } finally {
    rt.dispose();
  }
});

test('a search that could not say which passages it hands over hands none, and says it when asked again', async () => {
  let appends = 0;
  const rt = runtime({
    hits: passages,
    // Two writes come before the one that matters: the passages the retriever found, and
    // the CV they were looked up in. The third is the search saying what it hands over.
    records: (real) => ({
      ...real,
      append: (runId, entries) => {
        appends += 1;
        if (appends === 3) throw new Error('the file is locked');
        return real.append(runId, entries);
      }
    }),
    loop: async (_request, call) => {
      await assert.rejects(() => call('search_profile', { query: 'billing' }), /the file is locked/);
      await call('search_profile', { query: 'billing' });
      return 'Found them on the second try.';
    }
  });
  try {
    const run = rt.begin(question());
    await run.settled;

    // The model received the passages once, and the record has each once.
    assert.equal(rt.received.length, 1);
    assert.deepEqual(kept(rt, run), record(run, 'succeeded', [
      ...searched(rt).reads,
      read(rt, 'cv:ctx', BODY, 'port:documents'),
      ...searched(rt).handed
    ]));
  } finally {
    rt.dispose();
  }
});

/** One step of each kind that reaches a model, sending a field nothing names. */
const sending = (kind: 'extract' | 'generate' | 'tool_loop'): Step => {
  const base = { name: 'work', critical: true, system: 'S', prompt: 'P', sends: [{ field: 'nonsense' }] } as const;
  switch (kind) {
    case 'extract':
      return { ...base, kind, schema: z.object({}).passthrough(), maxOutputTokens: 16 };
    case 'generate':
      return { ...base, kind, key: 'text', maxOutputTokens: 16 };
    case 'tool_loop':
      return { ...base, kind, tools: [], maxSteps: 1 };
  }
};

for (const kind of ['extract', 'generate', 'tool_loop'] as const) {
  test(`${kind === 'extract' ? 'an' : 'a'} ${kind} step that sends a field nothing names fails before the model is called`, async () => {
    const calls: string[] = [];
    const rt = runtime({
      probes: { probe: noop('probe', [stage('only', [sending(kind)])]) },
      ai: {
        generateObject: async () => {
          calls.push('generateObject');
          return { object: {} as never, finishReason: 'stop', usage: {} };
        },
        generateText: async () => {
          calls.push('generateText');
          return { text: 'x', finishReason: 'stop', usage: {} };
        },
        runToolLoop: async () => {
          calls.push('runToolLoop');
          return { text: 'x', steps: 1, finishReason: 'stop', usage: {} };
        }
      }
    });
    try {
      const run = rt.begin({ summary: SUMMARY }, CHAT_RUN, 'probe');
      await assert.rejects(run.settled, /nothing says what it addresses/);

      assert.deepEqual(calls, [], 'a step that cannot say what it sends does not send it');
      assert.deepEqual(kept(rt, run), record(run, 'failed', []));
    } finally {
      rt.dispose();
    }
  });
}

test('a step that answers without calling a model has sent nothing', async () => {
  const calls: string[] = [];
  const answering: Step = {
    kind: 'generate',
    name: 'write',
    critical: true,
    key: 'text',
    system: 'S',
    prompt: 'P',
    maxOutputTokens: 16,
    directText: () => 'Known already.',
    sends: [{ field: 'summary' }, { field: 'history' }]
  };
  const rt = runtime({
    probes: { probe: noop('probe', [stage('only', [answering])]) },
    ai: {
      generateText: async () => {
        calls.push('generateText');
        return { text: 'x', finishReason: 'stop', usage: {} };
      }
    }
  });
  try {
    const run = rt.begin({ summary: SUMMARY, history: HISTORY }, CHAT_RUN, 'probe');
    await run.settled;

    assert.deepEqual(calls, []);
    assert.deepEqual(kept(rt, run), record(run, 'succeeded', []));
  } finally {
    rt.dispose();
  }
});

/* ------------------------------------------------------------ how a run ends */

test('a run that fails keeps what it had sent, and says it failed', async () => {
  const rt = runtime({
    loop: async () => {
      throw new Error('the model went away');
    }
  });
  try {
    const run = rt.begin(question({ history: HISTORY }));
    await assert.rejects(run.settled, /the model went away/);

    // The history was on its way when the call failed, and a record that left
    // it out would say less than was sent.
    assert.deepEqual(kept(rt, run), record(run, 'failed', [sent('conversation:chat/history', HISTORY)]));
  } finally {
    rt.dispose();
  }
});

test('a run that is cancelled keeps what it had sent, and says it was cancelled', async () => {
  const cancel = new AbortController();
  const rt = runtime({
    loop: async (request) => {
      cancel.abort(new Error('the user closed the window'));
      await untilAborted(request.signal);
      return 'never';
    }
  });
  try {
    const run = rt.begin(question({ summary: SUMMARY }), { ...CHAT_RUN, signal: cancel.signal });
    await assert.rejects(run.settled, (error: Error & { code?: string }) => error.code === 'aborted');

    assert.deepEqual(kept(rt, run), record(run, 'cancelled', [sent('conversation:chat/summary', SUMMARY)]));
  } finally {
    rt.dispose();
  }
});

/** Three stages: a send, a pause for a person, and two more sends. */
const pausing = (): CapabilityMap => {
  const loop = (name: string, sends: readonly { field: string }[]): Step => ({
    kind: 'tool_loop',
    name,
    critical: true,
    system: 'S',
    prompt: 'P',
    tools: [],
    maxSteps: 1,
    sends
  });

  return {
    probe: noop('probe', [
      stage('before', [loop('first', [{ field: 'summary' }])]),
      stage('ask', [
        transform('confirm', async (context) => {
          const decision = context.approvals.request({ key: 'go', kind: 'confirm', question: 'Go on?', payload: {} });
          return { went: decision.status };
        })
      ]),
      stage('after', [loop('second', [{ field: 'summary' }, { field: 'history' }])])
    ])
  };
};

test('a run parked for a person keeps its record open, and finishes it when it resumes', async () => {
  const first = runtime({ probes: pausing() });
  let second: Runtime | undefined;
  try {
    const run = first.begin({ summary: SUMMARY, history: HISTORY }, CHAT_RUN, 'probe');
    await assert.rejects(run.settled, (error: unknown) => isRunSuspension(error));

    // Parked, not ended: the record says what was sent so far and that it is not over.
    assert.deepEqual(kept(first, run), {
      v: RECORD_VERSION,
      runId: run.runId,
      conversationId: CHAT,
      state: 'suspended',
      entries: [sent('conversation:chat/summary', SUMMARY)]
    });

    const waiting = first.s.approvals.pending(run.runId);
    assert.equal(waiting.length, 1);
    first.s.approvals.decide(waiting[0]?.id ?? '', { status: 'granted', decision: { confirmed: true }, decidedAt: Date.now() });

    // A second process over the same file picks it up, with a record store of its own.
    let during: unknown;
    const written: RecordEntry[] = [];
    second = runtime({
      on: first.s.scratch,
      probes: pausing(),
      // What the resumed run asks the file to keep, which is all that tells it apart from one
      // that has forgotten what was already recorded: the file drops a repeat either way.
      records: (real) => ({
        ...real,
        append: (runId, entries) => {
          written.push(...entries);
          return real.append(runId, entries);
        }
      }),
      loop: async () => {
        during = second?.records.read(run.runId)?.state;
        return 'An answer.';
      }
    });
    await second.resume(run.runId);

    assert.equal(during, 'open', 'a run that is going again has a record that is open again');
    assert.equal(second.loops.length, 1, 'the step before the pause was not run again');
    assert.deepEqual(written, [sent('conversation:chat/history', HISTORY)], 'only what is new is written');
    assert.deepEqual(kept(second, run), record(run, 'succeeded', [
      // Sent before the pause, and not said again when the later step sends it.
      sent('conversation:chat/summary', SUMMARY),
      sent('conversation:chat/history', HISTORY)
    ]));
  } finally {
    second?.dispose();
    first.dispose();
  }
});

test('a run whose process died is interrupted, and a write that comes late is dropped', async () => {
  let release!: () => void;
  let entered!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });

  const first = runtime({
    loop: async (_request, call) => {
      entered();
      await hold;
      // As far as the file is concerned the process is already gone.
      await call('read_cv', { section: 'overview' });
      return 'Too late.';
    }
  });
  let second: Runtime | undefined;
  try {
    const run = first.begin(question({ history: HISTORY }));
    const lost = run.settled.catch(() => undefined);
    await started;

    second = runtime({ on: first.s.scratch });
    recoverInterruptedRuns(second.s.runs);

    const interrupted = {
      v: RECORD_VERSION,
      runId: run.runId,
      conversationId: CHAT,
      state: 'interrupted' as const,
      // What was written before the process ended, and it says so by not claiming more.
      entries: [sent('conversation:chat/history', HISTORY)]
    };
    assert.deepEqual(kept(second, run), interrupted);
    assert.equal(second.s.runs.get(run.runId)?.errorCode, 'process_interrupted');

    release();
    await lost;

    // The tool that finished after the run was settled returned to a model that is gone.
    assert.equal(first.received.length, 1);
    assert.deepEqual(kept(second, run), interrupted, 'it added nothing');
  } finally {
    release();
    second?.dispose();
    first.dispose();
  }
});

/* ------------------------------------------------------- what it leaves alone */

const looking = (): CapabilityMap => ({
  probe: noop('probe', [
    stage('only', [
      transform('look', async (context) => ({
        scopes: context.record === undefined ? null : { ...context.record.scopes }
      }))
    ])
  ])
});

test('a run is bound to the wells it can read, and a run in no conversation has no record at all', async () => {
  const rt = runtime({ probes: looking() });
  try {
    const bare = await rt.begin({}, { contextId: CONTEXT }, 'probe').settled;
    assert.equal(bare.data.scopes, null, 'no sink was built');
    assert.equal(rt.records.read(bare.runId), undefined);

    const live = await rt.begin({}, CHAT_RUN, 'probe').settled;
    assert.deepEqual(live.data.scopes, { conversation: CHAT, cv: CONTEXT });

    const snapshot = await rt.begin({}, { offerSnapshotId: SNAPSHOT, contextId: CONTEXT, conversationId: OFFER_CHAT }, 'probe').settled;
    assert.deepEqual(snapshot.data.scopes, { conversation: OFFER_CHAT, cv: CONTEXT, offers: OFFER });
    assert.equal(rt.records.read(snapshot.runId)?.conversationId, OFFER_CHAT);
  } finally {
    rt.dispose();
  }
});

test('a runtime with nothing to keep records with still ends each record, and leaves it empty', async () => {
  const rt = runtime({ grounding: false, probes: looking(), loop: consult, hits: passages });
  try {
    const run = rt.begin(question({ history: HISTORY, summary: SUMMARY }));
    await run.settled;

    // The model was handed the history, the summary and the CV all the same.
    assert.equal(rt.received.length, 6);
    // The store opens and settles a record whatever the runtime holds. Empty here means
    // nothing wrote into it, which is not a statement that the model was given nothing.
    assert.deepEqual(kept(rt, run), record(run, 'succeeded', []));

    const probe = await rt.begin({}, CHAT_RUN, 'probe').settled;
    assert.equal(probe.data.scopes, null);
  } finally {
    rt.dispose();
  }
});

test('the model is given the same thing with a record, without one, and in no conversation', async () => {
  /** Everything the model was handed or was told by a tool, without the ids that differ per run. */
  const payloads = async (options: Options, over?: Omit<RunRequest, 'capability' | 'input'>) => {
    const rt = runtime({ loop: consult, hits: passages, ...options });
    try {
      await rt.begin(question({ history: HISTORY, summary: SUMMARY }), over).settled;
      const [loop] = rt.loops;
      assert.ok(loop);
      return {
        system: loop.system,
        prompt: loop.prompt,
        history: loop.history,
        maxSteps: loop.maxSteps,
        tools: loop.tools.map((tool) => [tool.name, tool.describe]),
        goals: rt.goals,
        results: rt.received.map((each) => each.result)
      };
    } finally {
      rt.dispose();
    }
  };

  const recorded = await payloads({});
  assert.equal(recorded.tools.length, 2);
  assert.equal(recorded.results.length, 6);

  assert.deepEqual(await payloads({ grounding: false }), recorded, 'with no record store');
  assert.deepEqual(await payloads({}, { contextId: CONTEXT }), recorded, 'in no conversation');
});

/* ------------------------------------------------------ the production runtime */

test('the production runtime keeps a record for a live run and a snapshot run, and for no other', async () => {
  const s = scratch();
  const cv = createCvContextStore(s.db).create(randomUUID(), 'en');
  const probe = noop('probe', [
    stage('only', [
      transform('look', async (context) => ({
        scopes: context.record === undefined ? null : { ...context.record.scopes },
        // Through the port the probe was handed, which is the one that says it was read.
        revision: context.documents.read(CV_ID)?.revision ?? null
      }))
    ])
  ]);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  const records = createRecordStore(s.db);
  const offer = { id: 'offer', text: 'Original posting', firstSeenAt: 1, lastSeenAt: 1,
    processing: 'fetched' as const, disposition: 'active' as const };

  try {
    h.offers.save(offer);
    h.profile.replaceContext(cv.id, { role_description: 'Original CV' }, 0);
    const stored = h.documents.read(cv.id);
    assert.ok(stored);
    const whole = digest(cvOf(stored.body));

    // A live run in a conversation of the CV.
    const chat = h.conversations.create({ kind: 'profile', id: cv.id });
    const live = await h.run({ capability: 'probe', input: {}, contextId: cv.id, conversationId: chat.id });
    assert.deepEqual(live.data.scopes, { conversation: chat.id, cv: cv.id });
    assert.deepEqual(records.read(live.runId)?.entries, [
      { ref: `cv:${cv.id}`, version: String(stored.revision), digest: whole, status: 'read', origin: 'server', via: 'port:documents' }
    ]);
    assert.equal(records.read(live.runId)?.state, 'closed');
    assert.equal(records.read(live.runId)?.outcome, 'succeeded');

    // A snapshot run, in the conversation the snapshot made, about the offer it saved.
    const snapshot = h.offerSnapshots.capture({ id: randomUUID(), offerId: offer.id, contextId: cv.id,
      expectedRevision: 1, expectedContextRevision: stored.revision, expectedPhotoRevision: 0 });
    h.profile.replaceContext(cv.id, { role_description: 'Edited later' }, stored.revision);
    const saved = await h.run({ capability: 'probe', input: {}, offerSnapshotId: snapshot.id, contextId: cv.id,
      conversationId: snapshot.conversationId });
    assert.deepEqual(saved.data.scopes, { conversation: snapshot.conversationId, cv: cv.id, offers: offer.id });
    // The CV as it was when the snapshot was taken, not as it is now.
    assert.deepEqual(records.read(saved.runId)?.entries, [
      { ref: `cv:${cv.id}`, version: String(snapshot.document.revision), digest: whole, status: 'read', origin: 'server', via: 'port:documents' }
    ]);
    assert.equal(records.read(saved.runId)?.conversationId, snapshot.conversationId);

    // A run in no conversation keeps nothing and is not given a sink.
    const bare = await h.run({ capability: 'probe', input: {}, contextId: cv.id });
    assert.equal(bare.data.scopes, null);
    assert.equal(records.read(bare.runId), undefined);
  } finally {
    h.close();
    s.dispose();
  }
});
