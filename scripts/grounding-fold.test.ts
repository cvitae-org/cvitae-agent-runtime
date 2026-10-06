/**
 * What a `/compact` may fold into a conversation's summary, and how far it reaches.
 *
 * The runtime does not write the summary: a host does, with a model, from turns it
 * is given. What the runtime answers for is which turns those are, because it is
 * the one that knows what the walls withhold. The questions, in order:
 *
 *   what stays    the newest exchanges stay as they are, and a question with no
 *                 answer is not folded
 *   what is       the older ones, oldest first, as many whole exchanges as the
 *   folded        model that writes the note reads, and a turn too long for it is
 *                 cut and says so
 *   the walls     an answer built from something excluded now is not folded, and
 *                 neither is anything after it; a note made from one is not written
 *                 over
 *   afterwards    the newest turns are what is sent, the note names what it was made
 *                 from, and a note made from what is excluded now is withheld
 *   the wire      the channel, its payload, and the flag that announces it
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 95 were applied.
 *
 * what stays, what is folded:
 *   the newest exchange only stays                             15
 *   the newest three exchanges stay                            16
 *   a host may keep eleven                                     1
 *   a host may keep nine at most                               1
 *   a host may keep minus one                                  1
 *   a host may keep one at least                               1
 *   a host may keep a fraction                                 1
 *   the channel takes a key it does not know                   1
 *   keeping none keeps one                                     3
 *   keeping more than there are folds all of them              4
 *   what stays is counted from the oldest                      19
 *   the fold ends with the last answer when none stays, leaving it 3
 *   the fold ends where what stays begins, taking its question 18
 *   the fold begins at the last turn of the note               6
 *   an exchange that is after the note is not looked for       1
 *   an exchange whose question is empty is an exchange         1
 *   an exchange whose answer is empty is an exchange           1
 *   a conversation with nothing to fold is not told so         6
 *   a conversation with no answer folds its questions          1
 *   kept counts what was asked and not what there is           2
 *   kept counts what there is, in a plan that folds            1
 *
 * units, the budget and where it reaches:
 *   the plan takes forty-one turns                             2
 *   the plan takes thirty-nine turns                           2
 *   the plan takes a transcript of 9,001 characters            1
 *   the plan takes a transcript of 8,999 characters            1
 *   the plan does not count turns                              1
 *   the plan does not count characters                         3
 *   the plan takes forty turns only to stop at forty           1
 *   the plan takes turns up to the budget only                 1
 *   the plan counts the transcript without its separators      3
 *   a unit that does not fit ends the plan with the rest of it 2
 *   a unit is a single message                                 3
 *   a unit is a question and the next message whoever wrote it 0 (equivalent: the message after a question that has an answer is that answer)
 *   a question is paired with the answer of any question       1
 *   the plan reaches the last message it was given             4
 *   the plan reaches the last turn that was kept               1
 *   the plan reaches nowhere                                   17
 *   more is always said                                        4
 *   more is never said                                         4
 *   more is said when the budget alone ended it                0 (equivalent: the extra conditions hold whenever units are left over)
 *   more is said of what is withheld                           1
 *   a turn that says nothing is folded                         2
 *   a plan of turns that say nothing has a fold                1
 *   the turns come newest first                                18
 *
 * one turn:
 *   a turn is cut at 1,501 characters                          1
 *   a turn is cut at 1,499 characters                          4
 *   a turn of the limit is cut                                 4
 *   a turn is not trimmed                                      1
 *   a turn that is cut says nothing of it                      2
 *   a turn that is cut says how much is left in other words    2
 *   a turn that is cut counts what is shown                    1
 *   a turn is cut through a word                               1
 *   a turn that is cut on a space loses a word                 1
 *   a turn is not cut when it says it was                      2
 *   a turn has the role of the other side                      3
 *
 * withheld:
 *   an answer that is withheld is folded                       6
 *   the fold stops after the withheld answer's question only   6
 *   the fold stops at the last withheld answer                 3
 *   a plan that is stopped at its first exchange is a fold     3
 *   a plan that is stopped at its first exchange says nothing was to fold 3
 *   withheld answers are those of the whole conversation       5
 *   withheld answers are those that stay                       4
 *   withheld answers already in the note are named             1
 *   the plan does not name what is withheld                    6
 *   the plan names the question of what is withheld            6
 *
 * the note:
 *   a note made from a withheld answer is written over         1
 *   a note made from a withheld answer is said to be so, when nothing is 6
 *   a note is held when any answer is withheld                 1
 *   a note is held by answers it was not made from             1
 *   a note is held only by the answers of the last message     1
 *   a note that is held is given to the model                  1
 *   a note that is blank is given                              0 (equivalent: the store keeps a blank note as none, so a note is never blank here)
 *   the plan is of the summary the conversation does not have  5
 *   the plan does not say where the note reaches               1
 *   the plan of nothing says the note reaches nowhere          5
 *   the plan of nothing says the note ends elsewhere           3
 *   the plan of nothing says it was for another conversation   1
 *   the plan of a conversation that is not there is a plan     1
 *
 * tracing answers is the one history uses:
 *   answers are traced without the walls                       8
 *   an answer of an unclosed record is known                   1 (in grounding-history.test.ts, not here)
 *   an answer of a capability that records nothing is known    1 (in grounding-history.test.ts, not here)
 *   a summary carries every answer                             2 (in grounding-history.test.ts, not here)
 *   a summary carries the answers up to the one before its version 1 (in grounding-history.test.ts, not here)
 *   a summary that names no version carries no answer          1 (in grounding-history.test.ts, not here)
 *   a conversation sends the history without the answers it traced 1
 *
 * the channel and the flag:
 *   the channel answers a conversation that is not there with a plan 1
 *   the channel asks for the conversation it was not asked for 1
 *   the channel does not pass keep                             1
 *   the channel answers not found in other words               1
 *   compaction is not announced                                1
 *   compaction is announced twice                              1
 *   compaction is announced with another name                  1
 *   the runtime plans with no walls                            1
 *   the runtime plans with no records                          1
 *   the runtime plans for capabilities that record nothing     1
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { capabilities } from '../src/capabilities/index.js';
import { MAX_TURNS, TURNS_BUDGET } from '../src/capabilities/summarizeConversation.js';
import { SUMMARY_BUDGET, historySchema, renderTurns, summarySchema } from '../src/context/conversation.js';
import type { CapabilityMap } from '../src/contracts/index.js';
import { digest } from '../src/grounding/digest.js';
import { KEEP_EXCHANGES, MAX_KEEP, NOTHING, TURN_LIMIT, createCompaction, foldedTurn } from '../src/runtime/compaction.js';
import type { Compaction, FoldPlan } from '../src/runtime/compaction.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { scratch } from './support/db.js';
import { noop, stage, transform } from './support/spine.js';
import { ACME, CHAT, chat, settle } from './support/chat.js';
import type { Chat } from './support/chat.js';

const folding = (c: Chat): Compaction =>
  createCompaction({
    conversations: c.conversations,
    records: c.records,
    walls: (id) => c.selections.walls(id),
    capabilities
  });

const say = (c: Chat, role: 'user' | 'assistant', text: string) => c.conversations.append(CHAT, { role, text });

/** This many exchanges, each as short as can be: seq 1 is the first question, 2 its answer, and so on. */
const talk = (c: Chat, exchanges: number): void => {
  for (let at = 1; at <= exchanges; at += 1) {
    say(c, 'user', `Question ${at}`);
    say(c, 'assistant', `Answer ${at}`);
  }
};

const plan = (c: Chat, keep?: number): FoldPlan => {
  const made = folding(c).plan(CHAT, keep);
  assert.ok(made, 'the conversation is there');
  return made;
};

const seqs = (made: FoldPlan): number[] => made.turns.map((each) => each.seq);

/* ---------------------------------------------------------------- what stays */

test('the newest two exchanges stay, and every turn before them is folded, oldest first, with where the note then reaches', () => {
  const c = chat();
  try {
    assert.equal(KEEP_EXCHANGES, 2);
    talk(c, 5);

    const made = plan(c);
    assert.deepEqual(seqs(made), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(
      made.turns.map((each) => [each.role, each.text, each.omitted]),
      [['user', 'Question 1', 0], ['assistant', 'Answer 1', 0], ['user', 'Question 2', 0], ['assistant', 'Answer 2', 0], ['user', 'Question 3', 0], ['assistant', 'Answer 3', 0]]
    );
    assert.equal(made.through, 6, 'through the last turn folded');
    assert.equal(made.summarisedThrough, 0);
    assert.equal(made.summary, '');
    assert.equal(made.kept, 2);
    assert.equal(made.more, false);
    assert.equal(made.reason, undefined);
    assert.deepEqual(made.withheld, []);
    assert.equal(made.conversationId, CHAT);
  } finally {
    c.dispose();
  }
});

test('how many stay is the caller\'s to say, from none to ten, and a conversation with no more than that has nothing to fold', () => {
  const c = chat();
  try {
    talk(c, 5);

    assert.equal(MAX_KEEP, 10);
    assert.equal(seqs(plan(c, 0)).length, 10, 'none: all of it');
    assert.equal(plan(c, 0).through, 10);
    assert.equal(plan(c, 0).kept, 0);
    assert.deepEqual(seqs(plan(c, 1)), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(seqs(plan(c, 4)), [1, 2]);
    assert.equal(plan(c, 4).kept, 4);

    for (const keep of [5, 6, 10]) {
      const made = plan(c, keep);
      assert.equal(made.reason, 'nothing', `${keep} stay`);
      assert.deepEqual(made.turns, []);
      assert.equal(made.through, 0, 'the note reaches where it did');
      assert.equal(made.kept, 5, 'and what stays is what there is');
    }
  } finally {
    c.dispose();
  }
});

test('a question that has no answer yet is not folded and is not an exchange that stays', () => {
  const c = chat();
  try {
    talk(c, 3);
    say(c, 'user', 'And one more?');

    const made = plan(c);
    assert.deepEqual(seqs(made), [1, 2], 'two exchanges stay, and the question is not one: the one before them is folded');
    assert.equal(made.through, 2);

    const alone = chat();
    try {
      talk(alone, 1);
      say(alone, 'user', 'Waiting.');
      assert.equal(plan(alone).reason, 'nothing');
      assert.equal(plan(alone, 0).through, 2, 'with none to keep, what is answered is folded and what is not stays');
      assert.deepEqual(seqs(plan(alone, 0)), [1, 2]);
    } finally {
      alone.dispose();
    }

    // Nothing has been answered at all: there is no exchange to fold up to, and
    // so no question is folded, whatever is kept.
    const unanswered = chat();
    try {
      say(unanswered, 'user', 'Anyone there?');
      say(unanswered, 'user', 'Hello?');
      for (const keep of [undefined, 0, 1]) {
        const none = plan(unanswered, keep);
        assert.equal(none.reason, 'nothing', `keep ${keep}`);
        assert.deepEqual(none.turns, [], `keep ${keep}`);
        assert.equal(none.through, 0, `keep ${keep}`);
        assert.equal(none.more, false, `keep ${keep}`);
      }
    } finally {
      unanswered.dispose();
    }
  } finally {
    c.dispose();
  }
});

test('a conversation that has been summarised is folded from where the note ends, with the note as it stands', () => {
  const c = chat();
  try {
    talk(c, 6);
    c.conversations.summarise(CHAT, 'We spoke of billing.', 4);

    const made = plan(c);
    assert.deepEqual(seqs(made), [5, 6, 7, 8], 'from the first turn the note was not made from');
    assert.equal(made.summary, 'We spoke of billing.');
    assert.equal(made.summarisedThrough, 4);
    assert.equal(made.through, 8);

    c.conversations.summarise(CHAT, 'We spoke of billing and hiring.', made.through);
    const next = plan(c);
    assert.equal(next.reason, 'nothing', 'what was folded is not folded again');
    assert.equal(next.summary, 'We spoke of billing and hiring.');
    assert.equal(next.summarisedThrough, 8);
    assert.equal(next.through, 8, 'and the note reaches where it did');
  } finally {
    c.dispose();
  }
});

test('turns that say nothing are not folded, and a fold of nothing else has nothing to write a note from', () => {
  const c = chat();
  try {
    say(c, 'user', '   ');
    say(c, 'assistant', '');
    talk(c, 2);
    const made = plan(c, 2);
    assert.equal(made.reason, 'nothing', 'two exchanges stay and the blanks before them say nothing');
    assert.deepEqual(made.turns, []);

    say(c, 'user', 'A question');
    say(c, 'assistant', 'An answer');
    const more = plan(c, 2);
    assert.deepEqual(seqs(more), [3, 4], 'the blanks are left out and what is said is not');
    assert.equal(more.through, 4);
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------- what is folded */

test('a turn is whole up to its limit, and past it is cut at a word with how much is left out said in it and counted', () => {
  assert.equal(TURN_LIMIT, 1_500);
  const at = (text: string, limit?: number) => foldedTurn({ seq: 7, role: 'assistant', text }, limit);

  assert.deepEqual(at('Short.'), { seq: 7, role: 'assistant', text: 'Short.', omitted: 0 });
  assert.deepEqual(at('  padded  '), { seq: 7, role: 'assistant', text: 'padded', omitted: 0 }, 'trimmed, as a turn is read');
  assert.equal(at('a'.repeat(1_500)).omitted, 0, 'at the limit');
  assert.equal(at('a'.repeat(1_500)).text.length, 1_500);

  // The limit falls inside the 300th word, which is left out, and the space before it with it.
  const long = `${'word '.repeat(400)}end`;
  assert.deepEqual(at(long), { seq: 7, role: 'assistant', text: `${'word '.repeat(299)}word [shortened: 504 more characters not shown]`, omitted: 504 });
  // The limit falls on the space after a word, which is whole.
  assert.equal(at('one two three', 7).text, 'one two [shortened: 6 more characters not shown]');
  assert.equal(at('one twoXX three', 7).text, 'one [shortened: 12 more characters not shown]', 'and inside it, it is not');

  const none = at('x'.repeat(2_000));
  assert.equal(none.omitted, 500, 'with no space to cut at, at the limit');
  assert.equal(none.text, `${'x'.repeat(1_500)} [shortened: 500 more characters not shown]`);
  assert.equal(at('y'.repeat(25_000)).text, `${'y'.repeat(1_500)} [shortened: 23,500 more characters not shown]`, 'thousands are grouped');

  assert.equal(at('alpha beta gamma', 11).text, 'alpha beta [shortened: 6 more characters not shown]', 'a limit of its own');
  assert.deepEqual(foldedTurn({ seq: 7, role: 'assistant', text: 'Short.' }), at('Short.'), 'a pure function of the turn');
  assert.deepEqual(at(long), at(long));
});

test('a turn too long for the model that writes the note is cut in the plan, so that what a person is shown is what the model reads', () => {
  const c = chat();
  try {
    say(c, 'user', 'Question 1');
    say(c, 'assistant', `${'long '.repeat(2_000)}end`);
    talk(c, 2);

    const made = plan(c);
    assert.deepEqual(seqs(made), [1, 2]);
    const cut = made.turns[1]!;
    assert.ok(cut.omitted > 8_000);
    assert.ok(cut.text.length < 1_600);
    assert.match(cut.text, /\[shortened: [\d,]+ more characters not shown\]$/);
    assert.deepEqual(made.turns[0], foldedTurn({ seq: 1, role: 'user', text: 'Question 1' }));
  } finally {
    c.dispose();
  }
});

test('the turns of a plan are no more than the model that writes the note reads, and a unit that would be clipped is left for the next fold', () => {
  assert.equal(TURNS_BUDGET, SUMMARY_BUDGET * 6);
  assert.equal(MAX_TURNS, 40);

  const c = chat();
  try {
    // Six exchanges of 1,500 characters a side: a unit comes to a little over 3,000 characters as it is read.
    for (let at = 1; at <= 6; at += 1) {
      say(c, 'user', `Q${at} `.padEnd(1_500, 'q'));
      say(c, 'assistant', `A${at} `.padEnd(1_500, 'a'));
    }

    const first = plan(c);
    assert.deepEqual(seqs(first), [1, 2, 3, 4], 'two units fit, and a third would be clipped');
    assert.ok(renderTurns(first.turns).length <= TURNS_BUDGET);
    const third = (c.conversations.read(CHAT)?.messages ?? []).slice(4, 6).map((each) => foldedTurn(each));
    assert.ok(renderTurns([...first.turns, ...third]).length > TURNS_BUDGET, 'and that is why a third is not in');
    assert.equal(first.through, 4);
    assert.equal(first.more, true, 'there is more to fold');
    assert.equal(first.kept, 2);

    c.conversations.summarise(CHAT, 'Note', first.through);
    const second = plan(c);
    assert.deepEqual(seqs(second), [5, 6, 7, 8]);
    assert.equal(second.more, false, 'and that is all of it');
    assert.equal(second.through, 8);
    assert.equal(second.summary, 'Note');
  } finally {
    c.dispose();
  }
});

test('a plan has no more than forty turns, and a fold never ends between a question and its answer', () => {
  const c = chat();
  try {
    talk(c, 60);

    const made = plan(c);
    assert.equal(made.turns.length, MAX_TURNS);
    assert.equal(made.through, 40);
    assert.equal(made.more, true);
    assert.equal(made.turns[0]!.role, 'user');
    assert.equal(made.turns.at(-1)!.role, 'assistant');
    assert.ok(made.turns.every((each, index) => each.role === (index % 2 === 0 ? 'user' : 'assistant')), 'whole exchanges');

    // A message with no partner stands alone: it is a unit, and one that would pass the limit is not split.
    const odd = chat();
    try {
      say(odd, 'assistant', 'A greeting that nobody asked for.');
      talk(odd, 20);
      for (let at = 0; at < 3; at += 1) say(odd, 'assistant', `Another ${at}`);
      talk(odd, 18);

      const next = plan(odd, 0);
      assert.equal(next.turns.length <= MAX_TURNS, true);
      assert.ok(next.turns.length === 40 || next.turns.length === 39, `${next.turns.length}`);
      assert.deepEqual(seqs(next), Array.from({ length: next.turns.length }, (_, index) => index + 1), 'in order and with none left out');
      const last = next.turns.at(-1)!;
      assert.equal(next.through, last.seq);
      assert.ok(last.role === 'assistant', 'it ends on an answer');
    } finally {
      odd.dispose();
    }
  } finally {
    c.dispose();
  }
});

test('a plan reads and writes nothing, asks no model, and is the same plan when it is asked again', async () => {
  const c = chat();
  try {
    await c.turn('What did I do with billing?', { grounding: { once: [ACME] } });
    await c.turn('And before that?');
    await c.turn('And at Globex?');
    await c.turn('And at school?');
    const asked = c.requests.length;

    const tables = ['runs', 'run_steps', 'events', 'grounding_record', 'grounding_entry', 'messages', 'conversations', 'grounding_conversation_limit', 'grounding_selection'];
    const counts = (): number[] => tables.map((table) => (c.s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
    const conversation = JSON.stringify(c.conversations.read(CHAT));
    const before = counts();

    const first = plan(c);
    assert.ok(first.turns.length > 0);
    assert.deepEqual(plan(c), first);

    assert.deepEqual(counts(), before);
    assert.equal(JSON.stringify(c.conversations.read(CHAT)), conversation, 'not even its summary or where it reaches');
    assert.equal(c.requests.length, asked, 'no model call');
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------ the walls */

const QUESTIONS = ['One?', 'Two?', 'Three?', 'Four?', 'Five?', 'Six?', 'Seven?'];

/**
 * A conversation of recorded answers, the second of which was given the piece `ACME`.
 *
 * Each run is given the answers before it as its history, so an answer built on
 * the second is built on what carries `ACME`. A run that is sent history of its
 * own is given none of them, and that is `independent`: the second answer is the
 * only one with the piece in it, and those after it are not built on it.
 */
const recorded = async (c: Chat, independent = false, first = 1): Promise<void> => {
  for (const [at, question] of QUESTIONS.entries()) {
    await c.turn(question, {
      ...(at === first ? { grounding: { once: [ACME] } } : {}),
      ...(independent ? { history: [{ role: 'user', text: 'Earlier.' }, { role: 'assistant', text: 'Yes.' }] } : {})
    });
  }
};

/** The `seq` of the answer to the nth turn of `recorded`: two messages a turn, the answer second. */
const answer = (turn: number): number => turn * 2;

test('an answer built from a piece that is excluded now is not folded, and neither is anything after it, and the plan says which', async () => {
  const c = chat();
  try {
    await recorded(c, true);
    assert.deepEqual(seqs(plan(c)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'before: all but the newest two exchanges');
    assert.deepEqual(plan(c).withheld, []);

    c.exclude(ACME);
    const made = plan(c);
    assert.deepEqual(seqs(made), [1, 2], 'only the exchange before the answer that carries it');
    assert.equal(made.through, 2, 'so the note will not reach it, and the answers after it that are not withheld are not folded either');
    assert.deepEqual(made.withheld, [answer(2)], 'and it is the answer that is named');
    assert.equal(made.more, false, 'nothing more can be folded for now');
    assert.equal(made.reason, undefined, 'something is');

    // Lifted, it is folded again.
    const { revision } = c.selections.read(CHAT);
    assert.ok(c.selections.change(CHAT, { expectedRevision: revision, exclude: [], clear: [ACME], pin: [], unpin: [] }).applied);
    assert.deepEqual(seqs(plan(c)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(plan(c).withheld, []);
  } finally {
    c.dispose();
  }
});

test('when the first thing to fold is withheld there is nothing to fold, and the plan says why', async () => {
  const c = chat();
  try {
    await recorded(c, true, 0);
    c.exclude(ACME);

    const made = plan(c);
    assert.equal(made.reason, 'withheld');
    assert.deepEqual(made.turns, []);
    assert.equal(made.through, 0);
    assert.deepEqual(made.withheld, [answer(1)]);
    assert.equal(made.more, false);
  } finally {
    c.dispose();
  }
});

test('an answer withheld among the newest exchanges stays where it is: it is not folded, and it does not stop what is older', async () => {
  const c = chat();
  try {
    for (const [at, question] of QUESTIONS.entries()) await c.turn(question, at === 5 ? { grounding: { once: [ACME] } } : {});
    c.exclude(ACME);

    const made = plan(c);
    assert.deepEqual(seqs(made), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the older exchanges, as if nothing were excluded');
    assert.deepEqual(made.withheld, [], 'and the one that is withheld is not among them');
    assert.equal(made.kept, 2);
  } finally {
    c.dispose();
  }
});

test('an answer built on a withheld one is withheld however far back, and the plan follows the chain', async () => {
  const c = chat();
  try {
    await recorded(c);
    c.exclude(ACME);

    const made = plan(c);
    assert.deepEqual(seqs(made), [1, 2], 'the chain begins at the second answer');
    // Every answer after it was given the ones before it as history, so each carries it.
    assert.deepEqual(made.withheld, [answer(2), answer(3), answer(4), answer(5)], 'and the plan names each of them, older than the newest two');
  } finally {
    c.dispose();
  }
});

test('an answer that no record can speak for is withheld while anything is excluded, as it is when a conversation is sent, and not before', () => {
  const c = chat();
  try {
    talk(c, 5);
    assert.deepEqual(plan(c).withheld, []);
    assert.equal(plan(c).turns.length, 6);

    c.exclude(ACME);
    const made = plan(c);
    assert.equal(made.reason, 'withheld', 'not knowing is not a reason to hand it over');
    assert.deepEqual(made.withheld, [2, 4, 6]);
  } finally {
    c.dispose();
  }
});

test('a note made from an answer that is excluded now is not written over and is not given to the model that would write it', async () => {
  const c = chat();
  try {
    await recorded(c, true);
    // A note through the fifth turn, made when nothing was excluded and from an answer that carries ACME.
    c.conversations.summarise(CHAT, 'We spoke of Acme in detail.', answer(3));
    assert.equal(plan(c).summary, 'We spoke of Acme in detail.');
    assert.ok(plan(c).turns.length > 0);

    c.exclude(ACME);
    const made = plan(c);
    assert.equal(made.reason, 'summary_withheld');
    assert.deepEqual(made.turns, []);
    assert.equal(made.summary, '', 'the note is not handed over, not even for the model to read');
    assert.equal(made.through, answer(3), 'and it reaches where it did');
    assert.equal(made.summarisedThrough, answer(3));
    assert.deepEqual(made.withheld, [], 'the answers it was made from are not older than what is to be folded');
    assert.equal(c.conversations.read(CHAT)?.conversation.summary, 'We spoke of Acme in detail.', 'and it is not touched');

    // A note made from nothing that is excluded is not held.
    const { revision } = c.selections.read(CHAT);
    c.selections.change(CHAT, { expectedRevision: revision, exclude: [], clear: [ACME], pin: [], unpin: [] });
    c.conversations.summarise(CHAT, 'We spoke of Acme in detail.', answer(3));
    c.exclude('cv:ctx/overview/personal');
    const other = plan(c);
    assert.notEqual(other.reason, 'summary_withheld', 'the note was not made from it');
    assert.equal(other.summary, 'We spoke of Acme in detail.');
  } finally {
    c.dispose();
  }
});

/* ----------------------------------------------------------------- afterwards */

test('after a fold the newest turns are what a message is sent with, and the note says what it was made from', async () => {
  const c = chat();
  try {
    await recorded(c);
    const made = plan(c);
    c.conversations.summarise(CHAT, 'We spoke of billing at Acme.', made.through);

    const run = c.begin({ question: 'And now?', history: [], summary: '' });
    await settle(run);

    const loop = c.requests.filter((each) => each.kind === 'loop').at(-1)!;
    assert.deepEqual(loop.history, ['Six?', 'An answer to turn 6.', 'Seven?', 'An answer to turn 7.'], 'the newest two exchanges, and nothing older');
    assert.ok(`${loop.system}\n${loop.prompt}`.includes('We spoke of billing at Acme.'), 'with the note');

    const note = c.entries(run).find((each) => each.ref === `conversation:${CHAT}/summary`);
    assert.ok(note, 'the record has the note');
    assert.equal(note.version, String(made.through), 'and says how far it reaches');
    assert.equal(note.digest, digest('We spoke of billing at Acme.'));
    assert.equal(note.status, 'included');
  } finally {
    c.dispose();
  }
});

test('a note made from an answer that is excluded after the fold is withheld from the next message, and comes back when the piece does', async () => {
  const c = chat();
  try {
    await recorded(c);
    const made = plan(c);
    c.conversations.summarise(CHAT, 'We spoke of the secret at Acme.', made.through);

    c.exclude(ACME);
    const run = c.begin({ question: 'And now?', history: [], summary: '' });
    await settle(run);

    const loop = c.requests.filter((each) => each.kind === 'loop').at(-1)!;
    assert.ok(!`${loop.system}\n${loop.prompt}`.includes('the secret at Acme'), 'the note is not sent');
    assert.equal(c.entries(run).find((each) => each.ref === `conversation:${CHAT}/summary`), undefined, 'and the record does not say it was');

    const { revision } = c.selections.read(CHAT);
    c.selections.change(CHAT, { expectedRevision: revision, exclude: [], clear: [ACME], pin: [], unpin: [] });
    const back = c.begin({ question: 'And now?', history: [], summary: '' });
    await settle(back);
    assert.ok(`${c.requests.filter((each) => each.kind === 'loop').at(-1)!.system}`.includes('the secret at Acme') || c.entries(back).some((each) => each.ref === `conversation:${CHAT}/summary`), 'it is sent again');
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------- the edges */

test('how many stay is what there are when there are fewer, counted from the note on and not from the start', () => {
  const c = chat();
  try {
    talk(c, 4);
    c.conversations.summarise(CHAT, 'We spoke of billing.', 6);

    const made = plan(c);
    assert.equal(made.reason, 'nothing', 'one exchange is after the note, and it stays');
    assert.equal(made.kept, 1, 'and it is the one that is counted');
    assert.equal(made.conversationId, CHAT, 'a plan of nothing is still the plan of this conversation');
    assert.equal(made.summarisedThrough, 6);

    const none = plan(c, 0);
    assert.deepEqual(seqs(none), [7, 8], 'with none to keep, what is after the note is folded');
    assert.equal(none.kept, 0);
  } finally {
    c.dispose();
  }
});

test('an exchange with a question or an answer that says nothing is not one that stays: what stays is what was said', () => {
  for (const blank of ['answer', 'question'] as const) {
    const c = chat();
    try {
      talk(c, 3);
      say(c, 'user', blank === 'question' ? '   ' : 'Question 4');
      say(c, 'assistant', blank === 'answer' ? '  ' : 'Answer 4');

      const made = plan(c);
      assert.deepEqual(seqs(made), [1, 2], `a blank ${blank}: the two before it stay, and so what is folded is what is before them`);
      assert.equal(made.through, 2);
      assert.equal(made.kept, 2);
    } finally {
      c.dispose();
    }
  }
});

test('a message that nobody asked for is folded on its own, ahead of the exchange that stays, and the plan says how many stay', () => {
  const c = chat();
  try {
    say(c, 'assistant', 'A greeting that nobody asked for.');
    talk(c, 1);

    const made = plan(c);
    assert.deepEqual(seqs(made), [1], 'the greeting, alone');
    assert.equal(made.through, 1);
    assert.equal(made.kept, 1, 'and the one exchange there is stays, though two may');
    assert.equal(made.more, false);
  } finally {
    c.dispose();
  }
});

test('a fold takes what the model that writes the note reads, to the character, and a unit that is one character over is left for the next fold', () => {
  const text = (label: string, size: number): string => label.padEnd(size, '.');
  const roles = ['user', 'assistant', 'user', 'assistant', 'user', 'assistant'] as const;
  const six = (size: number): string[] => [text('Q1 ', 1_500), text('A1 ', 1_500), text('Q2 ', 1_500), text('A2 ', 1_500), text('Q3 ', 1_500), text('A3 ', size)];
  const length = (size: number): number => renderTurns(six(size).map((each, at) => foldedTurn({ seq: at + 1, role: roles[at] as 'user', text: each }))).length;
  const exact = 10 + (TURNS_BUDGET - length(10));
  assert.ok(exact > 10 && exact <= TURN_LIMIT, `${exact}`);
  assert.equal(length(exact), TURNS_BUDGET, 'three exchanges that are read to the character');

  for (const [size, taken] of [[exact, 6], [exact + 1, 4]] as const) {
    const c = chat();
    try {
      for (const [at, each] of six(size).entries()) say(c, roles[at] as 'user', each);
      talk(c, 1);
      talk(c, 2);

      const made = plan(c);
      assert.equal(made.turns.length, taken, `${size}`);
      assert.equal(made.through, taken);
      assert.equal(made.more, true);
      assert.ok(renderTurns(made.turns).length <= TURNS_BUDGET);
    } finally {
      c.dispose();
    }
  }
});

test('questions that nobody answered are each a unit, and are not paired with the one after them, so a fold ends where the model reads to', () => {
  const c = chat();
  try {
    for (let at = 1; at <= 6; at += 1) say(c, 'user', `Q${at} `.padEnd(1_500, 'q'));
    talk(c, 2);

    const made = plan(c);
    assert.deepEqual(seqs(made), [1, 2, 3, 4, 5], 'five fit: a sixth would be clipped');
    assert.equal(made.through, 5, 'and the note reaches the fifth, which is not the end of a pair');
    assert.equal(made.more, true);
    assert.ok(renderTurns(made.turns).length <= TURNS_BUDGET);
  } finally {
    c.dispose();
  }
});

test('a fold reaches the end of the last exchange it takes, though what ends it said nothing', () => {
  const c = chat();
  try {
    say(c, 'user', 'Question 1');
    say(c, 'assistant', 'Answer 1');
    say(c, 'user', 'Question 2');
    say(c, 'assistant', '');
    talk(c, 2);

    const made = plan(c);
    assert.deepEqual(seqs(made), [1, 2, 3], 'the blank is not read');
    assert.equal(made.through, 4, 'and it is folded: the note reaches past it, so it is not asked for again');
    assert.equal(made.kept, 2);
  } finally {
    c.dispose();
  }
});

test('a note made from answers that are not excluded is given to the model, whatever is excluded after it', async () => {
  const c = chat();
  try {
    await recorded(c, true);
    c.conversations.summarise(CHAT, 'We spoke of billing.', answer(1));
    c.exclude(ACME);

    const made = plan(c);
    assert.equal(made.summary, 'We spoke of billing.', 'the answer that carries the piece is after the note');
    assert.equal(made.reason, 'withheld', 'and it is what stops the fold');
    assert.deepEqual(made.withheld, [answer(2)]);
    assert.equal(made.summarisedThrough, answer(1));
    assert.equal(made.through, answer(1));
  } finally {
    c.dispose();
  }
});

test('a note that says nothing is no note to give the model that writes the next', () => {
  const c = chat();
  try {
    talk(c, 6);
    c.conversations.summarise(CHAT, '   ', 4);

    const made = plan(c);
    assert.equal(made.summary, '');
    assert.deepEqual(seqs(made), [5, 6, 7, 8]);
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------- the production runtime */

const job = (company: string, title: string) => ({ company, title, started: '2020', finished: null, highlights: ['One.'], skills: [] });

/** A capability that records what it is told it read, so an answer of it has a record to be traced by. */
const reading = (): CapabilityMap => ({
  probe: noop(
    'probe',
    [
      stage('only', [
        transform('say', async (context) => {
          const read = z.array(z.string()).parse(context.input.read ?? []);
          context.record?.add(read.map((ref) => ({ ref, digest: digest(ref), status: 'included' as const, origin: 'server' as const, via: 'probe' })));
          context.record?.sent([{ field: 'history' }, { field: 'summary' }]);
          return { ok: true };
        })
      ])
    ],
    { recorded: true, input: z.object({ history: historySchema, summary: summarySchema, read: z.array(z.string()).default([]) }) }
  )
});

test('the production runtime plans a fold against its own records, its own exclusions and what its capabilities record', async () => {
  const s = scratch();
  const cvContext = createCvContextStore(s.db).create(randomUUID(), 'en');
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: reading(), logger: silentLogger });
  try {
    h.profile.replaceContext(cvContext.id, { experience: [job('Acme', 'Engineer'), job('Globex', 'Engineer')] }, 0);
    const chatId = h.conversations.create({ kind: 'profile', id: cvContext.id }).id;
    const globex = `cv:${cvContext.id}/experience/globex~engineer`;

    for (const [runId, read] of [['b', []], ['a', [globex]], ['c', []], ['d', []], ['e', []], ['f', []]] as const) {
      h.conversations.append(chatId, { role: 'user', text: `Question of ${runId}` });
      await h.run({ capability: 'probe', input: { read: [...read] }, contextId: cvContext.id, conversationId: chatId, runId });
      h.conversations.append(chatId, { role: 'assistant', text: `Answer of ${runId}`, runId });
    }
    const folded = (): FoldPlan => h.compaction.plan(chatId) as FoldPlan;

    assert.deepEqual(seqs(folded()), [1, 2, 3, 4, 5, 6, 7, 8], 'nothing is excluded, and every answer is known');
    assert.deepEqual(folded().withheld, []);

    assert.equal(h.selection.update(chatId, { expectedRevision: 0, exclude: [globex] })?.applied, true);
    const made = folded();
    assert.deepEqual(seqs(made), [1, 2], 'the first exchange was never given the job');
    assert.deepEqual(made.withheld, [4, 6, 8], 'the one that read it, and the two that were given it as history');
    assert.equal(made.through, 2);
  } finally {
    h.close();
    s.dispose();
  }
});

/* ------------------------------------------------------------------- the wire */

const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const refused = (response: Response) => {
  assert.ok(!response.ok, `expected a refusal, got ${JSON.stringify(response)}`);
  return response.error;
};

const world = () => {
  const s = scratch();
  const cvContext = createCvContextStore(s.db).create(randomUUID(), 'en');
  const harness = createHarness({
    databasePath: s.path,
    capabilities: {},
    logger: silentLogger,
    env: {},
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });
  const profile = harness.conversations.create({ kind: 'profile', id: cvContext.id });
  const dispatch = createDispatch(harness);

  return {
    harness,
    profile,
    dispatch,
    dispose: () => {
      harness.close();
      s.dispose();
    }
  };
};

test('the channel gives the plan of a conversation, and the plan is what the host runs and records', async () => {
  const w = world();
  try {
    for (let at = 1; at <= 5; at += 1) {
      w.harness.conversations.append(w.profile.id, { role: 'user', text: `Question ${at}` });
      w.harness.conversations.append(w.profile.id, { role: 'assistant', text: `Answer ${at}` });
    }

    const made = data<FoldPlan>(await w.dispatch('conversations.compactPlan', { conversationId: w.profile.id }));
    assert.deepEqual(made.turns.map((each) => each.seq), [1, 2, 3, 4, 5, 6]);
    assert.equal(made.through, 6);
    assert.equal(made.kept, KEEP_EXCHANGES);
    assert.deepEqual(made, JSON.parse(JSON.stringify(folding4(w, w.profile.id))), 'the same plan the service gives');

    const fewer = data<FoldPlan>(await w.dispatch('conversations.compactPlan', { conversationId: w.profile.id, keep: 4 }));
    assert.deepEqual(fewer.turns.map((each) => each.seq), [1, 2]);

    // Recorded as the host would, with what the plan says.
    const noted = data<{ conversation: { summarisedThrough: number; summary: string } }>(
      await w.dispatch('conversations.summarise', { conversationId: w.profile.id, summary: 'A note.', through: made.through })
    );
    assert.equal(noted.conversation.summarisedThrough, 6);

    const after = data<FoldPlan>(await w.dispatch('conversations.compactPlan', { conversationId: w.profile.id }));
    assert.equal(after.reason, 'nothing');
    assert.equal(after.summary, 'A note.');
    assert.equal(after.summarisedThrough, 6);
  } finally {
    w.dispose();
  }
});

const folding4 = (w: ReturnType<typeof world>, id: string): FoldPlan => w.harness.compaction.plan(id) as FoldPlan;

test('the channel refuses a conversation that is not there in the words a window shows, and a payload that is not its own', async () => {
  const w = world();
  try {
    const none = refused(await w.dispatch('conversations.compactPlan', { conversationId: 'nobody' }));
    assert.equal(none.code, 'not_found');
    assert.equal(none.message, 'No such conversation: nobody');

    for (const payload of [
      {},
      { conversationId: '' },
      { conversationId: 7 },
      { conversationId: w.profile.id, keep: -1 },
      { conversationId: w.profile.id, keep: 11 },
      { conversationId: w.profile.id, keep: 1.5 },
      { conversationId: w.profile.id, keep: '2' },
      { conversationId: w.profile.id, keep: null },
      { conversationId: w.profile.id, extra: 1 }
    ]) {
      assert.equal(refused(await w.dispatch('conversations.compactPlan', payload)).code, 'invalid_input', JSON.stringify(payload));
    }
    for (const keep of [0, 1, 10]) {
      assert.equal(data<FoldPlan>(await w.dispatch('conversations.compactPlan', { conversationId: w.profile.id, keep })).reason, 'nothing', `keep ${keep}`);
    }
  } finally {
    w.dispose();
  }
});

test('the runtime announces that it plans a fold, and says every reason there can be for there being nothing to fold', async () => {
  const w = world();
  try {
    const protocol = data<{ features: string[] }>(await w.dispatch('protocol.get', {}));
    assert.ok(protocol.features.includes('grounding-compaction'));
    assert.equal(protocol.features.filter((each) => each === 'grounding-compaction').length, 1, 'once');
    assert.equal(new Set(protocol.features).size, protocol.features.length, 'and so is every other');
    assert.deepEqual([...NOTHING], ['nothing', 'withheld', 'summary_withheld']);
  } finally {
    w.dispose();
  }
});
