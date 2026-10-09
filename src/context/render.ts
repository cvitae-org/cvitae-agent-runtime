/**
 * Turning values into the text a model reads.
 *
 * Only the generic shapes live here. What belongs in a CV summary, which offer
 * fields matter, how a covering letter should be framed — that is domain
 * knowledge and it lives in `capabilities/`, one file per subject. This module
 * knows how to join blocks and how to number a list.
 *
 * The composition is explicit rather than templated, and that is worth stating
 * because the obvious design is a template with fixed slots. It was measured
 * not to work: with a small local model *the phrasing is the trigger*, and an
 * earlier wording of one two-line instruction made a 12B model return an empty
 * completion every time while the identical schema with a shorter instruction
 * succeeded. One agent in the previous runtime carried a comment saying that
 * appending the shared extraction rules to its prompt broke it. A template that
 * silently appends a block to every prompt would reintroduce exactly that, so
 * the caller passes the sections it wants and gets those.
 */

import { clip, fit } from './budget.js';
import type { Clipped } from './budget.js';

/**
 * Joins non-empty sections with blank lines.
 *
 * Blank lines rather than headers or delimiters, because a small model treats
 * `###` as content to imitate about as often as structure to respect.
 */
export const compose = (...sections: (string | undefined | false | null)[]): string =>
  sections
    .filter((section): section is string => typeof section === 'string')
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join('\n\n');

/**
 * What a labelled block carries of a body: trimmed, then clipped to the limit.
 *
 * Exposed because the block and a record of it have to agree on what was
 * received. Both ask here, so neither can end up with a different idea of what
 * the model was shown.
 */
export const excerpt = (body: string, limit: number): Clipped => clip(body.trim(), limit);

/** A labelled block: `LABEL:` on its own line, then the clipped body. */
export const labelled = (label: string, body: string, limit: number): string => {
  const shown = excerpt(body, limit);
  if (shown.text.length === 0) return '';
  return `${label}:\n${shown.text}`;
};

/**
 * A numbered list under a label, filled to a budget.
 *
 * Numbered so a prompt can ask which entry an answer came from — the cheapest
 * form of citation available without tool calling, and the only check on a
 * small model attributing a claim to a passage that never said it.
 */
export const numbered = (
  label: string,
  items: readonly string[],
  limits: { total: number; each: number }
): string => {
  const clipped = items
    .map((item) => clip(item.trim(), limits.each).text)
    .filter((item) => item.length > 0);

  const kept = fit(clipped, (item) => item.length + 4, limits.total);
  if (kept.length === 0) return '';

  return `${label}:\n${kept.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
};

/** `key: value` lines, skipping anything absent. For compact factual blocks. */
export const fields = (
  label: string,
  entries: readonly (readonly [string, unknown])[]
): string => {
  const lines = entries
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`);

  return lines.length === 0 ? '' : `${label}:\n${lines.join('\n')}`;
};
