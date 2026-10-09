/**
 * A runtime assembled for tests: real database, real core, stub outside world.
 *
 * The point is that these tests drive the same `startRun` and `resumeRun` that
 * production does, over the same SQLite implementations. Only the effects are
 * substituted, and the substitution is what makes the tests offline: a spine
 * test should be able to prove that a critical failure aborts its siblings
 * without a model, a network or a credential anywhere near it.
 *
 * The model gateway here throws by default rather than returning a canned
 * answer. A spine test that reaches a model has almost certainly reached it by
 * accident, and a stub that quietly succeeds would hide that.
 */

import { z } from 'zod';
import type {
  AiGateway,
  AiLogEntry,
  AiLogger,
  Capability,
  CapabilityMap,
  EffectSet,
  ObjectRequest,
  ObjectResult,
  Retriever,
  Stage,
  Step,
  StepContext,
  StepDelta,
  ToolRegistry
} from '../../src/contracts/index.js';
import type { RuntimeDeps } from '../../src/runtime/run.js';
import { createAttemptLog } from '../../src/storage/sqlite/attempts.js';
import { createApprovalGate, createApprovalStore } from '../../src/storage/sqlite/approvals.js';
import { createChunkIndex } from '../../src/storage/sqlite/chunk-index.js';
import { createDocumentStore } from '../../src/storage/sqlite/document-store.js';
import { createEventLog } from '../../src/storage/sqlite/event-log.js';
import { createRunStore, newRunId } from '../../src/storage/sqlite/run-store.js';
import type { Db } from '../../src/storage/sqlite/open.js';
import { scratch, type Scratch } from './db.js';

/* ------------------------------------------------------------------ stubs */

const notReached = (what: string) => (): never => {
  throw new Error(`${what} was called; a spine test should not reach a model.`);
};

export const stubGateway = (over: Partial<AiGateway> = {}): AiGateway => ({
  generateObject: notReached('generateObject'),
  generateText: notReached('generateText'),
  transcribeImage: notReached('transcribeImage'),
  runToolLoop: notReached('runToolLoop'),
  embed: notReached('embed'),
  describe: () => ({ providerId: 'local', modelId: 'stub' }),
  ...over
});

const stubTools: ToolRegistry = {
  names: () => [],
  has: () => false,
  handles: (names) => {
    throw new Error(`no tool registry in this test (asked for ${names.join(', ')})`);
  }
};

const stubRetriever: Retriever = { search: async () => [] };

export type Recorder = AiLogger & { readonly entries: AiLogEntry[] };

export const recorder = (): Recorder => {
  const entries: AiLogEntry[] = [];
  return { entries, record: (entry) => entries.push(entry) };
};

/* ----------------------------------------------------------- capabilities */

/**
 * A capability with no domain knowledge, built from stages a test hands it.
 *
 * Everything the spine tests assert about — degradation, fail-fast, suspension,
 * resume — is a property of the walk, not of any subject. Giving the tests a
 * subject would only mean asserting the same properties through a CV.
 */
export const noop = (
  name: string,
  stages: readonly Stage[],
  over: Partial<Capability> = {}
): Capability => ({
  name,
  describe: 'A capability that exists only in tests.',
  input: z.object({}).passthrough(),
  plan: () => ({ capability: name, source: 'declared', stages }),
  ...over
});

/** One stage of transform steps, which is what most spine tests need. */
export const stage = (
  name: string,
  steps: readonly Step[],
  concurrency: Stage['concurrency'] = 'auto'
): Stage => ({ name, steps, concurrency });

export const transform = (
  name: string,
  run: (context: StepContext) => Promise<Record<string, unknown>>,
  critical = true
): Step => ({ kind: 'transform', name, critical, run });

export const extract = (
  name: string,
  critical: boolean,
  fallback?: Readonly<Record<string, unknown>>
): Step => ({
  kind: 'extract',
  name,
  critical,
  schema: z.object({}).passthrough(),
  system: 'test',
  prompt: name,
  maxOutputTokens: 256,
  ...(fallback ? { fallback } : {})
});

/**
 * A `generateObject` that answers from a function of the step name, so a test
 * can make some steps succeed and others throw without a model.
 */
export const objectsFrom = (
  answer: (step: string) => Record<string, unknown>
): AiGateway['generateObject'] =>
  async <T>(request: ObjectRequest<T>): Promise<ObjectResult<T>> => ({
    object: answer(request.step ?? '') as T,
    finishReason: 'stop',
    usage: {}
  });

/** Rejects when the signal fires, which is how a test step waits to be cancelled. */
export const untilAborted = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) return reject(signal.reason as Error);
    signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
  });

/* -------------------------------------------------------------- assembly */

export type Spine = {
  readonly scratch: Scratch;
  readonly db: Db;
  readonly deps: RuntimeDeps;
  /** The write half, so a test can read back what a step indexed. */
  readonly chunks: ReturnType<typeof createChunkIndex>;
  readonly events: ReturnType<typeof createEventLog>;
  readonly runs: ReturnType<typeof createRunStore>;
  readonly approvals: ReturnType<typeof createApprovalStore>;
  readonly log: Recorder;
  dispose(): void;
};

/**
 * Builds a runtime over a database.
 *
 * Takes an optional existing `Scratch` so a test can tear the whole runtime
 * down and build a second one over the same file — which is what "resumes in a
 * fresh process" means when the process is a test.
 */
export const spine = (
  capabilities: CapabilityMap,
  options: {
    ai?: Partial<AiGateway>;
    /**
     * Replaces the throwing stubs for tests that drive a real capability.
     *
     * Spine tests want the throw: reaching the outside world from one is a bug
     * the stub should announce. Smoke tests want the opposite, because a real
     * capability's whole first stage is usually an effect call.
     */
    effects?: Partial<Omit<EffectSet, 'ai' | 'attempts'>>;
    /**
     * Replaces the empty registry, for a capability that plans against it.
     *
     * Same trade as `effects`, and the empty one is the right default for the
     * same reason: a spine test that reaches a tool has left the spine. A smoke
     * test hands in the registry the runtime actually ships, because a plan
     * built over no tools is not the plan that runs.
     */
    tools?: ToolRegistry;
    /** Replaces the empty retriever, for a test that indexes something first. */
    retrieval?: Retriever;
    /** Where prose goes as it is produced. Absent means nobody is watching. */
    deltas?: (delta: StepDelta & { readonly runId: string }) => void;
    on?: Scratch;
    now?: () => number;
  } = {}
): Spine => {
  const s = options.on ?? scratch();
  const db = options.on ? options.on.connect() : s.db;

  const runs = createRunStore(db);
  const approvals = createApprovalStore(db);
  const events = createEventLog(db);
  const chunks = createChunkIndex(db);
  const log = recorder();

  const effects: EffectSet = {
    ai: stubGateway(options.ai),
    offers: { resolve: notReached('offers.resolve') },
    sites: {
      readPage: notReached('sites.readPage'),
      readCompany: notReached('sites.readCompany'),
      listBoard: notReached('sites.listBoard')
    },
    search: { engine: () => undefined, search: notReached('search.search') },
    sources: { read: notReached('sources.read'), through() { return this; } },
    ...options.effects,
    attempts: createAttemptLog(db)
  };

  const deps: RuntimeDeps = {
    capabilities,
    runs,
    gate: (runId, step) => createApprovalGate(approvals, runId, step),
    effects,
    tools: options.tools ?? stubTools,
    documents: createDocumentStore(db),
    retrieval: options.retrieval ?? stubRetriever,
    index: chunks,
    logger: log,
    ...(options.deltas ? { deltas: options.deltas } : {}),
    newRunId,
    ...(options.now ? { now: options.now } : {})
  };

  return {
    scratch: s,
    db,
    deps,
    chunks,
    events,
    runs,
    approvals,
    log,
    dispose() {
      if (!options.on) s.dispose();
    }
  };
};

/** The event types written for a run, in order. The shape of what happened. */
export const timeline = (spine: Spine, runId: string): string[] =>
  spine.events.since(runId, 0, 500).map((event) => event.type);
