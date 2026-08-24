/**
 * The serverless half of the HTTP boundary.
 *
 * Everything that decides anything lives in `handlers.ts` and `policy.ts`; this
 * file only knows how to read a `Request` and write a `Response`. It is the
 * same relationship `index.ts` has with Fastify, which is the point of having
 * split them: the two transports cannot drift apart on what a 400 means.
 *
 * It lives under `src/` rather than in `netlify/functions/` so that it is
 * compiled and typechecked with the rest of the project. The files in
 * `netlify/functions/` are three lines each — an import, a default export and a
 * path — and hold nothing worth checking.
 *
 * `createRuntime` runs at module scope on purpose. A warm invocation reuses the
 * whole thing, including the resolved provider clients, which is most of what
 * makes a second request faster than the first. Nothing about it is per-user:
 * the credential arrives with each call and is deliberately kept out of the
 * model cache.
 */

// First, and before anything below reads `process.env`. Netlify supplies the
// environment directly, so this matters only under `netlify dev`, where a local
// `.env` is how a person configures it.
import '../env.js';

import { createRuntime } from '../index.js';
import {
  errorResponse,
  parseBatchRequest,
  parseRunRequest,
  type Cancelled,
  type HttpResponse
} from './handlers.js';
import { servedCapabilities, servedTools } from './policy.js';

const runtime = createRuntime();

/**
 * The default run budget, under the platform's own ceiling.
 *
 * Netlify stops a synchronous function at 60 seconds whatever it is doing, and
 * a run killed by the platform answers nothing at all — no status, no reason,
 * just a closed socket the caller has to guess about. Finishing first with a
 * 504 that names the cause is worth the ten seconds it costs. cvitae sends its
 * own, smaller, `timeoutMs` anyway; this is for callers that do not.
 */
const DEFAULT_TIMEOUT_MS = Math.min(
  Number(process.env.RUN_TIMEOUT_MS) || 50_000,
  50_000
);

const json = (response: HttpResponse): Response => {
  if (response.log) console[response.log.level](response.log.message);

  return response.body === undefined
    ? new Response(null, { status: response.status })
    : Response.json(response.body, { status: response.status });
};

/** The capability name, which is the last segment of `/run/:name`. */
const capabilityOf = (request: Request): string =>
  decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '');

/**
 * Reads the envelope, treating unparseable JSON as an empty body.
 *
 * The handlers already reject a body with no `input` with a message explaining
 * the envelope, and that message is more useful to somebody who posted
 * malformed JSON than a bare parse error would be.
 */
const bodyOf = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const factsOf = async (request: Request) => ({
  capability: capabilityOf(request),
  body: await bodyOf(request),
  authorization: request.headers.get('authorization') ?? undefined,
  contentLength: request.headers.get('content-length') ?? undefined
});

/**
 * The run's abort signal, and a record of what fired it.
 *
 * The same two cancellations as the Fastify path, obtained differently: the
 * platform hands us `request.signal`, which aborts when the caller hangs up, so
 * there is no response stream to watch. A timeout is still ours to fire, and
 * still has to be told apart from a disconnect — one means the answer is late
 * and wanted, the other that nobody is left to read it.
 */
const cancellation = (request: Request, timeoutMs: number) => {
  const controller = new AbortController();
  let cancelled: Cancelled | null = null;

  const timer = setTimeout(() => {
    cancelled = 'timeout';
    controller.abort();
  }, timeoutMs);

  const onAbort = () => {
    cancelled = 'disconnect';
    controller.abort();
  };

  request.signal.addEventListener('abort', onAbort, { once: true });

  return {
    signal: controller.signal,
    reason: (): Cancelled | null => cancelled,
    settle: () => {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onAbort);
    }
  };
};

/** What this deployment is, and what it will run. Cheap and unauthenticated. */
export const handleHealth = async (): Promise<Response> =>
  Response.json({
    status: 'ok',
    mode: 'hosted',
    generation: {
      byok: true,
      detail: 'Every run supplies its own provider and key; this deployment holds none.'
    },
    capabilities: servedCapabilities(runtime.listCapabilities()),
    tools: servedTools(runtime.listTools())
  });

export const handleRun = async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Use POST.', reason: 'invalid_input' },
      { status: 405 }
    );
  }

  const facts = await factsOf(request);
  const parsed = parseRunRequest(facts);

  if (!parsed.ok) return json(parsed.response);

  const { input, model, timeoutMs } = parsed.request;
  const run = cancellation(request, Math.min(timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS));

  try {
    const result = await runtime.run(facts.capability, input, {
      model,
      signal: run.signal
    });

    return Response.json(result);
  } catch (error) {
    return json(errorResponse(error, run.reason()));
  } finally {
    run.settle();
  }
};

/**
 * The batch, streamed.
 *
 * The platform will stop this at 60 seconds and that is survivable rather than
 * fatal, which is the whole reason the endpoint streams: every result already
 * emitted has been written down by the caller, and the inputs that never ran
 * are simply still to do. `policy.ts` caps how many may be sent so that a
 * hosted batch usually finishes; when it does not, what arrived is kept.
 *
 * The stream is started before the first result, so the status is 200 even if
 * every input then fails. Errors live in the stream — that is what streaming
 * means — and the summary at the end says how it went.
 */
export const handleRunBatch = async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Use POST.', reason: 'invalid_input' },
      { status: 405 }
    );
  }

  const facts = await factsOf(request);
  const parsed = parseBatchRequest(facts);

  if (!parsed.ok) return json(parsed.response);

  const { inputs, model, timeoutMs, concurrency } = parsed.request;
  const capability = facts.capability;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // No overall deadline: the batch runs until it is done or the caller
      // leaves. A total would have to be guessed from the input count and would
      // cut off a run that was still making progress, which is the one failure
      // a long unattended job must not have. The platform's ceiling is not a
      // deadline we chose and is handled by the stream, not by a timer.
      const aborter = new AbortController();
      const onAbort = () => aborter.abort();
      request.signal.addEventListener('abort', onAbort, { once: true });

      let closed = false;
      const emit = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
          );
        } catch {
          // The consumer went away between the check and the write. Nothing to
          // report to: the run is already aborting through the same signal.
          closed = true;
        }
      };

      try {
        const summary = await runtime.runBatch(
          capability,
          inputs,
          { model, concurrency, timeoutMs, signal: aborter.signal },
          (item) => emit('result', item)
        );

        emit('done', summary);
      } catch (error) {
        // Only reached for a failure that is not one input's: an unknown
        // capability, or a provider that cannot be resolved at all. Per-input
        // failures never land here — they are already in the stream.
        const response = errorResponse(error);
        if (response.log) console[response.log.level](response.log.message);

        emit('error', response.body ?? { error: 'The batch could not be started.' });
      } finally {
        request.signal.removeEventListener('abort', onAbort);
        closed = true;
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      // Nothing between here and the caller should buffer this; a proxy that
      // holds the stream until it completes turns it back into one response and
      // takes the interruption safety with it.
      'X-Accel-Buffering': 'no'
    }
  });
};
