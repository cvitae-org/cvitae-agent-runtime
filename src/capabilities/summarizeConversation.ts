/**
 * What a conversation carries forward once it stops fitting.
 *
 * The client sends the last few turns with each question, and that is what
 * makes a follow-up a follow-up — "the second one" resolves against the turn
 * before it. What a window cannot do is hold everything: past six or so
 * exchanges the oldest turns stop being sent, and the model is back to
 * answering as though the conversation had just started, only later and less
 * obviously than before there was a window at all.
 *
 * So the turns that fall out are folded into a note, and the note rides in
 * front of the ones that remain.
 *
 * **The headings are the whole design.** A model asked to "summarise this
 * conversation" writes an account of it — *the user asked about their
 * experience, and the assistant listed several roles* — which is a description
 * of a conversation happening and carries none of what a follow-up depends on.
 * What the next turn needs is state: what the person is trying to do, what they
 * chose, what they turned down, what was established that is not on the CV, and
 * what is still open. Naming those as headings is the difference, and REJECTED
 * is the one that earns its place twice over — it is both the most useful
 * thing to carry and the first thing a general summary throws away, because
 * nothing that was rejected is part of the story of what happened.
 *
 * One `generate` step and no tools, which is deliberate on both counts. The
 * material is entirely in the input, so there is nothing to look up; and the
 * output is prose, which is what `generate` is for — a schema wrapped around
 * one string is the thing measured to break these steps on a small model.
 *
 * It is not on the path of any answer. The client runs it after a question has
 * been answered and the reply is on screen, so the cost is a model call
 * somebody is not waiting for, and a run that fails costs a note rather than an
 * answer.
 */

import { z } from 'zod';
import { compose, labelled } from '../context/render.js';
import type { Capability, Plan } from '../contracts/index.js';

/**
 * How long the note may be, in characters.
 *
 * The sibling of `HISTORY_BUDGET` in `askProfile.ts` and of the `CONTENT_BUDGET`
 * that one is modelled on: a conservative character ceiling declared by the
 * contributor it bounds. Smaller than the window it stands in for by a factor
 * of four, which is the point — a note the size of the conversation would buy
 * nothing over sending the conversation.
 *
 * Enough for five headings with a line or two under each. A note that wants
 * more than this is a note that has started retelling the conversation instead
 * of carrying it.
 */
export const SUMMARY_BUDGET = 1_500;

/**
 * How much conversation may be folded in at once.
 *
 * The client batches: turns fall out of the window two at a time and this runs
 * once every few of them, so the ordinary call carries four to eight. The
 * ceiling is for the conversation that ran while summarising was failing — the
 * marker does not move on a failed run, so the backlog grows until one
 * succeeds, and this is what stops that one call being unbounded.
 */
const MAX_TURNS = 40;

const CHARS_PER_TOKEN = 3;

/**
 * Room for a model that reasons before it answers.
 *
 * Not a budget — a ceiling, and the asymmetry is the reason it is generous: a
 * call that needs less spends less, while a ceiling set near the mean truncates
 * a run that would have succeeded. `cv/evidence.ts` carries the measurements
 * behind that shape, and they are worth reading before anyone tunes this: on a
 * local model the invisible reasoning was several times the visible answer and
 * varied enough between identical calls to straddle any ceiling set near its
 * average.
 *
 * Smaller than the one there because the task is smaller — rewriting five short
 * headings, not composing an argument from a catalogue of a hundred facts.
 */
const THINKING_ALLOWANCE = 6_000;

const turn = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1)
});

export const inputSchema = z.object({
  /**
   * The note as it stands, or empty the first time.
   *
   * Passed in rather than read from the store, so this capability has no
   * opinion about where a conversation lives. What it does is fold turns into
   * a note; whose note, and where it is kept afterwards, belongs to the caller.
   */
  summary: z.string().max(SUMMARY_BUDGET * 2).default(''),
  /** The turns that have fallen out of the window, oldest first. */
  turns: z
    .array(turn)
    .min(1, 'There is nothing to fold in.')
    .max(MAX_TURNS, `At most ${MAX_TURNS} turns may be folded in at once.`)
});

export type SummarizeConversationInput = z.infer<typeof inputSchema>;

/**
 * What the note is for, and what it must not become.
 *
 * The last two lines are the ones that matter. A model rewriting a note will
 * tidy it — smoothing "no, not the Web3 angle" into "prefers a broader
 * framing", which is a paraphrase that has quietly dropped the refusal — and it
 * will fill an empty heading rather than leave it out, which turns five honest
 * headings into five sentences of invention that the next turn then treats as
 * things the person said.
 */
const SYSTEM = [
  'You keep a running note about a conversation so that it can be continued later.',
  'Rewrite the note below to take in the new turns. Keep what is still true and add what the turns establish.',
  '',
  'Use these headings, and leave out any heading with nothing under it:',
  'GOAL: what the person is trying to achieve.',
  'DECIDED: what they have chosen, and what they said they prefer.',
  'REJECTED: what they turned down, and why.',
  'FACTS: what the conversation established that is not on their CV.',
  'OPEN: what was asked or offered and has not been settled.',
  '',
  'Write in the language the turns are written in.',
  'Keep their own words for anything they decided or turned down.',
  'Write nothing that is not in the note or the turns.',
  `Write at most ${SUMMARY_BUDGET} characters, and nothing but the note.`
].join('\n');

const render = (turns: SummarizeConversationInput['turns']): string =>
  turns.map((each) => `${each.role}: ${each.text}`).join('\n\n');

/**
 * Cuts a note back to the ceiling at a line boundary.
 *
 * Truncation is acceptable here and is not acceptable for a turn, and the
 * difference is worth stating because the two are one line apart in this tree.
 * A turn cut short is a different thing said — half a question reads as a
 * question that was asked, and a model answers the half it was given. A note is
 * a list of headings, and a list cut at a line boundary is a shorter list: what
 * survives is still true, and what went is missing rather than wrong.
 *
 * Which is also why it cuts at a newline and not at a word. Half a heading
 * would be the turn case again, in miniature.
 */
export const trimNote = (note: string, limit = SUMMARY_BUDGET): string => {
  const text = note.trim();
  if (text.length <= limit) return text;

  const hard = text.slice(0, limit);
  const line = hard.lastIndexOf('\n');
  return (line > 0 ? hard.slice(0, line) : hard).trimEnd();
};

export const summarizeConversation: Capability<SummarizeConversationInput> = {
  name: 'summarize_conversation',
  describe:
    'Folds the turns that no longer fit in a conversation into a short note that carries them forward.',
  input: inputSchema,

  plan: (input): Plan => ({
    capability: 'summarize_conversation',
    source: 'declared',
    stages: [
      {
        name: 'fold',
        concurrency: 1,
        steps: [
          {
            kind: 'generate',
            name: 'note',
            key: 'note',
            // Critical, and the run is the thing that fails rather than the
            // note being half-written. The caller does not move its marker on a
            // failed run, so the turns stay pending and the next settled
            // question tries again with a slightly larger batch. A fallback
            // here would be an empty note written over a good one.
            critical: true,
            system: SYSTEM,
            prompt: compose(
              labelled('NOTE', input.summary, SUMMARY_BUDGET * 2),
              labelled('NEW TURNS', render(input.turns), SUMMARY_BUDGET * 6)
            ),
            maxOutputTokens:
              Math.ceil(SUMMARY_BUDGET / CHARS_PER_TOKEN) + THINKING_ALLOWANCE
          }
        ]
      }
    ]
  }),

  /**
   * The note, cut to the ceiling it was asked to respect.
   *
   * Asked and then enforced, because a model told to write at most 1,500
   * characters writes 1,700 often enough to matter, and the caller stores this
   * and sends it in front of every later question — an overrun that is only
   * asked for is an overrun that compounds.
   */
  aggregate: (outcomes) => {
    const folded = trimNote(String(outcomes.find((o) => o.step === 'note')?.value.note ?? ''));

    return { summary: folded, chars: folded.length };
  }
};
