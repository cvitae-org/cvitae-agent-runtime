/**
 * Choosing a model, and the things that must not happen while choosing one.
 *
 * Two of these guard against costs the previous runtime actually paid.
 *
 * Describing a model must not need a credential. Knowing *what* would be called
 * is not the same as being able to call it, and conflating them meant a plan of
 * pure transforms — no model call anywhere in it — refused to run with "Missing
 * OPENROUTER_API_KEY", naming a provider it was never going to reach.
 *
 * And a caller's own key must never enter the client cache. The cache is keyed
 * by provider, model and endpoint, not by credential, so a client built with a
 * supplied key and stored under that key would be handed to the next caller
 * with somebody else's Authorization header on it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeError } from '../src/contracts/index.js';
import { assertLoopbackUrl, createModelResolver, providers } from '../src/providers/resolve.js';

const misconfigured = (error: unknown): boolean => {
  assert.ok(error instanceof RuntimeError, `expected a RuntimeError, got ${String(error)}`);
  assert.equal(error.code, 'misconfigured', 'a setting is wrong; no work was attempted');
  return true;
};

test('describing a model reads no credential', () => {
  // Nothing in this environment. A run that never reaches a model must not care.
  const resolver = createModelResolver({ env: { AI_PROVIDER: 'openai' } });

  assert.deepEqual(resolver.describe(), {
    providerId: 'openai',
    modelId: providers.openai.defaultModel,
    baseURL: undefined
  });
});

test('but calling one does, and says which variable is missing', async () => {
  const resolver = createModelResolver({ env: { AI_PROVIDER: 'openai' } });

  await assert.rejects(() => resolver.language(), (error: unknown) => {
    misconfigured(error);
    assert.match((error as Error).message, /OPENAI_API_KEY/);
    return true;
  });
});

test('an unknown provider is a configuration error, not a failure', () => {
  const resolver = createModelResolver({ env: { AI_PROVIDER: 'anthropic-ish' } });
  assert.throws(() => resolver.describe(), misconfigured);
});

test('the local server URL must be loopback', () => {
  assert.equal(assertLoopbackUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.equal(assertLoopbackUrl('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');

  // A process holding API keys that fetches whatever URL it is handed is an
  // SSRF hole with credentials attached.
  assert.throws(() => assertLoopbackUrl('http://169.254.169.254/latest/meta-data/'), misconfigured);
  assert.throws(() => assertLoopbackUrl('http://evil.example/v1'), misconfigured);
  assert.throws(() => assertLoopbackUrl('file:///etc/passwd'), misconfigured);
  assert.throws(() => assertLoopbackUrl('not a url'), misconfigured);
});

test('a hosted provider ignores a base URL entirely', () => {
  const resolver = createModelResolver({
    env: { AI_PROVIDER: 'openrouter', LOCAL_BASE_URL: 'http://localhost:11434/v1' }
  });

  // Accepting one would make this an open proxy that spends our credential.
  assert.equal(resolver.describe().baseURL, undefined);
  assert.equal(resolver.describe({ baseURL: 'http://localhost:9999/v1' }).baseURL, undefined);
});

test('a caller-supplied key never enters the cache', async () => {
  const resolver = createModelResolver({
    env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'the-environment-key' }
  });

  const first = await resolver.language();
  assert.equal(await resolver.language(), first, 'the environment client is cached');

  const supplied = await resolver.language({ apiKey: 'a-callers-own-key' });
  assert.notEqual(supplied, first, 'a supplied key builds its own client');

  // The important half: the cache is unchanged, so the next caller relying on
  // the environment does not get handed the other one's credential.
  assert.equal(await resolver.language(), first);
});

test('an unconfigured checkout generates locally', () => {
  // The README opens by saying nothing in `.env` is required. That sentence is
  // only true if an empty environment resolves to a provider that needs no
  // credential, so it is asserted rather than assumed.
  const resolver = createModelResolver({ env: {} });

  assert.equal(resolver.describe().providerId, 'local');
  assert.equal(resolver.describe().modelId, providers.local.defaultModel);
  assert.equal(resolver.describeEmbedding().providerId, 'local');
});

test('embeddings default to the local server whatever AI_PROVIDER says', () => {
  const resolver = createModelResolver({
    env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'x' }
  });

  // Embedding runs over the whole of a CV, which makes it the one step where
  // sending the data out would leak exactly what local storage protects.
  assert.equal(resolver.describeEmbedding().providerId, 'local');
  assert.equal(resolver.describeEmbedding().modelId, providers.local.defaultEmbeddingModel);
  assert.equal(resolver.describe().providerId, 'openai', 'generation is unaffected');
});

test('a provider serving no embeddings endpoint says so', () => {
  const resolver = createModelResolver({ env: { EMBEDDING_PROVIDER: 'openrouter' } });

  assert.throws(() => resolver.describeEmbedding(), (error: unknown) => {
    misconfigured(error);
    assert.match((error as Error).message, /EMBEDDING_PROVIDER/);
    return true;
  });
});

test('a local server needs no credential at all', async () => {
  const resolver = createModelResolver({ env: { AI_PROVIDER: 'local' } });

  assert.equal(resolver.describe().providerId, 'local');
  // Resolves rather than refusing: local servers accept any bearer token, so
  // there is no secret to manage and nothing to prompt anyone for.
  assert.ok(await resolver.language());
});


test('credential changes rebuild language and embedding clients; clearing cannot reuse an old key', async () => {
  const env: Record<string,string> = {AI_PROVIDER:'openai',EMBEDDING_PROVIDER:'openai',EMBEDDING_MODEL:'text-embedding-3-small',OPENAI_API_KEY:'synthetic-old'};
  const resolver=createModelResolver({env});
  const language=await resolver.language(), embedding=await resolver.embedding();
  env.OPENAI_API_KEY='synthetic-new';resolver.clearCache();
  assert.notEqual(await resolver.language(),language);
  assert.notEqual(await resolver.embedding(),embedding);
  delete env.OPENAI_API_KEY;resolver.clearCache();
  await assert.rejects(()=>resolver.language(),misconfigured);
  await assert.rejects(()=>resolver.embedding(),misconfigured);
});
