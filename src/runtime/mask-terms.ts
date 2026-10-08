/**
 * The terms a person asked to have kept from a model, held for as long as the
 * runtime runs.
 *
 * Never on disk. Studio keeps the list and sends it when it connects and whenever
 * it changes, so a runtime that restarts has none until it is sent again, and a
 * list that is not written down is one that no copy of the database, no backup and
 * no log can hand to anyone. That covers the index too: what is embedded is masked
 * with the list, and the list is not stored with it.
 *
 * A runtime that has not been sent a list does not know what it would have to keep,
 * and says so (`declared`): a background call that would be masked waits for one.
 */

import { RuntimeError, maskTermLimits } from '../contracts/index.js';
import type { MaskSeed, MaskTerms } from '../contracts/index.js';
import { fold } from '../effects/mask.js';

export const createMaskTerms = (): MaskTerms => {
  let terms: readonly string[] = [];
  let declared = false;

  return {
    read: () => terms,
    set: (given) => {
      if (given.length > maskTermLimits.count) {
        throw new RuntimeError(`At most ${maskTermLimits.count} terms can be kept.`, 'invalid_input');
      }

      const seen = new Set<string>();
      const next: string[] = [];
      for (const [index, raw] of given.entries()) {
        const term = raw.trim();
        // The term itself is not in the message: it is what the person wants kept,
        // and a message is the kind of thing that ends up in a log.
        if (term.length < maskTermLimits.shortest || term.length > maskTermLimits.longest) {
          throw new RuntimeError(
            `Term ${index + 1} is not ${maskTermLimits.shortest} to ${maskTermLimits.longest} characters long.`,
            'invalid_input'
          );
        }
        const key = fold(term).split(/\s+/).join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(term);
      }

      terms = Object.freeze(next);
      declared = true;
      return terms;
    },
    declared: () => declared
  };
};

/** The terms as the engine is given them. */
export const termSeeds = (terms: readonly string[]): readonly MaskSeed[] =>
  terms.map((value) => ({ kind: 'term', value }));
