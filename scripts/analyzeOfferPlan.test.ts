/**
 * The one capability, checked without a model.
 *
 * Two things are worth pinning here and nothing else is. The plan's *shape* is
 * a set of decisions — which step may sink the run, which degrade, how many
 * talk to the provider at once — and every one of them is invisible until it
 * misfires in production, at which point it looks like a model problem. And
 * `applyStated` is the only place in the tree where two sources of truth for
 * the same field meet, so its precedence rules are the domain knowledge that
 * most repays being written down twice.
 *
 * What is not tested here: whether gemma4:12b extracts a salary correctly. That
 * needs a model, it is not deterministic, and it is not what this file is for.
 *
 * Confirmed by breaking things. Making `role` non-critical fails two tests, not
 * one — the criticality assertion, and the fallback test, which then counts
 * five degrading steps where the plan calls for four. Giving `role` a fallback
 * fails the test
 * that says it has none — which is the assertion that documents the measured
 * reason it cannot have one. Changing `extract`'s concurrency from `'auto'` to
 * 1 fails the concurrency test, and to 5 fails it the other way, so the test
 * pins the value rather than one side of it. Turning `fill` into `replace`
 * fails the location test; turning `replace` into `fill` fails the company one.
 * Dropping the `isWorkMode` guard lets 'zdalna' through into `overrides`.
 * Returning every stated key in `applied` rather than only the changed ones
 * fails the "unchanged fields are not claimed" test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeOffer, applyStated, inputSchema } from '../src/capabilities/analyzeOffer.js';
import type { Plan, StatedFacts, Step } from '../src/contracts/index.js';

/** `Capability.plan` may be async; this one is not, and callers should not care. */
const plan = async (input: Record<string, unknown> = { offerText: 'x' }): Promise<Plan> =>
  analyzeOffer.plan(inputSchema.parse(input), {
    runId: 'run-1',
    traceId: 'trace-1',
    capability: 'analyze_offer',
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
    input
  } as never);

const stepsOf = (built: Plan): Step[] => built.stages.flatMap((stage) => [...stage.steps]);

const byName = (built: Plan, name: string): Step => {
  const step = stepsOf(built).find((candidate) => candidate.name === name);
  assert.ok(step, `no step named "${name}"`);
  return step;
};

/* -------------------------------------------------------------------- plan */

test('the plan is three stages: read the source, extract from it, overlay the board', async () => {
  const built = await plan();

  assert.deepEqual(
    built.stages.map((stage) => stage.name),
    ['read', 'extract', 'overlay']
  );

  // Order matters and is the reason stages exist at all: every extract step
  // reads `completed.source`, which only exists because a whole stage finished
  // before this one started.
  assert.deepEqual(
    stepsOf(built).map((step) => step.name),
    ['source', 'facts', 'role', 'compensation', 'logistics', 'duties', 'board_facts']
  );
});

test('fetching the offer is a step, not something hidden inside plan()', async () => {
  const source = byName(await plan({ url: 'https://example.test/offer' }), 'source');

  // A `transform` rather than an `extract`: it reaches an effect and reads no
  // model. Being a step at all is the point — it gets the timing, the events
  // and the persisted row that anything inside `plan()` would not.
  assert.equal(source.kind, 'transform');
  assert.equal(source.critical, true);
});

test('one extraction is critical and it is the one that names the job', async () => {
  const built = await plan();

  assert.deepEqual(
    stepsOf(built)
      .filter((step) => step.critical)
      .map((step) => step.name),
    ['source', 'role']
  );
});

test('every degrading extraction carries a fallback, and the critical one does not', async () => {
  const built = await plan();
  const extraction = built.stages.find((stage) => stage.name === 'extract');
  assert.ok(extraction);

  const degrading = extraction.steps.filter((step) => !step.critical);
  assert.equal(degrading.length, 4);

  for (const step of degrading) {
    assert.ok(
      'fallback' in step && step.fallback !== undefined,
      `"${step.name}" may degrade but has nothing to degrade to`
    );
  }

  // `role` has none on purpose: there is no useful stand-in for "which job is
  // this", so a plan that let it degrade would produce a record that looks
  // complete and names nothing.
  const role = extraction.steps.find((step) => step.name === 'role');
  assert.ok(role);
  assert.equal('fallback' in role ? role.fallback : undefined, undefined);
});

test('the extract stage asks for auto concurrency; the two others ask for one', async () => {
  const built = await plan();
  const concurrency = Object.fromEntries(
    built.stages.map((stage) => [stage.name, stage.concurrency])
  );

  // `'auto'` and not a number, because the right number is a property of the
  // provider — one against a local GPU, the step count against a hosted one —
  // and the capability is not where that is known.
  assert.deepEqual(concurrency, { read: 1, extract: 'auto', overlay: 1 });
});

test('the input needs either text or a url, and takes both', () => {
  assert.ok(inputSchema.safeParse({ offerText: 'a posting' }).success);
  assert.ok(inputSchema.safeParse({ url: 'https://example.test' }).success);
  assert.ok(!inputSchema.safeParse({}).success);
  assert.ok(!inputSchema.safeParse({ offerText: '   ' }).success);
});

/* ------------------------------------------------------------- applyStated */

const facts = (over: Partial<StatedFacts> = {}): StatedFacts => ({ ...over }) as StatedFacts;

test('stated company, title, salary, seniority and start date replace the model', () => {
  const { overrides, applied } = applyStated(
    {
      company: 'Acme Analytics sp. z o.o. (part of Acme Group)',
      position: 'Frontend Developer',
      salary: 'Not stated',
      seniority: 'Mid',
      start_date: 'Not stated'
    },
    facts({
      company: 'Acme Analytics',
      title: 'Senior Frontend Engineer',
      salary: '18 000 - 24 000 PLN',
      seniority: 'Senior',
      start_date: '2026-09-01'
    })
  );

  assert.deepEqual(overrides, {
    company: 'Acme Analytics',
    position: 'Senior Frontend Engineer',
    salary: '18 000 - 24 000 PLN',
    seniority: 'Senior',
    start_date: '2026-09-01'
  });
  assert.deepEqual([...applied].sort(), [
    'company',
    'position',
    'salary',
    'seniority',
    'start_date'
  ]);
});

test('a stated location only fills a gap; it never overwrites a city', () => {
  // The board says "Remote" and it is not lying. It is answering a coarser
  // question than the one `location` asks, and `work_mode` already carries it.
  const kept = applyStated({ location: 'Kraków' }, facts({ location: 'Remote' }));
  assert.deepEqual(kept.overrides, {});
  assert.deepEqual(kept.applied, []);

  const filled = applyStated({ location: 'Not stated' }, facts({ location: 'Remote' }));
  assert.deepEqual(filled.overrides, { location: 'Remote' });
});

test('absence is recognised in the words a model actually writes', () => {
  // Canonicalisation runs after every step, so at overlay time "brak" and "N/A"
  // are still the model's own words. A narrower test than this passes while the
  // overlay quietly refuses to fill anything a Polish model left empty.
  for (const absent of ['Not stated', 'not_stated', 'N/A', 'brak', 'nie podano', 'unknown']) {
    const { overrides } = applyStated({ location: absent }, facts({ location: 'Gdańsk' }));
    assert.deepEqual(overrides, { location: 'Gdańsk' }, `"${absent}" did not read as absent`);
  }
});

test('an unrecognised work mode is dropped rather than stored', () => {
  const rejected = applyStated({ work_mode: 'onsite' }, facts({ work_mode: 'zdalna' }));
  assert.deepEqual(rejected.overrides, {});

  const accepted = applyStated({ work_mode: 'onsite' }, facts({ work_mode: 'remote' }));
  assert.deepEqual(accepted.overrides, { work_mode: 'remote' });
});

test('stated skills lead, the model fills in behind, and neither repeats itself', () => {
  const { overrides } = applyStated(
    { required_skills: ['typescript', 'React', 'D3'] },
    facts({ required_skills: ['React', 'GraphQL'] })
  );

  // Board first because it is the list the employer wrote; case-insensitive
  // dedupe because "React" and "react" are one requirement, not two.
  assert.deepEqual(overrides.required_skills, ['React', 'GraphQL', 'typescript', 'D3']);
});

test('a field the board agrees with is not claimed as applied', () => {
  const { overrides, applied } = applyStated(
    { company: 'Acme Analytics', position: 'Senior Frontend Engineer' },
    facts({ company: 'Acme Analytics', title: 'Senior Frontend Engineer' })
  );

  // `applied` is shown to a person as "these came from the board". Listing a
  // field nothing changed makes that note false in the only way it can be.
  assert.deepEqual(overrides, {});
  assert.deepEqual(applied, []);
});

test('an empty board changes nothing', () => {
  const { overrides, applied } = applyStated({ company: 'Acme' }, facts());
  assert.deepEqual(overrides, {});
  assert.deepEqual(applied, []);
});
