/**
 * The most that the material of one message may come to, and what a person may
 * change of it.
 *
 * Each part of a message has a ceiling of its own, declared by the one that is
 * bounded: the history (`conversation.ts`), the summary, the pieces chosen for the
 * message (`ground.ts`) and the posting a model is shown (`ground.ts`). Those are
 * the baseline, and nothing here raises one of them. What a person may set is a
 * ceiling over all of them together, for a model whose window is smaller than the
 * sum, in the same unit they are in: characters, since there is no tokenizer in
 * this tree (`budget.ts`).
 *
 * It can only lower. The ceiling below is the sum of the baselines, so a setting
 * at it binds nothing, and a setting under the floor would refuse a message that
 * carries nothing but its own summary. Outside the two the store refuses the
 * amount, and says so: a limit that is quietly clamped is a number somebody sees
 * and the runtime does not honour.
 *
 * It is a limit and not a trim. Over it the message is refused, before any model
 * is asked, and says which parts came to how much: cutting a part to fit would
 * send half of it under the name of the whole, and the record could not say so.
 */

import { HISTORY_BUDGET, HISTORY_TURNS, SUMMARY_BUDGET } from './conversation.js';
import { PICKS_BUDGET, POSTING_LIMIT } from './ground.js';

/** The smallest limit that may be set, in characters. Room for a summary, a question and a piece. */
export const CONTEXT_FLOOR = 2_000;

/** The largest, which is everything the baselines allow at once, so a limit at it binds nothing. */
export const CONTEXT_CEILING = 60_000;

/** What each part of a message is held to before a person sets anything. */
export const BASELINE = {
  history: HISTORY_BUDGET,
  historyTurns: HISTORY_TURNS,
  summary: SUMMARY_BUDGET,
  picks: PICKS_BUDGET,
  posting: POSTING_LIMIT
} as const;

/** Whether an amount may be set as a limit. */
export const isLimit = (amount: unknown): amount is number =>
  typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= CONTEXT_FLOOR && amount <= CONTEXT_CEILING;

/** What goes along with a question, each part in characters as the model is given it. */
export type Material = {
  readonly history: number;
  readonly summary: number;
  /** The pieces chosen for the message, separators counted. */
  readonly picks: number;
  /** The posting, as far as the model is shown it. */
  readonly posting: number;
};

export const totalOf = (material: Material): number =>
  material.history + material.summary + material.picks + material.posting;

const number = (value: number): string => value.toLocaleString('en-US');

/**
 * Why a message is over its limit, in plain words, or nothing when it is not.
 * The parts that are empty are left out of the sum it names.
 */
export const overLimit = (material: Material, limit: number | undefined): string | undefined => {
  if (limit === undefined) return undefined;
  const total = totalOf(material);
  if (total <= limit) return undefined;

  const parts = ([
    ['history', material.history],
    ['summary', material.summary],
    ['pieces', material.picks],
    ['posting', material.posting]
  ] as const)
    .filter(([, size]) => size > 0)
    .map(([name, size]) => `${name} ${number(size)}`)
    .join(', ');

  return (
    `The material for this message comes to ${number(total)} characters (${parts}), `
    + `and this conversation is limited to ${number(limit)}. `
    + 'Unpin or detach something, or raise the limit.'
  );
};

/**
 * What is left for the pieces the runtime adds by itself, once the other parts
 * and the limit are known. Never more than the pieces' own budget.
 */
export const roomForPicks = (material: Omit<Material, 'picks'>, limit: number | undefined): number => {
  if (limit === undefined) return PICKS_BUDGET;
  return Math.max(0, Math.min(PICKS_BUDGET, limit - material.history - material.summary - material.posting));
};
