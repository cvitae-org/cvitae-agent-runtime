/**
 * That a run which makes no model call needs no credential.
 *
 * `verifyRecipient.test.ts` pins the plan: with `search_web` off, every step is
 * a transform. This pins the other half, which the plan alone cannot — that the
 * runtime honours it. It did not. The run context resolved a model before the
 * plan existed, so a verification that was never going to reach a provider
 * refused with "Missing OPENROUTER_API_KEY", naming a provider it had no use
 * for and an environment variable belonging to a process the person reading the
 * message did not know was running.
 *
 * So the capability under test is a stand-in rather than `verify_recipient`
 * itself: the property is about the runtime, not about that pipeline, and a
 * real verification would spend the test on three tiers of network fetches.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createRuntime } from '../src/index.js';
import type { Capability } from '../src/core/types.js';

/** Every step a transform, which is what `verify_recipient` plans by default. */
const transformOnly: Capability<{ value: string }> = {
  name: 'transform_only',
  describe: 'Runs one transform and no model call.',
  input: z.object({ value: z.string() }),
  plan: (input) => ({
    capability: 'transform_only',
    concurrency: 1,
    source: 'declared',
    steps: [
      {
        kind: 'transform',
        name: 'echo',
        critical: true,
        run: async () => ({ echoed: input.value })
      }
    ]
  })
};

const withEnv = async <T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>
): Promise<T> => {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]])
  );

  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

test('a capability that makes no model call runs with no credential configured', async () => {
  // A throwaway home, so the run does not read or write the real one.
  const home = await mkdtemp(join(tmpdir(), 'cvitae-runtime-test-'));

  await withEnv(
    {
      CVITAE_HOME: home,
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: undefined,
      AI_MODEL: undefined
    },
    async () => {
      const runtime = createRuntime({
        capabilities: { transform_only: transformOnly } as never,
        aiLogger: { enabled: false, log: async () => {} } as never
      });

      const result = await runtime.run('transform_only', { value: 'ok' });

      assert.equal(result.data.echoed, 'ok');
      assert.deepEqual(result.degraded, []);
    }
  );
});

test('the provider is still named in the result of such a run', async () => {
  const { describeModel } = await import('../src/providers/resolve.js');

  await withEnv({ OPENROUTER_API_KEY: undefined, AI_PROVIDER: 'openrouter' }, async () => {
    const choice = describeModel({});

    // Naming what would have been called costs nothing and needs no key, which
    // is what lets every log line carry it whether or not a model is reached.
    assert.equal(choice.providerId, 'openrouter');
    assert.ok(choice.modelId);
  });
});

/**
 * The other half of the rule, and the one lazy resolution could quietly have
 * broken: a run that *does* reach a model still refuses loudly when there is no
 * credential for it, with the same error class it always used.
 *
 * `ai_not_configured` is not decoration. cvitae switches on it to answer 500
 * and tell the user their provider is not set up; a missing key arriving as a
 * degraded step instead would hand back an answer of fallbacks with the cause
 * recorded nowhere the caller reads, which is the failure mode this project
 * spends the most comments warning about.
 */
test('a step that needs a model still fails on the credential, not on fallbacks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cvitae-runtime-test-'));

  await withEnv(
    {
      CVITAE_HOME: home,
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: undefined,
      AI_MODEL: undefined
    },
    async () => {
      const runtime = createRuntime({
        capabilities: { needs_model: needsModel } as never,
        aiLogger: { enabled: false, log: async () => {} } as never
      });

      await assert.rejects(
        () => runtime.run('needs_model', { value: 'ok' }),
        (error: Error) => {
          // The class, because that is what the HTTP boundary maps to
          // `ai_not_configured`; a `RuntimeError` here would arrive as a
          // generic step failure and lose the specific answer cvitae gives.
          assert.equal(error.name, 'AiConfigError');
          assert.match(error.message, /OPENROUTER_API_KEY/);
          return true;
        }
      );
    }
  );
});

/**
 * Declared non-critical on purpose: were the missing credential treated as an
 * ordinary step failure, this capability would succeed with `domains: []` and
 * say nothing about why. The assertion above is what stops that.
 */
const needsModel: Capability<{ value: string }> = {
  name: 'needs_model',
  describe: 'Runs one model step.',
  input: z.object({ value: z.string() }),
  plan: () => ({
    capability: 'needs_model',
    concurrency: 1,
    source: 'declared',
    steps: [
      {
        kind: 'extract',
        name: 'guess',
        critical: false,
        schema: z.object({ domains: z.array(z.string()) }),
        system: 'unused',
        prompt: 'unused',
        maxOutputTokens: 100,
        fallback: { domains: [] }
      }
    ]
  })
};
