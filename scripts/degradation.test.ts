/**
 * Four of five steps fail, and the caller still gets an answer.
 *
 * This is the policy the previous runtime's offer analysis was built around and
 * the reason it survived contact with a small local model: one call in twenty
 * comes back wrong for reasons no amount of prompt work removes, and a run that
 * fails whenever any of five agents does is a run that fails one time in four.
 * A record missing its salary is worth far more to a user than an error page.
 *
 * The property that makes it honest is that the gap is *named*. `degraded`
 * carries the step names, the step rows carry the reason, and the fallback
 * values are the ones the step declared — so a consumer can grey out the fields
 * that were guessed instead of rendering them as though the model had read the
 * offer and found nothing there.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { startRun } from '../src/runtime/run.js';
import { extract, noop, objectsFrom, spine, stage, timeline } from './support/spine.js';

const FAILING = new Set(['salary', 'stack', 'seniority', 'benefits']);

const plan = [
  stage(
    'analyse',
    [
      extract('facts', true),
      extract('salary', false, { salary: 'Not stated' }),
      extract('stack', false, { stack: [] }),
      extract('seniority', false, { seniority: 'Unknown' }),
      extract('benefits', false, { benefits: 'Not stated' })
    ],
    5
  )
];

test('four non-critical failures degrade, and the run still succeeds', async () => {
  const s = spine(
    { probe: noop('probe', plan) },
    {
      ai: {
        generateObject: objectsFrom((step) => {
          if (FAILING.has(step)) throw new Error(`${step} model refused`);
          return { company: 'Acme', position: 'Engineer' };
        })
      }
    }
  );

  try {
    const result = await startRun(s.deps, { capability: 'probe', input: {} });

    assert.deepEqual([...result.degraded].sort(), ['benefits', 'salary', 'seniority', 'stack']);

    // The critical step's values and every fallback, merged into one record.
    assert.deepEqual(result.data, {
      company: 'Acme',
      position: 'Engineer',
      salary: 'Not stated',
      stack: [],
      seniority: 'Unknown',
      benefits: 'Not stated'
    });

    const run = s.runs.get(result.runId);
    assert.equal(run?.status, 'succeeded');
    assert.deepEqual([...(run?.degraded ?? [])].sort(), [
      'benefits',
      'salary',
      'seniority',
      'stack'
    ]);

    // Each degraded step says why, on its own row.
    const steps = Object.fromEntries(s.runs.steps(result.runId).map((step) => [step.name, step]));
    assert.equal(steps.facts?.status, 'ok');
    assert.equal(steps.salary?.status, 'degraded');
    assert.match(steps.salary?.reason ?? '', /salary model refused/);
    assert.deepEqual(steps.salary?.value, { salary: 'Not stated' });

    const types = timeline(s, result.runId);
    assert.equal(types.filter((type) => type === 'step.degraded').length, 4);
    assert.equal(types.filter((type) => type === 'step.succeeded').length, 1);
    assert.equal(types.at(-1), 'run.succeeded');
  } finally {
    s.dispose();
  }
});

test('a critical failure ends the run, degradation or not', async () => {
  const s = spine(
    { probe: noop('probe', plan) },
    {
      ai: {
        generateObject: objectsFrom((step) => {
          if (step === 'facts') throw new Error('the offer was unreadable');
          return { [step]: 'read' };
        })
      }
    }
  );

  try {
    await assert.rejects(
      () => startRun(s.deps, { capability: 'probe', input: {} }),
      /the "facts" step failed: the offer was unreadable/i
    );

    const [run] = s.runs.list({ limit: 1 });
    assert.equal(run?.status, 'failed');
    assert.equal(run?.errorCode, 'step_failed');
    assert.equal(timeline(s, run?.id ?? '').at(-1), 'run.failed');
  } finally {
    s.dispose();
  }
});
