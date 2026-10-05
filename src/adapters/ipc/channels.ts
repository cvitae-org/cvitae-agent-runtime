import { directoryPayloads } from '../../contracts/integration-directories.js';
import { integrationPayloads } from '../../contracts/integration-settings.js';
import { discoveryBoardIdSchema, maxDiscoveryBoards } from '../../contracts/discovery-board.js';
import { boardPayloads } from '../../contracts/board-channels.js';
import { queryPayloads } from '../../contracts/offer-query.js';
/**
 * The channel names and what may be sent on each.
 *
 * One file, no Electron, no `ipcMain`. A host wires these into whatever
 * transport it has — `ipcMain.handle`, a websocket, an HTTP route table — and
 * the transport is the only thing that changes. That is why this is a table of
 * names and schemas rather than a set of handlers: the names and the payload
 * shapes are the contract, and a handler is an implementation detail of the
 * process that happens to answer them.
 *
 * Every payload is validated here, at the boundary, before it reaches anything.
 * In an Electron shell the caller is a renderer, and a renderer hosts remote
 * content — a page it loaded, a script that page pulled in. "The other side of
 * this channel is our own code" stops being true the first time a window
 * navigates, and a validated envelope is what makes that stop mattering.
 *
 * What is deliberately absent:
 *
 *   Mail. Same rule as `tools/`, for the same reason and one step further out,
 *   and enforced the same way — `no-channel-wraps-mail` in the boundary rules
 *   forbids this directory from importing `effects/mail.ts` at all. Scraped
 *   offer text reaches model context; an outbound channel reachable from the
 *   same process is an exfiltration path whether a model or a page found it.
 *   `runtime/create.ts` hands the sender to a host directly, and a host is a
 *   program someone wrote rather than a page someone loaded.
 *
 *   Anything returning a handle. A `ChunkIndex`, a `Database`, a store — none
 *   of them survive being serialised, so a channel offering one would fail at
 *   the transport rather than at review. Every response below is JSON a
 *   structured clone can carry.
 *
 *   A free-text query channel. `runs.list` takes a status and a capability,
 *   both closed sets, not a predicate a caller composes. A filter expressed as
 *   a string is a query language, and the moment a page can influence one the
 *   shape of the query is in its hands.
 */

import { z } from 'zod';
import { discoveryFiltersSchema, discoveryBudgetSchema, discoveryBudgetDefaults, discoveryChatRequestSchema, discoveryImportSchema, discoverySearchBatchSchema, discoveryImportBatchSchema, discoveryImportIdentitySchema, discoverySearchPageSchema } from '../../contracts/discovery-search.js';
import { cvDocumentSchema } from '../../capabilities/cv/document.js';
import { cvPhotoSchema } from '../../capabilities/cv/photo.js';
import { runStatuses } from '../../contracts/index.js';

/* ------------------------------------------------------------------ inputs */

const runId = z.string().min(1);

/**
 * One model setting. Capped because a provider or model id is short, and an
 * unbounded string on a channel is a row someone can make arbitrarily large.
 */
const setting = z.string().max(200).nullish();

const conversationId = z.string().min(1);

/**
 * What a conversation is about.
 *
 * Mirrors the client's sealed `ChatSubject` exactly, including which half of
 * the pair carries an id: the profile is one thing and there is only ever one
 * of it, and an offer conversation is meaningless without saying which offer.
 * Profile IDs name registered CV contexts. The empty legacy ID remains an
 * alias for cv; unknown explicit IDs are rejected by the store.
 */
const subject = z
  .object({
    kind: z.enum(['profile', 'offer', 'discovery']),
    id: z.string().max(200).default('')
  }).strict()
  .refine(
    (value) => value.kind === 'profile' || value.id !== '',
    'An offer conversation needs an offer ID.'
  );

const settings = z.object({
  providerId: setting,
  modelId: setting,
  localBaseUrl: setting,
  embeddingProviderId: setting,
  embeddingModelId: setting
});

export const payloads = {
  ...boardPayloads,
  'browser.internal.dispatch': z.object({sessionId:z.string().uuid(),targetSearchId:z.string().min(1).max(200).optional(),method:z.enum(['browser.recipe','collection.navigation','browser.hello','capture.preview','import.commit','operation.read','capture.cancel','collection.start','collection.append','collection.preview','collection.commit','collection.cancel']),payload:z.unknown()}).strict(),
  'browser.status': z.object({}).strict(),
  'browser.configure': z.object({enabled:z.boolean()}).strict(),
  'browser.poll': z.object({after:z.number().int().nonnegative().default(0)}).strict(),
  'browser.collection': z.object({}).strict(),
  'capabilities.list': z.object({}),

  /** The one canonical profile stored by the harness. */
  'profile.get': z.object({}).strict(),

  /** Additive contract: no creation/assignment until AI routing is isolated. */
  'protocol.get': z.object({}).strict(),
  'profile.contexts.create': z.object({ protocolVersion: z.literal(2), id: z.string().uuid(), language: z.enum(['pl', 'en']) }).strict(),
  'profile.contexts.assignLanguage': z.object({ protocolVersion: z.literal(2), contextId: z.string().min(1), language: z.enum(['pl', 'en']), expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  'profile.contexts.copy': z.object({ protocolVersion: z.literal(2), id: z.string().uuid(), language: z.enum(['pl', 'en']), sourceContextId: z.string().min(1), expectedSourceRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  'profile.contexts.provenance': z.object({ contextId: z.string().min(1) }).strict(),
  'run.offer.start': z.object({ protocolVersion: z.literal(2), offerSnapshotId: z.string().uuid(), contextId: z.string().min(1), conversationId: z.string().min(1), capability: z.string().min(1), input: z.unknown(), runId }).strict(),
  'profile.contexts.list': z.object({}).strict(),
  'profile.context.reindex': z.object({ contextId: z.string().min(1).max(200) }).strict(),
  'profile.context.indexStatus': z.object({ contextId: z.string().min(1).max(200) }).strict(),
  'profile.context.clearContent': z.object({
    contextId: z.string().min(1).max(200),
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    operationId: z.string().trim().min(1).max(200)
  }).strict(),
  'profile.proposals.list': z.object({ contextId: z.string().min(1).max(200) }).strict(),
  'profile.proposals.accept': z.object({ contextId: z.string().min(1).max(200), proposalId: z.string().min(1).max(200) }).strict(),
  'profile.proposals.discard': z.object({ contextId: z.string().min(1).max(200), proposalId: z.string().min(1).max(200) }).strict(),
  'profile.context.get': z.object({ contextId: z.string().min(1).max(200) }).strict(),
  'profile.context.update': z.object({
    operationId: z.string().trim().min(1).max(200).optional(),
    contextId: z.string().min(1).max(200),
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    document: cvDocumentSchema
  }).strict(),

  /**
   * A manual edit replaces the whole document. Parsing here both validates the
   * schema version and fills its declared defaults before storage sees it.
   */
  'profile.update': z.object({ document: cvDocumentSchema }).strict(),

  /**
   * The photograph, on channels of its own.
   *
   * Three rather than folding it into `profile.update`, because the CV is read
   * and written whole on every edit and a portrait riding along on each of them
   * is a megabyte spent to move a job title. `photo.ts` has the rest of the
   * argument.
   *
   * `clear` takes no photograph and is not `set` with a null: a caller that can
   * express "store this" and a caller that can express "there is none" are
   * answering different questions, and one channel doing both is one typo away
   * from erasing a picture instead of leaving it alone.
   */
  'offers.list': z.object({ limit: z.number().int().min(1).max(1000).default(500) }).strict(),
  'offers.get': z.object({ id: z.string().min(1).max(200) }).strict(),
  ...queryPayloads,
  'opportunities.resolve': z.object({ ids: z.array(z.string().min(1).max(200)).max(1000) }).strict(),
  'opportunities.link': z.object({ offerId: z.string().min(1).max(200), otherOfferId: z.string().min(1).max(200) }).strict(),
  'opportunities.separate': z.object({ offerId: z.string().min(1).max(200) }).strict(),
  'opportunities.candidates': z.object({ offerId: z.string().min(1).max(200), term: z.string().trim().min(2).max(300) }).strict(),
  'discovery.searches.createBatch': discoverySearchBatchSchema,
  'discovery.searches.import.begin': discoveryImportSchema,
  'discovery.searches.import.append': discoveryImportBatchSchema,
  'discovery.searches.import.finish': discoveryImportIdentitySchema,
  'discovery.searches.filters': z.object({ id: z.string().min(1).max(200), filters: discoveryFiltersSchema, revision: z.number().int().nonnegative() }).strict(),
  'discovery.chat.get': z.object({ searchId: z.string().min(1).max(200), before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
  'discovery.chat.start': discoveryChatRequestSchema,
  'discovery.chat.cancel': z.object({ searchId: z.string().min(1).max(200), runId: z.string().min(1).max(200) }).strict(),
  'discovery.searches.list': z.object({ limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).max(100000).default(0) }).strict(),
  'discovery.searches.offer': z.object({ id: z.string().min(1).max(200), offerId: z.string().min(1).max(200), group: z.enum(['accepted','review']).default('accepted') }).strict(),
  'discovery.searches.read': discoverySearchPageSchema,
  'discovery.offers.manage': z.object({ id: z.string().min(1).max(200), offerIds: z.array(z.string().min(1).max(200)).min(1).max(1000), action: z.enum(['hide','delete','blacklist','restore','unblacklist']) }).strict(),
  'discovery.offers.managed': z.object({ id: z.string().min(1).max(200) }).strict(),
  'discovery.searches.delete': z.object({ id: z.string().min(1).max(200) }).strict(),
  'discovery.browserSearch': z.object({ board: discoveryBoardIdSchema, keyword: z.string().max(300) }).strict(),
  'discovery.boards': z.object({}).strict(),
  'offers.note.get': z.object({ offerId: z.string().min(1).max(200) }).strict(),
  'offers.note.save': z.object({ offerId: z.string().min(1).max(200), text: z.string().max(10000), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) }).strict(),
  'discovery.details.auto.enqueue': z.object({ searchId: z.string().min(1).max(200), offerIds: z.array(z.string().min(1).max(200)).min(1).max(100) }).strict(),
  'discovery.details.auto.poll': z.object({ after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0) }).strict(),
  'discovery.details.auto.pause': z.object({ paused: z.boolean() }).strict(),
  'discovery.details.auto.stop': z.object({}).strict(),
  'discovery.details.auto.clear': z.object({}).strict(),
  'discovery.details.start': z.object({ offerId: z.string().min(1).max(200), force: z.boolean().default(false) }).strict(),
  'discovery.details': z.object({ offerId: z.string().min(1).max(200) }).strict(),
  'discovery.details.cancel': z.object({ offerId: z.string().min(1).max(200) }).strict(),
  'discovery.enrich': z.object({ offerId: z.string().min(1).max(200), force: z.boolean().default(false), refreshDetails: z.boolean().optional() }).strict(),
  'discovery.enrichment': z.object({ offerId: z.string().min(1).max(200) }).strict(),
  'discovery.enrichment.cancel': z.object({ offerId: z.string().min(1).max(200) }).strict(),
  'discovery.cached': z.object({
    searchId: z.string().min(1).max(200).optional(),
    keyword: z.string().trim().min(1).max(300),
    boards: z.array(discoveryBoardIdSchema).min(1).max(maxDiscoveryBoards),
    matchMode: z.enum(['title', 'anywhere']).default('anywhere'),
    unknownPolicy: z.literal('separate').default('separate'),
    activity: z.enum(['exclude_explicitly_inactive','any']).default('exclude_explicitly_inactive'),
    maxPublishedAgeDays: z.number().int().min(0).max(3650).nullable().default(null),
    limit: z.number().int().min(1).max(100).default(30),
    offset: z.number().int().min(0).max(1_000_000).default(0)
  }).strict(),
  'discovery.start': z.object({
    refetch: z.enum(['append', 'reset']).optional(),
    schemaVersion: z.literal(2).optional(),
    searchId: z.string().min(1).max(200).optional(),
    keyword: z.string().trim().min(1).max(300),
    boards: z.array(discoveryBoardIdSchema).min(1).max(maxDiscoveryBoards),
    sourceMode: z.enum(['live', 'cache', 'hybrid']).default('live'),
    matchMode: z.enum(['title', 'anywhere']).default('anywhere'),
    unknownPolicy: z.literal('separate').default('separate'),
    activity: z.enum(['exclude_explicitly_inactive','any']).default('exclude_explicitly_inactive'),
    maxPublishedAgeDays: z.number().int().min(0).max(3650).nullable().default(null),
    workMode: z.enum(['any','remote','hybrid','onsite']).default('any'),
    budget: discoveryBudgetSchema.default(discoveryBudgetDefaults),
    pageSize: z.number().int().min(1).max(100).default(30),
    replaceSessionId: z.string().uuid().optional()
  }).strict(),
  'discovery.poll': z.object({ id: z.string().uuid(), after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0) }).strict(),
  'discovery.next': z.object({ id: z.string().uuid(), board: discoveryBoardIdSchema.optional() }).strict(),
  'discovery.cancel': z.object({ id: z.string().uuid() }).strict(),
  'offers.snapshots.capture': z.object({
    id: z.string().uuid(), offerId: z.string().min(1).max(200), contextId: z.string().min(1).max(200),
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    expectedContextRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    expectedPhotoRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  }).strict(),
  'offers.snapshots.get': z.object({ id: z.string().uuid() }).strict(),
  'offers.snapshots.list': z.object({ offerId: z.string().min(1).max(200), contextId: z.string().min(1).max(200).optional() }).strict(),
  'profile.photoAsset.get': z.object({}).strict(),
  'profile.photoAsset.replace': z.object({
    photo: cvPhotoSchema.nullable(), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    operationId: z.string().trim().min(1).max(200)
  }).strict(),
  'profile.context.photo.get': z.object({ contextId: z.string().min(1).max(200) }).strict(),
  'profile.context.photo.include': z.object({
    contextId: z.string().min(1).max(200), includePhoto: z.boolean(),
    expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    operationId: z.string().trim().min(1).max(200)
  }).strict(),
  'profile.photo.get': z.object({}).strict(),
  'profile.photo.set': z.object({ photo: cvPhotoSchema }).strict(),
  'profile.photo.clear': z.object({}).strict(),

  /**
   * `input` is unknown on purpose. The capability's own zod schema is what
   * decides whether it is valid, and a second opinion here would be a second
   * thing to keep in step with the first.
   */
  'run.context.start': z.object({
    contextRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    contextGeneration: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    contextId: z.string().min(1).max(200),
    conversationId: z.string().min(1).max(200).optional(),
    capability: z.string().min(1),
    input: z.unknown(),
    /** Lets a caller name the run before it finishes, so it can follow it. */
    runId: runId.optional()
  }).strict(),

  'run.start': z.object({ capability: z.string().min(1), input: z.unknown(), runId: runId.optional() }).strict(),

  'run.resume': z.object({ runId }).strict(),

  /**
   * Waits for a run to reach a terminal state, and answers with what it
   * produced.
   *
   * The other half of `run.start` returning an id. Progress arrives as events;
   * the *outcome* is a separate question because it is answered at a different
   * time, and a caller usually wants both — the timeline while it happens, the
   * result once it is over.
   *
   * Answerable after the fact. A run this process is no longer executing is
   * read from its row, which carries the result, the names of the steps that
   * degraded, and the code a failure ended with.
   */
  'run.await': z.object({ runId }),

  /**
   * Cancellation is a channel rather than a signal because an `AbortSignal`
   * does not serialise. The dispatcher holds the controller for each run it
   * started; a run started by another process is not this one's to cancel, and
   * saying so is more useful than pretending otherwise.
   */
  'run.cancel': z.object({ runId }),

  'runs.list': z.object({
    status: z.enum(runStatuses).optional(),
    capability: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    before: z.number().int().positive().optional()
  }),

  'runs.get': z.object({ runId }),

  /**
   * What a chat run was given and what it read, as the run wrote it down.
   *
   * A channel of its own rather than a field of `runs.get`. That answer is the
   * run row and its steps, every caller pays for what it carries, and a record
   * can be long: one entry for each passage a search handed over. A caller that
   * wants to show what an answer was based on asks for this one run's record
   * and leaves the rest alone.
   */
  'runs.grounding': z.object({ runId }).strict(),

  /**
   * The tail. `after` is the last `seq` the caller saw, which is the whole
   * reason `seq` is per-run and gapless: reconnecting is this same call with
   * the same number, so a closed window costs no replay and leaves no gap.
   */
  'runs.events': z.object({
    runId,
    after: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(500).optional()
  }),

  'approvals.pending': z.object({ runId }),

  'approvals.decide': z.object({
    approvalId: z.string().min(1),
    status: z.enum(['granted', 'denied']),
    decision: z.record(z.string(), z.unknown()).optional()
  }),

  ...integrationPayloads,
  ...directoryPayloads,
  'settings.get': z.object({}),

  /**
   * Replaces every model setting at once.
   *
   * Which values are legal is decided by `providers/environment.ts`, not here.
   * A `z.enum(providerIds)` in this file would be a second copy of the provider
   * list, kept in step by hand, and the copy is what goes stale — the message a
   * person reads on a bad value already names the supported providers.
   *
   * `nullish` rather than `optional`: a settings form that clears a field sends
   * `null` at least as often as it omits the key, and both mean the same thing.
   */
  'settings.set': z.object({ settings: settings }),

  /**
   * A credential, for the life of this process.
   *
   * It reaches the mutable environment and stops there — no column can hold it,
   * and the reply carries the provider back but never the key. The store of
   * record is the host's keychain; this is the copy the resolver reads.
   */
  'secrets.set': z.object({
    providerId: z.string().min(1).max(64),
    apiKey: z.string().min(1).max(4096)
  }),

  'secrets.clear': z.object({ providerId: z.string().min(1).max(64) }),

  /** Explicit, bounded chat and embedding calls over an isolated draft. */
  'providers.test': z.object({
    settings,
    keys: z.record(z.string().min(1).max(64), z.string().min(1).max(4096)).optional()
  }).strict(),

  /** Resolved metadata and local model discovery, without generation. */
  'providers.status': z.object({
    settings: settings.optional(),
    keys: z.record(z.string().min(1).max(64), z.string().min(1).max(4096)).optional()
  }).refine(value => value.settings !== undefined || value.keys === undefined, 'Draft keys require draft settings.'),

  /** Every conversation, or one subject's. Most recently active first. */
  'conversations.list': z.object({ subject: subject.optional() }).strict(),

  /**
   * Where a window comes back to: the most recently active conversation about a
   * subject, or a first one when there are none.
   *
   * Resuming rather than starting, which is why it is not `create`. A caller
   * restoring a window does not know whether this is the first question, and
   * should not have to ask before it can show anything.
   */
  'conversations.open': z.object({ subject }).strict(),

  /** New chat. Always another one, never the one that is already open. */
  'conversations.create': z.object({ subject }).strict(),

  'conversations.get': z.object({ conversationId }),

  /**
   * `text` is capped generously rather than tightly. A pasted job description
   * is a legitimate question and is routinely tens of thousands of characters;
   * the limit is here to bound a row, not to have an opinion about length.
   */
  'conversations.append': z.object({
    conversationId,
    message: z.object({
      role: z.enum(['user', 'assistant']),
      text: z.string().max(200_000),
      /** The run this message belongs to. It must already exist. */
      runId: z.string().min(1).optional(),
      /** The client's id for a message it has already drawn. */
      id: z.string().min(1).max(200).optional()
    })
  }),

  'conversations.rename': z.object({ conversationId, title: z.string().max(200) }),

  /**
   * Records the note carrying the turns that no longer fit, and how far it
   * reaches.
   *
   * A write, like `rename`: nothing behind this channel produces a summary. The
   * thing that does is the `summarize_conversation` capability, which is a run
   * like any other — so it is cancellable, it has an `ai_calls` row, and it
   * degrades where a channel doing a model call inside a store write could do
   * none of the three.
   *
   * `through` is the `seq` of the last message folded in, and never moves
   * backwards; the store clamps rather than trusting the caller, because two
   * clients summarising at once is a race that has one correct outcome.
   */
  'conversations.summarise': z.object({
    conversationId,
    summary: z.string().max(20_000),
    through: z.number().int().min(0)
  }),

  'conversations.delete': z.object({ conversationId }),

  /**
   * What a conversation leaves out of what its runs are given, and whether each
   * exclusion still names something. Not a field of `conversations.get`, which a
   * window calls for every transcript it draws.
   */
  'selection.get': z.object({ conversationId }).strict(),

  /**
   * Excludes and clears pieces, against the revision the caller last saw.
   *
   * `exclude` and `clear` are canonical refs with no version, such as
   * `cv:<context>/experience/acme~engineer`. A change made against a revision
   * that is no longer current is refused as `selection_conflict` and carries the
   * current selection, so a window reloads and offers the change again.
   */
  'selection.update': z.object({
    conversationId,
    expectedRevision: z.number().int().min(0),
    exclude: z.array(z.string().min(1).max(1024)).max(50).default([]),
    clear: z.array(z.string().min(1).max(1024)).max(50).default([])
  }).strict()
} as const;

export type Channel = keyof typeof payloads;

export const channels = Object.keys(payloads) as Channel[];

export const isChannel = (value: unknown): value is Channel =>
  typeof value === 'string' && Object.hasOwn(payloads, value);

export type PayloadOf<C extends Channel> = z.infer<(typeof payloads)[C]>;

/* --------------------------------------------------------------- responses */

/**
 * Every answer is an envelope, and `dispatch` never rejects.
 *
 * A thrown `Error` does not cross a process boundary: structured clone drops
 * the prototype, the `code` and usually the message, so the far side receives
 * an empty object where the reason was. Returning the failure as a value means
 * a caller gets the same `RuntimeErrorCode` a local caller would — which is
 * what lets a window tell "needs a credential" apart from "the page was
 * unreadable" without parsing prose.
 */
export type Response<T = unknown> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  } };

export const ok = <T>(data: T): Response<T> => ({ ok: true, data });

export const failed = (code: string, message: string, details?: Readonly<Record<string, unknown>>): Response<never> => ({
  ok: false,
  error: { code, message, ...(details === undefined ? {} : { details }) }
});
