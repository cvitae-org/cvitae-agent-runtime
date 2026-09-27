/**
 * A resolver backed by the SDK's own mock models.
 *
 * The gateway's properties — one call at a time against a local server, a
 * cancelled call never taking a slot, an error reaching the caller with the
 * prompt stripped out — are all properties of the code around the call, so a
 * mock at the model boundary tests exactly the right amount and needs no
 * server. `MockLanguageModelV2` is the SDK's, so the request shape the gateway
 * builds is validated by the SDK itself on the way past.
 */

import { MockEmbeddingModelV2, MockLanguageModelV2, simulateReadableStream } from 'ai/test';
import type { EmbeddingModel, LanguageModel } from 'ai';
import type { ModelChoice, ModelResolver, ProviderId } from '../../src/providers/resolve.js';

export type Call = { readonly at: number; readonly prompt: string };

export type Fake = {
  readonly resolver: ModelResolver;
  /** How many calls were in flight at the busiest moment. */
  peak(): number;
  calls(): number;
};

const textOf = (prompt: unknown): string => JSON.stringify(prompt);

/**
 * Builds a resolver whose model answers with `answer` after `delayMs`.
 *
 * The delay is what makes overlap observable: with an instant answer every call
 * finishes before the next is queued and a broken semaphore looks correct.
 */
export const fakeResolver = (options: {
  providerId?: ProviderId;
  modelId?: string;
  answer?: string;
  extractAnswer?: string;
  delayMs?: number;
  fail?: () => never;
  onCall?: (prompt: string) => void;
  /**
   * The fragments `doStream` emits, in order.
   *
   * Their concatenation is what the streamed call must return, and the split
   * is deliberately not on word boundaries in the tests that use this: a
   * consumer that reassembles by joining on spaces passes a friendlier
   * fixture and fails a real model.
   */
  chunks?: readonly string[];
  /**
   * Emitted instead of a completion, as the SDK's `error` stream part.
   *
   * The part that matters about this: the SDK does not surface error parts on
   * `textStream`, so a gateway that only reads the text sees a *successful,
   * empty* answer here. That is the case the streamed path has to catch.
   */
  streamError?: unknown;
} = {}): Fake => {
  const providerId: ProviderId = options.providerId ?? 'local';
  const modelId = options.modelId ?? 'mock';
  const answer = options.answer ?? '{"ok":true}';
  const delayMs = options.delayMs ?? 5;

  let inFlight = 0;
  let peak = 0;
  let calls = 0;

  const enter = () => {
    inFlight += 1;
    calls += 1;
    peak = Math.max(peak, inFlight);
  };

  const usage = { inputTokens: 11, outputTokens: 7, totalTokens: 18 };

  const language = new MockLanguageModelV2({
    doGenerate: async ({ prompt }) => {
      enter();
      options.onCall?.(textOf(prompt));

      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        options.fail?.();

        return {
          content: [{ type: 'text' as const, text: options.extractAnswer ?? answer }],
          finishReason: 'stop' as const,
          usage,
          warnings: []
        };
      } finally {
        inFlight -= 1;
      }
    },

    doStream: async ({ prompt }) => {
      enter();
      options.onCall?.(textOf(prompt));

      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        options.fail?.();

        const chunks = options.chunks ?? [answer];

        return {
          stream: simulateReadableStream({
            chunkDelayInMs: null,
            initialDelayInMs: null,
            chunks: [
              { type: 'stream-start' as const, warnings: [] },
              ...(options.streamError === undefined
                ? [
                    { type: 'text-start' as const, id: '1' },
                    ...chunks.map((delta) => ({ type: 'text-delta' as const, id: '1', delta })),
                    { type: 'text-end' as const, id: '1' }
                  ]
                : [{ type: 'error' as const, error: options.streamError }]),
              { type: 'finish' as const, finishReason: 'stop' as const, usage }
            ]
          })
        };
      } finally {
        inFlight -= 1;
      }
    }
  });

  const embedding = new MockEmbeddingModelV2<string>({
    doEmbed: async ({ values }) => {
      enter();

      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        options.fail?.();

        return {
          embeddings: values.map(() => [3, 4]),
          usage: { tokens: values.length }
        };
      } finally {
        inFlight -= 1;
      }
    }
  });

  const choice: ModelChoice = { providerId, modelId, baseURL: undefined };

  return {
    resolver: {
      describe: () => choice,
      describeEmbedding: () => choice,
      language: async (): Promise<LanguageModel> => language,
      embedding: async (): Promise<EmbeddingModel<string>> => embedding
    },
    peak: () => peak,
    calls: () => calls
  };
};

/** A call with everything the gateway needs and nothing it does not. */
export const callFor = (
  signal: AbortSignal = new AbortController().signal
): { traceId: string; runId: string; step: string; signal: AbortSignal } => ({
  traceId: 'trace-1',
  runId: 'run-1',
  step: 'a-step',
  signal
});
