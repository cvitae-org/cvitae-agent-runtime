/**
 * The outside world, named as ports.
 *
 * An effect is anything that can fail for reasons this process does not control:
 * a network, a disk, a model server, a mail relay. They are declared here and
 * implemented in `effects/`, and nothing in `core/` or `capabilities/` ever
 * constructs one — a step receives the ports it needs on its context, already
 * built, already bound to the run's `AbortSignal`.
 *
 * The set a step receives is `EffectSet`, and the thing to notice about it is
 * what is missing. `MailSender` is declared in this file and is not a member.
 * Mail is built by `runtime/` and handed to `adapters/` alone, so no step can
 * reach it and no tool can wrap it. That is not tidiness: offer text is written
 * by strangers and lands in model context, and an outbound channel one tool
 * call away from attacker-controlled text is an exfiltration path with a
 * plausible cover story. The boundary is also enforced mechanically — see the
 * `no-tool-wraps-mail` rule.
 */

import type { z } from 'zod';
import type { IntegrationExecution } from './integration.js';
import type { MaskCounts } from './mask.js';
import type { StatedFacts, StatedRoutes } from './offer.js';

/* ------------------------------------------------------------------ shared */

/**
 * What every call to the outside world carries.
 *
 * `signal` is not optional anywhere in this file. A timeout that some call
 * sites honour is a timeout that does not exist, and the previous runtime found
 * this the expensive way: a cancelled run kept a model call alive on a busy
 * local GPU, so the next run queued behind work whose result nobody wanted.
 */
export type EffectCall = {
  readonly traceId: string;
  readonly signal: AbortSignal;
  readonly runId?: string;
  readonly step?: string;
};

/* --------------------------------------------------------------------- ai */

/** Matches what the SDK reports, `'unknown'` included — narrowing it here would
 *  only mean guessing at the one case where the provider itself did not say. */
export type FinishReason =
  | 'stop'
  | 'length'
  | 'content-filter'
  | 'tool-calls'
  | 'error'
  | 'other'
  | 'unknown';

export type TokenUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
};

/**
 * What a call that was masked has sent as placeholders so far.
 *
 * Set by the masking gateway on a call it masks (`effects/masking.ts`), cleared by
 * it on one it does not, and read by the gateway below it when the call's line is
 * logged (`AiLogEntry.masked`). Asked and not given, because a tool loop's tools
 * add to it while the call runs.
 */
export type MaskedCall = {
  readonly masked?: (() => MaskCounts) | undefined;
};

export type ObjectRequest<T> = EffectCall & MaskedCall & {
  readonly schema: z.ZodType<T>;
  readonly system: string;
  readonly prompt: string;
  /**
   * Sized per call, not globally. One of five agents in the previous runtime
   * truncated mid-array at exactly 900 tokens while the other four never came
   * near it, so a single shared ceiling is either wasteful or wrong.
   */
  readonly maxOutputTokens: number;
  readonly temperature?: number;
  /** Optional transport retry ceiling; bounded workflows can disable retries. */
  readonly maxRetries?: number;
  /** Enforce the complete JSON schema on providers that support it. */
  readonly strictSchema?: boolean;
};

export type ObjectResult<T> = {
  readonly object: T;
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
};

export type TextRequest = EffectCall & MaskedCall & {
  readonly system: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  readonly temperature?: number;
  /** Optional transport retry ceiling; bounded workflows can disable retries. */
  readonly maxRetries?: number;
  /**
   * Called with each fragment of the completion as it arrives.
   *
   * Optional on the request, and optional in the other direction too: a gateway
   * that never calls it and returns the whole text at the end is *correct*, not
   * broken. That is deliberate. A provider without a streaming endpoint, a
   * cached answer and every fake in the test suite all satisfy this contract
   * without pretending to stream, and a caller cannot be written to depend on
   * fragments arriving — the result is the answer, and this is only how it
   * feels to wait for it.
   */
  readonly onDelta?: (text: string) => void;
};

export type TextResult = {
  readonly text: string;
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
};

/**
 * A tool as the gateway sees it: a name, a schema and a thunk.
 *
 * Already bound to its context, so the gateway needs no registry and no run
 * state to call one. That is what keeps `effects/` from importing `tools/`, and
 * the direction matters — `tools/` wraps effects, never the reverse.
 */
export type ToolHandle = {
  readonly name: string;
  readonly describe: string;
  readonly inputSchema: z.ZodType<unknown>;
  readonly invoke: (input: unknown) => Promise<unknown>;
};

/**
 * One settled turn of the conversation a request continues.
 *
 * Deliberately not `Message` from `contracts/conversation.ts`. That is a row —
 * an id, a `seq`, the run it came from — and none of it is anything the model
 * is told. What the model is told is who spoke and what they said, and keeping
 * the two apart is what lets the transcript grow columns without changing what
 * a request means. The two roles match that file's because they are the two
 * roles a conversation has, not because one type is derived from the other.
 */
export type ConversationTurn = {
  readonly role: 'user' | 'assistant';
  readonly text: string;
};

export type ToolLoopRequest = EffectCall & MaskedCall & {
  readonly system: string;
  readonly prompt: string;
  /**
   * What was said before `prompt`, oldest first, excluding `prompt` itself.
   *
   * Passed to the model as message turns rather than pasted into the prompt,
   * which is the difference between a conversation and a prompt that contains
   * a transcript. A model handed the second answers *about* the transcript as
   * often as it continues it, and the provider's own caching keys on the
   * message prefix — a concatenated blob changes on every turn and caches
   * nothing.
   *
   * Absent and empty mean the same thing, and both are the first turn. Windowed
   * by the caller: this contract carries what it is given and never decides
   * what to forget, because what is safe to drop is a property of the
   * conversation, not of the gateway.
   */
  readonly history?: readonly ConversationTurn[];
  /** The model can call nothing outside this list. */
  readonly tools: readonly ToolHandle[];
  /** Hard ceiling on model turns. Nothing here ever runs unbounded. */
  readonly maxSteps: number;
  /**
   * Called with each fragment of the model's prose as it arrives. Same contract
   * as `TextRequest.onDelta`, and here for the same reason it is not a separate
   * `streamText` method: the one answer a person actually watches being written
   * — a question about their own CV — is produced by a tool loop, so streaming
   * that only covered plain generation would not cover the case it exists for.
   *
   * Tool calls and their results are not deltas. A person watching an answer
   * appear is not watching a trace, and the tool traffic is already in the
   * run's events.
   */
  readonly onDelta?: (text: string) => void;
};

export type ToolLoopResult = {
  readonly text: string;
  readonly steps: number;
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
};

/**
 * One image, and an instruction for reading it.
 *
 * The only call in this runtime that needs a model with vision, and the reason
 * it is a separate method rather than an option on `TextRequest`: a model
 * without vision does not refuse an image, it hallucinates a plausible answer
 * from nothing. A distinct method is what lets the gateway say which model it
 * used and lets a caller pick a different one.
 *
 * `instruction` is supplied by the caller because the useful instruction is
 * "transcribe, do not summarise" — asking a vision model to extract fields as
 * well means it decides what matters before the narrow schemas downstream get
 * a chance to, and whatever it silently dropped cannot be recovered.
 */
export type ImageRequest = EffectCall & {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly instruction: string;
  readonly maxOutputTokens: number;
};

export type EmbedRequest = EffectCall & MaskedCall & {
  readonly values: readonly string[];
};

export type EmbedResult = {
  readonly vectors: readonly Float32Array[];
  /**
   * Which provider and model produced these, and how wide they are.
   *
   * Reported rather than declared, because the caller does not choose: the
   * embedding provider resolves separately from the language one, and the
   * dimension is only learned from the first response. All three go into the
   * fingerprint stored beside every vector, and a fingerprint missing the
   * provider would treat two different services' spaces as one.
   */
  readonly provider: string;
  readonly model: string;
  readonly dim: number;
};

/**
 * The single process-wide gateway to a model. Every generation, every embedding
 * and every planning call goes through this one object.
 *
 * Being process-wide is the point. Concurrency limits that live inside a plan
 * only bound one run: in the previous runtime two simultaneous requests each
 * respecting their own limit still hit the same local GPU at once, and the
 * planner, the router and the vision calls bypassed the limit entirely because
 * they never went through the executor at all.
 *
 * The gateway owns what those call sites each had to remember, or forgot:
 * provider concurrency (one against a local server, which is one GPU), abort
 * propagation, metadata-only logging, and error redaction. Raw SDK errors carry
 * request prompts and response bodies, so an unredacted `console.warn(error)`
 * defeats a metadata-only log two lines away from it.
 */
export interface AiGateway {
  generateObject<T>(request: ObjectRequest<T>): Promise<ObjectResult<T>>;
  generateText(request: TextRequest): Promise<TextResult>;
  transcribeImage(request: ImageRequest): Promise<TextResult>;
  runToolLoop(request: ToolLoopRequest): Promise<ToolLoopResult>;
  embed(request: EmbedRequest): Promise<EmbedResult>;
  /** Which provider and model this resolves to, for the run record. */
  describe(): { readonly providerId: string; readonly modelId: string };
  /**
   * Which provider and model `embed` resolves to, when that is not the one
   * `describe` names.
   *
   * Embedding resolves on its own (`providers/resolve.ts`): a person can have a
   * hosted chat model and an embedder on this machine, or the other way round, and
   * whoever decides what to keep from a provider has to ask the one it is about to
   * call. Optional, and a gateway that does not say is taken to embed where it
   * generates.
   */
  describeEmbedding?(): { readonly providerId: string; readonly modelId: string };
}

/* ----------------------------------------------------------------- offers */

export type ResolvedOffer = {
  readonly integration?: IntegrationExecution;
  /** The published job description, separate from an archival whole-page capture. */
  readonly descriptionText?: string;
  readonly sourceData?: Readonly<Record<string, unknown>>;
  readonly contentTruncated?: boolean;
  readonly extractionWarnings?: readonly string[];
  readonly url: string;
  readonly finalUrl: string;
  readonly board?: string;
  readonly text: string;
  /**
   * What the board published as structured data, uninterpreted. Deciding that a
   * stated salary beats a model's reading of the same page is domain judgment,
   * and it happens in `capabilities/`, not here.
   */
  readonly stated?: StatedFacts;
  /**
   * Where the board says applications go. Separate from `stated` because it is
   * read by a different capability for a different purpose — see the note on
   * `StatedRoutes`.
   */
  readonly routes?: StatedRoutes;
};

export interface OfferReader {
  /** Board archival capture keeps source text independently of model budgets. */
  capture?(url: string, call: EffectCall): Promise<ResolvedOffer>;
  /**
   * Fetches an offer, following redirects with the SSRF guard applied at every
   * hop — not only the first, because a permitted host is free to redirect to
   * loopback or a cloud metadata address.
   *
   * Throws `RuntimeError('unreadable_source')` when there is nothing to read:
   * a board that blocked us, one that renders client-side, one robots.txt
   * forbids. That is a distinct outcome from a failure, because nothing failed,
   * and the only way forward is for a person to paste the text.
   */
  resolve(url: string, call: EffectCall): Promise<ResolvedOffer>;
}

/* ------------------------------------------------------------------ sites */

/**
 * Reading pages that are not offers: an employer's own site, a careers page a
 * search engine pointed at, a board's listing rows.
 *
 * A separate port from `OfferReader` and the same object underneath, which is
 * deliberate on both counts. Separate, because "fetch the posting the user
 * pasted" and "open three pages a search engine ranked" are different
 * authorities and a capability should have to ask for the second one by name.
 * The same object, because they share the per-host politeness map, and two
 * limiters spacing requests to the same host at one second each is two requests
 * a second — the module-state defect this runtime already fixed once, rebuilt
 * out of tidy-looking parts.
 */
export type PageOutcome =
  | { readonly status: 'ok'; readonly text: string; readonly finalUrl: string }
  /** Reached and not worth reading: a challenge, an error, an empty shell. */
  | { readonly status: 'unreadable'; readonly detail: string }
  /** Refused before or during the request. Says something about the URL. */
  | { readonly status: 'refused'; readonly detail: string };

export type CompanyPage = {
  readonly url: string;
  readonly kind: 'home' | 'careers' | 'contact';
  readonly text: string;
};

export type CompanySite = {
  readonly origin: string;
  /** Set when the requested origin redirected. Both belong to the employer. */
  readonly redirectedFrom?: string;
  /** The origin was worked out from the name, not stated by the caller. */
  readonly discovered?: boolean;
  /** For a discovered origin: something beyond the name matched. */
  readonly corroborated?: boolean;
  readonly pages: readonly CompanyPage[];
};

/** One row of a board listing — enough to tell whether it is the same offer. */
export type Listing = {
  readonly board: string;
  readonly url: string;
  readonly title: string;
  readonly company?: string;
};

/**
 * Outcomes rather than exceptions, throughout this port.
 *
 * `OfferReader.resolve` throws because its caller has nothing to do without an
 * offer. Everything here feeds a non-critical step whose job is to add reach
 * when it can and get out of the way when it cannot, and for that caller a
 * thrown error and an empty result are the same fact wearing different
 * clothes — except that one of them ends the step.
 *
 * `unavailable` and `failed` are kept apart for the one reason worth the extra
 * branch: `unavailable` means this deployment is not set up to answer (the
 * companion scraper is not running), which is worth telling a person to fix,
 * and `failed` means it answered and could not help, which is a fact about the
 * employer rather than about the installation.
 */
export type SiteOutcome<T> =
  | { readonly status: 'ok'; readonly data: T }
  | { readonly status: 'unavailable'; readonly detail: string }
  | { readonly status: 'failed'; readonly detail: string };

export type CompanyRequest = {
  /** The site, when it is known. Read as given, never verified against a name. */
  readonly url?: string;
  /** The employer's name. Supplying it is what makes the read a *check*. */
  readonly name?: string;
  /** Extra facts a candidate site should corroborate, such as a city. */
  readonly hints?: readonly string[];
};

export type IntegrationHostKind='board'|'ats'|'social'|'directory';
export type IntegrationSourceInfo = {routing?:readonly {host:string;kind:IntegrationHostKind}[];domain:string;name:string;hosts?:readonly string[];scraperId?:string;fetchable:'ok'|'refused';markets:readonly string[];search:boolean};
export interface SiteReader {
  integrationSources?(call: EffectCall): Promise<readonly IntegrationSourceInfo[]>;
  /**
   * One page, with the same SSRF guard and the same politeness as an offer.
   *
   * Never throws, and never distinguishes more than a caller can act on: a page
   * that could not be read is simply not evidence.
   */
  readPage(url: string, call: EffectCall): Promise<PageOutcome>;

  /**
   * The employer's own site: the homepage, and the careers and contact pages it
   * links to. Needs the companion scraper — this is several fetches, a link
   * graph and, when only a name is known, a round of probes first, and none of
   * that is a thing to reimplement behind a fetch.
   *
   * The scraper fetches and reads; it does not extract. Deciding what an
   * address on one of these pages means happens in `capabilities/`.
   */
  readCompany(request: CompanyRequest, call: EffectCall): Promise<SiteOutcome<CompanySite>>;

  /** One board's listing rows for a keyword. Rows only; nothing is fetched. */
  listBoard(
    request: { readonly board: string; readonly keyword: string; readonly limit: number },
    call: EffectCall
  ): Promise<SiteOutcome<readonly Listing[]>>;
}

/* ----------------------------------------------------------- web search */

export type SearchEngine = 'brave' | 'duckduckgo';

export type SearchHit = {
  readonly title: string;
  readonly url: string;
  /** The engine's own summary. Used to order fetches, never as evidence. */
  readonly snippet: string;
};

export type SearchOutcome =
  /** The engine answered. An empty `hits` is a real answer: nothing matched. */
  | { readonly status: 'ok'; readonly engine: SearchEngine; readonly hits: readonly SearchHit[] }
  /**
   * Nothing is configured to search with. Says nothing about the subject, and a
   * caller should report it as a tier that did not run rather than as one that
   * found nothing.
   */
  | { readonly status: 'unavailable'; readonly detail: string }
  /** The engine was reached and refused, or answered unreadably. */
  | { readonly status: 'failed'; readonly engine: SearchEngine; readonly detail: string };

/**
 * Asking a search engine where something is.
 *
 * The contract that matters is not in the types: **results are pointers, never
 * answers.** A title and a snippet are written by whoever wrote the page and
 * ordered by an engine with its own incentives, so nothing a caller does with
 * them may amount to believing them. They may move a URL up a fetch queue; the
 * page still has to be opened before anything it says counts.
 */
export interface WebSearch {
  /** Which engine a query would use, or `undefined` when searching is off. */
  engine(): SearchEngine | undefined;
  search(query: string, call: EffectCall & { readonly limit?: number }): Promise<SearchOutcome>;
}

/* ---------------------------------------------------------------- sources */

export type SourceInput =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly mime: string };

export type SourceText = {
  readonly text: string;
  readonly pages?: number;
  /** `'ocr'` means a model read an image; the text is a reading, not a copy. */
  readonly via: 'plain' | 'pdf' | 'ocr';
};

export interface SourceReader {
  read(input: SourceInput, call: EffectCall): Promise<SourceText>;
  /**
   * The same reader, reading an image through `ai`. A run hands it its own
   * gateway (`runtime/run.ts`), so a screenshot read for a run is held to what
   * every other model call of the run is held to: counted, and sent only where
   * the person agreed it may go. A reader that calls no model answers itself.
   */
  through(ai: AiGateway): SourceReader;
}

/* ------------------------------------------------------------------- mail */

export type Mail = {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
};

/**
 * Declared here, absent from `EffectSet`, and unreachable from any step. See
 * the note at the top of this file.
 *
 * Two methods rather than one, and the difference between them is the whole
 * safety margin: a draft that is wrong is a draft the user deletes, and a sent
 * message that is wrong is in someone else's inbox. `draft` is the default
 * path. `send` needs a person's confirmation immediately upstream of it —
 * not a model's choice of recipient, and not a setting somebody turned on once
 * and forgot.
 */
export interface MailSender {
  /** Creates a draft in the user's mailbox. Nothing is delivered. */
  draft(mail: Mail, call: EffectCall): Promise<{ readonly id: string }>;
  send(mail: Mail, call: EffectCall): Promise<{ readonly id: string }>;
}

/* --------------------------------------------------------------- attempts */

export type AttemptOutcome = 'ok' | 'failed';

export type Attempt = {
  readonly id: string;
  readonly runId?: string;
  readonly step?: string;
  readonly effect: string;
  readonly idempotencyKey: string;
  /** A summary of the request. Never a credential, never a full payload. */
  readonly request: Readonly<Record<string, unknown>>;
  readonly outcome?: AttemptOutcome;
  readonly response?: Readonly<Record<string, unknown>>;
  readonly startedAt: number;
  readonly settledAt?: number;
};

/**
 * The record that makes a crash mid-effect answerable.
 *
 * `begin` writes the attempt and **commits** before the call it describes is
 * made. That ordering is the entire mechanism: a row with no `settled_at` after
 * a crash means the call may have happened and we do not know, which is a
 * question for a person. It is never grounds for a retry — an unsettled row is
 * exactly the case where retrying might send a second email or create a second
 * record.
 */
/**
 * What `begin` hands back, and the one field that is not on `Attempt`.
 *
 * `existing` is `true` when a row with this idempotency key was already on
 * disk, which the caller cannot work out from the returned values: an
 * interrupted attempt and a freshly inserted one both come back unsettled, and
 * telling them apart by comparing `startedAt` fails whenever two attempts land
 * in the same millisecond. The distinction decides whether the call goes ahead,
 * so it is stated rather than inferred.
 */
export type BegunAttempt = Attempt & { readonly existing: boolean };

export interface AttemptLog {
  begin(attempt: Omit<Attempt, 'outcome' | 'response' | 'settledAt'>): BegunAttempt;
  settle(
    id: string,
    outcome: AttemptOutcome,
    response?: Readonly<Record<string, unknown>>
  ): void;
  /** Attempts still open for a run. A non-empty result blocks a clean resume. */
  unsettled(runId: string): Attempt[];
}

/* ----------------------------------------------------------------- logging */

/**
 * One line per model call, and never a payload.
 *
 * Sizes and counts, not text. This is what lets the log ship with the app
 * without becoming a copy of the user's CV on disk.
 */
export type AiLogEntry = {
  readonly at: number;
  readonly traceId: string;
  readonly runId?: string;
  readonly step?: string;
  readonly operation: 'object' | 'text' | 'image' | 'tool_loop' | 'embed';
  readonly providerId: string;
  readonly modelId: string;
  readonly promptChars: number;
  /** Set for a call that carried bytes rather than text. A size, not a copy. */
  readonly inputBytes?: number;
  readonly completionChars: number;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly finishReason?: FinishReason;
  readonly outcome: 'ok' | 'failed';
  /** A code and a redacted message. Never the provider's raw error. */
  readonly errorCode?: string;
  /**
   * How many placeholders of each kind the call sent, when it was masked: `{}`
   * for one that held nothing to keep. Absent when it was sent as it was.
   * Counts, never what they stood for.
   */
  readonly masked?: MaskCounts;
};

export interface AiLogger {
  record(entry: AiLogEntry): void;
}

/* ------------------------------------------------------------------- set */

/**
 * What a step is handed. `mail` is not a member and must never become one.
 */
export type EffectSet = {
  readonly ai: AiGateway;
  readonly offers: OfferReader;
  /**
   * Two names, one object underneath. The pairing is the same one `retrieval`
   * and `index` make on `RunContext`: a wide implementation exposed as narrow
   * ports, so a step asks for the authority it needs rather than receiving
   * everything the implementation happens to be able to do.
   */
  readonly sites: SiteReader;
  readonly search: WebSearch;
  readonly sources: SourceReader;
  readonly attempts: AttemptLog;
};
