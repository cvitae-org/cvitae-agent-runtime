/**
 * The gateway with a person's identifiers kept out of what it sends.
 *
 * `maskedGateway` wraps the one gateway every model call goes through, so what it
 * is held to is what leaves and what comes back: nothing of the person's in a
 * request to a model that is not on their machine, what the model wrote put right
 * for the person who reads it, and every other call left exactly as it was. The
 * questions, in order:
 *
 *   when          which calls are masked, decided by the call and not by the run,
 *                 and the calls that are not are handed on as they came
 *   what leaves   every text a model is given, in each of the three calls that
 *                 give it one, and the history and the tool results of a loop
 *   what returns  the answer, an object and a stream of it put right, and a
 *                 tool that is asked for what the model was given a name for
 *   what stays    the calls with nothing to mask, the image, and whatever else
 *                 the request carried
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 77 were applied: 76 fail at least one test here, and 1 cannot be told from the original.
 *
 * src/effects/detect.ts:
 *   a NIP needs no label                                            1
 *   a handle needs no network before it                             1
 *
 * src/effects/mask.ts:
 *   a vault that does not detect is not empty when it has no seeds  1
 *   a vault gives the later span when two begin together            11
 *   a vault takes a span that begins where another ends             12
 *   a text with a shape in it is returned as it was                 14
 *   an ascii text is not put in lower case                          1
 *   each word of a name is not taken alone                          7
 *   the whole name is not taken as one                              14
 *   a phone number is not taken with its sign                       6
 *   a phone number has no separators                                8
 *   the shorter value is tried first                                14
 *   patterns are not sorted                                         7
 *   the matcher is case sensitive in the original too               21
 *   the same text is given a new placeholder each time              4
 *   placeholders are numbered across kinds                          8
 *   the number of a placeholder starts from zero                    18
 *   a placeholder that is taken is issued anyway                    3
 *   reserve notes nothing                                           3
 *   a placeholder is not put right                                  7
 *   an array is not walked                                          3
 *   an object is not walked                                         3
 *   a vault with seeds is reported empty                            21
 *   a vault with no seeds is reported not empty                     1
 *   a match is replaced by the folded text                          7
 *   a fragment is not held back                                     3
 *   everything after a bracket is held                              2
 *   what is held back is lost when the stream ends                  2
 *   what is settled is not put right                                3
 *   what is held is held again after a flush                        4
 *
 * src/effects/masking.ts:
 *   the gateway always detects                                      2
 *   the gateway detects when it is not asked either way             2
 *   a call is never masked                                          23
 *   a call is always masked                                         5
 *   hosted masks the local provider                                 24
 *   always masks only what hosted does                              2
 *   the provider is read when the gateway is built                  1
 *   a call with no seeds is still wrapped                           1
 *   the seeds are asked once, at the first call                     1
 *   describe is not passed on                                       1
 *   a structured call keeps its system text                         3
 *   a structured call keeps its prompt                              2
 *   a structured answer is not put right                            1
 *   a structured answer is put right at its top level only          1
 *   a structured call does not reserve what it holds                1
 *   a text call keeps its system text                               9
 *   a text call keeps its prompt                                    8
 *   a text answer is not put right                                  3
 *   a text call is not streamed through the restorer                2
 *   a text call streams what it was given, unrestored               2
 *   a text call does not flush what it held                         1
 *   a text call does not reserve what it holds                      1
 *   a loop keeps its system text                                    3
 *   a loop keeps its prompt                                         4
 *   a loop keeps its history                                        1
 *   a loop gives its history a key it did not have                  1
 *   a loop loses the role of a turn                                 1
 *   a loop does not reserve its history                             1
 *   a loop does not wrap its tools                                  4
 *   a loop answer is not put right                                  2
 *   a loop does not flush what it held                              1
 *   a loop is not streamed through the restorer                     2
 *   a loop does not restore its stream, only holds it               2
 *   a sink that throws fails the call                               1
 *   what a tool is asked is not put right                           1
 *   what a tool is asked is put right at its top level only         1
 *   what a tool answers is not masked                               2
 *   what a tool answers is masked at its top level only             1
 *   what a tool fails with is not masked                            1
 *   what a tool fails with loses its code                           2
 *   what a plain error says is not masked                           1
 *   what a plain error is called is lost                            1
 *   a thing thrown that is not an error is not said                 1
 *   a tool that fails is not failed                                 2
 *   a tool loses what it is called                                  0 (equivalent: a tool handle is a name, a description, a schema and a thunk, and naming them is spreading them)
 *   an image is masked as text                                      1
 *   a mode that is a word is called                                 33
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { RuntimeError } from '../src/contracts/index.js';
import type {
  AiGateway,
  MaskMode,
  MaskSeed,
  ObjectRequest,
  TextRequest,
  ToolHandle,
  ToolLoopRequest
} from '../src/contracts/index.js';
import { masks, maskedGateway } from '../src/effects/masking.js';
import { stubGateway } from './support/spine.js';

const anna: readonly MaskSeed[] = [
  { kind: 'name', value: 'Anna Kowalska' },
  { kind: 'email', value: 'anna.kowalska@example.com' },
  { kind: 'phone', value: '+48 600 123 456' },
  { kind: 'link', value: 'https://www.linkedin.com/in/anna-kowalska' }
];

const everything = [
  'Anna Kowalska',
  'ANNA KOWALSKA',
  'Kowalska',
  'Anna',
  'anna.kowalska@example.com',
  '+48 600 123 456',
  '600 123 456',
  'linkedin.com/in/anna-kowalska'
];

const signal = new AbortController().signal;
const call = { traceId: 'trace', signal };

const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 };

/** What a model was sent, as text: whatever is in it is what left the machine. */
const sent = (request: unknown): string => JSON.stringify(request);

const leaks = (request: unknown): string[] =>
  everything.filter((value) => sent(request).toLowerCase().includes(value.toLowerCase()));

type Provider = { providerId: string; modelId: string };
const hosted: Provider = { providerId: 'openai', modelId: 'gpt' };
const local: Provider = { providerId: 'local', modelId: 'gemma' };

/** A gateway that records what it was asked and answers with what it is told to. */
const recording = (
  provider: () => Provider,
  answers: {
    text?: (request: TextRequest) => string;
    object?: (request: ObjectRequest<unknown>) => unknown;
    loop?: (request: ToolLoopRequest) => Promise<string> | string;
  } = {}
) => {
  const seen: { method: string; request: unknown }[] = [];
  const gateway: AiGateway = stubGateway({
    describe: provider,
    generateText: async (request) => {
      seen.push({ method: 'generateText', request });
      const text = answers.text?.(request) ?? 'ok';
      for (const fragment of text.match(/.{1,4}/gs) ?? []) request.onDelta?.(fragment);
      return { text, finishReason: 'stop', usage };
    },
    generateObject: async <T>(request: ObjectRequest<T>) => {
      seen.push({ method: 'generateObject', request });
      return { object: (answers.object?.(request) ?? {}) as T, finishReason: 'stop', usage };
    },
    runToolLoop: async (request) => {
      seen.push({ method: 'runToolLoop', request });
      const text = await (answers.loop?.(request) ?? 'ok');
      for (const fragment of text.match(/.{1,3}/gs) ?? []) request.onDelta?.(fragment);
      return { text, steps: 2, finishReason: 'stop', usage };
    },
    transcribeImage: async (request) => {
      seen.push({ method: 'transcribeImage', request });
      return { text: 'Anna Kowalska on a page', finishReason: 'stop', usage };
    },
    embed: async (request) => {
      seen.push({ method: 'embed', request });
      return { vectors: [], provider: 'p', model: 'm', dim: 0 };
    }
  });
  return { gateway, seen, last: () => seen.at(-1)!.request };
};

const text = (over: Partial<TextRequest> = {}): TextRequest => ({
  ...call,
  system: 'You write letters for Anna Kowalska.',
  prompt: 'Her email is anna.kowalska@example.com and her phone is +48 600 123 456.',
  maxOutputTokens: 100,
  ...over
});

const masking = (provider: Provider | (() => Provider), mode: MaskMode = 'hosted', seeds = () => anna) => {
  const fake = recording(typeof provider === 'function' ? provider : () => provider);
  return { ...fake, wrapped: maskedGateway(fake.gateway, { mode, seeds }) };
};

/* ------------------------------------------------------------------- when */

test('hosted masks a call to a provider that is not on the machine, and not one that is', () => {
  assert.equal(masks('hosted', { describe: () => hosted }), true);
  assert.equal(masks('hosted', { describe: () => local }), false);
  for (const providerId of ['openrouter', 'huggingface', 'openai']) {
    assert.equal(masks('hosted', { describe: () => ({ providerId, modelId: 'm' }) }), true, providerId);
  }
});

test('always masks every call, whichever provider it is made to', () => {
  assert.equal(masks('always', { describe: () => hosted }), true);
  assert.equal(masks('always', { describe: () => local }), true);
});

test('a call to a hosted model under hosted has nothing of the person in what it sends', async () => {
  const { wrapped, last } = masking(hosted);
  await wrapped.generateText(text());

  assert.deepEqual(leaks(last()), []);
  const request = last() as TextRequest;
  assert.equal(request.system, 'You write letters for [NAME_1].');
  assert.equal(request.prompt, 'Her email is [EMAIL_1] and her phone is [PHONE_1].');
});

test('a call to a local model under hosted is handed on as it is, and the CV is not read', async () => {
  let asked = 0;
  const { wrapped, last } = masking(local, 'hosted', () => {
    asked += 1;
    return anna;
  });

  const request = text();
  const result = await wrapped.generateText(request);

  assert.equal(last(), request);
  assert.equal(result.text, 'ok');
  assert.equal(asked, 0);
});

test('a call to a local model under always is masked', async () => {
  const { wrapped, last } = masking(local, 'always');
  await wrapped.generateText(text());
  assert.deepEqual(leaks(last()), []);
});

test('which provider a call goes to is decided when it is made', async () => {
  let provider = local;
  const { wrapped, seen } = masking(() => provider);

  await wrapped.generateText(text());
  provider = hosted;
  await wrapped.generateText(text());
  provider = local;
  await wrapped.generateText(text());

  assert.deepEqual(
    seen.map((one) => leaks(one.request).length > 0),
    [true, false, true]
  );
});

test('what a call is to keep from a model is asked when the call is made', async () => {
  let current: readonly MaskSeed[] = [];
  const { wrapped, seen } = masking(hosted, 'hosted', () => current);

  await wrapped.generateText(text());
  current = anna;
  await wrapped.generateText(text());
  current = [{ kind: 'name', value: 'Bartosz Nowak' }];
  await wrapped.generateText(text({ prompt: 'Anna Kowalska and Bartosz Nowak' }));

  assert.equal((seen[0]!.request as TextRequest).prompt.includes('anna.kowalska@example.com'), true);
  assert.equal((seen[1]!.request as TextRequest).prompt.includes('anna.kowalska@example.com'), false);
  assert.equal((seen[2]!.request as TextRequest).prompt, 'Anna Kowalska and [NAME_1]');
});

test('a call with no seeds is handed on as it came, whichever mode it is in', async () => {
  for (const mode of ['hosted', 'always'] as const) {
    const { wrapped, last } = masking(hosted, mode, () => []);
    const request = text();
    await wrapped.generateText(request);
    assert.equal(last(), request, mode);
  }
});

test('describe says what the gateway under it says', () => {
  const { wrapped } = masking(hosted);
  assert.deepEqual(wrapped.describe(), hosted);
});

/* ------------------------------------------------------------ what leaves */

test('a structured call has nothing of the person in what it sends, and the rest of it as it was', async () => {
  const { wrapped, last } = masking(hosted);
  const schema = z.object({ who: z.string() });

  const request: ObjectRequest<{ who: string }> = {
    ...call,
    runId: 'run',
    step: 'step',
    schema,
    system: 'Letter for Anna Kowalska',
    prompt: '{"email":"anna.kowalska@example.com"}',
    maxOutputTokens: 77,
    temperature: 0.3,
    maxRetries: 0,
    strictSchema: true
  };
  await wrapped.generateObject(request);

  const sentRequest = last() as ObjectRequest<{ who: string }>;
  assert.deepEqual(leaks(sentRequest), []);
  // And what it sent, for its log line to ask (`masking-counts.test.ts`).
  const { masked, ...rest } = sentRequest;
  assert.equal(typeof masked, 'function');
  assert.deepEqual({ ...rest, system: '', prompt: '' }, { ...request, system: '', prompt: '' });
  assert.equal(sentRequest.schema, schema);
  assert.equal(sentRequest.system, 'Letter for [NAME_1]');
  assert.equal(sentRequest.prompt, '{"email":"[EMAIL_1]"}');
});

test('the system text and the prompt are numbered as one, so that a placeholder means one thing', async () => {
  const { wrapped, last } = masking(hosted);
  await wrapped.generateText(text({ system: 'Anna', prompt: 'Anna and Kowalska and Anna' }));
  const request = last() as TextRequest;
  assert.equal(request.system, '[NAME_1]');
  assert.equal(request.prompt, '[NAME_1] and [NAME_2] and [NAME_1]');
});

test('a placeholder already in the prompt is not given to a value in the system text', async () => {
  const { wrapped, last } = masking(hosted);
  await wrapped.generateText(text({ system: 'Anna', prompt: 'the sample says [NAME_1]' }));
  const request = last() as TextRequest;
  assert.equal(request.system, '[NAME_2]');
  assert.equal(request.prompt, 'the sample says [NAME_1]');
});

test('a placeholder already in the prompt of a structured call is not given to a value in its system text', async () => {
  const { wrapped, last } = masking(hosted);
  await wrapped.generateObject({
    ...call,
    runId: 'run',
    step: 'step',
    schema: z.object({}),
    system: 'Anna',
    prompt: 'the sample says [NAME_1]',
    maxOutputTokens: 10
  });
  const request = last() as ObjectRequest<unknown>;
  assert.equal(request.system, '[NAME_2]');
  assert.equal(request.prompt, 'the sample says [NAME_1]');
});

test('a placeholder already in the history of a loop is not given to a value in its system text', async () => {
  const { wrapped, last } = masking(hosted);
  await wrapped.runToolLoop({
    ...call,
    system: 'Anna',
    prompt: 'go on',
    history: [{ role: 'user', text: 'the sample says [NAME_1]' }],
    tools: [],
    maxSteps: 1
  });
  const request = last() as ToolLoopRequest;
  assert.equal(request.system, '[NAME_2]');
  assert.deepEqual(request.history, [{ role: 'user', text: 'the sample says [NAME_1]' }]);
});

test('a tool loop has nothing of the person in its system text, its prompt or its history', async () => {
  const { wrapped, last } = masking(hosted);
  const request: ToolLoopRequest = {
    ...call,
    system: 'You answer for Anna Kowalska.',
    prompt: 'What is anna.kowalska@example.com doing?',
    history: [
      { role: 'user', text: 'Call me on +48 600 123 456' },
      { role: 'assistant', text: 'I will call Anna.' },
      { role: 'user', text: 'nothing in this one' }
    ],
    tools: [],
    maxSteps: 4
  };
  await wrapped.runToolLoop(request);

  const forwarded = last() as ToolLoopRequest;
  assert.deepEqual(leaks(forwarded), []);
  assert.deepEqual(forwarded.history, [
    { role: 'user', text: 'Call me on [PHONE_1]' },
    { role: 'assistant', text: 'I will call [NAME_2].' },
    { role: 'user', text: 'nothing in this one' }
  ]);
  assert.equal(forwarded.system, 'You answer for [NAME_1].');
  assert.equal(forwarded.prompt, 'What is [EMAIL_1] doing?');
  assert.equal(forwarded.maxSteps, 4);
});

test('a tool loop with no history is sent with none', async () => {
  const { wrapped, last } = masking(hosted);
  await wrapped.runToolLoop({ ...call, system: 's', prompt: 'Anna', tools: [], maxSteps: 1 });
  assert.equal('history' in (last() as object), false);
});

test('a tool loop with an empty history is sent with an empty one', async () => {
  const { wrapped, last } = masking(hosted);
  await wrapped.runToolLoop({ ...call, system: 's', prompt: 'Anna', history: [], tools: [], maxSteps: 1 });
  assert.deepEqual((last() as ToolLoopRequest).history, []);
});

test('nothing of the person is in what a model is sent, whatever the text around it', async () => {
  const awkward = [
    'Anna Kowalska',
    '"Anna Kowalska"',
    'ANNA KOWALSKA, anna kowalska, Anna-Kowalska',
    '{"name":"Anna Kowalska","contact":{"email":"ANNA.KOWALSKA@EXAMPLE.COM","phone":"600-123-456"}}',
    'line one\nAnna\nline three',
    '- Kowalska Anna (anna.kowalska@example.com)',
    '+48600123456',
    'https://linkedin.com/in/anna-kowalska/'
  ];

  for (const prompt of awkward) {
    const { wrapped, last } = masking(hosted);
    await wrapped.generateText(text({ system: prompt, prompt }));
    assert.deepEqual(leaks(last()), [], prompt);
  }
});

/* ------------------------------------------------------------ what returns */

test('an answer comes back with the placeholders in it put right', async () => {
  const fake = recording(() => hosted, { text: () => 'Dear [NAME_1], call [PHONE_1] or write to [EMAIL_1].' });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });

  const result = await wrapped.generateText(text());
  assert.equal(result.text, 'Dear Anna Kowalska, call +48 600 123 456 or write to anna.kowalska@example.com.');
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(result.usage, usage);
});

test('a structured answer comes back with every string in it put right', async () => {
  const fake = recording(() => hosted, {
    object: () => ({ who: '[NAME_1]', contact: ['[EMAIL_1]', { phone: '[PHONE_1]' }], n: 3, nothing: null })
  });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });

  const result = await wrapped.generateObject({
    ...call,
    schema: z.unknown(),
    system: 'Anna Kowalska',
    prompt: 'anna.kowalska@example.com and +48 600 123 456',
    maxOutputTokens: 10
  });

  assert.deepEqual(result.object, {
    who: 'Anna Kowalska',
    contact: ['anna.kowalska@example.com', { phone: '+48 600 123 456' }],
    n: 3,
    nothing: null
  });
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(result.usage, usage);
});

test('a streamed answer is put right fragment by fragment, and is what the whole answer says', async () => {
  const written = 'Dear [NAME_1], I will call [PHONE_1] soon. Best wishes, [NAME_1]';
  const fake = recording(() => hosted, { text: () => written });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });

  const fragments: string[] = [];
  const result = await wrapped.generateText(text({ onDelta: (fragment) => fragments.push(fragment) }));

  const expected = 'Dear Anna Kowalska, I will call +48 600 123 456 soon. Best wishes, Anna Kowalska';
  assert.equal(result.text, expected);
  assert.equal(fragments.join(''), expected);
  assert.ok(fragments.length > 3, 'it was streamed, not said at the end');
  assert.equal(fragments.some((fragment) => /\[NAME|NAME_1\]/.test(fragment)), false);
});

test('a fragment that waits for the rest of a placeholder is not lost when the call ends', async () => {
  const fake = recording(() => hosted, { text: () => 'ends with a [NAM' });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });

  const fragments: string[] = [];
  const result = await wrapped.generateText(text({ onDelta: (fragment) => fragments.push(fragment) }));

  assert.equal(result.text, 'ends with a [NAM');
  assert.equal(fragments.join(''), 'ends with a [NAM');
});

test('a streamed tool loop puts its fragments right, and loses nothing it held when it ends', async () => {
  const fake = recording(() => hosted, { loop: () => 'Dear [NAME_1], ends with a [NAM' });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });

  const fragments: string[] = [];
  const result = await wrapped.runToolLoop({
    ...call,
    system: 'Anna Kowalska',
    prompt: 'go',
    tools: [],
    maxSteps: 2,
    onDelta: (fragment) => fragments.push(fragment)
  });

  assert.equal(result.text, 'Dear Anna Kowalska, ends with a [NAM');
  assert.equal(fragments.join(''), 'Dear Anna Kowalska, ends with a [NAM');
  assert.equal(fragments.some((fragment) => fragment.includes('[NAME_1]')), false);
});

test('a sink that throws does not fail the call or lose the answer', async () => {
  const fake = recording(() => hosted, { text: () => 'Dear [NAME_1], hello there' });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });

  let calls = 0;
  const result = await wrapped.generateText(
    text({
      onDelta: () => {
        calls += 1;
        throw new Error('the window is closed');
      }
    })
  );

  assert.equal(result.text, 'Dear Anna Kowalska, hello there');
  assert.ok(calls > 1);
});

test('a call that is not streamed is sent with no sink, and one that is is sent one', async () => {
  const { wrapped, seen } = masking(hosted);
  await wrapped.generateText(text());
  await wrapped.generateText(text({ onDelta: () => undefined }));
  await wrapped.runToolLoop({ ...call, system: 's', prompt: 'p', tools: [], maxSteps: 1 });
  await wrapped.runToolLoop({ ...call, system: 's', prompt: 'p', tools: [], maxSteps: 1, onDelta: () => undefined });

  assert.deepEqual(
    seen.map((one) => typeof (one.request as { onDelta?: unknown }).onDelta),
    ['undefined', 'function', 'undefined', 'function']
  );
});

test('a tool loop answers with its text put right, and the rest of its result as it was', async () => {
  const fake = recording(() => hosted, { loop: () => 'It is [NAME_1].' });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });

  const fragments: string[] = [];
  const result = await wrapped.runToolLoop({
    ...call,
    system: 's',
    prompt: 'Anna Kowalska',
    tools: [],
    maxSteps: 3,
    onDelta: (fragment) => fragments.push(fragment)
  });

  assert.equal(result.text, 'It is Anna Kowalska.');
  assert.equal(fragments.join(''), 'It is Anna Kowalska.');
  assert.equal(result.steps, 2);
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(result.usage, usage);
});

test('a call that fails fails as it did, and says nothing more', async () => {
  const failing: AiGateway = stubGateway({
    describe: () => hosted,
    generateText: async () => {
      throw new RuntimeError('gpt: api.openai.com refused the call (HTTP 429).', 'model_call_failed');
    }
  });
  const wrapped = maskedGateway(failing, { mode: 'hosted', seeds: () => anna });

  await assert.rejects(
    wrapped.generateText(text()),
    (error: unknown) =>
      error instanceof RuntimeError
      && error.code === 'model_call_failed'
      && error.message === 'gpt: api.openai.com refused the call (HTTP 429).'
  );
});

/* ------------------------------------------------------------------- tools */

const handle = (
  invoke: (input: unknown) => Promise<unknown>,
  name = 'search_profile'
): ToolHandle => ({
  name,
  describe: 'Look something up.',
  inputSchema: z.object({ query: z.string() }),
  invoke
});

test('a tool is asked for what the model was given a name for, and not for the name', async () => {
  const asked: unknown[] = [];
  const tool = handle(async (input) => {
    asked.push(input);
    return { hits: [] };
  });

  const fake = recording(() => hosted, {
    loop: async (request) => {
      await request.tools[0]!.invoke({ query: 'jobs for [NAME_1] at [EMAIL_1]', nested: ['[PHONE_1]'], n: 2 });
      return 'done';
    }
  });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });

  await wrapped.runToolLoop({
    ...call,
    system: 's',
    prompt: 'Anna Kowalska, anna.kowalska@example.com, +48 600 123 456',
    tools: [tool],
    maxSteps: 3
  });

  assert.deepEqual(asked, [
    { query: 'jobs for Anna Kowalska at anna.kowalska@example.com', nested: ['+48 600 123 456'], n: 2 }
  ]);
});

test('what a tool returns is masked on its way to the model', async () => {
  const returned: unknown[] = [];
  const tool = handle(async () => ({
    hits: [{ text: 'Anna Kowalska, anna.kowalska@example.com' }, { text: 'nobody' }],
    count: 2,
    ok: true
  }));

  const fake = recording(() => hosted, {
    loop: async (request) => {
      returned.push(await request.tools[0]!.invoke({ query: 'x' }));
      return 'done';
    }
  });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });
  await wrapped.runToolLoop({ ...call, system: 's', prompt: 'Anna Kowalska', tools: [tool], maxSteps: 3 });

  assert.deepEqual(returned, [
    { hits: [{ text: '[NAME_1], [EMAIL_1]' }, { text: 'nobody' }], count: 2, ok: true }
  ]);
});

test('a tool result and the prompt number their values as one, so a placeholder means one thing', async () => {
  const tool = handle(async () => 'Kowalska and Anna');
  const returned: unknown[] = [];

  const fake = recording(() => hosted, {
    loop: async (request) => {
      returned.push(await request.tools[0]!.invoke({ query: 'x' }));
      return 'done';
    }
  });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });
  await wrapped.runToolLoop({ ...call, system: 's', prompt: 'Anna Kowalska, Anna', tools: [tool], maxSteps: 3 });

  const forwarded = fake.last() as ToolLoopRequest;
  assert.equal(forwarded.prompt, '[NAME_1], [NAME_2]');
  assert.deepEqual(returned, ['[NAME_3] and [NAME_2]']);
});

test('a tool is handed to the model with the name, the description and the schema it had', async () => {
  const tool = handle(async () => 'x', 'ask_something');
  const { wrapped, last } = masking(hosted);
  await wrapped.runToolLoop({ ...call, system: 's', prompt: 'Anna', tools: [tool, handle(async () => 'y', 'other')], maxSteps: 2 });

  const forwarded = (last() as ToolLoopRequest).tools;
  assert.deepEqual(forwarded.map((one) => one.name), ['ask_something', 'other']);
  assert.equal(forwarded[0]!.describe, 'Look something up.');
  assert.equal(forwarded[0]!.inputSchema, tool.inputSchema);
});

test('a tool that fails tells the model the failure with the person left out, and keeps its code', async () => {
  const failures: unknown[] = [];

  const run = async (tool: ToolHandle) => {
    const fake = recording(() => hosted, {
      loop: async (request) => {
        try {
          await request.tools[0]!.invoke({ query: '[NAME_1]' });
        } catch (error) {
          failures.push(error);
        }
        return 'done';
      }
    });
    const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });
    await wrapped.runToolLoop({ ...call, system: 's', prompt: 'Anna Kowalska', tools: [tool], maxSteps: 3 });
  };

  await run(handle(async (input) => {
    throw new RuntimeError(`No match for ${(input as { query: string }).query}.`, 'unreadable_source');
  }));
  await run(handle(async (input) => {
    throw new TypeError(`bad query ${(input as { query: string }).query}`);
  }));
  await run(handle(async () => {
    throw 'Anna Kowalska went wrong';
  }));

  const [first, second, third] = failures as Error[];
  assert.ok(first instanceof RuntimeError);
  assert.equal(first.code, 'unreadable_source');
  assert.equal(first.message, 'No match for [NAME_1].');
  assert.ok(second instanceof Error);
  assert.equal(second.name, 'TypeError');
  assert.equal(second.message, 'bad query [NAME_1]');
  assert.ok(third instanceof Error);
  assert.equal(third.message, '[NAME_1] went wrong');
});

test('a cancelled tool stays cancelled', async () => {
  let thrown: unknown;
  const fake = recording(() => hosted, {
    loop: async (request) => {
      try {
        await request.tools[0]!.invoke({ query: 'x' });
      } catch (error) {
        thrown = error;
      }
      return 'done';
    }
  });
  const wrapped = maskedGateway(fake.gateway, { mode: 'hosted', seeds: () => anna });
  await wrapped.runToolLoop({
    ...call,
    system: 's',
    prompt: 'Anna',
    tools: [handle(async () => { throw new RuntimeError('The call was cancelled.', 'aborted'); })],
    maxSteps: 1
  });

  assert.ok(thrown instanceof RuntimeError);
  assert.equal(thrown.code, 'aborted');
});

test('a tool on a call that is not masked is the tool it was', async () => {
  const tool = handle(async () => 'Anna Kowalska');
  const { wrapped, last } = masking(local);
  await wrapped.runToolLoop({ ...call, system: 's', prompt: 'Anna', tools: [tool], maxSteps: 1 });
  assert.equal((last() as ToolLoopRequest).tools[0], tool);
});

/* ------------------------------------------------------------------- stays */

test('an image is handed on as it came, and what comes back is not changed', async () => {
  const { wrapped, seen } = masking(hosted);

  const image = { ...call, bytes: new Uint8Array([1]), mediaType: 'image/png', instruction: 'Anna Kowalska', maxOutputTokens: 5 };

  const read = await wrapped.transcribeImage(image);

  assert.equal(seen[0]!.request, image);
  assert.equal(read.text, 'Anna Kowalska on a page');
});

test('a call under a mode that masks nothing sends the very request it was given', async () => {
  const { wrapped, last } = masking(local, 'hosted');
  const request: ToolLoopRequest = { ...call, system: 'Anna', prompt: 'Anna', tools: [], maxSteps: 1 };
  await wrapped.runToolLoop(request);
  assert.equal(last(), request);

  const object: ObjectRequest<unknown> = { ...call, schema: z.unknown(), system: 'Anna', prompt: 'Anna', maxOutputTokens: 1 };
  await wrapped.generateObject(object);
  assert.equal(last(), object);
});

test('a request with nothing in it to mask goes with its texts as they were', async () => {
  const { wrapped, last } = masking(hosted);
  await wrapped.generateText(text({ system: 'You write letters.', prompt: 'Write a letter.' }));
  const request = last() as TextRequest;
  assert.equal(request.system, 'You write letters.');
  assert.equal(request.prompt, 'Write a letter.');
});
