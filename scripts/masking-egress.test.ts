/**
 * What is on the wire when a model that is not on the machine is called.
 *
 * `masking-gateway.test.ts` holds the wrapper to what it hands the gateway under
 * it. This holds the whole of it to what a provider is sent: the real gateway and
 * the real SDK under the wrapper, a `fetch` that is the network, and every byte of
 * every request read back. A value that is in a request body is a value that left
 * the machine, and nothing weaker than reading the body proves it did not.
 *
 *   on the wire    the body of each of the four calls that carry text, and the
 *                  message that carries a tool's result back to the model
 *   coming back    a streamed answer cut in the middle of a placeholder, an object,
 *                  and what a tool is asked for when the model names a placeholder
 *   local          a call to a model on this machine under `hosted` is sent as it
 *                  always was, so the check above is not true of everything
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 50 were applied: 50 fail at least one test here, and 0 cannot be told from the original.
 *
 * src/effects/detect.ts:
 *   a NIP needs no label                                     1
 *   a handle needs no network before it                      1
 *
 * src/effects/mask.ts:
 *   a vault gives the later span when two begin together     7
 *   a vault takes a span that begins where another ends      2
 *   a text with a shape in it is returned as it was          7
 *   ł is not folded                                          1
 *   Ł is not folded                                          1
 *   accents are kept in the folded copy                      1
 *   each word of a name is not taken alone                   6
 *   the whole name is not taken as one                       6
 *   a phone number is not taken with its sign                5
 *   a phone number has no separators                         6
 *   the shorter value is tried first                         6
 *   patterns are not sorted                                  2
 *   the matcher is case sensitive in the original too        7
 *   placeholders are numbered across kinds                   5
 *   the number of a placeholder starts from zero             7
 *   a placeholder is not put right                           7
 *   an array is not walked                                   1
 *   an object is not walked                                  2
 *   a vault with seeds is reported empty                     7
 *   a match is replaced by the folded text                   6
 *   a fragment is not held back                              2
 *   everything after a bracket is held                       2
 *   what is settled is not put right                         2
 *   what is held is held again after a flush                 2
 *
 * src/effects/masking.ts:
 *   a call is never masked                                   7
 *   a call is always masked                                  1
 *   hosted masks the local provider                          7
 *   always masks only what hosted does                       1
 *   a structured call keeps its system text                  1
 *   a structured call keeps its prompt                       1
 *   a structured answer is not put right                     1
 *   a structured answer is put right at its top level only   1
 *   a text call keeps its system text                        4
 *   a text call keeps its prompt                             4
 *   a text answer is not put right                           4
 *   a text call is not streamed through the restorer         1
 *   a text call streams what it was given, unrestored        1
 *   a loop keeps its system text                             2
 *   a loop keeps its prompt                                  2
 *   a loop keeps its history                                 1
 *   a loop does not wrap its tools                           1
 *   a loop answer is not put right                           2
 *   a loop is not streamed through the restorer              1
 *   a loop does not restore its stream, only holds it        1
 *   what a tool is asked is not put right                    1
 *   what a tool is asked is put right at its top level only  1
 *   what a tool answers is not masked                        1
 *   what a tool answers is masked at its top level only      1
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { AiGateway, MaskMode, MaskSeed, ToolHandle } from '../src/contracts/index.js';
import { createAiGateway } from '../src/effects/ai.js';
import { maskedGateway } from '../src/effects/masking.js';
import { createModelResolver } from '../src/providers/resolve.js';

const anna: readonly MaskSeed[] = [
  { kind: 'name', value: 'Anna Kowalska' },
  { kind: 'email', value: 'anna.kowalska@example.com' },
  { kind: 'phone', value: '+48 600 123 456' },
  { kind: 'link', value: 'https://www.linkedin.com/in/anna-kowalska' }
];

const everything = [
  'Anna Kowalska',
  'Kowalska',
  'Anna',
  'anna.kowalska@example.com',
  '+48 600 123 456',
  '600 123 456',
  'linkedin.com/in/anna-kowalska'
];

type Wire = { readonly url: string; readonly body: string };

const completion = (message: Record<string, unknown>, finish = 'stop'): Response =>
  new Response(
    JSON.stringify({
      id: 'cmpl',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

const streaming = (fragments: readonly string[]): Response => {
  const chunk = (delta: Record<string, unknown>, finish: string | null = null): string =>
    `data: ${JSON.stringify({
      id: 'cmpl',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'm',
      choices: [{ index: 0, delta, finish_reason: finish }]
    })}\n\n`;

  const body =
    chunk({ role: 'assistant', content: '' })
    + fragments.map((fragment) => chunk({ content: fragment })).join('')
    + chunk({}, 'stop')
    + 'data: [DONE]\n\n';

  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

/** The network: records every request and answers each in turn. */
const withNetwork = async (
  answers: readonly ((request: Wire) => Response)[],
  run: (wire: Wire[]) => Promise<void>
): Promise<void> => {
  const wire: Wire[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }): Promise<Response> => {
    const request: Wire = {
      url: typeof input === 'string' ? input : (input as { url?: string }).url ?? String(input),
      body: typeof init?.body === 'string' ? init.body : ''
    };
    wire.push(request);
    const answer = answers[wire.length - 1];
    if (answer === undefined) throw new Error(`an unexpected request to ${request.url}`);
    return answer(request);
  }) as typeof globalThis.fetch;

  try {
    await run(wire);
  } finally {
    globalThis.fetch = real;
  }
};

const silent = { record: () => undefined };
const call = { traceId: 'trace', signal: new AbortController().signal };

/** The real gateway, over the provider the environment names, wrapped as a run's is. */
const gatewayFor = (
  env: Readonly<Record<string, string>>,
  mode: MaskMode = 'hosted',
  seeds: readonly MaskSeed[] = anna
): AiGateway =>
  maskedGateway(createAiGateway({ resolver: createModelResolver({ env }), logger: silent }), {
    mode,
    seeds: () => seeds
  });

const openrouter = { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-not-a-real-key' };
const onThisMachine = { AI_PROVIDER: 'local' };

const leaked = (wire: readonly Wire[]): string[] =>
  wire.flatMap((request) => everything.filter((value) => request.body.toLowerCase().includes(value.toLowerCase())));

const knows = {
  system: 'You write for Anna Kowalska. Reach her at anna.kowalska@example.com or +48 600 123 456.',
  prompt: 'Her profile is linkedin.com/in/anna-kowalska. Kowalska has ten years of experience. Anna prefers email.'
};

/* ------------------------------------------------------------------ on the wire */

test('a text call to a hosted provider has nothing of the person in the request', async () => {
  await withNetwork([() => completion({ content: 'Dear [NAME_1], call [PHONE_1].' })], async (wire) => {
    const result = await gatewayFor(openrouter).generateText({ ...call, ...knows, maxOutputTokens: 50, maxRetries: 0 });

    assert.equal(wire.length, 1);
    assert.match(wire[0]!.url, /openrouter\.ai/);
    assert.deepEqual(leaked(wire), []);
    assert.match(wire[0]!.body, /\[NAME_\d\]/);
    assert.match(wire[0]!.body, /\[EMAIL_1\]/);
    assert.equal(result.text, 'Dear Anna Kowalska, call +48 600 123 456.');
  });
});

test('a structured call to a hosted provider has nothing of the person in the request, and gets the object back whole', async () => {
  await withNetwork(
    [() => completion({ content: JSON.stringify({ who: '[NAME_1]', reach: ['[EMAIL_1]', '[PHONE_1]'] }) })],
    async (wire) => {
      const result = await gatewayFor(openrouter).generateObject({
        ...call,
        ...knows,
        schema: z.object({ who: z.string(), reach: z.array(z.string()) }),
        maxOutputTokens: 50,
        maxRetries: 0
      });

      assert.deepEqual(leaked(wire), []);
      assert.deepEqual(result.object, {
        who: 'Anna Kowalska',
        reach: ['anna.kowalska@example.com', '+48 600 123 456']
      });
    }
  );
});

test('a streamed call to a hosted provider has nothing of the person in the request, and is put right as it arrives', async () => {
  const fragments = ['Dear [NA', 'ME_1], I will c', 'all [PHONE', '_1] ', 'soon. Bes', 't, [N', 'AME_1]'];

  await withNetwork([() => streaming(fragments)], async (wire) => {
    const arrived: string[] = [];
    const result = await gatewayFor(openrouter).generateText({
      ...call,
      ...knows,
      maxOutputTokens: 50,
      maxRetries: 0,
      onDelta: (fragment) => arrived.push(fragment)
    });

    const expected = 'Dear Anna Kowalska, I will call +48 600 123 456 soon. Best, Anna Kowalska';
    assert.deepEqual(leaked(wire), []);
    assert.equal(result.text, expected);
    assert.equal(arrived.join(''), expected);
    assert.ok(arrived.length >= 4, 'it arrived in pieces');
    assert.ok(arrived.every((piece) => !piece.includes('[')), 'no piece of a placeholder is shown');
  });
});

test('a tool loop to a hosted provider keeps the person out of every request in it, the tool results included', async () => {
  const asked: unknown[] = [];
  const lookup: ToolHandle = {
    name: 'lookup',
    describe: 'Look a person up.',
    inputSchema: z.object({ query: z.string() }),
    invoke: async (input) => {
      asked.push(input);
      return { found: 'Anna Kowalska <anna.kowalska@example.com>, +48 600 123 456, Warsaw' };
    }
  };

  await withNetwork(
    [
      () =>
        completion(
          {
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"query":"[NAME_1] in Warsaw"}' } }
            ]
          },
          'tool_calls'
        ),
      () => completion({ content: 'It is [NAME_1], reachable on [PHONE_1].' })
    ],
    async (wire) => {
      const result = await gatewayFor(openrouter).runToolLoop({
        ...call,
        ...knows,
        history: [
          { role: 'user', text: 'Who is Anna Kowalska?' },
          { role: 'assistant', text: 'A candidate; her email is anna.kowalska@example.com.' }
        ],
        tools: [lookup],
        maxSteps: 4
      });

      assert.equal(wire.length, 2, 'one request for the tool call and one for the answer after it');
      assert.deepEqual(leaked(wire), []);
      assert.match(wire[1]!.body, /\[NAME_\d\]/, 'the tool result is in the second request, masked');
      assert.deepEqual(asked, [{ query: 'Anna Kowalska in Warsaw' }]);
      assert.equal(result.text, 'It is Anna Kowalska, reachable on +48 600 123 456.');
    }
  );
});

test('a tool loop to a hosted provider that is streamed is put right as it arrives', async () => {
  await withNetwork([() => streaming(['Her phone ', 'is [PHO', 'NE_1].'])], async (wire) => {
    const arrived: string[] = [];
    const result = await gatewayFor(openrouter).runToolLoop({
      ...call,
      ...knows,
      tools: [],
      maxSteps: 2,
      onDelta: (fragment) => arrived.push(fragment)
    });

    assert.deepEqual(leaked(wire), []);
    assert.equal(result.text, 'Her phone is +48 600 123 456.');
    assert.equal(arrived.join(''), 'Her phone is +48 600 123 456.');
  });
});

test('a value in another case or without its accents is not on the wire either, and each spelling comes back as it was written', async () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'name', value: 'Łukasz Żółć' }];

  await withNetwork([() => completion({ content: 'Hello [NAME_1], and [NAME_2], and [NAME_3]' })], async (wire) => {
    const result = await gatewayFor(openrouter, 'hosted', seeds).generateText({
      ...call,
      system: 'ŁUKASZ ŻÓŁĆ',
      prompt: 'lukasz zolc wrote: "Łukasz Żółć"',
      maxOutputTokens: 20,
      maxRetries: 0
    });

    assert.doesNotMatch(wire[0]!.body.toLowerCase(), /łukasz|lukasz|żółć|zolc/);
    assert.equal(result.text, 'Hello ŁUKASZ ŻÓŁĆ, and lukasz zolc, and Łukasz Żółć');
  });
});

/* ------------------------------------------------------------------------ local */

test('a call to a model on this machine under hosted is sent as it always was', async () => {
  await withNetwork([() => completion({ content: 'fine' })], async (wire) => {
    await gatewayFor(onThisMachine).generateText({ ...call, ...knows, maxOutputTokens: 50, maxRetries: 0 });

    assert.match(wire[0]!.url, /localhost:11434/);
    assert.ok(wire[0]!.body.includes('Anna Kowalska'));
    assert.ok(wire[0]!.body.includes('anna.kowalska@example.com'));
    assert.ok(wire[0]!.body.includes('+48 600 123 456'));
    assert.equal(wire[0]!.body.includes('[NAME_'), false);
  });
});

test('a call to a model on this machine under always has nothing of the person in the request', async () => {
  await withNetwork([() => completion({ content: 'Dear [NAME_1]' })], async (wire) => {
    const result = await gatewayFor(onThisMachine, 'always').generateText({
      ...call,
      ...knows,
      maxOutputTokens: 50,
      maxRetries: 0
    });

    assert.match(wire[0]!.url, /localhost:11434/);
    assert.deepEqual(leaked(wire), []);
    assert.equal(result.text, 'Dear Anna Kowalska');
  });
});

test('a person with nothing on their CV to keep is sent exactly what everyone else is', async () => {
  await withNetwork([() => completion({ content: 'fine' })], async (wire) => {
    await gatewayFor(openrouter, 'hosted', []).generateText({ ...call, ...knows, maxOutputTokens: 50, maxRetries: 0 });
    assert.ok(wire[0]!.body.includes('Anna Kowalska'));
  });
});
