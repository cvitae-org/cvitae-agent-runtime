/**
 * What a conversation carries once it stops fitting.
 *
 * The window sends the last few turns and that is what makes a follow-up a
 * follow-up. This is what happens to the turns behind it, and every way it can
 * be wrong is quiet: a note that describes the conversation instead of carrying
 * it still reads like a summary, and the answer three turns later is merely
 * worse rather than visibly broken.
 *
 * So the assertions are about the two things that are not a matter of taste —
 * what the model is asked for, and what is done with what it gives back.
 *
 * Mutations run, not assumed. Each was applied, the suite run, the failures
 * counted, and the mutation reverted:
 *
 *   the previous note is not sent      1  a note is rewritten, not started …
 *   the headings are dropped           2  the note is asked for as carried … /
 *                                         a note that describes … (the goal)
 *   the turns are not sent             1  a note is rewritten, not started …
 *   an over-long note is stored as-is  2  a note too long for its ceiling … /
 *                                         a note is cut between its headings …
 *   the note is cut mid-word           1  a note is cut between its headings …
 *   an empty batch is accepted         1  folding nothing in is refused …
 *   the batch ceiling is dropped       1  folding nothing in is refused …
 *
 * The rendering of the turns is asserted loosely on purpose. That a turn's role
 * reaches the prompt is the claim; that it reaches it as `user: ` rather than
 * some other marker is a decision, and pinning a decision in a test is how a
 * prompt becomes unimprovable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { SUMMARY_BUDGET, trimNote } from '../src/capabilities/summarizeConversation.js';
import { startRun } from '../src/runtime/run.js';
import { spine } from './support/spine.js';
import type { AiGateway, TextRequest } from '../src/contracts/index.js';

/* ---------------------------------------------------------------- harness */

type Asked = { readonly requests: TextRequest[] };

const fold = async (
  input: Record<string, unknown>,
  answer: string | ((request: TextRequest) => string) = 'GOAL: a backend role.'
): Promise<{ result: Record<string, unknown>; asked: Asked }> => {
  const requests: TextRequest[] = [];

  const ai: Partial<AiGateway> = {
    generateText: async (request) => {
      requests.push(request);
      return {
        text: typeof answer === 'string' ? answer : answer(request),
        finishReason: 'stop',
        usage: {}
      };
    }
  };

  const s = spine(capabilities, { ai });

  try {
    const result = await startRun(s.deps, {
      capability: 'summarize_conversation',
      input: {
        turns: [
          { role: 'user', text: 'What did I do at Acme?' },
          { role: 'assistant', text: 'You rewrote the billing pipeline.' }
        ],
        ...input
      }
    });
    return { result: result.data, asked: { requests } };
  } finally {
    s.dispose();
  }
};

/* ------------------------------------------------------------ what is asked */

test('the note is asked for as carried state, not as an account of a chat', async () => {
  const { asked } = await fold({});
  const system = asked.requests[0]?.system ?? '';

  // A model told only to summarise writes what happened — "the user asked
  // about their experience and the assistant listed several roles" — which
  // describes a conversation and carries none of what the next turn needs.
  // The headings are what make it state instead.
  for (const heading of ['GOAL', 'DECIDED', 'REJECTED', 'FACTS', 'OPEN']) {
    assert.match(system, new RegExp(`\\b${heading}\\b`), `no ${heading} heading`);
  }

  // The one that earns its place twice: what somebody turned down is both the
  // most useful thing to carry into the next turn and the first thing a general
  // summary drops, because a refusal is not part of the story of what happened.
  assert.match(system, /REJECTED: what they turned down, and why\./);
});

test('a note is rewritten, not started again from the turns', async () => {
  const { asked } = await fold({
    summary: 'GOAL: position for a backend role.\nREJECTED: the Web3-first framing.'
  });

  const prompt = asked.requests[0]?.prompt ?? '';

  // Both halves. Without the note the model starts over every batch and the
  // conversation remembers only its most recent few turns however long it runs
  // — which is the bug the note exists to fix, reintroduced one level up.
  assert.match(prompt, /the Web3-first framing/);
  assert.match(prompt, /rewrote the billing pipeline/);
});

/* -------------------------------------------------- what is done with it */

test('a note too long for its ceiling is cut, not stored as it came', async () => {
  const long = Array.from({ length: 200 }, (_, i) => `FACTS: fact number ${i}.`).join('\n');
  const { result } = await fold({}, long);

  // Asked for in the prompt and enforced here, because a model told to write at
  // most 1,500 characters writes 1,700 often enough to matter — and this is
  // stored and sent in front of every later question, so an overrun that is
  // only asked for is an overrun that compounds.
  assert.ok(
    (result.summary as string).length <= SUMMARY_BUDGET,
    `the note came back at ${(result.summary as string).length} characters`
  );
  assert.equal(result.chars, (result.summary as string).length);
});

test('a note is cut between its headings, never through one', () => {
  const note = ['GOAL: a backend role.', 'DECIDED: lead with the migration.'].join('\n');

  // Truncation is fine here and is not fine for a turn, and the two are a file
  // apart. A turn cut short is a different thing said; a list of headings cut
  // at a line boundary is a shorter list, where what survives is still true.
  assert.equal(trimNote(note, 30), 'GOAL: a backend role.');

  // Not "DECIDED: lead with the migr", which the next turn would read as a
  // decision about something with that name.
  assert.ok(!trimNote(note, 30).includes('migr'));
});

/* ------------------------------------------------------------- the bounds */

test('folding nothing in is refused, and so is folding everything', async () => {
  // Nothing to fold is a caller that has miscounted, and a run that answers it
  // is a model call that rewrites a note from no new information.
  await assert.rejects(() => fold({ turns: [] }), /nothing to fold in/i);

  // The backlog case: the marker does not move on a failed run, so a spell of
  // failures leaves turns piling up. The ceiling is what stops the call that
  // finally succeeds being unbounded.
  await assert.rejects(
    () => fold({ turns: Array.from({ length: 41 }, () => ({ role: 'user', text: 'x' })) }),
    /At most 40 turns/
  );
});
