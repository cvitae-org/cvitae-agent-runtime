/**
 * Identifiers found by their shape, kept out of a hosted model's requests.
 *
 * `mask-detect.test.ts` holds the detectors to what they take. This holds what
 * the vault and the gateway do with it: the placeholders it makes, what wins when
 * a seed and a shape take the same text, that the answer is put back exactly, and
 * that the bytes of a request to a provider are what was meant.
 *
 *   in the vault    a vault with the detectors on has no seeds to need and still
 *                   masks; off, as it was; the kinds are numbered each their own
 *                   way; the same value is the same placeholder; a seed and a
 *                   shape over the same text are one placeholder, and the seed's
 *                   when the two are not the same kind
 *   round trip      `restore(mask(x))` is `x` for text of every sort here, in
 *                   every cut a stream can be cut at, in an object, and when the
 *                   text already holds something placeholder-shaped
 *   on the wire     the real gateway and the real SDK, a `fetch` that is the
 *                   network, and every byte of every request read back: the email
 *                   of a referee, a PESEL, a NIP, an IBAN, a date of birth and a
 *                   profile are not in a request to a hosted provider, a text with
 *                   none of them is sent byte for byte as it was without the
 *                   detectors, and a model on this machine is sent what it was
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 73 were applied: 73 fail at least one test here, and 0 cannot be told from the original.
 *
 * src/effects/detect.ts:
 *   the weights of a PESEL are not the ones it has                    1
 *   the weights of a NIP are not the ones it has                      8
 *   the country and check digits of an IBAN are not moved to the end  1
 *   the remainder of an IBAN is zero                                  6
 *   a letter is one less in an IBAN                                   6
 *   a date with its year first is not told from one with it last      1
 *   a date with its month in words is read as numbers                 7
 *   the year of a date with a month in words is the first number      7
 *   a date with a month in words has no year                          7
 *   the month word listopada is not known                             7
 *   the birth label born is not known                                 8
 *   a label and its date need no colon                                7
 *   a date may not be parted by dots                                  1
 *   a Polish number has ten digits after its code                     8
 *   a Polish number has eight digits after its code                   4
 *   a number is cut one digit late                                    8
 *   a NIP needs no label                                              1
 *   a NIP in the layout of three, three, two and two is not read      1
 *   an IBAN may not have spaces                                       1
 *   the name of an address may not have a dot                         10
 *   every address is a file                                           15
 *   a LinkedIn profile is not one                                     6
 *   a LinkedIn profile may not be called in                           6
 *   a GitHub profile is not one                                       1
 *   a profile is taken without its scheme                             3
 *   a profile is taken without its country                            6
 *   a profile name may end in a dot                                   1
 *   a profile has no path                                             1
 *   a handle needs no network before it                               1
 *   a detector is not run when its guard fails to find                17
 *   what a detector found is not passed on                            17
 *   the fit of a detector is ignored                                  2
 *   a detector with no fit finds nothing                              7
 *   an empty span is a span                                           2
 *   the kinds are not the detector's                                  16
 *   the email detector finds nothing                                  15
 *   the profile detector finds nothing                                7
 *   the phone with country code detector finds nothing                8
 *   the pesel detector finds nothing                                  11
 *   the nip by its layout detector finds nothing                      1
 *   the iban detector finds nothing                                   1
 *   the date of birth detector finds nothing                          8
 *   the email detector names what it finds wrongly                    15
 *   the profile detector names what it finds wrongly                  3
 *   the phone with country code detector names what it finds wrongly  7
 *   the pesel detector names what it finds wrongly                    9
 *   the nip with a label detector names what it finds wrongly         6
 *   the nip by its layout detector names what it finds wrongly        1
 *   the iban detector names what it finds wrongly                     6
 *   the date of birth detector names what it finds wrongly            7
 *
 * src/effects/mask.ts:
 *   a vault with no seeds is empty whether or not it detects          6
 *   a vault that does not detect is not empty when it has no seeds    6
 *   a vault with no seeds returns the text before it detects          12
 *   a vault detects when it was not asked to                          2
 *   a vault never detects                                             17
 *   a vault detects what a seed has already taken, first              1
 *   a vault gives the shorter span when two begin together            1
 *   a vault gives the later span when two begin together              15
 *   a vault takes a span that begins where another ends               10
 *   a vault takes a span that begins inside another                   11
 *   a vault does not move on past a span it took                      11
 *   an identifier is called a name                                    10
 *   an identifier is called something else                            9
 *   a date of birth is called something else                          6
 *   a date of birth is called a name                                  7
 *   a detected span is counted twice                                  4
 *   a text with a shape in it is returned as it was                   17
 *
 * src/effects/masking.ts:
 *   the gateway never detects                                         6
 *   the gateway always detects                                        1
 *   the gateway detects when it is not asked either way               1
 *   every call asks where it embeds                                   5
 *   the two are swapped                                               5
 *   a mode that is a word is called                                   9
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { AiGateway, MaskMode, MaskSeed, ToolHandle } from '../src/contracts/index.js';
import { createAiGateway } from '../src/effects/ai.js';
import { createVault } from '../src/effects/mask.js';
import { maskedGateway } from '../src/effects/masking.js';
import { createModelResolver } from '../src/providers/resolve.js';

const on = { detect: true };

/** Everything of a referee a posting or a pasted CV can carry, in one line each. */
const referee = {
  email: 'jan.nowak@example.com',
  phone: '+48 600 700 800',
  pesel: '44051401359',
  nip: '123-456-32-18',
  iban: 'PL61 1090 1014 0000 0712 1981 2874',
  born: '3 listopada 1990',
  profile: 'linkedin.com/in/jan-nowak'
};

const sentence = [
  `Referee: write to ${referee.email} or call ${referee.phone}.`,
  `PESEL ${referee.pesel}, NIP: ${referee.nip}, account ${referee.iban}.`,
  `Born: ${referee.born}. Profile: https://www.${referee.profile}`
].join(' ');

const values = Object.values(referee);

/* ----------------------------------------------------------------- the vault */

test('a vault with the detectors on is not empty when it has no seeds, and off it is', () => {
  assert.equal(createVault([], on).empty, false);
  assert.equal(createVault([]).empty, true);
  assert.equal(createVault([], { detect: false }).empty, true);
  assert.equal(createVault([{ kind: 'name', value: 'Anna Kowalska' }]).empty, false);
});

test('a vault with the detectors off takes only its seeds, whatever else is in the text', () => {
  const vault = createVault([{ kind: 'name', value: 'Anna Kowalska' }]);

  assert.equal(vault.mask(`Anna Kowalska, ${sentence}`), `[NAME_1], ${sentence}`);
  assert.equal(vault.replaced(), 1);
});

test('a vault with the detectors on and no seeds takes each kind of identifier whole', () => {
  const vault = createVault([], on);
  const masked = vault.mask(sentence);

  assert.equal(
    masked,
    'Referee: write to [EMAIL_1] or call [PHONE_1]. PESEL [ID_1], NIP: [ID_2], account [ID_3]. Born: [DOB_1]. Profile: [LINK_1]'
  );
  for (const value of values) assert.equal(masked.includes(value), false, value);
  assert.equal(vault.replaced(), 7);
});

test('what has no shape of an identifier is left exactly as it was', () => {
  const vault = createVault([], on);
  const posting = [
    'Senior Backend Engineer, 2018 - 2023, Warszawa. Node.js 20, TypeScript 5.4.',
    '18 000 - 24 000 PLN brutto, 26 dni urlopu, 5+ lat doświadczenia, order 12345678901.'
  ].join('\n');

  assert.equal(vault.mask(posting), posting);
  assert.equal(vault.replaced(), 0);
});

test('each kind is numbered from one, on its own', () => {
  const vault = createVault([], on);
  const masked = vault.mask('a@example.com +48 600 700 800 b@example.com 44051401359 c@example.org 123-456-32-18 born 3.11.1990');

  assert.equal(masked, '[EMAIL_1] [PHONE_1] [EMAIL_2] [ID_1] [EMAIL_3] [ID_2] born [DOB_1]');
});

test('the same value is the same placeholder, in the same call and in the next text of it', () => {
  const vault = createVault([], on);

  assert.equal(vault.mask('jan@example.com and jan@example.com'), '[EMAIL_1] and [EMAIL_1]');
  assert.equal(vault.mask('again: jan@example.com, and b@example.com'), 'again: [EMAIL_1], and [EMAIL_2]');
  assert.equal(vault.replaced(), 4);
});

test('the same value spelled another way is another placeholder, and each comes back as it was written', () => {
  const vault = createVault([], on);
  const masked = vault.mask('JAN@EXAMPLE.COM and jan@example.com');

  assert.equal(masked, '[EMAIL_1] and [EMAIL_2]');
  assert.equal(vault.restore(masked), 'JAN@EXAMPLE.COM and jan@example.com');
});

test('a seed and a shape over the same text are one placeholder, and a seed over part of a shape does not cut it', () => {
  const vault = createVault(
    [
      { kind: 'email', value: 'anna@example.com' },
      { kind: 'name', value: 'Nowak' }
    ],
    on
  );

  assert.equal(vault.mask('anna@example.com'), '[EMAIL_1]');
  // "nowak" is a whole word in the address, and the address is longer, and is the one taken.
  assert.equal(vault.mask('jan.nowak@example.com'), '[EMAIL_2]');
  assert.equal(vault.mask('Jan Nowak, jan.nowak@example.com'), 'Jan [NAME_1], [EMAIL_2]');
  assert.equal(vault.restore('Jan [NAME_1], [EMAIL_2]'), 'Jan Nowak, jan.nowak@example.com');
});

test('where a seed and a shape take the same text but not as the same kind, the seed says what it is', () => {
  // A name field that holds an address is as likely as it sounds.
  const vault = createVault([{ kind: 'name', value: 'jan@example.com' }], on);

  assert.equal(vault.mask('write to jan@example.com'), 'write to [NAME_1]');
});

test('where a seed and a shape begin together, the longer is taken, and the seed is not left in front of it', () => {
  // "jan" is a whole word at the start of the address, and the address is longer.
  const vault = createVault([{ kind: 'name', value: 'Jan' }], on);

  assert.equal(vault.mask('write to jan.nowak@example.com'), 'write to [EMAIL_1]');
  assert.equal(vault.restore('write to [EMAIL_1]'), 'write to jan.nowak@example.com');
  assert.equal(vault.mask('Jan wrote'), '[NAME_1] wrote');
});

test('where a shape begins earlier than a seed, the shape is taken and the seed is not cut out of it', () => {
  const vault = createVault([{ kind: 'name', value: 'Anna Kowalska' }], on);

  assert.equal(
    vault.mask('https://github.com/anna-kowalska/cv and Anna Kowalska'),
    '[LINK_1] and [NAME_1]'
  );
});

test('a placeholder that is already in the text is not issued again for a shape', () => {
  const vault = createVault([], on);
  const text = 'ids [ID_1] and 44051401359 and [EMAIL_1] and jan@example.com';
  const masked = vault.mask(text);

  assert.equal(masked, 'ids [ID_1] and [ID_2] and [EMAIL_1] and [EMAIL_2]');
  assert.equal(vault.restore(masked), text);
});

test('masking what is already masked changes nothing', () => {
  const vault = createVault([], on);
  const once = vault.mask(sentence);

  assert.equal(vault.mask(once), once);
});

test('an object is masked in its keys and its values, and what is not text is left', () => {
  const vault = createVault([], on);
  const value = {
    [referee.email]: [referee.phone, { nested: `PESEL ${referee.pesel}` }],
    number: 44051401359,
    flag: true,
    nothing: null
  };

  const masked = vault.maskDeep(value);
  assert.deepEqual(masked, {
    '[EMAIL_1]': ['[PHONE_1]', { nested: 'PESEL [ID_1]' }],
    number: 44051401359,
    flag: true,
    nothing: null
  });
  assert.deepEqual(vault.restoreDeep(masked), value);
});

test('what is replaced is counted once for each place it stood', () => {
  const vault = createVault([{ kind: 'name', value: 'Anna Kowalska' }], on);
  vault.mask('Anna Kowalska wrote from jan@example.com, jan@example.com and 44051401359');

  assert.equal(vault.replaced(), 4);
});

/* ------------------------------------------------------------------ round trip */

const TEXTS: readonly string[] = [
  sentence,
  'ŁUKASZ@EXAMPLE.COM, tel. +48 600 700 800, zam. 12345678901, ur. 03/11/1990, żółć',
  'two lines\n+1 (555) 123-4567\n(22) 123 45 67\n',
  'GB82 WEST 1234 5698 7654 32 and PL61109010140000071219812874 and 61 1090 1014 0000 0712 1981 2874',
  'github.com/annak/cv-tools, x.com/annak, twitter: @anna_k, medium.com/@annak',
  'nothing to find: 3.11.2, 2018 - 2023, 123 456 789 PLN',
  '[ID_1] [DOB_1] [EMAIL_9] and 44051401359',
  ''
];

for (const [index, text] of TEXTS.entries()) {
  test(`round trip: text ${index + 1} comes back exactly`, () => {
    const vault = createVault([], on);

    assert.equal(vault.restore(vault.mask(text)), text);
  });
}

test('round trip: with seeds as well, the same', () => {
  const seeds: readonly MaskSeed[] = [
    { kind: 'name', value: 'Łukasz Żółć' },
    { kind: 'email', value: 'lukasz@example.com' }
  ];

  for (const text of TEXTS) {
    // A call is one vault, and a call has noted what its text holds before it masks any of it.
    const vault = createVault(seeds, on);
    const said = `Łukasz Żółć <lukasz@example.com>: ${text}`;
    vault.reserve(said);

    assert.equal(vault.restore(vault.mask(said)), said);
  }
});

test('round trip: a stream cut at every point comes back exactly, and no piece of a placeholder is shown', () => {
  const vault = createVault([], on);
  const masked = vault.mask(sentence);

  for (let cut = 0; cut <= masked.length; cut += 1) {
    const shown: string[] = [];
    const restorer = vault.restorer((text) => shown.push(text));
    restorer.push(masked.slice(0, cut));
    restorer.push(masked.slice(cut));
    restorer.end();

    assert.equal(shown.join(''), sentence, `cut at ${cut}`);
    assert.ok(shown.every((piece) => !piece.includes('[')), `cut at ${cut}`);
  }
});

test('round trip: a stream a character at a time comes back exactly', () => {
  const vault = createVault([], on);
  const masked = vault.mask(sentence);
  const shown: string[] = [];
  const restorer = vault.restorer((text) => shown.push(text));

  for (const char of masked) restorer.push(char);
  restorer.end();

  assert.equal(shown.join(''), sentence);
});

test('round trip: what the model made of a placeholder it was given is put back in any case', () => {
  const vault = createVault([], on);
  vault.mask(sentence);

  assert.equal(vault.restore('see [id_1], [Id_2] and [ DOB_1 ]'), `see ${referee.pesel}, ${referee.nip} and ${referee.born}`);
  assert.equal(vault.restore('[ID_99] was never issued'), '[ID_99] was never issued');
});

/* ----------------------------------------------------------------- on the wire */

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

const withNetwork = async (
  answers: readonly ((request: Wire) => Response)[],
  run: (wire: Wire[]) => Promise<void>
): Promise<void> => {
  const wire: Wire[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }): Promise<Response> => {
    const request: Wire = {
      url: typeof input === 'string' ? input : ((input as { url?: string }).url ?? String(input)),
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

/** The real gateway, over the provider the environment names, wrapped as a run's is, with or without the detectors. */
const gatewayFor = (
  env: Readonly<Record<string, string>>,
  options: { readonly mode?: MaskMode; readonly seeds?: readonly MaskSeed[]; readonly detect?: boolean } = {}
): AiGateway =>
  maskedGateway(createAiGateway({ resolver: createModelResolver({ env }), logger: silent }), {
    mode: options.mode ?? 'hosted',
    seeds: () => options.seeds ?? [],
    ...(options.detect === false ? {} : { detect: true })
  });

const openrouter = { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-not-a-real-key' };
const onThisMachine = { AI_PROVIDER: 'local' };

const leaked = (wire: readonly Wire[]): string[] =>
  wire.flatMap((request) => values.filter((value) => request.body.toLowerCase().includes(value.toLowerCase())));

const knows = {
  system: `You write to referees. One is ${referee.email}, phone ${referee.phone}.`,
  prompt: `PESEL ${referee.pesel}. NIP: ${referee.nip}. Account ${referee.iban}. Born: ${referee.born}. Profile: https://www.${referee.profile}.`
};

test('a text call to a hosted provider, with no seeds at all, has no identifier of a stranger in the request', async () => {
  await withNetwork([() => completion({ content: 'Dear [EMAIL_1], [PHONE_1], [ID_1], [DOB_1], [LINK_1].' })], async (wire) => {
    const result = await gatewayFor(openrouter).generateText({ ...call, ...knows, maxOutputTokens: 50, maxRetries: 0 });

    assert.equal(wire.length, 1);
    assert.match(wire[0]!.url, /openrouter\.ai/);
    assert.deepEqual(leaked(wire), []);
    for (const placeholder of ['[EMAIL_1]', '[PHONE_1]', '[ID_1]', '[ID_2]', '[ID_3]', '[DOB_1]', '[LINK_1]']) {
      assert.ok(wire[0]!.body.includes(placeholder), placeholder);
    }
    assert.equal(result.text, `Dear ${referee.email}, ${referee.phone}, ${referee.pesel}, ${referee.born}, https://www.${referee.profile}.`);
  });
});

test('a structured call has no identifier in the request and gets the object back whole', async () => {
  await withNetwork(
    [() => completion({ content: JSON.stringify({ who: '[EMAIL_1]', ids: ['[ID_1]', '[ID_2]'], born: '[DOB_1]' }) })],
    async (wire) => {
      const result = await gatewayFor(openrouter).generateObject({
        ...call,
        ...knows,
        schema: z.object({ who: z.string(), ids: z.array(z.string()), born: z.string() }),
        maxOutputTokens: 50,
        maxRetries: 0
      });

      assert.deepEqual(leaked(wire), []);
      assert.deepEqual(result.object, { who: referee.email, ids: [referee.pesel, referee.nip], born: referee.born });
    }
  );
});

test('a streamed call, cut inside a placeholder of an identifier, is put right as it arrives', async () => {
  const fragments = ['Write to [EMA', 'IL_1], her PESEL [I', 'D_1] and her birth da', 'te [DOB', '_1]. Best.'];

  await withNetwork([() => streaming(fragments)], async (wire) => {
    const arrived: string[] = [];
    const result = await gatewayFor(openrouter).generateText({
      ...call,
      ...knows,
      maxOutputTokens: 50,
      maxRetries: 0,
      onDelta: (fragment) => arrived.push(fragment)
    });

    const expected = `Write to ${referee.email}, her PESEL ${referee.pesel} and her birth date ${referee.born}. Best.`;
    assert.deepEqual(leaked(wire), []);
    assert.equal(result.text, expected);
    assert.equal(arrived.join(''), expected);
    assert.ok(arrived.every((piece) => !piece.includes('[')), 'no piece of a placeholder is shown');
  });
});

test('a tool loop keeps the identifiers out of every request, and what a tool returns is masked on its way back', async () => {
  const asked: unknown[] = [];
  const lookup: ToolHandle = {
    name: 'lookup',
    describe: 'Look something up.',
    inputSchema: z.object({ query: z.string() }),
    invoke: async (input) => {
      asked.push(input);
      return { found: `Another referee: ${'ewa.kowal@example.org'}, PESEL 02070803628` };
    }
  };

  await withNetwork(
    [
      () =>
        completion(
          {
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"query":"who is [EMAIL_1]"}' } }
            ]
          },
          'tool_calls'
        ),
      () => completion({ content: 'It is [EMAIL_1], and the other is [EMAIL_2] with [ID_4].' })
    ],
    async (wire) => {
      const result = await gatewayFor(openrouter).runToolLoop({
        ...call,
        ...knows,
        history: [{ role: 'user', text: `Who is ${referee.email}?` }],
        tools: [lookup],
        maxSteps: 4
      });

      assert.equal(wire.length, 2);
      assert.deepEqual(leaked(wire), []);
      assert.equal(wire[1]!.body.includes('ewa.kowal@example.org'), false);
      assert.equal(wire[1]!.body.includes('02070803628'), false);
      assert.deepEqual(asked, [{ query: `who is ${referee.email}` }]);
      assert.equal(result.text, `It is ${referee.email}, and the other is ewa.kowal@example.org with 02070803628.`);
    }
  );
});

test('a text with no identifier in it is sent byte for byte as it is without the detectors', async () => {
  const posting = {
    system: 'You write job postings.',
    prompt: 'Senior engineer, 2018 - 2023. 18 000 - 24 000 PLN. Node.js 20, version 3.11.2, order 12345678901, 123 456 789 PLN.'
  };

  const bodies: string[] = [];
  for (const detect of [true, false]) {
    await withNetwork([() => completion({ content: 'fine' })], async (wire) => {
      await gatewayFor(openrouter, { detect }).generateText({ ...call, ...posting, maxOutputTokens: 50, maxRetries: 0 });
      bodies.push(wire[0]!.body);
    });
  }

  assert.equal(bodies[0], bodies[1]);
});

test('a call made without the detectors is sent what it always was', async () => {
  await withNetwork([() => completion({ content: 'fine' })], async (wire) => {
    await gatewayFor(openrouter, { detect: false }).generateText({ ...call, ...knows, maxOutputTokens: 50, maxRetries: 0 });

    assert.equal(leaked(wire).length, values.length);
    assert.equal(wire[0]!.body.includes('[EMAIL_'), false);
  });
});

test('a call to a model on this machine under hosted is sent what it always was, detectors or not', async () => {
  await withNetwork([() => completion({ content: 'fine' })], async (wire) => {
    await gatewayFor(onThisMachine).generateText({ ...call, ...knows, maxOutputTokens: 50, maxRetries: 0 });

    assert.match(wire[0]!.url, /localhost:11434/);
    assert.equal(leaked(wire).length, values.length);
    assert.equal(wire[0]!.body.includes('[EMAIL_'), false);
  });
});

test('a call to a model on this machine under always has no identifier in the request', async () => {
  await withNetwork([() => completion({ content: 'Dear [EMAIL_1]' })], async (wire) => {
    const result = await gatewayFor(onThisMachine, { mode: 'always' }).generateText({
      ...call,
      ...knows,
      maxOutputTokens: 50,
      maxRetries: 0
    });

    assert.match(wire[0]!.url, /localhost:11434/);
    assert.deepEqual(leaked(wire), []);
    assert.equal(result.text, `Dear ${referee.email}`);
  });
});

test('a person with seeds and the detectors on has both kept out, and gets both back', async () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'name', value: 'Anna Kowalska' }];

  await withNetwork([() => completion({ content: '[NAME_1] writes to [EMAIL_1]' })], async (wire) => {
    const result = await gatewayFor(openrouter, { seeds }).generateText({
      ...call,
      system: 'Anna Kowalska writes.',
      prompt: `to ${referee.email}`,
      maxOutputTokens: 50,
      maxRetries: 0
    });

    assert.equal(wire[0]!.body.includes('Kowalska'), false);
    assert.deepEqual(leaked(wire), []);
    assert.equal(result.text, `Anna Kowalska writes to ${referee.email}`);
  });
});

test('reading an image is still handed on as it is', async () => {
  const seen: unknown[] = [];
  const inner: AiGateway = {
    describe: () => ({ providerId: 'openrouter', modelId: 'm' }),
    generateObject: async () => {
      throw new Error('unused');
    },
    generateText: async () => {
      throw new Error('unused');
    },
    runToolLoop: async () => {
      throw new Error('unused');
    },
    transcribeImage: async (request) => {
      seen.push(request.instruction);
      return { text: referee.email, finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0 } };
    },
    embed: async () => {
      throw new Error('unused');
    }
  };

  const gateway = maskedGateway(inner, { mode: 'hosted', seeds: () => [], detect: true });
  const read = await gateway.transcribeImage({
    ...call,
    bytes: new Uint8Array(),
    mediaType: 'image/png',
    instruction: referee.phone,
    maxOutputTokens: 10
  });

  assert.deepEqual(seen, [referee.phone]);
  assert.equal(read.text, referee.email);
});
