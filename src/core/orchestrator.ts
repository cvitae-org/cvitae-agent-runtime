/**
 * Walks a plan.
 *
 * Three jobs and deliberately no more: resolve concurrency, run the steps, and
 * decide what a failure means. *How* a step runs belongs to the executor;
 * *which* steps exist belongs to the capability.
 *
 * Two policies are worth reading before the code.
 *
 * **Degradation.** A non-critical step that fails does not fail the run — it
 * contributes its declared fallback values and its name goes into `degraded`.
 * This was learned expensively: four of the five offer-analysis agents in the
 * previous runtime are allowed to fail, because a record missing its salary is
 * worth far more to a user than an error page, and a small local model will
 * drop one call in twenty for reasons no amount of prompt work removes. The
 * gap is *named* rather than silently absent, which is the difference between
 * a partial answer and a wrong one.
 *
 * **Failing fast.** A critical failure aborts the pool as it settles, not after
 * it. The previous runtime examined the results only once the whole pool had
 * finished, so a run whose result was already invalid went on paying for four
 * more model calls against a busy local GPU. Here the failing task aborts the
 * stage's signal itself, and `runPooled` stops claiming slots.
 */

import { runPooled } from './pool.js';
import { runStep } from './executor.js';
import { mergeOutcomes } from './aggregator.js';
import { buildStepContext } from '../context/build.js';
import type { Checkpointer } from '../runs/checkpoint.js';
import { OperationError, RuntimeError, isRunSuspension } from '../contracts/index.js';
import type {
  ApprovalGate,
  Concurrency,
  Plan,
  RunContext,
  RunResult,
  Stage,
  Step,
  StepOutcome,
  StepRef
} from '../contracts/index.js';

/**
 * A local server is one GPU, so overlapping calls contend rather than overlap.
 * Hosted providers run them genuinely in parallel, and there the step count is
 * the right ceiling.
 */
export const resolveConcurrency = (
  concurrency: Concurrency,
  providerId: string,
  stepCount: number
): number => {
  if (concurrency !== 'auto') return Math.max(1, concurrency);
  return providerId === 'local' ? 1 : Math.max(1, stepCount);
};

const describe = (reason: unknown): string =>
  String((reason as { message?: string } | null)?.message ?? reason ?? 'unknown error').slice(
    0,
    240
  );

const fallbackOf = (step: Step): Readonly<Record<string, unknown>> =>
  'fallback' in step ? (step.fallback ?? {}) : {};

/** Ordinals run across the whole plan, so a step's number is its position in the run. */
const declare = (stages: readonly Stage[]): { stage: Stage; refs: StepRef[] }[] => {
  let ordinal = 0;
  return stages.map((stage) => ({
    stage,
    refs: stage.steps.map((step) => ({
      name: step.name,
      kind: step.kind,
      critical: step.critical,
      ordinal: ordinal++
    }))
  }));
};

/**
 * `setTimeout` accepts a 32-bit delay; anything larger fires immediately, which
 * would turn "no meaningful deadline" into "abort at once".
 */
const MAX_DELAY = 2_147_483_647;

export const executePlan = async (
  plan: Plan,
  context: RunContext,
  deps: {
    readonly checkpoint: Checkpointer;
    readonly aggregate?: (outcomes: readonly StepOutcome[]) => Record<string, unknown>;
    /**
     * Approvals are bound per step, because `ApprovalGate.request` has to know
     * which step is asking in order to find an answer left for it. The run-level
     * gate on `RunContext` serves planning; this one serves execution.
     */
    readonly approvalsFor?: (step: string) => ApprovalGate;
    /**
     * Steps that already finished in an earlier attempt at this run.
     *
     * A resumed run re-declares the same plan and walks it again, and without
     * this it would re-run every step that already succeeded — re-paying for
     * the model calls and, worse, re-performing whatever they did. Passing the
     * recorded outcomes back in makes the walk skip them and hand later stages
     * the values they produced the first time.
     */
    readonly completedSteps?: readonly StepOutcome[];
    readonly now?: () => number;
  }
): Promise<RunResult> => {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const aggregate = deps.aggregate ?? mergeOutcomes;

  const declared = declare(plan.stages);
  deps.checkpoint.planned(
    plan,
    declared.flatMap((entry) => entry.refs)
  );

  const { providerId } = context.effects.ai.describe();

  const outcomes: StepOutcome[] = [...(deps.completedSteps ?? [])];
  const degraded: string[] = outcomes
    .filter((outcome) => outcome.status === 'degraded')
    .map((outcome) => outcome.step);
  const completed: Record<string, Record<string, unknown>> = Object.fromEntries(
    outcomes.map((outcome) => [outcome.step, { ...outcome.value }])
  );
  const alreadyDone = new Set(outcomes.map((outcome) => outcome.step));

  /**
   * Fires for a caller's cancellation, a passed deadline, or a critical sibling
   * failing. A step never has to know which — it is handed one signal that
   * means "stop", and the classification happens here where the answer is known.
   */
  const stop = new AbortController();
  const remaining = Math.min(Math.max(context.deadlineAt - now(), 0), MAX_DELAY);

  /**
   * Held rather than composed inline, because `classify` has to ask it whether
   * the deadline is what stopped the run.
   *
   * It used to ask the clock instead — `now() >= context.deadlineAt` — and the
   * clock is not the thing that fired. A timer and a timestamp comparison agree
   * most of the time and disagree exactly when it matters: `setTimeout` may run
   * a tick early against a coarse clock, and `now` is injectable, so a test or a
   * caller supplying its own clock can freeze it while the real timer still
   * fires. Then the check reads false, control falls through to the plain
   * rethrow below, and the run is filed under whatever the interrupted call
   * happened to throw. From the gateway that is `The call was cancelled.` with
   * code `aborted`, which `settleFailure` maps to run status `cancelled` — a
   * timeout recorded as though a person had pressed ctrl-c, with no error code
   * on the row to say otherwise.
   *
   * The signal knows. Asking it is exact and free.
   *
   * `remaining` is clamped to `MAX_DELAY`, so a deadline further out than a
   * 32-bit delay stops the run early and reports it as a deadline. That is
   * still the truthful account of what happened — the runtime's own timer is
   * what fired — and 24 days is not a deadline anyone sets.
   */
  const expiry = AbortSignal.timeout(remaining);
  const signal = AbortSignal.any([context.signal, stop.signal, expiry]);

  /** Rethrows the failure that stopped the run, classified for the caller. */
  const classify = (reason: unknown, step: string): never => {
    if (isRunSuspension(reason)) throw reason;

    if (context.signal.aborted) {
      throw new RuntimeError(`Run cancelled during step "${step}".`, 'aborted', { cause: reason });
    }

    if (expiry.aborted) {
      throw new RuntimeError(
        `Run passed its deadline during step "${step}".`,
        'deadline_exceeded',
        { cause: reason }
      );
    }

    if (reason instanceof RuntimeError || reason instanceof OperationError) throw reason;

    throw new RuntimeError(`The "${step}" step failed: ${describe(reason)}`, 'step_failed', {
      cause: reason
    });
  };

  /**
   * Never write `skipped` over a step that already ran.
   *
   * On a resumed run, `alreadyDone` holds the steps restored from the previous
   * attempt's checkpoint, and their rows say `ok` or `degraded`. Marking one
   * `skipped` would discard a result that exists — `recordedOutcomes` reads
   * only those two statuses, so the next resume would run it again and pay for
   * it again. The loop below reaches them: a run resumed with a signal that is
   * already aborted skips its way through every stage, earlier ones included.
   */
  const notDone = (refs: readonly StepRef[]): StepRef[] =>
    refs.filter((ref) => !alreadyDone.has(ref.name));

  /** The steps of every stage from `index` on. */
  const remainingFrom = (index: number): StepRef[] =>
    declared.slice(index).flatMap((entry) => notDone(entry.refs));

  for (const [index, { stage, refs }] of declared.entries()) {
    if (signal.aborted) {
      deps.checkpoint.skipped(notDone(refs));
      continue;
    }

    // Taken once per stage, before any step in it starts. Every step in the
    // stage therefore sees the same `completed`, regardless of the order the
    // pool happens to finish them in.
    const visible = { ...completed };
    const pending = stage.steps
      .map((step, index) => ({ step, ref: refs[index] }))
      .filter((entry): entry is { step: Step; ref: StepRef } => Boolean(entry.ref))
      .filter((entry) => !alreadyDone.has(entry.ref.name));

    const settled = await runPooled(
      pending.map(({ step, ref }) => async (stageSignal: AbortSignal): Promise<StepOutcome> => {
        deps.checkpoint.stepStarted(ref);
        const began = now();

        try {
          const value = await runStep(
            step,
            buildStepContext(context, ref, visible, stageSignal, deps.approvalsFor?.(ref.name))
          );
          deps.checkpoint.stepSucceeded(ref, value, now() - began);
          return { step: ref.name, status: 'ok', value };
        } catch (error) {
          const elapsed = now() - began;

          if (isRunSuspension(error)) {
            // The run parks and the step goes back to pending, in one write.
            // Siblings are stopped rather than left running against a run that
            // is no longer active.
            deps.checkpoint.suspended(ref, error.approvalId);
            stop.abort(error);
            throw error;
          }

          // An abort is not a step failing, and must not be recorded as one.
          // Every in-flight call rejects at once when the signal fires, so
          // degrading them individually would hand back a record full of
          // fallbacks — "salary: Not stated", "company: Unknown" — as though
          // the model had read the offer and found nothing. It never read it.
          //
          // It is not nothing either, which is what this used to write. The
          // step was left at `running` and the run went terminal around it, so
          // `runs show` reported a finished run with a step still in flight.
          // Every aborted sibling records itself here, not just the one whose
          // rejection `classify` happens to pick up below.
          if (stageSignal.aborted) {
            deps.checkpoint.stepStopped(ref, elapsed);
            throw error;
          }

          const recoverable = step.kind === 'extract' && error instanceof RuntimeError &&
            step.fallbackOn?.includes(error.code) === true;
          // A call refused because the person did not agree to where it would go
          // is not a step that found nothing: nothing was read. It ends the run
          // with its own code, whatever the step.
          const refused = error instanceof RuntimeError && error.code === 'egress_consent_required';
          if (refused || (step.critical && !recoverable)) {
            deps.checkpoint.stepFailed(ref, describe(error), elapsed);
            stop.abort(error);
            throw error;
          }

          const reason = describe(error);
          const value = fallbackOf(step);
          deps.checkpoint.stepDegraded(ref, reason, value, elapsed);
          return { step: ref.name, status: 'degraded', reason, value };
        }
      }),
      resolveConcurrency(stage.concurrency, providerId, stage.steps.length),
      signal
    );

    const skipped: StepRef[] = [];
    let failure: { reason: unknown; step: string } | undefined;

    for (const [index, result] of settled.entries()) {
      const ref = pending[index]?.ref;
      if (!ref) continue;

      if (result.status === 'fulfilled') {
        outcomes.push(result.value);
        completed[ref.name] = { ...result.value.value };
        if (result.value.status === 'degraded') degraded.push(ref.name);
      } else if (result.status === 'rejected') {
        failure ??= { reason: result.reason, step: ref.name };
      } else {
        skipped.push(ref);
      }
    }

    // The whole stage is recorded before anything is thrown. Classifying in the
    // loop above would rethrow at the failing step and leave the steps it
    // prevented sitting at `pending` for ever — a run that reads as still
    // having work outstanding when in fact it was stopped.
    deps.checkpoint.skipped(skipped);

    if (failure) {
      // And the same argument one level up, which the line above does not
      // reach. `classify` throws out of this loop, so a stage that never got
      // its turn is never visited, and its steps keep the `pending` they were
      // declared with — the state that means "still to do" — on a run that is
      // over. In the run this was found in, `experience` stopped and
      // `assemble`, a stage later, stayed `pending`.
      deps.checkpoint.skipped(remainingFrom(index + 1));
      classify(failure.reason, failure.step);
    }
  }

  // Reached only when nothing threw, so an aborted signal here means the caller
  // cancelled between the last step finishing and this line.
  if (context.signal.aborted) {
    throw new RuntimeError('Run cancelled.', 'aborted');
  }

  return {
    runId: context.runId,
    capability: plan.capability,
    data: aggregate(outcomes),
    degraded,
    outcomes,
    elapsedMs: now() - startedAt
  };
};
