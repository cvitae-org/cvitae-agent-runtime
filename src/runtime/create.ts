import { createIntegrationDirectories } from '../effects/integration-directories.js';
import { createIntegrationDirectoryStore } from '../storage/sqlite/integration-directories.js';
import { withIntegrationSites } from '../effects/integration-sites.js';
import { type IntegrationProviders } from '../effects/integration-providers.js';
import { createIntegrationManagement } from '../effects/integration-management.js';
import { createIntegrationSettingsStore } from '../storage/sqlite/integration-settings.js';
import { randomUUID } from 'node:crypto';
import { createIntegrationDiscovery } from '../effects/integration-discovery.js';
import {createBrowserService} from './browser.js';
import {createBrowserImportStore} from '../storage/sqlite/browser-imports.js';
import {OperationError} from '../contracts/operation-error.js';
import { withDiscoveryMetadata } from '../storage/sqlite/discovery-registry.js';
import { createBoardStore } from '../storage/sqlite/board.js';
import { createApplicationAgent } from './application-agent.js';
import { createBoardService } from './board.js';
import type { BoardRunInput } from '../contracts/board.js';
import type { MaskTerms, OfferReader } from '../contracts/index.js';
import { createOfferFactStore } from '../storage/sqlite/offer-facts.js';
import { createFactPort } from './offer-facts.js';
import { createOpportunityStore } from '../storage/sqlite/opportunities.js';
import { createOfferQueryStore } from '../storage/sqlite/offer-query-store.js';
import { createOfferQueryService } from './offer-query.js';
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

import { homedir, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { open } from '../storage/sqlite/open.js';
import { migrate } from '../storage/sqlite/migrate.js';
import { createRunStore } from '../storage/sqlite/run-store.js';
import { createRecordStore } from '../storage/sqlite/grounding-record.js';
import { createSelectionStore } from '../storage/sqlite/grounding-selection.js';
import { createLimitStore } from '../storage/sqlite/grounding-limits.js';
import { createEventLog } from '../storage/sqlite/event-log.js';
import { createApprovalGate, createApprovalStore } from '../storage/sqlite/approvals.js';
import { createDocumentStore } from '../storage/sqlite/document-store.js';
import { createIndexRecoveryStore } from '../storage/sqlite/index-recovery.js';
import { createIndexRebuilder } from './index-recovery.js';
import { createMaskTerms, termSeeds } from './mask-terms.js';
import { maskedGateway, masksEmbedding } from '../effects/masking.js';
import { cvSeeds } from '../capabilities/cv/seeds.js';
import { createCvLifecycle } from '../storage/sqlite/cv-lifecycle.js';
import { createOfferSnapshots } from '../storage/sqlite/offer-snapshots.js';
import { createContextPhotos } from '../storage/sqlite/context-photos.js';
import { createCvContextStore } from '../storage/sqlite/cv-contexts.js';
import { createCvCopies } from '../storage/sqlite/cv-copy.js';
import { bindOfferScope, snapshotInput } from './offer-scope.js';
import { bindCvScope } from './cv-scope.js';
import { CvContextError, RuntimeError, maskModeOf, maskScopeOf } from '../contracts/index.js';
import { createChunkIndex } from '../storage/sqlite/chunk-index.js';
import { createOfferStore } from '../storage/sqlite/offers.js';
import { createDiscoveryCatalogue } from '../storage/sqlite/discovery.js';
import { createDiscoverySearchStore } from '../storage/sqlite/discovery-searches.js';
import { createDiscoveryChatStore } from '../storage/sqlite/discovery-chat.js';
import { createDiscoveryChatService } from './discovery-chat.js';
import { bindDiscoveryScope } from './discovery-scope.js';
import { askDiscoverySql } from '../capabilities/askDiscoverySql.js';
import { createDiscoverySqlPort } from './discovery-sql.js';
import { createCollectionPort } from './offer-collection.js';
import { createDiscoveryService } from './discovery.js';
import { createOfferNotes } from '../storage/sqlite/offer-notes.js';
import { createIntegrationOfferReader } from '../effects/integration-offers.js';
import { createIntegrationOfferLookup } from '../storage/sqlite/integration-acquisitions.js';
import { createEnrichmentStore } from '../storage/sqlite/enrichment.js';
import { createDetailQueueStore } from '../storage/sqlite/detail-queue.js';
import { createDetailQueue } from './detail-queue.js';
import { createEnrichmentService } from './enrichment.js';
import { analyzeOffer } from '../capabilities/analyzeOffer.js';
import type { DiscoverySource } from '../contracts/discovery.js';
import { createAiLog } from '../storage/sqlite/ai-log.js';
import { createSettingsStore } from '../storage/sqlite/settings.js';
import { createConversationStore } from '../storage/sqlite/conversations.js';
import { createAttemptLog } from '../storage/sqlite/attempts.js';
import { createModelResolver } from '../providers/resolve.js';
import { createEnvironment, validateSettings } from '../providers/environment.js';
import { providerStatus, type ProviderStatus } from '../providers/status.js';
import { testProviderConnection, type ProviderConnectionTest } from '../providers/connection-test.js';
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
import { cvChangesSchema } from '../capabilities/cv/diff.js';
import { CV_ID, CV_KIND, cvDocumentSchema, normaliseCv } from '../capabilities/cv/document.js';
import { cvHolds } from '../capabilities/cv/walls.js';
import { CV_WELL, cvOf } from '../capabilities/cv/well.js';
import { OFFERS_WELL } from '../capabilities/offers/well.js';
import { requireSameRun } from './run-identity.js';
import { route, validateInput } from '../core/router.js';
import { createCheckpointer } from '../runs/checkpoint.js';
import { previewRun } from './preview.js';
import type { Preview, PreviewRequest } from './preview.js';
import { beginRun, startRun, type RunHandle, type RuntimeDeps, type RunRequest } from './run.js';
import { beginResume, resumeRun, type ResumeRequest } from './resume.js';
import { recoverInterruptedRuns } from './recover.js';
import { defaultWells } from './grounding.js';
import { createCompaction } from './compaction.js';
import type { Compaction } from './compaction.js';
import { createHistory } from './history.js';
import { createSelectionService } from './selection.js';
import type { SelectionService } from './selection.js';
import { createLimitService } from './limits.js';
import type { LimitService } from './limits.js';
import type {
  AiLog,
  AiLogEntry,
  AiLogger,
  ApprovalStore,
  CapabilityMap,
  ChunkIndex,
  ConversationStore,
  CvContext,
  CvContextStore,
  CvLifecycle,
  CvProposalBase,
  IndexRecoveryStore,
  DocumentBody,
  DocumentRecord,
  DocumentStore,
  EventLog,
  MailSender,
  OfferStore,
  RecordStore,
  RunRecord,
  RunResult,
  RunStore,
  Settings,
  StepDelta
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
    console.error(aiLine(entry));
  }
};

/**
 * One model call as one line of text: what `consoleLogger` prints, and what the
 * desktop host writes to stderr. A failure ends `failed=<code>`, so a reader of
 * the line can tell a refused key from a timeout without the table.
 */
export const aiLine = (entry: AiLogEntry): string =>
  [
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
    // How many placeholders a masked call sent, all kinds together: whoever wants
    // them kind by kind reads the table.
    entry.masked === undefined
      ? undefined
      : `masked=${Object.values(entry.masked).reduce((sum, count) => sum + count, 0)}`,
    entry.outcome === 'ok' ? 'ok' : `failed=${entry.errorCode ?? 'unknown'}`
  ].filter(Boolean).join(' ');

/** Discards everything. For a caller that wants no output at all. */
export const silentLogger: AiLogger = { record: () => undefined };

export type CreateOptions = {
  readonly integrationProviders?: IntegrationProviders;
  readonly integrationFetch?: typeof globalThis.fetch;
  readonly integrationCacheDirectory?: string;
  /** Optional source port for hosts/tests; defaults to configured provider recipes. */
  readonly discoverySource?: DiscoverySource;
  /** Injectable public reader for deterministic Board integration tests. */
  readonly boardReader?: OfferReader;
  /** Explicit offer reader port for embedding hosts and deterministic tests. */
  readonly offerReader?: OfferReader;
  /** Desktop host enables durable background index recovery; libraries opt in. */
  readonly indexRecovery?: boolean;
  /** Defaults to `CVITAE_DB`, then `~/.cvitae/runtime.db`. */
  readonly databasePath?: string;
  readonly capabilities?: CapabilityMap;
  /** Defaults to the `ai_calls` table. `consoleLogger` and `silentLogger` are here. */
  readonly logger?: AiLogger;
  /**
   * A second sink, handed every line the `ai_calls` table gets, for a host that
   * wants to watch the calls go by and keep them too. Ignored when `logger`
   * replaces the table.
   */
  readonly echo?: AiLogger;
  /**
   * How long an `ai_calls` row is kept. Older rows are deleted when the runtime
   * opens. Unset keeps every row, because retention is the host's policy.
   */
  readonly aiCallsKeptMs?: number;
  /** Unset uses the default loopback port; `''` switches the scraper off. */
  readonly scraperUrl?: string;
  /** Bearer credential shared with the loopback scraper. */
  readonly scraperToken?: string;
  /** Unset reads `MAIL_URL`. Loopback only, checked at construction. */
  readonly mailUrl?: string;
  readonly timeoutMs?: number;
  /**
   * Where prose goes as it is produced, if anyone is watching.
   *
   * Absent by default, and absent is the ordinary case — a CLI, a test and a
   * scheduled job all want the finished answer and nothing before it. A host
   * with a window attached supplies one and routes by `runId`.
   */
  readonly deltas?: (delta: StepDelta & { readonly runId: string }) => void;
  /**
   * The environment the stored settings are laid over. Defaults to this
   * process's, and exists so a test can build a runtime that inherits nothing.
   */
  readonly env?: Readonly<Partial<Record<string, string>>>;
  /**
   * How `providers.status` reaches a local server.
   *
   * Injected only so a test need not depend on whether something happens to be
   * listening on this machine — a status check that passes on the laptop with
   * Ollama running and fails in CI is a test about the machine. Nothing else in
   * the runtime uses it; the web effects take their own.
   */
  readonly probe?: typeof globalThis.fetch;
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
  /**
   * What a message would be made of, said without making a run: nothing is
   * written and no model is asked, in either mode (`runtime/preview.ts`).
   */
  preview(request: PreviewRequest): Promise<Preview>;
  findRun(request: RunRequest): RunRecord | undefined;
  beginResume(request: ResumeRequest): RunHandle;
  cancelSuspended(runId: string): boolean;
  run(request: RunRequest): Promise<RunResult>;
  resume(request: ResumeRequest): Promise<RunResult>;
  readonly runs: RunStore;
  /**
   * What each chat run was given and what it read, read back.
   *
   * The read half only. The run writes its own record as it goes and a host has
   * no business adding to it: a record a host can write is a record that says
   * what the host wishes had happened.
   */
  readonly groundingRecords: Pick<RecordStore, 'read'>;
  /**
   * What each conversation leaves out of what its runs are given. Reading and
   * changing it go through here, and a change is checked against what the
   * conversation can enforce.
   */
  readonly selection: SelectionService;
  /**
   * The most the material of one message may come to: one setting for everything
   * and one a conversation may have of its own, in characters.
   */
  readonly limits: LimitService;
  /**
   * The terms a person asked to have kept from a model besides what the CV states,
   * in memory only. A background rebuild that would be masked waits until they are
   * set, an empty list included.
   */
  readonly maskTerms: MaskTerms;
  /**
   * What a `/compact` would fold, decided where the exclusions are known: the turns
   * a host may give the model that writes the conversation's note, and no more.
   */
  readonly compaction: Compaction;
  readonly events: EventLog;
  readonly documents: DocumentStore;
  /** Checked context lifecycle; legacy work must settle before transition. */
  readonly cvContexts: CvContextStore;
  readonly cvCopies: ReturnType<typeof createCvCopies>;
  readonly cvLifecycle: Pick<CvLifecycle, 'clearContent' | 'list' | 'accept' | 'discard'>;
  readonly indexRecovery: Pick<IndexRecoveryStore, 'enqueue' | 'status' | 'indexed'>;
  /**
   * The canonical CV boundary used by trusted hosts.
   *
   * A replacement and invalidation of its derived search chunks commit in one
   * SQLite transaction. The editor never makes an embedding call implicitly;
   * profile chat can still read the current document through `read_cv`.
   */
  readonly offerSnapshots: ReturnType<typeof createOfferSnapshots>;
  readonly photos: ReturnType<typeof createContextPhotos>;
  readonly profile: {
    read(): DocumentRecord | undefined;
    replace(document: DocumentBody): {
      readonly record: DocumentRecord;
      readonly clearedChunks: number;
    };
    readContext(contextId: string): { readonly context: CvContext; readonly record?: DocumentRecord };
    replaceContext(contextId: string, document: DocumentBody, expectedRevision: number, operationId?: string): {
      readonly context: CvContext;
      readonly record: DocumentRecord;
      readonly clearedChunks: number;
    };
  };
  /** The write half. Held here, never placed on a run context. */
  readonly chunks: ChunkIndex;
  readonly opportunities: ReturnType<typeof createOpportunityStore>;
  readonly offers: OfferStore;
  readonly browser: ReturnType<typeof createBrowserService>;
  readonly board: ReturnType<typeof createBoardService>;
  readonly applicationAgent: ReturnType<typeof createApplicationAgent>;
  readonly offerQueries: ReturnType<typeof createOfferQueryService>;
  readonly discoveryChat: ReturnType<typeof createDiscoveryChatService>;
  readonly discoverySearches: ReturnType<typeof createDiscoverySearchStore>;
  readonly discovery: ReturnType<typeof createDiscoveryService>;
  readonly offerNotes: ReturnType<typeof createOfferNotes>;
  readonly enrichment: ReturnType<typeof createEnrichmentService>;
  readonly detailQueue: ReturnType<typeof createDetailQueue>;
  /**
   * The durable transcript, one per subject.
   *
   * Not derived from runs and not derivable from them: what a person asked is
   * theirs, and a run is only the machinery that answered one of the questions.
   */
  readonly conversations: ConversationStore;
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
  /**
   * What model this runtime talks to, changeable while it is running.
   *
   * A settings change must not restart the process: a person editing a model id
   * while a run is going should not have that run killed by the edit. The
   * resolver reads a record this object owns, so a write here is visible to the
   * next call and to nothing that already started.
   *
   * `secret` is the half that never touches the database. See
   * `providers/environment.ts` — the keychain on the host's side is the store of
   * record, and this process holds a copy for as long as it is alive.
   */
  readonly integrationDirectories: ReturnType<typeof createIntegrationDirectories>;
  readonly integrations: ReturnType<typeof createIntegrationManagement>;
  readonly settings: {
    read(): Settings;
    write(next: Settings): Settings;
    secret(providerId: string, apiKey: string | undefined): void;
    status(draft?: { settings: Settings; keys?: Readonly<Record<string, string>> }): Promise<ProviderStatus>;
    test(draft: { settings: Settings; keys?: Readonly<Record<string, string>> }): Promise<ProviderConnectionTest>;
  };
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
  const databasePath = options.databasePath ?? defaultDatabasePath();
  const db = open(databasePath);
  migrate(db);

  const runs = createRunStore(db);
  const groundingRecords = createRecordStore(db);
  const selectionStore = createSelectionStore(db);
  const limitStore = createLimitStore(db);
  const wells = defaultWells();
  const events = createEventLog(db);
  const approvals = createApprovalStore(db, options.now);
  const documents = createDocumentStore(db, options.now);
  const cvContexts = createCvContextStore(db, options.now);
  const chunks = createChunkIndex(db, options.now);
  const cvLifecycle = createCvLifecycle(db, cvContexts, documents, chunks, () => cvDocumentSchema.parse({}), options.now);
  const offers = createOfferStore(db);
  const opportunities = createOpportunityStore(db, options.now);
  opportunities.sync();
  const offerQueryStore = createOfferQueryStore(db, options.now);
  const offerQueries = createOfferQueryService(offerQueryStore);
  const discoverySearches = createDiscoverySearchStore(db, offers, options.now);
  const scraperToken = options.scraperToken ?? options.env?.SCRAPER_API_TOKEN ?? process.env.SCRAPER_API_TOKEN;
  const catalogue = createDiscoveryCatalogue(db, offers);
  const enrichmentStore = createEnrichmentStore(db, offers);
  const browserImports = createBrowserImportStore(db,offers,catalogue,discoverySearches,enrichmentStore,options.now);
  const integrations = createIntegrationManagement(createIntegrationSettingsStore(db), {
    env: options.env ?? process.env, fetch: options.integrationFetch, now: options.now, providers: options.integrationProviders,
    directory: options.integrationCacheDirectory ?? (options.env ?? process.env).INTEGRATION_PROVIDERS_CACHE_DIR ??
      (databasePath === ':memory:' ? join(tmpdir(), 'cvitae-integrations-'+randomUUID()) : join(dirname(resolve(databasePath)), 'integrations')),
  });
  const integrationDirectories = createIntegrationDirectories(createIntegrationDirectoryStore(db), integrations, {fetch:options.integrationFetch,now:options.now});
  const integrationProviders = integrations.providers;
  const browser = createBrowserService(browserImports,options.now,integrationProviders);
  const integrationDiscovery = options.discoverySource ?? createIntegrationDiscovery(integrationProviders, {url:options.scraperUrl,token:scraperToken,now:options.now});
  const discovery = createDiscoveryService(catalogue,
    withDiscoveryMetadata(db, integrationDiscovery), options.now, discoverySearches);
  const attempts = createAttemptLog(db);
  const aiLog = createAiLog(db);
  if (options.aiCallsKeptMs !== undefined) aiLog.prune((options.now ?? Date.now)() - options.aiCallsKeptMs);
  const settings = createSettingsStore(db, options.now);
  const conversations = createConversationStore(db, options.now);
  const offerSnapshots = createOfferSnapshots(db, cvContexts, documents, offers, conversations, options.now);
  const cvCopies = createCvCopies(db, cvContexts, documents, options.now);

  // The user's choices over the inherited environment, applied before anything
  // can resolve a model. A stored setting that has since become invalid — a
  // provider removed between releases — must not stop the runtime from opening,
  // because the settings page that would fix it lives in the application this
  // runtime is serving.
  const environment = createEnvironment(options.env);
  try {
    environment.apply(settings.read());
  } catch {
    environment.apply({});
  }

  const assertNoLegacyWork = (): void => {
    if (db.prepare("SELECT id FROM runs WHERE context_id IS NULL AND status IN ('queued', 'running', 'suspended') AND NOT EXISTS (SELECT 1 FROM board_run_inputs WHERE run_id=runs.id) LIMIT 1").get()) {
      throw new CvContextError('context_conflict', 'Finish or cancel legacy runs before enabling CV contexts.');
    }
  };
  const assertLegacy = (): void => {
    if (cvContexts.list().some((context) => context.id !== CV_ID || context.language !== null)) {
      throw new CvContextError('invalid_input', 'An explicit CV context is required with multiple or non-legacy contexts.');
    }
  };
  const replaceProfile = db.transaction((document: DocumentBody) => {
    assertLegacy();
    const record = documents.update(CV_ID, CV_KIND, () => document);
    const clearedChunks = chunks.clear(CV_ID);
    return { record, clearedChunks };
  }).immediate;

  const requireContext = (contextId: string): CvContext => {
    const context = cvContexts.get(contextId);
    if (!context) throw new CvContextError('context_not_found', `No such CV context: ${contextId}`);
    return context;
  };
  const readContext = db.transaction((contextId: string) => {
    const context = requireContext(contextId);
    const record = documents.read(contextId);
    return { context, ...(record ? { record } : {}) };
  });
  const replaceContext = db.transaction((contextId: string, document: DocumentBody, expectedRevision: number, operationId?: string): {
    context: CvContext; record: DocumentRecord; clearedChunks: number;
  } => {
    const key = JSON.stringify([contextId, expectedRevision, document]);
    if (operationId !== undefined) {
      if (!operationId.trim() || operationId.length > 200) throw new CvContextError('invalid_input', 'Invalid operation ID.');
      const prior = db.prepare('SELECT request, result FROM cv_write_receipts WHERE operation_id = ?').get(operationId) as { request: string; result: string } | undefined;
      if (prior) {
        if (prior.request !== key) throw new CvContextError('context_conflict', 'Operation ID belongs to another write.');
        return JSON.parse(prior.result) as { context: CvContext; record: DocumentRecord; clearedChunks: number };
      }
    }
    const context = requireContext(contextId);
    // This boundary requires a base even for untyped trusted-host callers.
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new CvContextError('invalid_input', 'Expected document revision must be a non-negative safe integer.');
    }
    const record = documents.update(contextId, CV_KIND, () => document, { expectedRevision });
    const clearedChunks = chunks.clear(contextId);
    const result = { context, record, clearedChunks };
    if (operationId !== undefined) db.prepare('INSERT INTO cv_write_receipts VALUES (?, ?, ?)').run(operationId, key, JSON.stringify(result));
    return result;
  }).immediate;

  const echo = options.echo;
  const logger: AiLogger = options.logger
    ?? (echo ? { record: entry => { aiLog.record(entry); echo.record(entry); } } : aiLog);

  // Resolution is deferred until a step needs a model, so a runtime with no
  // credential still opens, still lists runs, and still fails at the point of
  // use with a message naming the variable rather than at import time with a
  // stack.
  const resolver = createModelResolver({ env: environment.env });

  const ai = createAiGateway({
    resolver,
    logger,
    ...(options.now ? { now: options.now } : {})
  });

  // In memory and nowhere else: Studio sends them when it connects.
  const maskTerms = createMaskTerms();

  // What the index is made from, and what it is searched with, is the person's CV
  // and the person's words, and neither happens inside a run, so a run's own
  // wrapper never sees them. This is the same rule for the one call a run does not
  // make: an embedder that is not on this machine is sent placeholders, and the
  // vectors that come back need nothing put right. The mode, the scope, the CV
  // and the terms are asked at each call, as a run asks them at each message.
  const embedder = maskedGateway(ai, {
    mode: () => maskModeOf(settings.read().maskMode),
    seeds: () => [...cvSeeds(documents, maskScopeOf(settings.read().maskScope)), ...termSeeds(maskTerms.read())],
    detect: true
  });

  const indexJobs = createIndexRecoveryStore(db, chunks, options.now);
  // A rebuild starts by itself, before any host has said a word, so it is the one
  // call that could be made before the runtime is told the terms. One that would
  // be masked waits for them, an empty list included; one that would not is sent
  // as it always was.
  const indexRebuilder = createIndexRebuilder(indexJobs, embedder, {
    ready: () => maskTerms.declared() || !masksEmbedding(maskModeOf(settings.read().maskMode), ai)
  });
  if (options.indexRecovery) indexRebuilder.start();

  // One reader, two names on it. The pairing `retrieval` and `index` make on
  // `RunContext`, for the same reason: a step asks for the authority it needs
  // rather than receiving everything the implementation can do. Built once
  // because the per-host politeness map is the thing being shared — two of
  // them spacing the same host at a second each is two requests a second.
  const web = createWebReader({
    ...(options.scraperUrl === undefined ? {} : { scraperUrl: options.scraperUrl }),
    ...(scraperToken === undefined ? {} : { scraperToken }),
    ...(options.now ? { now: options.now } : {})
  });

  const integrationOfferLookup = createIntegrationOfferLookup(db);
  const offerReader = options.offerReader ?? createIntegrationOfferReader(integrationProviders, {url:options.scraperUrl, token:scraperToken, now:options.now, lookup:integrationOfferLookup});

  const effects = {
    ai,
    offers: offerReader,
    sites: withIntegrationSites(web,integrationProviders,integrationDiscovery),
    search: createWebSearch({ ...(options.now ? { now: options.now } : {}) }),
    sources: createSourceReader({ ai }),
    attempts
  };

  // The reader half only. `chunks` keeps the write half up here, where indexing
  // happens, and a step is handed something with no `replace` on it at all.
  const retrieval = createRetriever({ reader: chunks, ai: embedder, traceId: 'retrieval' });

  const deps: RuntimeDeps = {
    scopeLegacy: assertLegacy,
    offerInput: (id, capability, input) => {
      const snapshot = offerSnapshots.get(id);
      if (!snapshot) throw new CvContextError('context_not_found', 'No such offer snapshot.');
      return snapshotInput(snapshot, capability, input);
    },
    scopeOffer: (id, conversationId) => {
      const snapshot = offerSnapshots.get(id);
      if (!snapshot || snapshot.conversationId !== conversationId || !conversations.read(conversationId)) {
        throw new CvContextError('context_conflict', 'Snapshot and conversation do not match.');
      }
      return { ...bindOfferScope(snapshot, effects), offerId: snapshot.offer.id };
    },
    finish: db.transaction((runId: string, result: RunResult, commit: (result: RunResult) => void) => {
      const run = runs.get(runId);
      let final = result;
      if (run?.contextId && !run.offerSnapshotId && run.capability === 'edit_cv' && result.data.changed === true && result.data.base) {
        const proposal = cvLifecycle.propose(runId, result.data.base as CvProposalBase,
          normaliseCv(cvDocumentSchema.parse(result.data.document)),
          // What the edit was aimed at and what it changed, which an accept writes
          // and nothing else. Parsed, so that what is stored is what a host is told.
          typeof result.data.target === 'string' && result.data.changes !== undefined
            ? { target: result.data.target, changes: cvChangesSchema.parse(result.data.changes) }
            : undefined);
        final = { ...result, data: { ...result.data, proposalId: proposal.id } };
      }
      if (run?.offerSnapshotId) {
        final = { ...final, data: { ...final.data, offerSnapshotId: run.offerSnapshotId,
          contextId: run.contextId, contextRevision: run.contextRevision } };
      }
      commit(final);
      return final;
    }).immediate,
    scopeCv: (contextId, conversationId, expectedGeneration, expectedRevision) => {
      const context = requireContext(contextId);
      const generation = expectedGeneration ?? context.generation;
      const revision = documents.read(contextId)?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw new CvContextError('context_conflict', 'CV changed since this operation was started.', { contextId, expectedRevision, actualRevision: revision });
      }
      cvLifecycle.guard(contextId, generation, () => undefined);
      if (conversationId !== undefined) {
        const subject = conversations.read(conversationId)?.conversation.subject;
        if (!subject || subject.kind !== 'profile' || (subject.id || CV_ID) !== contextId) {
          throw new CvContextError('context_conflict', 'Conversation does not belong to this CV context.');
        }
      }
      return { ...bindCvScope(contextId, { documents, retrieval, index: chunks }, (write) => cvLifecycle.guard(contextId, generation, write)), contextGeneration: generation, contextRevision: revision };
    },
    capabilities: options.capabilities ?? defaultCapabilities,
    runs,
    gate: (runId, step) => createApprovalGate(approvals, runId, step),
    effects,
    tools: createToolRegistry(defaultTools),
    documents,
    retrieval,
    index: chunks,
    grounding: { records: groundingRecords, wells },
    // Asked at the start of every run, so a change made in settings is in force
    // for the next message and no run is half one thing and half the other.
    masking: {
      mode: () => maskModeOf(settings.read().maskMode),
      scope: () => maskScopeOf(settings.read().maskScope),
      terms: maskTerms.read
    },
    selection: selectionStore,
    limits: limitStore,
    offerShelf: {
      read: (ids) =>
        ids.flatMap((id) => {
          const offer = offers.get(id);
          return offer === undefined ? [] : [offer];
        }),
      // The Board is made below, and is asked at the time a message is, not now.
      onBoard: (ids) => {
        const onBoard = new Set(boardStore.list().map((entry) => entry.offerId));
        return new Set(ids.filter((id) => onBoard.has(id)));
      }
    },
    history: createHistory({
      conversations,
      records: groundingRecords,
      walls: (conversationId) => selectionStore.walls(conversationId),
      capabilities: options.capabilities ?? defaultCapabilities
    }),
    logger,
    ...(options.deltas ? { deltas: options.deltas } : {}),
    newRunId: options.newRunId ?? (() => crypto.randomUUID()),
    ...(options.now ? { now: options.now } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  };

  const discoveryChatStore = createDiscoveryChatStore(db, conversations, options.now, offerQueryStore, (conversationId) => selectionStore.walls(conversationId));
  const discoveryChat = createDiscoveryChatService(discoveryChatStore, (scope, signal, onText) => beginRun({
    ...bindDiscoveryScope(deps), timeoutMs: Math.min(options.timeoutMs ?? 120000,120000), capabilities: { ask_discovery: askDiscoverySql(scope, createDiscoverySqlPort(offerQueries, offerQueryStore, discoveryChatStore.recordSql, factPort, collectionPort, discoveryChatStore.scope)) },
    deltas: (delta) => { onText(delta.text); deps.deltas?.(delta); },
    finish: (runId,result,commit) => {
      if (signal.aborted) throw new RuntimeError('Cancelled','aborted');
      return discoveryChatStore.finish(runId,result,commit);
    }
  }, { capability:'ask_discovery',runId:scope.request.runId,input:{question:scope.request.question},signal }));

  // Public offer extraction has no CV/conversation input. Use only the fixed
  // analyze_offer plan; this does not relax context checks for ordinary runs.
  const enrichment = createEnrichmentService(offers, enrichmentStore, offerReader,
    (offerId, signal) => {
      const offer = offers.get(offerId)!;
      return beginRun({ ...deps, scopeLegacy: () => undefined, capabilities: { analyze_offer: analyzeOffer } }, {
        capability: 'analyze_offer', input: { offerText: offer.text, url: offer.url, stated: offer.stated }, signal
      });
    }, options.now, (value) => { const offer = offers.get(value.offerId); if (offer) discoverySearches.refreshOffer(offer, value); });

  const factPort=createFactPort(offerQueryStore,createOfferFactStore(db),(id,signal)=>enrichment.details.ensure(id,false,signal),()=>environment.env.LOCAL_BASE_URL?.trim()??'default');

  const collectionPort=createCollectionPort(discovery,discoverySearches,offerQueryStore,(id,signal)=>enrichment.details.ensure(id,false,signal),undefined,(searchId)=>discoveryChatStore.excluded(searchId));

  const detailQueue = createDetailQueue(createDetailQueueStore(db), enrichment, discoverySearches);

  const boardStore = createBoardStore(db, offers, ids => new Map(opportunities.resolve(ids).identities.map(item => [item.id,item.opportunityId])), options.now);
  const executeBoardRun = (input: BoardRunInput, signal: AbortSignal) => {
    boardStore.authorizeRun(input.runId,validateInput(route(deps.capabilities,input.capability),input.input));
    const bound = bindOfferScope(input.snapshot,effects);
    return beginRun({...deps,...bound,scopeLegacy:()=>undefined,
      finish: (_runId,result,commit)=>{commit(result);return result;}
    }, {runId:input.runId,capability:input.capability,input:input.input,signal});
  };
  const applicationAgent = createApplicationAgent(boardStore, {
    now: options.now, execute: executeBoardRun,
    captureProfile: contextId => {
      const context=requireContext(contextId),document=documents.read(contextId);
      if(!document)throw new CvContextError('context_not_found','Complete this Profile CV before applying.');
      const photo=createContextPhotos(db,cvContexts,documents,options.now).snapshot(contextId);
      return {context,document,photo:{revision:photo.assetRevision,photo:photo.photo}};
    }
  });
  const board = createBoardService(boardStore, {
    reader: {...(options.boardReader ?? offerReader),capture:async (url,call)=>{
      const captured=browserImports.capture(url);if(captured)return captured;
      // Listing imports have no description yet. Their saved provider binding
      // can authorize detail collection; the reader still checks trust, expiry,
      // enabled state, recipe withdrawal and the original offer identity.
      if(browserImports.has(url) && !integrationOfferLookup(url))throw new OperationError('browser_capture_required','This item only contains a listing. Open the offer in Cvitae Browser, import its details, then resume preparation.');
      const reader=options.boardReader??offerReader;return (reader.capture??reader.resolve).call(reader,url,call);
    }}, contexts: cvContexts.list, run: runs.get, now: options.now,
    emptyCv: cvDocumentSchema.parse({}),
    captureCv: db.transaction((contextId: string) => {
      const context = requireContext(contextId), document = documents.read(contextId);
      if (!document) throw new CvContextError('context_not_found','Create or import the selected CV first.');
      const photo = createContextPhotos(db,cvContexts,documents,options.now).snapshot(contextId);
      return {sourceContext:context,sourceDocument:document,document,photo:{revision:photo.assetRevision,photo:photo.photo}};
    }).deferred,
    execute: executeBoardRun,
    onDrop: entryId => applicationAgent.cancelEntry(entryId)
  });


  return {
    findRun: (request) => {
      const record = request.runId ? runs.get(request.runId) : undefined;
      if (!record) return undefined;
      const capability = route(deps.capabilities, request.capability);
      const input = validateInput(capability, request.offerSnapshotId ? deps.offerInput!(request.offerSnapshotId, request.capability, request.input) : request.input);
      requireSameRun(record, request, input);
      return record;
    },
    begin: (request) => beginRun(deps, request),
    preview: (request) => previewRun(deps, request),
    cancelSuspended: db.transaction((runId: string) => {
      if (runs.get(runId)?.status !== 'suspended') return false;
      createCheckpointer(runs, runId, options.now ?? Date.now).cancelled();
      return true;
    }).immediate,
    beginResume: (request) => beginResume(deps, request),
    run: (request) => startRun(deps, request),
    resume: (request) => resumeRun(deps, request),
    runs,
    // The read half only: the type says so, and so does handing out a wrapper
    // that has no `append` for a caller that ignores the type.
    groundingRecords: { read: (runId) => groundingRecords.read(runId) },
    limits: createLimitService({ store: limitStore, conversations }),
    maskTerms,
    compaction: createCompaction({
      conversations,
      records: groundingRecords,
      walls: (conversationId) => selectionStore.walls(conversationId),
      capabilities: options.capabilities ?? defaultCapabilities
    }),
    selection: createSelectionService({
      store: selectionStore,
      conversations,
      wells,
      holds: (ref) => {
        if (ref.well === CV_WELL) {
          const found = documents.read(ref.scope);
          return cvHolds(found !== undefined && found.kind === CV_KIND ? cvOf(found.body) : undefined, ref.path);
        }
        return ref.well === OFFERS_WELL && offers.get(ref.scope) !== undefined;
      }
    }),
    events,
    documents,
    offerSnapshots,
    cvCopies: { get: cvCopies.get, copy: db.transaction((request) => {
      if (!cvCopies.get(request.id)) assertNoLegacyWork();
      return cvCopies.copy(request);
    }).immediate },
    photos: createContextPhotos(db, cvContexts, documents, options.now),
    profile: {
      read: () => { assertLegacy(); return documents.read(CV_ID); },
      replace: replaceProfile,
      readContext,
      replaceContext
    },
    cvContexts: {
      list: cvContexts.list, get: cvContexts.get,
      create: db.transaction((id, language) => {
        if (!cvContexts.get(id)) assertNoLegacyWork();
        if (cvCopies.get(id)) throw new CvContextError('context_conflict', 'Context ID belongs to a copy request.');
        return cvContexts.create(id, language);
      }).immediate,
      assignLanguage: db.transaction((id, language, revision) => {
        if (cvContexts.get(id)?.language === null) assertNoLegacyWork();
        return cvContexts.assignLanguage(id, language, revision);
      }).immediate
    },
    indexRecovery: { enqueue: indexJobs.enqueue, status: indexJobs.status, indexed: indexJobs.indexed },
    cvLifecycle: { clearContent: cvLifecycle.clearContent, list: cvLifecycle.list, accept: cvLifecycle.accept, discard: cvLifecycle.discard },
    chunks,
    offers,
    browser,
    board,
    applicationAgent,
    opportunities,
    discovery,
    discoverySearches,
    discoveryChat,
    offerQueries,
    enrichment,
    detailQueue,
    offerNotes: createOfferNotes(db, options.now),
    conversations,
    aiCalls: aiLog,
    approvals,
    mail: createMailSender({
      guard: createGuard(attempts, options.now),
      ...(options.mailUrl === undefined ? {} : { url: options.mailUrl })
    }),
    capabilities: deps.capabilities,
    integrations,
    integrationDirectories,
    settings: {
      test: (draft) => {
        const inspected = environment.preview(draft.settings, draft.keys);
        return testProviderConnection(createModelResolver({ env: inspected.env }), inspected);
      },
      read: settings.read,
      // Validated, then stored, then applied — in that order, so a value that
      // cannot work never reaches the file and a value that reached the file is
      // already in force.
      write: (next) => {
        const checked = validateSettings(next);
        const stored = settings.replace(checked);
        environment.apply(stored);
        for (const context of cvContexts.list()) indexJobs.enqueue(context.id);
        return stored;
      },
      secret: (providerId, apiKey) => {
        environment.secret(providerId, apiKey);
        resolver.clearCache();
        // A rebuild parked on a missing or refused key may work with this one.
        indexJobs.resume();
      },
      status: (draft) => {
        const inspected = draft ? environment.preview(draft.settings, draft.keys) : environment;
        return providerStatus(draft ? createModelResolver({ env: inspected.env }) : resolver, inspected, {
          ...(options.probe ? { fetch: options.probe } : {})
        });
      }
    },
    recoverInterrupted: () => recoverInterruptedRuns(runs, options.now),
    close: () => { integrationDirectories.close(); browser.close(); integrations.close(); applicationAgent.close(); board.close(); offerQueries.close(); discoveryChat.close(); detailQueue.close(); enrichment.close(); discovery.close(); indexRebuilder.close(); db.close(); }
  };
};
