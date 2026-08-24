/**
 * Runs one step, whatever kind it is.
 *
 * This is the only module that talks to the model, which is the point: the
 * orchestrator decides *what* runs and in what order, the executor knows *how*
 * a step is carried out. Adding a fourth step kind touches this file alone.
 *
 * The `ai` import is dynamic for the same reason it is in cvitae's routes — it
 * pulls in provider machinery that a process only doing storage work never
 * needs to load.
 */

import type { Step, RunContext } from './types.js';
import { RuntimeError } from './types.js';
import {
  summarizeObject,
  summarizeText,
  summarizeToolInteractions,
  withAiLogging
} from '../ai/logging.js';

import type * as Ai from 'ai';
type AiModule = typeof Ai;

let aiModulePromise: Promise<AiModule> | null = null;
const loadAiModule = async (): Promise<AiModule> => {
  if (!aiModulePromise) aiModulePromise = import('ai');
  return aiModulePromise;
};

/**
 * A malformed short object is cheap to redo, so one retry is worth it. This is
 * specifically *not* a general retry: a rate limit or a bad credential fails
 * the same way twice and retrying only doubles the wait before the user is
 * told.
 */
const withMalformedRetry = async <T>(
  call: () => Promise<T>,
  isMalformed: (error: unknown) => boolean,
  stepName: string
): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (!isMalformed(error)) throw error;
    console.warn(`Step "${stepName}" returned malformed JSON; retrying.`);
    return call();
  }
};


/**
 * Extraction is decoding, not writing, so it is run greedily.
 *
 * Nothing set a temperature before this, which meant the provider's default
 * applied — 0.8 on Ollama. That is a sampling width chosen for prose, and every
 * step here is copying values that are already in the prompt: there is no
 * variety worth having in which job title comes back, only the risk that a less
 * likely token wins and takes a bullet or an entry with it.
 *
 * Measured over five runs of the same CV on `gemma3:4b`, before and after:
 *
 *   default (0.8)   bullets 25,25,25,24,25   certs 1,1,2,1,2   29.3–37.6s
 *   temperature 0   bullets 25,25,25,25,25   certs 2,2,2,2,2   29.7–30.0s
 *
 * Jobs were 7/7 on all ten runs, so the headline count was never the unstable
 * part; the drift was underneath it, in a dropped bullet and a wandering
 * certificate count. Bullets are now fixed, and the run time stopped varying by
 * eight seconds, which is the same determinism showing up as a schedule.
 *
 * The certificates line is the finding worth keeping. Greedy decoding did not
 * make that step correct — it made it *consistently wrong*: the second
 * certificate is "ICP Blockchain SDK", which is not a certificate at all but an
 * entry from the skills list, and it now appears on every run instead of two in
 * five. Determinism converts an intermittent hallucination into a reliable one,
 * which is better only because a reliable fault can be seen and fixed. This one
 * is the same shape as the spoken-languages bug already recorded in
 * `extractCv.ts`: a section pulling material from a neighbouring one.
 */
const runExtract = async (
  step: Extract<Step, { kind: 'extract' }>,
  context: RunContext
): Promise<Record<string, unknown>> => {
  const { generateObject, NoObjectGeneratedError } = await loadAiModule();
  const model = await context.model();

  /**
   * The model spent its whole budget and said nothing.
   *
   * `finishReason: 'length'` with empty text is not a truncated answer — it is
   * no answer, and it is not a ceiling that wants raising. Measured on
   * `gemma4:12b` against a real CV's skills section: 1200 output tokens
   * consumed with `text: ""`, then the same again at 4000. `gemma3:4b` returned
   * the same section in 3.5s. The README records this model doing the same
   * thing once before under a different prompt wording.
   *
   * Told apart from a malformed object because it changes what to do about it.
   * Malformed JSON is worth one retry; this is deterministic, and retrying only
   * spends another forty-five seconds to arrive in the same place — which is
   * what the step was doing, taking ninety-five seconds to degrade.
   */
  const producedNothing = (error: unknown): boolean =>
    NoObjectGeneratedError.isInstance(error) &&
    error.finishReason === 'length' &&
    !String(error.text ?? '').trim();

  try {
    const result = await withMalformedRetry(
      () =>
        withAiLogging({
          logger: context.aiLogger,
          traceId: context.traceId,
          operation: 'generateObject',
          purpose: 'extract',
          providerId: context.providerId,
          modelId: context.modelId,
          capability: context.capability,
          step: step.name,
          signal: context.signal,
          input: summarizeText('text', step.system, step.prompt),
          call: () =>
            generateObject({
              model,
              schema: step.schema,
              system: step.system,
              prompt: step.prompt,
              maxOutputTokens: step.maxOutputTokens,
              temperature: 0,
              abortSignal: context.signal
            }),
          summarizeResult: (generated) => ({
            output: summarizeObject(generated.object),
            finishReason: generated.finishReason,
            usage: generated.usage
          })
        }),
      (error) => NoObjectGeneratedError.isInstance(error) && !producedNothing(error),
      step.name
    );

    return result.object as Record<string, unknown>;
  } catch (error) {
    if (!producedNothing(error)) throw error;

    // Rewritten because the generic message — "no object generated" — sends the
    // reader to the schema, and the schema is fine. The model is the variable.
    throw new RuntimeError(
      `The model produced no output for "${step.name}": it used its whole token budget and returned nothing. This is not a truncated answer and a larger budget does not help — the model is unable to answer this step. Try a smaller, faster model for extraction.`,
      'step_failed'
    );
  }
};

/**
 * One `generateText` call, for a step whose output is prose.
 *
 * Nearly the simplest thing in this file, and deliberately so — the reason it
 * exists at all is in `GenerateStep`, where the measurement is recorded. No
 * schema, no retry: there is no malformed JSON to retry, because there is no
 * JSON. A model that returns nothing here returns nothing twice.
 *
 * Greedy for the same reason extraction is, with one caveat worth stating.
 * Temperature 0 on prose does trade variety away, and a covering letter is a
 * place variety might be wanted — but a draft the user reads and edits benefits
 * far more from being reproducible, and "run it again and see" is a worse
 * experience than editing a sentence. Measured at `temperature: 0`, gemma3:4b
 * returned the same 129-word letter on three consecutive runs.
 */
const runGenerate = async (
  step: Extract<Step, { kind: 'generate' }>,
  context: RunContext
): Promise<Record<string, unknown>> => {
  const { generateText } = await loadAiModule();
  const model = await context.model();

  const result = await withAiLogging({
    logger: context.aiLogger,
    traceId: context.traceId,
    operation: 'generateText',
    purpose: 'generate',
    providerId: context.providerId,
    modelId: context.modelId,
    capability: context.capability,
    step: step.name,
    signal: context.signal,
    input: summarizeText('text', step.system, step.prompt),
    call: () =>
      generateText({
        model,
        system: step.system,
        prompt: step.prompt,
        maxOutputTokens: step.maxOutputTokens,
        temperature: 0,
        abortSignal: context.signal
      }),
    summarizeResult: (generated) => ({
      output: summarizeText('text', generated.text),
      finishReason: generated.finishReason,
      usage: generated.usage
    })
  });

  const text = result.text.trim();

  // An empty completion is the failure `gemma4:12b` produces on this step, and
  // it has to be raised rather than returned. Passing "" downstream would give
  // the caller a draft-shaped object holding no draft, and the degradation
  // machinery — which exists precisely for this — would never see a failure.
  if (!text) {
    throw new RuntimeError(
      `The model returned nothing for "${step.name}". It finished with reason "${result.finishReason}" and produced no text. Some models return an empty completion for prose steps regardless of the prompt; try a different one.`,
      'step_failed'
    );
  }

  return { [step.key]: text };
};

/**
 * The mode where the model decides what to do next.
 *
 * Two things are deliberately not negotiable. The model only ever sees tools
 * named in `step.tools`, so a capability cannot be talked into reaching storage
 * it was not given; and `stopWhen` always caps the turn count, so a model that
 * loops calling the same tool costs a bounded number of requests rather than a
 * quota.
 */
const runToolLoop = async (
  step: Extract<Step, { kind: 'tool_loop' }>,
  context: RunContext
): Promise<Record<string, unknown>> => {
  const { generateText, stepCountIs } = await loadAiModule();
  const model = await context.model();

  const tools = context.tools.toolSet(step.tools, context);

  const result = await withAiLogging({
    logger: context.aiLogger,
    traceId: context.traceId,
    operation: 'generateText',
    purpose: 'tool_loop',
    providerId: context.providerId,
    modelId: context.modelId,
    capability: context.capability,
    step: step.name,
    signal: context.signal,
    input: summarizeText('text', step.system, step.prompt),
    tools: { offered: step.tools },
    call: () =>
      generateText({
        model,
        system: step.system,
        prompt: step.prompt,
        tools,
        stopWhen: stepCountIs(step.maxSteps),
        abortSignal: context.signal
      }),
    summarizeResult: (generated) => {
      const toolSummary = summarizeToolInteractions(generated);
      return {
        output: summarizeText('text', generated.text),
        finishReason: generated.finishReason,
        usage: generated.totalUsage,
        steps: generated.steps.length,
        tools: { offered: step.tools, ...toolSummary }
      };
    }
  });

  return {
    text: result.text,
    steps: result.steps.length,
    toolCalls: result.steps.flatMap((s) =>
      s.toolCalls.map((call) => call.toolName)
    )
  };
};

export const runStep = async (
  step: Step,
  context: RunContext
): Promise<Record<string, unknown>> => {
  if (context.signal?.aborted) {
    throw new RuntimeError(`Aborted before step "${step.name}".`, 'aborted');
  }

  switch (step.kind) {
    case 'extract':
      return runExtract(step, context);
    case 'generate':
      return runGenerate(step, context);
    case 'tool_loop':
      return runToolLoop(step, context);
    case 'transform':
      return step.run(context);
  }
};
