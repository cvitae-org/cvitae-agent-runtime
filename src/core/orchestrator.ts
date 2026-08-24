/**
 * Walks a plan.
 *
 * It does three things and deliberately no more: resolve concurrency, run the
 * steps, and decide what a failure means. Everything about *how* a step runs
 * belongs to the executor, and everything about *which* steps exist belongs to
 * the planner.
 *
 * The degradation policy is the part worth reading. A non-critical step that
 * fails does not fail the run — it contributes its declared fallback values and
 * its name goes into `degraded`. cvitae learned this the hard way: four of the
 * five offer-analysis agents are allowed to fail, because a record missing its
 * salary is worth far more to the user than a 500, and a small local model will
 * drop one call in twenty for reasons no amount of prompt work removes.
 */

import { runPooled } from './pool.js';
import { runStep } from './executor.js';
import { mergeOutcomes } from './aggregator.js';
import type {
  Plan,
  RunContext,
  RunResult,
  Step,
  StepOutcome,
  Concurrency
} from './types.js';
import { RuntimeError } from './types.js';

/**
 * A local server is one GPU, so overlapping calls contend rather than overlap.
 * Hosted providers run them genuinely in parallel and the step count is the
 * right ceiling.
 */
export const resolveConcurrency = (
  concurrency: Concurrency,
  providerId: string,
  stepCount: number
): number => {
  if (concurrency !== 'auto') return Math.max(1, concurrency);
  return providerId === 'local' ? 1 : Math.max(1, stepCount);
};

/**
 * Steps that read `context.completed` cannot run beside the step they read
 * from. Rather than inferring a dependency graph — which needs a declaration
 * this design does not have — `transform` steps run after the model steps, in
 * order. That covers the real case (fetch, then extract, then merge) without
 * inventing a scheduler.
 */
const partition = (steps: Step[]): { parallel: Step[]; sequential: Step[] } => ({
  parallel: steps.filter((step) => step.kind !== 'transform'),
  sequential: steps.filter((step) => step.kind === 'transform')
});

const describe = (reason: unknown): string =>
  String(
    (reason as { message?: string } | null)?.message ?? reason ?? 'unknown error'
  ).slice(0, 160);

export const executePlan = async (
  plan: Plan,
  context: RunContext,
  aggregate: (outcomes: StepOutcome[]) => Record<string, unknown> = mergeOutcomes
): Promise<RunResult> => {
  const startedAt = Date.now();
  const outcomes: StepOutcome[] = [];
  const degraded: string[] = [];

  const record = (step: Step, result: PromiseSettledResult<Record<string, unknown>>) => {
    if (result.status === 'fulfilled') {
      outcomes.push({ step: step.name, status: 'ok', value: result.value });
      return;
    }

    // An abort is not a step failing, and must not be reported as one. Every
    // in-flight call rejects at once when the signal fires, so degrading them
    // individually would hand back a record filled with fallbacks — "salary:
    // Not stated", "company: Unknown" — as though the model had read the offer
    // and found nothing. It never read it. The run did not finish, and only the
    // `aborted` code says so; `step_failed` would send the caller looking for a
    // bug in a step that was working.
    if (context.signal?.aborted) {
      throw new RuntimeError(`Aborted during step "${step.name}".`, 'aborted');
    }

    if (step.critical) {
      throw new RuntimeError(
        `The "${step.name}" step failed: ${describe(result.reason)}`,
        'step_failed'
      );
    }

    console.warn(`Step "${step.name}" failed; filling defaults.`, result.reason);

    outcomes.push({
      step: step.name,
      status: 'degraded',
      reason: describe(result.reason),
      // Both model-driven kinds that declare fallbacks contribute them; a
      // tool loop and a transform have none to give.
      value: 'fallback' in step ? (step.fallback ?? {}) : {}
    });
    degraded.push(step.name);
  };

  const { parallel, sequential } = partition(plan.steps);

  if (parallel.length > 0) {
    const limit = resolveConcurrency(
      plan.concurrency,
      context.providerId,
      parallel.length
    );

    const settled = await runPooled(
      parallel.map((step) => () => runStep(step, context)),
      limit
    );

    settled.forEach((result, index) => {
      const step = parallel[index];
      if (step && result) record(step, result);
    });
  }

  // Sequential steps see everything that has landed so far, which is the only
  // reason they are sequential.
  for (const step of sequential) {
    for (const outcome of outcomes) {
      context.completed[outcome.step] = outcome.value;
    }

    try {
      record(step, { status: 'fulfilled', value: await runStep(step, context) });
    } catch (reason) {
      record(step, { status: 'rejected', reason });
    }
  }

  return {
    capability: plan.capability,
    data: aggregate(outcomes),
    degraded,
    outcomes,
    elapsedMs: Date.now() - startedAt
  };
};
