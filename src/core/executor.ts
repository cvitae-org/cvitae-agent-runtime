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

const runExtract = async (
  step: Extract<Step, { kind: 'extract' }>,
  context: RunContext
): Promise<Record<string, unknown>> => {
  const { generateObject, NoObjectGeneratedError } = await loadAiModule();

  const result = await withMalformedRetry(
    () =>
      generateObject({
        model: context.model,
        schema: step.schema,
        system: step.system,
        prompt: step.prompt,
        maxOutputTokens: step.maxOutputTokens,
        abortSignal: context.signal
      }),
    (error) => NoObjectGeneratedError.isInstance(error),
    step.name
  );

  return result.object as Record<string, unknown>;
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

  const tools = context.tools.toolSet(step.tools, context);

  const result = await generateText({
    model: context.model,
    system: step.system,
    prompt: step.prompt,
    tools,
    stopWhen: stepCountIs(step.maxSteps),
    abortSignal: context.signal
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
    case 'tool_loop':
      return runToolLoop(step, context);
    case 'transform':
      return step.run(context);
  }
};
