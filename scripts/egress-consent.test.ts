/**
 * What a person hands in for an import goes, as it is, only where they agreed it
 * may: to a model on this machine, or to the one hosted provider they said yes to.
 *
 *   the rule       which provider may read a person's sources, and how a refusal
 *                  says which one it was
 *   the gateway    each call that carries text is refused before it goes, the
 *                  provider is asked at every call, and a call that waits for a
 *                  slot still goes where it was when it was checked
 *   a run          an import is refused before it reads a source, ends when a
 *                  call is refused in the middle (a screenshot's included), is
 *                  held to the same on a resume, and a refused call is never
 *                  counted as made
 *   the hosts      Studio's channel and the command line, with a network that
 *                  records every request
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 37 were applied, and all 37 fail at least one test here.
 *
 * src/effects/consent.ts:
 *   a hosted provider agreed to is refused all the same                7
 *   every provider may read it                                         11
 *   a model on this machine needs agreeing to                          7
 *   the agreed name is matched whatever its case                       1
 *   the agreed name is matched with its spaces trimmed                 1
 *   the refusal names no provider                                      3
 *   the refusal says it is misconfigured                               11
 *   the gateway asks where it goes once, when it is made               5
 *   a structured call is not checked                                   2
 *   a text call is not checked                                         4
 *   an image is not checked                                            2
 *   a tool loop is not checked                                         1
 *   an embedding is checked as well                                    1
 *   a refused text call throws instead of failing                      3
 *   a gateway that cannot say where it embeds is given a way to        1
 *
 * src/effects/ai.ts:
 *   a call's model is built from the settings once it has a slot       1
 *   an embedding's model is built from the settings once it has a slot 1
 *   a pinned call takes the model the settings name by then            2
 *   a pinned call takes the local address the settings name by then    2
 *   a pinned call drops the gateway's own override                     1
 *
 * src/runtime/run.ts:
 *   a run's calls are not held to what was agreed                      3
 *   every run is held, whatever its capability                         1
 *   a run is held to an agreement read from no input                   3
 *   the mask is put over the check, not under it                       1
 *   the source reader is not handed the run's gateway                  1
 *
 * src/runtime/needs.ts:
 *   a run is not asked before it begins                                3
 *   a run refused before it begins says only that a need was unmet     4
 *   a run that would be refused before it begins is let go on          3
 *
 * src/core/orchestrator.ts:
 *   a refused call is taken for a step that found nothing              1
 *
 * src/capabilities/cv/extract.ts:
 *   an import is not held to what was agreed                           5
 *   an import does not take what was agreed                            4
 *   a screenshot that would go where nobody agreed is skipped          1
 *
 * src/effects/sources.ts:
 *   a reader handed a gateway keeps its own                            1
 *
 * src/adapters/ipc/dispatch.ts:
 *   protocol.get does not say egress-consent                           1
 *
 * src/adapters/cli/main.ts:
 *   --consent is kept out of the input                                 1
 *   the refusal says nothing of how to agree                           1
 *   a refusal before a run begins is printed as any failure is         1
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response as Reply } from '../src/adapters/ipc/channels.js';
import { capabilities } from '../src/capabilities/index.js';
import { CV_ID, asCvDocument } from '../src/capabilities/cv/document.js';
import { RuntimeError, isRunSuspension } from '../src/contracts/index.js';
import type { AiGateway, ObjectRequest, SourceReader } from '../src/contracts/index.js';
import { createAiGateway } from '../src/effects/ai.js';
import { consentRefusal, consentedGateway } from '../src/effects/consent.js';
import { createSourceReader } from '../src/effects/sources.js';
import { createModelResolver } from '../src/providers/resolve.js';
import { createHarness } from '../src/runtime/create.js';
import { resumeRun } from '../src/runtime/resume.js';
import { beginRun, startRun } from '../src/runtime/run.js';
import type { RuntimeDeps } from '../src/runtime/run.js';
import { CHAT_RUN, chat, refusal } from './support/chat.js';
import { noop, spine, stage, stubGateway, transform } from './support/spine.js';

/* ------------------------------------------------------------------- the rule */

test('a model on this machine may always read what was handed in, and a hosted one only when it is the one agreed to', () => {
  assert.equal(consentRefusal('local', undefined), undefined);
  assert.equal(consentRefusal('local', 'openai'), undefined);
  for (const provider of ['openai', 'openrouter', 'huggingface']) {
    assert.equal(consentRefusal(provider, provider), undefined, provider);
  }
});

test('any other is refused by its exact name, with a code of its own that names it', () => {
  const cases: [string, string | undefined][] = [
    ['openai', undefined],
    ['openai', 'openrouter'],
    ['openai', 'OpenAI'],
    ['openai', 'openai '],
    ['openai', ''],
    // Agreeing to this machine is not agreeing to anywhere else.
    ['openrouter', 'local']
  ];

  for (const [provider, consented] of cases) {
    const refused = consentRefusal(provider, consented);
    assert.ok(refused instanceof RuntimeError, `${provider} agreed as ${String(consented)}`);
    assert.equal(refused.code, 'egress_consent_required');
    assert.ok(refused.message.includes(`"${provider}"`), refused.message);
  }
});

/* ---------------------------------------------------------------- the gateway */

const call = { traceId: 'trace', signal: new AbortController().signal };

/** A gateway whose provider a test can change, which keeps the name of each call that reached it. */
const reaching = (initial: string, options: { embedding?: boolean } = {}) => {
  let providerId = initial;
  const reached: string[] = [];
  const inner = stubGateway({
    describe: () => ({ providerId, modelId: 'm' }),
    ...(options.embedding ? { describeEmbedding: () => ({ providerId: 'openai', modelId: 'e' }) } : {}),
    generateObject: async <T>() => {
      reached.push('object');
      return { object: { answered: 'object' } as T, finishReason: 'stop', usage: {} };
    },
    generateText: async () => {
      reached.push('text');
      return { text: 'text', finishReason: 'stop', usage: {} };
    },
    transcribeImage: async () => {
      reached.push('image');
      return { text: 'image', finishReason: 'stop', usage: {} };
    },
    runToolLoop: async () => {
      reached.push('loop');
      return { text: 'loop', steps: 1, finishReason: 'stop', usage: {} };
    },
    embed: async () => {
      reached.push('embed');
      return { vectors: [], provider: 'openai', model: 'e', dim: 0 };
    }
  });
  return { inner, reached, go: (id: string) => void (providerId = id) };
};

/** The four calls that carry text to a model, each with what it answers when it goes. */
const carrying: Record<string, { make: (ai: AiGateway) => Promise<unknown>; answer: unknown }> = {
  object: {
    make: (ai) => ai.generateObject({ ...call, schema: z.object({}).passthrough(), system: 's', prompt: 'p', maxOutputTokens: 10 }),
    answer: { answered: 'object' }
  },
  text: { make: (ai) => ai.generateText({ ...call, system: 's', prompt: 'p', maxOutputTokens: 10 }), answer: 'text' },
  image: {
    make: (ai) => ai.transcribeImage({ ...call, bytes: new Uint8Array([1]), mediaType: 'image/png', instruction: 'Read it.', maxOutputTokens: 10 }),
    answer: 'image'
  },
  loop: { make: (ai) => ai.runToolLoop({ ...call, system: 's', prompt: 'p', tools: [], maxSteps: 1 }), answer: 'loop' }
};

const answerOf = (result: unknown): unknown => {
  const { object, text } = result as { object?: unknown; text?: unknown };
  return object ?? text;
};

test('each call that carries text is refused, as a failed call is, before it reaches the gateway', async () => {
  for (const consented of [undefined, 'openrouter']) {
    const r = reaching('openai');
    const ai = consentedGateway(r.inner, consented);

    for (const [name, { make }] of Object.entries(carrying)) {
      let pending: Promise<unknown> | undefined;
      assert.doesNotThrow(() => void (pending = make(ai)), `${name} throws where it should reject`);
      await assert.rejects(pending!, { code: 'egress_consent_required' }, name);
    }
    assert.deepEqual(r.reached, []);
  }
});

test('and each goes, and comes back as it was answered, to this machine or to the one agreed to', async () => {
  const cases: [string, string | undefined][] = [['local', undefined], ['local', 'openai'], ['openai', 'openai']];

  for (const [provider, consented] of cases) {
    const r = reaching(provider);
    const ai = consentedGateway(r.inner, consented);

    for (const [name, { make, answer }] of Object.entries(carrying)) {
      assert.deepEqual(answerOf(await make(ai)), answer, `${name} to ${provider}`);
    }
    assert.deepEqual(r.reached, ['object', 'text', 'image', 'loop'], provider);
  }
});

test('an embedding is not held to it, and saying where a call would go sends nothing', async () => {
  const r = reaching('openai', { embedding: true });
  const ai = consentedGateway(r.inner, undefined);

  await ai.embed({ ...call, values: ['Ada Example'] });
  assert.deepEqual(r.reached, ['embed']);
  assert.deepEqual(ai.describe(), { providerId: 'openai', modelId: 'm' });
  assert.deepEqual(ai.describeEmbedding?.(), { providerId: 'openai', modelId: 'e' });

  // A gateway that cannot say where it embeds is not given a way to.
  assert.equal('describeEmbedding' in consentedGateway(reaching('openai').inner, undefined), false);
});

test('the provider is asked at each call, so one changed between calls is held to as well', async () => {
  const r = reaching('local');
  const ai = consentedGateway(r.inner, 'openai');
  const text = carrying.text!.make;

  await text(ai);
  r.go('openrouter');
  await assert.rejects(text(ai), { code: 'egress_consent_required' });
  r.go('openai');
  await text(ai);
  r.go('local');
  await text(ai);

  assert.deepEqual(r.reached, ['text', 'text', 'text']);
});

/* ------------------------------------------------------------------ the network */

type Wire = { readonly url: string; readonly body: string; readonly authorization: string | null };

const completion = (content: string): Response =>
  new Response(
    JSON.stringify({
      id: 'cmpl',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

const embeddings = (count: number): Response =>
  new Response(
    JSON.stringify({
      object: 'list',
      model: 'e',
      data: Array.from({ length: count }, (_, index) => ({ object: 'embedding', index, embedding: [1, 0, 0] })),
      usage: { prompt_tokens: 1, total_tokens: 1 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

/** The network: keeps every request, in order, and answers each with what `answer` makes of it. */
const onTheWire = async (
  answer: (request: Wire, count: number) => Promise<Response> | Response,
  run: (wire: Wire[]) => Promise<void>
): Promise<void> => {
  const wire: Wire[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: { body?: unknown; headers?: unknown }): Promise<Response> => {
    const request: Wire = {
      url: typeof input === 'string' ? input : (input as { url?: string }).url ?? String(input),
      body: typeof init?.body === 'string' ? init.body : '',
      authorization: new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]).get('authorization')
    };
    wire.push(request);
    return answer(request, wire.length);
  }) as typeof globalThis.fetch;

  try {
    await run(wire);
  } finally {
    globalThis.fetch = real;
  }
};

const until = async (condition: () => boolean, what: string): Promise<void> => {
  for (let tries = 0; tries < 2_000 && !condition(); tries += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(condition(), what);
};

const hostOf = (request: Wire): string => new URL(request.url).host;
const modelOf = (request: Wire): unknown => (JSON.parse(request.body) as { model?: unknown }).model;
const silent = { record: () => undefined };
const HERE = 'http://127.0.0.1:9/v1';
const ELSEWHERE_HERE = 'http://127.0.0.1:10/v1';

test('a call that waits for a slot goes where it was when it was checked, whatever the settings say once it has one', async () => {
  const env: Record<string, string> = { AI_PROVIDER: 'local', AI_MODEL: 'gemma-small', LOCAL_BASE_URL: HERE };
  const ai = consentedGateway(
    // With a key of its own, which a call keeps wherever it goes.
    createAiGateway({ resolver: createModelResolver({ env }), logger: silent, concurrency: 1, override: { apiKey: 'sk-its-own' } }),
    undefined
  );
  const text = (): Promise<unknown> =>
    ai.generateText({ ...call, system: 's', prompt: 'Ada Example, ada@example.com.', maxOutputTokens: 10, maxRetries: 0 });

  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));

  await onTheWire(
    async (_, count) => {
      if (count === 1) await held;
      return completion('ok');
    },
    async (wire) => {
      const first = text();
      // Checked against this machine, and then waits behind the first for the slot.
      const second = text();
      await until(() => wire.length === 1, 'the first call reached the network');

      env.AI_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'sk-not-a-real-key';
      env.LOCAL_BASE_URL = ELSEWHERE_HERE;
      release();
      await Promise.all([first, second]);

      assert.deepEqual(wire.map(hostOf), ['127.0.0.1:9', '127.0.0.1:9']);
      assert.deepEqual(wire.map(modelOf), ['gemma-small', 'gemma-small']);
      assert.deepEqual(wire.map((request) => request.authorization), ['Bearer sk-its-own', 'Bearer sk-its-own']);
      // A call that begins now is asked about where the settings point now.
      await assert.rejects(text(), { code: 'egress_consent_required' });
      assert.equal(wire.length, 2);
    }
  );
});

test('and so does an embedding, whose vectors say where they were made', async () => {
  const env: Record<string, string> = { EMBEDDING_PROVIDER: 'local', EMBEDDING_MODEL: 'nomic-small', LOCAL_BASE_URL: HERE };
  const ai = createAiGateway({ resolver: createModelResolver({ env }), logger: silent, concurrency: 1 });

  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));

  await onTheWire(
    async (_, count) => {
      if (count === 1) await held;
      return embeddings(1);
    },
    async (wire) => {
      const first = ai.embed({ ...call, values: ['one'] });
      const second = ai.embed({ ...call, values: ['two'] });
      await until(() => wire.length === 1, 'the first embedding reached the network');

      env.EMBEDDING_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'sk-not-a-real-key';
      env.LOCAL_BASE_URL = ELSEWHERE_HERE;
      release();
      const made = await Promise.all([first, second]);

      assert.deepEqual(wire.map(hostOf), ['127.0.0.1:9', '127.0.0.1:9']);
      assert.deepEqual(wire.map(modelOf), ['nomic-small', 'nomic-small']);
      assert.deepEqual(made.map((result) => [result.provider, result.model]), [['local', 'nomic-small'], ['local', 'nomic-small']]);
    }
  );
});

/* ---------------------------------------------------------------------- a run */

const CV_TEXT = 'Ada Example\nada@example.test\n\nSummary\n\nBackend engineer who rewrote a billing pipeline.';
const textSource = { kind: 'text', label: 'cv.txt', text: CV_TEXT };
const screenshot = { kind: 'bytes', label: 'profile.png', mime: 'image/png', base64: 'iVBORw0KGgo=' };

const ANSWERS: Readonly<Record<string, Record<string, unknown>>> = {
  personal: { name: 'Ada Example', email: 'ada@example.test', phone: '', location: '', links: [] }
};

/**
 * An import over a runtime whose provider a test can change. It keeps what the
 * model was asked, step by step, and what the reader read.
 */
const importing = (initial: string, sources?: (go: (id: string) => void) => SourceReader) => {
  let providerId = initial;
  const go = (id: string): void => void (providerId = id);
  const reached: string[] = [];
  const read: string[] = [];

  const plain: SourceReader = {
    through() {
      return this;
    },
    read: async (input) => {
      read.push(input.kind);
      return { text: input.kind === 'text' ? input.text : 'Transcribed.', via: 'plain' };
    }
  };

  const s = spine(capabilities, {
    ai: {
      describe: () => ({ providerId, modelId: 'm' }),
      generateObject: async <T>(request: ObjectRequest<T>) => {
        reached.push(`object ${request.step ?? ''}`);
        return { object: (ANSWERS[request.step ?? ''] ?? {}) as T, finishReason: 'stop', usage: {} };
      },
      transcribeImage: async () => {
        reached.push('image');
        return { text: CV_TEXT, finishReason: 'stop', usage: {} };
      },
      embed: async (request) => {
        reached.push('embed');
        return { vectors: request.values.map(() => Float32Array.from([1, 0, 0])), provider: 'test', model: 'e', dim: 3 };
      }
    },
    effects: { sources: sources?.(go) ?? plain }
  });

  const stored = () => {
    const record = s.deps.documents.read(CV_ID);
    return record === undefined ? undefined : asCvDocument(record.body);
  };
  const last = () => s.runs.list({ limit: 1 })[0];

  return { s, go, reached, read, stored, last };
};

test('an import to a hosted provider nobody agreed to is refused before it reads a source, and leaves nothing', async () => {
  const cases: Record<string, unknown>[] = [
    {},
    { consent: 'openrouter' },
    // The whole import is held, a section that asks no model included.
    { sections: ['role_description'] }
  ];

  for (const over of cases) {
    const i = importing('openai');
    try {
      await assert.rejects(startRun(i.s.deps, { capability: 'extract_cv', input: { sources: [textSource], ...over } }), (error: Error & { code?: string }) => {
        assert.equal(error.code, 'egress_consent_required');
        assert.ok(error.message.includes('"openai"'), error.message);
        return true;
      });

      assert.deepEqual(i.read, [], 'no source was read');
      assert.deepEqual(i.reached, [], 'no model was asked');
      assert.equal(i.stored(), undefined);
      assert.equal(i.last()?.status, 'failed');
      assert.equal(i.last()?.errorCode, 'egress_consent_required');
    } finally {
      i.s.dispose();
    }
  }
});

test('an import goes to the provider agreed to, or to this machine without asking, and its run keeps what was agreed', async () => {
  const cases: [string, string | undefined][] = [['openai', 'openai'], ['local', undefined], ['local', 'openai']];

  for (const [provider, consent] of cases) {
    const i = importing(provider);
    try {
      await startRun(i.s.deps, {
        capability: 'extract_cv',
        input: { sources: [textSource], sections: ['personal'], ...(consent === undefined ? {} : { consent }) }
      });

      assert.deepEqual(i.read, ['text']);
      assert.deepEqual(i.reached, ['object personal'], provider);
      assert.equal(i.stored()?.personal.name, 'Ada Example');
      assert.equal(i.last()?.status, 'succeeded');
      assert.equal(i.last()?.input.consent, consent);
    } finally {
      i.s.dispose();
    }
  }
});

test('a capability that does not send what it was handed is not held to it', async () => {
  const reached: string[] = [];
  const s = spine(
    {
      writes: noop('writes', [
        stage('write', [
          transform('write', async (context) => {
            await context.effects.ai.generateText({ traceId: context.traceId, signal: context.signal, system: 's', prompt: 'p', maxOutputTokens: 10 });
            return {};
          })
        ])
      ])
    },
    {
      ai: {
        describe: () => ({ providerId: 'openai', modelId: 'm' }),
        generateText: async () => {
          reached.push('text');
          return { text: 'ok', finishReason: 'stop', usage: {} };
        }
      }
    }
  );

  try {
    await startRun(s.deps, { capability: 'writes', input: {} });
    assert.deepEqual(reached, ['text']);
  } finally {
    s.dispose();
  }
});

test('a provider changed in the middle of an import ends it, and is not taken for a section that found nothing', async () => {
  for (const over of [{}, { sections: ['personal'] }]) {
    const i = importing('local', (go) => ({
      through() {
        return this;
      },
      read: async (input) => {
        // Asked about before the run began, and changed before its first call.
        go('openai');
        return { text: input.kind === 'text' ? input.text : '', via: 'plain' };
      }
    }));

    try {
      await assert.rejects(startRun(i.s.deps, { capability: 'extract_cv', input: { sources: [textSource], ...over } }), {
        code: 'egress_consent_required'
      });

      assert.deepEqual(i.reached, [], 'no section was sent');
      assert.equal(i.stored(), undefined, 'and nothing was saved as though none had been found');
      assert.equal(i.last()?.errorCode, 'egress_consent_required');
      assert.deepEqual(i.last()?.degraded ?? [], []);
    } finally {
      i.s.dispose();
    }
  }
});

/**
 * A reader that reads a screenshot through whatever gateway it is handed, as the
 * real one does, and that moves the provider while it reads one: to `during` for
 * the read, and back to this machine after it.
 */
const screenshots =
  (raw: AiGateway, during: string) =>
  (go: (id: string) => void): SourceReader => {
    const over = (reader: SourceReader): SourceReader => ({
      through: (ai) => over(reader.through(ai)),
      read: async (input, effect) => {
        if (input.kind === 'text') return reader.read(input, effect);
        go(during);
        try {
          return await reader.read(input, effect);
        } finally {
          go('local');
        }
      }
    });
    return over(createSourceReader({ ai: raw }));
  };

test("a screenshot is read through the run's own gateway, and one that would go where nobody agreed ends the import", async () => {
  const behind: string[] = [];
  const raw = stubGateway({
    transcribeImage: async () => {
      behind.push('image');
      return { text: CV_TEXT, finishReason: 'stop', usage: {} };
    }
  });

  // On this machine throughout: read by the run's gateway, never the one behind it.
  const here = importing('local', screenshots(raw, 'local'));
  try {
    await startRun(here.s.deps, { capability: 'extract_cv', input: { sources: [screenshot], sections: ['personal'] } });
    assert.deepEqual(here.reached, ['image', 'object personal']);
    assert.equal(here.stored()?.sources[0]?.kind, 'ocr');
  } finally {
    here.s.dispose();
  }

  // Moved away while the screenshot is read: the rest could still be read, and is not.
  const away = importing('local', screenshots(raw, 'openai'));
  try {
    await assert.rejects(
      startRun(away.s.deps, { capability: 'extract_cv', input: { sources: [screenshot, textSource], sections: ['personal'] } }),
      { code: 'egress_consent_required' }
    );
    assert.deepEqual(away.reached, []);
    assert.equal(away.stored(), undefined);
  } finally {
    away.s.dispose();
  }

  assert.deepEqual(behind, []);
});

test('a run picked back up is held to what was agreed when it began, before it does anything', async () => {
  let providerId = 'openai';
  const did: string[] = [];
  const held = noop(
    'held',
    [
      stage('ask', [
        transform('ask', async (context) => {
          context.approvals.request({ key: 'go', kind: 'confirm', question: 'Go on?', payload: {} });
          return {};
        })
      ]),
      stage('read', [
        transform('read', async () => {
          did.push('read');
          return {};
        })
      ]),
      stage('send', [
        transform('send', async (context) => {
          await context.effects.ai.generateText({ traceId: context.traceId, signal: context.signal, system: 's', prompt: 'p', maxOutputTokens: 10 });
          return {};
        })
      ])
    ],
    { consented: (input) => (typeof input.consent === 'string' ? input.consent : undefined) }
  );
  const s = spine(
    { held },
    {
      ai: {
        describe: () => ({ providerId, modelId: 'm' }),
        generateText: async () => {
          did.push('text');
          return { text: 'ok', finishReason: 'stop', usage: {} };
        }
      }
    }
  );

  const parked = async (): Promise<string> => {
    const { runId, settled } = beginRun(s.deps, { capability: 'held', input: { consent: 'openai' } });
    await assert.rejects(settled, (error) => isRunSuspension(error));
    const [waiting] = s.approvals.pending(runId);
    s.approvals.decide(waiting!.id, { status: 'granted', decision: { confirmed: true }, decidedAt: Date.now() });
    return runId;
  };

  try {
    const moved = await parked();
    providerId = 'openrouter';
    await assert.rejects(resumeRun(s.deps, { runId: moved }), { code: 'egress_consent_required' });
    assert.deepEqual(did, []);
    assert.equal(s.runs.get(moved)?.errorCode, 'egress_consent_required');

    providerId = 'openai';
    const kept = await parked();
    await resumeRun(s.deps, { runId: kept });
    assert.deepEqual(did, ['read', 'text']);
  } finally {
    s.dispose();
  }
});

test("a call that is refused is not counted in the run's record as one that was made", async () => {
  let providerId = 'local';
  const sends = noop(
    'sends',
    [
      stage('send', [
        transform('send', async (context) => {
          const ask = () =>
            context.effects.ai.generateText({
              traceId: context.traceId,
              runId: context.runId,
              signal: context.signal,
              system: 'You help.',
              prompt: 'Write to Ada Example at ada@example.com.',
              maxOutputTokens: 10
            });
          await ask();
          providerId = 'openrouter';
          await ask();
          return {};
        })
      ])
    ],
    { consented: () => undefined }
  );

  const c = chat({ probes: { sends } });
  const deps: RuntimeDeps = {
    ...c.deps,
    masking: { mode: () => 'hosted' },
    effects: { ...c.deps.effects, ai: { ...c.deps.effects.ai, describe: () => ({ providerId, modelId: 'm' }) } }
  };

  try {
    const run = beginRun(deps, { capability: 'sends', input: {}, ...CHAT_RUN, runId: 'refused' });
    assert.equal((await refusal(run)).code, 'egress_consent_required');

    assert.equal(c.requests.length, 1);
    assert.deepEqual(c.records.read('refused')?.masking, { masked: 0, unmasked: 1, placeholders: {} });
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------ the hosts */

const data = <T>(response: Reply): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

test("Studio's channel says it holds imports, and an import over it goes to a hosted provider only when it is named", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-consent-'));
  const harness = createHarness({
    databasePath: join(dir, 'harness.db'),
    env: { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-not-a-real-key' },
    probe: () => Promise.reject(new Error('connection refused'))
  });
  const dispatch = createDispatch(harness);

  try {
    assert.ok(data<{ features: string[] }>(await dispatch('protocol.get', {})).features.includes('egress-consent'));
    const context = harness.cvContexts.create(randomUUID(), 'en');

    const start = async (consent?: string): Promise<Reply> => {
      const runId = randomUUID();
      data(
        await dispatch('run.context.start', {
          capability: 'extract_cv',
          input: { sources: [textSource], sections: ['personal'], persist: false, ...(consent === undefined ? {} : { consent }) },
          contextId: context.id,
          runId
        })
      );
      return dispatch('run.await', { runId });
    };

    await onTheWire(
      () => completion(JSON.stringify(ANSWERS.personal)),
      async (wire) => {
        for (const consent of [undefined, 'openai']) {
          const refused = await start(consent);
          assert.equal(refused.ok, false);
          if (!refused.ok) assert.equal(refused.error.code, 'egress_consent_required');
        }
        assert.equal(wire.length, 0, 'nothing was sent');

        const went = data<{ data: { document: { personal: { name: string } } } }>(await start('openrouter'));
        assert.equal(went.data.document.personal.name, 'Ada Example');
        assert.ok(wire.length > 0 && wire.every((request) => hostOf(request) === 'openrouter.ai'), JSON.stringify(wire.map(hostOf)));
      }
    );
  } finally {
    harness.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the command line hands --consent to an import as what was agreed, and says how to agree when it is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-consent-'));
  const keys = ['ENV_FILE', 'AI_PROVIDER', 'OPENROUTER_API_KEY', 'CVITAE_DB'] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const real = { error: console.error, log: console.log, fetch: globalThis.fetch };
  const said: string[] = [];
  const sent: string[] = [];

  // Before the entry point is loaded, which reads the files named here: none, so
  // no key of this machine's is in the process.
  process.env.ENV_FILE = join(dir, 'none.env');
  process.env.AI_PROVIDER = 'openrouter';
  process.env.OPENROUTER_API_KEY = 'sk-not-a-real-key';
  process.env.CVITAE_DB = join(dir, 'unused.db');
  console.error = (...parts: unknown[]) => void said.push(parts.join(' '));
  console.log = () => undefined;
  globalThis.fetch = (async (input: unknown) => {
    sent.push(String(input));
    throw new Error('no network in this test');
  }) as typeof globalThis.fetch;

  try {
    const { capabilityInput, main, parseArgs } = await import('../src/adapters/cli/main.js');
    assert.deepEqual(capabilityInput(parseArgs(['run', 'extract_cv', '--consent', 'openai', '--text', 'x']).flags), { consent: 'openai' });

    const run = (...more: string[]) =>
      main(['run', 'extract_cv', '--text', CV_TEXT, '--sections', '["role_description"]', '--persist', 'false', '--db', join(dir, 'cli.db'), ...more]);

    assert.equal(await run(), 1);
    assert.ok(said.some((line) => line.startsWith('[egress_consent_required]') && line.includes('"openrouter"')), said.join('\n'));
    assert.ok(said.some((line) => line.includes('--consent')), said.join('\n'));

    said.length = 0;
    assert.equal(await run('--consent', 'openai'), 1);
    assert.ok(said.some((line) => line.startsWith('[egress_consent_required]')), said.join('\n'));

    said.length = 0;
    assert.equal(await run('--consent', 'openrouter'), 0, said.join('\n'));
    assert.deepEqual(sent, []);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    console.error = real.error;
    console.log = real.log;
    globalThis.fetch = real.fetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
