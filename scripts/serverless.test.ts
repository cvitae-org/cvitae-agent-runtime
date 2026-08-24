/**
 * The serverless adapter, exercised the way the platform will call it.
 *
 * `src/server/netlify.ts` is the only code the hosted deployment runs that the
 * Fastify process does not, and the parts of it that can be wrong are dull:
 * which segment of the path is the capability, whether a stream carries the
 * frame format the caller parses, whether a refusal is JSON or an empty 200.
 * None of that is visible until something is deployed, so it is pinned here
 * instead.
 *
 * No request leaves the process. The refusals answer before any model is
 * resolved, and the one test that runs a batch end to end sends inputs that
 * fail validation — so the pipeline is exercised and no provider is called.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.RUNTIME_MODE = 'hosted';

const { handleHealth, handleRun, handleRunBatch } = await import(
  '../src/server/netlify.js'
);

const post = (path: string, body: unknown): Request =>
  new Request(`https://runtime.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

/** A caller that brought its own key, which is the only kind hosted mode has. */
const byok = { providerId: 'openrouter', modelId: 'test-model', apiKey: 'sk-caller' };

const bodyOf = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

test('health names only what this deployment will actually run', async () => {
  const body = await bodyOf(await handleHealth());
  const names = (body.capabilities as { name: string }[]).map((one) => one.name);

  assert.deepEqual(names, [
    'extract_cv',
    'translate_cv',
    'analyze_offer',
    'verify_recipient'
  ]);
  // Every tool reads the store, and the only capability that calls them is not
  // served here. Three tools that each report an empty index is not an answer.
  assert.deepEqual(body.tools, []);
});

test('the capability is read from the last path segment', async () => {
  const response = await handleRun(post('/run/ask_profile', { input: {}, model: byok }));

  assert.equal(response.status, 501);
  assert.match(String((await bodyOf(response)).error), /"ask_profile"/);
});

test('a GET is answered with a method error rather than an empty run', async () => {
  const response = await handleRun(
    new Request('https://runtime.example/run/analyze_offer')
  );

  assert.equal(response.status, 405);
});

test('malformed JSON is reported as the envelope mistake it usually is', async () => {
  const response = await handleRun(
    new Request('https://runtime.example/run/analyze_offer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json'
    })
  );

  assert.equal(response.status, 400);
  assert.match(String((await bodyOf(response)).error), /"input"/);
});

test('a run without a key is refused as JSON, not as a bare status', async () => {
  const response = await handleRun(
    post('/run/analyze_offer', { input: { offerText: 'x' }, model: { providerId: 'openrouter' } })
  );

  assert.equal(response.status, 400);
  assert.equal((await bodyOf(response)).reason, 'missing_client_key');
});

test('a batch streams the frame format the caller parses, and ends with a summary', async () => {
  const response = await handleRunBatch(
    post('/run-batch/analyze_offer', {
      // Neither offerText nor url, so every input fails its own validation and
      // the batch completes without a provider request.
      inputs: [{ offerText: '' }, { offerText: '' }],
      model: byok
    })
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');

  const text = await response.text();
  const events = text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const [event, data] = frame.split('\n');
      return {
        event: event?.replace('event: ', ''),
        data: JSON.parse(data?.replace('data: ', '') ?? '{}')
      };
    });

  assert.deepEqual(
    events.map((one) => one.event),
    ['result', 'result', 'done']
  );
  assert.equal(events[0]?.data.status, 'failed');
  assert.equal(events[0]?.data.index, 0);
  assert.equal(events[2]?.data.failed, 2);
  assert.equal(events[2]?.data.aborted, false);
});

test('a batch refusal arrives before the stream opens, as ordinary JSON', async () => {
  const response = await handleRunBatch(
    post('/run-batch/analyze_offer', { inputs: [{ offerText: 'x' }] })
  );

  assert.equal(response.status, 400);
  assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
});
