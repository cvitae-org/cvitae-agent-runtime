import { APICallError, EmptyResponseBodyError, InvalidResponseDataError, JSONParseError, TypeValidationError, embed, generateText } from 'ai';
import { RuntimeError } from '../contracts/index.js';
import type { Environment } from './environment.js';
import { providers, type ModelChoice, type ModelResolver } from './resolve.js';

export type ProviderTestResult = {
  readonly providerId: string;
  readonly modelId: string;
  readonly ok: boolean;
  readonly errorCode?: string;
};
export type ProviderConnectionTest = {
  readonly chat: ProviderTestResult;
  readonly embedding: ProviderTestResult;
};
export type ConnectionTestOptions = {
  readonly timeoutMs?: number;
  readonly chat?: (resolver: ModelResolver, signal: AbortSignal) => Promise<string>;
  readonly embedding?: (resolver: ModelResolver, signal: AbortSignal) => Promise<readonly number[]>;
};

const errorCode = (error: unknown, signal: AbortSignal): string => {
  if (signal.aborted) return 'timeout';
  if ((error instanceof RuntimeError && error.code === 'invalid_model_output')
    || EmptyResponseBodyError.isInstance(error) || InvalidResponseDataError.isInstance(error)
    || JSONParseError.isInstance(error) || TypeValidationError.isInstance(error)) return 'invalid_response';
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) return 'authentication';
    if (error.statusCode === 402 || error.statusCode === 429) return 'quota';
    if (error.statusCode === 404) return 'model_unavailable';
    if (error.statusCode === 400 || error.statusCode === 422) return 'misconfigured';
  }
  return 'network';
};

const runTest = async (
  choice: ModelChoice,
  environment: Environment,
  action: (signal: AbortSignal) => Promise<boolean>,
  timeoutMs: number
): Promise<ProviderTestResult> => {
  const identity = { providerId: choice.providerId, modelId: choice.modelId };
  if (providers[choice.providerId].credentialRequired && !environment.credentials()[choice.providerId]) {
    return { ...identity, ok: false, errorCode: 'missing_credential' };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const valid = await Promise.race([
      action(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
      })
    ]);
    return valid ? { ...identity, ok: true } : { ...identity, ok: false, errorCode: 'invalid_response' };
  } catch (error) {
    return { ...identity, ok: false, errorCode: errorCode(error, controller.signal) };
  } finally {
    clearTimeout(timer);
  }
};

export const testProviderConnection = async (
  resolver: ModelResolver,
  environment: Environment,
  options: ConnectionTestOptions = {}
): Promise<ProviderConnectionTest> => {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const chat = await runTest(resolver.describe(), environment, async signal => {
    const text = options.chat ? await options.chat(resolver, signal) : (await generateText({
      model: await resolver.language(), prompt: 'Reply with OK.',
      maxOutputTokens: 16, maxRetries: 0, abortSignal: signal
    })).text;
    return text.trim().length > 0;
  }, timeoutMs);
  const embedding = await runTest(resolver.describeEmbedding(), environment, async signal => {
    const vector = options.embedding ? await options.embedding(resolver, signal) : (await embed({
      model: await resolver.embedding(), value: 'connection test', maxRetries: 0, abortSignal: signal
    })).embedding;
    return vector.length > 0 && vector.every(Number.isFinite);
  }, timeoutMs);
  return { chat, embedding };
};
