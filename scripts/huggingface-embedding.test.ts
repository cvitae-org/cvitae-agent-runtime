import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError, embedMany } from 'ai';
import { RuntimeError } from '../src/contracts/index.js';
import { createHuggingFaceEmbedding } from '../src/providers/huggingface-embedding.js';
import { createModelResolver } from '../src/providers/resolve.js';

test('Hugging Face resolver builds the native embedding adapter', async () => {
  const model = await createModelResolver({ env: { EMBEDDING_PROVIDER: 'huggingface', HF_TOKEN: 'synthetic-token' } }).embedding();
  assert.ok(typeof model !== 'string');
  assert.equal(model.provider, 'huggingface');
  assert.equal(model.modelId, 'BAAI/bge-m3');
});

test('native feature extraction preserves batch order through the AI SDK', async () => {
  const batches: string[][] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-token');
    const inputs = (JSON.parse(String(init?.body)) as { inputs: string[] }).inputs;
    batches.push(inputs);
    return Response.json(inputs.map(value => [Number(value), 1]));
  };
  const values = Array.from({ length: 35 }, (_, index) => String(index));
  const result = await embedMany({ model: createHuggingFaceEmbedding('BAAI/bge-m3', 'synthetic-token', fetchImpl), values });
  assert.deepEqual(result.embeddings, values.map(value => [Number(value), 1]));
  assert.deepEqual(batches.map(batch => batch.length).sort(), [3, 32]);
});

test('a single flat vector is normalized and malformed vectors are refused', async () => {
  const model = (body: unknown) => createHuggingFaceEmbedding('BAAI/bge-m3', 'synthetic-token', async () => Response.json(body));
  assert.deepEqual(await model([1, 2]).doEmbed({ values: ['one'] }), { embeddings: [[1, 2]] });
  for (const body of [[], [[1], [1, 2]], [[1, null]], [[[1, 2]]], { error: 'unsafe provider content' }]) {
    await assert.rejects(async () => model(body).doEmbed({ values: ['one'] }), (error: unknown) =>
      error instanceof RuntimeError && error.code === 'invalid_model_output' && !error.message.includes('unsafe'));
  }
});

test('HTTP failures retain classification without carrying credentials, input or response text', async () => {
  for (const status of [401, 403, 408, 409, 429, 503]) {
    const model = createHuggingFaceEmbedding('BAAI/bge-m3', 'secret-token', async () => new Response('unsafe response text', { status }));
    await assert.rejects(async () => model.doEmbed({ values: ['private CV text'] }), (error: unknown) => {
      assert.ok(APICallError.isInstance(error));
      assert.equal(error.statusCode, status);
      assert.equal(error.isRetryable, status >= 500 || [408, 409, 429].includes(status));
      assert.equal(error.requestBodyValues, undefined);
      assert.equal(error.responseBody, undefined);
      assert.ok(!JSON.stringify(error).includes('private CV text'));
      assert.ok(!JSON.stringify(error).includes('secret-token'));
      return true;
    });
  }
});

test('cancellation reaches the feature extraction request', async () => {
  const controller = new AbortController();
  const model = createHuggingFaceEmbedding('BAAI/bge-m3', 'synthetic-token', async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    controller.abort();
    init?.signal?.throwIfAborted();
    return Response.json([[1]]);
  });
  await assert.rejects(async () => model.doEmbed({ values: ['one'], abortSignal: controller.signal }), { name: 'AbortError' });
});


test('cancellation while reading the response retains AbortError', async () => {
  const controller = new AbortController();
  const model = createHuggingFaceEmbedding('BAAI/bge-m3', 'synthetic-token', async () => {
    const response = Response.json([[1]]);
    Object.defineProperty(response, 'json', { value: async () => { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); } });
    return response;
  });
  await assert.rejects(async () => model.doEmbed({ values: ['one'], abortSignal: controller.signal }), { name: 'AbortError' });
});

test('different embedding dimensions in a batch are refused', async () => {
  const model = createHuggingFaceEmbedding('BAAI/bge-m3', 'synthetic-token', async () => Response.json([[1], [1, 2]]));
  await assert.rejects(async () => model.doEmbed({ values: ['one', 'two'] }), (error: unknown) => error instanceof RuntimeError && error.code === 'invalid_model_output');
});
