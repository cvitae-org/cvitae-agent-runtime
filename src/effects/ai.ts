/**
 * The one way to reach a model.
 *
 * Every structured call, every piece of prose, every tool loop and every
 * embedding in this process goes through this object. Being the only route is
 * the point, and it is the fix for a specific failure: in the previous runtime
 * the concurrency limit lived inside a plan, so it bounded one run and nothing
 * else. Two runs at once each respected their own limit and both hit the same
 * local GPU. Worse, the router, the planner and the vision calls never went
 * through the executor at all, so they were outside every limit by
 * construction.
 *
 * A limit that only some call sites honour is not a limit. So it moved down
 * here, where there is no call site to forget it.
 *
 * Four things the gateway owns:
 *
 * **Provider concurrency.** One in flight against a local server, because a
 * local server is one GPU and overlapping calls contend rather than overlap.
 * The previous runtime measured a 4m39s run where firing five at once starved
 * one agent into returning nothing at all — not slower, empty. Hosted providers
 * genuinely parallelise, and get a higher ceiling.
 *
 * **Abort propagation.** The signal on the request reaches the SDK, so a
 * cancelled run stops paying immediately instead of leaving a call alive on a
 * busy server with the next run queued behind it.
 *
 * **Metadata-only logging.** Sizes, counts, latency, finish reason. Never a
 * prompt and never a completion, so the log can ship with the app without
 * becoming a copy of the user's CV on disk.
 *
 * **Error redaction, which is what makes the previous point true.** A provider
 * error is not a string about a provider: `APICallError` carries the request
 * body and the response body, so one `console.warn(error)` prints the entire
 * prompt — and the previous runtime had several, two lines away from a logger
 * carefully recording nothing but counts. The message on every error leaving
 * this file is *constructed* from a small set of safe facts and never copied
 * from the provider's. The original is not attached as `cause` either, because
 * Node's error formatter walks the cause chain and printing the wrapper would
 * print what the wrapper exists to hide.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  embedMany,
  generateObject,
  generateText,
  stepCountIs,
  streamText,
  tool,
  APICallError,
  type LanguageModel,
  type ToolSet
} from 'ai';
import { RuntimeError } from '../contracts/index.js';
import type {
  AiGateway,
  AiLogEntry,
  AiLogger,
  EmbedRequest,
  EmbedResult,
  FinishReason,
  ImageRequest,
  ObjectRequest,
  ObjectResult,
  TextRequest,
  TextResult,
  TokenUsage,
  ToolHandle,
  ToolLoopRequest,
  ToolLoopResult
} from '../contracts/index.js';
import type { ModelOverride, ModelResolver } from '../providers/resolve.js';

/**
 * How many calls may be in flight against one provider.
 *
 * A local server is one GPU; anything above 1 is contention wearing the costume
 * of parallelism. The hosted ceiling is a politeness limit rather than a
 * measured one — high enough that the plan's own concurrency is what shapes a
 * run, low enough that two or three runs at once cannot open thirty sockets.
 */
export const LOCAL_CONCURRENCY = 1;
export const HOSTED_CONCURRENCY = 6;

/** A counting semaphore. Small enough to read, which is why it is not a dependency. */
const semaphore = (limit: number) => {
  let inFlight = 0;
  const waiting: (() => void)[] = [];

  const release = (): void => {
    inFlight -= 1;
    waiting.shift()?.();
  };

  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (inFlight >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    inFlight += 1;

    try {
      return await work();
    } finally {
      release();
    }
  };
};

/**
 * Which providers the current async context already holds a slot for.
 *
 * A tool loop holds its provider's slot for the whole loop, and a tool it calls
 * may reach the same provider — `search_profile` embeds its query. Counting
 * that nested call separately deadlocks against a local ceiling of one: the
 * tool waits for a slot the call that invoked it is still holding, nothing is
 * in flight, so Node's event loop empties and the process exits with the run
 * row left `running`. That was measured on a real `ask_profile` run, not
 * imagined; the test is in `gateway.test.ts`.
 *
 * So a slot is reentrant within the async context that took it. This does not
 * loosen the limit — the outer call is idle while its tool runs, so the server
 * still sees one request at a time, which is the property the ceiling exists
 * to protect.
 */
const held = new AsyncLocalStorage<ReadonlySet<string>>();

/* ---------------------------------------------------------------- redaction */

/**
 * What is safe to say about a provider failure.
 *
 * Everything here is either a number, a name, or a host — no field that could
 * carry a prompt or a completion. `error.message` is deliberately absent: on
 * `APICallError` it routinely contains the response body verbatim.
 */
const redact = (error: unknown): { code: string; message: string } => {
  // Ours, and therefore already safe. A `RuntimeError` was constructed in this
  // codebase out of facts this codebase chose, so there is no prompt in it to
  // strip — and its code is the one the caller needs. An abort in particular
  // has to survive as an abort: a run a person cancelled, recorded in
  // `ai_calls` as `model_call_failed`, is a provider being blamed for a button
  // the user pressed.
  if (error instanceof RuntimeError) return { code: error.code, message: error.message };

  if (APICallError.isInstance(error)) {
    const status = error.statusCode ? ` (HTTP ${error.statusCode})` : '';
    let host = 'the provider';
    try {
      host = new URL(error.url).host;
    } catch {
      // A malformed URL is not worth failing over; the generic word will do.
    }
    return {
      code: error.statusCode ? `http_${error.statusCode}` : 'api_call_error',
      message: `${host} refused the call${status}.`
    };
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return { code: 'aborted', message: 'The call was cancelled.' };
    }
    // The class name only. A generic Error's message is as likely to hold a
    // model's output as a provider's is.
    return { code: error.name || 'error', message: `The call failed (${error.name}).` };
  }

  return { code: 'error', message: 'The call failed.' };
};

/**
 * Hands a fragment to whoever asked for it, and never lets them break the call.
 *
 * A sink is a notification. A window that threw while rendering a token — a
 * closed channel, a disposed controller — must not turn a model call that is
 * still producing a perfectly good answer into a failed run. Worse, the throw
 * would arrive at `redact` and be reported as a provider failure, which is a
 * lie about whose fault it was.
 */
const notify = (onDelta: ((text: string) => void) | undefined, text: string): void => {
  if (!onDelta) return;
  try {
    onDelta(text);
  } catch {
    // Deliberately silent, and deliberately not logged: the logger is the
    // thing most likely to be downstream of whatever just broke.
  }
};

/**
 * What a completion is, once the two SDK calls are made to agree.
 *
 * `generateText` and `streamText` report the same run of the same model through
 * differently shaped results. Normalising here rather than at each call site is
 * what keeps the choice of path invisible above this file: a step that streams
 * and a step that does not are the same step, told the same things.
 */
type Completion = {
  readonly text: string;
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
  readonly steps: number;
};

const completed = (result: {
  text: string;
  finishReason: FinishReason;
  totalUsage: Parameters<typeof usageOf>[0];
  steps: readonly unknown[];
}): Completion => ({
  text: result.text,
  finishReason: result.finishReason,
  usage: usageOf(result.totalUsage),
  steps: result.steps.length
});

/**
 * The streaming form, for the calls a person is watching happen.
 *
 * Two properties of the SDK's stream this exists to contain, both of which turn
 * a failure into a plausible-looking success if left alone.
 *
 * Errors do not reach `textStream` — the SDK's own documentation says error
 * parts are not surfaced there — so a provider that refused mid-call would end
 * the stream and hand back an *empty completion*, which is the worst available
 * shape for a failure: nothing wrong on its face, and indistinguishable from a
 * model that had nothing to say. `onError` captures it and it is rethrown into
 * `call`'s redaction, the same path a non-streamed failure takes.
 *
 * An abort ends the stream early rather than surfacing on it, so what has been
 * collected is a *prefix* of an answer wearing the shape of a whole one. The
 * SDK does currently reject `result.text` in that case, so the explicit check
 * after the loop is belt and braces — deliberately, because "the library
 * rejects" is a property of a version, and the thing being protected is that a
 * cancelled run never produces a confident truncated answer.
 */
const streamed = async (
  begin: (onError: (event: { error: unknown }) => void) => ReturnType<typeof streamText>,
  signal: AbortSignal,
  onDelta: ((text: string) => void) | undefined
): Promise<Completion> => {
  let failure: unknown;
  const result = begin(({ error }) => {
    failure = error;
  });

  for await (const delta of result.textStream) notify(onDelta, delta);

  if (failure !== undefined) throw failure;
  signal.throwIfAborted();

  const [text, finishReason, totalUsage, steps] = await Promise.all([
    result.text,
    result.finishReason,
    result.totalUsage,
    result.steps
  ]);

  return completed({ text, finishReason, totalUsage, steps });
};

const usageOf = (usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): TokenUsage => ({
  ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
  ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
  ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens })
});

/* ------------------------------------------------------------------ gateway */

export type AiGatewayOptions = {
  readonly resolver: ModelResolver;
  readonly logger: AiLogger;
  /** Applied to every call. A caller's own key, if any, lives here. */
  readonly override?: ModelOverride;
  /** Overrides the per-provider ceiling. For tests, mostly. */
  readonly concurrency?: number;
  readonly now?: () => number;
};

export const createAiGateway = (options: AiGatewayOptions): AiGateway => {
  const { resolver, logger } = options;
  const now = options.now ?? Date.now;
  const override = options.override ?? {};

  const limits = new Map<string, ReturnType<typeof semaphore>>();

  /**
   * One semaphore per provider, shared by every operation against it. Keying
   * this by operation instead would let a run's embeddings and its generations
   * each take the single local slot, which is the same overcommitment one layer
   * down.
   */
  const limitFor = (providerId: string): ReturnType<typeof semaphore> => {
    let limit = limits.get(providerId);
    if (!limit) {
      limit = semaphore(
        options.concurrency
          ?? (providerId === 'local' ? LOCAL_CONCURRENCY : HOSTED_CONCURRENCY)
      );
      limits.set(providerId, limit);
    }
    return limit;
  };

  /**
   * Runs one call: waits for a slot, times it, logs a line either way, and
   * makes sure nothing that leaves carries a payload.
   */
  const call = async <T>(
    operation: AiLogEntry['operation'],
    request: { traceId: string; runId?: string; step?: string; signal: AbortSignal },
    choice: { providerId: string; modelId: string },
    promptChars: number,
    work: () => Promise<{ value: T; completionChars: number; usage: TokenUsage; finishReason?: FinishReason }>,
    extra: { readonly inputBytes?: number } = {}
  ): Promise<T> => {
    // Checked before queueing as well as inside the SDK: a run cancelled while
    // its calls are still waiting for a slot should never take one. Nothing is
    // logged, because nothing happened — a log line here would describe a call
    // that was never made.
    if (request.signal.aborted) {
      throw new RuntimeError('The call was cancelled before it started.', 'aborted');
    }

    const startedAt = now();

    const base = {
      traceId: request.traceId,
      ...(request.runId ? { runId: request.runId } : {}),
      ...(request.step ? { step: request.step } : {}),
      operation,
      providerId: choice.providerId,
      modelId: choice.modelId,
      promptChars,
      ...extra
    };

    try {
      const guarded = async () => {
        request.signal.throwIfAborted();
        return work();
      };

      const outer = held.getStore();

      const settled = outer?.has(choice.providerId)
        ? await guarded()
        : await limitFor(choice.providerId)(() =>
            held.run(new Set([...(outer ?? []), choice.providerId]), guarded)
          );

      logger.record({
        ...base,
        at: now(),
        completionChars: settled.completionChars,
        usage: settled.usage,
        latencyMs: now() - startedAt,
        ...(settled.finishReason ? { finishReason: settled.finishReason } : {}),
        outcome: 'ok'
      });

      return settled.value;
    } catch (error) {
      const { code, message } = redact(error);

      logger.record({
        ...base,
        at: now(),
        completionChars: 0,
        usage: {},
        latencyMs: now() - startedAt,
        outcome: 'failed',
        errorCode: code
      });

      // An abort keeps its own code, so the orchestrator can tell a cancelled
      // run from a failed one without unwrapping anything.
      if (code === 'aborted') throw new RuntimeError(message, 'aborted');

      // No `cause`. See the redaction note at the top of the file.
      if (code === 'AI_NoObjectGeneratedError') {
        throw new RuntimeError('The model did not return a valid structured response.', 'invalid_model_output');
      }
      throw new RuntimeError(`${choice.modelId}: ${message}`, 'model_call_failed');
    }
  };

  const language = async (): Promise<LanguageModel> => resolver.language(override);

  const handlesToTools = (handles: readonly ToolHandle[]): ToolSet =>
    Object.fromEntries(
      handles.map((handle) => [
        handle.name,
        tool({
          description: handle.describe,
          inputSchema: handle.inputSchema,
          execute: (input: unknown) => handle.invoke(input)
        })
      ])
    );

  return {
    describe: () => resolver.describe(override),

    async generateObject<T>(request: ObjectRequest<T>): Promise<ObjectResult<T>> {
      const choice = resolver.describe(override);

      return call(
        'object',
        request,
        choice,
        request.system.length + request.prompt.length,
        async () => {
          const result = await generateObject({
            model: await language(),
            schema: request.schema,
            ...(request.strictSchema && choice.providerId === 'openai' ? { providerOptions: { openai: { strictJsonSchema: true } } } : {}),
            system: request.system,
            prompt: request.prompt,
            maxOutputTokens: request.maxOutputTokens,
            ...(request.maxRetries === undefined ? {} : { maxRetries: request.maxRetries }),
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            abortSignal: request.signal
          });

          const value: ObjectResult<T> = {
            object: result.object,
            finishReason: result.finishReason,
            usage: usageOf(result.usage)
          };

          return {
            value,
            // The object's serialised size, so the log can show a truncated
            // answer as the small number it is without holding the answer.
            completionChars: JSON.stringify(result.object).length,
            usage: value.usage,
            finishReason: value.finishReason
          };
        }
      );
    },

    async generateText(request: TextRequest): Promise<TextResult> {
      const choice = resolver.describe(override);

      return call(
        'text',
        request,
        choice,
        request.system.length + request.prompt.length,
        async () => {
          const settings = {
            model: await language(),
            system: request.system,
            prompt: request.prompt,
            maxOutputTokens: request.maxOutputTokens,
            ...(request.maxRetries === undefined ? {} : { maxRetries: request.maxRetries }),
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            abortSignal: request.signal
          };

          // Streamed only when somebody is listening. The two SDK calls report
          // failure and cancellation differently, so taking the streaming path
          // for a caller that will never see the fragments would buy nothing
          // and change the error surface under every existing step.
          const result = request.onDelta
            ? await streamed(
                (onError) => streamText({ ...settings, onError }),
                request.signal,
                request.onDelta
              )
            : completed(await generateText(settings));

          const value: TextResult = {
            text: result.text,
            finishReason: result.finishReason,
            usage: result.usage
          };

          return {
            value,
            completionChars: result.text.length,
            usage: value.usage,
            finishReason: value.finishReason
          };
        }
      );
    },

    /**
     * Reads an image, and does nothing else with it.
     *
     * The bytes are passed to the SDK and never to the logger — `inputBytes` is
     * a length, and that is the whole of what the log learns about a picture of
     * somebody's CV.
     */
    async transcribeImage(request: ImageRequest): Promise<TextResult> {
      const choice = resolver.describe(override);

      return call(
        'image',
        request,
        choice,
        request.instruction.length,
        async () => {
          const result = await generateText({
            model: await language(),
            maxOutputTokens: request.maxOutputTokens,
            abortSignal: request.signal,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: request.instruction },
                  { type: 'image', image: request.bytes, mediaType: request.mediaType }
                ]
              }
            ]
          });

          const value: TextResult = {
            text: result.text,
            finishReason: result.finishReason,
            usage: usageOf(result.usage)
          };

          return {
            value,
            completionChars: result.text.length,
            usage: value.usage,
            finishReason: value.finishReason
          };
        },
        { inputBytes: request.bytes.byteLength }
      );
    },

    async runToolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
      const choice = resolver.describe(override);
      const history = request.history ?? [];

      return call(
        'tool_loop',
        request,
        choice,
        request.system.length
          + request.prompt.length
          + history.reduce((total, turn) => total + turn.text.length, 0),
        async () => {
          const settings = {
            model: await language(),
            system: request.system,
            // `prompt` and `messages` are alternatives, not a pair — the SDK
            // refuses both — so the question is the last message once there is
            // a conversation to put it at the end of.
            ...(history.length > 0
              ? {
                  messages: [
                    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
                    { role: 'user' as const, content: request.prompt }
                  ]
                }
              : { prompt: request.prompt }),
            tools: handlesToTools(request.tools),
            // A hard ceiling on turns. Nothing here ever runs unbounded, and a
            // loop that hits the ceiling is reported rather than retried — the
            // executor decides what an exhausted loop means.
            stopWhen: stepCountIs(request.maxSteps),
            abortSignal: request.signal
          };

          const result = request.onDelta
            ? await streamed(
                (onError) => streamText({ ...settings, onError }),
                request.signal,
                request.onDelta
              )
            : completed(await generateText(settings));

          const value: ToolLoopResult = {
            text: result.text,
            steps: result.steps,
            finishReason: result.finishReason,
            usage: result.usage
          };

          return {
            value,
            completionChars: result.text.length,
            usage: value.usage,
            finishReason: value.finishReason
          };
        }
      );
    },

    async embed(request: EmbedRequest): Promise<EmbedResult> {
      const choice = resolver.describeEmbedding(override);

      return call(
        'embed',
        request,
        choice,
        request.values.reduce((total, value) => total + value.length, 0),
        async () => {
          const result = await embedMany({
            model: await resolver.embedding(override),
            values: [...request.values],
            abortSignal: request.signal
          });

          // Normalised at the boundary, so cosine similarity downstream is a dot
          // product and every stored vector is comparable to every other.
          const vectors = result.embeddings.map(normalise);

          const value: EmbedResult = {
            vectors,
            provider: choice.providerId,
            model: choice.modelId,
            dim: vectors[0]?.length ?? 0
          };

          // Embedding usage is a single token count, not the input/output split
          // a generation reports.
          const tokens = result.usage?.tokens;

          return {
            value,
            completionChars: 0,
            usage: tokens === undefined ? {} : { totalTokens: tokens }
          };
        }
      );
    }
  };
};

/**
 * L2-normalises on the way in, once.
 *
 * A zero vector is left alone rather than divided by zero: it scores 0 against
 * everything, which is the right answer for a chunk with no signal, where NaNs
 * would poison every comparison they touched.
 */
const normalise = (values: readonly number[]): Float32Array => {
  const vector = new Float32Array(values);
  let sum = 0;
  for (const value of vector) sum += value * value;

  const length = Math.sqrt(sum);
  if (length === 0) return vector;

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) / length;
  }

  return vector;
};
