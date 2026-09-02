/**
 * The whitelist, and what a model can and cannot do to it.
 *
 * Two properties carry the weight here. A step is handed exactly the tools it
 * named, so a capability granted a read cannot be talked into reaching further;
 * and everything crossing the boundary from the model is parsed first, with the
 * failure handed back as a value rather than thrown, so a guessed field name
 * costs a turn instead of the run.
 *
 * The context is deliberately unreachable from the model side. `execute` is
 * called with the runtime's context whatever the arguments say, which one test
 * checks by shipping a tool whose schema declares a `runId` the model can set.
 *
 * Confirmed by breaking things:
 *
 *   - Dropping the duplicate-name check fails one test. The second definition
 *     wins silently, which is the behaviour the check exists to prevent.
 *   - Throwing the validation error instead of returning it fails one test,
 *     and it is the difference between a model correcting itself and a run
 *     ending on a typo.
 *   - Passing the raw `input` to `execute` instead of `parsed.data` fails one
 *     test: the schema's defaults never get applied, so a tool that documented
 *     `limit` as optional receives `undefined`.
 *   - Removing the character budget from `search_profile` fails one test. The
 *     count ceiling in the schema does not bound size, and a long document's
 *     chunks are what make that gap expensive.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type {
  ChunkHit,
  ChunkQuery,
  EffectSet,
  DocumentStore,
  Retriever,
  ToolContext
} from '../src/contracts/index.js';
import { createToolRegistry, defineTool } from '../src/tools/registry.js';
import { searchProfileTool } from '../src/tools/index.js';
import { readCvTool } from '../src/capabilities/cv/tools.js';
import { CV_ID, cvDocumentSchema } from '../src/capabilities/cv/document.js';

const notReached = (what: string) => (): never => {
  throw new Error(`${what} was reached; a tool test grants nothing it does not assert.`);
};

/**
 * Everything a tool could reach, wired to throw.
 *
 * A test that means to grant something overrides it explicitly, so anything a
 * tool touches without being handed it on purpose fails by name.
 */
const toolContext = (over: Partial<ToolContext> = {}): ToolContext => ({
  traceId: 'trace-1',
  runId: 'run-1',
  step: 'step-1',
  signal: new AbortController().signal,
  effects: {
    ai: notReached('ai'),
    offers: { resolve: notReached('offers.resolve') },
    sites: { readPage: notReached('sites.readPage') },
    search: { search: notReached('search.search') },
    sources: { read: notReached('sources.read') },
    attempts: { begin: notReached('attempts.begin') }
  } as unknown as EffectSet,
  documents: { read: notReached('documents.read') } as unknown as DocumentStore,
  retrieval: { search: notReached('retrieval.search') } as unknown as Retriever,
  ...over
});

/** A tool that records what it was called with and returns it. */
const echo = (name = 'echo') => {
  const calls: { input: unknown; context: ToolContext }[] = [];

  const tool = defineTool({
    name,
    describe: 'Echoes its input.',
    input: z.object({
      text: z.string().min(1),
      limit: z.number().int().default(7)
    }),
    execute: async (input, context) => {
      calls.push({ input, context });
      return { echoed: input };
    }
  });

  return { tool, calls };
};

/* -------------------------------------------------------------- the table */

test('a name registered twice is a wiring mistake, not a last-one-wins', () => {
  const first = echo('search_profile').tool;
  const second = echo('search_profile').tool;

  assert.throws(
    () => createToolRegistry([first, second]),
    /already registered/
  );
});

test('a step is handed the tools it named and nothing else', () => {
  const a = echo('a');
  const b = echo('b');
  const registry = createToolRegistry([a.tool, b.tool]);

  const handles = registry.handles(['b'], toolContext());

  assert.deepEqual(handles.map((handle) => handle.name), ['b']);
  // The registry knows about both. That is not the same as the step reaching
  // both, and this is the line where the two come apart.
  assert.deepEqual([...registry.names()], ['a', 'b']);
});

test('the handles come back in the order the step asked for them', () => {
  const registry = createToolRegistry([echo('a').tool, echo('b').tool, echo('c').tool]);

  assert.deepEqual(
    registry.handles(['c', 'a'], toolContext()).map((handle) => handle.name),
    ['c', 'a']
  );
});

test('a tool the registry does not hold fails loudly, naming what it does hold', () => {
  const registry = createToolRegistry([echo('search_profile').tool]);

  assert.throws(
    () => registry.handles(['search_offers'], toolContext()),
    (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, /unregistered tool "search_offers"/);
      // Without the second half a plan-time typo reads as "the tool is
      // missing" when the answer is "you spelled it differently".
      assert.match(message, /Registered: search_profile/);
      return true;
    }
  );
});

test('an empty registry still says so rather than trailing off', () => {
  assert.throws(
    () => createToolRegistry().handles(['anything'], toolContext()),
    /Registered: \(none\)/
  );
});

/* ------------------------------------------------------- the model's side */

test('arguments the schema rejects come back as a value, not an exception', async () => {
  const { tool, calls } = echo();
  const [handle] = createToolRegistry([tool]).handles(['echo'], toolContext());

  const result = await handle!.invoke({ query: 'a guess at the field name' });

  // Returned, so the model sees it as a tool result and gets another turn.
  assert.deepEqual(Object.keys(result as object), ['error']);
  assert.match((result as { error: string }).error, /Invalid arguments for "echo"/);
  assert.match((result as { error: string }).error, /text/);
  assert.equal(calls.length, 0, 'execute ran on arguments that did not parse');
});

test('the tool sees the parsed arguments, defaults and all', async () => {
  const { tool, calls } = echo();
  const [handle] = createToolRegistry([tool]).handles(['echo'], toolContext());

  await handle!.invoke({ text: 'hello' });

  // The schema documents `limit` as optional; the tool is entitled to a number.
  assert.deepEqual(calls[0]?.input, { text: 'hello', limit: 7 });
});

test('the context is the runtime\'s, whatever the arguments claim', async () => {
  const calls: ToolContext[] = [];
  const impostor = defineTool({
    name: 'impostor',
    describe: 'Declares the fields a model would need to forge a context.',
    input: z.object({ runId: z.string(), traceId: z.string() }),
    execute: async (_input, context) => {
      calls.push(context);
      return null;
    }
  });

  const [handle] = createToolRegistry([impostor]).handles(
    ['impostor'],
    toolContext({ runId: 'run-1', traceId: 'trace-1' })
  );

  await handle!.invoke({ runId: 'run-elsewhere', traceId: 'trace-elsewhere' });

  // Arguments and context are separate parameters and never merge. The model
  // can name a run; it cannot become one.
  assert.equal(calls[0]?.runId, 'run-1');
  assert.equal(calls[0]?.traceId, 'trace-1');
});

test('a handle carries the schema forward, so the gateway can describe it', () => {
  const registry = createToolRegistry([echo().tool]);
  const [handle] = registry.handles(['echo'], toolContext());

  assert.equal(handle!.describe, 'Echoes its input.');
  assert.equal(handle!.inputSchema.safeParse({ text: 'ok' }).success, true);
});

/* ------------------------------------------------------- search_profile */

const hit = (id: string, text: string): ChunkHit => ({
  id,
  documentId: 'cv-1',
  kind: 'highlight',
  text,
  position: 0,
  meta: { company: 'Acme' },
  score: 0.5,
  found: ['lexical']
});

const withHits = (hits: ChunkHit[]) => {
  const asked: { query: ChunkQuery; signal: AbortSignal }[] = [];

  const retrieval: Retriever = {
    search: async (query, signal) => {
      asked.push({ query, signal });
      return hits;
    }
  };

  return { retrieval, asked };
};

test('search_profile trims to a character budget the schema cannot express', async () => {
  // Three chunks, each a third of the budget plus a bit. Every one satisfies
  // `limit`, which counts results and knows nothing about their size.
  const long = 'x'.repeat(2_500);
  const { retrieval } = withHits([hit('c0', long), hit('c1', long), hit('c2', long)]);
  const [handle] = createToolRegistry([searchProfileTool]).handles(
    ['search_profile'],
    toolContext({ retrieval })
  );

  const result = (await handle!.invoke({ query: 'typescript', limit: 3 })) as {
    results: unknown[];
    truncated?: number;
  };

  assert.equal(result.results.length, 2);
  assert.equal(result.truncated, 1, 'the dropped chunk was not accounted for');
});

test('search_profile returns no score, because the number would be reasoned about', async () => {
  const { retrieval } = withHits([hit('c0', 'Built a search index.')]);
  const [handle] = createToolRegistry([searchProfileTool]).handles(
    ['search_profile'],
    toolContext({ retrieval })
  );

  const result = (await handle!.invoke({ query: 'search', limit: 5 })) as {
    results: Record<string, unknown>[];
  };

  assert.deepEqual(Object.keys(result.results[0] ?? {}).sort(), ['kind', 'meta', 'text']);
  // Nothing to truncate, so the key is absent rather than zero.
  assert.equal('truncated' in result, false);
});

test('an empty index is distinguished from an unhelpful query', async () => {
  const { retrieval } = withHits([]);
  const [handle] = createToolRegistry([searchProfileTool]).handles(
    ['search_profile'],
    toolContext({ retrieval })
  );

  const result = (await handle!.invoke({ query: 'anything', limit: 5 })) as {
    results: unknown[];
    note?: string;
  };

  assert.deepEqual(result.results, []);
  // A model told only "no results" rephrases the query forever.
  assert.match(result.note ?? '', /imported/);
});

test('the run\'s signal reaches the search, so a cancelled run stops asking', async () => {
  const { retrieval, asked } = withHits([]);
  const controller = new AbortController();
  const [handle] = createToolRegistry([searchProfileTool]).handles(
    ['search_profile'],
    toolContext({ retrieval, signal: controller.signal })
  );

  await handle!.invoke({ query: 'typescript', limit: 5 });

  assert.equal(asked[0]?.signal, controller.signal);
});

/* ------------------------------------------------------------ read_cv */

test('read_cv reports an absent profile without reaching any other port', async () => {
  const [handle] = createToolRegistry([readCvTool]).handles(
    ['read_cv'],
    toolContext({ documents: { read: () => undefined } as unknown as DocumentStore })
  );

  assert.deepEqual(await handle!.invoke({}), {
    present: false,
    note: 'No CV has been imported yet.'
  });
});

test('read_cv returns paged canonical data without exposing source references', async () => {
  const document = cvDocumentSchema.parse({
    personal: { name: 'Ada Lovelace', email: 'ada@example.test' },
    experience: [
      { company: 'One', title: 'Engineer' },
      { company: 'Two', title: 'Lead' }
    ],
    sources: [{
      kind: 'pdf',
      reference: '/private/profile.pdf',
      imported_at: '2026-08-31T00:00:00Z'
    }]
  });
  const documents = {
    read: (id: string) => id === CV_ID
      ? { id, kind: 'cv', revision: 3, body: document, createdAt: 1, updatedAt: 2 }
      : undefined
  } as unknown as DocumentStore;
  const [handle] = createToolRegistry([readCvTool]).handles(
    ['read_cv'],
    toolContext({ documents })
  );

  const overview = await handle!.invoke({ section: 'overview' });
  assert.match(JSON.stringify(overview), /Ada Lovelace/);
  assert.ok(!JSON.stringify(overview).includes('/private/profile.pdf'));

  const experience = await handle!.invoke({
    section: 'experience',
    offset: 1,
    limit: 1
  }) as { data: { items: { company: string }[]; total: number; hasMore: boolean } };
  assert.equal(experience.data.items[0]?.company, 'Two');
  assert.equal(experience.data.total, 2);
  assert.equal(experience.data.hasMore, false);
});

test('read_cv bounds unusually long profile text before it reaches model context', async () => {
  const document = cvDocumentSchema.parse({
    // Escapes are deliberately more expensive in JSON than in the source;
    // counting only source characters would let this exceed the ceiling.
    role_description: '\\\\\n😀'.repeat(8_000)
  });
  const documents = {
    read: () => ({
      id: CV_ID,
      kind: 'cv',
      revision: 1,
      body: document,
      createdAt: 1,
      updatedAt: 1
    })
  } as unknown as DocumentStore;
  const [handle] = createToolRegistry([readCvTool]).handles(
    ['read_cv'],
    toolContext({ documents })
  );

  const result = await handle!.invoke({ section: 'overview' }) as { truncated?: boolean };
  assert.equal(result.truncated, true);
  assert.ok(JSON.stringify(result).length < 6_000);
});
