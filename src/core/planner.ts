/**
 * Turns a capability plus its input into a plan.
 *
 * It is a pass-through, and the thinness is the point rather than an oversight.
 * Every plan is made by the capability that owns the subject, so this module
 * never learns what a CV or an offer is, and the orchestrator downstream cannot
 * tell whether the stages it walks were written out by hand or shaped around a
 * model's answer. Both kinds arrive as the same data.
 *
 * The model-shaped kind is not built here. A capability whose steps are not
 * known in advance declares one bounded `tool_loop` stage of its own and asks
 * `context/tools.ts` which tools belong in it — so the part a model decides is
 * a list of names, and the plan around it is still declared. Keeping that out
 * of `core/` is what lets a capability call it: `capabilities/` may not import
 * the orchestrator, and everything in this directory is the orchestrator.
 */

import type { Capability, Plan, RunContext } from '../contracts/index.js';

export const plan = async <TInput extends Record<string, unknown>>(
  capability: Capability<TInput>,
  input: TInput,
  context: RunContext
): Promise<Plan> => capability.plan(input, context);
