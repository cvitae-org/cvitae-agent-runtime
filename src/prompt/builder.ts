/**
 * Assembles system prompts.
 *
 * This module exists because of something cvitae's offer analysis recorded the
 * hard way: with a small local model, *the phrasing was the trigger*. An
 * earlier wording of a two-line instruction made gemma4:12b return an empty
 * completion every time, while the identical schema with a shorter instruction
 * succeeded. One agent there still carries a comment saying that appending the
 * shared extraction rules to it breaks it.
 *
 * Two consequences shape everything below. Composition has to be explicit
 * rather than automatic, so a block is never silently appended to a prompt that
 * cannot take it — which is why `sections` is a list the caller controls and
 * not a template with fixed slots. And the shared blocks are written as short
 * declarative sentences, because emphatic instructions measurably did worse.
 */

import type { SearchHit } from '../store/lance.js';
import type { ChunkRow } from '../store/store.js';

/**
 * The rule set for copying values out of a source document.
 *
 * Kept deliberately plain, and kept verbatim from cvitae: this exact wording is
 * known to work against gemma4:12b, and it is not worth improving the prose of
 * a string whose failure mode is an empty response.
 */
export const EXTRACTION_RULES = `Use only information present in the offer. Do not infer or invent.
When the offer does not mention a field, answer: Not stated`;

/**
 * Joins non-empty sections with blank lines.
 *
 * Blank lines rather than headers or delimiters, because a small model treats
 * "###" as content to imitate as often as structure to respect.
 */
export const compose = (...sections: (string | undefined | false)[]): string =>
  sections
    .filter((section): section is string => Boolean(section))
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n');

/**
 * Renders retrieved CV chunks as context.
 *
 * Numbered so a prompt can ask the model to cite which one it used, and capped
 * because a long context measurably degrades a small model's adherence to a
 * schema — the point of retrieving is to send less, not to send everything with
 * extra steps.
 */
export const renderProfileContext = (
  hits: SearchHit<ChunkRow>[],
  maxChars = 2_000
): string => {
  if (hits.length === 0) return '';

  const lines: string[] = [];
  let budget = maxChars;

  for (const [index, hit] of hits.entries()) {
    const line = `${index + 1}. ${hit.row.text}`;
    if (line.length > budget) break;
    lines.push(line);
    budget -= line.length;
  }

  if (lines.length === 0) return '';

  return `RELEVANT EXPERIENCE FROM THE CV:\n${lines.join('\n')}`;
};

/** The offer text, labelled the way the extraction agents expect. */
export const renderOffer = (text: string, maxChars = 12_000): string =>
  `JOB OFFER:\n${text.slice(0, maxChars)}`;

/**
 * The system prompt for a tool-driven step.
 *
 * Says what the tools are for and, more importantly, what the model must not
 * assume: that it can see the user's data directly. It cannot — every read goes
 * through a tool — and a model that believes otherwise fabricates CV details
 * instead of calling `search_profile` for them.
 */
export const toolSystemPrompt = (role: string): string =>
  compose(
    role,
    `You cannot see the user's CV or offer history directly. Use the tools to read them.
Base every statement on what a tool returned. If the tools return nothing, say so.`
  );
