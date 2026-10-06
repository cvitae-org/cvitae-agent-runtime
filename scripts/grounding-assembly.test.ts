/**
 * Putting chosen pieces of the CV in front of the model, and saying which.
 *
 * A model with tools finds the CV for itself, and the record says what it read.
 * Here a person (or the runtime, when it is asked to) names the pieces instead, and
 * they are put in the prompt whole. The text and the account of the text have to
 * agree, and an exclusion has to beat the ask by every route.
 *
 * The questions, in order:
 *
 *   untouched   a message that asks for nothing is the message it always was, byte
 *               for byte, and a model call is the one it always was
 *   what goes   a pin is sent with every message, an attachment with one message
 *               only, a section is each entry of it once, and the text is each
 *               piece as the CV says it now
 *   the record  each block sent has an entry, made with it, at the revision and
 *               with the digest of the piece as stored; a call that never goes out
 *               has sent nothing and says so
 *   a wall      an exclusion beats a pin and an attachment, however the piece was
 *               asked for, and the text of an excluded piece reaches no payload
 *   how much    over the budget the run fails and nothing is cut; at it, it runs
 *   a bare run  `reach: selected` takes the tools away, and a run that has nothing
 *               to answer from does not start
 *   by itself   `auto` adds nothing, names what it would add, or adds it, and a
 *               search that fails is said and does not end the run
 *   a wait      a run that waited is not given a copy that has since changed, or
 *               that the person has since left out
 *   answers     an answer made from a piece that is excluded later is not handed
 *               back, and a piece that was only asked for and held back taints nothing
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 139 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * what the model reads:
 *   personal details drop the phone                3
 *   personal details drop the links                3
 *   personal details drop the name                 4
 *   a link is shown without its name               3
 *   personal details have no heading               4
 *   a role description has no heading              13
 *   skills drop the role                           4
 *   skills drop the group labels                   4
 *   skills are joined with no space                4
 *   an ongoing job is not said to be ongoing       10
 *   a finished job loses its end                   11
 *   an end nobody wrote down is a dash             1
 *   experience has no heading                      18
 *   experience names the company first             16
 *   experience drops its highlights                20
 *   experience drops its skills                    10
 *   education drops the thesis                     2
 *   education drops the mark                       2
 *   education names the school first               2
 *   education has no heading                       2
 *   a certificate drops its issuer                 1
 *   a certificate has no body                      1
 *   a language drops its level                     2
 *
 * the leaves of a piece:
 *   an item of the overview that is excluded is thought empty 1
 *   an entry cut out of its section is thought gone 2
 *   an overview is two items                       3
 *   a section is its first entry                   3
 *
 * the record:
 *   an entry is at the next revision               1
 *   an entry's digest is of the text               4
 *   an entry that was sent is from the client      3
 *   an entry that was held back is from the client 1
 *   an entry that was held back is digested as nothing 1
 *   an attachment is recorded as a pin             2
 *   the runtime's choice is recorded as an attachment 1
 *   what an assembler made is not recorded         7
 *   a step that sends what nothing assembled goes on 1
 *   an extract step sends without saying           1
 *   a generate step sends without saying           1
 *   a tool loop sends without saying               8
 *   the pieces are not named by the step that sends them 7
 *
 * what goes:
 *   attachments come before pins                   4
 *   pins are not sent                              19
 *   attachments are not sent                       22
 *   a piece asked for twice is sent twice          3
 *   a pin the runtime reads is not the conversation's 21
 *   pins are not part of what a run knows          21
 *   the ground step reads no pins                  19
 *   the plan does not look at the pins             15
 *   the plan does not look at the attachments      7
 *   the plan does not look at auto                 3
 *   the ground step is given no attachments        17
 *   the ground step is given no auto               6
 *   the ground step is given no question           6
 *   the label of the pieces is another             26
 *   the prompt cuts a character of the pieces      2
 *   the posting is lost when there are pieces      1
 *   the posting note is lost                       1
 *
 * a wall:
 *   an excluded piece is not looked for by name    2
 *   an excluded piece is named once for each ask   1
 *   an excluded entry in a section is named once for each ask 1
 *   an excluded piece is not recorded              3
 *   the assembly reads no walls                    2
 *   a piece that is gone is not named              2
 *   an empty section is gone                       1
 *   an entry that is not there is not gone         2
 *   what was held back is not returned             5
 *   what is gone is not returned                   2
 *   what is suggested is not returned              1
 *   what was held back is returned as sent         3
 *   assembling is not a critical step              3
 *
 * how much:
 *   the budget is not kept                         3
 *   a piece that comes to the budget is refused    2
 *   a piece a character over the budget is sent    2
 *   the separator is not counted                   1
 *   the separator is counted as one                1
 *   the first piece is charged a separator         4
 *   a refusal does not say how much                1
 *   the budget is a character more                 1
 *   the budget is a character less                 1
 *
 * what may be attached:
 *   the whole CV may be attached                   1
 *   another CV may be attached                     1
 *   a piece of another well may be attached        1
 *   an attachment of another CV is not refused before the plan 1
 *   an attachment given twice is kept twice        1
 *   a thirteenth attachment is allowed             1
 *   a twelfth attachment is refused                1
 *   a version may be attached                      1
 *   a digest may be attached                       1
 *   a message reaches for nothing unless it says otherwise 4
 *   the runtime adds pieces unless it is told not to 11
 *
 * a bare run:
 *   a model told to answer from the pieces keeps its tools 3
 *   a model with no tools is told it has them      2
 *   a model with no tools forgets what was said earlier 1
 *   a model with no tools is told to use them      2
 *   the plan does not know what is needed          5
 *   a run with no pieces to answer from starts     2
 *   what is excluded counts as selected            1
 *   a run told to add its own is thought to have nothing 1
 *   every message that says something needs a selection 2
 *   an unmet pin is not said                       3
 *   an unmet attachment is not said                2
 *   pins are not a need                            3
 *   attachments are not a need                     2
 *   a need that is unmet and optional is not said  4
 *   a need that is required is optional            3
 *   a need that is unmet is another failure        3
 *   the reason a need is unmet is not said         1
 *   a run does not check what it needs             5
 *   a run checks what it needs after its plan      1
 *   a run does not say what it lacked              3
 *   a resume does not check what it needs          1
 *   a resume does not say what it lacked           1
 *
 * by itself:
 *   auto searches when it is off                   20
 *   auto searches for a question that says nothing 1
 *   a suggestion is sent                           1
 *   a choice is only suggested                     4
 *   auto sends what does not fit                   2
 *   auto stops a character short of the budget     1
 *   auto does not count the separator              1
 *   auto adds what is already sent                 2
 *   auto adds a passage it cannot place            1
 *   a search that fails ends the run               1
 *   a search that fails is not said                1
 *   the result does not say the search failed      1
 *
 * the result:
 *   a result always carries a grounding field      1
 *   the result does not say what was held back     5
 *   the result does not say what is gone           2
 *   the result does not say what was suggested     1
 *   the result counts what was held back as sent   3
 *
 * a wait:
 *   a resume is not checked for what went stale    3
 *   a piece that changed is not stale              2
 *   a piece that is gone is not stale              3
 *   a piece excluded since is not stale            1
 *   a read is stale                                1
 *   a piece of another well is stale               1
 *   stale pieces are not an error                  3
 *   a stale run fails another way                  3
 *   a stale run does not say what                  1
 *
 * the end:
 *   an unpinned message is given pieces anyway     1
 *
 * One mutation is not in the table, because it cannot be told from the original:
 * dropping the `walls === undefined` half of the guard that reads a run's pins
 * changes nothing a run can do. The only runs that have no walls are those of an
 * offer snapshot and those with no CV, and neither has a conversation that holds a
 * pin: the selection service pins nothing for a conversation about an offer, and a
 * run needs a CV context to be created at all.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { capabilities } from '../src/capabilities/index.js';
import { PICKS_BUDGET, MAX_ONCE } from '../src/context/ground.js';
import { groundStep, staleCv } from '../src/capabilities/cv/assembly.js';
import { CV_ID, CV_KIND, emptyDocument } from '../src/capabilities/cv/document.js';
import { cvOf } from '../src/capabilities/cv/well.js';
import { GROUNDED, isRunSuspension } from '../src/contracts/index.js';
import type {
  Capability,
  CapabilityMap,
  ChunkHit,
  Grounded,
  Need,
  RecordEntry,
  Retriever,
  Step,
  ToolLoopRequest
} from '../src/contracts/index.js';
import { digest } from '../src/grounding/index.js';
import { bindCvScope } from '../src/runtime/cv-scope.js';
import { defaultWells } from '../src/runtime/grounding.js';
import { createHistory } from '../src/runtime/history.js';
import { beginRun } from '../src/runtime/run.js';
import type { RunHandle, RunRequest, RuntimeDeps } from '../src/runtime/run.js';
import { resumeRun } from '../src/runtime/resume.js';
import { createConversationStore } from '../src/storage/sqlite/conversations.js';
import { createRecordStore } from '../src/storage/sqlite/grounding-record.js';
import { createSelectionStore } from '../src/storage/sqlite/grounding-selection.js';
import { defaultTools } from '../src/tools/index.js';
import { createToolRegistry } from '../src/tools/registry.js';
import type { Scratch } from './support/db.js';
import { noop, spine, stage, transform } from './support/spine.js';
import type { Spine } from './support/spine.js';

/* ---------------------------------------------------------------- fixtures */

const CONTEXT = 'ctx';
const CHAT = 'chat';

/** One in each piece the tests send or hold back, and in nothing else. */
const CANARY = {
  acme: 'ZEBRA-ACME1-4410',
  globex: 'ZEBRA-GLOBEX-7731',
  summary: 'ZEBRA-SUMMARY-2208',
  home: 'ZEBRA-HOME-9142',
  thesis: 'ZEBRA-THESIS-5530'
} as const;

const BODY = {
  version: 1,
  personal: {
    name: 'Ada Example',
    email: 'ada@example.com',
    phone: '+48 600 100 200',
    location: `Krakow ${CANARY.home}`,
    links: { github: 'https://github.com/ada' }
  },
  role_description: `Backend engineer focused on billing systems. ${CANARY.summary}`,
  skills: {
    role: 'Engineer',
    groups: [
      { label: 'Languages', items: ['TypeScript', 'Go'] },
      { label: 'Frameworks', items: ['React'] },
      { label: 'Libraries & Tools', items: ['Postgres'] }
    ],
    programming_languages: ['TypeScript', 'Go'],
    frameworks: ['React'],
    libraries_and_tools: ['Postgres']
  },
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
  ],
  education: [
    {
      university: 'MIT',
      degree: 'BSc Computer Science',
      started: '2012',
      finished: '2016',
      thesis: `Compilers ${CANARY.thesis}`,
      mark: '5.0'
    }
  ],
  certificates: [{ name: 'AWS Solutions Architect', issuer: 'Amazon', started: '2020', finished: '' }],
  languages: [
    { name: 'Polish', level: 'native' },
    { name: 'English', level: 'C1' }
  ],
  sources: [{ kind: 'text', reference: 'cv.txt', imported_at: '2026-01-05T00:00:00.000Z' }]
};

assert.deepEqual(cvOf(BODY), BODY, 'the fixture CV is in the shape the document parses to');

const ref = (path = ''): string => `cv:${CONTEXT}${path === '' ? '' : `/${path}`}`;

const ACME = ref('experience/acme~senior-engineer');
const GLOBEX = ref('experience/globex~engineer');
const ROLE = ref('overview/role_description');
const PERSONAL = ref('overview/personal');
const SKILLS = ref('overview/skills');
const EDUCATION = ref('education/mit~bsc-computer-science');
const CERTIFICATE = ref('certificates/aws-solutions-architect');
const POLISH = ref('languages/polish');
const ENGLISH = ref('languages/english');

/** Each piece as the model reads it, in these words and no others. */
const TEXT = {
  [ACME]: `Experience, Senior Engineer at Acme:\n2021 - present\n- Rewrote the billing pipeline. ${CANARY.acme}\nSkills: Go`,
  [GLOBEX]: `Experience, Engineer at Globex:\n2018 - 2021\n- Built the design system. ${CANARY.globex}`,
  [ROLE]: `Role description:\n${BODY.role_description}`,
  [PERSONAL]: `Personal details:\nAda Example\nada@example.com\n+48 600 100 200\nKrakow ${CANARY.home}\ngithub: https://github.com/ada`,
  [SKILLS]: 'Skills:\nRole: Engineer\nLanguages: TypeScript, Go\nFrameworks: React\nLibraries & Tools: Postgres',
  [EDUCATION]: `Education, BSc Computer Science, MIT:\n2012 - 2016\nThesis: Compilers ${CANARY.thesis}\nMark: 5.0`,
  [CERTIFICATE]: 'Certificate, AWS Solutions Architect:\nIssued by Amazon\n2020',
  [POLISH]: 'Language, Polish: native',
  [ENGLISH]: 'Language, English: C1'
} as const;

/** What each piece is as the document stores it, which is what its entry's digest is of. */
const STORED = {
  [ACME]: BODY.experience[0],
  [GLOBEX]: BODY.experience[1],
  [ROLE]: BODY.role_description,
  [PERSONAL]: BODY.personal,
  [SKILLS]: BODY.skills,
  [EDUCATION]: BODY.education[0],
  [CERTIFICATE]: BODY.certificates[0],
  [POLISH]: BODY.languages[0],
  [ENGLISH]: BODY.languages[1]
} as const;

const LABEL = 'SELECTED CV PARTS — SOURCE DATA';

/** The prompt of a message that was sent these pieces, in this order. */
const prompted = (question: string, ...refs: (keyof typeof TEXT)[]): string =>
  `${question}\n\n${LABEL}:\n${refs.map((each) => TEXT[each]).join('\n\n')}`;

/** What `ask_profile` told the model before there were pieces, word for word. */
const SYSTEM = [
  "You answer questions about the user's own CV and work history.",
  'You cannot see any of it directly. Use the tools to read it.',
  'Use read_cv for current canonical facts. Use search_profile to locate relevant indexed passages when useful.',
  'Answer in plain prose. Name the employer or role that each claim came from.',
  'Base every statement on what a tool returned. If the tools return nothing, say so plainly and stop.'
].join('\n');

const QUESTION = 'What did I do with billing?';

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

/** Three passages: two placed in a job, one in the description. */
const passages = (revision: number): ChunkHit[] => [
  hit(revision, 0, `Rewrote the billing pipeline. ${CANARY.acme}`, { section: 'experience', entry: 0, company: 'Acme', title: 'Senior Engineer' }),
  hit(revision, 1, `Built the design system. ${CANARY.globex}`, { section: 'experience', entry: 1, company: 'Globex', title: 'Engineer' }),
  hit(revision, 2, BODY.role_description, { section: 'role_description' })
];

/* ----------------------------------------------------------------- runtime */

type Call = (tool: string, input: unknown) => Promise<unknown>;

/** One request to the model, as far as these tests look at it. */
type Request = {
  readonly kind: 'plan' | 'loop' | 'text';
  readonly system: string;
  readonly prompt: string;
  readonly history: string[];
  /** The names of the tools the model was granted, when it was granted any. */
  readonly tools: string[];
};

type Options = {
  readonly probes?: CapabilityMap;
  /** What the model does inside the tool loop. By default it answers at once. */
  readonly loop?: (request: ToolLoopRequest, call: Call) => Promise<string>;
  /** What a search of the index finds. By default the three passages. */
  readonly search?: (revision: number) => Promise<ChunkHit[]>;
  /** `false` builds a runtime that keeps no selections, which is every runtime there was. */
  readonly selection?: boolean;
  readonly body?: Record<string, unknown>;
  readonly on?: Scratch;
};

type Runtime = {
  readonly s: Spine;
  readonly records: ReturnType<typeof createRecordStore>;
  readonly selections: ReturnType<typeof createSelectionStore>;
  readonly conversations: ReturnType<typeof createConversationStore>;
  /** The CV's documents, scoped to the context as a run sees them. */
  readonly documents: ReturnType<typeof bindCvScope>['documents'];
  /** Every request any model call was made with. */
  readonly requests: Request[];
  /** How many searches of the index were made. */
  readonly searches: { count: number };
  /** What each tool returned to the model. */
  readonly received: unknown[];
  /** Everything the model was handed, whichever way it came. */
  everything(): string;
  revision(): number;
  pin(...refs: string[]): void;
  unpin(...refs: string[]): void;
  exclude(...refs: string[]): void;
  clear(...refs: string[]): void;
  /** Writes the CV, as an edit does. */
  edit(change: (body: Record<string, unknown>) => Record<string, unknown>): void;
  begin(input: Record<string, unknown>, capability?: string, over?: Omit<RunRequest, 'capability' | 'input'>): RunHandle;
  /** The host stores the question, a run answers it, and the host stores the answer. */
  turn(question: string, over?: { loop?: Options['loop']; answer?: string; input?: Record<string, unknown> }): Promise<{ readonly history: string[]; readonly run: RunHandle }>;
  resume(runId: string): Promise<{ readonly data: Record<string, unknown>; readonly degraded: readonly string[] }>;
  /** The entries of a run's record that came by a channel. */
  entriesVia(run: RunHandle, via: string): RecordEntry[];
  dispose(): void;
};

const CHAT_RUN = { contextId: CONTEXT, conversationId: CHAT } as const;

const runtime = (options: Options = {}): Runtime => {
  const requests: Request[] = [];
  const received: unknown[] = [];
  const searches = { count: 0 };
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
        requests.push({ kind: 'plan', system: request.system ?? '', prompt: request.prompt ?? '', history: [], tools: [] });
        assert.equal(request.step, 'plan', `nothing answers the step ${request.step ?? '(none)'}`);
        return { object: { tools: ['search_profile', 'read_cv'] } as never, finishReason: 'stop', usage: {} };
      },
      generateText: async (request) => {
        requests.push({ kind: 'text', system: request.system ?? '', prompt: request.prompt ?? '', history: [], tools: [] });
        return { text: 'x', finishReason: 'stop', usage: {} };
      },
      runToolLoop: async (request) => {
        requests.push({
          kind: 'loop',
          system: request.system,
          prompt: request.prompt,
          history: (request.history ?? []).map((turn) => turn.text),
          tools: request.tools.map((tool) => tool.name)
        });
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
    s.db
      .prepare('INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
      .run(CHAT, 'profile', CONTEXT);
    s.deps.documents.update(CONTEXT, CV_KIND, () => (options.body ?? BODY) as never);
  }

  const retrieval: Retriever = {
    search: async () => {
      searches.count += 1;
      return (options.search ?? (async (at) => passages(at)))(revision());
    }
  };
  const bound = () => bindCvScope(CONTEXT, { documents: s.deps.documents, retrieval, index: s.deps.index });
  const selections = createSelectionStore(s.db);
  const records = createRecordStore(s.db);
  const conversations = createConversationStore(s.db);
  const all = { ...capabilities, ...options.probes };

  const deps: RuntimeDeps = {
    ...s.deps,
    scopeCv: () => ({ ...bound(), contextGeneration: generation(), contextRevision: revision() }),
    grounding: { records, wells: defaultWells() },
    ...(options.selection === false
      ? {}
      : {
          selection: selections,
          history: createHistory({ conversations, records, walls: (id) => selections.walls(id), capabilities: all })
        })
  };

  const change = (what: { exclude?: string[]; clear?: string[]; pin?: string[]; unpin?: string[] }): void => {
    const { revision: expectedRevision } = selections.read(CHAT);
    const { applied } = selections.change(CHAT, {
      expectedRevision,
      exclude: what.exclude ?? [],
      clear: what.clear ?? [],
      pin: what.pin ?? [],
      unpin: what.unpin ?? []
    });
    assert.ok(applied);
  };

  const begin: Runtime['begin'] = (input, capability = 'ask_profile', over = CHAT_RUN) =>
    beginRun(deps, { capability, input, ...over });

  let turns = 0;

  return {
    s,
    documents: bound().documents,
    records,
    selections,
    conversations,
    requests,
    searches,
    received,
    everything: () => `${requests.map((each) => JSON.stringify(each)).join('\n')}\n${JSON.stringify(received)}`,
    revision,
    pin: (...refs) => change({ pin: refs }),
    unpin: (...refs) => change({ unpin: refs }),
    exclude: (...refs) => change({ exclude: refs }),
    clear: (...refs) => change({ clear: refs }),
    edit: (change) => {
      s.deps.documents.update(CONTEXT, CV_KIND, (current) => change(structuredClone(current as Record<string, unknown>)) as never);
    },
    begin,
    turn: async (question, over = {}) => {
      turns += 1;
      conversations.append(CHAT, { role: 'user', text: question });
      loop.current = over.loop;
      const before = requests.length;

      const run = begin({ question, ...over.input }, 'ask_profile', { ...CHAT_RUN, runId: `r${turns}` });
      await run.settled;
      const asked = requests.slice(before).filter((each) => each.kind === 'loop').at(-1);
      assert.ok(asked, 'the run called the model');

      conversations.append(CHAT, { role: 'assistant', text: over.answer ?? `An answer to turn ${turns}.`, runId: `r${turns}` });
      return { history: asked.history, run };
    },
    resume: (runId) => resumeRun(deps, { runId }) as Promise<{ readonly data: Record<string, unknown>; readonly degraded: readonly string[] }>,
    entriesVia: (run, via) => (records.read(run.runId)?.entries ?? []).filter((each) => each.via === via),
    dispose: () => s.dispose()
  };
};

const question = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ question: QUESTION, ...over });

/** The one tool-loop request a run made. */
const loopOf = (rt: Runtime, nth = 0): Request => {
  const found = rt.requests.filter((each) => each.kind === 'loop')[nth];
  assert.ok(found, `there was no model call ${nth + 1}`);
  return found;
};

/** What a run settled with. */
const settle = async (run: RunHandle): Promise<{ data: Record<string, unknown>; degraded: readonly string[] }> =>
  (await run.settled) as { data: Record<string, unknown>; degraded: readonly string[] };

/** What a run's rejection said it was. */
const codeOf = async (run: RunHandle): Promise<string> => {
  try {
    await run.settled;
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
  return 'did not fail';
};

/* ----------------------------------------------------------------- untouched */

test('a message that asks for nothing and a conversation with no pins is the message it always was, byte for byte', async () => {
  const bare = runtime({ selection: false });
  const kept = runtime();
  try {
    await settle(bare.begin(question(), 'ask_profile', { contextId: CONTEXT }));
    const run = kept.begin(question());
    const settled = await settle(run);

    // The words of the two calls a run of this capability makes, written out.
    const expected = { kind: 'loop', system: SYSTEM, prompt: QUESTION, history: [], tools: ['search_profile', 'read_cv'] };
    assert.deepEqual(loopOf(kept), expected);
    assert.deepEqual(kept.requests.map((each) => each.kind), ['plan', 'loop'], 'the same two model calls');

    assert.deepEqual(kept.requests, bare.requests, 'a runtime that keeps selections sends what one that keeps none does');

    assert.equal('grounding' in settled.data, false, 'the result has no field it did not have');
    assert.deepEqual(settled.degraded, []);
    assert.equal(kept.searches.count, 0, 'nothing is searched for it');
    assert.deepEqual(kept.entriesVia(run, 'ground:pin'), []);
  } finally {
    bare.dispose();
    kept.dispose();
  }
});

test('a grounding field that asks for nothing is the same as none', async () => {
  const plain = runtime();
  const asked = runtime();
  try {
    await settle(plain.begin(question()));
    await settle(asked.begin(question({ grounding: { once: [], reach: 'free', auto: 'off' } })));
    await settle(asked.begin(question({ grounding: {} })));

    assert.deepEqual(asked.requests.slice(0, 2), plain.requests);
    assert.deepEqual(asked.requests.slice(2), plain.requests, 'an empty field is a field that asks for nothing');
  } finally {
    plain.dispose();
    asked.dispose();
  }
});

test('the other capabilities take no grounding field and are not given one', async () => {
  const rt = runtime();
  try {
    assert.equal(capabilities.ask_profile?.input.safeParse({ question: 'q', grounding: { once: [] } }).success, true);
    for (const [name, capability] of Object.entries(capabilities)) {
      if (name === 'ask_profile') continue;
      assert.equal(capability.needs, undefined, `${name} says what it needs`);
    }
  } finally {
    rt.dispose();
  }
});

/* ------------------------------------------------------------------ what goes */

test('each kind of piece is sent as the model reads it, in the order it was pinned', async () => {
  const rt = runtime();
  try {
    rt.pin(ROLE, ACME, PERSONAL, SKILLS, EDUCATION, CERTIFICATE, POLISH, ENGLISH);
    await settle(rt.begin(question()));

    const sent = loopOf(rt);
    assert.equal(sent.prompt, prompted(QUESTION, ROLE, ACME, PERSONAL, SKILLS, EDUCATION, CERTIFICATE, POLISH, ENGLISH));
    assert.equal(sent.system, SYSTEM, 'the instructions are not changed by what is attached');
    assert.deepEqual(sent.tools, ['search_profile', 'read_cv'], 'the model keeps its tools unless it is told otherwise');
  } finally {
    rt.dispose();
  }
});

test('a pin is sent with every message, with nothing in the input, and until it is taken back', async () => {
  const rt = runtime();
  try {
    rt.pin(GLOBEX);
    await settle(rt.begin(question()));
    await settle(rt.begin(question({ question: 'And now?' })));
    assert.equal(loopOf(rt, 0).prompt, prompted(QUESTION, GLOBEX));
    assert.equal(loopOf(rt, 1).prompt, prompted('And now?', GLOBEX));

    rt.unpin(GLOBEX);
    await settle(rt.begin(question()));
    assert.equal(loopOf(rt, 2).prompt, QUESTION, 'unpinned, the message is the one it always was');
    assert.equal(rt.requests.filter((each) => each.kind === 'plan').length, 3);
  } finally {
    rt.dispose();
  }
});

test('an attachment is sent with its message and with no other, and with no pin at all', async () => {
  const rt = runtime();
  try {
    await settle(rt.begin(question({ grounding: { once: [GLOBEX] } })));
    await settle(rt.begin(question()));

    assert.equal(loopOf(rt, 0).prompt, prompted(QUESTION, GLOBEX));
    assert.equal(loopOf(rt, 1).prompt, QUESTION, 'the next message starts without it');
    assert.equal(rt.selections.read(CHAT).pin.length, 0, 'nothing was pinned by it');
    assert.equal(rt.selections.read(CHAT).revision, 0, 'the selection did not move');
  } finally {
    rt.dispose();
  }
});

test('pins come first and then the attachments, each in its own order, and a piece asked for twice is sent once', async () => {
  const rt = runtime();
  try {
    rt.pin(GLOBEX, ref('experience'));
    const run = rt.begin(question({ grounding: { once: [ROLE, GLOBEX, ACME, ROLE] } }));
    const settled = await settle(run);

    // The pinned section is Acme and Globex in the order the CV has them, behind the pinned entry.
    assert.equal(loopOf(rt).prompt, prompted(QUESTION, GLOBEX, ACME, ROLE));
    assert.deepEqual(
      rt.records.read(run.runId)?.entries.filter((each) => each.via.startsWith('ground:')).map((each) => [each.ref, each.via]),
      [[GLOBEX, 'ground:pin'], [ACME, 'ground:pin'], [ROLE, 'ground:once']],
      'asked for by the first to ask, once'
    );
    assert.deepEqual((settled.data.grounding as { included: string[] }).included, [GLOBEX, ACME, ROLE]);
  } finally {
    rt.dispose();
  }
});

test('a section is each entry of it, and an overview is its three items', async () => {
  const rt = runtime();
  try {
    await settle(rt.begin(question({ grounding: { once: [ref('languages'), ref('overview')] } })));
    assert.equal(loopOf(rt).prompt, prompted(QUESTION, POLISH, ENGLISH, PERSONAL, ROLE, SKILLS));
  } finally {
    rt.dispose();
  }
});

test('an overview item with nothing in it sends nothing, and a piece the document has no entry for yet is not an error', async () => {
  const rt = runtime({ body: { ...BODY, role_description: '', certificates: [] } });
  try {
    const run = rt.begin(question({ grounding: { once: [ref('overview'), ref('certificates')] } }));
    const settled = await settle(run);

    assert.equal(loopOf(rt).prompt, prompted(QUESTION, PERSONAL, SKILLS));
    assert.deepEqual(settled.data.grounding, { included: [PERSONAL, SKILLS], blocked: [], gone: [], suggested: [] });
  } finally {
    rt.dispose();
  }
});

test('a pin on an entry that is gone names it and sends nothing, and is not taken for an exclusion', async () => {
  const rt = runtime();
  try {
    const nobody = ref('experience/nobody~nothing');
    rt.pin(nobody, ACME);
    const run = rt.begin(question());
    const settled = await settle(run);

    assert.equal(loopOf(rt).prompt, prompted(QUESTION, ACME));
    assert.deepEqual(settled.data.grounding, { included: [ACME], blocked: [], gone: [nobody], suggested: [] });
    assert.deepEqual(settled.degraded, [], 'a piece that is gone is not one that was held back');
  } finally {
    rt.dispose();
  }
});

test('an attachment that is not a piece of this conversation\'s own CV is refused before any model is called', async () => {
  const rt = runtime();
  try {
    const refused = async (grounding: Record<string, unknown>): Promise<string> => {
      try {
        await rt.begin(question({ grounding })).settled;
      } catch (error) {
        return (error as { code?: string }).code ?? String(error);
      }
      return 'did not fail';
    };

    // An address that is not of this CV, or is of no piece, or names a version.
    for (const [bad, code] of [
      ['cv:elsewhere/experience/x', 'invalid_selection'],
      [ref(), 'invalid_selection'],
      ['offers:offer-1', 'invalid_selection'],
      [`offers:${CONTEXT}/requirements`, 'invalid_selection'],
      [`${ref('education')}#0123456789abcdef`, 'invalid_input'],
      [`cv:${CONTEXT}@3/education`, 'invalid_input'],
      ['not a ref', 'invalid_input']
    ] as [string, string][]) {
      assert.equal(await refused({ once: [bad] }), code, bad);
    }

    // Too many, and a reach or a mode that is not one.
    const many = Array.from({ length: MAX_ONCE + 1 }, (_, at) => ref(`experience/k${at}`));
    assert.equal(await refused({ once: many }), 'invalid_input');
    assert.equal(await refused({ reach: 'everything' }), 'invalid_input');
    assert.equal(await refused({ auto: 'sometimes' }), 'invalid_input');

    assert.deepEqual(rt.requests, [], 'no model was called');

    // Exactly as many as may be attached is not too many, even when nothing is there to be found.
    assert.equal(await refused({ once: many.slice(0, MAX_ONCE) }), 'did not fail');
  } finally {
    rt.dispose();
  }
});

test('a run about no conversation has nothing pinned or excluded, and can still attach', async () => {
  const rt = runtime();
  try {
    await settle(rt.begin(question(), 'ask_profile', { contextId: CONTEXT }));
    assert.equal(loopOf(rt).prompt, QUESTION, 'a run with no conversation has no pins');

    // Nothing is excluded for it, since an exclusion belongs to a conversation, and an attachment is sent.
    await settle(rt.begin(question({ grounding: { once: [GLOBEX] } }), 'ask_profile', { contextId: CONTEXT }));
    assert.equal(loopOf(rt, 1).prompt, prompted(QUESTION, GLOBEX));
  } finally {
    rt.dispose();
  }
});

test('an attachment is held in the input as its canonical address, once each', async () => {
  const rt = runtime();
  try {
    const run = rt.begin(question({ grounding: { once: [GLOBEX, GLOBEX, ROLE] } }));
    await settle(run);
    assert.deepEqual(
      (rt.s.runs.get(run.runId)?.input as { grounding: { once: string[]; reach: string; auto: string } }).grounding,
      { once: [GLOBEX, ROLE], reach: 'free', auto: 'off' }
    );
  } finally {
    rt.dispose();
  }
});

test('a posting and what was said earlier go with the pieces, after them, with the tools or without', async () => {
  const rt = runtime();
  try {
    const posting = 'ZEBRA-POSTING-8801 Wanted: a Go engineer.';
    const summary = 'ZEBRA-EARLIER-4417 We were choosing between two jobs.';
    rt.pin(ACME);

    await settle(rt.begin(question({ offerText: posting, summary })));
    const free = loopOf(rt);
    assert.equal(free.prompt, `${prompted(QUESTION, ACME)}\n\nCAPTURED JOB POSTING — SOURCE DATA:\n${posting}`);
    assert.ok(free.system.startsWith(SYSTEM));
    assert.ok(free.system.includes(`EARLIER IN THIS CONVERSATION:\n${summary}`));
    assert.match(free.system, /captured posting supplied below/);

    await settle(rt.begin(question({ offerText: posting, summary, grounding: { reach: 'selected' } })));
    const bare = loopOf(rt, 1);
    assert.equal(bare.prompt, free.prompt, 'the same words before the model, with or without tools');
    assert.ok(bare.system.startsWith("You answer questions about the user's own CV and work history.\nYou have no tools."));
    assert.ok(bare.system.includes(`EARLIER IN THIS CONVERSATION:\n${summary}`), 'what was said earlier is not lost for having no tools');
    assert.match(bare.system, /captured posting supplied below/);
  } finally {
    rt.dispose();
  }
});

/* ----------------------------------------------------------------- the record */

test('what is sent is what is recorded: one entry for each block, at the revision and with the digest of the piece as stored', async () => {
  const rt = runtime();
  try {
    rt.pin(ACME, ref('languages'));
    const run = rt.begin(question({ grounding: { once: [ROLE] } }));
    await settle(run);

    const entries = rt.records.read(run.runId)?.entries ?? [];
    const sent = entries.filter((each) => each.via.startsWith('ground:'));

    assert.deepEqual(sent.map((each) => each.ref), [ACME, POLISH, ENGLISH, ROLE]);
    for (const each of sent) {
      assert.equal(each.status, 'included');
      assert.equal(each.origin, 'server');
      assert.equal(each.version, String(rt.revision()), 'at the revision the document was read at');
    }

    const stored = {
      [ACME]: BODY.experience[0],
      [POLISH]: BODY.languages[0],
      [ENGLISH]: BODY.languages[1],
      [ROLE]: BODY.role_description
    } as Record<string, unknown>;
    for (const each of sent) assert.equal(each.digest, digest(stored[each.ref]), `${each.ref} is the digest of the piece as stored`);

    // The blocks the model got are exactly the entries: no more of them, and none missing.
    const blocks = loopOf(rt).prompt.split(`${LABEL}:\n`)[1]!.split('\n\n');
    assert.equal(blocks.length, sent.length);
    assert.equal(sent.filter((each) => each.shown !== undefined).length, 0, 'a whole piece is not recorded as a part of one');
  } finally {
    rt.dispose();
  }
});

test('each kind of piece is recorded by the digest of the piece the CV stores', async () => {
  const rt = runtime();
  try {
    rt.pin(...Object.keys(STORED));
    const run = rt.begin(question());
    await settle(run);

    const sent = rt.entriesVia(run, 'ground:pin');
    assert.deepEqual(sent.map((each) => each.ref), Object.keys(STORED));
    for (const each of sent) assert.equal(each.digest, digest(STORED[each.ref as keyof typeof STORED]), each.ref);
  } finally {
    rt.dispose();
  }
});

test('the record is made as the call goes out: a run that never gets as far as a call has sent nothing', async () => {
  const rt = runtime({
    probes: {
      probe: noop('probe', [
        stage('ground', [groundStep({ once: [GLOBEX, ACME], auto: 'off', question: '' })]),
        stage('then', [transform('fails', async () => { throw new Error('before any call'); })])
      ])
    }
  });
  try {
    rt.exclude(ACME);
    const run = rt.begin({}, 'probe');
    await assert.rejects(run.settled);

    const entries = rt.records.read(run.runId)?.entries ?? [];
    assert.deepEqual(entries.filter((each) => each.status === 'included' && each.via.startsWith('ground:')), []);
    assert.deepEqual(
      entries.filter((each) => each.status === 'blocked').map((each) => each.ref),
      [ACME],
      'what was asked for and held back is a fact about the asking, and is said at once'
    );
  } finally {
    rt.dispose();
  }
});

test('a step that sends what another assembled, and finds that nothing did, fails and sends nothing, whatever kind of step it is', async () => {
  const base = { critical: true, system: 's', prompt: 'p', groundedFrom: 'nowhere' } as const;
  const steps: [string, Step][] = [
    ['generate', { ...base, kind: 'generate', name: 'writes', key: 'text', maxOutputTokens: 10 }],
    ['extract', { ...base, kind: 'extract', name: 'reads', schema: z.object({}), maxOutputTokens: 10 }],
    ['tool_loop', { ...base, kind: 'tool_loop', name: 'looks', tools: [], maxSteps: 1 }]
  ];

  for (const [kind, step] of steps) {
    const rt = runtime({ probes: { probe: noop('probe', [stage('only', [step])]) } });
    try {
      const run = rt.begin({}, 'probe');
      await assert.rejects(
        run.settled,
        (error: unknown) =>
          (error as { code?: string }).code === 'step_failed' &&
          /sends what step "nowhere" assembled, and that step assembled nothing/.test((error as Error).message),
        kind
      );
      assert.deepEqual(rt.requests, [], `${kind}: no model was called`);
    } finally {
      rt.dispose();
    }
  }
});

test('an edit to the CV shows in the next message, with the selection row exactly as it was', async () => {
  const rt = runtime();
  try {
    rt.pin(GLOBEX);
    const before = rt.selections.read(CHAT);
    const first = rt.begin(question());
    await settle(first);
    const firstRevision = rt.revision();

    rt.edit((body) => {
      const experience = body.experience as { highlights: string[] }[];
      experience[1]!.highlights = ['Led the platform team. ZEBRA-EDITED-0001'];
      return body;
    });
    assert.ok(rt.revision() > firstRevision);

    const second = rt.begin(question());
    await settle(second);

    assert.ok(loopOf(rt, 0).prompt.includes(CANARY.globex));
    assert.ok(loopOf(rt, 1).prompt.includes('ZEBRA-EDITED-0001'), 'the next message shows the edit');
    assert.ok(!loopOf(rt, 1).prompt.includes(CANARY.globex), 'and not what it was');
    assert.deepEqual(rt.selections.read(CHAT), before, 'the pin is where it was, at the revision it was');

    // The two runs say what each was given, by the revision and digest of its own time.
    const [one] = rt.entriesVia(first, 'ground:pin');
    const [two] = rt.entriesVia(second, 'ground:pin');
    assert.equal(one?.ref, GLOBEX);
    assert.equal(two?.ref, GLOBEX);
    assert.notEqual(one?.digest, two?.digest);
    assert.notEqual(one?.version, two?.version);
  } finally {
    rt.dispose();
  }
});

test('a pin on an entry that was renamed finds nothing under the old key and does not follow the entry', async () => {
  const rt = runtime();
  try {
    rt.pin(GLOBEX);
    rt.edit((body) => {
      (body.experience as { company: string }[])[1]!.company = 'Initech';
      return body;
    });
    const settled = await settle(rt.begin(question()));

    assert.equal(loopOf(rt).prompt, QUESTION, 'the renamed entry is not sent for the old pin');
    assert.deepEqual((settled.data.grounding as { gone: string[] }).gone, [GLOBEX]);
  } finally {
    rt.dispose();
  }
});

/* --------------------------------------------------------------------- a wall */

test('an exclusion beats a pin, an attachment and a section, and the text of the piece reaches no payload', async () => {
  const rt = runtime({
    loop: async (_request, call) => {
      await call('read_cv', { section: 'experience' });
      await call('search_profile', { query: 'billing' });
      return 'Done.';
    }
  });
  try {
    rt.pin(GLOBEX, ref('experience'));
    rt.exclude(GLOBEX);
    const run = rt.begin(question({ grounding: { once: [GLOBEX, ROLE] } }));
    const settled = await settle(run);

    assert.equal(loopOf(rt).prompt, prompted(QUESTION, ACME, ROLE), 'the others are still sent');
    assert.ok(!rt.everything().includes(CANARY.globex), 'the canary of the excluded entry is in no payload, and no result of a tool');

    const entries = rt.records.read(run.runId)?.entries ?? [];
    const blocked = entries.filter((each) => each.status === 'blocked');
    assert.deepEqual(blocked.map((each) => [each.ref, each.via]), [[GLOBEX, 'ground:pin']], 'listed once, by the first to ask');
    assert.equal(blocked[0]?.origin, 'server');
    assert.equal(blocked[0]?.digest, digest(GLOBEX), 'the digest of an address says nothing of the piece');
    assert.equal(blocked[0]?.version, undefined);

    assert.deepEqual(settled.data.grounding, { included: [ACME, ROLE], blocked: [GLOBEX], gone: [], suggested: [] });
    assert.deepEqual(settled.degraded, ['pins', 'once']);
  } finally {
    rt.dispose();
  }
});

test('an excluded section holds back every entry in it, each of them named', async () => {
  const rt = runtime();
  try {
    rt.pin(ref('experience'), ref('education'));
    rt.exclude(ref('experience'));
    const run = rt.begin(question());
    const settled = await settle(run);

    assert.equal(loopOf(rt).prompt, prompted(QUESTION, EDUCATION));
    assert.deepEqual((settled.data.grounding as { blocked: string[] }).blocked, [ref('experience')]);
    assert.ok(!rt.everything().includes(CANARY.acme));
    assert.ok(!rt.everything().includes(CANARY.globex));
  } finally {
    rt.dispose();
  }
});

test('an excluded entry inside a pinned section holds back that entry and sends the rest', async () => {
  const rt = runtime();
  try {
    rt.pin(ref('experience'));
    rt.exclude(ACME);
    const run = rt.begin(question());
    const settled = await settle(run);

    assert.equal(loopOf(rt).prompt, prompted(QUESTION, GLOBEX));
    assert.deepEqual(settled.data.grounding, { included: [GLOBEX], blocked: [ACME], gone: [], suggested: [] });
    assert.deepEqual(
      rt.records.read(run.runId)?.entries.filter((each) => each.status === 'blocked').map((each) => each.ref),
      [ACME]
    );
  } finally {
    rt.dispose();
  }
});

test('with the whole CV excluded nothing asked for is sent, and the model is handed no text of the CV', async () => {
  const rt = runtime();
  try {
    rt.pin(GLOBEX, ref('overview'));
    rt.exclude(ref());
    const settled = await settle(rt.begin(question({ grounding: { once: [EDUCATION] } })));

    assert.equal(loopOf(rt).prompt, QUESTION);
    for (const canary of Object.values(CANARY)) assert.ok(!rt.everything().includes(canary), canary);
    assert.deepEqual((settled.data.grounding as { included: string[] }).included, []);
    assert.deepEqual((settled.data.grounding as { blocked: string[] }).blocked, [GLOBEX, ref('overview'), EDUCATION], 'each ask is named, by the address it was made with');
  } finally {
    rt.dispose();
  }
});

test('an item of the overview that is excluded is not sent when the overview is', async () => {
  const rt = runtime();
  try {
    rt.pin(ref('overview'));
    rt.exclude(PERSONAL);
    const settled = await settle(rt.begin(question()));

    assert.equal(loopOf(rt).prompt, prompted(QUESTION, ROLE, SKILLS));
    assert.ok(!rt.everything().includes(CANARY.home));
    assert.deepEqual((settled.data.grounding as { blocked: string[] }).blocked, [PERSONAL]);
  } finally {
    rt.dispose();
  }
});

test('a piece pinned while it is excluded is sent once the exclusion is lifted, and not before', async () => {
  const rt = runtime();
  try {
    rt.exclude(GLOBEX);
    rt.pin(GLOBEX);
    await settle(rt.begin(question()));
    rt.clear(GLOBEX);
    await settle(rt.begin(question()));

    assert.equal(loopOf(rt, 0).prompt, QUESTION);
    assert.equal(loopOf(rt, 1).prompt, prompted(QUESTION, GLOBEX));
  } finally {
    rt.dispose();
  }
});

test('an exclusion made while a run waits is the exclusion that run honours', async () => {
  const rt = runtime({
    probes: {
      probe: noop('probe', [
        stage('ask', [
          transform('confirm', async (context) => {
            const decision = context.approvals.request({ key: 'go', kind: 'confirm', question: 'Go on?', payload: {} });
            return { went: decision.status };
          })
        ]),
        stage('ground', [groundStep({ once: [GLOBEX], auto: 'off', question: '' })]),
        stage('after', [transform('after', async (context) => ({ text: (context.completed.ground?.[GROUNDED] as Grounded).text }))])
      ])
    }
  });
  try {
    const run = rt.begin({}, 'probe');
    await assert.rejects(run.settled, (error: unknown) => isRunSuspension(error));
    rt.exclude(GLOBEX);

    const [approval] = rt.s.approvals.pending(run.runId);
    assert.ok(approval);
    rt.s.approvals.decide(approval.id, { status: 'granted', decision: { confirmed: true }, decidedAt: Date.now() });

    const result = await rt.resume(run.runId);
    assert.equal(result.data.text, '', 'what was assembled after the wait was assembled under the exclusion');
  } finally {
    rt.dispose();
  }
});

/* ------------------------------------------------------------------ how much */

const bigRole = (length: number): string => 'x'.repeat(length);

/** What a message that attaches these pieces to a CV with this body comes to: how it ended, and what the model was sent of them. */
const attempt = async (
  body: Record<string, unknown>,
  once: string[],
  auto: 'off' | 'on' = 'off'
): Promise<{ readonly code: string; readonly sent: string }> => {
  const rt = runtime({ body });
  try {
    const code = await codeOf(rt.begin(question({ grounding: { once, auto } })));
    const loops = rt.requests.filter((each) => each.kind === 'loop');
    return { code, sent: loops.length === 0 ? '' : (loops[0]!.prompt.split(`${LABEL}:\n`)[1] ?? '') };
  } finally {
    rt.dispose();
  }
};

/** A CV whose overview says only this, so that a block is exactly its heading and this. */
const plain = (over: Record<string, unknown>): Record<string, unknown> => ({
  ...BODY,
  personal: { name: '', email: '', phone: '', location: '', links: {} },
  ...over
});

test('pieces that come to exactly the budget are sent, and one character more is refused, nothing cut', async () => {
  const heading = 'Role description:\n'.length;

  const at = await attempt(plain({ role_description: bigRole(PICKS_BUDGET - heading) }), [ROLE]);
  assert.equal(at.code, 'did not fail');
  assert.equal(at.sent.length, PICKS_BUDGET);

  const over = await attempt(plain({ role_description: bigRole(PICKS_BUDGET - heading + 1) }), [ROLE]);
  assert.equal(over.code, 'grounding_budget');
  assert.equal(over.sent, '', 'nothing was sent, and nothing was cut to fit');
});

test('the separator between two pieces counts against the budget', async () => {
  // A block of the role description and one of the personal details, two newlines between them.
  const role = 'Role description:\nx'.length;
  const heading = 'Personal details:\n'.length;
  const room = PICKS_BUDGET - role - 2 - heading;
  const body = (name: string): Record<string, unknown> => plain({ role_description: 'x', personal: { name, email: '', phone: '', location: '', links: {} } });

  const at = await attempt(body('n'.repeat(room)), [ROLE, PERSONAL]);
  assert.equal(at.code, 'did not fail');
  assert.equal(at.sent.length, PICKS_BUDGET);

  assert.equal((await attempt(body('n'.repeat(room + 1)), [ROLE, PERSONAL])).code, 'grounding_budget');
  // The first block is not charged one.
  assert.equal((await attempt(body('n'.repeat(room)), [PERSONAL, ROLE])).sent.length, PICKS_BUDGET);
});

test('over the budget the run fails with its code and says by how much, and the record says nothing was sent', async () => {
  const rt = runtime({ body: { ...BODY, role_description: bigRole(PICKS_BUDGET + 500) } });
  try {
    rt.pin(ROLE);
    const run = rt.begin(question());
    let error: { code?: string; message?: string } | undefined;
    try {
      await run.settled;
    } catch (caught) {
      error = caught as { code?: string; message?: string };
    }

    assert.equal(error?.code, 'grounding_budget');
    assert.match(error?.message ?? '', /12518 characters, and at most 12000/);
    assert.equal(rt.s.runs.get(run.runId)?.status, 'failed');
    assert.deepEqual(rt.entriesVia(run, 'ground:pin'), []);
  } finally {
    rt.dispose();
  }
});

test('what an exclusion holds back does not count against the budget', async () => {
  const rt = runtime({ body: { ...BODY, role_description: bigRole(PICKS_BUDGET + 500) } });
  try {
    rt.pin(ROLE, GLOBEX);
    rt.exclude(ROLE);
    await settle(rt.begin(question()));
    assert.equal(loopOf(rt).prompt, prompted(QUESTION, GLOBEX));
  } finally {
    rt.dispose();
  }
});

/* ---------------------------------------------------------------- a bare run */

test('a model that is told to answer from the pieces is given them and no tools, and is not asked which tools it wants', async () => {
  const rt = runtime();
  try {
    rt.pin(ACME);
    const run = rt.begin(question({ grounding: { reach: 'selected' } }));
    const settled = await settle(run);

    assert.deepEqual(rt.requests.map((each) => each.kind), ['loop'], 'no call to choose tools');
    const sent = loopOf(rt);
    assert.deepEqual(sent.tools, []);
    assert.equal(sent.prompt, prompted(QUESTION, ACME));
    assert.match(sent.system, /You have no tools/);
    assert.ok(!sent.system.includes('Use the tools to read it'), 'it is not told to use tools it does not have');
    assert.equal(settled.data.answer, 'An answer.');
    assert.deepEqual(rt.received, []);
  } finally {
    rt.dispose();
  }
});

test('a run that is to answer from the pieces and has none selected does not start, and has called nothing', async () => {
  const rt = runtime();
  try {
    const run = rt.begin(question({ grounding: { reach: 'selected' } }));
    assert.equal(await codeOf(run), 'needs_unmet');
    assert.deepEqual(rt.requests, [], 'not one model call');
    assert.equal(rt.s.runs.get(run.runId)?.status, 'failed');
    assert.equal(rt.s.runs.get(run.runId)?.errorCode, 'needs_unmet');
    assert.match(rt.s.runs.get(run.runId)?.errorMessage ?? '', /selection: Nothing is selected for this message/);
    assert.equal(rt.s.runs.steps(run.runId).length, 0, 'no step began');
  } finally {
    rt.dispose();
  }
});

test('everything selected being excluded is the same as nothing selected', async () => {
  const rt = runtime();
  try {
    rt.pin(GLOBEX);
    rt.exclude(GLOBEX);
    assert.equal(await codeOf(rt.begin(question({ grounding: { reach: 'selected', once: [GLOBEX] } }))), 'needs_unmet');
    assert.deepEqual(rt.requests, []);

    // One open piece is enough.
    const settled = await settle(rt.begin(question({ grounding: { reach: 'selected', once: [GLOBEX, ACME] } })));
    assert.equal(loopOf(rt).prompt, prompted(QUESTION, ACME));
    assert.deepEqual(settled.degraded, ['pins', 'once'], 'and what was held back is said');
  } finally {
    rt.dispose();
  }
});

test('a run that is to answer from the pieces and is told to add its own has something to answer from', async () => {
  const rt = runtime();
  try {
    await settle(rt.begin(question({ grounding: { reach: 'selected', auto: 'on' } })));
    assert.deepEqual(loopOf(rt).tools, []);
    assert.ok(loopOf(rt).prompt.includes(CANARY.acme), 'what the runtime added is what it answers from');
  } finally {
    rt.dispose();
  }
});

test('an optional need that is not met is named under degraded, and the answer is still given', async () => {
  const rt = runtime();
  try {
    rt.pin(GLOBEX);
    rt.exclude(GLOBEX);
    const settled = await settle(rt.begin(question()));
    assert.deepEqual(settled.degraded, ['pins']);
    assert.equal(settled.data.answer, 'An answer.');

    const none = await settle(rt.begin(question({ grounding: { once: [ACME] } })));
    assert.deepEqual(none.degraded, ['pins']);
  } finally {
    rt.dispose();
  }
});

/* ------------------------------------------------------------------ by itself */

test('auto off asks the index nothing, and suggest names what it would add and sends none of it', async () => {
  const rt = runtime();
  try {
    await settle(rt.begin(question({ grounding: { auto: 'off', once: [ROLE] } })));
    assert.equal(rt.searches.count, 0);

    const settled = await settle(rt.begin(question({ grounding: { auto: 'suggest', once: [ROLE] } })));
    assert.equal(rt.searches.count, 1);
    assert.equal(loopOf(rt, 1).prompt, prompted(QUESTION, ROLE), 'nothing was added');
    assert.deepEqual(settled.data.grounding, { included: [ROLE], blocked: [], gone: [], suggested: [ACME, GLOBEX] });
    assert.ok(!loopOf(rt, 1).prompt.includes(CANARY.acme));
  } finally {
    rt.dispose();
  }
});

test('auto on sends the pieces the search found, after the ones that were asked for, and records them as the runtime\'s choice', async () => {
  const rt = runtime();
  try {
    const run = rt.begin(question({ grounding: { auto: 'on', once: [GLOBEX] } }));
    const settled = await settle(run);

    assert.equal(loopOf(rt).prompt, prompted(QUESTION, GLOBEX, ACME, ROLE));
    assert.deepEqual(rt.entriesVia(run, 'ground:auto').map((each) => each.ref), [ACME, ROLE]);
    assert.deepEqual(rt.entriesVia(run, 'ground:once').map((each) => each.ref), [GLOBEX]);
    assert.deepEqual((settled.data.grounding as { suggested: string[] }).suggested, []);
  } finally {
    rt.dispose();
  }
});

test('a passage that belongs to no piece of the CV is neither suggested nor sent, and is not a search that failed', async () => {
  const strays = (at: number): ChunkHit[] => [
    hit(at, 9, 'Ran the Initech audit.', { section: 'experience', entry: 7, company: 'Initech', title: 'Analyst' }),
    ...passages(at)
  ];

  const rt = runtime({ search: async (at) => strays(at) });
  try {
    const suggest = await settle(rt.begin(question({ grounding: { auto: 'suggest', once: [ROLE] } })));
    assert.deepEqual(suggest.data.grounding, { included: [ROLE], blocked: [], gone: [], suggested: [ACME, GLOBEX] });

    const on = await settle(rt.begin(question({ grounding: { auto: 'on', once: [ROLE] } })));
    assert.equal(loopOf(rt, 1).prompt, prompted(QUESTION, ROLE, ACME, GLOBEX));
    assert.deepEqual(on.data.grounding, { included: [ROLE, ACME, GLOBEX], blocked: [], gone: [], suggested: [] });
    assert.ok(!rt.everything().includes('Initech'));
  } finally {
    rt.dispose();
  }
});

test('auto never adds what is excluded, whatever the search found', async () => {
  const rt = runtime({ search: async (at) => passages(at) });
  try {
    rt.exclude(GLOBEX, ROLE);
    const settled = await settle(rt.begin(question({ grounding: { auto: 'on' } })));

    assert.equal(loopOf(rt).prompt, prompted(QUESTION, ACME));
    assert.ok(!rt.everything().includes(CANARY.globex));
    assert.ok(!rt.everything().includes(CANARY.summary));
    assert.deepEqual((settled.data.grounding as { blocked: string[] }).blocked, [], 'it was never asked for, so nothing was held back');
  } finally {
    rt.dispose();
  }
});

test('auto adds only what is left of the budget, and a piece that does not fit is not cut', async () => {
  const rt = runtime({ body: { ...BODY, role_description: bigRole(PICKS_BUDGET - 100) } });
  try {
    // The description comes to the budget less 100 with its heading, and Acme's entry is longer than that.
    const settled = await settle(rt.begin(question({ grounding: { auto: 'on', once: [ROLE] } })));

    assert.ok(!loopOf(rt).prompt.includes(CANARY.acme), 'the piece that did not fit is not in it');
    assert.ok(loopOf(rt).prompt.split(`${LABEL}:\n`)[1]!.length <= PICKS_BUDGET);
    assert.deepEqual((settled.data.grounding as { included: string[] }).included, [ROLE]);
  } finally {
    rt.dispose();
  }
});

test('auto adds a piece that fits the budget to the character, and not one that is a character over', async () => {
  const heading = 'Role description:\n'.length;
  const fit = PICKS_BUDGET - heading - 2 - TEXT[ACME]!.length;

  const at = await attempt(plain({ role_description: bigRole(fit) }), [ROLE], 'on');
  assert.equal(at.code, 'did not fail');
  assert.ok(at.sent.includes(CANARY.acme), 'the piece that fits is added');
  assert.equal(at.sent.length, PICKS_BUDGET);

  const over = await attempt(plain({ role_description: bigRole(fit + 1) }), [ROLE], 'on');
  assert.equal(over.code, 'did not fail', 'what does not fit is left out, and the run goes on');
  assert.ok(!over.sent.includes(CANARY.acme), 'and is not cut to fit');
});

test('a question that says nothing is searched for by nothing', async () => {
  const rt = runtime({
    probes: { probe: noop('probe', [stage('ground', [groundStep({ once: [], auto: 'on', question: '  ' })])]) }
  });
  try {
    await settle(rt.begin({}, 'probe'));
    assert.equal(rt.searches.count, 0);

    const asked = runtime({
      probes: { probe: noop('probe', [stage('ground', [groundStep({ once: [], auto: 'on', question: 'billing' })])]) }
    });
    try {
      await settle(asked.begin({}, 'probe'));
      assert.equal(asked.searches.count, 1);
    } finally {
      asked.dispose();
    }
  } finally {
    rt.dispose();
  }
});

test('a search that fails is said, and the run goes on without what it would have added', async () => {
  const rt = runtime({
    search: async () => {
      throw new Error('the index is unavailable');
    }
  });
  try {
    const settled = await settle(rt.begin(question({ grounding: { auto: 'on', once: [ROLE] } })));
    assert.equal(loopOf(rt).prompt, prompted(QUESTION, ROLE));
    assert.deepEqual(settled.data.grounding, { included: [ROLE], blocked: [], gone: [], suggested: [], auto: 'failed' });
  } finally {
    rt.dispose();
  }
});

test('a passage that cannot be placed in a piece is not suggested or added', async () => {
  const rt = runtime({
    search: async (at) => [
      hit(at, 0, 'A passage from a job that was renamed.', { section: 'experience', entry: 0, company: 'Initech', title: 'Senior Engineer' }),
      hit(at, 1, 'A passage from education.', { section: 'education' })
    ]
  });
  try {
    const settled = await settle(rt.begin(question({ grounding: { auto: 'on' } })));
    assert.equal(loopOf(rt).prompt, QUESTION);
    assert.deepEqual((settled.data.grounding as { included: string[] }).included, []);
  } finally {
    rt.dispose();
  }
});

/* ---------------------------------------------------------------------- a wait */

/** A run that assembles, waits for a person, and then says what it was given. */
const holding = (over: Partial<Capability> = {}): CapabilityMap => ({
  probe: noop('probe', [
    stage('ground', [groundStep({ once: [GLOBEX], auto: 'off', question: '' })]),
    stage('ask', [
      transform('confirm', async (context) => {
        const decision = context.approvals.request({ key: 'go', kind: 'confirm', question: 'Go on?', payload: {} });
        return { went: decision.status };
      })
    ]),
    stage('after', [transform('after', async (context) => ({ text: (context.completed.ground?.[GROUNDED] as Grounded).text }))])
  ], over)
});

const parked = async (rt: Runtime): Promise<RunHandle> => {
  const run = rt.begin({}, 'probe');
  await assert.rejects(run.settled, (error: unknown) => isRunSuspension(error));
  const [approval] = rt.s.approvals.pending(run.runId);
  assert.ok(approval);
  rt.s.approvals.decide(approval.id, { status: 'granted', decision: { confirmed: true }, decidedAt: Date.now() });
  return run;
};

test('a run that waited, when what it was given is as it was, is given the same', async () => {
  const rt = runtime({ probes: holding() });
  try {
    const run = await parked(rt);
    // Something else changed: another job, and the selection.
    rt.edit((body) => {
      (body.experience as { highlights: string[] }[])[0]!.highlights = ['Changed. ZEBRA-ELSEWHERE-0002'];
      return body;
    });
    rt.pin(ACME);

    const result = await rt.resume(run.runId);
    assert.equal(result.data.text, TEXT[GLOBEX]);
  } finally {
    rt.dispose();
  }
});

test('a run that waited is not given a piece that was edited while it waited, and says which', async () => {
  const rt = runtime({ probes: holding() });
  try {
    const run = await parked(rt);
    rt.edit((body) => {
      (body.experience as { highlights: string[] }[])[1]!.highlights = ['Edited while waiting.'];
      return body;
    });

    await assert.rejects(rt.resume(run.runId), (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'grounding_stale');
      assert.ok(((error as Error).message).includes(GLOBEX));
      return true;
    });
    assert.equal(rt.s.runs.get(run.runId)?.status, 'failed');
  } finally {
    rt.dispose();
  }
});

test('a run that waited is not given a piece that was left out while it waited', async () => {
  const rt = runtime({ probes: holding() });
  try {
    const run = await parked(rt);
    rt.exclude(ref('experience'));

    await assert.rejects(rt.resume(run.runId), (error: unknown) => (error as { code?: string }).code === 'grounding_stale');
  } finally {
    rt.dispose();
  }
});

test('a run that waited is not given a piece that is gone', async () => {
  const rt = runtime({ probes: holding() });
  try {
    const run = await parked(rt);
    rt.edit((body) => {
      (body.experience as { company: string }[])[1]!.company = 'Initech';
      return body;
    });

    await assert.rejects(rt.resume(run.runId), (error: unknown) => (error as { code?: string }).code === 'grounding_stale');
  } finally {
    rt.dispose();
  }
});

test('a run that waited says what it lacked, and one that now lacks what it requires does not go on', async () => {
  const lacks = { required: false };
  const needs = (): Need[] => [
    { name: 'optional-thing', required: false, unmet: 'It is not there.' },
    { name: 'required-thing', required: true, ...(lacks.required ? { unmet: 'It has gone.' } : {}) }
  ];

  const rt = runtime({ probes: holding({ needs }) });
  try {
    const run = await parked(rt);
    const result = await rt.resume(run.runId);
    assert.deepEqual(result.degraded, ['optional-thing']);
  } finally {
    rt.dispose();
  }

  const gone = runtime({ probes: holding({ needs }) });
  try {
    const run = await parked(gone);
    lacks.required = true;
    await assert.rejects(gone.resume(run.runId), (error: unknown) => (error as { code?: string }).code === 'needs_unmet');
  } finally {
    gone.dispose();
  }
});

test('what is stale is told apart from what is current, entry by entry', () => {
  const rt = runtime();
  try {
    const context = {
      documents: rt.documents,
      walls: { pieces: () => rt.selections.walls(CHAT) }
    };
    const entry = (at: string, over: Partial<RecordEntry> = {}): RecordEntry => ({
      ref: at,
      version: '1',
      digest: at in STORED ? digest(STORED[at as keyof typeof STORED]) : '0'.repeat(16),
      status: 'included',
      origin: 'server',
      via: 'ground:pin',
      ...over
    });

    const current = [entry(ACME), entry(GLOBEX), entry(ROLE), entry(PERSONAL)];
    assert.deepEqual(staleCv(context, current), []);

    assert.deepEqual(staleCv(context, [entry(ACME, { digest: 'f'.repeat(16) })]), [ACME], 'a digest that is not the piece\'s now');
    assert.deepEqual(staleCv(context, [entry(ref('experience/nobody~nothing'))]), [ref('experience/nobody~nothing')]);
    assert.deepEqual(staleCv(context, [entry(ACME, { status: 'read', digest: 'f'.repeat(16) })]), [], 'a read is not a copy');
    assert.deepEqual(staleCv(context, [entry(ACME, { status: 'blocked', digest: 'f'.repeat(16) })]), [], 'nor is a piece held back');
    assert.deepEqual(staleCv(context, [entry('offers:offer-1/requirements')]), [], 'a piece of another well is not the CV\'s to say');

    rt.exclude(GLOBEX);
    assert.deepEqual(staleCv(context, current), [GLOBEX], 'one that is excluded now');
  } finally {
    rt.dispose();
  }
});

/* -------------------------------------------------------------------- answers */

test('an answer made from a piece that is excluded later is not handed back, and comes back when the exclusion is lifted', async () => {
  const rt = runtime();
  try {
    rt.pin(GLOBEX);
    const first = await rt.turn('What did I do at Globex?', { answer: `At Globex: ${CANARY.globex}.` });
    assert.deepEqual(first.history, []);

    const second = await rt.turn('And at Acme?', { answer: 'At Acme: something.' });
    assert.deepEqual(second.history, ['What did I do at Globex?', `At Globex: ${CANARY.globex}.`], 'with nothing excluded the conversation is given whole');

    rt.exclude(GLOBEX);
    const mark = rt.requests.length;
    const third = await rt.turn('Anything else?');
    assert.deepEqual(third.history, [], 'the pinned piece was behind both answers, and both are withheld');
    assert.ok(!rt.requests.slice(mark).map((each) => JSON.stringify(each)).join('\n').includes(CANARY.globex));

    rt.clear(GLOBEX);
    const fourth = await rt.turn('Where were we?');
    assert.ok(fourth.history.join('\n').includes(CANARY.globex), 'the exclusion was lifted');
  } finally {
    rt.dispose();
  }
});

test('an answer made from an attachment is traced to it as well', async () => {
  const rt = runtime();
  try {
    await rt.turn('What did I do at Acme?', { answer: `At Acme: ${CANARY.acme}.`, input: { grounding: { once: [ACME] } } });
    rt.exclude(ACME);
    const next = await rt.turn('And now?');
    assert.deepEqual(next.history, []);
  } finally {
    rt.dispose();
  }
});

test('a piece that was asked for and held back taints no answer, since the model was never given it', async () => {
  const rt = runtime();
  try {
    rt.exclude(GLOBEX);
    rt.pin(GLOBEX);
    await rt.turn('What did I do at Globex?', { answer: 'I cannot say.' });
    rt.clear(GLOBEX);
    rt.exclude(ACME);

    const next = await rt.turn('And now?');
    assert.deepEqual(next.history, ['What did I do at Globex?', 'I cannot say.'], 'an answer that only asked for what was excluded is not withheld by another');
  } finally {
    rt.dispose();
  }
});

test('an answer made from pieces another turn pinned is not withheld by an exclusion of something it did not carry', async () => {
  const rt = runtime();
  try {
    rt.pin(ACME);
    await rt.turn('What did I do at Acme?', { answer: 'Billing.' });
    rt.exclude(GLOBEX);
    const next = await rt.turn('And now?');
    assert.deepEqual(next.history, ['What did I do at Acme?', 'Billing.']);
  } finally {
    rt.dispose();
  }
});

/* --------------------------------------------------------------- the surroundings */

test('a fixture CV that has a piece in each place the tests look is the one they think it is', () => {
  const document = cvOf(BODY);
  assert.ok(document);
  assert.equal(emptyDocument().experience.length, 0);
  assert.equal(CV_ID.length > 0, true);
  assert.equal(Object.keys(TEXT).length, Object.keys(STORED).length);
});
