/**
 * What masking did, in numbers: how many placeholders of each kind a model was
 * sent, on each call's line in `ai_calls` and summed in the record of the run the
 * calls were made for. Counts by kind and never what a placeholder stood for.
 *
 * The rule the record keeps for what a run was given holds here too: nothing a
 * model is sent goes before it is written down. So a call is counted before it
 * goes, what a tool hands the model is counted before the model has it, and a
 * call that cannot be counted is not made.
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 59 were applied: 58 fail at least one test here, and 1 cannot be told from the original.
 *
 * src/effects/mask.ts:
 *   the vault counts no placeholder                            12
 *   the vault counts two for each placeholder                  10
 *   the vault counts a placeholder each time it is used        3
 *   the vault counts the highest number, skips and all         1
 *   the vault hands out its own count, not a copy              4
 *
 * src/contracts/mask.ts:
 *   two counts: the second replaces the first                  3
 *   two counts: the first is dropped                           3
 *   two counts: the first is written into                      5
 *   two counts: a kind the second has none of is set to 0      6
 *
 * src/effects/masking.ts:
 *   a call as it came is counted as masked                     3
 *   a call as it came is not counted                           4
 *   a call as it came keeps a count a caller put on it         1
 *   a call as it came is always copied                         1
 *   a masked call is counted with no placeholders              6
 *   a masked call is counted as one that went as it was        7
 *   a masked call is not counted                               9
 *   the line asks the count as last told, not the vault        0 (equivalent: the count as last told is brought up to
 *       date each time a tool result or failure is masked, which is the only time a
 *       placeholder can be issued once the call is counted)
 *   what a tool added is counted again each time               1
 *   a tool that added nothing is counted as adding nothing     1
 *   a kind with nothing new counts as new                      2
 *   what a tool added is counted whole                         2
 *   a tool result is not counted                               2
 *   a tool result is counted before it is masked               2
 *   a tool failure is not counted                              1
 *   a tool failure is counted before it is masked              1
 *   a structured call is counted before its texts are masked   1
 *   a structured call says nothing of what it sent             2
 *   a text call says nothing of what it sent                   6
 *   a tool loop is counted before its texts are masked         3
 *   a tool loop says nothing of what it sent                   1
 *   a tool loop does not count what its tools add              3
 *   an embedding says nothing of what it sent, and is not counted 1
 *   an embedding is counted before it is masked                1
 *   an image is not counted                                    2
 *   an image whose count fails throws instead of failing       1
 *
 * src/effects/ai.ts:
 *   an ok line says nothing of what was masked                 2
 *   a failed line says nothing of what was masked              1
 *   a line takes nothing kept for nothing masked               1
 *   a line is told what was sent when the call began           1
 *
 * src/storage/sqlite/ai-log.ts:
 *   the table keeps no count                                   2
 *   the table keeps nothing for a count of none                1
 *   a count is not read back from the table                    2
 *
 * src/runtime/create.ts:
 *   the echoed line says nothing of what was masked            1
 *   the echoed line counts kinds, not placeholders             1
 *   the echoed line leaves out a count of none                 1
 *
 * src/storage/sqlite/grounding-record.ts:
 *   a record takes the last count of masked calls              3
 *   a record keeps the first count of calls sent as they were  2
 *   a record takes the last placeholders                       2
 *   a record starts again at each count                        3
 *   a record that is not open takes a count                    1
 *   a count for no record is not refused                       1
 *   a count is not read back from the record                   5
 *   a record with no count says it has none                    2
 *
 * src/runtime/grounding.ts:
 *   the recorder drops a count                                 3
 *   the recorder counts in the wrong run                       3
 *
 * src/runtime/run.ts:
 *   a run with a record does not count its calls               2
 *
 * src/adapters/ipc/dispatch.ts:
 *   protocol.get does not say masking-counts                   1
 *
 * src/storage/sqlite/migrations/0048-mask-counts.ts:
 *   the migration gives a call no place for its count          3
 *   the migration gives a record no place for its count        6
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
import { cvDocumentSchema } from '../src/capabilities/cv/document.js';
import { addMaskCounts } from '../src/contracts/index.js';
import type {
  AiGateway,
  AiLogEntry,
  CapabilityMap,
  MaskCounts,
  MaskMode,
  MaskSeed,
  MaskTally,
  NewRun,
  ObjectRequest,
  TextRequest,
  ToolHandle,
  ToolLoopRequest
} from '../src/contracts/index.js';
import { createAiGateway } from '../src/effects/ai.js';
import { createVault } from '../src/effects/mask.js';
import { maskedGateway } from '../src/effects/masking.js';
import { createCheckpointer } from '../src/runs/checkpoint.js';
import { aiLine, createHarness } from '../src/runtime/create.js';
import { createRecorder, defaultWells } from '../src/runtime/grounding.js';
import { recoverInterruptedRuns } from '../src/runtime/recover.js';
import { beginRun } from '../src/runtime/run.js';
import type { RuntimeDeps } from '../src/runtime/run.js';
import { createAiLog } from '../src/storage/sqlite/ai-log.js';
import { createRecordStore } from '../src/storage/sqlite/grounding-record.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { open } from '../src/storage/sqlite/open.js';
import { createRunStore } from '../src/storage/sqlite/run-store.js';
import { CHAT_RUN, chat, cv, job } from './support/chat.js';
import type { Chat } from './support/chat.js';
import { scratch } from './support/db.js';
import { callFor, fakeResolver } from './support/models.js';
import { noop, recorder, stage, stubGateway, transform } from './support/spine.js';

/* --------------------------------------------------------------------- the vault */

const anna: readonly MaskSeed[] = [
  { kind: 'name', value: 'Anna Kowalska' },
  { kind: 'email', value: 'anna.kowalska@example.com' },
  { kind: 'phone', value: '+48 600 123 456' }
];

test('a vault counts one placeholder for each spelling of each value, however often it is replaced', () => {
  const vault = createVault(anna, { detect: true });
  assert.deepEqual(vault.placeholders(), {}, 'nothing yet');

  vault.mask('Anna Kowalska wrote to anna.kowalska@example.com, and Anna Kowalska wrote again.');
  assert.deepEqual(vault.placeholders(), { name: 1, email: 1 });

  vault.mask('ANNA KOWALSKA, anna.kowalska@example.com, PESEL 44051401359.');
  assert.deepEqual(vault.placeholders(), { name: 2, email: 1, id: 1 }, 'a second spelling is a second placeholder');
});

test('a number already taken in the text is skipped and not counted', () => {
  const vault = createVault(anna);
  vault.reserve('Write as [NAME_1] did.');

  assert.equal(vault.mask('Anna Kowalska'), '[NAME_2]');
  assert.deepEqual(vault.placeholders(), { name: 1 });
});

test('what a vault says it counted is a copy, which nothing that holds it can change', () => {
  const vault = createVault(anna);
  vault.mask('Anna Kowalska');

  const told = vault.placeholders() as Record<string, number>;
  told.name = 99;
  told.email = 5;

  assert.deepEqual(vault.placeholders(), { name: 1 });
});

test('two counts add up kind by kind, and neither is changed', () => {
  const a: MaskCounts = { name: 1, email: 2 };
  const b: MaskCounts = { name: 3, id: 1 };

  assert.deepEqual(addMaskCounts(a, b), { name: 4, email: 2, id: 1 });
  assert.deepEqual(addMaskCounts({}, {}), {});
  assert.deepEqual(addMaskCounts({}, b), b);
  assert.deepEqual(a, { name: 1, email: 2 });
  assert.deepEqual(b, { name: 3, id: 1 });
});

/* ------------------------------------------------------------------- the gateway */

const signal = new AbortController().signal;
const call = { traceId: 'trace', signal };
const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 };

type Provider = { providerId: string; modelId: string };
const hosted: Provider = { providerId: 'openai', modelId: 'gpt' };
const local: Provider = { providerId: 'local', modelId: 'gemma' };

/**
 * A gateway that keeps every request it is handed, and a list in which the tally
 * and the gateway write in turn: what happened first is first.
 */
const counting = (
  provider: Provider,
  options: {
    mode?: MaskMode;
    seeds?: readonly MaskSeed[];
    detect?: boolean;
    embedding?: Provider;
    loop?: (request: ToolLoopRequest) => Promise<string>;
    tally?: (add: MaskTally) => void;
  } = {}
) => {
  const order: (MaskTally | string)[] = [];
  const seen: unknown[] = [];
  const handed = (method: string, request: unknown) => {
    seen.push(request);
    order.push(method);
  };

  const inner: AiGateway = stubGateway({
    describe: () => provider,
    ...(options.embedding ? { describeEmbedding: () => options.embedding! } : {}),
    generateText: async (request) => {
      handed('text', request);
      return { text: 'ok', finishReason: 'stop', usage };
    },
    generateObject: async <T>(request: ObjectRequest<T>) => {
      handed('object', request);
      return { object: {} as T, finishReason: 'stop', usage };
    },
    runToolLoop: async (request) => {
      handed('loop', request);
      return { text: await (options.loop?.(request) ?? 'ok'), steps: 1, finishReason: 'stop', usage };
    },
    transcribeImage: async (request) => {
      handed('image', request);
      return { text: 'ok', finishReason: 'stop', usage };
    },
    embed: async (request) => {
      handed('embed', request);
      return { vectors: [], provider: 'p', model: 'm', dim: 0 };
    }
  });

  const wrapped = maskedGateway(inner, {
    mode: options.mode ?? 'hosted',
    seeds: () => options.seeds ?? anna,
    ...(options.detect === undefined ? {} : { detect: options.detect }),
    tally:
      options.tally ??
      ((add) => {
        order.push(add);
      })
  });

  return {
    wrapped,
    order,
    tallies: () => order.filter((item): item is MaskTally => typeof item !== 'string'),
    last: () => seen.at(-1) as { masked?: () => MaskCounts }
  };
};

const text = (over: Partial<TextRequest> = {}): TextRequest => ({
  ...call,
  system: 'You write letters for Anna Kowalska.',
  prompt: 'Her email is anna.kowalska@example.com.',
  maxOutputTokens: 100,
  ...over
});

const MASKED = (placeholders: MaskCounts): MaskTally => ({ masked: 1, unmasked: 0, placeholders });
const AS_IT_WAS: MaskTally = { masked: 0, unmasked: 1, placeholders: {} };
const MORE = (placeholders: MaskCounts): MaskTally => ({ masked: 0, unmasked: 0, placeholders });

test('a masked call is counted with what it holds before it goes, and its line can ask the same', async () => {
  const c = counting(hosted);
  await c.wrapped.generateText(text());

  assert.deepEqual(c.order, [MASKED({ name: 1, email: 1 }), 'text']);
  assert.deepEqual(c.last().masked?.(), { name: 1, email: 1 });
});

test('every kind of masked call is counted, and each once', async () => {
  const c = counting(hosted);
  const schema = z.object({ ok: z.boolean() });

  await c.wrapped.generateObject({ ...call, schema, system: 'For Anna Kowalska.', prompt: 'p', maxOutputTokens: 10 });
  await c.wrapped.runToolLoop({ ...call, system: 's', prompt: 'Call +48 600 123 456.', tools: [], maxSteps: 1 });
  // One vault for a batch: a value in two texts is one placeholder.
  await c.wrapped.embed({ ...call, values: ['Anna Kowalska codes.', 'Anna Kowalska writes.'] });

  assert.deepEqual(c.order, [
    MASKED({ name: 1 }),
    'object',
    MASKED({ phone: 1 }),
    'loop',
    MASKED({ name: 1 }),
    'embed'
  ]);
});

test('a masked call with nothing in it to keep is counted as masked, with no placeholders', async () => {
  const c = counting(hosted, { detect: true });
  await c.wrapped.generateText(text({ system: 's', prompt: 'Nothing personal here.' }));

  assert.deepEqual(c.order, [MASKED({}), 'text']);
  assert.deepEqual(c.last().masked?.(), {});
});

test('a call that goes as it came is counted as such, and is handed on as the very same request', async () => {
  const cases: { name: string; c: ReturnType<typeof counting> }[] = [
    { name: 'a local model under hosted', c: counting(local) },
    { name: 'nothing to keep and nothing to look for', c: counting(hosted, { seeds: [] }) }
  ];

  for (const { name, c } of cases) {
    const request = text();
    await c.wrapped.generateText(request);
    assert.equal(c.last(), request, name);
    assert.deepEqual(c.order, [AS_IT_WAS, 'text'], name);
  }
});

test('an embedding to a model on this machine is counted as one that went as it was', async () => {
  const c = counting(hosted, { embedding: local });
  await c.wrapped.embed({ ...call, values: ['Anna Kowalska'] });

  assert.deepEqual(c.order, [AS_IT_WAS, 'embed']);
});

test('an image is counted as a call that went as it was, and handed on as it came', async () => {
  const c = counting(hosted);
  const request = { ...call, image: new Uint8Array([1]), mediaType: 'image/png', prompt: 'Anna Kowalska', maxOutputTokens: 10 };
  await c.wrapped.transcribeImage(request as never);

  assert.equal(c.last(), request);
  assert.deepEqual(c.order, [AS_IT_WAS, 'image']);
});

test('only the gateway that masked a call says what it sent: a count a caller put on a request is dropped', async () => {
  const forged = () => ({ name: 40 });

  const passed = counting(local);
  await passed.wrapped.generateText({ ...text(), masked: forged });
  assert.equal(passed.last().masked, undefined, 'not masked, so it says nothing');
  assert.ok('masked' in (passed.last() as object), 'and says so in the request');

  const masked = counting(hosted);
  await masked.wrapped.generateText({ ...text(), masked: forged });
  assert.deepEqual(masked.last().masked?.(), { name: 1, email: 1 }, 'masked, so it says what it sent');
});

/* ------------------------------------------------------------------------ tools */

const handle = (invoke: (input: unknown) => Promise<unknown>): ToolHandle => ({
  name: 'search_profile',
  describe: 'Look something up.',
  inputSchema: z.object({ query: z.string() }),
  invoke
});

test('what a tool adds is counted before the model is handed it, and only what is new', async () => {
  const results = ['Write to anna.kowalska@example.com.', 'Anna Kowalska again.', 'And anna.kowalska@example.com again.'];
  let seenAt: number[] = [];

  const c = counting(hosted, {
    loop: async (request) => {
      for (let i = 0; i < results.length; i++) {
        await request.tools[0]!.invoke({ query: 'x' });
        seenAt = [...seenAt, c.tallies().length];
      }
      return 'done';
    }
  });

  let next = 0;
  await c.wrapped.runToolLoop({
    ...call,
    system: 's',
    prompt: 'For Anna Kowalska.',
    tools: [handle(async () => results[next++])],
    maxSteps: 4
  });

  assert.deepEqual(c.tallies(), [MASKED({ name: 1 }), MORE({ email: 1 })], 'a value already sent is not counted again');
  assert.deepEqual(seenAt, [2, 2, 2], 'the first result was counted before the model had it');
  assert.deepEqual(c.last().masked?.(), { name: 1, email: 1 }, 'and the line asks when it is written');
});

test('a tool that fails is counted for what its failure tells the model', async () => {
  let countedFirst = false;

  const c = counting(hosted, {
    loop: async (request) => {
      await request.tools[0]!.invoke({ query: 'x' }).catch(() => {
        countedFirst = c.tallies().length === 2;
      });
      return 'done';
    }
  });

  await c.wrapped.runToolLoop({
    ...call,
    system: 's',
    prompt: 'For Anna Kowalska.',
    tools: [handle(async () => {
      throw new Error('No line at +48 600 123 456.');
    })],
    maxSteps: 2
  });

  assert.deepEqual(c.tallies(), [MASKED({ name: 1 }), MORE({ phone: 1 })]);
  assert.ok(countedFirst, 'before the model was told');
});

test('a call that cannot be counted is not made, masked or not', async () => {
  const broken = () => {
    throw new Error('the record is gone');
  };

  for (const provider of [hosted, local]) {
    const c = counting(provider, { tally: broken });
    await assert.rejects(c.wrapped.generateText(text()), /the record is gone/, provider.providerId);
    assert.deepEqual(c.order, [], `${provider.providerId}: nothing was sent`);
  }

  const image = counting(hosted, { tally: broken });
  await assert.rejects(image.wrapped.transcribeImage({ ...call, prompt: 'p', maxOutputTokens: 1 } as never), /gone/);
  assert.deepEqual(image.order, []);
});

test('a tool result that cannot be counted is not handed to the model', async () => {
  let calls = 0;
  const handedBack: unknown[] = [];

  const c = counting(hosted, {
    tally: () => {
      calls += 1;
      if (calls > 1) throw new Error('the record is gone');
    },
    loop: async (request) => {
      await request.tools[0]!.invoke({ query: 'x' }).then(
        (result) => handedBack.push(result),
        (error: Error) => handedBack.push(error.message)
      );
      return 'done';
    }
  });

  await c.wrapped.runToolLoop({
    ...call,
    system: 's',
    prompt: 'For Anna Kowalska.',
    tools: [handle(async () => 'Write to anna.kowalska@example.com.')],
    maxSteps: 2
  });

  assert.deepEqual(handedBack, ['the record is gone']);
});

test('a gateway with nothing to tell still lets a line say what a masked call sent', async () => {
  const seen: TextRequest[] = [];
  const inner = stubGateway({
    describe: () => hosted,
    generateText: async (request) => {
      seen.push(request);
      return { text: 'ok', finishReason: 'stop', usage };
    }
  });

  await maskedGateway(inner, { mode: 'hosted', seeds: () => anna }).generateText(text());
  assert.deepEqual(seen[0]?.masked?.(), { name: 1, email: 1 });
});

/* --------------------------------------------------------------------- the line */

test('a call says on its line what it sent, as it stands when the line is written, failed or not', async () => {
  const log = recorder();
  let counts: MaskCounts = { name: 1 };
  const ai = createAiGateway({
    resolver: fakeResolver({ providerId: 'openai', answer: 'fine', onCall: () => void (counts = { name: 1, email: 1 }) }).resolver,
    logger: log
  });

  await ai.generateText({ ...callFor(), system: 's', prompt: 'p', maxOutputTokens: 8, masked: () => counts });
  assert.deepEqual(log.entries.at(-1)?.masked, { name: 1, email: 1 });

  const failing = createAiGateway({
    resolver: fakeResolver({ providerId: 'openai', fail: () => { throw new Error('down'); } }).resolver,
    logger: log
  });
  await assert.rejects(
    failing.generateText({ ...callFor(), system: 's', prompt: 'p', maxOutputTokens: 8, maxRetries: 0, masked: () => ({ phone: 2 }) })
  );
  assert.equal(log.entries.at(-1)?.outcome, 'failed');
  assert.deepEqual(log.entries.at(-1)?.masked, { phone: 2 });

  await failing.embed({ ...callFor(), values: ['x'], masked: () => ({}) }).catch(() => undefined);
  assert.deepEqual(log.entries.at(-1)?.masked, {}, 'masked with nothing to keep is not a call that was not masked');
});

test('a call that was not masked has no count on its line', async () => {
  const log = recorder();
  const ai = createAiGateway({ resolver: fakeResolver({ providerId: 'openai', answer: 'fine' }).resolver, logger: log });

  await ai.generateText({ ...callFor(), system: 's', prompt: 'p', maxOutputTokens: 8 });
  assert.ok(!('masked' in log.entries[0]!));
});

const entry = (over: Partial<AiLogEntry> = {}): AiLogEntry => ({
  at: 1_000,
  traceId: 'trace-1',
  runId: 'run-1',
  operation: 'text',
  providerId: 'openai',
  modelId: 'gpt',
  promptChars: 10,
  completionChars: 4,
  usage: {},
  latencyMs: 5,
  outcome: 'ok',
  ...over
});

test('the table keeps a count as it was given, none as none, and nothing at all as nothing', () => {
  const s = scratch();
  try {
    const log = createAiLog(s.db);
    log.record(entry({ at: 1, masked: { name: 2, id: 1 } }));
    log.record(entry({ at: 2, masked: {} }));
    log.record(entry({ at: 3 }));

    const rows = log.forRun('run-1').map(({ id, ...row }) => {
      assert.ok(Number.isInteger(id));
      return row;
    });
    assert.deepEqual(rows, [
      entry({ at: 1, masked: { name: 2, id: 1 } }),
      entry({ at: 2, masked: {} }),
      entry({ at: 3 })
    ]);
  } finally {
    s.dispose();
  }
});

test('the echoed line says how many placeholders went, all kinds together', () => {
  assert.match(aiLine(entry({ masked: { name: 2, email: 1, id: 1 } })), / 5ms masked=4 ok$/);
  assert.match(aiLine(entry({ masked: {} })), / masked=0 ok$/);
  assert.doesNotMatch(aiLine(entry()), /masked/);
  assert.match(aiLine(entry({ masked: { phone: 1 }, outcome: 'failed', errorCode: 'http_500' })), / masked=1 failed=http_500$/);
});

/* -------------------------------------------------------------------- the record */

const world = () => {
  const s = scratch();
  s.db.prepare("INSERT INTO cv_contexts (id, language, created_at, updated_at) VALUES ('ctx', 'en', 1, 1)").run();
  s.db.prepare(
    "INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES ('chat', 'profile', 'ctx', 1, 1)"
  ).run();
  return { s, runs: createRunStore(s.db), records: createRecordStore(s.db) };
};

type World = ReturnType<typeof world>;

const begin = (w: World, id: string, over: Partial<NewRun> = {}): string => {
  w.runs.create(
    {
      id,
      capability: 'noop',
      input: {},
      traceId: id,
      createdAt: 1_000,
      contextId: 'ctx',
      contextGeneration: 0,
      contextRevision: 0,
      conversationId: 'chat',
      ...over
    },
    [{ at: 1_000, type: 'run.queued', data: {} }]
  );
  return id;
};

const running = (w: World, id: string) => {
  begin(w, id);
  const checkpoint = createCheckpointer(w.runs, id, () => 2_000);
  checkpoint.started({ providerId: 'p', modelId: 'm' });
  return checkpoint;
};

test('a record has no count until a call is counted in it, and then the sum of every call', () => {
  const w = world();
  try {
    running(w, 'r1');
    assert.ok(!('masking' in w.records.read('r1')!), 'no call yet');

    assert.equal(w.records.addMasking('r1', MASKED({ name: 1 })), 1);
    assert.equal(w.records.addMasking('r1', AS_IT_WAS), 1);
    assert.equal(w.records.addMasking('r1', MASKED({ name: 2, email: 1 })), 1);
    assert.equal(w.records.addMasking('r1', MORE({ id: 1 })), 1);

    assert.deepEqual(w.records.read('r1')?.masking, { masked: 2, unmasked: 1, placeholders: { name: 3, email: 1, id: 1 } });
  } finally {
    w.s.dispose();
  }
});

test('only an open record takes a count, and one counted while it was open keeps it', () => {
  const w = world();
  try {
    const paused = running(w, 'paused');
    paused.suspended({ name: 'answer', kind: 'tool_loop', ordinal: 0, critical: true }, 'approval-1');

    const done = running(w, 'done');
    assert.equal(w.records.addMasking('done', MASKED({ name: 1 })), 1);
    done.succeeded({}, [], 1);

    running(w, 'dead');
    recoverInterruptedRuns(w.runs, () => 1_250);
    begin(w, 'bare', { conversationId: undefined });

    for (const id of ['paused', 'done', 'dead', 'bare', 'no-such-run']) {
      const before = w.records.read(id);
      assert.equal(w.records.addMasking(id, MASKED({ name: 5 })), 0, id);
      assert.deepEqual(w.records.read(id), before, id);
    }
    assert.deepEqual(w.records.read('done')?.masking, MASKED({ name: 1 }));
  } finally {
    w.s.dispose();
  }
});

test("a conversation's records carry their counts", () => {
  const w = world();
  try {
    running(w, 'r1');
    running(w, 'r2');
    w.records.addMasking('r2', MASKED({ email: 1 }));

    assert.deepEqual(
      w.records.byConversation('chat').map(({ record }) => [record.runId, record.masking]),
      [['r1', undefined], ['r2', MASKED({ email: 1 })]]
    );
  } finally {
    w.s.dispose();
  }
});

test('the recorder hands a count to the store for its own run, as it is', () => {
  const added: [string, MaskTally][] = [];
  const recorded = createRecorder(
    {
      records: {
        append: () => 0,
        addMasking: (runId, add) => {
          added.push([runId, add]);
          return 1;
        },
        read: () => undefined
      },
      wells: defaultWells()
    },
    { runId: 'r9', conversationId: 'chat', input: {} }
  );

  recorded.masking(MASKED({ name: 1 }));
  assert.deepEqual(added, [['r9', MASKED({ name: 1 })]]);
});

test('the migration gives each call and each record a place for its counts, empty for what came before', () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((step) => step.version <= 47));
    db.prepare(
      `INSERT INTO ai_calls (at, trace_id, operation, provider_id, model_id, prompt_chars, completion_chars, latency_ms, outcome)
       VALUES (1, 't', 'text', 'openai', 'gpt', 1, 1, 1, 'ok')`
    ).run();

    migrate(db);

    const columns = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
    assert.ok(columns('ai_calls').includes('masked'));
    assert.ok(columns('grounding_record').includes('masking'));

    const [old] = createAiLog(db).recent();
    assert.ok(old);
    assert.ok(!('masked' in old), 'a call from before says nothing, not "none"');
  } finally {
    db.close();
  }
});

/* ------------------------------------------------------------------------ a run */

const body = { ...cv([job('Acme', 'Senior Engineer', 'Rewrote the billing pipeline.')]), personal: { name: 'Ada Example', email: 'ada@example.com', phone: '+44 7700 900123', location: 'Krakow', links: {} } };

const maskedBy = (c: Chat, providerId: string): RuntimeDeps => ({
  ...c.deps,
  masking: { mode: () => 'hosted' },
  effects: {
    ...c.deps.effects,
    ai: { ...c.deps.effects.ai, describe: () => ({ providerId, modelId: 'a-model' }) } as AiGateway
  }
});

test("a run's record counts each call it made before the call went, masked or not", async () => {
  for (const providerId of ['openrouter', 'local']) {
    let c: Chat | undefined = undefined;
    const atSending: number[] = [];
    c = chat({
      body,
      answer: () => {
        const masking = c!.records.read('counted')?.masking;
        atSending.push((masking?.masked ?? 0) + (masking?.unmasked ?? 0));
        return 'An answer.';
      }
    });

    try {
      const run = beginRun(maskedBy(c, providerId), {
        capability: 'ask_profile',
        input: { question: 'What did Ada Example do?' },
        ...CHAT_RUN,
        runId: 'counted'
      });
      await run.settled;

      const masking = c.records.read('counted')?.masking;
      const calls = c.requests.length;
      assert.ok(calls >= 2, 'a plan and an answer');

      if (providerId === 'local') {
        assert.deepEqual(masking, { masked: 0, unmasked: calls, placeholders: {} });
      } else {
        assert.equal(masking?.masked, calls);
        assert.equal(masking?.unmasked, 0);
        assert.ok((masking?.placeholders.name ?? 0) >= 1, 'the question named the person');
      }
      assert.deepEqual(atSending, [calls], `${providerId}: the answer was counted before it was asked for`);
    } finally {
      c.dispose();
    }
  }
});

/* ------------------------------------------------------------------- the runtime */

type Wire = { readonly url: string; readonly body: string };

const completion = (): Response =>
  new Response(
    JSON.stringify({
      id: 'cmpl',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Done for [NAME_1].' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

const onTheWire = async (run: (wire: Wire[]) => Promise<void>): Promise<void> => {
  const wire: Wire[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }): Promise<Response> => {
    wire.push({
      url: typeof input === 'string' ? input : ((input as { url?: string }).url ?? String(input)),
      body: typeof init?.body === 'string' ? init.body : ''
    });
    return completion();
  }) as typeof globalThis.fetch;

  try {
    await run(wire);
  } finally {
    globalThis.fetch = real;
  }
};

const capabilities: CapabilityMap = {
  probe: noop('probe', [
    stage('ask', [
      transform('ask', async (context) => {
        for (const prompt of ['Write to Ada Example at ada@example.com.', 'And again to Ada Example at ada@example.com.']) {
          await context.effects.ai.generateText({
            traceId: context.traceId,
            runId: context.runId,
            signal: context.signal,
            system: 'You help.',
            prompt,
            maxOutputTokens: 20,
            maxRetries: 0
          });
        }
        return {};
      })
    ])
  ])
};

const data = <T>(response: Reply): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const OWNED = ['Ada', 'Example', 'ada@example.com', 'Krakow'];

test('the runtime counts what a hosted model was sent in the record and on each line, and never what it was', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-counts-'));
  const harness = createHarness({
    databasePath: join(dir, 'harness.db'),
    capabilities,
    // No logger: the table is the one the runtime writes by default.
    env: { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-not-a-real-key' },
    probe: () => Promise.reject(new Error('connection refused'))
  });
  const dispatch = createDispatch(harness);

  try {
    const context = harness.cvContexts.create(randomUUID(), 'en');
    harness.profile.replaceContext(context.id, cvDocumentSchema.parse({ ...body, role_description: 'Engineer.' }), 0);
    const conversation = harness.conversations.create({ kind: 'profile', id: context.id });

    let runId = '';
    let bare = '';
    await onTheWire(async (wire) => {
      runId = (await harness.run({ capability: 'probe', input: {}, contextId: context.id, conversationId: conversation.id })).runId;
      bare = (await harness.run({ capability: 'probe', input: {}, contextId: context.id })).runId;
      assert.equal(wire.length, 4);
      assert.ok(wire.every((request) => /openrouter/.test(request.url) && !request.body.includes('Ada')));
    });

    const record = harness.groundingRecords.read(runId);
    assert.deepEqual(record?.masking, { masked: 2, unmasked: 0, placeholders: { name: 2, email: 2 } });

    const lines = (id: string) => harness.aiCalls.forRun(id).map((line) => [line.operation, line.masked]);
    assert.deepEqual(lines(runId), [['text', { name: 1, email: 1 }], ['text', { name: 1, email: 1 }]]);

    // A run in no conversation has no record, and its calls are counted all the same.
    assert.equal(harness.groundingRecords.read(bare), undefined);
    assert.deepEqual(lines(bare), [['text', { name: 1, email: 1 }], ['text', { name: 1, email: 1 }]]);

    // What a host reads is the record, counts and all.
    const read = data<{ record: { masking?: MaskTally } }>(await dispatch('runs.grounding', { runId }));
    assert.deepEqual(read.record.masking, record?.masking);
    assert.ok(data<{ features: string[] }>(await dispatch('protocol.get', {})).features.includes('masking-counts'));

    const kept = JSON.stringify([read, harness.aiCalls.recent()]);
    for (const value of OWNED) assert.ok(!kept.includes(value), `${value} is not in what is kept`);
  } finally {
    harness.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
