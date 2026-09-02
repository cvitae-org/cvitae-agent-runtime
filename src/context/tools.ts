/**
 * Choosing which tools a loop is allowed to see.
 *
 * This is the same decision the rest of this directory makes about text: what
 * goes in front of the model for this piece of work, and what does not. A loop
 * handed the whole registry still works — it just spends turns reading
 * descriptions of things it was never going to call, and a long tool list is
 * itself a source of wrong calls on a small local model.
 *
 * What is deliberately not here is a model that emits steps. Generated step
 * lists are the classic failure of this pattern: the model has to invent step
 * names, guess schemas and get the dependencies right, and when it gets any of
 * that wrong the error surfaces halfway through execution as something
 * incoherent. Picking from a fixed list of names is a much smaller judgment and
 * one a model is good at, and every way it can go wrong is bounded here — a
 * name that is not in the registry is dropped, an empty pick means every tool,
 * and a provider that is down means every tool.
 *
 * The capability still declares its own plan; this only answers a question and
 * returns names. That is why it sits here rather than in `core/`: nothing in
 * this file drives a run, and a capability may not import something that does.
 */

import { z } from 'zod';
import type { RunContext } from '../contracts/index.js';

/**
 * The instruction, and the wording is load-bearing.
 *
 * `prompt/builder.ts` in the previous runtime recorded that phrasing was the
 * trigger for empty completions on `gemma4:12b`. This is that failure, found
 * again in this repo by running `ask_profile` and watching tool selection fail
 * every single time before falling back to the whole registry.
 *
 * Measured against `gemma4:12b`, same schema, same goal, three attempts each:
 *
 *   Choose the tools needed to accomplish the goal. …            0/3
 *   Choose the tools needed for the goal. …                      0/3
 *   List the tools needed to accomplish the goal. …              3/3
 *   List the tools needed for the goal. …                        3/3
 *
 * Within this prompt the verb is the whole of it. Nothing about the schema
 * mattered: a single string in place of the array failed too, under `Choose`.
 *
 * And it is the prompt, not the word. `routeWithModel` opens with `Choose the
 * capability that best fits the request` and answered 6 of 6 correctly on the
 * same model while this was failing 3 of 3. So there is no rule here to carry
 * anywhere else — which is the finding, not a caveat on it.
 *
 * The restraint sentence is gone for the same reason, and it is not missed —
 * eight runs across two goals returned `read_cv` alone for "summarise the CV"
 * and both tools for a question about one technology, so the bare instruction
 * already discriminates. Every attempt to say it out loud cost accuracy:
 *
 *   … Choose nothing you do not need.                            1/3
 *   … Leave out anything the goal does not need.                 0/8
 *   … Include only what the goal needs.                          4/8
 *   (nothing appended)                                           8/8
 *
 * So: if this is edited, measure it. A failure here is silent by design — the
 * fallback below is correct and the run still answers — which is exactly why
 * a broken prompt sat here undetected.
 */
const SELECTION_PROMPT =
  'List the tools needed for the goal. Use only names from the list.';

const selection = z.object({
  tools: z
    .array(z.string())
    .describe('Names of the tools needed for this goal, most relevant first.')
});

/**
 * Asks the model which of the registered tools this goal needs.
 *
 * Never throws and never returns nothing. A failed or empty selection falls
 * back to offering every tool, which is what a runtime with no selection step
 * would do — less efficient, never wrong — and losing the run over a planning
 * nicety would be the worse trade.
 */
export const selectTools = async ({
  goal,
  context
}: {
  goal: string;
  context: RunContext;
}): Promise<readonly string[]> => {
  const available = context.tools.names();

  try {
    const { object } = await context.effects.ai.generateObject({
      traceId: context.traceId,
      runId: context.runId,
      step: 'plan',
      signal: context.signal,
      schema: selection,
      system: SELECTION_PROMPT,
      prompt: `GOAL:\n${goal}\n\nTOOLS:\n${available.join('\n')}`,
      maxOutputTokens: 400,
      temperature: 0
    });

    const known = new Set(available);
    const picked = object.tools.filter((name) => known.has(name));
    if (picked.length > 0) return picked;
  } catch (error) {
    // The message only — see the note on the same pattern in `router.ts`.
    console.warn(
      `Tool selection failed; offering every tool: ${String((error as Error)?.message ?? error)}`
    );
  }

  return available;
};
