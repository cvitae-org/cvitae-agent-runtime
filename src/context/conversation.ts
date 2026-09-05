/**
 * What a conversation looks like on the way into a capability.
 *
 * Three capabilities take one now — `ask_profile` answers inside it, `edit_cv`
 * edits from it, and `summarize_conversation` folds the far end of it into a
 * note — and before this file they each declared the same two-field object and
 * the same two ceilings on their own. Three copies of a wire shape is three
 * chances for one of them to drift, and the caller sending to all three would
 * be the one to find out.
 *
 * So the shape lives here and the capabilities import it. What stays with each
 * capability is what is genuinely its own: how the conversation is *rendered*
 * into a prompt, which is not the same question and has a different answer in
 * each of them.
 *
 * The budgets are characters, and deliberately not tokens. `context/budget.ts`
 * has the reasoning: characters are approximate and free, while a token count
 * needs the provider's tokenizer, which means resolving a model before a prompt
 * can be assembled.
 */

import { z } from 'zod';

/**
 * How much of the conversation may ride along, in characters.
 *
 * The sibling of `CONTENT_BUDGET` in `cv/tools.ts`, and deliberately the same
 * kind of number: a conservative character ceiling declared by the one
 * contributor it bounds, not a share of a global token budget. There is no
 * tokenizer in this tree and adding one to divide a context window between
 * contributors would be a scheme, where this is an amount.
 *
 * Sized against what it competes with. A single `read_cv` result may be 5,200
 * characters and `maxSteps` defaults to six, so tool output alone can reach
 * ~31,000 characters in one run — history at this ceiling is roughly one extra
 * tool read, which is proportionate to the thing it makes possible and is not
 * what breaks a context window.
 *
 * Refused rather than trimmed. Trimming here would silently answer a different
 * question than the one the caller believes it asked, and the caller is the one
 * holding the transcript: it knows which turns are droppable and this does not.
 */
export const HISTORY_BUDGET = 6_000;

/**
 * How many turns may ride along, whatever their size.
 *
 * The character budget is the one that protects the context window; this one
 * protects against a caller that has confused "the conversation" with "every
 * conversation". Twelve is six exchanges, which is well past where a follow-up
 * still refers back.
 */
export const HISTORY_TURNS = 12;

/**
 * How long the note may be, in characters.
 *
 * Smaller than the window it stands in for by a factor of four, which is the
 * point — a note the size of the conversation would buy nothing over sending
 * the conversation.
 *
 * Enough for five headings with a line or two under each. A note that wants
 * more than this is a note that has started retelling the conversation instead
 * of carrying it.
 */
export const SUMMARY_BUDGET = 1_500;

/**
 * One settled turn.
 *
 * Two roles and no others, matching `ConversationTurn` in `contracts/effects.ts`
 * — which is the same shape one layer down, where it is what the AI gateway
 * turns into provider messages. This one is the wire schema a caller is
 * validated against; that one is the type an effect takes.
 */
export const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1)
});

export type Turn = z.infer<typeof turnSchema>;

/**
 * What was said before, oldest first, without the current instruction in it.
 *
 * Absent is a first turn, which is what every caller was until this existed.
 * The window is the caller's to compute — it is holding the transcript, and it
 * knows which of what it holds is a settled exchange rather than a notice, a
 * timeline card or an answer still being written. What is enforced here is only
 * the size of what arrives.
 */
export const historySchema = z
  .array(turnSchema)
  .max(HISTORY_TURNS, `At most ${HISTORY_TURNS} earlier turns may be sent.`)
  .refine(
    (turns) => turns.reduce((total, each) => total + each.text.length, 0) <= HISTORY_BUDGET,
    `Earlier turns must total at most ${HISTORY_BUDGET} characters.`
  )
  .default([]);

/**
 * What the turns before those came to, written by `summarize_conversation`.
 *
 * Separate from `history` and not the first entry in it, because it is not
 * something anybody said. Sent as a turn it would be a turn the model can
 * answer, contradict or apologise for; sent as standing context it is what it
 * is — the state the conversation has reached.
 */
export const summarySchema = z.string().max(SUMMARY_BUDGET).default('');

/**
 * Turns as a transcript, for a prompt that takes context rather than messages.
 *
 * `role: text`, blank line between, and nothing cleverer. The roles are spelled
 * out because a bare list of paragraphs loses who said which, and that is the
 * whole of what a follow-up like "no, the other one" depends on.
 */
export const renderTurns = (turns: readonly Turn[]): string =>
  turns.map((each) => `${each.role}: ${each.text}`).join('\n\n');
