/**
 * The gateway's job is everything around the model call.
 *
 * None of these need a model server, because none of the properties belong to
 * the model. Whether two calls overlap, whether a cancelled one takes a slot,
 * and whether a provider's error carries the prompt out with it are all
 * decided by the code on this side of the boundary.
 *
 * The redaction test is the one to keep. A provider error is not a string about
 * a provider — `APICallError` carries the request body and the response body,
 * so a single `console.warn(error)` prints the whole prompt. The previous
 * runtime had several of those, two lines away from a logger that was
 * scrupulously recording nothing but counts.
 *
 * The conversation test is the same kind of claim about the same boundary, and
 * both of its mutations were run and killed it:
 *
 *   the gateway concatenates the turns     what was said before arrives …
 *   promptChars ignores the conversation   what was said before arrives …
 */

import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import test from 'node:test';
import { APICallError } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import { z } from 'zod';
import { createAiGateway } from '../src/effects/ai.js';
import { createModelResolver } from '../src/providers/resolve.js';
import { RuntimeError } from '../src/contracts/index.js';
import { callFor, fakeResolver } from './support/models.js';
import { recorder } from './support/spine.js';

const schema = z.object({ ok: z.boolean() });

test('a local provider takes one call at a time', async () => {
  const fake = fakeResolver({ providerId: 'local', delayMs: 10 });
  const ai = createAiGateway({ resolver: fake.resolver, logger: recorder() });

  await Promise.all(
    Array.from({ length: 4 }, () =>
      ai.generateObject({ ...callFor(), schema, system: 's', prompt: 'p', maxOutputTokens: 64 })
    )
  );

  assert.equal(fake.calls(), 4, 'all four still happened');
  assert.equal(fake.peak(), 1, 'but never two at once — a local server is one GPU');
});

test('a hosted provider runs them together', async () => {
  const fake = fakeResolver({ providerId: 'openai', delayMs: 10 });
  const ai = createAiGateway({ resolver: fake.resolver, logger: recorder() });

  await Promise.all(
    Array.from({ length: 4 }, () =>
      ai.generateObject({ ...callFor(), schema, system: 's', prompt: 'p', maxOutputTokens: 64 })
    )
  );

  assert.equal(fake.peak(), 4, 'a hosted API absorbs them, so serialising would be waste');
});

test('the limit is per provider, not per operation', async () => {
  const fake = fakeResolver({ providerId: 'local', delayMs: 10 });
  const ai = createAiGateway({ resolver: fake.resolver, logger: recorder() });

  // Generation and embedding against the same local server. Keying the
  // semaphore by operation would give each its own slot, which is the same
  // overcommitment one layer down.
  await Promise.all([
    ai.generateObject({ ...callFor(), schema, system: 's', prompt: 'p', maxOutputTokens: 64 }),
    ai.embed({ ...callFor(), values: ['a', 'b'] }),
    ai.generateText({ ...callFor(), system: 's', prompt: 'p', maxOutputTokens: 64 })
  ]);

  assert.equal(fake.peak(), 1);
});

test('a provider error reaches the caller with the payload stripped out', async () => {
  const PROMPT = 'the applicant lives at 12 Example Street';
  const COMPLETION = '{"salary":"18000 PLN","name":"a real person"}';

  const fake = fakeResolver({
    providerId: 'local',
    fail: () => {
      throw new APICallError({
        message: `Bad request: ${COMPLETION}`,
        url: 'http://localhost:11434/v1/chat/completions',
        requestBodyValues: { prompt: PROMPT },
        statusCode: 400,
        responseBody: COMPLETION
      });
    }
  });

  const log = recorder();
  const ai = createAiGateway({ resolver: fake.resolver, logger: log });

  const error = await ai
    .generateObject({ ...callFor(), schema, system: 'sys', prompt: PROMPT, maxOutputTokens: 64 })
    .then(
      () => undefined,
      (thrown: unknown) => thrown
    );

  assert.ok(error instanceof RuntimeError);
  assert.equal(error.code, 'model_call_failed');
  assert.match(error.message, /HTTP 400/);
  assert.match(error.message, /localhost:11434/, 'which host refused is safe and useful');

  // Not just the message: nothing reachable by printing the error. `cause` is
  // deliberately unset, because Node's formatter walks the cause chain and
  // would print the very thing the wrapper exists to hide.
  assert.equal(error.cause, undefined);

  const printed = inspect(error, { depth: 10 });
  assert.ok(!printed.includes(PROMPT), 'the prompt must not survive the wrapping');
  assert.ok(!printed.includes('18000 PLN'), 'nor the response body');

  const [entry] = log.entries;
  assert.equal(entry?.outcome, 'failed');
  assert.equal(entry?.errorCode, 'http_400');
});

const refusal = (statusCode: number) => new APICallError({
  message: 'Incorrect API key provided',
  url: 'https://api.openai.com/v1/chat/completions',
  requestBodyValues: {},
  statusCode,
  // Retried at once rather than after the SDK's two-second backoff.
  responseHeaders: { 'retry-after-ms': '1' },
  isRetryable: statusCode >= 500
});

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(() => undefined, (thrown: unknown) => thrown);

test('a key the provider refuses is credential_rejected, not a model failure', async () => {
  for (const statusCode of [401, 403]) {
    const fake = fakeResolver({ providerId: 'openai', modelId: 'gpt-4o', fail: () => { throw refusal(statusCode); } });
    const log = recorder();
    const ai = createAiGateway({ resolver: fake.resolver, logger: log });

    const error = await failureOf(
      ai.generateText({ ...callFor(), system: 's', prompt: 'p', maxOutputTokens: 64 })
    );

    assert.ok(error instanceof RuntimeError);
    assert.equal(error.code, 'credential_rejected', `HTTP ${statusCode}`);
    assert.match(error.message, new RegExp(`^gpt-4o: api\\.openai\\.com refused the call \\(HTTP ${statusCode}\\)`));
    assert.equal(log.entries[0]?.errorCode, `http_${statusCode}`);
  }
});

test('a missing key keeps its own code through the gateway', async () => {
  // The real resolver, as the field saw it: a hosted provider with no key.
  const ai = createAiGateway({
    resolver: createModelResolver({ env: { AI_PROVIDER: 'openai', EMBEDDING_PROVIDER: 'openai' } }),
    logger: recorder()
  });

  for (const call of [
    () => ai.generateText({ ...callFor(), system: 's', prompt: 'p', maxOutputTokens: 64 }),
    () => ai.embed({ ...callFor(), values: ['a'] })
  ]) {
    const error = await failureOf(call());
    assert.ok(error instanceof RuntimeError);
    assert.equal(error.code, 'misconfigured');
    assert.match(error.message, /Missing OPENAI_API_KEY/);
  }
});

test('a refusal after a retried outage is judged by the last attempt', async () => {
  let attempts = 0;
  const fake = fakeResolver({
    providerId: 'openai',
    fail: () => { attempts += 1; throw refusal(attempts === 1 ? 503 : 401); }
  });
  const log = recorder();
  const ai = createAiGateway({ resolver: fake.resolver, logger: log });

  const error = await failureOf(
    ai.generateText({ ...callFor(), system: 's', prompt: 'p', maxOutputTokens: 64, maxRetries: 1 })
  );

  assert.equal(attempts, 2, 'the SDK retried the 503 once');
  assert.ok(error instanceof RuntimeError);
  assert.equal(error.code, 'credential_rejected');
  assert.match(error.message, /api\.openai\.com/, 'the host survives the unwrapping');
  assert.equal(log.entries[0]?.errorCode, 'http_401');
  assert.ok(!inspect(error, { depth: 10 }).includes('Incorrect API key'), 'the provider\'s text does not');
});

test('the log records sizes and never text', async () => {
  const fake = fakeResolver({ providerId: 'local', answer: '{"ok":true}' });
  const log = recorder();
  const ai = createAiGateway({ resolver: fake.resolver, logger: log });

  await ai.generateObject({
    ...callFor(),
    schema,
    system: 'system',
    prompt: 'a prompt about someone',
    maxOutputTokens: 64
  });

  const [entry] = log.entries;
  assert.equal(entry?.operation, 'object');
  assert.equal(entry?.outcome, 'ok');
  assert.equal(entry?.providerId, 'local');
  assert.equal(entry?.promptChars, 'system'.length + 'a prompt about someone'.length);
  assert.equal(entry?.completionChars, '{"ok":true}'.length);
  assert.deepEqual(entry?.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 });
  assert.equal(entry?.finishReason, 'stop');
  assert.equal(entry?.step, 'a-step');

  const printed = JSON.stringify(log.entries);
  assert.ok(!printed.includes('a prompt about someone'), 'the log holds counts, not content');
});

test('a call cancelled before it starts never takes a slot', async () => {
  const fake = fakeResolver({ providerId: 'local' });
  const log = recorder();
  const ai = createAiGateway({ resolver: fake.resolver, logger: log });

  const cancelled = AbortSignal.abort(new Error('the user closed the window'));

  await assert.rejects(
    () =>
      ai.generateObject({
        ...callFor(cancelled),
        schema,
        system: 's',
        prompt: 'p',
        maxOutputTokens: 64
      }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.code, 'aborted');
      return true;
    }
  );

  assert.equal(fake.calls(), 0, 'the model was never reached');
  assert.equal(log.entries.length, 0, 'and nothing was logged, because nothing happened');
});

test('embeddings come back normalised, so cosine is a dot product downstream', async () => {
  const fake = fakeResolver({ providerId: 'local' });
  const ai = createAiGateway({ resolver: fake.resolver, logger: recorder() });

  const result = await ai.embed({ ...callFor(), values: ['one', 'two'] });

  assert.equal(result.dim, 2);
  assert.equal(result.vectors.length, 2);

  // The mock answers [3, 4], whose length is 5. Compared with a tolerance
  // because the vectors are Float32 — which is the storage format too, so
  // asserting exact doubles here would be asserting something untrue.
  const [x = 0, y = 0] = result.vectors[0] ?? [];
  assert.ok(Math.abs(x - 0.6) < 1e-6 && Math.abs(y - 0.8) < 1e-6);
  assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-6, 'unit length');
});

/**
 * The deadlock this found was real, and it was found by running the harness
 * rather than by reading it.
 *
 * `ask_profile` on a local provider hung with no output and left its run row
 * `running`: the tool loop holds the single local slot for the whole loop, and
 * `search_profile` embeds its query, so the tool waited for a slot the call
 * that invoked it was still holding. Nothing was in flight, so Node's event
 * loop emptied and the process exited 0 — a silent hang, which is the worst
 * shape a failure can take.
 *
 * The race guard is deliberate: without it a regression here does not fail this
 * test, it hangs the whole suite.
 */
test('a tool that calls the model does not wait for the slot its caller holds', async () => {
  let turn = 0;

  const language = new MockLanguageModelV2({
    doGenerate: async () => {
      turn += 1;

      return turn === 1
        ? {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'call-1',
                toolName: 'lookup',
                input: '{"query":"postgres"}'
              }
            ],
            finishReason: 'tool-calls' as const,
            usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
            warnings: []
          }
        : {
            content: [{ type: 'text' as const, text: 'She migrated 400 million rows.' }],
            finishReason: 'stop' as const,
            usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
            warnings: []
          };
    }
  });

  const fake = fakeResolver({ providerId: 'local' });
  const ai = createAiGateway({
    resolver: { ...fake.resolver, language: async () => language },
    logger: recorder()
  });

  const loop = ai.runToolLoop({
    ...callFor(),
    system: 's',
    prompt: 'p',
    maxSteps: 4,
    tools: [
      {
        name: 'lookup',
        describe: 'Search the profile.',
        inputSchema: z.object({ query: z.string() }),
        // What `search_profile` does: a nested call against the same provider.
        invoke: async () => ai.embed({ ...callFor(), values: ['postgres'] })
      }
    ]
  });

  const result = await Promise.race([
    loop,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('the loop deadlocked on its own slot')), 2_000)
    )
  ]);

  assert.equal(result.finishReason, 'stop');
  assert.match(result.text, /400 million rows/);
});

/**
 * A conversation is a list of turns, not a prompt with a transcript in it.
 *
 * The distinction is invisible from the caller's side — both produce an answer
 * that reads like it remembers — and it is the whole of the feature. A model
 * handed a transcript inside one user message answers *about* the transcript
 * about as often as it continues it, and every provider's prompt cache keys on
 * the message prefix, which a re-concatenated blob invalidates on every turn.
 *
 * Asserted at the model boundary rather than on the settings object, because
 * `prompt` and `messages` are alternatives the SDK normalises into the same
 * shape, and the only place the difference is real is what the model receives.
 */
test('what was said before arrives as its own turns', async () => {
  const seen: { role: string; text: string }[] = [];

  const language = new MockLanguageModelV2({
    doGenerate: async ({ prompt }) => {
      for (const message of prompt) {
        const content = message.content;
        seen.push({
          role: message.role,
          text:
            typeof content === 'string'
              ? content
              : content
                  .map((part) => ('text' in part ? part.text : ''))
                  .join('')
        });
      }

      return {
        content: [{ type: 'text' as const, text: 'At Globex, the design system.' }],
        finishReason: 'stop' as const,
        usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
        warnings: []
      };
    }
  });

  const fake = fakeResolver({ providerId: 'local' });
  const log = recorder();
  const ai = createAiGateway({
    resolver: { ...fake.resolver, language: async () => language },
    logger: log
  });

  await ai.runToolLoop({
    ...callFor(),
    system: 'Answer about the CV.',
    prompt: 'And before that?',
    history: [
      { role: 'user', text: 'What did I do at Acme?' },
      { role: 'assistant', text: 'You rewrote the billing pipeline.' }
    ],
    maxSteps: 4,
    tools: []
  });

  assert.deepEqual(
    seen.map((message) => message.role),
    ['system', 'user', 'assistant', 'user'],
    'the reply is the model\'s own turn, not more of what the user said'
  );

  // The question is the last message and nothing has been appended to it. A
  // gateway that pasted the transcript in front of it would still produce four
  // entries — this is the assertion that separates the two.
  assert.equal(seen[3]?.text, 'And before that?');
  assert.equal(seen[1]?.text, 'What did I do at Acme?');

  // Metadata-only, and it has to count what was actually sent: history is the
  // one contributor that grows without the prompt changing, so a `promptChars`
  // blind to it reports a flat line while the real cost climbs.
  const entry = log.entries.at(-1);
  assert.equal(entry?.operation, 'tool_loop');
  assert.equal(
    entry?.promptChars,
    'Answer about the CV.'.length
      + 'And before that?'.length
      + 'What did I do at Acme?'.length
      + 'You rewrote the billing pipeline.'.length
  );
});
