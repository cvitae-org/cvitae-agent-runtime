import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from 'ai';
import { RuntimeError } from '../src/contracts/index.js';
import { createEnvironment } from '../src/providers/environment.js';
import { createModelResolver } from '../src/providers/resolve.js';
import { testProviderConnection } from '../src/providers/connection-test.js';

const setup = () => {
  const environment = createEnvironment({ OPENAI_API_KEY: 'fixture-key', AI_PROVIDER: 'openai', EMBEDDING_PROVIDER: 'openai' });
  return { environment, resolver: createModelResolver({ env: environment.env }) };
};

test('checks chat and embeddings independently, without changing active settings or credentials', async () => {
  const { environment, resolver } = setup();
  const before = { ...environment.env };
  const result = await testProviderConnection(resolver, environment, {
    chat: async () => { throw new APICallError({ message: 'refused', url: 'https://example.test', requestBodyValues: undefined, statusCode: 401 }); },
    embedding: async () => [0.2, 0.4]
  });
  assert.equal(result.chat.errorCode, 'authentication');
  assert.equal(result.embedding.ok, true);
  assert.deepEqual(environment.env, before);
  assert.equal(JSON.stringify(result).includes('fixture-key'), false);
});

test('bounds a hung request and still tests embeddings', async () => {
  const { environment, resolver } = setup();
  const result = await testProviderConnection(resolver, environment, {
    timeoutMs: 5, chat: () => new Promise(() => {}), embedding: async () => [1]
  });
  assert.equal(result.chat.errorCode, 'timeout');
  assert.equal(result.embedding.ok, true);
});

test('refuses missing credentials without making a model call', async () => {
  const environment = createEnvironment({ AI_PROVIDER: 'openai', EMBEDDING_PROVIDER: 'openai' });
  let calls = 0;
  const result = await testProviderConnection(createModelResolver({ env: environment.env }), environment, {
    chat: async () => { calls++; return 'OK'; }, embedding: async () => { calls++; return [1]; }
  });
  assert.equal(calls, 0);
  assert.equal(result.chat.errorCode, 'missing_credential');
  assert.equal(result.embedding.errorCode, 'missing_credential');
});

test('rejects empty chat and nonfinite embeddings', async () => {
  const { environment, resolver } = setup();
  const result = await testProviderConnection(resolver, environment, {
    chat: async () => ' ', embedding: async () => [NaN]
  });
  assert.equal(result.chat.errorCode, 'invalid_response');
  assert.equal(result.embedding.errorCode, 'invalid_response');
});

test('maps invalid provider output to an actionable response error', async () => {
  const { environment, resolver } = setup();
  const result = await testProviderConnection(resolver, environment, {
    chat: async () => 'OK',
    embedding: async () => { throw new RuntimeError('Invalid embedding data', 'invalid_model_output'); }
  });
  assert.equal(result.chat.ok, true);
  assert.equal(result.embedding.errorCode, 'invalid_response');
});
