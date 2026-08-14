/**
 * Picks the capability a request is asking for.
 *
 * Almost always by name, because almost always the caller knows: cvitae's
 * research page wants `analyze_offer`, not "whatever the model thinks this is".
 * A router that consults a model when it does not have to is a round trip and a
 * failure mode bought for nothing.
 *
 * The model path exists for the one case where the caller genuinely does not
 * know — free text from a person — and is kept in a separate function so that
 * reaching for it is a decision rather than a default.
 */

import { z } from 'zod';
import type { Capability, RunContext } from './types.js';
import { RuntimeError } from './types.js';

import type * as Ai from 'ai';
type AiModule = typeof Ai;

let aiModulePromise: Promise<AiModule> | null = null;
const loadAiModule = async (): Promise<AiModule> => {
  if (!aiModulePromise) aiModulePromise = import('ai');
  return aiModulePromise;
};

/**
 * Heterogeneous by construction: each capability has its own input type, and
 * the runtime validates against the stored schema before ever using the value.
 * A generic parameter here would have to be threaded through every caller to
 * express something the registry deliberately erases.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CapabilityMap = Record<string, Capability<any>>;

export const route = (
  capabilities: CapabilityMap,
  name: string
): Capability => {
  const capability = capabilities[name];

  if (!capability) {
    throw new RuntimeError(
      `Unknown capability "${name}". Available: ${Object.keys(capabilities).join(', ')}.`,
      'unknown_capability'
    );
  }

  return capability as Capability;
};

/**
 * Validates input against the capability's own schema.
 *
 * Separate from `route` because the two failures are different for the caller:
 * a wrong name is a programming error, a wrong shape is usually a bad request
 * that should be reported field by field.
 */
export const validateInput = <TInput>(
  capability: Capability<TInput>,
  input: unknown
): TInput => {
  const parsed = capability.input.safeParse(input);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');

    throw new RuntimeError(
      `Invalid input for "${capability.name}". ${detail}`,
      'invalid_input'
    );
  }

  return parsed.data;
};

const choiceSchema = z.object({
  capability: z.string().describe('The name of the capability that fits best.'),
  reason: z.string().describe('One short sentence saying why.')
});

/**
 * Asks a model which capability a free-text request wants.
 *
 * Returns `null` rather than throwing when it cannot decide or the model names
 * something that does not exist — the caller is better placed to ask the user
 * than this is to guess a second time.
 */
export const routeWithModel = async (
  capabilities: CapabilityMap,
  request: string,
  context: RunContext
): Promise<{ capability: Capability; reason: string } | null> => {
  const entries = Object.values(capabilities);
  if (entries.length === 0) return null;

  try {
    const { generateObject } = await loadAiModule();

    const { object } = await generateObject({
      model: context.model,
      schema: choiceSchema,
      system:
        'Choose the capability that best fits the request. Use only a name from the list.',
      prompt: `REQUEST:\n${request}\n\nCAPABILITIES:\n${entries
        .map((entry) => `- ${entry.name}: ${entry.describe}`)
        .join('\n')}`,
      maxOutputTokens: 300,
      abortSignal: context.signal
    });

    const chosen = capabilities[object.capability];
    if (!chosen) return null;

    return { capability: chosen as Capability, reason: object.reason };
  } catch (error) {
    console.warn('Model routing failed.', error);
    return null;
  }
};
