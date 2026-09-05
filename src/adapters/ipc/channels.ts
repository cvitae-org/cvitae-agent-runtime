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
import { cvDocumentSchema } from '../../capabilities/cv/document.js';
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
 * There can be many conversations about either — that is what the subject is
 * for — but a profile subject arriving with an id is a subject the client
 * cannot express, and it is refused rather than trimmed into one that looks
 * fine and lists somewhere nobody looks.
 */
const subject = z
  .object({
    kind: z.enum(['profile', 'offer']),
    id: z.string().max(200).default('')
  })
  .refine(
    (value) => (value.kind === 'offer' ? value.id !== '' : value.id === ''),
    'A profile conversation carries no id, and an offer conversation needs one.'
  );

const settings = z.object({
  providerId: setting,
  modelId: setting,
  localBaseUrl: setting,
  embeddingProviderId: setting,
  embeddingModelId: setting
});

export const payloads = {
  'capabilities.list': z.object({}),

  /** The one canonical profile stored by the harness. */
  'profile.get': z.object({}),

  /**
   * A manual edit replaces the whole document. Parsing here both validates the
   * schema version and fills its declared defaults before storage sees it.
   */
  'profile.update': z.object({ document: cvDocumentSchema }),

  /**
   * `input` is unknown on purpose. The capability's own zod schema is what
   * decides whether it is valid, and a second opinion here would be a second
   * thing to keep in step with the first.
   */
  'run.start': z.object({
    capability: z.string().min(1),
    input: z.unknown(),
    /** Lets a caller name the run before it finishes, so it can follow it. */
    runId: runId.optional()
  }),

  'run.resume': z.object({ runId }),

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

  /**
   * What the next run would resolve to, and whether it could.
   *
   * Answerable without a model call, which is what makes it usable as a "test
   * connection" button: a person part-way through configuring the app should
   * not be billed for finding out that they are not finished.
   */
  'providers.status': z.object({}),

  /** Every conversation, or one subject's. Most recently active first. */
  'conversations.list': z.object({ subject: subject.optional() }),

  /**
   * Where a window comes back to: the most recently active conversation about a
   * subject, or a first one when there are none.
   *
   * Resuming rather than starting, which is why it is not `create`. A caller
   * restoring a window does not know whether this is the first question, and
   * should not have to ask before it can show anything.
   */
  'conversations.open': z.object({ subject }),

  /** New chat. Always another one, never the one that is already open. */
  'conversations.create': z.object({ subject }),

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

  'conversations.delete': z.object({ conversationId })
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
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export const ok = <T>(data: T): Response<T> => ({ ok: true, data });

export const failed = (code: string, message: string): Response<never> => ({
  ok: false,
  error: { code, message }
});
