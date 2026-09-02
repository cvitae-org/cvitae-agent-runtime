/**
 * The open-ended path: what bounds a loop, and what it is allowed to reach.
 *
 * Every other capability here declares its steps, and the assertions worth
 * making about those are about the answer. This one decides at run time how
 * many model turns to spend and which tools to spend them on, so the assertions
 * worth making are about the bounds — the two properties that stop an
 * open-ended loop being the thing this pattern is notorious for.
 *
 * The first is the turn ceiling: a loop that spends every turn without reaching
 * an answer is a failed step, not a half-finished investigation returned as a
 * result. The second is the grant: the model can call exactly the tools the
 * plan named and nothing else, and when the planner cannot choose it falls back
 * to offering everything rather than to offering nothing.
 *
 * Both are cheap to get wrong in a way no smoke test notices. A stubbed loop
 * that answers on the first turn never reaches the ceiling, and a loop that
 * calls no tool never notices it was granted none — which is exactly what the
 * fixtures in `smoke.ts` do, and why this file drives the loop itself.
 *
 * Mutations run, not assumed. Each was applied, the whole suite run, the
 * failures counted, and the mutation reverted:
 *
 *   the turn ceiling is not passed on    2  the turn ceiling comes from … /
 *                                           a loop that spends every turn …
 *   the loop outcome is merged as-is     4  a planner that is unavailable … /
 *                                           a loop that answers early … /
 *                                           a granted tool reads … /
 *                                           an empty profile is reported …
 *   the turn count reads `steps`         2  a loop that answers early … /
 *                                           a granted tool reads …
 *   an empty selection is used as-is     1  a choice the registry does not …
 *   a failed selection fails the run     1  a planner that is unavailable …
 *   names unchecked against the registry 1  a choice the registry does not …
 *   the exhausted-loop check removed     1  a loop that spends every turn …
 *   the ceiling is off by one (`>`)      1  a loop that spends every turn …
 *   the finish reason is ignored         1  a loop that answers early …
 *
 * Two of these also broke the smoke suite, which is the first time that has
 * happened in this tree and worth understanding rather than celebrating. An
 * empty tool grant fails "the plan is well formed" because that test asserts a
 * tool loop has tools, and an unchecked selection fails the two walking tests
 * because the sampled planner answers `sample`, the registry has no such tool,
 * and `handles` throws. Both are structural — a plan shaped wrongly, a name
 * that does not resolve — which is exactly what a rung answering every step
 * from its own schema *can* see. The other seven it cannot: each of them
 * returns a well-formed plan and a plausible result, and each is a loop that
 * ran too long, answered from nothing, or reported the wrong number of turns.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { CV_ID, CV_KIND } from '../src/capabilities/cv/document.js';
import { createRetriever } from '../src/retrieval/search.js';
import { startRun } from '../src/runtime/run.js';
import { defaultTools } from '../src/tools/index.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { spine, type Spine } from './support/spine.js';
import type {
  AiGateway,
  EmbeddingFingerprint,
  ToolHandle,
  ToolLoopRequest
} from '../src/contracts/index.js';

/* ---------------------------------------------------------------- fixtures */

const HIGHLIGHTS = [
  'Senior Engineer at Acme: rewrote the billing pipeline and halved p99 latency.',
  'Engineer at Globex: built the internal design system in React.'
];

const FINGERPRINT: EmbeddingFingerprint = {
  provider: 'test',
  model: 'stub-embed',
  dim: 4,
  normalisation: 'l2',
  chunkerVersion: 1
};

/**
 * A vector from the words in the text, so the dense half ranks something.
 *
 * Four buckets is enough to separate the two fixtures and small enough to write
 * out. The lexical half would answer these queries alone; giving the dense half
 * a real signal is what keeps the test exercising the fusion the runtime
 * actually uses rather than a degenerate case of it.
 */
const bag = (text: string): Float32Array => {
  const buckets = [0, 0, 0, 0];

  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    let hash = 0;
    for (const character of word) hash = (hash * 31 + character.charCodeAt(0)) % 4;
    buckets[hash] = (buckets[hash] as number) + 1;
  }

  const size = Math.hypot(...buckets) || 1;
  return Float32Array.from(buckets.map((value) => value / size));
};

const embed: AiGateway['embed'] = async (request) => ({
  vectors: request.values.map(bag),
  provider: FINGERPRINT.provider,
  model: FINGERPRINT.model,
  dim: FINGERPRINT.dim
});

/** What the loop was handed, recorded so a test can assert on the grant. */
type Loop = {
  readonly requests: ToolLoopRequest[];
  readonly granted: () => string[];
};

const harness = async <T>(
  options: {
    /** The planner's answer. Omit for a planner that throws. */
    picks?: readonly string[];
    /** Drives the loop. Defaults to answering on the first turn without a tool. */
    loop?: (request: ToolLoopRequest) => Promise<{ text: string; steps: number; finishReason: 'stop' | 'tool-calls' }>;
  },
  body: (s: Spine, loop: Loop) => Promise<T>
): Promise<T> => {
  const requests: ToolLoopRequest[] = [];

  const ai: Partial<AiGateway> = {
    embed,
    generateObject: async (request) => {
      // The planner's tool selection is the only object call this capability
      // makes. Anything else asking is a change worth noticing.
      assert.equal(request.step, 'plan');
      if (!options.picks) throw new Error('the planner is unavailable');
      return { object: { tools: options.picks } as never, finishReason: 'stop', usage: {} };
    },
    runToolLoop: async (request) => {
      requests.push(request);
      const answered = await (options.loop ?? (async () => ({
        text: 'Sample answer, produced without a model.',
        steps: 1,
        finishReason: 'stop' as const
      })))(request);
      return { ...answered, usage: {} };
    }
  };

  const s = spine(capabilities, { ai, tools: createToolRegistry(defaultTools) });

  // A retriever over the spine's own index, which is what `search_profile`
  // reads. `createRetriever` takes the reader half; the write half is `s.chunks`.
  const retrieval = createRetriever({ reader: s.chunks, ai: s.deps.effects.ai, traceId: 'test' });
  const deps = { ...s.deps, retrieval };

  try {
    return await body({ ...s, deps }, { requests, granted: () => requests[0]?.tools.map((tool) => tool.name) ?? [] });
  } finally {
    s.dispose();
  }
};

/** Writes the CV and indexes its highlights, so the tool has something to find. */
const seed = (s: Spine) => {
  s.deps.documents.update(CV_ID, CV_KIND, () => ({ version: 1 }));
  s.chunks.replace(
    CV_ID,
    FINGERPRINT,
    HIGHLIGHTS.map((text, position) => ({
      id: `c${position}`,
      kind: 'highlight',
      text,
      position,
      meta: { section: 'experience' },
      vector: bag(text)
    }))
  );
};

const ask = (s: Spine, input: Record<string, unknown> = {}) =>
  startRun(s.deps, {
    capability: 'ask_profile',
    input: { question: 'What have I worked on that involved billing?', ...input }
  });

/* ----------------------------------------------------------------- the grant */

test('the loop is granted the planner choice plus the canonical CV reader', async () => {
  await harness({ picks: ['search_profile'] }, async (s, loop) => {
    await ask(s);
    assert.deepEqual(loop.granted(), ['search_profile', 'read_cv']);
  });
});

test('choosing read_cv does not grant it twice', async () => {
  await harness({ picks: ['read_cv'] }, async (s, loop) => {
    await ask(s);
    assert.deepEqual(loop.granted(), ['read_cv']);
  });
});

test('a choice the registry does not recognise falls back to every tool', async () => {
  // The failure this prevents is the quiet one: a model that names a plausible
  // tool that does not exist would otherwise leave the loop with an empty
  // grant, and an empty grant is a loop that cannot look anything up and
  // answers from its priors instead.
  await harness({ picks: ['send_email', 'read_file'] }, async (s, loop) => {
    await ask(s);
    assert.deepEqual(loop.granted(), createToolRegistry(defaultTools).names());
    assert.ok(!loop.granted().includes('send_email'));
  });
});

test('a planner that is unavailable costs efficiency, not the run', async () => {
  await harness({}, async (s, loop) => {
    const result = await ask(s);

    // Offering everything is what a runtime with no planner would do: less
    // efficient, never wrong. Failing the run because a tool *selection* failed
    // would be trading the answer for the optimisation.
    assert.deepEqual(loop.granted(), createToolRegistry(defaultTools).names());
    assert.equal(result.data.answer, 'Sample answer, produced without a model.');
  });
});

/* --------------------------------------------------------------- the ceiling */

test('the turn ceiling comes from the request', async () => {
  await harness({ picks: ['search_profile'] }, async (s, loop) => {
    await ask(s, { maxSteps: 3 });
    assert.equal(loop.requests[0]?.maxSteps, 3);
  });

  // The default comes from the schema and has to survive the trip into the
  // step. A step with no `maxSteps` would not compile; a step with a number
  // written into it would, and would quietly ignore what the caller asked for.
  await harness({ picks: ['search_profile'] }, async (s, loop) => {
    await ask(s);
    assert.equal(loop.requests[0]?.maxSteps, 6);
  });
});

test('a loop that spends every turn without answering has not answered', async () => {
  const exhausted = async () => ({ text: 'Let me search again.', steps: 3, finishReason: 'tool-calls' as const });

  await harness({ picks: ['search_profile'], loop: exhausted }, async (s) => {
    // Returned as a result it would read like an answer. The run fails instead,
    // and the message says how many turns were spent.
    await assert.rejects(() => ask(s, { maxSteps: 3 }), /used all 3 turns without reaching an answer/);
  });
});

test('a loop that answers early is not treated as exhausted', async () => {
  // The other side of the same check. `steps >= maxSteps` alone would fail a
  // loop that used its last turn to produce the answer.
  const lastTurn = async () => ({ text: 'Billing, at Acme.', steps: 3, finishReason: 'stop' as const });

  await harness({ picks: ['search_profile'], loop: lastTurn }, async (s) => {
    const result = await ask(s, { maxSteps: 3 });
    assert.equal(result.data.answer, 'Billing, at Acme.');
    assert.equal(result.data.model_steps, 3);
  });
});

/* ------------------------------------------------------------- the tool call */

test('a granted tool reads the run\'s own index', async () => {
  const called: unknown[] = [];

  const searching = (handle: ToolHandle | undefined) => async () => {
    called.push(await handle?.invoke({ query: 'billing pipeline', limit: 5 }));
    return { text: 'You rewrote the billing pipeline at Acme.', steps: 2, finishReason: 'stop' as const };
  };

  await harness(
    {
      picks: ['search_profile'],
      loop: async (request) => searching(request.tools[0])()
    },
    async (s) => {
      seed(s);
      const result = await ask(s);

      const answer = called[0] as { results: { text: string }[] };
      assert.ok(
        answer.results.some((hit) => hit.text.includes('billing pipeline')),
        `the tool found nothing: ${JSON.stringify(called[0])}`
      );

      assert.equal(result.data.answer, 'You rewrote the billing pipeline at Acme.');
      assert.equal(result.data.model_steps, 2);
    }
  );
});

test('an empty profile is reported as empty, not as no match', async () => {
  // Nothing is indexed. The tool has to say which of the two it is, because a
  // model told only "no results" rephrases the query until it runs out of turns.
  await harness(
    {
      picks: ['search_profile'],
      loop: async (request) => {
        const answer = (await request.tools[0]?.invoke({ query: 'billing', limit: 5 })) as {
          results: unknown[];
          note?: string;
        };
        assert.deepEqual(answer.results, []);
        assert.match(answer.note ?? '', /may not have been imported/);
        return { text: 'Nothing has been imported yet.', steps: 1, finishReason: 'stop' as const };
      }
    },
    async (s) => {
      assert.equal((await ask(s)).data.answer, 'Nothing has been imported yet.');
    }
  );
});
