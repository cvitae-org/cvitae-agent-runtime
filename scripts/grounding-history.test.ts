/**
 * What a conversation hands a model of itself, and that an exclusion reaches it.
 *
 * `grounding-walls.test.ts` shows that an excluded piece of the CV is not read.
 * That leaves the way round it: the piece was read before it was excluded, the
 * model wrote an answer from it, and the host hands that answer back as history.
 * So here the conversation is kept by the runtime (`runtime/history.ts`), each
 * answer is traced to what its run was given by the record (`grounding/taint.ts`),
 * and an answer built from something excluded now is not handed back, nor is an
 * answer built on that one, nor a summary that folded either in.
 *
 * The questions, in order:
 *
 *   the rule         which answers a set of walls reaches, over records and nothing
 *                    else: what taints, what does not, what is not known, how a
 *                    chain is followed
 *   the supplier     which exchanges and which summary a run is given, in what
 *                    order, within what limits, and when the host's own is kept
 *   a chat run       the real `ask_profile` over the real tools and a stored
 *                    conversation: the canary of an excluded piece reaches no
 *                    payload through an earlier answer, however far back, and comes
 *                    back when the exclusion is lifted
 *   a wait           a run parked for a person is given the conversation as it is
 *                    when it resumes
 *   the record       what the runtime supplied is recorded as the runtime's, and
 *                    what the host sent is still the host's
 *   production       the harness a host drives, over a file, across a restart
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 84 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * the rule, which answers a set of walls reaches:
 *   with nothing walled the answers are still looked up 14
 *   an answer already worked out is worked out again 1
 *   an answer worked out is not remembered         1
 *   an answer met while it is worked out is handed over 1
 *   an answer that cannot be traced is handed over 4
 *   a read withholds                               4
 *   what the host sent withholds                   3
 *   a wall inside an entry does not touch it       1
 *   a wall over an entry does not touch it         15
 *   an answer built on a withheld one is handed over 11
 *
 * the supplier, when it applies and what it reads:
 *   a capability that keeps no record is answered for 1
 *   a history the host sent is replaced            1
 *   a capability with no history is given one      1
 *   a summary the host sent is replaced            1
 *   a capability with no summary is given one      1
 *   the conversation is read as another            4
 *   the walls are those of another conversation    8
 *   the records are those of another conversation  7
 *
 * the supplier, which answers it takes and how it traces them:
 *   a question that belongs to another run is its answer's 1
 *   a question that was stored with a run is not its answer's 26
 *   an answer after an answer is taken for its question 1
 *   an answer is always named by its message       16
 *   an answer is always named by its run           2
 *   an answer named by its message is looked for as a run 1
 *   a record that is not closed is trusted         1
 *   a run that is gone is trusted                  1
 *   a capability that keeps no record is trusted   1
 *   a record says nothing of what the run was given 12
 *   an entry of another conversation carries an answer 1
 *   an entry of another well carries an answer     1
 *   a history entry carries nothing                6
 *   a history entry with no answer in it carries one 1
 *   a summary entry carries nothing                3
 *   a summary is made from the answers after the version it names 2
 *   a summary is made from the answers before the version it names 1
 *   a summary that names no version is made from nothing 1
 *
 * the supplier, what it gives:
 *   a note that holds a withheld answer is given   2
 *   a note that says nothing is given              8
 *   a note is held back for an answer after it     1
 *   a note is held back for an answer at its edge only on one side 1
 *   an address no record can hold is given         1
 *   an answer that was withheld is given           13
 *   the run's own answer is given                  1
 *   a blank question is given                      1
 *   a blank answer is given                        1
 *   a question the note holds is given as well     1
 *   what the note holds is given again             5
 *   the oldest are the ones that fit               11
 *   one more exchange than twelve turns            1
 *   one fewer exchange than twelve turns           1
 *   an exchange that exactly fills the budget does not fit 1
 *   an exchange over the budget fits when nothing is before it 2
 *   an older exchange is kept behind one that did not fit 1
 *   the exchanges come newest first                11
 *   a note alone is nothing to give                3
 *   a withheld note is given anyway                3
 *   a withheld note is recorded as given           4
 *   the exchanges are recorded by what was not given 2
 *   the note is recorded as reaching the end       2
 *
 * the record of what was supplied:
 *   what was supplied is recorded as the host's    7
 *   an exchange is recorded as read                6
 *   an exchange is recorded as the host's          6
 *   an exchange is recorded on another channel     2
 *   an exchange is recorded under the whole history 7
 *   a supplied note is recorded as the host's      2
 *   a supplied note is recorded with no version    1
 *   a supplied note is recorded as the host's origin 2
 *
 * the wiring of a run, a resume and the harness:
 *   a capability that is recorded is not marked so 9
 *   a run is never given the conversation          11
 *   a run is given the conversation of no conversation 1
 *   a run is planned from the input it was sent    7
 *   a run is given the input it was sent           2
 *   a run is not told what it was given            8
 *   the record is not told what the runtime supplied 8
 *   a run that resumes is not given the conversation again 1
 *   a run that resumes is not told what it was given 1
 *   a run that resumes is planned from the input it was sent 1
 *   the harness reads no conversation              1
 *   the harness reads no exclusions                1
 *   the harness reads the records of no capability 1
 *
 * the records of a conversation in the store:
 *   the records of every conversation are the conversation's 13
 *   the records of a conversation are newest first 1
 *   the records of a conversation are in the order of their runs' ids 1
 *   the entries of a record are last first         1
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { capabilities } from '../src/capabilities/index.js';
import { CV_KIND, emptyDocument } from '../src/capabilities/cv/document.js';
import { HISTORY_BUDGET, historySchema, summarySchema } from '../src/context/conversation.js';
import { isRunSuspension } from '../src/contracts/index.js';
import type {
  CapabilityMap,
  ChunkHit,
  ConversationRecord,
  PieceRef,
  RecordEntry,
  Retriever,
  StepContext,
  ToolLoopRequest
} from '../src/contracts/index.js';
import { createTaint, digest, parseRef, touches } from '../src/grounding/index.js';
import type { Source } from '../src/grounding/index.js';
import { bindCvScope } from '../src/runtime/cv-scope.js';
import { createHarness } from '../src/runtime/create.js';
import { defaultWells, historyRef } from '../src/runtime/grounding.js';
import { createHistory } from '../src/runtime/history.js';
import { beginRun, givenInput } from '../src/runtime/run.js';
import type { RunHandle, RunRequest, RuntimeDeps } from '../src/runtime/run.js';
import { resumeRun } from '../src/runtime/resume.js';
import { createConversationStore } from '../src/storage/sqlite/conversations.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createRecordStore } from '../src/storage/sqlite/grounding-record.js';
import { createSelectionStore } from '../src/storage/sqlite/grounding-selection.js';
import { defaultTools } from '../src/tools/index.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { scratch } from './support/db.js';
import type { Scratch } from './support/db.js';
import { noop, spine, stage, transform } from './support/spine.js';
import type { Spine } from './support/spine.js';

const CONTEXT = 'ctx';
const CHAT = 'chat';
const OTHER_CHAT = 'other-chat';

/** One in each piece the tests exclude, and in nothing else. */
const CANARY = {
  acme: 'ZEBRA-ACME1-4410',
  globex: 'ZEBRA-GLOBEX-7731',
  summary: 'ZEBRA-SUMMARY-2208',
  note: 'ZEBRA-NOTE-6620'
} as const;

const GLOBEX = `cv:${CONTEXT}/experience/globex~engineer`;
const ACME = `cv:${CONTEXT}/experience/acme~senior-engineer`;
const ROLE = `cv:${CONTEXT}/overview/role_description`;

const BODY = {
  ...emptyDocument(),
  role_description: `Backend engineer focused on billing systems. ${CANARY.summary}`,
  experience: [
    {
      company: 'Acme',
      title: 'Senior Engineer',
      started: '2021',
      finished: null,
      highlights: [`Rewrote the billing pipeline. ${CANARY.acme}`],
      skills: ['Go']
    },
    {
      company: 'Globex',
      title: 'Engineer',
      started: '2018',
      finished: '2021',
      highlights: [`Built the design system. ${CANARY.globex}`],
      skills: []
    }
  ]
};

const walls = (...refs: string[]): PieceRef[] => refs.map((each) => parseRef(each));

/* ------------------------------------------------------------------ the rule */

const entry = (ref: string, over: Partial<RecordEntry> = {}): RecordEntry => ({
  ref,
  digest: 'd',
  status: 'included',
  origin: 'server',
  via: 'input',
  ...over
});

/** A conversation whose answers are known by their entries, and which carries what its history entries name. */
const taintOf = (known: Record<string, readonly RecordEntry[] | undefined>, excluded: readonly PieceRef[]) => {
  const reads: string[] = [];
  const withheld = createTaint({
    walls: excluded,
    source: (key): Source => {
      reads.push(key);
      const entries = known[key];
      return entries === undefined ? { known: false } : { known: true, entries };
    },
    carried: (held) => {
      const at = parseRef(held.ref);
      return at.well === 'conversation' && at.path[0] === 'history' && at.path[1] !== undefined ? [at.path[1]] : [];
    }
  });
  return { withheld, reads };
};

const carries = (key: string, over: Partial<RecordEntry> = {}): RecordEntry =>
  entry(`conversation:${CHAT}/history/${key}`, over);

test('with nothing walled, no answer is withheld, whatever is known of it', () => {
  const { withheld, reads } = taintOf({ a: undefined, b: [entry(GLOBEX)] }, []);
  assert.equal(withheld('a'), false);
  assert.equal(withheld('b'), false);
  assert.deepEqual(reads, [], 'with nothing walled there is nothing to look up');
});

test('an answer that cannot be traced is withheld once anything is walled, and one that has nothing to trace is not', () => {
  const { withheld } = taintOf({ unknown: undefined, empty: [] }, walls(`cv:elsewhere/experience`));
  assert.equal(withheld('unknown'), true);
  assert.equal(withheld('empty'), false, 'a record that is complete and holds nothing reached nothing');
});

test('an entry is touched by a wall that covers it or lies inside it, and by no other', () => {
  const experience = walls(`cv:${CONTEXT}/experience`);
  const acme = walls(ACME);
  const cases: [string, readonly PieceRef[], string, boolean][] = [
    ['a piece inside a walled section', experience, ACME, true],
    ['the walled piece itself', acme, ACME, true],
    ['a section with a wall inside it', acme, `cv:${CONTEXT}/experience`, true],
    ['a whole scope with a wall inside it', acme, `cv:${CONTEXT}`, true],
    ['a sibling', acme, GLOBEX, false],
    ['a piece whose name only starts like the walled one', acme, `${ACME}-2`, false],
    ['another scope', acme, 'cv:elsewhere', false],
    ['another well', acme, `offers:${CONTEXT}`, false]
  ];

  for (const [name, excluded, ref, expected] of cases) {
    assert.equal(touches(excluded, parseRef(ref)), expected, name);
    const { withheld } = taintOf({ a: [entry(ref)] }, excluded);
    assert.equal(withheld('a'), expected, name);
  }
});

test('what was read, or sent by the host, or is not known to have reached a model, does not withhold', () => {
  const excluded = walls(GLOBEX);
  const { withheld } = taintOf(
    {
      read: [entry(GLOBEX, { status: 'read' })],
      client: [entry(GLOBEX, { origin: 'client' })],
      later: [entry(GLOBEX, { status: 'listed' as never })],
      sent: [entry(GLOBEX)]
    },
    excluded
  );
  assert.equal(withheld('read'), false);
  assert.equal(withheld('client'), false);
  assert.equal(withheld('later'), false, 'a status that is not known to reach a model does not');
  assert.equal(withheld('sent'), true);
});

test('an answer built on a withheld one is withheld, however many answers back', () => {
  const { withheld } = taintOf(
    {
      first: [entry(GLOBEX)],
      second: [carries('first')],
      third: [entry(ACME), carries('second')],
      fourth: [carries('third')],
      apart: [entry(ACME)]
    },
    walls(GLOBEX)
  );
  assert.equal(withheld('first'), true);
  assert.equal(withheld('second'), true);
  assert.equal(withheld('third'), true);
  assert.equal(withheld('fourth'), true);
  assert.equal(withheld('apart'), false);
});

test('an answer carried by a read, or by the host, is not carried further', () => {
  const { withheld } = taintOf(
    {
      first: [entry(GLOBEX)],
      read: [carries('first', { status: 'read' })],
      client: [carries('first', { origin: 'client' })]
    },
    walls(GLOBEX)
  );
  assert.equal(withheld('read'), false);
  assert.equal(withheld('client'), false);
});

test('an answer built on itself cannot be traced and is withheld', () => {
  const { withheld } = taintOf({ one: [carries('two')], two: [carries('one')], self: [carries('self')], apart: [] }, walls(GLOBEX));
  assert.equal(withheld('one'), true);
  assert.equal(withheld('two'), true);
  assert.equal(withheld('self'), true);
  assert.equal(withheld('apart'), false);
});

test('an answer is worked out once', () => {
  const { withheld, reads } = taintOf(
    { base: [entry(GLOBEX)], left: [carries('base')], right: [carries('base')], top: [carries('left'), carries('right')] },
    walls(GLOBEX)
  );
  assert.equal(withheld('top'), true);
  assert.equal(withheld('top'), true);
  assert.equal(reads.filter((key) => key === 'base').length, 1);
  assert.equal(reads.filter((key) => key === 'top').length, 1);
});

/* -------------------------------------------------------------- the supplier */

type Say = { readonly role: 'user' | 'assistant'; readonly text: string; readonly runId?: string };

type Fixture = {
  readonly messages?: readonly Say[];
  readonly records?: readonly ConversationRecord[];
  readonly excluded?: readonly string[];
  readonly summary?: string;
  readonly through?: number;
  readonly capabilities?: CapabilityMap;
  /** Ids of the messages, when a test needs them to be something else. */
  readonly ids?: Readonly<Record<number, string>>;
};

const KNOWING: CapabilityMap = { ask: noop('ask', [], { recorded: true }), plain: noop('plain', []) };

/** A closed record of the capability `ask`, which says what the run was given. */
const closed = (runId: string, entries: readonly RecordEntry[] = [], capability: string | null = 'ask'): ConversationRecord => ({
  record: { v: 1, runId, conversationId: CHAT, state: 'closed', outcome: 'succeeded', openedAt: 1, closedAt: 2, entries: [...entries] },
  ...(capability === null ? {} : { capability })
});

/** The supplier over a conversation that exists only as these messages and records. */
const supplier = (fixture: Fixture = {}) => {
  const messages = (fixture.messages ?? []).map((say, at) => ({
    id: fixture.ids?.[at + 1] ?? `m${at + 1}`,
    conversationId: CHAT,
    seq: at + 1,
    role: say.role,
    text: say.text,
    ...(say.runId === undefined ? {} : { runId: say.runId }),
    createdAt: 1
  }));

  return createHistory({
    conversations: {
      read: (id) =>
        id === CHAT
          ? {
              conversation: {
                id: CHAT,
                subject: { kind: 'profile', id: CONTEXT },
                createdAt: 1,
                updatedAt: 1,
                messageCount: messages.length,
                ...(fixture.summary === undefined ? {} : { summary: fixture.summary }),
                summarisedThrough: fixture.through ?? 0
              },
              messages
            }
          : undefined
    },
    records: { byConversation: () => fixture.records ?? [] },
    walls: () => walls(...(fixture.excluded ?? [])),
    capabilities: fixture.capabilities ?? KNOWING
  });
};

const ASKED = { question: 'And now?', history: [], summary: '', maxSteps: 6 };

const supply = (fixture: Fixture, input: Record<string, unknown> = ASKED, over: { capability?: string; runId?: string; conversationId?: string } = {}) =>
  supplier(fixture).supply({ capability: 'ask', conversationId: CHAT, runId: 'now', input, ...over });

/** What a model is given of the conversation by this supply. */
const given = (made: ReturnType<typeof supply>) => ({
  history: (made?.input.history as { text: string }[] | undefined)?.map((turn) => turn.text),
  summary: made?.input.summary
});

const exchange = (n: number, extra: Partial<Say> = {}): Say[] => [
  { role: 'user', text: `question ${n}` },
  { role: 'assistant', text: `answer ${n}`, runId: `r${n}`, ...extra }
];

test('the runtime gives a run the settled exchanges before it, oldest first, each by the answer that names it', () => {
  const made = supply({ messages: [...exchange(1), ...exchange(2), { role: 'user', text: 'And now?' }] });

  assert.deepEqual(given(made).history, ['question 1', 'answer 1', 'question 2', 'answer 2']);
  assert.deepEqual(made?.input.history, [
    { role: 'user', text: 'question 1' },
    { role: 'assistant', text: 'answer 1' },
    { role: 'user', text: 'question 2' },
    { role: 'assistant', text: 'answer 2' }
  ]);
  assert.deepEqual(made?.supplied.exchanges.map((each) => each.key), ['run~r1', 'run~r2']);
  assert.equal(made?.supplied.summary, undefined);
  assert.equal(made?.input.question, 'And now?', 'the rest of the input is the input');
  assert.equal(made?.input.maxSteps, 6);
  assert.equal(made?.input.summary, '');
});

test('what is supplied is named by the digest of what was given', () => {
  const made = supply({ messages: exchange(1) });
  assert.deepEqual(made?.supplied.exchanges, [
    {
      key: 'run~r1',
      digest: digest([
        { role: 'user', text: 'question 1' },
        { role: 'assistant', text: 'answer 1' }
      ])
    }
  ]);
});

test('what is not an exchange is not given: the run\'s own answer, a question nobody answered, an answer nobody asked, a blank', () => {
  const made = supply(
    {
      messages: [
        { role: 'assistant', text: 'an answer to nothing', runId: 'r0' },
        { role: 'user', text: 'unanswered' },
        ...exchange(1),
        { role: 'assistant', text: 'a second answer in a row', runId: 'r7' },
        { role: 'assistant', text: 'an answer with no run' },
        { role: 'assistant', text: 'and another with no run' },
        { role: 'user', text: 'the question of this run' },
        { role: 'assistant', text: 'the answer of this run', runId: 'now' },
        { role: 'user', text: 'a question with a blank answer' },
        { role: 'assistant', text: '   ', runId: 'r4' },
        { role: 'user', text: '  ' },
        { role: 'assistant', text: 'an answer to a blank question', runId: 'r5' }
      ]
    }
  );
  assert.deepEqual(given(made).history, ['question 1', 'answer 1']);
});

test('a question stored before its run exists is its answer\'s question, and one that belongs to another run is not', () => {
  const stored = supply({
    messages: [
      { role: 'user', text: 'asked before the run existed' },
      { role: 'assistant', text: 'answer', runId: 'r1' },
      { role: 'user', text: 'asked of run r2', runId: 'r2' },
      { role: 'assistant', text: 'answered by run r3', runId: 'r3' },
      { role: 'user', text: 'asked of run r4', runId: 'r4' },
      { role: 'assistant', text: 'answer of run r4', runId: 'r4' }
    ]
  });
  assert.deepEqual(given(stored).history, ['asked before the run existed', 'answer', 'asked of run r4', 'answer of run r4']);
});

test('an answer with no run is an answer, named by its message', () => {
  const made = supply({ messages: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }] });
  assert.deepEqual(made?.supplied.exchanges.map((each) => each.key), ['msg~m2']);
});

test('an answer named by its message is not taken for the answer of a run that has that name', () => {
  // The message is called `r9`, and so is a run whose record is clean. They are not the same.
  const messages: Say[] = [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }];
  const made = supply({ messages, ids: { 2: 'r9' }, records: [closed('r9', [entry(ACME)])], excluded: [GLOBEX] });
  assert.equal(made, undefined);
});

test('what the host sent is used as sent, and only a host that sent nothing is answered for', () => {
  const messages = exchange(1);
  const sent = [{ role: 'user', text: 'from the host' }];

  assert.equal(supply({ messages }, { ...ASKED, history: sent }), undefined, 'a history that was sent');
  assert.equal(supply({ messages }, { ...ASKED, summary: 'a note' }), undefined, 'a summary that was sent');
  assert.deepEqual(given(supply({ messages }, { ...ASKED, summary: '  \n ' })).history, ['question 1', 'answer 1'], 'a blank summary is none');
  assert.deepEqual(given(supply({ messages }, { question: 'q', history: [], summary: '' })).history, ['question 1', 'answer 1']);

  const note = supply({ messages, summary: 'the note', through: 0 }, { ...ASKED, summary: '' });
  assert.equal(note?.input.summary, 'the note');
});

test('a capability that does not keep a record, or takes no conversation, is not answered for', () => {
  const messages = exchange(1);
  assert.equal(supply({ messages }, ASKED, { capability: 'plain' }), undefined);
  assert.equal(supply({ messages }, ASKED, { capability: 'nobody' }), undefined);
  assert.equal(supply({ messages }, { question: 'q' }), undefined, 'a capability whose input has no history to fill');
  assert.equal(supply({ messages }, { question: 'q', history: [] }), undefined, 'nor a summary');
  assert.equal(supply({ messages }, { question: 'q', summary: '' }), undefined, 'nor one without a summary');
  assert.equal(supply({ messages }, ASKED, { conversationId: 'elsewhere' }), undefined, 'a conversation that is not stored');
});

test('with nothing to give, it gives nothing, and the input is left as it was', () => {
  assert.equal(supply({}), undefined);
  assert.equal(supply({ messages: [{ role: 'user', text: 'only the question' }] }), undefined);
  assert.equal(supply({ messages: exchange(1), through: 2 }), undefined, 'everything is in a summary that is not there');
});

test('a run is given the newest exchanges that fit, and the limit a host is held to', () => {
  const eight = Array.from({ length: 8 }, (_, at) => exchange(at + 1)).flat();
  const made = supply({ messages: eight });
  assert.equal((made?.input.history as unknown[]).length, 12, 'twelve turns');
  assert.deepEqual(made?.supplied.exchanges.map((each) => each.key), ['r3', 'r4', 'r5', 'r6', 'r7', 'r8'].map((run) => `run~${run}`));

  // What a host's own input is held to is what this one is held to.
  assert.ok(historySchema.safeParse(made?.input.history).success);

  const exact = supply({
    messages: [
      { role: 'user', text: 'q'.repeat(100) },
      { role: 'assistant', text: 'a'.repeat(HISTORY_BUDGET - 100), runId: 'r1' }
    ]
  });
  assert.equal(exact?.supplied.exchanges.length, 1, 'an exchange that exactly fills the budget fits');
  const over = supply({
    messages: [
      { role: 'user', text: 'q'.repeat(100) },
      { role: 'assistant', text: 'a'.repeat(HISTORY_BUDGET - 99), runId: 'r1' }
    ]
  });
  assert.equal(over, undefined, 'one character more does not');
});

test('what is oldest is what does not fit, and an older exchange is not kept behind a newer one that was left out', () => {
  const made = supply({
    messages: [
      ...exchange(1),
      { role: 'user', text: 'q'.repeat(2500) },
      { role: 'assistant', text: 'a'.repeat(3400), runId: 'r2' },
      { role: 'user', text: 'q'.repeat(100) },
      { role: 'assistant', text: 'a'.repeat(100), runId: 'r3' }
    ]
  });
  assert.deepEqual(made?.supplied.exchanges.map((each) => each.key), ['run~r3'], 'r2 is too big with r3, and r1 is not kept behind the hole');

  const fits = supply({
    messages: [
      ...exchange(1),
      { role: 'user', text: 'q'.repeat(2000) },
      { role: 'assistant', text: 'a'.repeat(2000), runId: 'r2' },
      { role: 'user', text: 'q'.repeat(100) },
      { role: 'assistant', text: 'a'.repeat(100), runId: 'r3' }
    ]
  });
  assert.deepEqual(fits?.supplied.exchanges.map((each) => each.key), ['run~r1', 'run~r2', 'run~r3']);
});

test('only what follows the summary is history, and the summary is given with how far it reaches', () => {
  const messages = [...exchange(1), ...exchange(2), ...exchange(3)];

  const some = supply({ messages, summary: 'The first two.', through: 4 });
  assert.deepEqual(given(some), { history: ['question 3', 'answer 3'], summary: 'The first two.' });
  assert.deepEqual(some?.supplied.summary, { through: 4, digest: digest('The first two.') });

  // The boundary is the question: one the note already holds is not also said as a turn.
  const edge = supply({ messages, summary: 'The first two.', through: 5 });
  assert.deepEqual(given(edge), { history: [], summary: 'The first two.' });

  const alone = supply({ messages: exchange(1), summary: 'A note.', through: 2 });
  assert.deepEqual(given(alone), { history: [], summary: 'A note.' });
  assert.deepEqual(alone?.supplied.exchanges, []);
});

test('a note that says nothing is not given', () => {
  const made = supply({ messages: exchange(1), summary: '  \n', through: 0 });
  assert.equal(made?.input.summary, '');
  assert.equal(made?.supplied.summary, undefined);
});

test('an answer with an address no record can hold is not given, and the rest still are', () => {
  const made = supply({ messages: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }, ...exchange(2)], ids: { 2: 'x'.repeat(2000) } });
  assert.deepEqual(given(made).history, ['question 2', 'answer 2']);
  assert.equal(historyRef(CHAT, 'run~r1'), `conversation:${CHAT}/history/run~r1`);
});

test('an answer built from what is excluded now is not given, and the others are', () => {
  const records = [closed('r1', [entry(GLOBEX)]), closed('r2', [entry(ACME)]), closed('r3', [entry(ROLE, { status: 'read' })])];
  const messages = [...exchange(1), ...exchange(2), ...exchange(3)];

  assert.deepEqual(given(supply({ messages, records })).history, ['question 1', 'answer 1', 'question 2', 'answer 2', 'question 3', 'answer 3'], 'nothing excluded');
  assert.deepEqual(given(supply({ messages, records, excluded: [GLOBEX] })).history, ['question 2', 'answer 2', 'question 3', 'answer 3']);
  assert.deepEqual(given(supply({ messages, records, excluded: [`cv:${CONTEXT}/experience`] })).history, ['question 3', 'answer 3'], 'a section covers its items');
  assert.deepEqual(given(supply({ messages, records, excluded: [`cv:${CONTEXT}/education`] })).history, ['question 1', 'answer 1', 'question 2', 'answer 2', 'question 3', 'answer 3'], 'a wall on a piece nothing touched');
});

test('an answer built on an answer that is withheld is withheld, through the history and through a summary', () => {
  const messages = [...exchange(1), ...exchange(2), ...exchange(3), ...exchange(4), ...exchange(5)];
  const records = [
    closed('r1', [entry(GLOBEX)]),
    closed('r2', [carries('run~r1')]),
    closed('r3', [carries('run~r2')]),
    // Given a summary of the first two answers (messages 1 to 4), r1 among them.
    closed('r4', [entry(`conversation:${CHAT}/summary`, { version: '4' })]),
    closed('r5', [entry(ACME)])
  ];

  const made = supply({ messages, records, excluded: [GLOBEX] });
  assert.deepEqual(given(made).history, ['question 5', 'answer 5']);

  // A summary that names no version is made from everything, and the first answer is in that.
  const unversioned = supply({
    messages: [...exchange(1), ...exchange(2)],
    records: [closed('r1', [entry(GLOBEX)]), closed('r2', [entry(`conversation:${CHAT}/summary`)])],
    excluded: [GLOBEX]
  });
  assert.equal(unversioned, undefined);

  // A summary of the first answer only leaves the second alone.
  const named = supply({
    messages: [...exchange(1), ...exchange(2), ...exchange(3)],
    records: [closed('r1', [entry(ACME)]), closed('r2', [entry(GLOBEX)]), closed('r3', [entry(`conversation:${CHAT}/summary`, { version: '2' })])],
    excluded: [GLOBEX]
  });
  assert.deepEqual(given(named).history, ['question 1', 'answer 1', 'question 3', 'answer 3'], 'r3 was given only what came to r1');
});

test('an answer carried in by the host, only read, or named by another conversation or another well, passes its taint to nothing', () => {
  const messages = [...exchange(1), ...exchange(2), ...exchange(3), ...exchange(4), ...exchange(5), ...exchange(6)];
  const records = [
    closed('r1', [entry(GLOBEX)]),
    closed('r2', [carries('run~r1', { origin: 'client' })]),
    closed('r3', [carries('run~r1', { status: 'read' })]),
    closed('r4', [entry('conversation:elsewhere/history/run~r1')]),
    closed('r5', [entry(`cv:${CHAT}/history/run~r1`)]),
    // The history as a whole, which names no answer.
    closed('r6', [entry(`conversation:${CHAT}/history`)])
  ];
  const turns = [2, 3, 4, 5, 6].flatMap((n) => [`question ${n}`, `answer ${n}`]);
  assert.deepEqual(given(supply({ messages, records, excluded: [GLOBEX] })).history, turns);
});

test('an answer given a summary is built on every answer the summary reaches, the last of them included', () => {
  const messages = [...exchange(1), ...exchange(2), ...exchange(3)];
  const records = (version: string) => [
    closed('r1', [entry(ACME)]),
    closed('r2', [entry(GLOBEX)]),
    closed('r3', [entry(`conversation:${CHAT}/summary`, { version })])
  ];

  // Message 4 is the answer of r2, and a summary of four messages holds it.
  assert.deepEqual(given(supply({ messages, records: records('4'), excluded: [GLOBEX] })).history, ['question 1', 'answer 1']);
  // A summary of three messages does not.
  assert.deepEqual(given(supply({ messages, records: records('3'), excluded: [GLOBEX] })).history, ['question 1', 'answer 1', 'question 3', 'answer 3']);
});

test('the summary is held back while an answer folded into it is, and not otherwise', () => {
  const messages = [...exchange(1), ...exchange(2), ...exchange(3)];
  const records = [closed('r1', [entry(GLOBEX)]), closed('r2', [entry(ACME)]), closed('r3', [entry(ACME)])];
  const base = { messages, records, summary: 'A note of the first two.', through: 4 };

  assert.equal(given(supply(base)).summary, 'A note of the first two.', 'nothing excluded');
  assert.equal(given(supply({ ...base, excluded: [GLOBEX] })).summary, '', 'an answer folded into it is withheld');
  assert.equal(given(supply({ ...base, excluded: [GLOBEX] })).history?.length, 2, 'what follows the summary is still given');
  assert.equal(supply({ ...base, excluded: [GLOBEX] })?.supplied.summary, undefined);
  assert.equal(given(supply({ ...base, excluded: [`cv:${CONTEXT}/education`] })).summary, 'A note of the first two.', 'a wall that reaches nothing');

  // An answer after the summary is not in it.
  assert.equal(
    given(supply({ messages, records: [closed('r1', [entry(ACME)]), closed('r2', [entry(ACME)]), closed('r3', [entry(GLOBEX)])], summary: 'A note.', through: 4, excluded: [GLOBEX] })).summary,
    'A note.'
  );
  // The answer at the last message the note reaches is in it.
  assert.equal(
    given(supply({ messages, records: [closed('r1', [entry(ACME)]), closed('r2', [entry(GLOBEX)]), closed('r3', [entry(ACME)])], summary: 'A note.', through: 4, excluded: [GLOBEX] })).summary,
    ''
  );
  assert.equal(
    given(supply({ messages, records: [closed('r1', [entry(ACME)]), closed('r2', [entry(GLOBEX)]), closed('r3', [entry(ACME)])], summary: 'A note.', through: 3, excluded: [GLOBEX] })).summary,
    'A note.',
    'that answer is message 4, and a note of three messages does not hold it'
  );
});

test('an answer that cannot be traced is given while nothing is excluded, and withheld from the moment something is', () => {
  /** The record of the run `r1`, in a state it has before it is closed. */
  const unsettled = (state: 'open' | 'suspended' | 'interrupted'): ConversationRecord => {
    const base = closed('r1', [entry(ACME)]);
    return { ...base, record: { ...base.record, state, outcome: undefined, closedAt: undefined } as ConversationRecord['record'] };
  };

  const cases: [string, Fixture][] = [
    ['no record', { records: [] }],
    ['a record still open', { records: [unsettled('open')] }],
    ['a record of a run that is parked', { records: [unsettled('suspended')] }],
    ['a record of a run that was cut short', { records: [unsettled('interrupted')] }],
    ['a capability that keeps no record', { records: [closed('r1', [entry(ACME)], 'plain')] }],
    ['a run that is gone', { records: [closed('r1', [entry(ACME)], null)] }],
    ['a capability that does not exist now', { records: [closed('r1', [entry(ACME)], 'nobody')] }]
  ];

  for (const [name, fixture] of cases) {
    const messages = exchange(1);
    assert.deepEqual(given(supply({ ...fixture, messages })).history, ['question 1', 'answer 1'], `${name}, nothing excluded`);
    assert.equal(supply({ ...fixture, messages, excluded: [GLOBEX] }), undefined, `${name}, something excluded`);
  }

  // No run at all is as untraceable as no record.
  const messages: Say[] = [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }];
  assert.deepEqual(given(supply({ messages })).history, ['q', 'a']);
  assert.equal(supply({ messages, excluded: [GLOBEX] }), undefined);

  // And the record is the one of that run, and not of another.
  assert.equal(supply({ messages: exchange(1), records: [closed('r2', [entry(ACME)])], excluded: [GLOBEX] }), undefined);
});

test('an answer is looked up in the conversation\'s own records, by the conversation it is asked for', () => {
  const asked: string[] = [];
  const read: string[] = [];
  const lookups = (id: string): readonly ConversationRecord[] => {
    asked.push(id);
    return [closed('r1', [entry(ACME)])];
  };
  const wallsOf = (id: string): readonly PieceRef[] => {
    asked.push(`walls ${id}`);
    return [];
  };
  const history = createHistory({
    conversations: {
      read: (id) => {
        read.push(id);
        return {
          conversation: { id, subject: { kind: 'profile', id: CONTEXT }, createdAt: 1, updatedAt: 1, messageCount: 2, summarisedThrough: 0 },
          messages: [
            { id: 'a', conversationId: id, seq: 1, role: 'user', text: 'q', createdAt: 1 },
            { id: 'b', conversationId: id, seq: 2, role: 'assistant', text: 'a', runId: 'r1', createdAt: 1 }
          ]
        };
      }
    },
    records: { byConversation: lookups },
    walls: wallsOf,
    capabilities: KNOWING
  });

  history.supply({ capability: 'ask', conversationId: 'wanted', runId: 'now', input: ASKED });
  assert.deepEqual(read, ['wanted']);
  assert.deepEqual([...asked].sort(), ['walls wanted', 'wanted']);
});

test('a run is given the conversation only when it has one', () => {
  const asked: unknown[] = [];
  const made = { input: { question: 'q', history: [{ role: 'user' as const, text: 'earlier' }] }, supplied: { exchanges: [] } };
  const history = {
    supply: (request: unknown) => {
      asked.push(request);
      return made;
    }
  };
  const input = { question: 'q', history: [] };

  assert.deepEqual(givenInput({ history }, 'ask', undefined, 'r1', input), { input });
  assert.deepEqual(asked, [], 'a run in no conversation does not ask');

  assert.equal(givenInput({ history }, 'ask', CHAT, 'r1', input), made);
  assert.deepEqual(asked, [{ capability: 'ask', conversationId: CHAT, runId: 'r1', input }]);

  assert.deepEqual(givenInput({}, 'ask', CHAT, 'r1', input), { input }, 'a runtime that keeps no conversation gives the input as it is');
});

/* ---------------------------------------------------------------- a chat run */

type Call = (tool: string, input: unknown) => Promise<unknown>;

type Options = {
  readonly probes?: CapabilityMap;
  readonly loop?: (request: ToolLoopRequest, call: Call) => Promise<string>;
  readonly on?: Scratch;
};

type Turn = {
  readonly runId: string;
  /** What the model was given of the conversation: the history, and the system text that carries the summary. */
  readonly history: string[];
  readonly system: string;
  readonly run: RunHandle;
};

type Runtime = {
  readonly s: Spine;
  readonly records: ReturnType<typeof createRecordStore>;
  readonly conversations: ReturnType<typeof createConversationStore>;
  readonly selections: ReturnType<typeof createSelectionStore>;
  /** Every request any model call was made with, as the text it carried. */
  readonly payloads: string[];
  everything(): string;
  exclude(...refs: string[]): void;
  clear(...refs: string[]): void;
  /** The host stores the question, a run answers it, and the host stores the answer. */
  turn(question: string, over?: { loop?: Options['loop']; answer?: string; input?: Record<string, unknown>; remember?: boolean }): Promise<Turn>;
  begin(input: Record<string, unknown>, capability?: string, over?: Omit<RunRequest, 'capability' | 'input'>): RunHandle;
  resume(runId: string): Promise<{ readonly data: Record<string, unknown> }>;
  dispose(): void;
};

/** A passage of the CV in the search index, placed in the job it was cut from. */
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

const passages = (revision: number): ChunkHit[] => [
  hit(revision, 0, `Rewrote the billing pipeline. ${CANARY.acme}`, { section: 'experience', entry: 0, company: 'Acme', title: 'Senior Engineer' }),
  hit(revision, 1, `Built the design system. ${CANARY.globex}`, { section: 'experience', entry: 1, company: 'Globex', title: 'Engineer' })
];

const runtime = (options: Options = {}): Runtime => {
  const payloads: string[] = [];
  const systems: string[] = [];
  const histories: string[][] = [];

  const taken = (request: { system?: string; prompt?: string; history?: readonly { text: string }[] }): void => {
    payloads.push(JSON.stringify({ system: request.system, prompt: request.prompt, history: request.history }));
    systems.push(request.system ?? '');
    histories.push((request.history ?? []).map((turn) => turn.text));
  };
  const received: unknown[] = [];
  const loop: { current: Options['loop'] } = { current: undefined };

  const call = (request: ToolLoopRequest): Call => async (name, input) => {
    const tool = request.tools.find((each) => each.name === name);
    assert.ok(tool, `the model was not granted ${name}`);
    const result = await tool.invoke(input);
    received.push(result);
    return result;
  };

  const s = spine({ ...capabilities, ...options.probes }, {
    ai: {
      generateObject: async (request) => {
        taken(request);
        assert.equal(request.step, 'plan', `nothing answers the step ${request.step ?? '(none)'}`);
        return { object: { tools: ['search_profile', 'read_cv'] } as never, finishReason: 'stop', usage: {} };
      },
      generateText: async (request) => {
        taken(request);
        return { text: 'x', finishReason: 'stop', usage: {} };
      },
      runToolLoop: async (request) => {
        taken(request);
        const text = await (loop.current ?? options.loop ?? (async () => 'An answer.'))(request, call(request));
        return { text, steps: 1, finishReason: 'stop', usage: {} };
      }
    },
    tools: createToolRegistry(defaultTools),
    ...(options.on === undefined ? {} : { on: options.on })
  });
  const generation = (): number =>
    (s.db.prepare('SELECT generation FROM cv_contexts WHERE id = ?').get(CONTEXT) as { generation: number }).generation;
  const revision = (): number => s.deps.documents.read(CONTEXT)?.revision ?? 0;

  if (options.on === undefined) {
    s.db.prepare("INSERT INTO cv_contexts (id, language, created_at, updated_at) VALUES (?, 'en', 1, 1)").run(CONTEXT);
    const conversation = s.db.prepare(
      'INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1)'
    );
    conversation.run(CHAT, 'profile', CONTEXT);
    conversation.run(OTHER_CHAT, 'profile', CONTEXT);
    s.deps.documents.update(CONTEXT, CV_KIND, () => BODY);
  }

  const retrieval: Retriever = { search: async () => passages(revision()) };
  const bound = () => bindCvScope(CONTEXT, { documents: s.deps.documents, retrieval, index: s.deps.index });
  const selections = createSelectionStore(s.db);
  const records = createRecordStore(s.db);
  const conversations = createConversationStore(s.db);
  const all = { ...capabilities, ...options.probes };

  const deps: RuntimeDeps = {
    ...s.deps,
    scopeCv: () => ({ ...bound(), contextGeneration: generation(), contextRevision: revision() }),
    grounding: { records, wells: defaultWells() },
    selection: selections,
    history: createHistory({ conversations, records, walls: (id) => selections.walls(id), capabilities: all })
  };

  const begin: Runtime['begin'] = (input, capability = 'ask_profile', over = { contextId: CONTEXT, conversationId: CHAT }) =>
    beginRun(deps, { capability, input, ...over });

  const change = (what: { exclude?: string[]; clear?: string[] }): void => {
    const { revision: expectedRevision } = selections.read(CHAT);
    const { applied } = selections.change(CHAT, { expectedRevision, exclude: what.exclude ?? [], clear: what.clear ?? [] });
    assert.ok(applied);
  };

  let turns = 0;

  return {
    s,
    records,
    conversations,
    selections,
    payloads,
    everything: () => `${payloads.join('\n')}\n${JSON.stringify(received)}`,
    exclude: (...refs) => change({ exclude: refs }),
    clear: (...refs) => change({ clear: refs }),
    turn: async (question, over = {}) => {
      turns += 1;
      const runId = `r${turns}`;
      conversations.append(CHAT, { role: 'user', text: question });
      loop.current = over.loop;

      const before = histories.length;
      const run = begin({ question, ...over.input }, 'ask_profile', { contextId: CONTEXT, conversationId: CHAT, runId });
      const settled = await run.settled;
      assert.deepEqual(settled.degraded, [], 'the run did not degrade');
      // The tool loop is the last model call of the run, and it is the one that was told the conversation.
      const at = histories.length - 1;
      assert.ok(at >= before, 'the run called the model');

      conversations.append(CHAT, { role: 'assistant', text: over.answer ?? `An answer to turn ${turns}.`, runId });
      return { runId, history: histories[at] ?? [], system: systems[at] ?? '', run };
    },
    begin,
    resume: (runId) => resumeRun(deps, { runId }) as Promise<{ readonly data: Record<string, unknown> }>,
    dispose: () => s.dispose()
  };
};

/** The model reads one job and says what it found there, as a model that answers from what it reads does. */
const readsJob = (company: string, canary: string): NonNullable<Options['loop']> => async (_request, call) => {
  await call('read_cv', { section: 'experience' });
  return `At ${company}: ${canary}.`;
};

/** The model answers without reading anything. */
const justAnswers = (text: string): NonNullable<Options['loop']> => async () => text;

test('an answer written from a piece that is excluded later is not handed back, nor is an answer built on it, and both come back when the exclusion is lifted', async () => {
  const rt = runtime();
  try {
    // 1 reads the second job and answers from it. 2 reads nothing and answers from turn 1. 3 and 4 never see either.
    const first = await rt.turn('What did I do at Globex?', { loop: readsJob('Globex', CANARY.globex), answer: `At Globex: ${CANARY.globex}.` });
    assert.deepEqual(first.history, [], 'the first turn has nothing before it');

    const second = await rt.turn('Say that again.', { loop: justAnswers('Fine.'), answer: `As before: ${CANARY.globex}.` });
    assert.deepEqual(second.history, ['What did I do at Globex?', `At Globex: ${CANARY.globex}.`], 'with nothing excluded the conversation is given whole');

    rt.exclude(GLOBEX);
    const mark = rt.payloads.length;

    // Neither of the two earlier answers is given, though turn 2 read nothing of its own.
    const third = await rt.turn('What did I do at Acme?', { loop: justAnswers('Ok.'), answer: `At Acme: ${CANARY.acme}.` });
    assert.deepEqual(third.history, []);

    const fourth = await rt.turn('And anything else?', { loop: justAnswers('No.') });
    assert.deepEqual(fourth.history, ['What did I do at Acme?', `At Acme: ${CANARY.acme}.`], 'the turn that was not built from it is given');

    const seen = rt.payloads.slice(mark).join('\n');
    assert.ok(!seen.includes(CANARY.globex), 'no payload after the exclusion carries the canary');
    assert.ok(!seen.includes('Globex'), 'nor the question that named it');

    rt.clear(GLOBEX);
    const fifth = await rt.turn('Where were we?', { loop: justAnswers('Here.') });
    assert.equal(fifth.history.length, 8, 'with the exclusion lifted, all four earlier exchanges are given again');
    assert.ok(fifth.history.join('\n').includes(CANARY.globex));
  } finally {
    rt.dispose();
  }
});

test('a search that placed a passage in an excluded job taints the answer as a read of the job does', async () => {
  const rt = runtime();
  try {
    await rt.turn('Billing?', {
      loop: async (_request, call) => {
        await call('search_profile', { query: 'billing' });
        return `Found: ${CANARY.globex}`;
      },
      answer: `Found: ${CANARY.globex}`
    });
    const apart = await rt.turn('Anything else?', { loop: justAnswers('No.') });
    assert.equal(apart.history.length, 2, 'nothing excluded');

    rt.exclude(GLOBEX);
    const mark = rt.payloads.length;
    const after = await rt.turn('Again?', { loop: justAnswers('Done.') });
    assert.deepEqual(after.history, [], 'turn 1 searched and was handed a passage of the excluded job, and turn 2 was given turn 1');
    assert.ok(!rt.payloads.slice(mark).join('\n').includes(CANARY.globex));
  } finally {
    rt.dispose();
  }
});

test('a turn that read only what is not excluded stays, and goes when what it read is excluded', async () => {
  const rt = runtime();
  try {
    await rt.turn('Who am I?', { loop: async (_request, call) => (await call('read_cv', { section: 'overview' }), 'An engineer.') });

    rt.exclude(GLOBEX);
    const stays = await rt.turn('Next?', { loop: justAnswers('Ok.') });
    assert.deepEqual(stays.history, ['Who am I?', 'An answer to turn 1.'], 'the overview is not under the job');

    rt.clear(GLOBEX);
    rt.exclude(ROLE);
    const goes = await rt.turn('Next again?', { loop: justAnswers('Ok.') });
    assert.deepEqual(goes.history, [], 'turn 1 read the description, and turn 2 was given turn 1');
  } finally {
    rt.dispose();
  }
});

test('an answer the record cannot account for is given while nothing is excluded, and withheld as soon as something is', async () => {
  const rt = runtime();
  try {
    await rt.turn('First?', { loop: justAnswers('First.') });

    // A host that stored an exchange with no run, as one that predates records did.
    rt.conversations.append(CHAT, { role: 'user', text: 'An old question.' });
    rt.conversations.append(CHAT, { role: 'assistant', text: `An old answer ${CANARY.globex}.` });

    const free = await rt.turn('A new one?', { loop: justAnswers('Ok.') });
    assert.deepEqual(free.history, ['First?', 'An answer to turn 1.', 'An old question.', `An old answer ${CANARY.globex}.`]);

    // The wall is on something these answers have nothing to do with, and the old one is withheld anyway.
    rt.exclude(ROLE);
    const mark = rt.payloads.length;
    const walled = await rt.turn('Once more?', { loop: justAnswers('Ok.') });
    assert.deepEqual(walled.history, ['First?', 'An answer to turn 1.'], 'what the record accounts for stays, and what was built on the old answer goes with it');
    assert.ok(!rt.payloads.slice(mark).join('\n').includes(CANARY.globex));
  } finally {
    rt.dispose();
  }
});

test('the summary the host stored is withheld while an answer folded into it is, and a newer one does not lift that', async () => {
  const rt = runtime();
  try {
    await rt.turn('What did I do at Globex?', { loop: readsJob('Globex', CANARY.globex), answer: `At Globex: ${CANARY.globex}.` });
    await rt.turn('And at Acme?', { loop: justAnswers('Ok.') });
    rt.conversations.summarise(CHAT, `They talked about ${CANARY.note}.`, 4);

    const before = await rt.turn('Go on.', { loop: justAnswers('Ok.') });
    assert.ok(before.system.includes(CANARY.note), 'the note is given while nothing is excluded');
    assert.deepEqual(before.history, [], 'what the note holds is not also history');

    rt.exclude(GLOBEX);
    const mark = rt.payloads.length;
    const walled = await rt.turn('Go on again.', { loop: justAnswers('Ok.') });
    assert.ok(!walled.system.includes(CANARY.note), 'the note is held back');
    assert.deepEqual(walled.history, [], 'turn 3 was given the note, so it is withheld with it');
    assert.ok(!rt.payloads.slice(mark).join('\n').includes(CANARY.note));

    // Written again, from the same answers: a different text with the same answer folded in.
    rt.conversations.summarise(CHAT, 'A fresh note, with nothing in it.', 6);
    const again = await rt.turn('Still?', { loop: justAnswers('Ok.') });
    assert.ok(!again.system.includes('A fresh note'), 'a newer note that holds the same answer is held back as well');
    assert.deepEqual(again.history, ['Go on again.', 'An answer to turn 4.'], 'what follows the note is given');

    rt.clear(GLOBEX);
    const lifted = await rt.turn('Now?', { loop: justAnswers('Ok.') });
    assert.ok(lifted.system.includes('A fresh note'), 'with the exclusion lifted the note is given');
  } finally {
    rt.dispose();
  }
});

test('the host\'s own history and summary are used as sent, and nothing of the stored conversation is added', async () => {
  const rt = runtime();
  try {
    await rt.turn('Stored question', { loop: justAnswers('Stored answer.') });
    rt.exclude(GLOBEX);

    const sent = [
      { role: 'user', text: 'Sent question' },
      { role: 'assistant', text: `Sent answer ${CANARY.globex}` }
    ];
    const made = await rt.turn('Next?', { loop: justAnswers('Ok.'), input: { history: sent, summary: 'A sent note.' } });
    assert.deepEqual(made.history, ['Sent question', `Sent answer ${CANARY.globex}`], 'outside the guarantee, and said to be');
    assert.ok(made.system.includes('A sent note.'));
    assert.ok(!made.history.includes('Stored question'));

    const entries = rt.records.read(made.runId)?.entries.filter((each) => each.via === 'input') ?? [];
    assert.deepEqual(
      entries.map((each) => [each.ref, each.origin]),
      [
        [`conversation:${CHAT}/history`, 'client'],
        [`conversation:${CHAT}/summary`, 'client']
      ]
    );
  } finally {
    rt.dispose();
  }
});

test('a run with no conversation, or in another one, is given nothing of this conversation', async () => {
  const rt = runtime();
  try {
    await rt.turn('A question', { loop: justAnswers('An answer.') });

    const bare = rt.begin({ question: 'Bare?' }, 'ask_profile', { contextId: CONTEXT });
    await bare.settled;
    const other = rt.begin({ question: 'Other?' }, 'ask_profile', { contextId: CONTEXT, conversationId: OTHER_CHAT });
    await other.settled;

    assert.ok(!rt.payloads.slice(-4).join('\n').includes('A question'), 'the question of the first conversation is in no payload of these runs');
    assert.equal(rt.records.read(bare.runId), undefined);
  } finally {
    rt.dispose();
  }
});

test('what the exclusions of another conversation reach is not this one\'s', async () => {
  const rt = runtime();
  try {
    await rt.turn('What did I do at Globex?', { loop: readsJob('Globex', CANARY.globex) });
    rt.selections.change(OTHER_CHAT, { expectedRevision: 0, exclude: [GLOBEX], clear: [] });

    const next = await rt.turn('Next?', { loop: justAnswers('Ok.') });
    assert.equal(next.history.length, 2, 'the other conversation excluded it, and this one did not');
  } finally {
    rt.dispose();
  }
});

/* ------------------------------------------------------------------- record */

test('what the runtime supplied is recorded as the runtime\'s, with how far the note reached', async () => {
  const rt = runtime();
  try {
    await rt.turn('First?', { loop: justAnswers('First.') });
    await rt.turn('Second?', { loop: justAnswers('Second.') });
    rt.conversations.summarise(CHAT, 'A note of the first exchange.', 2);
    const third = await rt.turn('Third?', { loop: justAnswers('Third.') });

    const entries = rt.records.read(third.runId)?.entries.filter((each) => each.via === 'input') ?? [];
    assert.deepEqual(
      entries.map((each) => [each.ref, each.version, each.origin, each.status]),
      [
        [`conversation:${CHAT}/history/run~r2`, undefined, 'server', 'included'],
        [`conversation:${CHAT}/summary`, '2', 'server', 'included']
      ]
    );

    const [exchange] = entries;
    assert.equal(
      exchange?.digest,
      digest([
        { role: 'user', text: 'Second?' },
        { role: 'assistant', text: 'An answer to turn 2.' }
      ])
    );
    assert.equal(entries[1]?.digest, digest('A note of the first exchange.'));
  } finally {
    rt.dispose();
  }
});

test('the input a run is stored with is the one it was sent, and not the one it was given', async () => {
  const rt = runtime();
  try {
    await rt.turn('First?', { loop: justAnswers('First.') });
    const second = await rt.turn('Second?', { loop: justAnswers('Second.') });

    assert.equal(second.history.length, 2, 'it was given the first exchange');
    const stored = rt.s.runs.get(second.runId)?.input as Record<string, unknown>;
    assert.equal(stored.question, 'Second?');
    assert.deepEqual(stored.history, [], 'a retry of the same request finds the same run');
    assert.equal(stored.summary, '');
  } finally {
    rt.dispose();
  }
});

test('the records of a conversation are its own, oldest first, each with the capability of its run', async () => {
  const rt = runtime();
  try {
    await rt.turn('First?', { loop: readsJob('Globex', CANARY.globex) });
    await rt.turn('Second?', { loop: justAnswers('Ok.') });
    const other = rt.begin({ question: 'Elsewhere?' }, 'ask_profile', { contextId: CONTEXT, conversationId: OTHER_CHAT, runId: 'elsewhere' });
    await other.settled;

    // The order is the order the runs began in, whatever their ids say.
    rt.s.db.prepare('UPDATE grounding_record SET opened_at = ? WHERE run_id = ?').run(200, 'r1');
    rt.s.db.prepare('UPDATE grounding_record SET opened_at = ? WHERE run_id = ?').run(100, 'r2');

    const found = rt.records.byConversation(CHAT);
    assert.deepEqual(found.map((each) => each.record.runId), ['r2', 'r1']);
    assert.deepEqual(found.map((each) => each.capability), ['ask_profile', 'ask_profile']);
    assert.ok(found.every((each) => each.record.conversationId === CHAT && each.record.state === 'closed'));

    const [, firstRecord] = found;
    assert.deepEqual(firstRecord?.record, rt.records.read('r1'));
    assert.ok((firstRecord?.record.entries.length ?? 0) > 1, 'the record of a run that read the CV holds what it read');
    // The entries are in the order they were recorded, which is the order `read` gives them.
    assert.deepEqual(firstRecord?.record.entries.map((each) => each.ref), rt.records.read('r1')?.entries.map((each) => each.ref));
    assert.deepEqual(rt.records.byConversation('nobody'), []);
    assert.deepEqual(rt.records.byConversation(OTHER_CHAT).map((each) => each.record.runId), ['elsewhere']);
  } finally {
    rt.dispose();
  }
});

/* --------------------------------------------------------------------- a wait */

/** A recorded capability that is given the conversation twice, with a wait for a person between. */
const parking = (): CapabilityMap => {
  const texts = (input: Readonly<Record<string, unknown>>): string[] => (input.history as { text: string }[]).map((turn) => turn.text);

  const sends = (context: StepContext): string[] => {
    context.record?.sent([{ field: 'history' }, { field: 'summary' }]);
    return texts(context.input);
  };

  return {
    probe: noop('probe', [], {
      recorded: true,
      input: z.object({ history: historySchema, summary: summarySchema }),
      // Planned from the input it is given, as `ask_profile` is, and it says what it was planned from.
      plan: (input) => ({
        capability: 'probe',
        source: 'declared',
        stages: [
          stage('before', [transform('first', async (context) => ({ before: sends(context) }))]),
          stage('ask', [
            transform('confirm', async (context) => {
              const decision = context.approvals.request({ key: 'go', kind: 'confirm', question: 'Go on?', payload: {} });
              return { went: decision.status };
            })
          ]),
          stage('after', [transform('second', async (context) => ({ after: sends(context), planned: texts(input) }))])
        ]
      })
    })
  };
};

test('a run that waited for a person is given the conversation as it is when it resumes, in a process that opens the same file', async () => {
  const first = runtime({ probes: parking() });
  let second: Runtime | undefined;
  try {
    // Earlier: one answer that read nothing, and one that read the second job.
    await first.turn('Anything first?', { loop: justAnswers('No.') });
    await first.turn('What did I do at Globex?', { loop: readsJob('Globex', CANARY.globex), answer: `At Globex: ${CANARY.globex}.` });

    const run = first.begin({}, 'probe', { contextId: CONTEXT, conversationId: CHAT, runId: 'waiting' });
    await assert.rejects(run.settled, (error: unknown) => isRunSuspension(error));

    // Excluded while the run is parked, by a window that has nothing to do with the process.
    first.exclude(GLOBEX);
    const [approval] = first.s.approvals.pending(run.runId);
    assert.ok(approval);
    first.s.approvals.decide(approval.id, { status: 'granted', decision: { confirmed: true }, decidedAt: Date.now() });

    second = runtime({ on: first.s.scratch, probes: parking() });
    const result = await second.resume(run.runId);

    assert.deepEqual(
      result.data.before,
      ['Anything first?', 'An answer to turn 1.', 'What did I do at Globex?', `At Globex: ${CANARY.globex}.`],
      'what it was given before the wait was given before the exclusion'
    );
    assert.deepEqual(
      result.data.after,
      ['Anything first?', 'An answer to turn 1.'],
      'what it is given after the wait leaves out what was excluded during it, and not what was not'
    );
    assert.deepEqual(result.data.planned, result.data.after, 'it is planned from what it is given');

    // What the first step sent was sent, and the record keeps it: whatever this run answers is built on it.
    const sent = (first.records.read('waiting')?.entries ?? []).filter((each) => each.via === 'input').map((each) => each.ref);
    assert.deepEqual(sent, [`conversation:${CHAT}/history/run~r1`, `conversation:${CHAT}/history/run~r2`]);
  } finally {
    second?.dispose();
    first.dispose();
  }
});

/* ------------------------------------------------------ the production runtime */

const job = (company: string, title: string) => ({ company, title, started: '2020', finished: null, highlights: ['One.'], skills: [] });

/** A recorded capability that says what it was given, and can say it read what it is told to. */
const reporting = (): CapabilityMap => ({
  probe: noop(
    'probe',
    [
      stage('only', [
        transform('say', async (context) => {
          const read = z.array(z.string()).parse(context.input.read ?? []);
          context.record?.add(read.map((ref) => entry(ref, { via: 'probe', digest: digest(ref) })));
          context.record?.sent([{ field: 'history' }, { field: 'summary' }]);
          return {
            history: (context.input.history as { text: string }[]).map((turn) => turn.text),
            summary: context.input.summary
          };
        })
      ])
    ],
    { recorded: true, input: z.object({ history: historySchema, summary: summarySchema, read: z.array(z.string()).default([]) }) }
  )
});

test('the production runtime keeps the conversation, withholds what an exclusion reaches, and does so after a restart', async () => {
  const s = scratch();
  const cv = createCvContextStore(s.db).create(randomUUID(), 'en');
  const open = () => createHarness({ databasePath: s.path, env: {}, capabilities: reporting() });
  let h = open();

  try {
    h.profile.replaceContext(cv.id, { experience: [job('Acme', 'Engineer'), job('Globex', 'Engineer')] }, 0);
    const chat = h.conversations.create({ kind: 'profile', id: cv.id });
    const elsewhere = h.conversations.create({ kind: 'profile', id: cv.id });
    const globex = `cv:${cv.id}/experience/globex~engineer`;
    const acme = `cv:${cv.id}/experience/acme~engineer`;

    /** The host stores the question, a run answers it, the host stores the answer. */
    const exchange = async (runId: string, read: string[]) => {
      h.conversations.append(chat.id, { role: 'user', text: `Question of ${runId}` });
      const run = await h.run({ capability: 'probe', input: { read }, contextId: cv.id, conversationId: chat.id, runId });
      h.conversations.append(chat.id, { role: 'assistant', text: `Answer of ${runId}`, runId });
      return run.data as { history: string[]; summary: string };
    };

    await exchange('b', [acme]);
    await exchange('a', [globex]);
    const before = await exchange('c', []);
    assert.deepEqual(before.history, ['Question of b', 'Answer of b', 'Question of a', 'Answer of a']);

    // Globex is excluded here, and Acme in another conversation of the same CV.
    assert.equal(h.selection.update(chat.id, { expectedRevision: 0, exclude: [globex] })?.applied, true);
    assert.equal(h.selection.update(elsewhere.id, { expectedRevision: 0, exclude: [acme] })?.applied, true);

    const during = await exchange('d', []);
    assert.deepEqual(during.history, ['Question of b', 'Answer of b'], 'a read the job, and c was given a; the other conversation\'s exclusion is not this one\'s');

    // Another process opens the same file, and the exclusion and the records are what they were.
    h.close();
    h = open();
    const after = await exchange('e', []);
    assert.deepEqual(after.history, ['Question of b', 'Answer of b', 'Question of d', 'Answer of d']);
  } finally {
    h.close();
    s.dispose();
  }
});
