/**
 * Refusing to resume a run on a copy that no longer matches the document.
 *
 * A step that assembled pieces for a model (`capabilities/cv/assembly.ts`, and
 * `capabilities/cv/fit.ts` for offers) leaves its text with its outcome, and a
 * resumed run reads that outcome back instead of assembling again. The text is a copy, made when the step ran. A run that waited
 * for a person may be resumed after the CV was edited, or after the person left
 * one of its pieces out, and sending the copy then would send the piece as it was
 * and not as it is, or one the conversation no longer allows.
 *
 * So it does not go on with it. The run fails with `grounding_stale` and names the
 * pieces, and asking again assembles from what the document holds now.
 */

import { GROUNDED, OperationError } from '../contracts/index.js';
import type { Grounded, RunContext, StepOutcome } from '../contracts/index.js';
import { staleCv } from '../capabilities/cv/assembly.js';
import { staleOffers } from '../capabilities/cv/fit.js';

export const staleGrounding = (context: RunContext, outcomes: readonly StepOutcome[]): void => {
  const stale = outcomes.flatMap((outcome) => {
    const made = outcome.value[GROUNDED] as Grounded | undefined;
    return made === undefined || !Array.isArray(made.entries)
      ? []
      : [...staleCv(context, made.entries), ...staleOffers(context, made.entries)];
  });
  if (stale.length === 0) return;

  throw new OperationError(
    'grounding_stale',
    `What this run was given is out of date: ${[...new Set(stale)].join(', ')}. Ask again to send it as it is now.`
  );
};
