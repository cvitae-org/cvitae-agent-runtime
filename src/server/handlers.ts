/**
 * The HTTP boundary, with no transport in it.
 *
 * Two things run this service now: the Fastify process in `index.ts`, and the
 * Netlify functions in `netlify/functions`. Everything they have in common is
 * here — the envelope schemas, the policy checks, and the map from a thrown
 * error to a status a caller can act on — so that the two adapters differ only
 * in how they read a request and write a response.
 *
 * The reason to split it out rather than to run Fastify on the serverless host
 * is that the interesting part was never the framework. It is the decision
 * about which failures are the caller's fault, which are the deployment's, and
 * which are nobody's, and that decision should not exist twice.
 *
 * Nothing here awaits a run or knows what a capability is. It validates, and it
 * classifies.
 */

import { z } from 'zod';
import { RuntimeError } from '../core/types.js';
import { AiConfigError } from '../providers/resolve.js';
import {
  refuseBatchSize,
  refuseCapability,
  refuseEnvelopeSize,
  refuseModel,
  refuseSources,
  refuseToken,
  type Refusal
} from './policy.js';

/** A status and a body, for whichever transport is about to send them. */
export type HttpResponse = {
  status: number;
  body?: unknown;
  /** What the adapter should write to the log, if anything. */
  log?: { level: 'info' | 'warn' | 'error'; message: string };
};

/**
 * The ceiling on a caller-supplied `timeoutMs`.
 *
 * Ten minutes, which no caller should reach: it exists so that a mistyped
 * budget cannot pin a run open indefinitely, not to express an expectation.
 */
export const MAX_TIMEOUT_MS = 600_000;

/**
 * Which provider and model to use for this call, and optionally the key to
 * spend on it.
 *
 * `apiKey` is a reversal: this field used to be documented as "never a
 * credential", on the reasoning that keys stay in this process's environment
 * and that is most of the point of moving them out of cvitae. That reasoning
 * holds for the server's own key and is unchanged — what it missed is the user
 * who has a key of their own and enters it in cvitae's Settings. For them the
 * rule produced a settings field that tested green in cvitae and then failed
 * every delegated run, and cvitae ended up refusing to delegate at all rather
 * than quietly answering on the server's credential.
 *
 * Sending it is safe over loopback, where the packets do not leave the machine,
 * and over TLS, because that is what TLS is. cvitae decides which of those it
 * has by looking at the URL it is about to post to, and refuses rather than
 * leaking. In hosted mode the field stops being optional — see `refuseModel`.
 *
 * `resolveModel` checks the provider name against the enum, puts `baseURL`
 * through the loopback guard and keeps the key out of its cache, so this only
 * has to establish that they are strings.
 */
const modelSchema = z
  .object({
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    baseURL: z.string().optional(),
    apiKey: z.string().optional()
  })
  .optional();

/**
 * The run envelope.
 *
 * `input` is nested rather than being the body itself. That is a change from
 * the shape this route started with, and the reason is that zod strips unknown
 * keys: a flat body carrying a stray `model` alongside the capability's own
 * fields would validate cleanly with the override silently dropped, and "my
 * model setting did nothing" is close to undebuggable from the outside. Nesting
 * makes the two unambiguous, and a body with no `input` is rejected outright
 * rather than quietly treated as an empty one.
 */
export const runRequestSchema = z.object({
  input: z.unknown(),
  model: modelSchema,
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

export const batchRequestSchema = z.object({
  inputs: z.array(z.unknown()).min(1, 'At least one input is required.'),
  model: modelSchema,
  /** Per input, not for the batch. See the route comment in `index.ts`. */
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
  concurrency: z.number().int().positive().max(16).optional()
});

export type RunRequest = z.infer<typeof runRequestSchema>;
export type BatchRequest = z.infer<typeof batchRequestSchema>;

/** What the adapter hands in: everything about the request but its body bytes. */
export type RequestFacts = {
  capability: string;
  body: unknown;
  authorization?: string;
  contentLength?: string | number;
};

export type Parsed<T> =
  | { ok: true; request: T }
  | { ok: false; response: HttpResponse };

const refused = (refusal: Refusal): HttpResponse => ({
  status: refusal.status,
  body: { error: refusal.error, reason: refusal.reason }
});

/** zod's issues, flattened into the one line an API client can print. */
const detailOf = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

/**
 * The checks that do not depend on which envelope this is.
 *
 * Ordered by how much work they save: the token and the size are decided from
 * headers alone, and the capability from the path, so none of them needs the
 * body parsed. `refuseCapability` before validation also means a request for
 * `ask_profile` against a hosted runtime is told the capability is unavailable
 * rather than that its input is malformed.
 */
const refuseRequest = (facts: RequestFacts): HttpResponse | undefined => {
  const refusal =
    refuseToken(facts.authorization) ??
    refuseEnvelopeSize(facts.contentLength) ??
    refuseCapability(facts.capability);

  return refusal ? refused(refusal) : undefined;
};

export const parseRunRequest = (facts: RequestFacts): Parsed<RunRequest> => {
  const blocked = refuseRequest(facts);
  if (blocked) return { ok: false, response: blocked };

  const body = facts.body ?? {};

  // Checked by hand rather than by the schema, because zod treats an absent
  // `unknown` as a present undefined — a flat body would parse here and fail
  // one layer down against the capability's own schema, reporting a missing
  // `offerText` when the real mistake was sending the fields unwrapped. That
  // error names the wrong thing, and this is the one shape mistake a new caller
  // actually makes.
  if (typeof body !== 'object' || body === null || !('input' in body)) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          error:
            'The body must be an envelope: {"input": { … }}, optionally with "model" and "timeoutMs". The capability\'s own fields go inside "input".',
          reason: 'invalid_input'
        }
      }
    };
  }

  const parsed = runRequestSchema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          error: `Invalid request body. ${detailOf(parsed.error)}`,
          reason: 'invalid_input'
        }
      }
    };
  }

  const refusal =
    refuseModel(parsed.data.model) ?? refuseSources(parsed.data.input);

  if (refusal) return { ok: false, response: refused(refusal) };

  return { ok: true, request: parsed.data };
};

export const parseBatchRequest = (facts: RequestFacts): Parsed<BatchRequest> => {
  const blocked = refuseRequest(facts);
  if (blocked) return { ok: false, response: blocked };

  const body = facts.body ?? {};

  if (typeof body !== 'object' || body === null || !('inputs' in body)) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          error:
            'The body must be {"inputs": [ … ]}, optionally with "model", "timeoutMs" and "concurrency". Each entry of "inputs" is one capability input.',
          reason: 'invalid_input'
        }
      }
    };
  }

  const parsed = batchRequestSchema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      response: {
        status: 400,
        body: {
          error: `Invalid request body. ${detailOf(parsed.error)}`,
          reason: 'invalid_input'
        }
      }
    };
  }

  const refusal =
    refuseModel(parsed.data.model) ?? refuseBatchSize(parsed.data.inputs.length);

  if (refusal) return { ok: false, response: refused(refusal) };

  return { ok: true, request: parsed.data };
};

/** Why a run was cancelled, which decides what the caller is owed. */
export type Cancelled = 'timeout' | 'disconnect';

/**
 * Maps a failure to a status the caller can act on.
 *
 * The distinction that matters is between "you asked wrongly" (400) and "this
 * machine is not set up" (500) — cvitae turns the first into a field error and
 * the second into a settings prompt, and collapsing both into 500 makes a
 * missing API key look like a bug in the request.
 */
export const errorResponse = (
  error: unknown,
  cancelled: Cancelled | null = null
): HttpResponse => {
  // Checked before the error itself, because a cancelled run throws from
  // wherever it happened to be — usually a step reporting that its model call
  // was aborted. That message describes the symptom; the cancellation is the
  // cause, and it is the only one of the two the caller can act on.
  if (cancelled === 'disconnect') {
    // Nobody is listening, so there is nothing to say and no body to send. At
    // info rather than warn: a closed tab is an ordinary event.
    return {
      status: 499,
      log: { level: 'info', message: 'The caller disconnected; the run was aborted.' }
    };
  }

  if (cancelled === 'timeout') {
    return {
      status: 504,
      body: {
        error:
          'The run took longer than its time budget and was stopped. A local model on one GPU runs each step in turn, so a large model can exceed it on a long offer — raise RUN_TIMEOUT_MS, send a larger timeoutMs, or use a smaller model.',
        reason: 'timeout'
      },
      log: { level: 'warn', message: 'The run exceeded its time budget and was aborted.' }
    };
  }

  if (error instanceof RuntimeError) {
    const status =
      error.code === 'invalid_input' || error.code === 'unknown_capability'
        ? 400
        : // Not a failure of this service: the board refused, or published
          // nothing a server can read. 422 rather than 502 because the request
          // was well formed and the remedy is the caller's — supply the text.
          error.code === 'unreadable_source'
          ? 422
          : // An `aborted` reaching here was not cancelled by this request — the
            // caller passed its own signal, or one fired between the run ending
            // and `settle`. Reported as a timeout rather than a bad gateway,
            // which is the closer of the two.
            error.code === 'aborted'
            ? 504
            : 502;

    return {
      status,
      body: { error: error.message, reason: error.code },
      log: { level: 'warn', message: `${error.code}: ${error.message}` }
    };
  }

  if (error instanceof AiConfigError) {
    return {
      status: 500,
      body: { error: error.message, reason: 'ai_not_configured' },
      log: { level: 'error', message: error.message }
    };
  }

  return {
    status: 500,
    body: { error: 'The runtime failed to complete the request.' },
    log: { level: 'error', message: String((error as Error)?.stack ?? error) }
  };
};
