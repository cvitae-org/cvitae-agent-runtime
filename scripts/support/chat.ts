/**
 * A profile conversation over a real runtime, with a model that counts what it is
 * asked.
 *
 * What the tests of limits and previews need is the thing the older grounding
 * tests need and then one thing more: to say how many times a model was asked.
 * "Refused before any model call" and "a preview asks none" are claims about that
 * number, and a model that throws when reached (the spine's default) can only say
 * it was reached once. Here every call is counted by kind and kept.
 *
 * The CV is the one the grounding tests use, trimmed to what these need, with the
 * words of each piece written out so that a size is a number a reader can check
 * and not one computed by the code that is under test.
 */

import assert from 'node:assert/strict';
import { capabilities } from '../../src/capabilities/index.js';
import { CV_KIND } from '../../src/capabilities/cv/document.js';
import { bindCvScope } from '../../src/runtime/cv-scope.js';
import { defaultWells } from '../../src/runtime/grounding.js';
import { createHistory } from '../../src/runtime/history.js';
import { createLimitService } from '../../src/runtime/limits.js';
import { beginRun } from '../../src/runtime/run.js';
import type { RunHandle, RunRequest, RuntimeDeps } from '../../src/runtime/run.js';
import { createConversationStore } from '../../src/storage/sqlite/conversations.js';
import { createLimitStore } from '../../src/storage/sqlite/grounding-limits.js';
import { createRecordStore } from '../../src/storage/sqlite/grounding-record.js';
import { createSelectionStore } from '../../src/storage/sqlite/grounding-selection.js';
import { defaultTools } from '../../src/tools/index.js';
import { createToolRegistry } from '../../src/tools/registry.js';
import { createOfferStore } from '../../src/storage/sqlite/offers.js';
import type {
  CapabilityMap,
  ChunkHit,
  OfferRecord,
  OfferShelf,
  RecordEntry,
  Retriever,
  ToolLoopRequest
} from '../../src/contracts/index.js';
import { spine } from './spine.js';
import type { Spine } from './spine.js';

export const CONTEXT = 'ctx';
export const CHAT = 'chat';

/** A job whose highlights are as long as a test asks, and no more. */
export const job = (company: string, title: string, highlight: string) => ({
  company,
  title,
  started: '2021',
  finished: null,
  highlights: [highlight],
  skills: []
});

/** The CV, with the experience a test gives it. */
export const cv = (experience: ReturnType<typeof job>[] = [job('Acme', 'Senior Engineer', 'Rewrote the billing pipeline.')]) => ({
  version: 1,
  personal: { name: 'Ada Example', email: 'ada@example.com', phone: '', location: 'Krakow', links: {} },
  role_description: 'Backend engineer focused on billing systems.',
  skills: { role: 'Engineer', groups: [], programming_languages: [], frameworks: [], libraries_and_tools: [] },
  experience,
  education: [],
  certificates: [],
  languages: [],
  sources: []
});

export const ref = (path = ''): string => `cv:${CONTEXT}${path === '' ? '' : `/${path}`}`;
export const ACME = ref('experience/acme~senior-engineer');
export const GLOBEX = ref('experience/globex~engineer');
export const ROLE = ref('overview/role_description');

/** What the model reads of each of these, written out: the sizes below are of these words. */
export const ACME_TEXT = 'Experience, Senior Engineer at Acme:\n2021 - present\n- Rewrote the billing pipeline.';
export const ROLE_TEXT = 'Role description:\nBackend engineer focused on billing systems.';

/** A piece that comes to exactly `size` characters as the model reads it, as an entry of Acme's. */
export const acmeOf = (size: number): ReturnType<typeof job> => {
  const head = 'Experience, Senior Engineer at Acme:\n2021 - present\n- '.length;
  assert.ok(size > head, 'a piece cannot be shorter than its own heading');
  return job('Acme', 'Senior Engineer', 'a'.repeat(size - head));
};

/** A saved offer, with what a test gives it and a posting that says nothing a test would trip over. */
export const offer = (id: string, over: Partial<OfferRecord> = {}): OfferRecord => ({
  id,
  text: 'A posting.',
  firstSeenAt: 1,
  lastSeenAt: 1,
  processing: 'fetched',
  disposition: 'active',
  ...over
});

export type Request = {
  readonly kind: 'plan' | 'loop' | 'text';
  readonly system: string;
  readonly prompt: string;
  readonly history: string[];
  readonly tools: string[];
};

export type ChatOptions = {
  /** What the CV says. */
  readonly body?: Record<string, unknown>;
  /** What a search of the index finds. By default nothing. */
  readonly search?: (revision: number) => Promise<ChunkHit[]>;
  /** `false` builds a runtime that keeps no limits, which is every runtime there was. */
  readonly limits?: boolean;
  /** `false` builds a runtime with no saved offers to read, which is every runtime there was. */
  readonly offers?: boolean;
  /** What the model answers with, given what it was asked. By default one sentence with no number in it. */
  readonly answer?: (request: ToolLoopRequest) => string;
  /** Capabilities of a test's own, beside the real ones. */
  readonly probes?: CapabilityMap;
};

export type Chat = {
  readonly s: Spine;
  readonly deps: RuntimeDeps;
  readonly records: ReturnType<typeof createRecordStore>;
  readonly selections: ReturnType<typeof createSelectionStore>;
  readonly conversations: ReturnType<typeof createConversationStore>;
  readonly limitStore: ReturnType<typeof createLimitStore>;
  readonly limits: ReturnType<typeof createLimitService>;
  readonly offerStore: ReturnType<typeof createOfferStore>;
  /** The ids of the offers on the Board, as the shelf is told. A test adds to it. */
  readonly board: Set<string>;
  /** What the shelf was asked to read, call by call: an offer that is not here was never read. */
  readonly reads: string[][];
  /** Every request any model call was made with, in the order they were made. */
  readonly requests: Request[];
  /** How many searches of the index were made. */
  readonly searches: { count: number };
  /** Saves an offer, as discovery would have. */
  saveOffer(offer: OfferRecord): void;
  pin(...refs: string[]): void;
  exclude(...refs: string[]): void;
  /** Starts a run of a capability in the conversation. */
  begin(input: Record<string, unknown>, capability?: string, over?: Omit<RunRequest, 'capability' | 'input'>): RunHandle;
  /** The host stores the question, a run answers it, and the host stores the answer. */
  turn(question: string, input?: Record<string, unknown>): Promise<RunHandle>;
  entries(run: RunHandle): readonly RecordEntry[];
  dispose(): void;
};

export const CHAT_RUN = { contextId: CONTEXT, conversationId: CHAT } as const;

export const chat = (options: ChatOptions = {}): Chat => {
  const requests: Request[] = [];
  const searches = { count: 0 };

  const all = { ...capabilities, ...options.probes };

  const s = spine(all, {
    ai: {
      generateObject: async (request) => {
        requests.push({ kind: 'plan', system: request.system ?? '', prompt: request.prompt ?? '', history: [], tools: [] });
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
        return { text: options.answer?.(request) ?? 'An answer.', steps: 1, finishReason: 'stop', usage: {} };
      }
    },
    tools: createToolRegistry(defaultTools)
  });

  s.db.prepare("INSERT INTO cv_contexts (id, language, created_at, updated_at) VALUES (?, 'en', 1, 1)").run(CONTEXT);
  s.db
    .prepare('INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
    .run(CHAT, 'profile', CONTEXT);
  s.deps.documents.update(CONTEXT, CV_KIND, () => (options.body ?? cv()) as never);

  const generation = (): number =>
    (s.db.prepare('SELECT generation FROM cv_contexts WHERE id = ?').get(CONTEXT) as { generation: number }).generation;
  const revision = (): number => s.deps.documents.read(CONTEXT)?.revision ?? 0;

  const retrieval: Retriever = {
    search: async () => {
      searches.count += 1;
      return (options.search ?? (async () => []))(revision());
    }
  };
  const bound = () => bindCvScope(CONTEXT, { documents: s.deps.documents, retrieval, index: s.deps.index });

  const selections = createSelectionStore(s.db);
  const records = createRecordStore(s.db);
  const conversations = createConversationStore(s.db);
  const limitStore = createLimitStore(s.db);
  const limits = createLimitService({ store: limitStore, conversations });

  const offerStore = createOfferStore(s.db);
  const board = new Set<string>();
  const reads: string[][] = [];
  const shelf: OfferShelf = {
    read: (ids) => {
      reads.push([...ids]);
      return ids.flatMap((id) => {
        const offer = offerStore.get(id);
        return offer === undefined ? [] : [offer];
      });
    },
    onBoard: (ids) => new Set(ids.filter((id) => board.has(id)))
  };

  const deps: RuntimeDeps = {
    ...s.deps,
    scopeCv: () => ({ ...bound(), contextGeneration: generation(), contextRevision: revision() }),
    grounding: { records, wells: defaultWells() },
    selection: selections,
    history: createHistory({ conversations, records, walls: (id) => selections.walls(id), capabilities: all }),
    ...(options.limits === false ? {} : { limits: limitStore }),
    ...(options.offers === false ? {} : { offerShelf: shelf })
  };

  const change = (what: { exclude?: string[]; pin?: string[] }): void => {
    const { revision: expectedRevision } = selections.read(CHAT);
    const { applied } = selections.change(CHAT, {
      expectedRevision,
      exclude: what.exclude ?? [],
      clear: [],
      pin: what.pin ?? [],
      unpin: []
    });
    assert.ok(applied);
  };

  let turns = 0;

  return {
    s,
    deps,
    records,
    selections,
    conversations,
    limitStore,
    limits,
    offerStore,
    board,
    reads,
    requests,
    searches,
    saveOffer: (offer) => void offerStore.save(offer),
    pin: (...refs) => change({ pin: refs }),
    exclude: (...refs) => change({ exclude: refs }),
    begin: (input, capability = 'ask_profile', over = CHAT_RUN) => beginRun(deps, { capability, input, ...over }),
    turn: async (question, input = {}) => {
      turns += 1;
      conversations.append(CHAT, { role: 'user', text: question });
      const run = beginRun(deps, {
        capability: 'ask_profile',
        input: { question, ...input },
        ...CHAT_RUN,
        runId: `r${turns}`
      });
      await run.settled;
      conversations.append(CHAT, { role: 'assistant', text: `An answer to turn ${turns}.`, runId: `r${turns}` });
      return run;
    },
    entries: (run) => records.read(run.runId)?.entries ?? [],
    dispose: () => s.dispose()
  };
};

/** What a run settled with. */
export const settle = async (run: RunHandle): Promise<{ data: Record<string, unknown>; degraded: readonly string[] }> =>
  (await run.settled) as { data: Record<string, unknown>; degraded: readonly string[] };

/** What a run's rejection said it was, and how it said it. */
export const refusal = async (run: RunHandle): Promise<{ code: string; message: string }> => {
  try {
    await run.settled;
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    return { code: code ?? String(error), message };
  }
  return { code: 'did not fail', message: '' };
};
