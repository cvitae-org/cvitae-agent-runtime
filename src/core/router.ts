/**
 * Picks the capability a request is asking for.
 *
 * Almost always by name, because almost always the caller knows: a research
 * screen wants `analyze_offer`, not "whatever the model thinks this is". A
 * router that consults a model when it does not have to is a round trip and a
 * failure mode bought for nothing.
 *
 * The model path exists for the one case where the caller genuinely does not
 * know — free text typed by a person — and it lives in a separate function so
 * that reaching for it is a decision rather than a default.
 */

import { z } from 'zod';
import { RuntimeError } from '../contracts/index.js';
import type { Capability, CapabilityMap, RunContext } from '../contracts/index.js';

export const route = (capabilities: CapabilityMap, name: string): Capability => {
  const capability = capabilities[name];

  if (!capability) {
    const known = Object.keys(capabilities).sort().join(', ');
    throw new RuntimeError(
      `Unknown capability "${name}". Available: ${known || '(none registered)'}.`,
      'unknown_capability'
    );
  }

  return capability;
};

/**
 * Validates input against the capability's own schema.
 *
 * Separate from `route` because the two failures mean different things to a
 * caller: a wrong name is a programming error, a wrong shape is usually a bad
 * request that deserves to be reported field by field.
 *
 * This is also the boundary that makes `Capability`'s bivariant `plan` method
 * safe — see the note there. Nothing reaches `plan` without passing through
 * here first.
 */
export const validateInput = <TInput extends Record<string, unknown>>(
  capability: Capability<TInput>,
  input: unknown
): TInput => {
  const parsed = capability.input.safeParse(input);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');

    throw new RuntimeError(`Invalid input for "${capability.name}". ${detail}`, 'invalid_input');
  }

  return parsed.data;
};

const choice = z.object({
  capability: z.string().describe('The name of the capability that fits best.'),
  reason: z.string().describe('One short sentence saying why.')
});

/**
 * Asks a model which capability a free-text request wants.
 *
 * Returns `null` rather than throwing when it cannot decide, or when the model
 * names something that does not exist — the caller is far better placed to ask
 * the user than this is to guess a second time.
 */
export const routeWithModel = async (
  capabilities: CapabilityMap,
  request: string,
  context: RunContext
): Promise<{ capability: Capability; reason: string } | null> => {
  const entries = Object.values(capabilities);
  if (entries.length === 0) return null;

  try {
    const { object } = await context.effects.ai.generateObject({
      traceId: context.traceId,
      runId: context.runId,
      step: 'route',
      signal: context.signal,
      schema: choice,
      system: 'Choose the capability that best fits the request. Use only a name from the list.',
      prompt: `REQUEST:\n${request}\n\nCAPABILITIES:\n${entries
        .map((entry) => `- ${entry.name}: ${entry.describe}`)
        .join('\n')}`,
      maxOutputTokens: 300,
      temperature: 0
    });

    const chosen = capabilities[object.capability];
    return chosen ? { capability: chosen, reason: object.reason } : null;
  } catch (error) {
    // The message only. A raw SDK error carries the request prompt and the
    // response body, and printing one two lines from a metadata-only logger
    // defeats the logger. The gateway has already redacted what it throws.
    console.warn(`Model routing failed: ${String((error as Error)?.message ?? error)}`);
    return null;
  }
};
