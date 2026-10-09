/**
 * Asking what a run needs before anything is paid for.
 *
 * `plan` may call a model (`ask_profile` asks one which tools to offer), so a
 * run that cannot be answered has to be found out before it. A capability says
 * what it needs of the run (`Capability.needs`), and this is the part that acts
 * on it, for a new run and for a resumed one alike:
 *
 *   required and unmet   the run fails here, with `needs_unmet`, having called
 *                        nothing and written nothing but its own failure
 *   optional and unmet   the run goes on and the answer says what it was made
 *                        without, under `degraded`, as a step that fell back does
 */

import { OperationError } from '../contracts/index.js';
import type { Capability, Need, RunContext, RunResult } from '../contracts/index.js';
import { consentRefusal } from '../effects/consent.js';

/**
 * That a run which sends what a person handed in goes only where they agreed it
 * may, asked here as well as at each call (`effects/consent.ts`): a run that would
 * be refused is refused before it reads a source, with its own code, and not as
 * an import that found nothing.
 */
const consentNeeds = <TInput extends Record<string, unknown>>(
  capability: Capability<TInput>,
  input: TInput,
  context: RunContext
): Need[] => {
  if (capability.consented === undefined) return [];
  const refusal = consentRefusal(context.effects.ai.describe().providerId, capability.consented(input));
  return refusal === undefined ? [] : [{ name: 'consent', required: true, unmet: refusal.message, code: refusal.code }];
};

/** The optional needs that are not met, by name. Throws on a required one. */
export const checkNeeds = <TInput extends Record<string, unknown>>(
  capability: Capability<TInput>,
  input: TInput,
  context: RunContext
): string[] => {
  const unmet = [...consentNeeds(capability, input, context), ...(capability.needs?.(input, context) ?? [])]
    .filter((need) => need.unmet !== undefined);

  const required = unmet.find((need) => need.required);
  if (required !== undefined) {
    // A need with a code of its own is said by it, and says only why: its name
    // would be the code again.
    throw required.code === undefined
      ? new OperationError('needs_unmet', `${required.name}: ${required.unmet}`)
      : new OperationError(required.code, required.unmet ?? required.name);
  }
  return unmet.map((need) => need.name);
};

/** A result that also names what the run went without. Itself when there is nothing to add. */
export const withoutNeeds = (result: RunResult, names: readonly string[]): RunResult => {
  const added = names.filter((name) => !result.degraded.includes(name));
  return added.length === 0 ? result : { ...result, degraded: [...result.degraded, ...added] };
};
