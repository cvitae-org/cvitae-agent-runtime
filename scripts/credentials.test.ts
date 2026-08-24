/**
 * What a caller's own API key is allowed to do to this process.
 *
 * The behaviour under test is small and the failure it prevents is not: a
 * request may carry a credential, that credential must win over the
 * environment for the one call, and it must leave nothing behind — because the
 * model cache is keyed by provider, model and base URL, and a client built with
 * somebody's key stored under that key would be handed to the next caller.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AiConfigError,
  resolveModel,
  resolveEmbeddingModel
} from '../src/providers/resolve.js';

/**
 * The key a resolved model will actually send.
 *
 * The AI SDK keeps it in the closure that builds request headers rather than on
 * the model object, so the only honest way to read it back is to ask for those
 * headers. `config.headers()` is the provider's own accessor; nothing else here
 * knows the difference between a client built with one key and another.
 */
const bearerOf = (model: unknown): string | undefined => {
  const headers = (
    model as { config?: { headers?: () => Record<string, string | undefined> } }
  ).config?.headers?.();

  return headers?.Authorization ?? headers?.authorization;
};

const withEnv = async <T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>
): Promise<T> => {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]])
  );

  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

test('a key sent with the call is spent instead of the environment one', async () => {
  await withEnv({ OPENROUTER_API_KEY: 'env-key' }, async () => {
    const resolved = await resolveModel({
      providerId: 'openrouter',
      modelId: 'test-model',
      apiKey: 'caller-key'
    });

    assert.equal(bearerOf(resolved.model), 'Bearer caller-key');
  });
});

test('a call without a key still resolves from the environment', async () => {
  await withEnv({ OPENROUTER_API_KEY: 'env-key' }, async () => {
    const resolved = await resolveModel({
      providerId: 'openrouter',
      modelId: 'test-model'
    });

    assert.equal(bearerOf(resolved.model), 'Bearer env-key');
  });
});

test('a caller key is never left in the cache for the next caller', async () => {
  await withEnv({ OPENROUTER_API_KEY: 'env-key' }, async () => {
    // Same provider, model and base URL, which is the whole cache key. If the
    // first call stored its client, the second gets the first caller's key —
    // the exact substitution this design exists to prevent.
    const first = await resolveModel({
      providerId: 'openrouter',
      modelId: 'shared-cache-key',
      apiKey: 'caller-key'
    });
    const second = await resolveModel({
      providerId: 'openrouter',
      modelId: 'shared-cache-key'
    });

    assert.equal(bearerOf(first.model), 'Bearer caller-key');
    assert.equal(bearerOf(second.model), 'Bearer env-key');
  });
});

test('a cached environment model is not handed a later caller key', async () => {
  await withEnv({ OPENROUTER_API_KEY: 'env-key' }, async () => {
    // The reverse order, because the bypass has to hold in both directions:
    // reading the cache for a call that brought its own key would answer with
    // the server's, which is the failure cvitae started refusing to delegate to
    // avoid in the first place.
    const cached = await resolveModel({
      providerId: 'openrouter',
      modelId: 'cache-first'
    });
    const supplied = await resolveModel({
      providerId: 'openrouter',
      modelId: 'cache-first',
      apiKey: 'caller-key'
    });

    assert.equal(bearerOf(cached.model), 'Bearer env-key');
    assert.equal(bearerOf(supplied.model), 'Bearer caller-key');
  });
});

test('a caller key stands in for an environment variable that is not set', async () => {
  await withEnv({ OPENAI_API_KEY: undefined }, async () => {
    // The case the feature is for: a user with their own key and a server
    // configured for a different provider, or for none.
    await assert.rejects(
      () => resolveModel({ providerId: 'openai', modelId: 'gpt-4o-mini' }),
      AiConfigError
    );

    const resolved = await resolveModel({
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      apiKey: 'caller-key'
    });

    assert.equal(resolved.providerId, 'openai');
  });
});

test('embeddings follow the same rule as generation', async () => {
  await withEnv({ HF_TOKEN: 'env-key' }, async () => {
    const supplied = await resolveEmbeddingModel({
      providerId: 'huggingface',
      modelId: 'embed-test',
      apiKey: 'caller-key'
    });
    const fromEnv = await resolveEmbeddingModel({
      providerId: 'huggingface',
      modelId: 'embed-test'
    });

    assert.equal(bearerOf(supplied.model), 'Bearer caller-key');
    assert.equal(bearerOf(fromEnv.model), 'Bearer env-key');
  });
});
