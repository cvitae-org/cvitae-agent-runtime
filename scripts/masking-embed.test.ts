/**
 * What an embedding provider is sent, when it is not on the machine.
 *
 * The first half of masking left `embed` alone: its provider is the local one
 * unless a person chose otherwise, and a vector is made of the text it stands for.
 * A person who did choose otherwise sent a hosted provider the name, the email and
 * the phone of their CV in the chunks of the index, and the same in every question
 * they asked of it. This holds the second half to what it set out to do: the
 * texts an embedder is given go through the vault, the vectors that come back are
 * numbers and need nothing put right, and what is stored and searched is as it was.
 * The questions, in order:
 *
 *   which          the call is masked or not by the provider that embeds and not
 *                  by the one that writes the answers, and by the mode as it is
 *                  when the call is made
 *   what leaves    every text of a batch, one vault for the batch and a new one
 *                  for the next call, and what is not a text is as it was
 *   on the wire    the real gateway and the real SDK, a `fetch` that reads every
 *                  body: a hosted embedder, a local one, and a person with nothing
 *                  to keep
 *   the index      what the index is built from and searched with, outside any
 *                  run: the same rule, the text it stores unchanged, and a search
 *                  that still finds what was built
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 75 were applied: 75 fail at least one test here, and 0 cannot be told from the original.
 *
 * src/effects/detect.ts:
 *   a Polish number has ten digits after its code                              1
 *   a Polish number has eight digits after its code                            1
 *   a number is cut one digit late                                             1
 *   a NIP needs no label                                                       1
 *   the name of an address may not have a dot                                  2
 *   every address is a file                                                    2
 *   a handle needs no network before it                                        1
 *   a detector is not run when its guard fails to find                         2
 *   what a detector found is not passed on                                     2
 *   the kinds are not the detector's                                           2
 *   the email detector finds nothing                                           2
 *   the phone with country code detector finds nothing                         1
 *   the email detector names what it finds wrongly                             2
 *   the phone with country code detector names what it finds wrongly           1
 *
 * src/effects/mask.ts:
 *   a vault with no seeds is empty whether or not it detects                   2
 *   a vault that does not detect is not empty when it has no seeds             3
 *   a vault with no seeds returns the text before it detects                   2
 *   a vault never detects                                                      2
 *   a vault gives the later span when two begin together                       14
 *   a vault takes a span that begins where another ends                        13
 *   a vault takes a span that begins inside another                            2
 *   a vault does not move on past a span it took                               2
 *   a text with a shape in it is returned as it was                            18
 *
 * src/effects/masking.ts:
 *   the gateway never detects                                                  2
 *   the gateway always detects                                                 1
 *   an embedding is never masked                                               19
 *   an embedding is always masked                                              9
 *   hosted masks an embedder on this machine                                   18
 *   always masks only what hosted does for an embedding                        5
 *   an embedding is decided by the provider that writes                        10
 *   a gateway that cannot say where it embeds is not asked                     2
 *   a gateway that cannot say where it embeds is taken to embed here           1
 *   a gateway that cannot say where it embeds is taken to embed away           1
 *   an embedding asks the same of every call                                   9
 *   every call asks where it embeds                                            2
 *   the two are swapped                                                        9
 *   an embedding is always asked as always                                     8
 *   an embedding is never asked                                                18
 *   a mode that is a function is not called                                    2
 *   the mode is asked once, when the gateway is built                          2
 *   a mode that is a word is called                                            20
 *   the wrapper does not say where it embeds                                   1
 *   the wrapper says where it writes                                           1
 *   the wrapper cannot say where a gateway embeds that does not say            1
 *   the wrapper says it embeds here                                            1
 *   an embedding takes no vault                                                18
 *   an embedding is masked in its first text only                              10
 *   an embedding is masked in its last text only                               11
 *   an embedding is not masked in its first text                               17
 *   each text of an embedding has a vault of its own                           1
 *   an embedding is sent nothing                                               13
 *   an embedding loses what else it was asked                                  8
 *   an embedding loses its signal                                              1
 *   an embedding loses its trace                                               1
 *   an embedding is sent as it was and the vault is made for nothing           17
 *   an embedding answer carries a mark of the masking                          3
 *   an embedding is not failed as it was                                       1
 *   where it embeds is read when the gateway is built                          4
 *
 * src/adapters/ipc/dispatch.ts:
 *   the protocol does not say the runtime detects                              1
 *   the protocol names it as another                                           1
 *   the runtime does not say it keeps an embedder from the person              1
 *   the runtime says it twice                                                  1
 *   the runtime says it keeps the embedder under another name                  1
 *
 * src/effects/ai.ts:
 *   the real gateway does not say where it embeds                              5
 *   the real gateway says where it writes                                      5
 *
 * src/runtime/create.ts:
 *   the index is built with the setting fixed                                  1
 *   the index is built with the setting read when the runtime is built         1
 *   the index is built with the setting always on                              1
 *   the index is built with no setting                                         1
 *   the index is built with no seeds                                           3
 *   the index is built with the seeds as they were when the runtime was built  3
 *   the index is built with no detectors                                       1
 *   the rebuilder embeds past the masking                                      1
 *   the retriever embeds past the masking                                      3
 *
 * src/retrieval/fingerprint.ts:
 *   the index is stamped as masked                                             1
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { CV_ID, CV_KIND, cvDocumentSchema } from '../src/capabilities/cv/document.js';
import { RuntimeError } from '../src/contracts/index.js';
import type {
  AiGateway,
  CapabilityMap,
  ChunkHit,
  EmbedRequest,
  EmbedResult,
  MaskMode,
  MaskSeed,
  TextRequest
} from '../src/contracts/index.js';
import { createAiGateway } from '../src/effects/ai.js';
import { maskedGateway, masksEmbedding } from '../src/effects/masking.js';
import { createModelResolver } from '../src/providers/resolve.js';
import { createHarness, silentLogger, type Harness } from '../src/runtime/create.js';
import { CHUNKER_VERSION, fingerprintOf } from '../src/retrieval/fingerprint.js';
import { noop, stage, stubGateway, transform } from './support/spine.js';

type Provider = { readonly providerId: string; readonly modelId: string };

const hosted: Provider = { providerId: 'openai', modelId: 'text-embedding-3-small' };
const local: Provider = { providerId: 'local', modelId: 'nomic-embed-text' };

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

const call = { traceId: 'trace', signal: new AbortController().signal };

const chunks = [
  'Anna Kowalska writes backend services. Reach her at anna.kowalska@example.com.',
  'Anna Kowalska can be called on +48 600 123 456, or found at linkedin.com/in/anna-kowalska.',
  'Rewrote the billing pipeline and cut its run time in half.'
];

const answer: EmbedResult = { vectors: [new Float32Array([0.6, 0.8])], provider: 'openai', model: 'text-embedding-3-small', dim: 2 };

/**
 * A gateway that remembers what it was asked to embed and to write. Which provider
 * writes and which embeds is the test's to say, and `embedder` left out is a
 * gateway that cannot say.
 */
const rig = (language: Provider, embedder?: Provider) => {
  const embedded: EmbedRequest[] = [];
  const written: TextRequest[] = [];
  const inner: AiGateway = stubGateway({
    describe: () => language,
    ...(embedder === undefined ? {} : { describeEmbedding: () => embedder }),
    embed: async (request) => {
      embedded.push(request);
      return answer;
    },
    generateText: async (request) => {
      written.push(request);
      return { text: 'ok', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
    }
  });
  return { inner, embedded, written };
};

const wrap = (inner: AiGateway, mode: MaskMode | (() => MaskMode) = 'hosted', seeds: () => readonly MaskSeed[] = () => anna, detect = false) =>
  maskedGateway(inner, { mode, seeds, detect });

const leaks = (values: readonly string[]): string[] =>
  values.flatMap((value) => everything.filter((secret) => value.toLowerCase().includes(secret.toLowerCase())));

/* ------------------------------------------------------------------- which */

test('an embedder that is not on the machine is sent placeholders, and what comes back is the very result', async () => {
  const { inner, embedded } = rig(hosted, hosted);
  const request = { ...call, step: 'index_recovery', values: chunks };

  const result = await wrap(inner).embed(request);

  assert.equal(embedded.length, 1);
  assert.deepEqual(leaks(embedded[0]!.values), []);
  assert.match(embedded[0]!.values[0]!, /\[NAME_1\].*\[EMAIL_1\]/);
  assert.match(embedded[0]!.values[1]!, /\[NAME_1\].*\[PHONE_1\].*\[LINK_1\]/);
  assert.equal(embedded[0]!.values[2], chunks[2], 'a text with nothing to keep in it is the text');
  assert.equal(embedded[0]!.traceId, 'trace');
  assert.equal(embedded[0]!.step, 'index_recovery');
  assert.equal(embedded[0]!.signal, call.signal);
  assert.equal(embedded[0]!.values.length, 3);
  assert.equal(result, answer);
});

test('the provider that embeds decides, not the one that writes: a hosted writer and an embedder on this machine', async () => {
  const { inner, embedded, written } = rig(hosted, local);
  const gateway = wrap(inner);
  const request = { ...call, values: chunks };

  await gateway.embed(request);
  await gateway.generateText({ ...call, system: 'For Anna Kowalska.', prompt: 'Hello', maxOutputTokens: 5 });

  assert.equal(embedded[0], request, 'the embedder is on this machine and gets what it always got');
  assert.deepEqual(leaks([written[0]!.system]), [], 'while the writer is not, and does not');
});

test('the provider that embeds decides, not the one that writes: a local writer and a hosted embedder', async () => {
  const { inner, embedded, written } = rig(local, hosted);
  const gateway = wrap(inner);
  const prompt = 'Hello Anna Kowalska';

  await gateway.embed({ ...call, values: chunks });
  await gateway.generateText({ ...call, system: 'You help.', prompt, maxOutputTokens: 5 });

  assert.deepEqual(leaks(embedded[0]!.values), [], 'the embedder is not on this machine, and gets placeholders');
  assert.equal(written[0]!.prompt, prompt, 'while the writer is, and gets the text');
});

test('every hosted provider is masked and the local one is not, under hosted', () => {
  for (const providerId of ['openai', 'huggingface', 'openrouter']) {
    assert.equal(masksEmbedding('hosted', { describe: () => local, describeEmbedding: () => ({ providerId, modelId: 'm' }) }), true, providerId);
  }
  assert.equal(masksEmbedding('hosted', { describe: () => hosted, describeEmbedding: () => local }), false);
});

test('always masks an embedder on this machine too, and hosted does not', async () => {
  const request = { ...call, values: chunks };

  const always = rig(local, local);
  await wrap(always.inner, 'always').embed(request);
  assert.deepEqual(leaks(always.embedded[0]!.values), []);

  const sometimes = rig(local, local);
  await wrap(sometimes.inner, 'hosted').embed(request);
  assert.equal(sometimes.embedded[0], request);
});

test('a gateway that does not say where it embeds is taken to embed where it writes', async () => {
  const request = { ...call, values: chunks };

  const away = rig(hosted);
  await wrap(away.inner).embed(request);
  assert.deepEqual(leaks(away.embedded[0]!.values), []);

  const here = rig(local);
  await wrap(here.inner).embed(request);
  assert.equal(here.embedded[0], request);
});

test('the wrapper says where it embeds as the gateway under it does, and where it writes when that one cannot', () => {
  assert.deepEqual(wrap(rig(hosted, local).inner).describeEmbedding?.(), local);
  assert.deepEqual(wrap(rig(local, hosted).inner).describeEmbedding?.(), hosted);
  assert.deepEqual(wrap(rig(hosted).inner).describeEmbedding?.(), hosted);
  assert.deepEqual(wrap(rig(local).inner).describeEmbedding?.(), local);
});

test('the mode is asked at each call when it is a function, and the call is masked by what it says then', async () => {
  let mode: MaskMode = 'hosted';
  const { inner, embedded } = rig(local, local);
  const gateway = wrap(inner, () => mode);
  const request = { ...call, values: chunks };

  await gateway.embed(request);
  mode = 'always';
  await gateway.embed(request);
  mode = 'hosted';
  await gateway.embed(request);

  assert.equal(embedded[0], request, 'hosted, on this machine');
  assert.deepEqual(leaks(embedded[1]!.values), [], 'changed to always while the gateway was held');
  assert.equal(embedded[2], request, 'and back');
});

test('where it embeds is asked at each call, so a provider chosen while the gateway is held is the one that decides', async () => {
  let embeds: Provider = local;
  const embedded: EmbedRequest[] = [];
  const gateway = wrap(
    stubGateway({
      describe: () => local,
      describeEmbedding: () => embeds,
      embed: async (request) => {
        embedded.push(request);
        return answer;
      }
    })
  );
  const request = { ...call, values: chunks };

  await gateway.embed(request);
  embeds = hosted;
  await gateway.embed(request);
  embeds = local;
  await gateway.embed(request);

  assert.equal(embedded[0], request, 'on this machine');
  assert.deepEqual(leaks(embedded[1]!.values), [], 'chosen away while the gateway was held');
  assert.equal(embedded[2], request, 'and back');
});

test('a mode that is a word is the mode for every call', async () => {
  const { inner, embedded } = rig(local, local);
  const gateway = wrap(inner, 'always');

  await gateway.embed({ ...call, values: chunks });
  await gateway.embed({ ...call, values: chunks });

  assert.deepEqual(leaks(embedded.flatMap((each) => each.values)), []);
});

test('an embedder that cannot be named fails the call as it always did, and sends nothing', async () => {
  const refusal = new RuntimeError('This provider serves no embeddings endpoint.', 'misconfigured');
  const sent: unknown[] = [];
  const gateway = wrap(
    stubGateway({
      describe: () => hosted,
      describeEmbedding: () => {
        throw refusal;
      },
      embed: async (request) => {
        sent.push(request);
        return answer;
      }
    })
  );

  await assert.rejects(gateway.embed({ ...call, values: chunks }), (error: unknown) => error === refusal);
  assert.deepEqual(sent, []);
});

test('an embedder that fails fails the call with the failure it had, and a masked one is no different', async () => {
  const failure = new RuntimeError('The embeddings service is down.', 'step_failed');
  const gateway = (language: Provider) =>
    wrap(
      stubGateway({
        describe: () => language,
        embed: async () => {
          throw failure;
        }
      })
    );

  await assert.rejects(gateway(hosted).embed({ ...call, values: chunks }), (error: unknown) => error === failure);
  await assert.rejects(gateway(local).embed({ ...call, values: chunks }), (error: unknown) => error === failure);
});

/* -------------------------------------------------------------- what leaves */

test('a batch is one call: a value is the same placeholder in every text it is in, and a new one gets the next number', async () => {
  const { inner, embedded } = rig(hosted, hosted);
  const other = 'And Ewa Nowak at ewa.nowak@example.com. Back to anna.kowalska@example.com.';

  await wrap(inner, 'hosted', () => [...anna, { kind: 'email', value: 'ewa.nowak@example.com' }]).embed({
    ...call,
    values: [chunks[0]!, other]
  });

  const [first, second] = embedded[0]!.values;
  assert.match(first!, /\[EMAIL_1\]/);
  assert.match(second!, /\[EMAIL_2\].*\[EMAIL_1\]/, 'ewa.nowak is new, and the address of the first text is the first text’s placeholder');
});

test('each call has a vault of its own: a placeholder means nothing outside the call it was issued in', async () => {
  const { inner, embedded } = rig(hosted, hosted);
  const gateway = wrap(inner, 'hosted', () => [...anna, { kind: 'email', value: 'ewa.nowak@example.com' }]);

  await gateway.embed({ ...call, values: ['Write to ewa.nowak@example.com.'] });
  await gateway.embed({ ...call, values: ['Write to anna.kowalska@example.com.'] });

  assert.equal(embedded[0]!.values[0], 'Write to [EMAIL_1].');
  assert.equal(embedded[1]!.values[0], 'Write to [EMAIL_1].', 'numbered from one again');
});

test('what the person has on their CV is asked for at each call, so a change is in force at the next one', async () => {
  const { inner, embedded } = rig(hosted, hosted);
  let seeds: readonly MaskSeed[] = [];
  const gateway = wrap(inner, 'hosted', () => seeds);
  const text = 'Anna Kowalska writes backend services.';

  await gateway.embed({ ...call, values: [text] });
  seeds = anna;
  await gateway.embed({ ...call, values: [text] });

  assert.equal(embedded[0]!.values[0], text, 'nothing to keep: the text');
  assert.match(embedded[1]!.values[0]!, /^\[NAME_1\] writes/);
});

test('a request with nothing in it to mask goes with its texts as they were', async () => {
  const { inner, embedded } = rig(hosted, hosted);
  const values = [chunks[2]!, 'Responsible for the on-call rota.'];

  const result = await wrap(inner).embed({ ...call, values });

  assert.deepEqual(embedded[0]!.values, values);
  assert.equal(result, answer);
});

test('a request with no texts is sent with none', async () => {
  const { inner, embedded } = rig(hosted, hosted);

  await wrap(inner).embed({ ...call, values: [] });

  assert.deepEqual(embedded[0]!.values, []);
});

test('with no seeds and no detectors there is nothing to keep, and the very request is sent', async () => {
  const { inner, embedded } = rig(hosted, hosted);
  const request = { ...call, values: chunks };

  await wrap(inner, 'hosted', () => [], false).embed(request);

  assert.equal(embedded[0], request);
});

test('with no seeds and the detectors on, what has the shape of an identifier is still kept', async () => {
  const { inner, embedded } = rig(hosted, hosted);

  await wrap(inner, 'hosted', () => [], true).embed({
    ...call,
    values: ['Referee: Marek Zieliński, marek.zielinski@example.org, tel. +48 501 234 567.', chunks[2]!]
  });

  assert.equal(embedded[0]!.values[0], 'Referee: Marek Zieliński, [EMAIL_1], tel. [PHONE_1].');
  assert.equal(embedded[0]!.values[1], chunks[2]);
});

/* ----------------------------------------------------------------- on the wire */

type Wire = { readonly url: string; readonly body: string };

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

/** The network: records every request and answers each with vectors. */
const onTheWire = async (run: (wire: Wire[]) => Promise<void>): Promise<void> => {
  const wire: Wire[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }): Promise<Response> => {
    const request: Wire = {
      url: typeof input === 'string' ? input : (input as { url?: string }).url ?? String(input),
      body: typeof init?.body === 'string' ? init.body : ''
    };
    wire.push(request);
    return vectors(request);
  }) as typeof globalThis.fetch;

  try {
    await run(wire);
  } finally {
    globalThis.fetch = real;
  }
};

const silent = { record: () => undefined };

const gatewayFor = (env: Readonly<Record<string, string>>, mode: MaskMode = 'hosted', seeds: readonly MaskSeed[] = anna): AiGateway =>
  maskedGateway(createAiGateway({ resolver: createModelResolver({ env }), logger: silent }), {
    mode,
    seeds: () => seeds,
    detect: true
  });

const hostedEmbedder = { AI_PROVIDER: 'local', EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-not-a-real-key' };

test('a hosted embedder has nothing of the person in the request, and the vectors come back as they would have', async () => {
  await onTheWire(async (wire) => {
    const result = await gatewayFor(hostedEmbedder).embed({ ...call, values: chunks });

    assert.equal(wire.length, 1);
    assert.match(wire[0]!.url, /api\.openai\.com/);
    assert.deepEqual(leaks([wire[0]!.body]), []);
    const sent = (JSON.parse(wire[0]!.body) as { input: string[] }).input;
    assert.match(sent[0]!, /\[NAME_1\]/);
    assert.equal(sent[2], chunks[2]);
    assert.equal(result.vectors.length, 3);
    assert.deepEqual([...result.vectors[0]!], [0.6000000238418579, 0.800000011920929], 'L2-normalised, as always');
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'text-embedding-3-small');
    assert.equal(result.dim, 2);

    // What the index is stamped with is what it was before: a person who embeds on
    // a hosted provider is not made to embed everything again by this.
    const plain = await createAiGateway({ resolver: createModelResolver({ env: hostedEmbedder }), logger: silent }).embed({
      ...call,
      values: chunks
    });
    assert.deepEqual(fingerprintOf(result), fingerprintOf(plain));
    assert.deepEqual(fingerprintOf(result), {
      provider: 'openai',
      model: 'text-embedding-3-small',
      dim: 2,
      normalisation: 'l2',
      chunkerVersion: CHUNKER_VERSION
    });
  });
});

test('a writer that is not on the machine and an embedder that is: the embedder is sent the text as it always was', async () => {
  const env = { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-not-a-real-key' };

  await onTheWire(async (wire) => {
    await gatewayFor(env).embed({ ...call, values: chunks });

    assert.equal(wire.length, 1);
    assert.match(wire[0]!.url, /localhost:11434/);
    assert.equal((JSON.parse(wire[0]!.body) as { input: string[] }).input[0], chunks[0]);
  });
});

test('always keeps the person from an embedder on this machine too', async () => {
  await onTheWire(async (wire) => {
    await gatewayFor({ AI_PROVIDER: 'local' }, 'always').embed({ ...call, values: chunks });

    assert.match(wire[0]!.url, /localhost:11434/);
    assert.deepEqual(leaks([wire[0]!.body]), []);
  });
});

test('a person with nothing on their CV to keep is sent exactly what everyone else is, when the text has no identifier', async () => {
  const text = [chunks[2]!, 'Responsible for the on-call rota.'];
  const plain = createAiGateway({ resolver: createModelResolver({ env: hostedEmbedder }), logger: silent });

  await onTheWire(async (wire) => {
    await plain.embed({ ...call, values: text });
    await gatewayFor(hostedEmbedder, 'hosted', []).embed({ ...call, values: text });

    assert.equal(wire.length, 2);
    assert.equal(wire[1]!.body, wire[0]!.body);
  });
});

/* ------------------------------------------------------------------- the index */

const personal = { name: 'Ada Example', email: 'ada@example.com', phone: '+44 7700 900123', location: 'Krakow', links: {} };
const about = 'Ada Example (ada@example.com, +44 7700 900123) is a backend engineer who rewrote the billing pipeline.';

type Bench = {
  readonly harness: Harness;
  readonly dispatch: ReturnType<typeof createDispatch>;
  readonly hits: ChunkHit[][];
  dispose(): void;
};

const bench = (env: Readonly<Record<string, string>>, query = 'Ada Example ada@example.com billing'): Bench => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-embed-'));
  const hits: ChunkHit[][] = [];
  const capabilities: CapabilityMap = {
    probe: noop('probe', [
      stage('search', [
        transform('search', async (context) => {
          hits.push(await context.retrieval.search({ text: query, limit: 3 }, context.signal));
          return {};
        })
      ])
    ])
  };
  const harness = createHarness({
    databasePath: join(dir, 'harness.db'),
    capabilities,
    logger: silentLogger,
    env,
    indexRecovery: true,
    probe: () => Promise.reject(new Error('connection refused'))
  });
  // What Studio says when it connects. Until it is said, a rebuild that would be
  // masked waits (`masking-terms.test.ts`).
  harness.maskTerms.set([]);

  return {
    harness,
    dispatch: createDispatch(harness),
    hits,
    dispose() {
      harness.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

const writeCv = (it: Bench): void => {
  it.harness.documents.update(CV_ID, CV_KIND, () => cvDocumentSchema.parse({ personal, role_description: about }));
};

const until = async (what: string, done: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(done(), what);
};

const vectored = (it: Bench): boolean => {
  const summary = it.harness.indexRecovery.indexed(CV_ID);
  return summary.chunks > 0 && !summary.keywordOnly;
};

const inputsOf = (wire: Wire): string[] => (JSON.parse(wire.body) as { input: string[] }).input;

test('the index is built from placeholders when its embedder is hosted, and the text it keeps is the CV’s own', async () => {
  const it = bench(hostedEmbedder);

  try {
    await onTheWire(async (wire) => {
      writeCv(it);
      await until('the index holds its chunks', () => it.harness.chunks.lexical({ text: 'billing', limit: 3 }).length > 0);

      const sent = wire.flatMap(inputsOf);
      assert.ok(sent.length > 0, 'the embedder was called');
      assert.equal(sent.some((text) => text.includes('Ada Example') || text.includes('ada@example.com') || text.includes('7700 900123')), false);
      assert.ok(sent.some((text) => /\[NAME_1\]/.test(text) && /\[EMAIL_1\]/.test(text)));

      const [stored] = it.harness.chunks.lexical({ text: 'billing', limit: 3 });
      assert.ok(stored!.text.includes('Ada Example'), 'the person reads their own words');
      assert.ok(stored!.text.includes('ada@example.com'));
    });
  } finally {
    it.dispose();
  }
});

test('a question is searched for as placeholders when its embedder is hosted, and still finds what was built', async () => {
  const it = bench(hostedEmbedder);

  try {
    await onTheWire(async (wire) => {
      writeCv(it);
      await until('the index holds its chunks', () => it.harness.chunks.lexical({ text: 'billing', limit: 3 }).length > 0);
      await until('and its vectors', () => vectored(it));
      const built = wire.length;

      await it.harness.run({ capability: 'probe', input: {} });

      const asked = wire.slice(built).flatMap(inputsOf);
      assert.deepEqual(asked.length, 1);
      assert.equal(asked[0], '[NAME_1] [EMAIL_1] billing');

      const [found] = it.hits;
      assert.ok(found!.length > 0);
      assert.ok(found![0]!.found.includes('vector'), 'the fingerprint is the one the index was built under');
      assert.ok(found![0]!.found.includes('lexical'));
      assert.ok(found![0]!.text.includes('Ada Example'), 'the hit is the CV’s own text');
    });
  } finally {
    it.dispose();
  }
});

test('an embedder on this machine is sent the question as it was, until the person says always, and again after', async () => {
  const it = bench({});
  const set = (maskMode: string | null) => it.dispatch('settings.set', { settings: { maskMode } } as never);

  try {
    await onTheWire(async (wire) => {
      writeCv(it);
      await until('the index holds its chunks', () => it.harness.chunks.lexical({ text: 'billing', limit: 3 }).length > 0);
      await until('and its vectors', () => vectored(it));

      const asked = async (): Promise<string> => {
        const before = wire.length;
        await it.harness.run({ capability: 'probe', input: {} });
        return inputsOf(wire[before]!)[0]!;
      };

      assert.equal(await asked(), 'Ada Example ada@example.com billing');
      assert.ok((await set('always')).ok);
      assert.equal(await asked(), '[NAME_1] [EMAIL_1] billing');
      assert.ok((await set(null)).ok);
      assert.equal(await asked(), 'Ada Example ada@example.com billing');
    });
  } finally {
    it.dispose();
  }
});

test('a person who has not written a CV is held to the shapes in their question and no more', async () => {
  const it = bench(hostedEmbedder, 'Is ada.lovelace@example.org a name I know?');

  try {
    await onTheWire(async (wire) => {
      await it.harness.run({ capability: 'probe', input: {} });

      assert.deepEqual(wire.flatMap(inputsOf), ['Is [EMAIL_1] a name I know?']);
    });
  } finally {
    it.dispose();
  }
});

test('the runtime says it keeps an embedder from a person’s details, once', async () => {
  const it = bench({});

  try {
    const reply = await it.dispatch('protocol.get', {} as never);
    assert.ok(reply.ok);
    const features = (reply.data as { features: string[] }).features;
    assert.equal(features.filter((feature) => feature === 'masking-embedding').length, 1);
    assert.ok(features.includes('masking'));
    assert.ok(features.includes('masking-detectors'));
  } finally {
    it.dispose();
  }
});
