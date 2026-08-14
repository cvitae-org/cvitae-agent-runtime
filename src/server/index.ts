/**
 * The optional HTTP entry point.
 *
 * The library is the primary interface — cvitae can import `createRuntime` and
 * call it in-process. This exists for the cases that need a process of their
 * own: indexing that outlives a request, a runtime shared by more than one
 * caller, or simply keeping the provider credentials out of the Next.js server
 * entirely.
 *
 * It binds to loopback and has no authentication, and those two facts are the
 * same decision. The service reads and writes the user's CV and holds the API
 * keys; it is not built to be reachable by anything other than this machine, so
 * `HOST` should not be changed without putting something in front of it.
 */

// First, and before anything below reads `process.env`. ESM evaluates imports
// ahead of the importing module's body, so the constants underneath see it.
import '../env.js';

import Fastify from 'fastify';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { createRuntime } from '../index.js';
import { RuntimeError } from '../core/types.js';
import { AiConfigError, resolveModel } from '../providers/resolve.js';
import { runtimeHome } from '../store/paths.js';

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '127.0.0.1';

/**
 * Reads the run budget from the environment, refusing values that would disable it.
 *
 * `Number('')` is 0 and `Number('5min')` is NaN, and `setTimeout` treats both as
 * "fire now" — so a blank or mistyped `RUN_TIMEOUT_MS` would abort every run
 * before it started, answering 504 with a message advising the reader to raise
 * the very variable they had just set. A bad value falls back to the default and
 * says so, because the alternative is a service that looks broken in a way that
 * points away from the cause.
 */
const timeoutFromEnv = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `RUN_TIMEOUT_MS is "${raw}", which is not a positive number of milliseconds. Using ${fallback}.`
    );
    return fallback;
  }

  return parsed;
};

/**
 * How long a run may take before it is abandoned.
 *
 * Five minutes is deliberately generous, because the ceiling exists to catch a
 * hang rather than to enforce a latency budget: one offer was measured at 143s
 * on gemma4:12b against a local GPU that runs the five steps one at a time, and
 * a default that killed a working configuration would be worse than no default.
 * Callers with a tighter budget — cvitae's route sits under Vercel's 60s — send
 * their own `timeoutMs` and get the shorter one.
 */
const DEFAULT_TIMEOUT_MS = timeoutFromEnv(process.env.RUN_TIMEOUT_MS, 300_000);
const MAX_TIMEOUT_MS = 600_000;

const server = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
const runtime = createRuntime();

/**
 * What this process is and what it is configured to talk to.
 *
 * The provider is reported because the alternative is archaeology. cvitae and
 * the runtime keep separate `.env` files and they disagree by default — one
 * said `local` while the other said `openrouter` — which means "where does my
 * offer actually go" had no answer short of reading two files and knowing which
 * one wins. It is also the question a user who chose `local` most needs to be
 * able to check.
 *
 * Resolving builds a client; it sends nothing. A missing credential is reported
 * rather than thrown, because a health check that fails when generation is
 * misconfigured cannot be used to discover that generation is misconfigured.
 */
const describeModel = async () => {
  try {
    const { providerId, modelId } = await resolveModel({});
    return { providerId, modelId };
  } catch (error) {
    return { error: (error as Error).message };
  }
};

server.get('/health', async () => ({
  status: 'ok',
  home: runtimeHome(),
  generation: await describeModel(),
  capabilities: runtime.listCapabilities(),
  tools: runtime.listTools()
}));

/**
 * Reports what is indexed. Cheap, and the first thing worth checking when
 * retrieval returns nothing — the usual answer is that nothing was imported.
 */
server.get('/state', async () => {
  const store = await runtime.store();
  const document = await store.documents.read();

  return {
    document: {
      updated_at: document.updated_at,
      name: document.personal.name,
      experience_entries: document.experience.length,
      sources: document.sources.length
    },
    chunks: await store.chunks.count(),
    offers: await store.offers.count()
  };
});

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
const runRequestSchema = z.object({
  input: z.unknown(),
  /**
   * Which provider and model to use for this call. Never a credential: those
   * stay in this process's environment, which is most of the point of moving
   * them out of cvitae. `resolveModel` checks the provider name against the
   * enum and puts `baseURL` through the loopback guard, so this only has to
   * establish that they are strings.
   */
  model: z
    .object({
      providerId: z.string().optional(),
      modelId: z.string().optional(),
      baseURL: z.string().optional()
    })
    .optional(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
});

/** Why a run was cancelled, which decides what the caller is owed. */
type Cancelled = 'timeout' | 'disconnect';

/**
 * The run's abort signal, and a record of what fired it.
 *
 * The two cancellations are worth telling apart. A timeout means the work is
 * still wanted and took too long, so someone is listening for the answer. A
 * disconnect means nobody is — and the reason to abort rather than let the run
 * finish is that five parallel calls against a 50-request daily quota should
 * not keep spending it on a page that has closed.
 *
 * `close` on the response is the signal that distinguishes them from the
 * server's side. The obvious alternative, listening on the *request* stream,
 * does not work: Node emits `close` there as soon as the body has been read,
 * which for a small JSON POST is long before the run finishes, and would cancel
 * every call immediately.
 */
const cancellation = (reply: FastifyReply, timeoutMs: number) => {
  const controller = new AbortController();
  let cancelled: Cancelled | null = null;

  const timer = setTimeout(() => {
    cancelled = 'timeout';
    controller.abort();
  }, timeoutMs);

  const onClose = () => {
    // `close` also fires on an ordinary completed response; the write state is
    // what separates "the caller left" from "we answered".
    if (reply.raw.writableEnded) return;
    cancelled = 'disconnect';
    controller.abort();
  };

  reply.raw.on('close', onClose);

  return {
    signal: controller.signal,
    reason: (): Cancelled | null => cancelled,
    /** Always call this: a live timer would hold the process open for minutes. */
    settle: () => {
      clearTimeout(timer);
      reply.raw.off('close', onClose);
    }
  };
};

server.post<{ Params: { name: string }; Body: unknown }>(
  '/run/:name',
  async (request, reply) => {
    const body = request.body ?? {};

    // Checked by hand rather than by the schema, because zod treats an absent
    // `unknown` as a present undefined — a flat body would parse here and fail
    // one layer down against the capability's own schema, reporting a missing
    // `offerText` when the real mistake was sending the fields unwrapped. That
    // error names the wrong thing, and this is the one shape mistake a new
    // caller actually makes.
    if (typeof body !== 'object' || body === null || !('input' in body)) {
      return reply.status(400).send({
        error:
          'The body must be an envelope: {"input": { … }}, optionally with "model" and "timeoutMs". The capability\'s own fields go inside "input".',
        reason: 'invalid_input'
      });
    }

    const parsed = runRequestSchema.safeParse(body);

    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');

      return reply
        .status(400)
        .send({ error: `Invalid request body. ${detail}`, reason: 'invalid_input' });
    }

    const { input, model, timeoutMs } = parsed.data;
    const run = cancellation(reply, timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      return await runtime.run(request.params.name, input, {
        model,
        signal: run.signal
      });
    } catch (error) {
      return replyForError(reply, error, run.reason());
    } finally {
      run.settle();
    }
  }
);

const batchRequestSchema = z.object({
  inputs: z.array(z.unknown()).min(1, 'At least one input is required.'),
  model: z
    .object({
      providerId: z.string().optional(),
      modelId: z.string().optional(),
      baseURL: z.string().optional()
    })
    .optional(),
  /** Per input, not for the batch. See the route comment. */
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
  concurrency: z.number().int().positive().max(16).optional()
});

/**
 * Runs a capability over many inputs, streaming each result as it lands.
 *
 * Server-sent events rather than one JSON response, and the reason is
 * durability rather than progress reporting. Twenty offers against a local
 * model is several minutes; a single response means a dropped connection loses
 * all of it, while a stream means the caller has already written the first
 * eleven to storage and only the rest need running again. That is also why
 * there is no job store: there is no state here worth resuming, because the
 * work that survived is on the caller's disk and the work that did not is
 * simply still to do.
 *
 * `timeoutMs` bounds each input rather than the batch. A batch has no honest
 * total — it depends on how many inputs there are and how slow the model is
 * that day — and one offer that hangs should cost that offer, not the nineteen
 * queued behind it.
 *
 * The status code is sent before the first result, so it is always 200 even if
 * every input then fails. Errors live in the stream, which is what streaming
 * means; the summary at the end is what says how it went.
 */
server.post<{ Params: { name: string }; Body: unknown }>(
  '/run-batch/:name',
  async (request, reply) => {
    const body = request.body ?? {};

    if (typeof body !== 'object' || body === null || !('inputs' in body)) {
      return reply.status(400).send({
        error:
          'The body must be {"inputs": [ … ]}, optionally with "model", "timeoutMs" and "concurrency". Each entry of "inputs" is one capability input.',
        reason: 'invalid_input'
      });
    }

    const parsed = batchRequestSchema.safeParse(body);

    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');

      return reply
        .status(400)
        .send({ error: `Invalid request body. ${detail}`, reason: 'invalid_input' });
    }

    const { inputs, model, timeoutMs, concurrency } = parsed.data;

    // No overall deadline: the batch runs until it is done or the caller leaves.
    // A total would have to be guessed from the input count and would cut off a
    // run that was still making progress, which is the one failure a long
    // unattended job must not have.
    const controller = new AbortController();
    const onClose = () => {
      if (reply.raw.writableEnded) return;
      controller.abort();
    };
    reply.raw.on('close', onClose);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nothing between here and the caller should buffer this; a proxy that
      // holds the stream until it completes turns it back into one response and
      // takes the interruption safety with it.
      'X-Accel-Buffering': 'no'
    });

    const send = (event: string, payload: unknown): void => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const summary = await runtime.runBatch(
        request.params.name,
        inputs,
        { model, concurrency, timeoutMs, signal: controller.signal },
        (item) => send('result', item)
      );

      if (summary.aborted) {
        // The caller left. Worth a line because the alternative reading — that
        // the batch finished — is wrong in a way nothing else records: the
        // inputs that never ran left no trace, here or on the caller's disk.
        server.log.info(
          `Batch cancelled after ${summary.completed} of ${inputs.length}; the rest did not run.`
        );
      }

      send('done', summary);
    } catch (error) {
      // Only reached for a failure that is not one input's: an unknown
      // capability, or a provider that cannot be resolved at all. Per-input
      // failures never land here — they are already in the stream.
      const detail =
        error instanceof RuntimeError || error instanceof AiConfigError
          ? error.message
          : 'The runtime failed to start the batch.';

      server.log.error(error);
      send('error', {
        error: detail,
        reason: error instanceof RuntimeError ? error.code : 'error'
      });
    } finally {
      reply.raw.off('close', onClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  }
);

server.post<{ Body: { document?: unknown } }>(
  '/document',
  async (request, reply) => {
    try {
      const store = await runtime.store();
      const saved = await store.documents.write(
        // Validated by the document schema on the way in; an invalid shape
        // throws and is reported rather than partially written.
        (request.body?.document ?? {}) as Parameters<typeof store.documents.write>[0]
      );
      const indexed = await store.reindex(saved);

      return { updated_at: saved.updated_at, indexed };
    } catch (error) {
      return replyForError(reply, error);
    }
  }
);

server.post('/reindex', async (_request, reply) => {
  try {
    const store = await runtime.store();
    return await store.reindex();
  } catch (error) {
    return replyForError(reply, error);
  }
});

/**
 * Maps a failure to a status the caller can act on.
 *
 * The distinction that matters is between "you asked wrongly" (400) and "this
 * machine is not set up" (500) — cvitae turns the first into a field error and
 * the second into a settings prompt, and collapsing both into 500 makes a
 * missing API key look like a bug in the request.
 */
const replyForError = (
  reply: FastifyReply,
  error: unknown,
  cancelled: Cancelled | null = null
) => {
  // Checked before the error itself, because a cancelled run throws from
  // wherever it happened to be — usually a step reporting that its model call
  // was aborted. That message describes the symptom; the cancellation is the
  // cause, and it is the only one of the two the caller can act on.
  if (cancelled === 'disconnect') {
    // Nobody is listening, so there is nothing to say and no body to send. At
    // info rather than warn: a closed tab is an ordinary event.
    server.log.info('The caller disconnected; the run was aborted.');
    return reply.status(499).send();
  }

  if (cancelled === 'timeout') {
    server.log.warn('The run exceeded its time budget and was aborted.');
    return reply.status(504).send({
      error:
        'The run took longer than its time budget and was stopped. A local model on one GPU runs each step in turn, so a large model can exceed it on a long offer — raise RUN_TIMEOUT_MS, send a larger timeoutMs, or use a smaller model.',
      reason: 'timeout'
    });
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

    server.log.warn({ code: error.code }, error.message);
    return reply.status(status).send({ error: error.message, reason: error.code });
  }

  if (error instanceof AiConfigError) {
    server.log.error(error.message);
    return reply
      .status(500)
      .send({ error: error.message, reason: 'ai_not_configured' });
  }

  server.log.error(error);
  return reply
    .status(500)
    .send({ error: 'The runtime failed to complete the request.' });
};

const start = async () => {
  try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info(`cvitae-agent-runtime state lives in ${runtimeHome()}`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

void start();
