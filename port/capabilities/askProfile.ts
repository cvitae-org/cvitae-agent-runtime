/**
 * The other execution mode: a question whose steps are not known in advance.
 *
 * "Which of my offers would suit me best, and what have I done that fits?"
 * cannot be a declared pipeline, because how many searches it takes and what to
 * search for both depend on what the previous search returned. This is the case
 * a tool loop is actually for.
 *
 * It carries a requirement the declared capabilities do not: the model has to
 * support tool calling. On the local runner that means gemma4:12b and not
 * gemma3:4b, which advertises `completion` only. That is the practical reason
 * offer extraction is not built this way — it would stop working on the smaller
 * model that runs it five times faster.
 */

import { z } from 'zod';
import type { Capability, Plan, RunContext } from '../core/types.js';
import { planWithModel } from '../core/planner.js';
import { toolSystemPrompt } from '../prompt/builder.js';

export const inputSchema = z.object({
  question: z.string().min(1, 'A question is required.'),
  /** Caps model turns. Each turn is a provider request against a daily quota. */
  maxSteps: z.number().int().min(1).max(12).default(6)
});

export type AskProfileInput = z.infer<typeof inputSchema>;

const SYSTEM = toolSystemPrompt(
  `You answer questions about the user's CV and their saved job offers.
Search before answering. Answer in plain prose, and name the company or offer any claim came from.`
);

export const askProfile: Capability<AskProfileInput> = {
  name: 'ask_profile',
  describe:
    "Answer an open-ended question about the user's CV or their saved job offers, searching as needed.",
  input: inputSchema,

  plan: async (input, context: RunContext): Promise<Plan> =>
    planWithModel({
      capability: 'ask_profile',
      goal: input.question,
      system: SYSTEM,
      context,
      maxSteps: input.maxSteps
    }),

  /**
   * The loop produces prose, not fields, so the default shallow merge would
   * flatten a `text` key into the result and lose which step wrote it.
   */
  aggregate: (outcomes) => {
    const investigation = outcomes.find((outcome) => outcome.step === 'investigate');

    return {
      answer: investigation?.value.text ?? '',
      tool_calls: investigation?.value.toolCalls ?? [],
      model_steps: investigation?.value.steps ?? 0
    };
  }
};
