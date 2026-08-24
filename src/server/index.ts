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
 *
 * The exception, and the only one, is `RUNTIME_MODE=hosted` — a deployment that
 * holds no credential and serves no storage. What it permits lives in
 * `policy.ts`; what both it and this process agree on lives in `handlers.ts`.
 * This file is now the Fastify half of that split and nothing more.
 */

// First, and before anything below reads `process.env`. ESM evaluates imports
// ahead of the importing module's body, so the constants underneath see it.
import '../env.js';

import Fastify from 'fastify';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { createRuntime } from '../index.js';
import { resolveModel } from '../providers/resolve.js';
import { runtimeHome } from '../store/paths.js';
import { createDraft, mailHealth } from '../mail/index.js';
import {
  errorResponse,
  parseBatchRequest,
  parseRunRequest,
  type Cancelled,
  type HttpResponse
} from './handlers.js';
import {
  credentialWarning,
  isHosted,
  runtimeMode,
  servedCapabilities,
  servedTools
} from './policy.js';

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

/**
 * Room for an uploaded CV, which Fastify's 1MB default does not leave.
 *
 * `extract_cv` accepts `kind: 'upload'` sources carrying base64 bytes, and
 * base64 adds a third — so a 1.1MB PDF arrives as roughly 1.5MB of JSON and
 * would be refused with a bare 413 that says nothing about which of several
 * attachments was too large. `sources/index.ts` enforces the meaningful per-file
 * limit; this only has to be above it. 32MB leaves room for a few files in one
 * import without letting the process be asked to buffer something absurd.
 */
const BODY_LIMIT_BYTES = 32 * 1024 * 1024;

const server = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: BODY_LIMIT_BYTES
});
const runtime = createRuntime();

/** Writes an `HttpResponse` from `handlers.ts`, logging whatever it asked for. */
const send = (reply: FastifyReply, response: HttpResponse) => {
  if (response.log) server.log[response.log.level](response.log.message);
  return response.body === undefined
    ? reply.status(response.status).send()
    : reply.status(response.status).send(response.body);
};

/**
 * The refusal the storage routes give a hosted deployment.
 *
 * They are unreachable there anyway — no Netlify function is mapped to them —
 * but a mode that only changes behaviour on one transport is a mode that
 * behaves differently depending on how it was started, which is exactly the
 * kind of thing nobody discovers until it matters.
 */
const storageUnavailable = (what: string): HttpResponse => ({
  status: 501,
  body: {
    error: `${what} is not available on a hosted runtime: it has no local store and no access to your machine. Run cvitae-agent-runtime on your own machine for it.`,
    reason: 'storage_unavailable'
  }
});

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
 *
 * In hosted mode there is nothing to report and reporting it would be a lie:
 * the process holds no key and every run brings its own, so the provider is
 * whatever the caller last said it was.
 */
const describeModel = async () => {
  if (isHosted()) {
    return { byok: true, detail: 'Every run supplies its own provider and key.' };
  }

  try {
    const { providerId, modelId } = await resolveModel({});
    return { providerId, modelId };
  } catch (error) {
    return { error: (error as Error).message };
  }
};

server.get('/health', async () => ({
  status: 'ok',
  mode: runtimeMode(),
  home: isHosted() ? null : runtimeHome(),
  generation: await describeModel(),
  capabilities: servedCapabilities(runtime.listCapabilities()),
  tools: servedTools(runtime.listTools())
}));

/**
 * Reports what is indexed. Cheap, and the first thing worth checking when
 * retrieval returns nothing — the usual answer is that nothing was imported.
 */
server.get('/state', async (_request, reply) => {
  if (isHosted()) return send(reply, storageUnavailable('The index'));

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
    const parsed = parseRunRequest({
      capability: request.params.name,
      body: request.body,
      authorization: request.headers.authorization,
      contentLength: request.headers['content-length']
    });

    if (!parsed.ok) return send(reply, parsed.response);

    const { input, model, timeoutMs } = parsed.request;
    const run = cancellation(reply, timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      return await runtime.run(request.params.name, input, {
        model,
        signal: run.signal
      });
    } catch (error) {
      return send(reply, errorResponse(error, run.reason()));
    } finally {
      run.settle();
    }
  }
);

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
 * That property is what makes the endpoint usable on a serverless host at all.
 * A platform that kills the function at 60 seconds takes the unfinished inputs
 * with it and leaves every finished one where the caller already put it.
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
    const parsed = parseBatchRequest({
      capability: request.params.name,
      body: request.body,
      authorization: request.headers.authorization,
      contentLength: request.headers['content-length']
    });

    if (!parsed.ok) return send(reply, parsed.response);

    const { inputs, model, timeoutMs, concurrency } = parsed.request;

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

    const emit = (event: string, payload: unknown): void => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const summary = await runtime.runBatch(
        request.params.name,
        inputs,
        { model, concurrency, timeoutMs, signal: controller.signal },
        (item) => emit('result', item)
      );

      if (summary.aborted) {
        // The caller left. Worth a line because the alternative reading — that
        // the batch finished — is wrong in a way nothing else records: the
        // inputs that never ran left no trace, here or on the caller's disk.
        server.log.info(
          `Batch cancelled after ${summary.completed} of ${inputs.length}; the rest did not run.`
        );
      }

      emit('done', summary);
    } catch (error) {
      // Only reached for a failure that is not one input's: an unknown
      // capability, or a provider that cannot be resolved at all. Per-input
      // failures never land here — they are already in the stream.
      const response = errorResponse(error);
      if (response.log) server.log[response.log.level](response.log.message);

      emit('error', response.body ?? { error: 'The batch could not be started.' });
    } finally {
      reply.raw.off('close', onClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  }
);

server.post<{ Body: { document?: unknown } }>(
  '/document',
  async (request, reply) => {
    if (isHosted()) return send(reply, storageUnavailable('Storing the CV'));

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
      return send(reply, errorResponse(error));
    }
  }
);

/**
 * The mailbox, proxied for the browser.
 *
 * cvitae runs in a browser and cvitae-mail binds to loopback, so the app cannot
 * reach it directly and should not have to know its port. These two routes are
 * the whole surface, and the shape of that surface is the policy:
 *
 *   GET  /mail/status   is a mailbox connected, and to which address
 *   POST /mail/draft    put a message in the user's Drafts folder
 *
 * **There is no send route, and that is deliberate.** `mail/client.ts` exposes
 * `sendMail` because cvitae-mail has the endpoint, but nothing here routes it.
 * A draft that is wrong is a draft the user deletes; a sent message that is
 * wrong is in a recruiter's inbox, and the body was written by a model reading
 * text a stranger posted to a job board. The click in Gmail is the review step,
 * and it costs one click.
 *
 * Adding a send route later is a deliberate act requiring `MAIL_ALLOW_SEND=true`
 * on the service as well. Both switches exist so that neither can be flipped by
 * accident.
 *
 * Neither route exists in hosted mode. cvitae-mail holds a Gmail token, binds
 * to loopback, and belongs to one person; proxying it from a public host would
 * be handing that mailbox to whoever finds the URL.
 */
const mailAttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255).default('application/pdf'),
  /** Base64, with or without the `data:` prefix a browser's FileReader adds. */
  content_base64: z.string().min(1)
});

const mailDraftSchema = z.object({
  to: z.array(z.string().min(3)).min(1).max(10),
  cc: z.array(z.string().min(3)).max(10).optional(),
  subject: z.string().max(500).default(''),
  text: z.string().min(1).max(200_000),
  from_name: z.string().max(200).optional(),
  reply_to: z.string().min(3).optional(),
  attachments: z.array(mailAttachmentSchema).max(5).optional()
});

server.get('/mail/status', async (_request, reply) => {
  if (isHosted()) return send(reply, storageUnavailable('The mailbox'));

  const outcome = await mailHealth();

  if (outcome.status === 'unavailable') {
    // Not an error. cvitae-mail is optional, and an app that shows a
    // "connect your mailbox" prompt needs to tell "not running" apart from
    // "running but nobody has connected".
    return reply.send({
      status: 'unavailable',
      running: false,
      connected: false,
      detail: outcome.detail
    });
  }

  if (outcome.status === 'failed') {
    return reply.send({
      status: outcome.reason,
      running: true,
      connected: false,
      detail: outcome.detail
    });
  }

  return reply.send({
    status: 'ok',
    running: true,
    connected: Boolean(outcome.data.connected),
    email: outcome.data.email ?? null,
    /** Where a person goes to grant consent. Opened by the browser, not by us. */
    connect_url: `${process.env.MAIL_URL?.trim() || 'http://127.0.0.1:8789'}/connect`
  });
});

server.post<{ Body: unknown }>('/mail/draft', async (request, reply) => {
  if (isHosted()) return send(reply, storageUnavailable('The mailbox'));

  const parsed = mailDraftSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send({
      error: `Invalid draft. ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
      reason: 'invalid_input'
    });
  }

  const outcome = await createDraft(parsed.data);

  if (outcome.status === 'ok') {
    server.log.info(`Drafted an application to ${parsed.data.to.join(', ')}.`);
    return reply.send({ status: 'ok', data: outcome.data });
  }

  if (outcome.status === 'unavailable') {
    return reply.status(503).send({
      error: outcome.detail,
      reason: 'mail_unavailable'
    });
  }

  // cvitae-mail reached a decision — nothing connected, a recipient outside the
  // allow-list, a message over the ceiling. Its own wording already ends with
  // what the user can do, so it is passed through rather than restated.
  return reply.status(502).send({ error: outcome.detail, reason: outcome.reason });
});

server.post('/reindex', async (_request, reply) => {
  if (isHosted()) return send(reply, storageUnavailable('Reindexing'));

  try {
    const store = await runtime.store();
    return await store.reindex();
  } catch (error) {
    return send(reply, errorResponse(error));
  }
});

const start = async () => {
  try {
    await server.listen({ port: PORT, host: HOST });

    const warning = credentialWarning();
    if (warning) server.log.warn(warning);

    if (isHosted()) {
      server.log.info(
        'RUNTIME_MODE is "hosted": no storage, no credential of its own, and every run must bring its own key.'
      );
    } else {
      server.log.info(`cvitae-agent-runtime state lives in ${runtimeHome()}`);
    }
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

void start();
