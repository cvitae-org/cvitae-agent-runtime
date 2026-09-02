/**
 * The composition root. The one place anything is wired to anything.
 *
 * Every module below this file receives what it needs and constructs none of
 * it: no module opens a database, resolves a provider, reads a credential or
 * reaches a global. That is not an aesthetic preference. It is what makes the
 * whole tree testable without a network, and it is why `scripts/support/spine.ts`
 * can build a second runtime over the same file to prove a run resumes across a
 * process restart — there is no hidden state anywhere for it to collide with.
 *
 * Read top to bottom, the order is the dependency order: storage, then the
 * ports over it, then the effects that use them, then the model-facing surface,
 * then the capabilities. Nothing here reaches backwards.
 *
 * One thing here is deliberately *not* on the run context, and one thing is on
 * it in two forms.
 *
 * `mail` is returned beside the runtime rather than inside it. Offer text is
 * written by strangers and lands in a model's context; an outbound channel one
 * tool call away from it is an exfiltration path with a plausible cover story.
 * A step cannot reach mail because `EffectSet` has no member for it, and a
 * boundary rule fails the build if anything in `tools/` imports it.
 *
 * Retrieval is handed on twice, deliberately, as two different things. Steps
 * search through a `Retriever` — built over the reader half, with no cast that
 * recovers `replace` from it, so answering a query cannot alter what the next
 * query sees. Steps that change a document's searchable content write through
 * `index`, which is the whole `ChunkIndex`. The compiler-checked claim is about
 * the search path, not about steps in general: `documents` has always been a
 * write port, and indexing is the same kind of thing for the same reason.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { open } from '../storage/sqlite/open.js';
import { migrate } from '../storage/sqlite/migrate.js';
import { createRunStore } from '../storage/sqlite/run-store.js';
import { createEventLog } from '../storage/sqlite/event-log.js';
import { createApprovalGate, createApprovalStore } from '../storage/sqlite/approvals.js';
import { createDocumentStore } from '../storage/sqlite/document-store.js';
import { createChunkIndex } from '../storage/sqlite/chunk-index.js';
import { createOfferStore } from '../storage/sqlite/offers.js';
import { createAiLog } from '../storage/sqlite/ai-log.js';
import { createAttemptLog } from '../storage/sqlite/attempts.js';
import { createModelResolver } from '../providers/resolve.js';
import { createAiGateway } from '../effects/ai.js';
import { createWebReader } from '../effects/offers.js';
import { createWebSearch } from '../effects/search.js';
import { createSourceReader } from '../effects/sources.js';
import { createMailSender } from '../effects/mail.js';
import { createGuard } from '../effects/attempts.js';
import { createRetriever } from '../retrieval/search.js';
import { createToolRegistry } from '../tools/registry.js';
import { defaultTools } from '../tools/index.js';
import { capabilities as defaultCapabilities } from '../capabilities/index.js';
import { CV_ID, CV_KIND } from '../capabilities/cv/document.js';
import { beginRun, startRun, type RunHandle, type RuntimeDeps, type RunRequest } from './run.js';
import { beginResume, resumeRun, type ResumeRequest } from './resume.js';
import { recoverInterruptedRuns } from './recover.js';
import type {
  AiLog,
  AiLogEntry,
  AiLogger,
  ApprovalStore,
  CapabilityMap,
  ChunkIndex,
  DocumentBody,
  DocumentRecord,
  DocumentStore,
  EventLog,
  MailSender,
  OfferStore,
  RunRecord,
  RunResult,
  RunStore
} from '../contracts/index.js';

/**
 * One line per model call on **stderr**, metadata only.
 *
 * No prompt, no completion, no argument values — only sizes, timings and an
 * outcome. A log that carries prompts carries whatever the user pasted into
 * one, and a debugging convenience is not worth a second copy of a CV in a
 * file nobody remembers rotating.
 *
 * Not the default any more, and stderr rather than stdout, for the same
 * reason: this runtime's host is a child process whose stdout is the transport.
 * A log line in the middle of a frame is worse than no log line, and a library
 * writing to a stream it does not own is how that happens. The default sink is
 * now the `ai_calls` table — durable, queryable, and not on anyone's stdout.
 * This stays exported for a caller that wants to watch a run go by.
 */
export const consoleLogger: AiLogger = {
  record(entry: AiLogEntry): void {
    const parts = [
      `${entry.operation} ${entry.providerId}/${entry.modelId}`,
      entry.step ? `step=${entry.step}` : undefined,
      `in=${entry.promptChars}c`,
      `out=${entry.completionChars}c`,
      // Tokens, where the provider reports them, because that is the unit the
      // ceiling is set in. A step that truncates says to raise its
      // `maxOutputTokens`, and a log measured only in characters cannot say
      // what to raise it to — least of all on a model that reasons before it
      // answers, where the tokens spent are not visible in the output at all.
      entry.usage.outputTokens === undefined ? undefined : `out=${entry.usage.outputTokens}t`,
      `${entry.latencyMs}ms`,
      entry.finishReason ? `finish=${entry.finishReason}` : undefined,
      entry.outcome === 'ok' ? 'ok' : `failed=${entry.errorCode ?? 'unknown'}`
    ].filter(Boolean);

    console.error(parts.join(' '));
  }
};

/** Discards everything. For a caller that wants no output at all. */
export const silentLogger: AiLogger = { record: () => undefined };

export type CreateOptions = {
  /** Defaults to `CVITAE_DB`, then `~/.cvitae/runtime.db`. */
  readonly databasePath?: string;
  readonly capabilities?: CapabilityMap;
  /** Defaults to the `ai_calls` table. `consoleLogger` and `silentLogger` are here. */
  readonly logger?: AiLogger;
  /** Unset uses the default loopback port; `''` switches the scraper off. */
  readonly scraperUrl?: string;
  /** Unset reads `MAIL_URL`. Loopback only, checked at construction. */
  readonly mailUrl?: string;
  readonly timeoutMs?: number;
  readonly newRunId?: () => string;
  readonly now?: () => number;
};

export type Harness = {
  /**
   * Start a run and get its id back before it finishes.
   *
   * The asynchronous front door, and the one an interactive host wants. `run`
   * below is the same thing awaited, kept for callers with nothing to do in
   * between — a CLI, a test.
   */
  begin(request: RunRequest): RunHandle;
  beginResume(request: ResumeRequest): RunHandle;
  run(request: RunRequest): Promise<RunResult>;
  resume(request: ResumeRequest): Promise<RunResult>;
  readonly runs: RunStore;
  readonly events: EventLog;
  readonly documents: DocumentStore;
  /**
   * The canonical CV boundary used by trusted hosts.
   *
   * A replacement and invalidation of its derived search chunks commit in one
   * SQLite transaction. The editor never makes an embedding call implicitly;
   * profile chat can still read the current document through `read_cv`.
   */
  readonly profile: {
    read(): DocumentRecord | undefined;
    replace(document: DocumentBody): {
      readonly record: DocumentRecord;
      readonly clearedChunks: number;
    };
  };
  /** The write half. Held here, never placed on a run context. */
  readonly chunks: ChunkIndex;
  readonly offers: OfferStore;
  /**
   * What every model call cost, read back. The gateway holds only the write
   * half — see `AiLog` — so a step can add a line and nothing else.
   */
  readonly aiCalls: AiLog;
  /**
   * The adapter's half of the approval pair: see what is waiting, record an
   * answer. A step holds the gate and can only ask, which is what stops one
   * approving itself.
   */
  readonly approvals: ApprovalStore;
  /** Not an effect and not on any context. See the note at the top. */
  readonly mail: MailSender;
  readonly capabilities: CapabilityMap;
  /** Settles work left running by a previous process. It never replays an effect. */
  recoverInterrupted(): readonly RunRecord[];
  close(): void;
};

/**
 * `CVITAE_DB`, else one file under the user's home directory.
 *
 * `homedir()` rather than `$HOME`, which is a Windows bug waiting to happen:
 * the variable is unset there — `USERPROFILE` carries it — so the fallback
 * would put the database in the current working directory, and the runtime's
 * state would follow whatever folder the app happened to be launched from.
 * This host ships for macOS and Windows both.
 */
const defaultDatabasePath = (): string =>
  process.env.CVITAE_DB ?? join(homedir(), '.cvitae', 'runtime.db');

export const createHarness = (options: CreateOptions = {}): Harness => {
  const db = open(options.databasePath ?? defaultDatabasePath());
  migrate(db);

  const runs = createRunStore(db);
  const events = createEventLog(db);
  const approvals = createApprovalStore(db, options.now);
  const documents = createDocumentStore(db, options.now);
  const chunks = createChunkIndex(db, options.now);
  const offers = createOfferStore(db);
  const attempts = createAttemptLog(db);
  const aiLog = createAiLog(db);

  const replaceProfile = db.transaction((document: DocumentBody) => {
    const record = documents.update(CV_ID, CV_KIND, () => document);
    const clearedChunks = chunks.clear(CV_ID);
    return { record, clearedChunks };
  }).immediate;

  const logger = options.logger ?? aiLog;

  // Resolution is deferred until a step needs a model, so a runtime with no
  // credential still opens, still lists runs, and still fails at the point of
  // use with a message naming the variable rather than at import time with a
  // stack.
  const ai = createAiGateway({
    resolver: createModelResolver(),
    logger,
    ...(options.now ? { now: options.now } : {})
  });

  // One reader, two names on it. The pairing `retrieval` and `index` make on
  // `RunContext`, for the same reason: a step asks for the authority it needs
  // rather than receiving everything the implementation can do. Built once
  // because the per-host politeness map is the thing being shared — two of
  // them spacing the same host at a second each is two requests a second.
  const web = createWebReader({
    ...(options.scraperUrl === undefined ? {} : { scraperUrl: options.scraperUrl }),
    ...(options.now ? { now: options.now } : {})
  });

  const effects = {
    ai,
    offers: web,
    sites: web,
    search: createWebSearch({ ...(options.now ? { now: options.now } : {}) }),
    sources: createSourceReader({ ai }),
    attempts
  };

  // The reader half only. `chunks` keeps the write half up here, where indexing
  // happens, and a step is handed something with no `replace` on it at all.
  const retrieval = createRetriever({ reader: chunks, ai, traceId: 'retrieval' });

  const deps: RuntimeDeps = {
    capabilities: options.capabilities ?? defaultCapabilities,
    runs,
    gate: (runId, step) => createApprovalGate(approvals, runId, step),
    effects,
    tools: createToolRegistry(defaultTools),
    documents,
    retrieval,
    index: chunks,
    logger,
    newRunId: options.newRunId ?? (() => crypto.randomUUID()),
    ...(options.now ? { now: options.now } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  };

  return {
    begin: (request) => beginRun(deps, request),
    beginResume: (request) => beginResume(deps, request),
    run: (request) => startRun(deps, request),
    resume: (request) => resumeRun(deps, request),
    runs,
    events,
    documents,
    profile: {
      read: () => documents.read(CV_ID),
      replace: replaceProfile
    },
    chunks,
    offers,
    aiCalls: aiLog,
    approvals,
    mail: createMailSender({
      guard: createGuard(attempts, options.now),
      ...(options.mailUrl === undefined ? {} : { url: options.mailUrl })
    }),
    capabilities: deps.capabilities,
    recoverInterrupted: () => recoverInterruptedRuns(runs, options.now),
    close: () => db.close()
  };
};
