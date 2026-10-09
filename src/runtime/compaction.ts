/**
 * What a `/compact` would fold, decided where the exclusions are known.
 *
 * A conversation carries its past forward as a note (`summarize_conversation`),
 * written by a model from the turns that have fallen out of the window. Which
 * turns is a host's to say, and a host does not know what the runtime does: that
 * an answer was built from a piece the person has since excluded, and that a note
 * made from it carries it. This answers for the runtime. It reads the
 * conversation it stores and says which turns may go to the model that writes the
 * note, how far the note will then reach, and what stays as it is. It writes
 * nothing and asks no model: the fold is the host's to run, with these turns, and
 * to record with `conversations.summarise`.
 *
 *   what stays     the newest exchanges, so the person goes on from where they
 *                  were. A question that has no answer yet is not folded either
 *   what is folded the turns older than those, oldest first, up to what the
 *                  note's model reads (`TURNS_BUDGET`) and no further, so that no
 *                  turn is clipped at the end of a transcript unseen. A turn that
 *                  alone is too long is cut, and says so in the turn
 *   how far        a fold ends between exchanges, never inside one, since the
 *                  window sends exchanges and one half of a pair is not sent
 *
 * What it will not fold:
 *
 *   an answer withheld by the walls   one built from something excluded now, or on
 *                                     such an answer. The fold stops before it, so
 *                                     the model that writes the note is never given
 *                                     what the model that answers is not
 *   anything, when the note is        the note was made from such an answer, and
 *     withheld                        writing a new one over it would lose what it
 *                                     held for good. It comes back when the piece is
 *                                     let back in, or it is replaced when there is
 *                                     nothing left to withhold
 *
 * The turns come as they would be read, and where one is cut it says how much was
 * left out, so a person shown what is about to be folded sees what the model will.
 */

import { MAX_TURNS, TURNS_BUDGET } from '../capabilities/summarizeConversation.js';
import { renderTurns } from '../context/conversation.js';
import type { ConversationStore, Message } from '../contracts/index.js';
import { settled, traceAnswers } from './history.js';
import type { HistoryDeps } from './history.js';

/** How many of the newest exchanges stay as they are unless a host says otherwise. */
export const KEEP_EXCHANGES = 2;

/** The most a host may ask to keep. More is a window and not a fold. */
export const MAX_KEEP = 10;

/** The most of one turn the model that writes the note is shown, in characters. */
export const TURN_LIMIT = 1_500;

/** Why there is nothing to fold, when there is nothing. */
export const NOTHING = ['nothing', 'withheld', 'summary_withheld'] as const;
export type Nothing = (typeof NOTHING)[number];

/** One turn as the model that writes the note would read it. */
export type FoldedTurn = {
  readonly seq: number;
  readonly role: 'user' | 'assistant';
  /** The text, or the first part of it when it was too long, with the number left out said at its end. */
  readonly text: string;
  /** How many characters of the turn are left out. Zero when all of it is here. */
  readonly omitted: number;
};

export type FoldPlan = {
  readonly conversationId: string;
  /** The `seq` of the last message the note was made from. */
  readonly summarisedThrough: number;
  /** The note as it stands, to give the model that folds: empty when there is none, or when it is withheld. */
  readonly summary: string;
  /** Why nothing is to be folded; absent when something is. */
  readonly reason?: Nothing;
  /** The turns to fold in, oldest first. Empty when nothing is to be folded. */
  readonly turns: readonly FoldedTurn[];
  /** What to record the new note as made through: the last turn here, or where the note stands when there are none. */
  readonly through: number;
  /** Whether more can be folded after these, as it stands: older than the newest exchanges and not withheld. */
  readonly more: boolean;
  /** How many of the newest exchanges stay. At most what was asked: a conversation may have fewer. */
  readonly kept: number;
  /** The `seq` of each answer older than the newest that the walls withhold. */
  readonly withheld: readonly number[];
};

/** What is said at the end of a turn that was cut, and how much was left out. */
const cutNote = (omitted: number): string => ` [shortened: ${omitted.toLocaleString('en-US')} more characters not shown]`;

/**
 * A turn as it is folded: whole, or its first part with a word at its end saying
 * how much of it is not here. A pure function of the message and the limit.
 */
export const foldedTurn = (message: Pick<Message, 'seq' | 'role' | 'text'>, limit = TURN_LIMIT): FoldedTurn => {
  const text = message.text.trim();
  if (text.length <= limit) return { seq: message.seq, role: message.role, text, omitted: 0 };

  // At the end of a word, and not through one: when the limit falls inside a word
  // the word is left out, and when it falls on a space the word before it is whole.
  const cut = text.slice(0, limit);
  const word = /\s/.test(text.charAt(limit)) ? -1 : cut.search(/\s\S*$/);
  const head = (word > 0 ? cut.slice(0, word) : cut).trimEnd();
  const omitted = text.length - head.length;

  return { seq: message.seq, role: message.role, text: `${head}${cutNote(omitted)}`, omitted };
};

export type Compaction = {
  /** `undefined` when there is no such conversation. */
  plan(conversationId: string, keep?: number): FoldPlan | undefined;
};

export type CompactionDeps = HistoryDeps & {
  readonly conversations: Pick<ConversationStore, 'read'>;
};

export const createCompaction = (deps: CompactionDeps): Compaction => ({
  plan: (conversationId, keep = KEEP_EXCHANGES) => {
    const found = deps.conversations.read(conversationId);
    if (found === undefined) return undefined;

    const through = found.conversation.summarisedThrough;
    const { answers, withheld } = traceAnswers(deps, conversationId, found);

    const note = found.conversation.summary ?? '';
    const noteHeld = settled(note) && answers.some((each) => each.seq <= through && withheld(each.key));
    const summary = settled(note) && !noteHeld ? note : '';

    // Settled exchanges that are not yet in the note, oldest first. The newest of
    // them stay, and nothing after the last of them is folded.
    const exchanges = answers.filter(
      (each): each is (typeof answers)[number] & { user: Message } =>
        each.user !== undefined && each.user.seq > through && settled(each.user.text) && settled(each.assistant.text)
    );
    // The oldest exchange that stays. A conversation with no more than are to stay
    // keeps them all, and keeping none is folding up to the last one.
    const stays = keep === 0 ? undefined : exchanges[Math.max(0, exchanges.length - keep)];
    const last = exchanges.at(-1)?.assistant.seq;
    const cut = stays === undefined ? (last ?? 0) + 1 : stays.user.seq;

    const nothing = (reason: Nothing, blocked: readonly number[] = []): FoldPlan => ({
      conversationId,
      summarisedThrough: through,
      summary,
      reason,
      turns: [],
      through,
      more: false,
      kept: Math.min(keep, exchanges.length),
      withheld: blocked
    });

    const older = found.messages.filter((each) => each.seq > through && each.seq < cut);
    // An answer that is withheld is reported wherever it is among them, and the
    // fold ends before the first of them.
    const blockedAnswers = answers.filter((each) => each.seq > through && each.seq < cut && withheld(each.key));
    const blocked = blockedAnswers.map((each) => each.seq);

    // Nothing older, and so nothing withheld among it either; and no answer at all
    // is nothing older, since the cut is then before the first message.
    if (older.length === 0) return nothing('nothing');
    if (noteHeld) return nothing('summary_withheld', blocked);

    const stop = Math.min(...blockedAnswers.map((each) => each.user?.seq ?? each.seq), Number.POSITIVE_INFINITY);
    const range = older.filter((each) => each.seq < stop);
    if (range.length === 0) return nothing('withheld', blocked);

    // Taken in units that are never split: a question and its answer, or a
    // message that stands alone.
    const paired = new Map(answers.flatMap((each) => (each.user === undefined ? [] : [[each.user.seq, each.assistant.seq] as const])));
    const units: Message[][] = [];
    for (let at = 0; at < range.length; at += 1) {
      const message = range[at] as Message;
      const answer = message.role === 'user' ? paired.get(message.seq) : undefined;
      if (answer !== undefined && range[at + 1]?.seq === answer) {
        units.push([message, range[at + 1] as Message]);
        at += 1;
      } else {
        units.push([message]);
      }
    }

    // As many whole units as the summariser reads: its transcript is clipped at
    // the end, which is the newest turns, so a unit that would be clipped is left
    // for the next fold and not sent half-read.
    const turns: FoldedTurn[] = [];
    let taken = 0;
    for (const unit of units) {
      const these = unit.filter((each) => settled(each.text)).map((each) => foldedTurn(each));
      const all = [...turns, ...these];
      if (all.length > MAX_TURNS || renderTurns(all).length > TURNS_BUDGET) break;

      turns.push(...these);
      taken += 1;
    }

    // A unit of turns that say nothing is folded without a turn, and a fold that
    // has no turn at all has nothing to write a note from.
    if (turns.length === 0) return nothing('nothing', blocked);

    const reached = units.slice(0, taken).flat().at(-1)?.seq ?? through;
    return {
      conversationId,
      summarisedThrough: through,
      summary,
      turns,
      through: reached,
      more: taken < units.length,
      kept: Math.min(keep, exchanges.length),
      withheld: blocked
    };
  }
});
