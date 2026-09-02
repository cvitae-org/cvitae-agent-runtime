/**
 * How much of anything a step is allowed to see.
 *
 * Ceilings are in characters, not tokens, and that is a deliberate trade. A
 * token count needs the provider's tokenizer, which means resolving a model
 * before a prompt can be assembled — and prompt assembly happens for transform
 * steps that never reach a model at all. Characters are approximate and free;
 * the ratio is stable enough per language that a limit set by measuring output
 * quality holds, and the ceilings below were set that way rather than by
 * dividing a context window.
 *
 * The reason to have them at all is not cost. A long context measurably
 * degrades a small model's adherence to a schema: the point of retrieving is to
 * send *less*, not to send everything with extra steps. A step that quietly
 * receives twice its usual context starts returning `{}` and nothing in the
 * logs says why, so the truncation is explicit and reported.
 */

export type Budget = {
  /** A whole source document — an offer posting, a pasted description. */
  readonly source: number;
  /** Retrieved passages, in total across all of them. */
  readonly retrieved: number;
  /** A single retrieved passage, so one long chunk cannot fill the section. */
  readonly passage: number;
  /** A summary of what earlier steps produced. */
  readonly completed: number;
};

export const DEFAULT_BUDGET: Budget = {
  source: 12_000,
  retrieved: 2_000,
  passage: 600,
  completed: 1_500
};

export type Clipped = {
  readonly text: string;
  readonly clipped: boolean;
  /** Characters dropped. Zero when nothing was. */
  readonly dropped: number;
};

/**
 * Cuts at a word boundary when there is one nearby, so the last thing the model
 * reads is not half a word — small models will happily complete it.
 */
export const clip = (text: string, limit: number): Clipped => {
  if (text.length <= limit) return { text, clipped: false, dropped: 0 };

  const hard = text.slice(0, limit);
  const space = hard.lastIndexOf(' ');
  const cut = space > limit * 0.8 ? hard.slice(0, space) : hard;

  return { text: `${cut}…`, clipped: true, dropped: text.length - cut.length };
};

/**
 * Fills a list up to a total budget, whole items only.
 *
 * Whole items because a truncated passage is worse than a missing one: the
 * model cannot tell that the sentence it is reasoning from stops mid-clause,
 * and a half-read requirement reads as a complete one.
 */
export const fit = <T>(items: readonly T[], size: (item: T) => number, total: number): T[] => {
  const kept: T[] = [];
  let budget = total;

  for (const item of items) {
    const cost = size(item);
    if (cost > budget) break;
    kept.push(item);
    budget -= cost;
  }

  return kept;
};
