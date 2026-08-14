/**
 * Turns a capability plus its input into a plan.
 *
 * For a declared capability this is a pass-through, and that is the common
 * case by design. The interesting decision is what the *other* kind of planner
 * does, and this one is deliberately modest: it does not ask a model to emit an
 * arbitrary list of steps.
 *
 * Generated step lists are the classic failure of this pattern. The model has
 * to invent step names, guess schemas, and get the dependencies right, and when
 * it gets any of that wrong the error surfaces halfway through execution as
 * something incoherent. What it is actually good at is a much smaller
 * judgement: given this goal and these tools, which tools are relevant. So the
 * LLM path here picks a tool subset and hands back a single bounded `tool_loop`
 * step, letting the model make its decisions at execution time — where it can
 * see results — instead of committing to them up front.
 *
 * The seam is real either way: `plan()` returns a `Plan` and the orchestrator
 * cannot tell which path produced it. If a generated multi-step planner later
 * earns its place, it slots in here without touching anything downstream.
 */

import { z } from 'zod';
import type { Capability, Plan, RunContext } from './types.js';

import type * as Ai from 'ai';
type AiModule = typeof Ai;

let aiModulePromise: Promise<AiModule> | null = null;
const loadAiModule = async (): Promise<AiModule> => {
  if (!aiModulePromise) aiModulePromise = import('ai');
  return aiModulePromise;
};

export const plan = async <TInput>(
  capability: Capability<TInput>,
  input: TInput,
  context: RunContext
): Promise<Plan> => capability.plan(input, context);

const selectionSchema = z.object({
  tools: z
    .array(z.string())
    .describe('Names of the tools needed for this goal, most relevant first.')
});

/**
 * Builds a one-step tool-loop plan for an open-ended goal.
 *
 * Capabilities call this from their own `plan()` when the work has no fixed
 * shape — "research this company", "find offers matching my profile". Anything
 * whose steps are known in advance should declare them instead: it is faster,
 * cheaper, reproducible, and runs on models that cannot call tools at all.
 */
export const planWithModel = async ({
  capability,
  goal,
  system,
  context,
  maxSteps = 8
}: {
  capability: string;
  goal: string;
  system: string;
  context: RunContext;
  maxSteps?: number;
}): Promise<Plan> => {
  const available = context.tools.describe();

  const { generateObject } = await loadAiModule();

  let selected: string[] = available.map((tool) => tool.name);

  // A failed selection is not worth failing the run over: the fallback is
  // "offer every tool", which is what a runtime without a planner would do.
  try {
    const { object } = await generateObject({
      model: context.model,
      schema: selectionSchema,
      system:
        'Choose the tools needed to accomplish the goal. Use only names from the list. Choose nothing you do not need.',
      prompt: `GOAL:\n${goal}\n\nTOOLS:\n${available
        .map((tool) => `- ${tool.name}: ${tool.describe}`)
        .join('\n')}`,
      maxOutputTokens: 400,
      abortSignal: context.signal
    });

    const known = new Set(available.map((tool) => tool.name));
    const picked = object.tools.filter((name) => known.has(name));
    if (picked.length > 0) selected = picked;
  } catch (error) {
    console.warn('Tool selection failed; offering every tool.', error);
  }

  return {
    capability,
    source: 'llm',
    concurrency: 1,
    steps: [
      {
        kind: 'tool_loop',
        name: 'investigate',
        system,
        prompt: goal,
        tools: selected,
        maxSteps,
        critical: true
      }
    ]
  };
};
