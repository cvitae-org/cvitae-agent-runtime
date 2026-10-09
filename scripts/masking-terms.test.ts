/**
 * A person's own terms: words and phrases they asked to have kept from a model.
 *
 * What a CV states is kept by masking already. A person may want more kept: a
 * client, a project, a nickname, the town they live in. Studio keeps that list and
 * sends it when it connects and whenever it changes, and the runtime holds it in
 * memory only. Each term is kept whole, as `[TERM_n]`, in every scope. Seven claims.
 *
 *   engine      a term is one value, whole, as it was typed: in any case, with or
 *               without its diacritics, with any white space between its words and
 *               only as a word of its own, its punctuation included; a word of it
 *               is not it; it is put back as it was written
 *   the list    a list is taken without the white space around each term and with
 *               one of each, is refused whole when a term or the list is outside the
 *               limits, which are the engine's, and says it was given, an empty one
 *               included
 *   channels    the list is read and replaced through the protocol, refused there
 *               when it is not one, and protocol.get says the runtime has it
 *   in memory   the list is written nowhere: a restart forgets it, and the file of
 *               the database never holds it
 *   in a run    a hosted model is not told a term in a run, in either scope and in a
 *               run that may not read the CV; a local one is, until the person says
 *               always; the list is asked at each call, as the CV is, and the answer
 *               is in the person's words
 *   in force    a list sent to the real harness is in force on the next message,
 *               with no restart, and an empty one takes it back
 *   rebuild     a rebuild that would be masked waits until a list is given, and an
 *               empty list is one; one that would not be masked never waits; what is
 *               embedded, and searched with, has the terms as placeholders
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 92 were applied: 90 fail at least one test here, and 2 cannot be told from the original.
 *
 * src/contracts/mask.ts:
 *   a term is not a kind of value                              1
 *   the list may hold one more                                 2
 *   the list may hold one fewer                                2
 *   a term may be one shorter                                  4
 *   a term must be one longer                                  4
 *   a term may be one longer than the longest                  2
 *   a term must be one shorter than the longest                2
 *
 * src/effects/mask.ts:
 *   a term placeholder is called something else                17
 *   a term is read as a name is                                17
 *   a term is read as an employer is                           17
 *   a term is a name                                           17
 *   a term is an employer                                      17
 *   a term is not folded                                       18
 *   a term is only lower-cased                                 1
 *   a term has its punctuation taken off its ends              1
 *   a term is not bounded before                               1
 *   a term is not bounded after                                2
 *   a term is not escaped                                      1
 *   the words of a term are joined by one space                1
 *   the words of a term are joined by a space or none          1
 *   a term is split on one space                               1
 *   a term is not split at all                                 1
 *   each word of a term is a term                              7
 *   a term weighs nothing                                      1
 *   a term weighs less the longer it is                        1
 *
 * src/runtime/mask-terms.ts:
 *   a list of any length is taken                              2
 *   a list as long as the limit is refused                     2
 *   a list is refused with another code                        2
 *   a list is refused without saying how many                  1
 *   a term is not trimmed                                      2
 *   a term is measured untrimmed                               1
 *   a short term is taken                                      2
 *   a long term is taken                                       1
 *   a term of the shortest length is refused                   2
 *   a term of the longest length is refused                    2
 *   a bad term is skipped, not refused                         2
 *   a bad term is refused with another code                    2
 *   a refusal quotes the term                                  1
 *   a refusal counts from nought                               1
 *   one of each is not looked for                              2
 *   one of each is looked for unfolded                         2
 *   one of each is looked for lower-cased only                 1
 *   one of each is looked for with its spacing                 1
 *   the later spelling is kept                                 2
 *   the list is not frozen                                     1
 *   the list is what was given                                 3
 *   a list given is not said to be given                       7
 *   a refused list is said to be given                         1
 *   only a list that is not empty is said to be given          4
 *   a list is said to be given from the start                  6
 *   a refused list keeps what it got to (written as it goes)   1
 *   the seeds are names                                        11
 *   the seeds are none                                         12
 *
 * src/runtime/index-recovery.ts:
 *   the rebuilder never asks whether it may                    3
 *   the rebuilder waits only when it may                       5
 *   the rebuilder told nothing never takes a job               1
 *   the rebuilder asks after taking the job                    3
 *
 * src/runtime/create.ts:
 *   the runtime never waits for the list                       2
 *   the runtime always waits for the list                      1
 *   the runtime waits for the list only when not masked        2
 *   the runtime waits by the model that answers                1
 *   the runtime waits as if the mode were hosted               1
 *   the runtime waits for the list and not for it being given  2
 *   the rebuilder is not told when it may                      2
 *   the embedder is not given the terms                        3
 *   the embedder reads the terms once, when it is built        3
 *   the embedder is given only the terms                       1
 *   a run is not given the terms                               2
 *   a run is given the terms once, when the runtime is built   2
 *   the harness offers a list of its own                       6
 *
 * src/runtime/run.ts:
 *   a run does not keep the terms                              8
 *   a run asks for the terms once, when it begins              1
 *   a run that may not read the CV keeps no terms              3
 *   a run keeps only the terms                                 5
 *   a run with terms keeps none of the CV                      4
 *
 * src/adapters/ipc/channels.ts:
 *   the channel does not trim                                  1
 *   the channel takes a term of any length                     0 (equivalent: the runtime's copy refuses the same term with the same code
 *       and keeps the list in force, so the channel only refuses it first)
 *   the channel takes a list of any length                     0 (equivalent: the runtime's copy refuses the same list with the same code
 *       and keeps the list in force, so the channel only refuses it first)
 *   the channel takes anything as a term                       1
 *   the channel set is not strict                              1
 *   the channel get is not strict                              1
 *   the channel set takes no list as an empty one              1
 *
 * src/adapters/ipc/dispatch.ts:
 *   get says a list was given                                  2
 *   get says no list was given                                 2
 *   get returns no terms                                       2
 *   set returns what was sent                                  1
 *   set keeps nothing                                          8
 *   set adds to the list                                       4
 *   the feature is not reported                                1
 *   the feature is reported twice                              1
 *   the feature is spelled differently                         1
 *   the feature replaces the strict one                        1
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response as Reply } from '../src/adapters/ipc/channels.js';
import { CV_ID, CV_KIND, cvDocumentSchema } from '../src/capabilities/cv/document.js';
import { OperationError, RuntimeError, maskSeedKinds, maskTermLimits } from '../src/contracts/index.js';
import type { AiGateway, CapabilityMap, IndexRecoveryStore, MaskMode, MaskScope, MaskSeed } from '../src/contracts/index.js';
import { MAX_SEED_LENGTH, MIN_SEED_LENGTH, createVault } from '../src/effects/mask.js';
import { bindDiscoveryScope } from '../src/runtime/discovery-scope.js';
import { createHarness, silentLogger, type Harness } from '../src/runtime/create.js';
import { createIndexRebuilder } from '../src/runtime/index-recovery.js';
import { createMaskTerms, termSeeds } from '../src/runtime/mask-terms.js';
import { beginRun, buildRunContext, scopedDeps } from '../src/runtime/run.js';
import type { RuntimeDeps } from '../src/runtime/run.js';
import { CHAT, CHAT_RUN, CONTEXT, chat, cv, job, settle } from './support/chat.js';
import type { Chat } from './support/chat.js';
import { noop, stage, transform } from './support/spine.js';

const term = (value: string): MaskSeed => ({ kind: 'term', value });
const masked = (text: string, values: readonly string[]): string => createVault(values.map(term)).mask(text);

/* ----------------------------------------------------------------------- engine */

test('a term is one value, replaced whole and put back as it was written', () => {
  const vault = createVault([term('Project Falcon'), term('Initrode')]);
  const text = 'I led Project Falcon for Initrode, and Initrode liked Project Falcon.';

  const out = vault.mask(text);
  assert.equal(out, 'I led [TERM_1] for [TERM_2], and [TERM_2] liked [TERM_1].');
  assert.equal(vault.restore(out), text);
});

test('a word of a term by itself is not the term, nor are its words run together', () => {
  assert.equal(masked('Falcon is a bird, and Project is a word.', ['Project Falcon']), 'Falcon is a bird, and Project is a word.');
  assert.equal(masked('Project  Falcons', ['Project Falcon']), 'Project  Falcons');
  assert.equal(masked('ProjectFalcon and Project Falcon', ['Project Falcon']), 'ProjectFalcon and [TERM_1]');
});

test('case, diacritics and the white space between its words are not what tells a term from text', () => {
  for (const text of ['Zielona Góra', 'zielona gora', 'ZIELONA GÓRA', 'Zielona  Góra', 'Zielona\nGóra', 'zielona\tgóra']) {
    assert.equal(masked(text, ['Zielona Góra']), '[TERM_1]', text);
  }
  assert.equal(masked('Zielona Góra', ['ZIELONA  gora']), '[TERM_1]');
});

test('a term is taken only as a word of its own: nothing of a letter or a digit on either side', () => {
  assert.equal(masked('Initrodes', ['Initrode']), 'Initrodes');
  assert.equal(masked('XInitrode', ['Initrode']), 'XInitrode');
  assert.equal(masked('Initrode2', ['Initrode']), 'Initrode2');
  assert.equal(masked('2Initrode', ['Initrode']), '2Initrode');
  assert.equal(masked('(Initrode).', ['Initrode']), '([TERM_1]).');
  assert.equal(masked('Initrode-made', ['Initrode']), '[TERM_1]-made');
});

test('what a term is typed with is what is looked for, its punctuation included, and none of it is a pattern', () => {
  assert.equal(masked('C++ and C and C+', ['C++']), '[TERM_1] and C and C+');
  assert.equal(masked('K&S, KS and K & S', ['K&S']), '[TERM_1], KS and K & S');
  assert.equal(masked('a.b*c and axbbc', ['a.b*c']), '[TERM_1] and axbbc');
  assert.equal(masked('Acme Inc. and Acme Inc', ['Acme Inc.']), '[TERM_1] and Acme Inc');
  assert.equal(masked('see (x) here', ['(x)']), 'see [TERM_1] here');
});

test('a term of fewer than three characters, or of more than the longest, is no value', () => {
  assert.equal(createVault([term('AB')]).empty, true);
  assert.equal(createVault([term('  AB  ')]).empty, true);
  assert.equal(createVault([term('ABC')]).empty, false);
  assert.equal(createVault([term('x'.repeat(MAX_SEED_LENGTH))]).empty, false);
  assert.equal(createVault([term('x'.repeat(MAX_SEED_LENGTH + 1))]).empty, true);
});

test('the longest of two values that begin together is used, a term or the CV’s own', () => {
  const seeds: MaskSeed[] = [{ kind: 'name', value: 'Ada Example' }, term('Ada Example Foundation')];
  assert.equal(createVault(seeds).mask('Ada Example Foundation'), '[TERM_1]');
  assert.equal(createVault(seeds).mask('Ada Example'), '[NAME_1]');
  // Numbered as they are found: the longer one first here, and whole.
  assert.equal(createVault([term('Falcon'), term('Falcon Two')]).mask('Falcon Two, Falcon'), '[TERM_1], [TERM_2]');
});

test('a placeholder for a term is put right as the models write it, and in a stream', () => {
  const vault = createVault([term('Initrode')]);
  vault.mask('Initrode');

  assert.equal(vault.restore('[term_1], [TERM\\_1], [ TERM 1 ]'), 'Initrode, Initrode, Initrode');

  const out: string[] = [];
  const restorer = vault.restorer((text) => out.push(text));
  for (const piece of ['At [TE', 'RM_', '1] we']) restorer.push(piece);
  restorer.end();
  assert.equal(out.join(''), 'At Initrode we');
});

test('a term is a kind of value, and the list is held to the engine’s own limits', () => {
  assert.ok((maskSeedKinds as readonly string[]).includes('term'));
  assert.equal(maskTermLimits.shortest, MIN_SEED_LENGTH);
  assert.equal(maskTermLimits.longest, MAX_SEED_LENGTH);
  assert.equal(maskTermLimits.count, 100);
  assert.deepEqual(termSeeds(['Initrode', 'Project Falcon']), [term('Initrode'), term('Project Falcon')]);
});

/* --------------------------------------------------------------------- the list */

const refused = (run: () => unknown): RuntimeError => {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof RuntimeError, `expected a refusal, got ${String(caught)}`);
  assert.equal(caught.code, 'invalid_input');
  return caught;
};

test('a runtime that was given no list has none, and says it was given none', () => {
  const terms = createMaskTerms();

  assert.deepEqual(terms.read(), []);
  assert.equal(terms.declared(), false);
});

test('a list is given, read, and replaced whole, and an empty one is a list given', () => {
  const terms = createMaskTerms();

  assert.deepEqual(terms.set(['Initrode', 'Project Falcon']), ['Initrode', 'Project Falcon']);
  assert.deepEqual(terms.read(), ['Initrode', 'Project Falcon']);
  assert.equal(terms.declared(), true);

  assert.deepEqual(terms.set(['Zielona Góra']), ['Zielona Góra']);
  assert.deepEqual(terms.read(), ['Zielona Góra']);

  assert.deepEqual(terms.set([]), []);
  assert.deepEqual(terms.read(), []);
  assert.equal(terms.declared(), true);

  const fresh = createMaskTerms();
  fresh.set([]);
  assert.equal(fresh.declared(), true);
});

test('a term is kept without the white space around it, and one that folds to one before it is kept once, as first written', () => {
  const terms = createMaskTerms();

  assert.deepEqual(
    terms.set(['  Initrode  ', 'Zielona Góra', 'zielona gora', 'ZIELONA  GÓRA', 'Zielona\tGora', 'initrode', 'Project Falcon']),
    ['Initrode', 'Zielona Góra', 'Project Falcon']
  );
});

test('the list is the runtime’s own copy, and cannot be changed through what was given or what was read', () => {
  const terms = createMaskTerms();
  const given = ['Initrode'];

  terms.set(given);
  given.push('Project Falcon');
  assert.deepEqual(terms.read(), ['Initrode']);
  assert.ok(Object.isFrozen(terms.read()));
});

test('a term outside the limits, or a list longer than they allow, is refused whole, and what was there stays', () => {
  const terms = createMaskTerms();

  refused(() => terms.set(['AB']));
  assert.equal(terms.declared(), false, 'a refused list is not a list given');

  terms.set(['Initrode']);
  for (const list of [
    ['Project Falcon', 'AB'],
    ['   AB   '],
    ['x'.repeat(maskTermLimits.longest + 1)],
    Array.from({ length: maskTermLimits.count + 1 }, (_, index) => `term ${index}`)
  ]) {
    refused(() => terms.set(list));
    assert.deepEqual(terms.read(), ['Initrode']);
  }

  assert.equal(terms.set(['ABC', 'x'.repeat(maskTermLimits.longest)]).length, 2);
  assert.equal(terms.set(Array.from({ length: maskTermLimits.count }, (_, index) => `term ${index}`)).length, maskTermLimits.count);
});

test('a refusal says which term and why, and does not quote it', () => {
  const error = refused(() => createMaskTerms().set(['Project Falcon', 'Xq']));

  assert.match(error.message, /Term 2 /);
  assert.match(error.message, /3 to 300 characters/);
  assert.doesNotMatch(error.message, /Xq|Falcon/);
  assert.match(refused(() => createMaskTerms().set(Array.from({ length: 101 }, () => 'abc'))).message, /At most 100 terms/);
});

/* ---------------------------------------------------------------------- harness */

type Wire = { readonly url: string; readonly body: string };
type Dispatch = ReturnType<typeof createDispatch>;

const completion = (text: string): Response =>
  new Response(
    JSON.stringify({
      id: 'cmpl',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

const vectors = (request: Wire): Response => {
  const inputs = (JSON.parse(request.body) as { input?: unknown[] }).input ?? [];
  return new Response(
    JSON.stringify({
      object: 'list',
      data: inputs.map((_, index) => ({ object: 'embedding', index, embedding: [3, 4] })),
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 3, total_tokens: 3 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

/** The network, for as long as `run` takes: every request is kept and answered, with vectors or with a sentence. */
const onTheWire = async (run: (wire: Wire[]) => Promise<void>, reply = 'At [TERM_1].'): Promise<void> => {
  const wire: Wire[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }): Promise<Response> => {
    const request: Wire = {
      url: typeof input === 'string' ? input : ((input as { url?: string }).url ?? String(input)),
      body: typeof init?.body === 'string' ? init.body : ''
    };
    wire.push(request);
    return /\/embeddings/.test(request.url) ? vectors(request) : completion(reply);
  }) as typeof globalThis.fetch;

  try {
    await run(wire);
  } finally {
    globalThis.fetch = real;
  }
};

const QUESTION = 'Write about the work for Initrode on Project Falcon, from Zielona Góra.';
const query = 'Initrode billing';
let answered = '';

const capabilities: CapabilityMap = {
  probe: noop('probe', [
    stage('ask', [
      transform('ask', async (context) => {
        const { text } = await context.effects.ai.generateText({
          traceId: context.traceId,
          signal: context.signal,
          system: 'You help.',
          prompt: QUESTION,
          maxOutputTokens: 20,
          maxRetries: 0
        });
        answered = text;
        return { text };
      })
    ])
  ]),
  search: noop('search', [
    stage('search', [
      transform('search', async (context) => {
        await context.retrieval.search({ text: query, limit: 3 }, context.signal);
        return {};
      })
    ])
  ])
};

type Bench = {
  readonly harness: Harness;
  readonly dispatch: Dispatch;
  readonly dir: string;
  restart(): Bench;
  dispose(): void;
};

const bench = (options: { env?: Readonly<Record<string, string>>; on?: string; indexRecovery?: boolean } = {}): Bench => {
  const dir = options.on ?? mkdtempSync(join(tmpdir(), 'harness-terms-'));
  const harness = createHarness({
    databasePath: join(dir, 'harness.db'),
    capabilities,
    logger: silentLogger,
    env: options.env ?? {},
    ...(options.indexRecovery ? { indexRecovery: true } : {}),
    probe: () => Promise.reject(new Error('connection refused'))
  });

  return {
    harness,
    dispatch: createDispatch(harness),
    dir,
    restart() {
      harness.close();
      return bench({ ...options, on: dir });
    },
    dispose() {
      try {
        harness.close();
      } catch {
        // Closed by `restart`.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

const data = <T>(response: Reply): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const failure = (response: Reply): { code: string; message: string } => {
  assert.ok(!response.ok, `expected a failure, got ${JSON.stringify(response)}`);
  return response.error;
};

type View = { terms: string[]; declared: boolean };

const send = (it: Bench, terms: unknown) => it.dispatch('masking.terms.set', { terms } as never);
const read = async (it: Bench): Promise<View> => data<View>(await it.dispatch('masking.terms.get', {}));

const personal = { name: 'Ada Example', email: 'ada@example.com', phone: '+44 7700 900123', location: 'Krakow', links: {} };

const writeCv = (it: Bench): void => {
  it.harness.documents.update(CV_ID, CV_KIND, () =>
    cvDocumentSchema.parse({
      personal,
      role_description: 'Ada Example rewrote the billing pipeline for Initrode, on Project Falcon.',
      experience: [{ company: 'Acme', title: 'Engineer', highlights: ['Rewrote the billing pipeline for Initrode.'] }]
    })
  );
};

/* --------------------------------------------------------------------- channels */

test('the list is read and replaced through the protocol, and an empty one says there are none', async () => {
  const it = bench();

  try {
    assert.deepEqual(await read(it), { terms: [], declared: false });

    assert.deepEqual(data<View>(await send(it, [' Initrode ', 'initrode', 'Project Falcon'])), {
      terms: ['Initrode', 'Project Falcon'],
      declared: true
    });
    assert.deepEqual(await read(it), { terms: ['Initrode', 'Project Falcon'], declared: true });

    assert.deepEqual(data<View>(await send(it, [])), { terms: [], declared: true });
    assert.deepEqual(await read(it), { terms: [], declared: true });
  } finally {
    it.dispose();
  }
});

test('what is not a list of terms is refused at the channel, and what was there stays', async () => {
  const it = bench();

  try {
    await send(it, ['Initrode']);

    for (const payload of [
      { terms: ['AB'] },
      { terms: ['  AB  '] },
      { terms: ['x'.repeat(maskTermLimits.longest + 1)] },
      { terms: Array.from({ length: maskTermLimits.count + 1 }, (_, index) => `term ${index}`) },
      { terms: [42] },
      { terms: 'Initrode' },
      {},
      { terms: ['Initrode'], extra: true }
    ]) {
      assert.equal(failure(await it.dispatch('masking.terms.set', payload as never)).code, 'invalid_input', JSON.stringify(payload).slice(0, 60));
      assert.deepEqual(await read(it), { terms: ['Initrode'], declared: true });
    }

    assert.equal(failure(await it.dispatch('masking.terms.get', { extra: true } as never)).code, 'invalid_input');
    assert.equal(data<View>(await send(it, ['ABC', 'x'.repeat(maskTermLimits.longest)])).terms.length, 2);
    // The limits are on a term without the white space around it, as it is kept.
    assert.deepEqual(data<View>(await send(it, [`  ${'x'.repeat(maskTermLimits.longest)}  `])).terms, ['x'.repeat(maskTermLimits.longest)]);
    assert.equal(data<View>(await send(it, Array.from({ length: maskTermLimits.count }, (_, i) => `term ${i}`))).terms.length, maskTermLimits.count);
  } finally {
    it.dispose();
  }
});

test('protocol.get says the runtime keeps a person’s own terms from a model, once', async () => {
  const it = bench();

  try {
    const { features } = data<{ features: string[] }>(await it.dispatch('protocol.get', {}));
    assert.equal(features.filter((feature) => feature === 'masking-terms').length, 1);
    assert.ok(features.includes('masking-strict'), 'beside the others');
  } finally {
    it.dispose();
  }
});

/* -------------------------------------------------------------------- in memory */

const onDisk = (dir: string, text: string): string[] =>
  readdirSync(dir).filter((name) => readFileSync(join(dir, name)).includes(Buffer.from(text)));

test('a restart forgets the list, and the file never held it, nor what the settings carry', async () => {
  let it = bench({ env: { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-not-a-real-key' } });

  try {
    await send(it, ['Nightjar Initiative', 'Kestrel Holdings']);
    await onTheWire(async () => {
      await it.harness.run({ capability: 'probe', input: {} });
    });
    const settings = data<{ settings: Record<string, unknown> }>(await it.dispatch('settings.get', {})).settings;
    assert.equal(JSON.stringify(settings).includes('Nightjar'), false);

    assert.deepEqual(onDisk(it.dir, 'Nightjar'), []);
    assert.deepEqual(onDisk(it.dir, 'Kestrel'), []);

    it = it.restart();
    assert.deepEqual(await read(it), { terms: [], declared: false });
    assert.deepEqual(onDisk(it.dir, 'Nightjar'), []);
  } finally {
    it.dispose();
  }
});

/* ----------------------------------------------------------------------- in a run */

const body = {
  ...cv([job('Acme', 'Senior Engineer', 'Rewrote the billing pipeline for Initrode.')]),
  personal
};

const ASKED = 'What did Ada Example do for Initrode on Project Falcon?';

const rig = (answer?: () => string): Chat => chat({ body, ...(answer ? { answer } : {}) });

const maskedBy = (
  c: Chat,
  terms: (() => readonly string[]) | undefined,
  options: { mode?: MaskMode; scope?: MaskScope; providerId?: string } = {}
): RuntimeDeps => ({
  ...c.deps,
  masking: {
    mode: () => options.mode ?? 'hosted',
    ...(options.scope ? { scope: () => options.scope! } : {}),
    ...(terms ? { terms } : {})
  },
  effects: {
    ...c.deps.effects,
    ai: { ...c.deps.effects.ai, describe: () => ({ providerId: options.providerId ?? 'openrouter', modelId: 'a-model' }) } as AiGateway
  }
});

const ask = async (deps: RuntimeDeps, question = ASKED) => {
  const run = beginRun(deps, { capability: 'ask_profile', input: { question }, ...CHAT_RUN });
  await run.settled;
  return run;
};

const told = (c: Chat, from = 0): { initrode: boolean; falcon: boolean; name: boolean; term: boolean } => {
  const texts = c.requests.slice(from).flatMap((request) => [request.system, request.prompt, ...request.history]);

  return {
    initrode: texts.some((text) => text.includes('Initrode')),
    falcon: texts.some((text) => text.includes('Falcon')),
    name: texts.some((text) => text.includes('Ada Example')),
    term: texts.some((text) => /\[TERM_\d\]/.test(text))
  };
};

const fields = () => ({
  runId: 'r',
  traceId: 't',
  contextId: CONTEXT,
  conversationId: CHAT,
  capability: 'ask_profile',
  input: {},
  signal: new AbortController().signal,
  deadlineAt: 0
});

const contextOf = (deps: RuntimeDeps) => buildRunContext(scopedDeps(deps, CONTEXT, CHAT), fields() as never);
const say = (deps: RuntimeDeps, prompt: string) =>
  contextOf(deps).effects.ai.generateText({ traceId: 't', signal: new AbortController().signal, system: 's', prompt, maxOutputTokens: 10 });

const TERMS = ['Initrode', 'Project Falcon'];

test('a hosted model is not told a term in a run, whatever the scope, and who the person is is kept as before', async () => {
  for (const scope of ['personal', 'strict'] as const) {
    const c = rig();

    try {
      await ask(maskedBy(c, () => TERMS, { scope }));

      assert.ok(c.requests.length >= 2);
      assert.deepEqual(told(c), { initrode: false, falcon: false, name: false, term: true }, scope);
    } finally {
      c.dispose();
    }
  }
});

test('with no terms, or a host that gives none, the run is masked as it was', async () => {
  for (const terms of [undefined, () => []]) {
    const c = rig();

    try {
      await ask(maskedBy(c, terms));
      assert.deepEqual(told(c), { initrode: true, falcon: true, name: false, term: false });
    } finally {
      c.dispose();
    }
  }
});

test('the terms are kept from the calls the mode masks: a model on this machine is told them, until the person says always', async () => {
  const c = rig();

  try {
    await ask(maskedBy(c, () => TERMS, { providerId: 'local' }));
    assert.deepEqual(told(c), { initrode: true, falcon: true, name: true, term: false });

    const first = c.requests.length;
    await ask(maskedBy(c, () => TERMS, { providerId: 'local', mode: 'always' }));
    assert.deepEqual(told(c, first), { initrode: false, falcon: false, name: false, term: true });
  } finally {
    c.dispose();
  }
});

test('the answer is in the person’s words, as they wrote the term', async () => {
  const c = rig(() => 'For [TERM_1], [NAME_1] led [TERM_2].');

  try {
    const { data } = await settle(await ask(maskedBy(c, () => TERMS)));

    assert.match(JSON.stringify(data), /For Initrode, Ada Example led Project Falcon\./);
    assert.doesNotMatch(JSON.stringify(data), /\[(TERM|NAME)_\d\]/);
  } finally {
    c.dispose();
  }
});

test('the list is asked at each call, as the CV is: a term added while a run goes on is kept from its next call', async () => {
  const c = rig();
  let terms: readonly string[] = [];
  let asked = 0;

  try {
    const deps = maskedBy(
      c,
      () => {
        asked += 1;
        return terms;
      },
      { mode: 'always', providerId: 'local' }
    );
    assert.equal(asked, 0, 'not when the run is built');

    const context = contextOf(deps);
    const call = (prompt: string) =>
      context.effects.ai.generateText({ traceId: 't', signal: new AbortController().signal, system: 's', prompt, maxOutputTokens: 10 });

    await call('For Initrode.');
    assert.equal(c.requests.at(-1)!.prompt, 'For Initrode.');

    terms = ['Initrode'];
    await call('For Initrode.');
    assert.equal(c.requests.at(-1)!.prompt, 'For [TERM_1].');

    terms = [];
    await call('For Initrode.');
    assert.equal(c.requests.at(-1)!.prompt, 'For Initrode.');
    assert.equal(asked, 3);
  } finally {
    c.dispose();
  }
});

test('a run that may not read the CV keeps the terms all the same: they are not the CV’s', async () => {
  const c = rig();

  try {
    const deps = bindDiscoveryScope(maskedBy(c, () => TERMS, { mode: 'always' }));
    const context = buildRunContext(deps, { ...fields(), contextId: undefined, conversationId: undefined } as never);

    assert.throws(() => deps.documents.read('cv'), (error: unknown) => error instanceof OperationError && error.code === 'search_scope');

    await context.effects.ai.generateText({ traceId: 't', signal: new AbortController().signal, system: 's', prompt: 'Is Initrode hiring for Project Falcon?', maxOutputTokens: 10 });
    assert.equal(c.requests.at(-1)!.prompt, 'Is [TERM_1] hiring for [TERM_2]?');
  } finally {
    c.dispose();
  }
});

test('a term and the CV’s own values are kept in one call, each as itself', async () => {
  const c = rig();

  try {
    await say(maskedBy(c, () => ['Initrode'], { mode: 'always', scope: 'strict' }), 'Ada Example at Acme for Initrode.');
    assert.equal(c.requests.at(-1)!.prompt, '[NAME_1] at [ORG_1] for [TERM_1].');
  } finally {
    c.dispose();
  }
});

/* --------------------------------------------------------------------- in force */

const OPENROUTER = { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-not-a-real-key' };

const sends = async (it: Bench): Promise<Wire> => {
  let sent: Wire | undefined;

  await onTheWire(async (wire) => {
    await it.harness.run({ capability: 'probe', input: {} });
    sent = wire.at(-1);
  });

  assert.ok(sent, 'a model was asked');
  return sent;
};

const carries = (wire: Wire): { initrode: boolean; falcon: boolean; town: boolean; term: boolean } => ({
  initrode: wire.body.includes('Initrode'),
  falcon: wire.body.includes('Falcon'),
  town: wire.body.includes('Zielona'),
  term: /\[TERM_\d\]/.test(wire.body)
});

test('a list sent to the runtime is in force on the next message, with no restart, and an empty one takes it back', async () => {
  const it = bench({ env: OPENROUTER });

  try {
    assert.deepEqual(carries(await sends(it)), { initrode: true, falcon: true, town: true, term: false }, 'before');

    await send(it, ['Initrode', 'zielona gora']);
    const wire = await sends(it);
    assert.match(wire.url, /openrouter/);
    assert.deepEqual(carries(wire), { initrode: false, falcon: true, town: false, term: true }, 'after');
    assert.equal(answered, 'At Initrode.', 'and the answer is put right');

    await send(it, []);
    assert.deepEqual(carries(await sends(it)), { initrode: true, falcon: true, town: true, term: false }, 'and back');
  } finally {
    it.dispose();
  }
});

test('a runtime that restarted keeps no term until it is sent the list again', async () => {
  let it = bench({ env: OPENROUTER });

  try {
    await send(it, ['Initrode']);
    assert.equal(carries(await sends(it)).initrode, false);

    it = it.restart();
    assert.equal(carries(await sends(it)).initrode, true, 'forgotten');

    await send(it, ['Initrode']);
    assert.equal(carries(await sends(it)).initrode, false, 'sent again');
  } finally {
    it.dispose();
  }
});

/* ---------------------------------------------------------------------- rebuild */

const hostedEmbedder = { AI_PROVIDER: 'local', EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-not-a-real-key' };

const until = async (what: string, done: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(done(), what);
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const inputsOf = (wire: Wire): string[] => (JSON.parse(wire.body) as { input: string[] }).input;

const vectored = (it: Bench): boolean => {
  const summary = it.harness.indexRecovery.indexed(CV_ID);
  return summary.chunks > 0 && !summary.keywordOnly;
};

test('a rebuilder asks whether it may take a job before each, and takes none while it may not', async () => {
  let claims = 0;
  let ready = false;
  const jobs = { claim: () => ((claims += 1), undefined) } as unknown as IndexRecoveryStore;
  const rebuilder = createIndexRebuilder(jobs, {} as AiGateway, { ready: () => ready });

  await rebuilder.runOnce();
  await rebuilder.runOnce();
  assert.equal(claims, 0);

  ready = true;
  await rebuilder.runOnce();
  assert.equal(claims, 1);

  ready = false;
  await rebuilder.runOnce();
  assert.equal(claims, 1);

  const always = createIndexRebuilder(jobs, {} as AiGateway);
  await always.runOnce();
  assert.equal(claims, 2, 'a rebuilder told nothing takes a job as it always did');
});

test('a rebuild with a hosted embedder waits for the list, and the list it waits for may be empty', async () => {
  const it = bench({ env: hostedEmbedder, indexRecovery: true });

  try {
    await onTheWire(async (wire) => {
      writeCv(it);
      // The rebuilder looks every second: three looks, and none of them sent.
      await pause(3200);
      assert.equal(wire.length, 0, 'the embedder was not called');
      assert.equal(vectored(it), false);
      assert.ok(it.harness.indexRecovery.status(CV_ID), 'the job is there, waiting');
      assert.equal(it.harness.indexRecovery.status(CV_ID)!.attempts, 0, 'and was never tried');

      await send(it, []);
      await until('the index is built once the list is given', () => vectored(it));
      assert.ok(wire.length > 0);
    });
  } finally {
    it.dispose();
  }
});

test('the index is built from placeholders for a term beside the CV’s own, and what it keeps is the CV’s own text', async () => {
  const it = bench({ env: hostedEmbedder, indexRecovery: true });

  try {
    await send(it, ['Initrode', 'Project Falcon']);

    await onTheWire(async (wire) => {
      writeCv(it);
      await until('the index is built', () => vectored(it));

      const sent = wire.flatMap(inputsOf);
      assert.ok(sent.length > 0);
      assert.equal(sent.some((text) => text.includes('Initrode') || text.includes('Falcon')), false);
      assert.ok(sent.some((text) => /\[TERM_\d\]/.test(text)));
      // The CV's own values are kept as they were: the terms are added to them.
      assert.equal(sent.some((text) => text.includes('Ada Example')), false);
      assert.ok(sent.some((text) => /\[NAME_\d\]/.test(text)));

      const stored = it.harness.chunks.lexical({ text: 'billing', limit: 3 });
      assert.ok(stored.some((chunk) => chunk.text.includes('Initrode')), 'the person reads their own words');
    });
  } finally {
    it.dispose();
  }
});

test('a question is searched for with a term as a placeholder, as the list is now', async () => {
  const it = bench({ env: hostedEmbedder, indexRecovery: true });

  try {
    await send(it, []);

    await onTheWire(async (wire) => {
      writeCv(it);
      await until('the index is built', () => vectored(it));

      const asked = async (): Promise<string> => {
        const before = wire.length;
        await it.harness.run({ capability: 'search', input: {} });
        return inputsOf(wire[before]!)[0]!;
      };

      assert.equal(await asked(), 'Initrode billing');
      await send(it, ['Initrode']);
      assert.equal(await asked(), '[TERM_1] billing');
      await send(it, []);
      assert.equal(await asked(), 'Initrode billing');
    });
  } finally {
    it.dispose();
  }
});

test('a rebuild with an embedder on this machine does not wait, until the person says always', async () => {
  const it = bench({ env: {}, indexRecovery: true });

  try {
    await onTheWire(async (wire) => {
      writeCv(it);
      await until('the index is built with no list given', () => vectored(it));
      assert.ok(wire.length > 0);

      assert.ok((await it.dispatch('settings.set', { settings: { maskMode: 'always' } } as never)).ok);
      const before = wire.length;
      it.harness.indexRecovery.enqueue(CV_ID);
      await pause(2200);
      assert.equal(wire.length, before, 'always masks the local embedder, so it waits for the list too');

      await send(it, ['Initrode']);
      await until('and is built once it is given', () => wire.length > before);
      assert.ok(inputsOf(wire.at(-1)!).some((text) => text.includes('[TERM_1]')));
    });
  } finally {
    it.dispose();
  }
});
