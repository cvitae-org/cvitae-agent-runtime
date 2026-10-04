/**
 * Runs one step.
 *
 * It receives a context that is already built and already frozen; it never
 * assembles one. That split is what stopped the previous runtime's executor
 * from needing to know about the store, the tool registry and the plan all at
 * once — here it knows a step, a context, and the four ways a step can be
 * carried out.
 *
 * **The executor retries nothing.** The rule is that a retry belongs to the
 * effect that knows what is retryable: a 429 with a `Retry-After` is the model
 * gateway's business, a truncated object is the gateway's business, and a
 * transform that failed because a board returned 403 must not be run again at
 * all. An executor-level retry cannot tell those apart, so it would either
 * re-run the one that must not repeat or paper over the ones that should be
 * reported. What it does instead is fail clearly, and let the degradation
 * policy above it decide what that costs.
 */

import { RuntimeError } from '../contracts/index.js';
import type { FinishReason, SentField, Step, StepContext } from '../contracts/index.js';
import { renderPrompt } from '../context/build.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A completion that stopped because it ran out of room is a failure, even when
 * what came back parses.
 *
 * This is not caution. One of five agents in the previous runtime truncated
 * mid-array at exactly 900 tokens while the other four never came near their
 * ceiling, and a truncated array still validates against `z.array(...)` — the
 * step returns four requirements out of nine and nothing anywhere says so. The
 * per-step `maxOutputTokens` exists so this can be fixed for the one step that
 * needs it, and this check is what makes the need visible.
 */
const rejectTruncation = (step: Step, finishReason: FinishReason, limit: number): void => {
  if (finishReason !== 'length') return;

  throw new RuntimeError(
    `Step "${step.name}" hit its ${limit}-token ceiling before finishing. `
      + 'The output is truncated and cannot be trusted; raise maxOutputTokens for this step.',
    'step_failed'
  );
};

export const runStep = async (
  step: Step,
  context: StepContext
): Promise<Record<string, unknown>> => {
  // Checked once here rather than trusted to the effect below, so a step that
  // was cancelled while queued costs nothing at all.
  context.signal.throwIfAborted();

  const call = {
    traceId: context.traceId,
    runId: context.runId,
    step: step.name,
    signal: context.signal
  };

  /**
   * The step's prose, forwarded as it is written.
   *
   * Only the two kinds that produce prose get one. An `extract` step's output
   * is a structured object assembled from a partial JSON stream — fragments of
   * it are not a shorter answer, they are an unparseable one — and a
   * `transform` runs no model at all.
   */
  const onDelta = (text: string): void => context.deltas({ step: step.name, text });

  /**
   * Said right before the call goes out, so that what is recorded is what was
   * sent: a step that answers without calling a model, or fails before it gets
   * as far as one, has not sent anything.
   */
  const sends = (fields: readonly SentField[] | undefined): void => {
    if (fields !== undefined) context.record?.sent(fields);
  };

  switch (step.kind) {
    case 'transform':
      return step.run(context);

    case 'extract': {
      sends(step.sends);
      const { object, finishReason } = await context.effects.ai.generateObject({
        ...call,
        schema: step.schema,
        system: step.system,
        prompt: renderPrompt(step.prompt, context),
        maxOutputTokens: step.maxOutputTokens,
        // Extraction is a reading, not a composition. Sampling here buys
        // variation in an answer that is supposed to be the same every time.
        temperature: 0
      });

      rejectTruncation(step, finishReason, step.maxOutputTokens);

      if (!isRecord(object)) {
        throw new RuntimeError(
          `Step "${step.name}" returned ${Array.isArray(object) ? 'an array' : typeof object}, `
            + 'but an extract step must return an object so its fields can be merged.',
          'step_failed'
        );
      }

      return object;
    }

    case 'generate': {
      const direct = step.directText?.(context);
      if (direct !== undefined) {
        if (!direct.trim()) throw new RuntimeError('The deterministic answer is empty.', 'step_failed');
        return { [step.key]: direct };
      }
      sends(step.sends);
      const { text, finishReason } = await context.effects.ai.generateText({
        ...call,
        system: step.system,
        prompt: renderPrompt(step.prompt, context),
        maxOutputTokens: step.maxOutputTokens,
        onDelta
      });

      rejectTruncation(step, finishReason, step.maxOutputTokens);

      if (text.trim().length === 0) {
        throw new RuntimeError(
          `Step "${step.name}" returned an empty completion.`,
          'step_failed'
        );
      }

      return { [step.key]: text };
    }

    case 'tool_loop': {
      const handles = context.tools.handles(step.tools, {
        traceId: context.traceId,
        runId: context.runId,
        step: step.name,
        signal: context.signal,
        effects: context.effects,
        documents: context.documents,
        retrieval: context.retrieval,
        ...(context.record === undefined ? {} : { record: context.record })
      });

      sends(step.sends);
      const result = await context.effects.ai.runToolLoop({
        ...call,
        system: step.system,
        prompt: renderPrompt(step.prompt, context),
        // Spread rather than passed as `undefined`, so a step that declares no
        // conversation produces a request with no `history` key at all — which
        // is what makes "absent and empty mean the same thing" true of the
        // object a gateway actually receives, not only of the type.
        ...(step.history && step.history.length > 0 ? { history: step.history } : {}),
        tools: handles,
        maxSteps: step.maxSteps,
        onDelta
      });

      // A loop that stopped because it hit `maxSteps` has not answered; it ran
      // out of turns. Reported as a failure so the step's policy decides,
      // rather than returning a half-finished investigation as a result.
      if (result.steps >= step.maxSteps && result.finishReason === 'tool-calls') {
        throw new RuntimeError(
          `Step "${step.name}" used all ${step.maxSteps} turns without reaching an answer.`,
          'step_failed'
        );
      }

      return { text: result.text, toolSteps: result.steps };
    }
  }
};
