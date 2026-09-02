/**
 * Every registered capability walks end to end, offline.
 *
 * Tier 0 of the eval ladder, and the cheapest useful rung. There is no labelled
 * answer here and nothing is scored: the assertions are the ones that hold for
 * *any* capability regardless of subject — it plans, its steps run, its result
 * comes back, and the run leaves a coherent trail behind it.
 *
 * The reason to have it before porting the remaining capabilities rather than
 * after: they all share `core/orchestrator.ts`, `context/build.ts` and the
 * aggregator, so a regression in any of those breaks all of them at once, and
 * the alternative way to notice is running each capability by hand against a
 * live model. Six capabilities in, that stops happening.
 *
 * What it deliberately does not do is judge an answer. The gateway returns
 * values derived from each step's own schema, so the content is meaningless by
 * construction and no assertion here can accidentally come to depend on model
 * behaviour. Whether the answers are any *good* is tier 1's question, it needs
 * labelled fixtures and a recorded run, and it is not what this file is for.
 *
 * Mutations run, not assumed. Each was applied, the suite run, the failures
 * counted, and the mutation reverted:
 *
 *   step row update stops matching   1  leaves a coherent trail
 *   aggregator merges nothing        1  walks from a request to a result
 *   a capability gains no fixture    1  every registered capability has a …
 *   a step name repeats across stages 2 the plan is well formed / … trail
 *   a fallback stops matching its schema 1  every step schema can be answered
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { buildRunContext, startRun } from '../src/runtime/run.js';
import { sampleOf } from './support/sample.js';
import { smokeGateway, smokeTools, smokes, uncovered } from './support/smoke.js';
import { spine } from './support/spine.js';
import type { Plan, Step } from '../src/contracts/index.js';
import type { Smoke } from './support/smoke.js';

const entries = Object.entries(smokes);

/** Every step in a plan, flattened, with its stage — the order they run in. */
const stepsOf = (plan: Plan): { stage: string; step: Step }[] =>
  plan.stages.flatMap((stage) => stage.steps.map((step) => ({ stage: stage.name, step })));

/**
 * Plans a capability without running it.
 *
 * `plan` takes a `RunContext` and no capability may read one at plan time —
 * planning happens before any step exists, so there is nothing on it that is
 * meaningful yet. Passing a marker rather than a built context is what proves
 * that: a capability that reaches into it gets a legible throw here instead of
 * a plausible value.
 */
const planOf = async (name: string, smoke: Smoke): Promise<Plan> => {
  const capability = capabilities[name];
  assert.ok(capability, `${name} is in the fixtures but not in the map`);

  const input = capability.input.parse(smoke.input);

  // The declared exception, and it gets a real context rather than an excuse:
  // its plan is a model call over the tool registry, so a marker would only
  // prove the marker throws.
  if (smoke.plansWithTheModel) {
    const s = harnessFor(smoke);
    try {
      return await capability.plan(
        input,
        buildRunContext(s.deps, {
          runId: 'plan-only',
          traceId: 'plan-only',
          capability: name,
          input,
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 60_000
        })
      );
    } finally {
      s.dispose();
    }
  }

  const forbidden = new Proxy(
    {},
    {
      get: (_, key) => {
        throw new Error(`${name}.plan read context.${String(key)}; planning has no run yet`);
      }
    }
  );

  return capability.plan(input, forbidden as never);
};

/** A runtime with no outside world: real storage, stubbed model, real tools. */
const harnessFor = (smoke: Smoke) =>
  spine(capabilities, {
    ai: smokeGateway(),
    tools: smokeTools(),
    ...(smoke.effects ? { effects: smoke.effects } : {})
  });

/** Runs one capability against stubs, from the request to the result. */
const walk = async (name: string, smoke: Smoke) => {
  const s = harnessFor(smoke);

  try {
    const result = await startRun(s.deps, { capability: name, input: smoke.input });
    return { result, record: s.runs.get(result.runId), steps: s.runs.steps(result.runId),
      events: s.events.since(result.runId, 0, 500) };
  } finally {
    s.dispose();
  }
};

/* --------------------------------------------------------- the whole suite */

test('every registered capability has a smoke fixture', () => {
  assert.deepEqual(
    uncovered(),
    [],
    'a capability was added to the map without a fixture in scripts/support/smoke.ts'
  );
});

for (const [name, smoke] of entries) {
  test(`${name}: the plan is well formed`, async () => {
    const plan = await planOf(name, smoke);
    const steps = stepsOf(plan);

    assert.equal(plan.capability, name, 'the plan names a different capability');
    assert.ok(plan.stages.length > 0, 'no stages');
    assert.ok(steps.length > 0, 'no steps');

    for (const stage of plan.stages) {
      assert.ok(stage.steps.length > 0, `stage "${stage.name}" is empty`);
    }

    // Step names are the key half of `run_steps`' primary key, so a repeat
    // across two stages is not a style problem — the second write collides
    // with the first and one step's outcome silently replaces another's.
    const names = steps.map(({ step }) => step.name);
    assert.equal(
      new Set(names).size,
      names.length,
      `duplicate step name in ${name}: ${names.join(', ')}`
    );

    for (const { stage, step } of steps) {
      const where = `${name}/${stage}/${step.name}`;

      if (step.kind === 'extract' || step.kind === 'generate') {
        assert.ok(step.system.trim().length > 0, `${where} has an empty system prompt`);
        assert.ok(step.maxOutputTokens > 0, `${where} has no output ceiling`);
      }

      if (step.kind === 'tool_loop') {
        assert.ok(step.maxSteps > 0, `${where} would run unbounded`);
        assert.ok(step.tools.length > 0, `${where} is a tool loop with no tools`);
      }
    }
  });

  test(`${name}: every step schema can be answered`, async () => {
    const plan = await planOf(name, smoke);

    for (const { stage, step } of stepsOf(plan)) {
      if (step.kind !== 'extract') continue;
      const where = `${name}/${stage}/${step.name}`;

      // The sampler is only trustworthy if what it builds parses. This is that
      // check, and it doubles as proof the schema is satisfiable at all — a
      // schema no value satisfies is a step that can never succeed.
      const parsed = step.schema.safeParse(sampleOf(step.schema));
      assert.ok(parsed.success, `${where}: sample did not parse — ${parsed.error?.message}`);

      // A fallback is what a consumer receives when the step degrades. One that
      // does not match the schema means a degraded run returns a shape nothing
      // downstream was written against.
      if (step.fallback) {
        const fell = step.schema.safeParse(step.fallback);
        assert.ok(fell.success, `${where}: fallback does not match its schema — ${fell.error?.message}`);
      }
    }
  });

  test(`${name}: walks from a request to a result`, async () => {
    const plan = await planOf(name, smoke);
    const { result, record } = await walk(name, smoke);

    assert.equal(record?.status, 'succeeded', `run ended ${record?.status}: ${record?.errorMessage}`);
    assert.equal(result.capability, name);
    assert.ok(Object.keys(result.data).length > 0, 'the result carried no data');
    assert.equal(result.outcomes.length, stepsOf(plan).length, 'not every step reported an outcome');

    assert.deepEqual(
      [...result.degraded].sort(),
      Object.keys(smoke.degrades ?? {}).sort(),
      'a step degraded that the fixture does not expect, or an expected one did not'
    );
  });

  test(`${name}: leaves a coherent trail`, async () => {
    const { result, steps, events } = await walk(name, smoke);
    const planned = new Set(steps.map((step) => step.name));

    assert.deepEqual(
      events.map((event) => event.seq),
      events.map((_, index) => index + 1),
      'event sequence is not gapless from 1'
    );
    assert.equal(events[0]?.type, 'run.queued');
    assert.equal(events.at(-1)?.type, 'run.succeeded');

    // The guarantee the one transaction exists for: no event describes a step
    // whose state was not saved beside it.
    for (const event of events) {
      if (!event.step) continue;
      assert.ok(planned.has(event.step), `event ${event.seq} names unsaved step "${event.step}"`);
    }

    for (const step of steps) {
      assert.ok(
        step.status === 'ok' || step.status === 'degraded',
        `step "${step.name}" ended ${step.status} on a run that succeeded`
      );
      assert.ok(step.endedAt, `step "${step.name}" has no end time`);
    }

    assert.equal(steps.length, result.outcomes.length, 'a step ran without a row, or the reverse');
  });
}
