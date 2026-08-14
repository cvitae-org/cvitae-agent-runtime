/**
 * Folds step outputs into one record.
 *
 * The merge itself is trivial. The canonicalisation around it is not, and is
 * ported wholesale from cvitae because it encodes a real and recurring
 * behaviour: models spell absence half a dozen ways — "not_stated", "N/A",
 * "none", "brak" — and any consumer that greys out a missing field by comparing
 * against one canonical string renders all the others as though the source
 * really said them.
 */

import type { StepOutcome } from './types.js';

/**
 * Keys whose values are enums rather than prose, and so must survive untouched.
 * `work_mode` legitimately carries the lowercase literal "unknown" and must not
 * be rewritten into the title-cased prose form, which is not a valid variant.
 */
const ENUM_KEYS = new Set(['work_mode']);

const ABSENT = /^(not[\s_-]?stated|n\/?a|none|brak|nie podano|unspecified)$/i;
const UNKNOWN = /^(unknown|nieznane|nieznany)$/i;

export const canonicalise = (
  record: Record<string, unknown>
): Record<string, unknown> => {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string' || ENUM_KEYS.has(key)) continue;

    const trimmed = value.trim();

    if (ABSENT.test(trimmed)) record[key] = 'Not stated';
    else if (UNKNOWN.test(trimmed)) record[key] = 'Unknown';
    else if (trimmed !== value) record[key] = trimmed;
  }

  return record;
};

/**
 * The default fold: a shallow merge in step order, then canonicalisation.
 *
 * Shallow is correct for an extraction pipeline, where each step owns a
 * disjoint set of keys and a collision means two steps were given overlapping
 * jobs — a plan bug worth seeing rather than smoothing over. A capability whose
 * steps genuinely produce nested or list-shaped output supplies its own
 * `aggregate` instead.
 */
export const mergeOutcomes = (
  outcomes: StepOutcome[]
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};

  for (const outcome of outcomes) {
    Object.assign(merged, outcome.value);
  }

  return canonicalise(merged);
};
