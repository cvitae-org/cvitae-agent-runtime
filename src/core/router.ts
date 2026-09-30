/**
 * Picks the capability a request is asking for.
 *
 * Almost always by name, because almost always the caller knows: a research
 * screen wants `analyze_offer`, not "whatever the model thinks this is". A
 * router that consults a model when it does not have to is a round trip and a
 * failure mode bought for nothing.
 *
 * Only by name, in fact. A model path for free text typed by a person,
 * `routeWithModel`, sat beside this without a caller and was removed; its last
 * copy is `git show 308ba7b:src/core/router.ts`.
 */

import { RuntimeError } from '../contracts/index.js';
import type { Capability, CapabilityMap } from '../contracts/index.js';

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
