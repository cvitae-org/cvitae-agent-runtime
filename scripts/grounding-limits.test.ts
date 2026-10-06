/**
 * A limit on everything a message is made of, and the early refusals.
 *
 * Each part of a message had a ceiling of its own, and nothing said what they came
 * to together. A person with a model whose window is smaller than the sum now sets
 * one, in characters, for everything and for a conversation, and a message over it
 * is refused before any model is asked. The pieces' own budget is now said at the
 * same place: it used to be found by the assembly, after the model had been asked
 * which tools to offer.
 *
 * The questions, in order:
 *
 *   untouched   with no limit set, or one that is not reached, a message is the
 *               message it always was, byte for byte, and nothing is read for it
 *   keeping     a conversation's limit is its own and beats the global one, a
 *               limit is a whole number of characters from the floor to the
 *               ceiling, and what is refused writes nothing
 *   the wire    the channels read and set it, say what a window draws it from, and
 *               the feature is announced
 *   the schema  the tables are new, and what a database had before is unchanged
 *   over it     a message over its limit is refused as `context_limit` before any
 *               model call, naming each part; at the limit it runs; every part
 *               counts, as the model is shown it
 *   the pieces  over their own budget the message is refused as `grounding_budget`
 *               before any model call, and before a limit
 *   by itself   `auto` adds only what the limit leaves room for
 *   needs       a message with nothing to answer from is not told it is too long,
 *               and a need that has a code of its own fails with it
 *   where       every run of a conversation has the limit, a saved offer's too
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 116 were applied. The number is how many
 * tests failed.
 *
 * what a limit is:
 *   the floor is a character lower                              15
 *   the floor is a character higher                             8
 *   the ceiling is a character lower                            4
 *   the ceiling is a character higher                           6
 *   a limit need not be a whole number                          3
 *   a limit may be below the floor by none                      13
 *   a limit may not be the ceiling                              4
 *   a limit may be anything that is a number                    3
 *
 * over the limit:
 *   a message at its limit is over it                           6
 *   a message a character over its limit is not                 6
 *   no limit is a limit of nothing                              7
 *   the history is not counted                                  9
 *   the summary is not counted                                  4
 *   the pieces are not counted                                  6
 *   the posting is not counted                                  3
 *   a part that is empty is named                               2
 *   the parts are not named                                     4
 *   the amounts are not set out in thousands                    7
 *   the advice is another                                       1
 *   the limit is not named                                      2
 *   the room ignores the limit                                  3
 *   the room ignores the history                                2
 *   the room ignores the summary                                1
 *   the room ignores the posting                                1
 *   the room may exceed the pieces' budget                      1
 *   the room may be less than nothing                           1
 *   no limit leaves no room                                     2
 *
 * the store:
 *   a conversation lives under the global limit first           5
 *   a conversation does not live under the global limit         4
 *   a conversation is held to the lower of its own and the global 4
 *   a read does not say what is global                          5
 *   a read does not say what is the conversation's              4
 *   a read about no conversation says the conversation's        1
 *   an amount is not checked                                    2
 *   a refusal does not say the bounds                           2
 *   a refusal is another code                                   2
 *   a conversation that is not there is allowed                 1
 *   a conversation that is not there is another code            1
 *   setting again adds a second                                 9
 *   removing a conversation's limit removes the global one      2
 *   removing the global limit removes every conversation's      3
 *   removing the global limit removes nothing                   3
 *   removing a conversation's limit removes nothing             2
 *   a conversation's limit is set for everything                7
 *   everything's limit is set for a conversation                9
 *
 * the schema:
 *   the table does not keep the floor                           1
 *   the table does not keep the ceiling                         1
 *   a conversation's table does not keep the floor              1
 *   a conversation's table does not keep the ceiling            1
 *   everything may have many limits                             1
 *   a limit does not belong to a conversation                   2
 *   a limit outlives its conversation                           1
 *   a conversation may have many limits                         32
 *
 * the wire:
 *   the service says the global limit first                     1
 *   the service says no limit when only the global one is set   1
 *   the service says no floor                                   1
 *   the service says no ceiling                                 1
 *   the service does not say the baseline                       1
 *   the service reads a conversation that is not there          1
 *   the service sets for a conversation that is not there       0 (equivalent: the store refuses it with the same code and words)
 *   the service does not remove with null                       1
 *   the service answers with what was there before              1
 *   the channel does not read the conversation                  2
 *   the channel does not set the conversation's                 3
 *   the channel does not say a conversation is not there        1
 *   the channel does not say a conversation is not there when it sets 1
 *   the channel does not announce the budget                    1
 *   the channel announces the budget twice                      1
 *   the amount may not be removed                               1
 *   the amount may be a string                                  1
 *   the amount is checked by the channel as an integer          1
 *   a setting may carry more than it says                       1
 *   a read may carry more than it says                          1
 *   a setting needs a conversation                              3
 *   a read needs a conversation                                 2
 *
 * where:
 *   a limit is only on runs with walls                          1
 *   a run is not given the limit                                13
 *   a run is given the limit it was made with                   1
 *   a run is given another conversation's limit                 2
 *   a run is given the limit when it has no conversation        1
 *   the runtime keeps no limits                                 2
 *   the runtime says nothing of limits                          4
 *   the service is over another store                           5
 *
 * early:
 *   the size is not measured                                    9
 *   the size is measured before the selection                   1
 *   the rest of the message is not measured                     8
 *   the history is not counted                                  8
 *   the history is counted with its roles                       6
 *   the summary is not counted                                  3
 *   the posting is not counted                                  2
 *   the posting is counted as sent                              1
 *   the ground step is told nothing of the rest                 2
 *   the pieces are not measured                                 4
 *   the pins are not measured                                   1
 *   the attachments are not measured                            4
 *   a message with nothing to send measures anyway              1
 *   the limit is read when the plan is made                     8
 *   a size that is a problem is optional                        9
 *   a size that is a problem has no code                        9
 *   the budget is said as the limit                             2
 *   the limit is said as the budget                             8
 *   the limit is said before the budget                         1
 *   the budget is a character more                              1
 *   the budget is a character less                              1
 *   the rest is not part of the limit                           9
 *   the assembly does not refuse what the limit no longer allows 1
 *   the assembly does not refuse what the budget no longer allows 1
 *   the assembly reads the limit of nobody                      3
 *   auto may add what the limit leaves no room for              2
 *   auto ignores what the rest of the message takes             1
 *   auto adds without counting the separator                    1
 *   auto adds what is a character too long                      1
 *   auto does not count what it adds                            1
 *   a need with a code says needs_unmet                         10
 *   a need with a code says its name as well                    3
 *   a need with no code has one                                 2
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { assembleCv } from '../src/capabilities/cv/assembly.js';
import { askProfile } from '../src/capabilities/askProfile.js';
import { capabilities } from '../src/capabilities/index.js';
import { BASELINE, CONTEXT_CEILING, CONTEXT_FLOOR, isLimit, overLimit, roomForPicks } from '../src/context/limits.js';
import { PICKS_BUDGET } from '../src/context/ground.js';
import { bindCvScope } from '../src/runtime/cv-scope.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import { checkNeeds } from '../src/runtime/needs.js';
import { buildRunContext } from '../src/runtime/run.js';
import { createConversationStore } from '../src/storage/sqlite/conversations.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createLimitStore } from '../src/storage/sqlite/grounding-limits.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { open } from '../src/storage/sqlite/open.js';
import type { CapabilityMap, ChunkHit, RunContext } from '../src/contracts/index.js';
import { z } from 'zod';
import { scratch } from './support/db.js';
import { ACME, ACME_TEXT, CHAT, CONTEXT, ROLE, ROLE_TEXT, acmeOf, chat, cv, job, ref, refusal, settle } from './support/chat.js';

const QUESTION = 'What did I do with billing?';
const question = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ question: QUESTION, ...over });

/** A turn of this many characters, said by one side. */
const turn = (role: 'user' | 'assistant', size: number) => ({ role, text: 'h'.repeat(size) });

assert.equal(ACME_TEXT.length, 83, 'the fixture piece is as long as the tests say');
assert.equal(ROLE_TEXT.length, 62, 'and so is the other');

/** Pieces sent together are joined with a blank line, which is two characters. */
const BOTH = ACME_TEXT.length + 2 + ROLE_TEXT.length;

const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const refused = (response: Response) => {
  assert.ok(!response.ok, `expected a refusal, got ${JSON.stringify(response)}`);
  return response.error;
};

/* ---------------------------------------------------------------- untouched */

test('a message with no limit set is the message it always was, byte for byte, and a runtime that keeps no limits sends the same', async () => {
  const bare = chat({ limits: false });
  const kept = chat();
  try {
    const input = question({ grounding: { once: [ACME] }, summary: 'Earlier we spoke of billing.', history: [turn('user', 20), turn('assistant', 20)] });
    const plain = question();

    for (const each of [bare, kept]) {
      await settle(each.begin(plain));
      await settle(each.begin(input));
    }

    assert.deepEqual(kept.requests, bare.requests);
    assert.deepEqual(kept.requests.map((each) => each.kind), ['plan', 'loop', 'plan', 'loop'], 'the same model calls');
    assert.equal(kept.requests[1]?.prompt, QUESTION);
  } finally {
    bare.dispose();
    kept.dispose();
  }
});

test('a limit that is not reached changes no word of what is sent', async () => {
  const free = chat();
  const limited = chat();
  try {
    limited.limitStore.set(undefined, CONTEXT_CEILING);
    limited.limitStore.set(CHAT, 5_000);
    const input = question({ grounding: { once: [ACME, ROLE] }, summary: 'Earlier we spoke of billing.', history: [turn('user', 200)] });

    await settle(free.begin(input));
    await settle(limited.begin(input));

    assert.deepEqual(limited.requests, free.requests);
  } finally {
    free.dispose();
    limited.dispose();
  }
});

test('a message that sends no pieces reads no document for its limit', async () => {
  const c = chat();
  try {
    c.limitStore.set(CHAT, 3_000);
    const run = c.begin(question({ summary: 'Earlier we spoke of billing.' }));
    await settle(run);

    // Measuring the pieces reads the CV, and the CV read says so in the record. A
    // message with no pieces has nothing to measure.
    assert.deepEqual(c.entries(run).filter((each) => each.via === 'port:documents'), []);
    assert.deepEqual(c.entries(run).map((each) => each.ref), ['conversation:chat/summary'], 'only what the message carried');
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------ keeping */

test('a conversation has its own limit, which beats the global one even when it is higher', () => {
  const c = chat();
  try {
    assert.equal(c.limitStore.effective(CHAT), undefined, 'nothing is set');
    assert.deepEqual(c.limitStore.read(CHAT), {});

    c.limitStore.set(undefined, 4_000);
    assert.equal(c.limitStore.effective(CHAT), 4_000, 'a conversation with none lives under the global one');
    assert.deepEqual(c.limitStore.read(CHAT), { global: 4_000 });

    c.limitStore.set(CHAT, 9_000);
    assert.equal(c.limitStore.effective(CHAT), 9_000, 'its own beats it, above as well as below');
    assert.deepEqual(c.limitStore.read(CHAT), { global: 4_000, conversation: 9_000 });
    assert.deepEqual(c.limitStore.read(), { global: 4_000 }, 'asked about no conversation, only the global one');

    c.limitStore.set(CHAT, 3_000);
    assert.equal(c.limitStore.effective(CHAT), 3_000, 'and below');

    c.limitStore.set(CHAT, 3_500);
    assert.equal(c.limitStore.effective(CHAT), 3_500, 'setting again replaces it and does not add a second');
    assert.equal((c.s.db.prepare('SELECT count(*) AS n FROM grounding_conversation_limit').get() as { n: number }).n, 1);

    c.limitStore.set(undefined, 5_000);
    assert.equal(c.limitStore.effective(CHAT), 3_500, 'the global one moving does not move the conversation\'s');
    assert.equal((c.s.db.prepare('SELECT count(*) AS n FROM grounding_limit').get() as { n: number }).n, 1);
  } finally {
    c.dispose();
  }
});

test('removing a setting leaves the next one in force, and removes only its own', () => {
  const c = chat();
  try {
    const other = c.conversations.create({ kind: 'profile', id: CONTEXT });
    c.limitStore.set(undefined, 4_000);
    c.limitStore.set(CHAT, 9_000);
    c.limitStore.set(other.id, 7_000);

    c.limitStore.set(CHAT, undefined);
    assert.equal(c.limitStore.effective(CHAT), 4_000, 'the conversation falls back to the global one');
    assert.equal(c.limitStore.effective(other.id), 7_000, 'another conversation keeps its own');

    c.limitStore.set(undefined, undefined);
    assert.equal(c.limitStore.effective(CHAT), undefined);
    assert.equal(c.limitStore.effective(other.id), 7_000, 'a conversation does not lose its own when the global one goes');

    c.limitStore.set(CHAT, undefined);
    assert.equal(c.limitStore.effective(CHAT), undefined, 'removing what is not set is not an error');
  } finally {
    c.dispose();
  }
});

test('the floor and the ceiling are allowed, and anything else is refused as invalid_limit and writes nothing', () => {
  const c = chat();
  try {
    c.limitStore.set(undefined, CONTEXT_FLOOR);
    assert.equal(c.limitStore.read().global, CONTEXT_FLOOR);
    c.limitStore.set(undefined, CONTEXT_CEILING);
    assert.equal(c.limitStore.read().global, CONTEXT_CEILING);
    c.limitStore.set(CHAT, CONTEXT_FLOOR);
    c.limitStore.set(CHAT, CONTEXT_CEILING);

    assert.equal(CONTEXT_FLOOR, 2_000);
    assert.equal(CONTEXT_CEILING, 60_000);

    for (const amount of [CONTEXT_FLOOR - 1, CONTEXT_CEILING + 1, 0, -1, 2_000.5, 10_000.1, Number.NaN, Infinity, 1e300]) {
      for (const where of [undefined, CHAT]) {
        assert.throws(
          () => c.limitStore.set(where, amount),
          (error: { code?: string; message?: string }) =>
            error.code === 'invalid_limit' && /2000/.test(error.message ?? '') && /60000/.test(error.message ?? ''),
          `${String(amount)} for ${where ?? 'everything'}`
        );
      }
    }
    assert.throws(() => c.limitStore.set(CHAT, '3000' as never), (error: { code?: string }) => error.code === 'invalid_limit');

    assert.deepEqual(c.limitStore.read(CHAT), { global: CONTEXT_CEILING, conversation: CONTEXT_CEILING }, 'what was set is still set');
  } finally {
    c.dispose();
  }
});

test('the same bounds are in the table, so a row the store would refuse cannot be written around it', () => {
  const c = chat();
  try {
    const global = c.s.db.prepare('INSERT INTO grounding_limit (id, context) VALUES (1, ?)');
    const own = c.s.db.prepare('INSERT INTO grounding_conversation_limit (conversation_id, context) VALUES (?, ?)');

    assert.throws(() => global.run(CONTEXT_FLOOR - 1), /CHECK/);
    assert.throws(() => global.run(CONTEXT_CEILING + 1), /CHECK/);
    assert.throws(() => own.run(CHAT, CONTEXT_FLOOR - 1), /CHECK/);
    assert.throws(() => own.run(CHAT, CONTEXT_CEILING + 1), /CHECK/);
    assert.throws(() => c.s.db.prepare('INSERT INTO grounding_limit (id, context) VALUES (2, 3000)').run(), /CHECK/, 'one row for everything');
    assert.throws(() => own.run('nobody', 3_000), /FOREIGN KEY/, 'a limit belongs to a conversation that is there');

    global.run(CONTEXT_FLOOR);
    own.run(CHAT, CONTEXT_CEILING);
  } finally {
    c.dispose();
  }
});

test('a limit for a conversation that does not exist is refused as not_found and writes nothing', () => {
  const c = chat();
  try {
    assert.throws(
      () => c.limitStore.set('nobody', 3_000),
      (error: { code?: string; message?: string }) => error.code === 'not_found' && /nobody/.test(error.message ?? '')
    );
    assert.equal((c.s.db.prepare('SELECT count(*) AS n FROM grounding_conversation_limit').get() as { n: number }).n, 0);

    // Removing is not refused for being there or not: there is nothing to remove.
    assert.throws(() => c.limitStore.set('nobody', undefined), (error: { code?: string }) => error.code === 'not_found');
  } finally {
    c.dispose();
  }
});

test('a conversation\'s limit goes with the conversation, and the global one does not', () => {
  const c = chat();
  try {
    c.limitStore.set(undefined, 4_000);
    c.limitStore.set(CHAT, 9_000);

    assert.equal(c.conversations.delete(CHAT), true);

    assert.equal((c.s.db.prepare('SELECT count(*) AS n FROM grounding_conversation_limit').get() as { n: number }).n, 0);
    assert.equal(c.limitStore.read().global, 4_000);
    assert.deepEqual(c.s.db.pragma('foreign_key_check'), []);
  } finally {
    c.dispose();
  }
});

test('a second store over the same database reads what the first set', () => {
  const c = chat();
  try {
    c.limitStore.set(undefined, 4_000);
    c.limitStore.set(CHAT, 9_000);

    const again = createLimitStore(c.s.db);
    assert.deepEqual(again.read(CHAT), { global: 4_000, conversation: 9_000 });
    assert.equal(again.effective(CHAT), 9_000);
  } finally {
    c.dispose();
  }
});

test('what a limit is, in numbers', () => {
  assert.equal(isLimit(CONTEXT_FLOOR), true);
  assert.equal(isLimit(CONTEXT_CEILING), true);
  assert.equal(isLimit(CONTEXT_FLOOR - 1), false);
  assert.equal(isLimit(CONTEXT_CEILING + 1), false);
  assert.equal(isLimit(3_000.5), false);
  assert.equal(isLimit('3000'), false);
  assert.equal(isLimit(undefined), false);

  // The ceiling is the sum of what each part is held to, rounded up, so a limit at it binds nothing.
  assert.deepEqual(BASELINE, { history: 6_000, historyTurns: 12, summary: 1_500, picks: 12_000, posting: 40_000 });
  assert.ok(CONTEXT_CEILING >= BASELINE.history + BASELINE.summary + BASELINE.picks + BASELINE.posting + 1 /* the clip's mark */ + 3 * 2);
  assert.ok(CONTEXT_CEILING - (BASELINE.history + BASELINE.summary + BASELINE.picks + BASELINE.posting) <= 1_000, 'and not by much');
});

test('what is left for the pieces is the limit less the rest, never more than their own budget and never below nothing', () => {
  const rest = { history: 1_000, summary: 500, posting: 300 };

  assert.equal(roomForPicks(rest, undefined), PICKS_BUDGET, 'with no limit, their own budget');
  assert.equal(roomForPicks(rest, 10_000), 10_000 - 1_800);
  assert.equal(roomForPicks(rest, CONTEXT_CEILING), PICKS_BUDGET, 'never more than their own budget');
  assert.equal(roomForPicks(rest, 1_000), 0, 'never below nothing');
  assert.equal(roomForPicks(rest, 1_800), 0);
  assert.equal(roomForPicks(rest, 1_801), 1);

  assert.equal(overLimit({ ...rest, picks: 200 }, 2_000), undefined, 'at it');
  assert.match(overLimit({ ...rest, picks: 201 }, 2_000) ?? '', /2,001 characters/, 'a character over');
  assert.equal(overLimit({ ...rest, picks: 200_000 }, undefined), undefined, 'no limit, no refusal');
});

/* ----------------------------------------------------------------- the wire */

const world = (capabilities?: CapabilityMap) => {
  const s = scratch();
  const cvContext = createCvContextStore(s.db).create(randomUUID(), 'en');
  const harness = createHarness({
    databasePath: s.path,
    ...(capabilities === undefined ? { capabilities: {} } : { capabilities }),
    logger: silentLogger,
    env: {},
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });
  const profile = harness.conversations.create({ kind: 'profile', id: cvContext.id });
  const dispatch = createDispatch(harness);

  return {
    s,
    harness,
    cvContext,
    profile,
    dispatch,
    dispose: () => {
      harness.close();
      s.dispose();
    }
  };
};

type View = {
  baseline: typeof BASELINE;
  floor: number;
  ceiling: number;
  global: number | null;
  conversation: number | null;
  effective: number | null;
};

test('the channels say what is set and what a window draws it from, and set it for everything or for a conversation', async () => {
  const w = world();
  try {
    const first = data<View>(await w.dispatch('limits.get', {}));
    assert.deepEqual(first, {
      baseline: { history: 6_000, historyTurns: 12, summary: 1_500, picks: 12_000, posting: 40_000 },
      floor: 2_000,
      ceiling: 60_000,
      global: null,
      conversation: null,
      effective: null
    });

    const global = data<View>(await w.dispatch('limits.set', { context: 8_000 }));
    assert.deepEqual([global.global, global.conversation, global.effective], [8_000, null, 8_000]);

    const own = data<View>(await w.dispatch('limits.set', { conversationId: w.profile.id, context: 3_000 }));
    assert.deepEqual([own.global, own.conversation, own.effective], [8_000, 3_000, 3_000]);

    const read = data<View>(await w.dispatch('limits.get', { conversationId: w.profile.id }));
    assert.deepEqual(read, own, 'a read says what the write did');
    const everything = data<View>(await w.dispatch('limits.get', {}));
    assert.deepEqual([everything.global, everything.conversation, everything.effective], [8_000, null, 8_000], 'asked about none, it is the global one');

    const higher = data<View>(await w.dispatch('limits.set', { conversationId: w.profile.id, context: 20_000 }));
    assert.equal(higher.effective, 20_000, 'a conversation above the global one is held to its own');

    const dropped = data<View>(await w.dispatch('limits.set', { conversationId: w.profile.id, context: null }));
    assert.deepEqual([dropped.conversation, dropped.effective], [null, 8_000], 'null removes it');
    const cleared = data<View>(await w.dispatch('limits.set', { context: null }));
    assert.deepEqual([cleared.global, cleared.effective], [null, null]);
  } finally {
    w.dispose();
  }
});

test('the channels refuse an amount outside the floor and the ceiling in words, a conversation that is not there, and a payload that is not theirs', async () => {
  const w = world();
  try {
    for (const context of [1_999, 60_001, 2_500.5]) {
      const error = refused(await w.dispatch('limits.set', { context }));
      assert.equal(error.code, 'invalid_limit', String(context));
      assert.match(error.message, /2000 to 60000/);
    }
    assert.equal(data<View>(await w.dispatch('limits.get', {})).global, null, 'nothing was written');

    assert.equal(refused(await w.dispatch('limits.get', { conversationId: 'nobody' })).code, 'not_found');
    const unset = refused(await w.dispatch('limits.set', { conversationId: 'nobody', context: 3_000 }));
    assert.equal(unset.code, 'not_found');
    assert.equal(unset.message, 'No such conversation: nobody', 'in the words a window shows');

    for (const payload of [{}, { context: '3000' }, { context: undefined }, { context: 3_000, extra: 1 }, { conversationId: '', context: 3_000 }, { conversationId: 7, context: 3_000 }]) {
      assert.equal(refused(await w.dispatch('limits.set', payload)).code, 'invalid_input', JSON.stringify(payload));
    }
    assert.equal(refused(await w.dispatch('limits.get', { extra: 1 })).code, 'invalid_input');
  } finally {
    w.dispose();
  }
});

test('the runtime announces that it limits a message and says its pieces over their budget early, once', async () => {
  const w = world();
  try {
    const { features } = data<{ features: string[] }>(await w.dispatch('protocol.get', {}));

    assert.equal(features.filter((feature) => feature === 'grounding-budget').length, 1);
    assert.ok(features.includes('grounding-assembly'), 'and what it stands on is still announced');
  } finally {
    w.dispose();
  }
});

test('a limit set through the channel binds the runs of the runtime that was built, which is where the store is wired in', async () => {
  const seen: (number | undefined)[] = [];
  const probe: CapabilityMap = {
    probe: {
      name: 'probe',
      describe: 'Says what limit its run lives under.',
      input: z.object({}).passthrough(),
      needs: (_input, context) => {
        seen.push(context.limits?.context());
        return [];
      },
      plan: () => ({ capability: 'probe', source: 'declared', stages: [] })
    }
  };
  const w = world(probe);
  try {
    const run = () => w.harness.run({ capability: 'probe', input: {}, contextId: w.cvContext.id, conversationId: w.profile.id });
    const other = w.harness.conversations.create({ kind: 'profile', id: w.cvContext.id });

    await run();
    await w.dispatch('limits.set', { context: 9_000 });
    await run();
    await w.dispatch('limits.set', { conversationId: w.profile.id, context: 3_000 });
    await run();
    await w.harness.run({ capability: 'probe', input: {}, contextId: w.cvContext.id, conversationId: other.id });

    assert.deepEqual(seen, [undefined, 9_000, 3_000, 9_000], 'nothing, the global one, its own, and another conversation\'s global one');
  } finally {
    w.dispose();
  }
});

test('a message too long for its limit is refused by the runtime as built, with no model configured to ask', async () => {
  const w = world(capabilities);
  try {
    await w.dispatch('limits.set', { conversationId: w.profile.id, context: CONTEXT_FLOOR });
    const long = { question: QUESTION, history: [turn('user', 3_000)] };

    await assert.rejects(
      w.harness.run({ capability: 'ask_profile', input: long, contextId: w.cvContext.id, conversationId: w.profile.id }),
      (error: { code?: string }) => error.code === 'context_limit'
    );
  } finally {
    w.dispose();
  }
});

/* --------------------------------------------------------------- the schema */

test('the migration adds the two tables and leaves what a database had before it as it was', () => {
  const db = open(':memory:');

  try {
    migrate(db, migrations.filter((step) => step.version <= 43));
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'grounding%limit'").get(), undefined);

    const old = createConversationStore(db).create({ kind: 'profile', id: '' });
    const tables = () =>
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    const before = tables();

    migrate(db);

    assert.deepEqual(tables(), [...before, 'grounding_conversation_limit', 'grounding_limit'].sort(), 'it adds two tables and nothing else');
    assert.equal(createLimitStore(db).effective(old.id), undefined, 'a conversation from before has set nothing');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.prepare('SELECT id FROM conversations WHERE id = ?').get(old.id) !== undefined, true);
  } finally {
    db.close();
  }
});

/* ------------------------------------------------------------------ over it */

test('a message over its limit is refused before any model is asked, and says what each part came to', async () => {
  const c = chat();
  try {
    c.limitStore.set(CHAT, 3_000);
    const run = c.begin(
      question({
        summary: 's'.repeat(1_500),
        history: [turn('user', 1_000), turn('assistant', 1_000)],
        grounding: { once: [ACME, ROLE] }
      })
    );

    const { code, message } = await refusal(run);

    assert.equal(code, 'context_limit');
    // 1,000 + 1,000 of history, 1,500 of summary, and the two pieces as the model reads them.
    assert.equal(message, `The material for this message comes to ${(2_000 + 1_500 + BOTH).toLocaleString('en-US')} characters (history 2,000, summary 1,500, pieces ${BOTH}), and this conversation is limited to 3,000. Unpin or detach something, or raise the limit.`);
    assert.deepEqual(c.requests, [], 'no model was asked: not which tools to offer, and not the question');
    assert.equal(c.searches.count, 0);

    // The run is a failed run of this conversation, and has a record of what it was.
    assert.equal(c.s.runs.get(run.runId)?.status, 'failed');
  } finally {
    c.dispose();
  }
});

test('a message is refused as over, and not as more than the one limit that is set: the conversation\'s own, else the global', async () => {
  const c = chat();
  try {
    const long = question({ history: [turn('user', 2_500)] });

    c.limitStore.set(undefined, 2_000);
    assert.equal((await refusal(c.begin(long))).code, 'context_limit', 'the global one binds a conversation that has none');

    c.limitStore.set(CHAT, 3_000);
    await settle(c.begin(long));
    assert.equal(c.requests.length, 2, 'the conversation\'s own, which is higher, binds instead');

    c.limitStore.set(CHAT, undefined);
    c.limitStore.set(undefined, undefined);
    await settle(c.begin(long));
    assert.equal(c.requests.length, 4, 'and with none set it runs');
  } finally {
    c.dispose();
  }
});

test('a message at its limit runs and one character over it does not', async () => {
  const c = chat();
  try {
    // 1,500 of history, 500 of summary and the one piece: 2,083.
    const input = (grounding = { once: [ACME] }) => question({ history: [turn('user', 1_500)], summary: 's'.repeat(500), grounding });
    const total = 1_500 + 500 + ACME_TEXT.length;

    c.limitStore.set(CHAT, total);
    await settle(c.begin(input()));
    assert.equal(c.requests.length, 2, 'at the limit');

    c.limitStore.set(CHAT, total - 1);
    const { code, message } = await refusal(c.begin(input()));
    assert.equal(code, 'context_limit', 'a character over');
    assert.match(message, /comes to 2,083 characters/);
    assert.match(message, /limited to 2,082/);
    assert.equal(c.requests.length, 2, 'and nothing more was asked');
  } finally {
    c.dispose();
  }
});

test('every part of a message counts toward its limit, each as the model is shown it', async () => {
  const c = chat();
  try {
    c.limitStore.set(CHAT, CONTEXT_FLOOR);

    // Each made to come to exactly `size` characters, so that the limit is met by that part alone.
    const parts: [string, (size: number) => Record<string, unknown>][] = [
      ['history', (size) => ({ history: [turn('user', size)] })],
      ['history of many turns', (size) => ({ history: [turn('user', size - 10), turn('assistant', 10)] })],
      ['summary with history', (size) => ({ summary: 's'.repeat(1_500), history: [turn('user', size - 1_500)] })],
      ['posting', (size) => ({ offerText: 'p'.repeat(size) })]
    ];

    for (const [name, make] of parts) {
      const before = c.requests.length;

      await settle(c.begin(question(make(CONTEXT_FLOOR))));
      assert.equal(c.requests.length, before + 2, `${name}: at the limit it is asked`);

      const { code, message } = await refusal(c.begin(question(make(CONTEXT_FLOOR + 1))));
      assert.equal(code, 'context_limit', `${name}: a character over`);
      assert.equal(c.requests.length, before + 2, `${name}: and no model is asked`);
      assert.match(message, /comes to 2,001 characters/, name);
    }
  } finally {
    c.dispose();
  }
});

test('the pieces count as they are sent, separators included', async () => {
  const c = chat({ body: cv([acmeOf(1_000), job('Globex', 'Engineer', 'Built the design system.')]) });
  try {
    const globexText = 'Experience, Engineer at Globex:\n2021 - present\n- Built the design system.';
    const both = 1_000 + 2 + globexText.length;

    c.limitStore.set(CHAT, CONTEXT_FLOOR);
    await settle(c.begin(question({ history: [turn('user', CONTEXT_FLOOR - both)], grounding: { once: [ACME, ref('experience/globex~engineer')] } })));
    assert.equal(c.requests.length, 2, 'at the limit, with the two blank lines counted once');

    const { message } = await refusal(c.begin(question({ history: [turn('user', CONTEXT_FLOOR - both + 1)], grounding: { once: [ACME, ref('experience/globex~engineer')] } })));
    assert.match(message, new RegExp(`pieces ${both.toLocaleString('en-US')}\\)`));
  } finally {
    c.dispose();
  }
});

test('a posting is counted as far as the model is shown it, and not as far as it was sent', async () => {
  const c = chat();
  try {
    // Longer than the model is shown of a posting, with nothing to cut it at: 40,000 and a mark.
    const posting = 'p'.repeat(50_000);

    c.limitStore.set(CHAT, 40_001);
    await settle(c.begin(question({ offerText: posting })));
    assert.equal(c.requests.length, 2, 'what is shown fits, though what was sent does not');

    c.limitStore.set(CHAT, 40_000);
    const { message } = await refusal(c.begin(question({ offerText: posting })));
    assert.match(message, /posting 40,001/);
    assert.equal(c.requests.length, 2);
  } finally {
    c.dispose();
  }
});

test('the history the runtime keeps counts, and a conversation that has grown past its limit is refused with no model asked', async () => {
  const c = chat();
  try {
    const said = (n: number) => `${n}`.repeat(900).slice(0, 900);
    for (const n of [1, 2, 3]) await c.turn(said(n));
    const asked = c.requests.length;
    assert.equal(asked, 6, 'three turns, each two model calls');

    c.limitStore.set(CHAT, CONTEXT_FLOOR);
    const run = c.begin(question({ question: said(4) }), 'ask_profile', { contextId: CONTEXT, conversationId: CHAT, runId: 'r4' });
    c.conversations.append(CHAT, { role: 'user', text: said(4) });

    const { code, message } = await refusal(run);
    assert.equal(code, 'context_limit');
    assert.match(message, /history 2,7\d\d/, 'what the conversation kept, which is what it supplied');
    assert.equal(c.requests.length, asked, 'no model was asked');

    c.limitStore.set(CHAT, 5_000);
    await settle(c.begin(question({ question: said(4) }), 'ask_profile', { contextId: CONTEXT, conversationId: CHAT, runId: 'r5' }));
    assert.equal(c.requests.length, asked + 2, 'raised, it runs');
  } finally {
    c.dispose();
  }
});

/* --------------------------------------------------------------- the pieces */

test('pieces over their own budget are refused before any model is asked, in the words they always had', async () => {
  const c = chat({ body: cv([acmeOf(PICKS_BUDGET + 518)]) });
  try {
    const attached = c.begin(question({ grounding: { once: [ACME] } }));
    const { code, message } = await refusal(attached);

    assert.equal(code, 'grounding_budget');
    assert.match(message, /12518 characters, and at most 12000 are sent/);
    assert.equal(message, 'The pieces chosen for this message come to 12518 characters, and at most 12000 are sent. Unpin or detach something, or choose entries instead of whole sections.');
    assert.deepEqual(c.requests, [], 'it used to be said after the model had been asked which tools to offer');

    c.pin(ACME);
    const pinned = await refusal(c.begin(question()));
    assert.equal(pinned.code, 'grounding_budget');
    assert.deepEqual(c.requests, [], 'a pin is measured too');
  } finally {
    c.dispose();
  }
});

test('the pieces\' own budget is said before a limit, and pieces at it are sent', async () => {
  const c = chat({ body: cv([acmeOf(PICKS_BUDGET)]) });
  try {
    c.limitStore.set(CHAT, CONTEXT_FLOOR);
    assert.equal((await refusal(c.begin(question({ grounding: { once: [ACME] } })))).code, 'context_limit', 'at their budget and over the limit');

    c.limitStore.set(CHAT, CONTEXT_CEILING);
    await settle(c.begin(question({ grounding: { once: [ACME] } })));
    assert.equal(c.requests.length, 2, 'at their budget and under the limit');
  } finally {
    c.dispose();
  }
});

test('an over-budget message that is also over its limit is refused for the budget, which no limit lifts', async () => {
  const c = chat({ body: cv([acmeOf(PICKS_BUDGET + 1)]) });
  try {
    c.limitStore.set(CHAT, CONTEXT_FLOOR);
    assert.equal((await refusal(c.begin(question({ grounding: { once: [ACME] } })))).code, 'grounding_budget');
  } finally {
    c.dispose();
  }
});

/* ---------------------------------------------------------------- by itself */

const hit = (revision: number, position: number, text: string, meta: Record<string, unknown>): ChunkHit => ({
  id: `c${position}`,
  documentId: CONTEXT,
  kind: 'highlight',
  text,
  position,
  meta,
  score: 1,
  sourceRevision: revision,
  found: ['lexical']
});

const found = (revision: number): ChunkHit[] => [
  hit(revision, 0, 'Rewrote the billing pipeline.', { section: 'experience', entry: 0, company: 'Acme', title: 'Senior Engineer' }),
  hit(revision, 1, 'Built the design system.', { section: 'experience', entry: 1, company: 'Globex', title: 'Engineer' }),
  hit(revision, 2, 'Backend engineer focused on billing systems.', { section: 'role_description' })
];

const GLOBEX_REF = ref('experience/globex~engineer');

test('auto adds pieces only while the message stays within its limit', async () => {
  const body = cv([acmeOf(1_000), { ...job('Globex', 'Engineer', ''), highlights: ['g'.repeat(1_000 - 'Experience, Engineer at Globex:\n2021 - present\n- '.length)] }]);
  const c = chat({ body, search: async (revision) => found(revision) });
  try {
    const sent = async (): Promise<string[]> => {
      const run = c.begin(question({ grounding: { auto: 'on' } }));
      const result = await settle(run);
      return (result.data.grounding as { included: string[] }).included;
    };

    assert.deepEqual(await sent(), [ACME, GLOBEX_REF, ROLE], 'with no limit all three');
    assert.equal(c.requests.at(-1)?.prompt.includes('Role description'), true);

    // 1,000 and 1,000 and their separator are 2,002, and the third would make 2,066.
    c.limitStore.set(CHAT, 2_050);
    assert.deepEqual(await sent(), [ACME, GLOBEX_REF], 'the third does not fit');

    // At the floor the second does not fit and the third, which is shorter, does.
    c.limitStore.set(CHAT, CONTEXT_FLOOR);
    assert.deepEqual(await sent(), [ACME, ROLE], 'what does not fit is passed over, and what does is added');

    const prompt = c.requests.at(-1)?.prompt ?? '';
    const picks = prompt.slice(prompt.indexOf('SELECTED CV PARTS — SOURCE DATA:\n') + 'SELECTED CV PARTS — SOURCE DATA:\n'.length);
    assert.ok(picks.length <= CONTEXT_FLOOR, `the pieces came to ${picks.length}`);
  } finally {
    c.dispose();
  }
});

test('auto leaves room for the rest of the message', async () => {
  const c = chat({ body: cv([acmeOf(1_000)]), search: async (revision) => found(revision).slice(0, 1) });
  try {
    c.limitStore.set(CHAT, CONTEXT_FLOOR);
    const added = async (history: number): Promise<string[]> => {
      const result = await settle(c.begin(question({ history: history === 0 ? [] : [turn('user', history)], grounding: { auto: 'on' } })));
      return (result.data.grounding as { included: string[] }).included;
    };

    assert.deepEqual(await added(1_000), [ACME], 'a thousand of each');
    assert.deepEqual(await added(1_001), [], 'a character more of the history and the piece is not added');
    assert.equal(c.requests.at(-1)?.prompt, QUESTION, 'and nothing of it is in the prompt');
  } finally {
    c.dispose();
  }
});

test('a suggestion is not a piece, and is not held to the limit', async () => {
  const c = chat({ body: cv([acmeOf(1_000)]), search: async (revision) => found(revision).slice(0, 1) });
  try {
    c.limitStore.set(CHAT, CONTEXT_FLOOR);
    const result = await settle(c.begin(question({ history: [turn('user', 1_500)], grounding: { auto: 'suggest' } })));

    assert.deepEqual((result.data.grounding as { suggested: string[] }).suggested, [ACME]);
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------- needs */

test('a message with nothing to answer from is told so, and not that it is too long', async () => {
  const c = chat();
  try {
    c.limitStore.set(CHAT, CONTEXT_FLOOR);
    const run = c.begin(question({ history: [turn('user', 3_000)], grounding: { reach: 'selected' } }));
    const { code, message } = await refusal(run);

    assert.equal(code, 'needs_unmet');
    assert.match(message, /^selection: Nothing is selected/);
    assert.deepEqual(c.requests, []);
  } finally {
    c.dispose();
  }
});

test('a need that has a code of its own fails the run with it, and says why and nothing else', () => {
  const capability = {
    name: 'probe',
    describe: 'test',
    input: askProfile.input,
    plan: () => ({ capability: 'probe', source: 'declared' as const, stages: [] }),
    needs: () => [
      { name: 'quiet', required: false, unmet: 'optional' },
      { name: 'budget', required: true, code: 'grounding_budget', unmet: 'Too many.' }
    ]
  };

  assert.throws(
    () => checkNeeds(capability as never, {}, {} as RunContext),
    (error: { code?: string; message?: string }) => error.code === 'grounding_budget' && error.message === 'Too many.'
  );

  const plain = { ...capability, needs: () => [{ name: 'selection', required: true, unmet: 'Nothing is selected.' }] };
  assert.throws(
    () => checkNeeds(plain as never, {}, {} as RunContext),
    (error: { code?: string; message?: string }) => error.code === 'needs_unmet' && error.message === 'selection: Nothing is selected.'
  );

  const met = { ...capability, needs: () => [{ name: 'budget', required: true, code: 'grounding_budget' }] };
  assert.deepEqual(checkNeeds(met as never, {}, {} as RunContext), [], 'a met need says nothing');
});

test('the pieces\' size and a limit are checked by the assembly too, for what changed since the plan', async () => {
  const c = chat({ body: cv([acmeOf(1_000)]) });
  try {
    const ports = bindCvScope(CONTEXT, { documents: c.s.deps.documents, retrieval: { search: async () => [] }, index: c.s.deps.index });
    const context = (limit: number | undefined) => ({
      ...ports,
      signal: new AbortController().signal,
      contextId: CONTEXT,
      ...(limit === undefined ? {} : { limits: { context: () => limit } })
    });
    const asked = { pins: [], once: [ACME], auto: 'off' as const, question: QUESTION, rest: { history: 1_001, summary: 0, posting: 0 } };

    await assert.rejects(assembleCv(asked, context(CONTEXT_FLOOR)), (error: { code?: string }) => error.code === 'context_limit');
    assert.equal((await assembleCv(asked, context(CONTEXT_FLOOR + 1))).entries.length, 1, 'a character more room');
    assert.equal((await assembleCv(asked, context(undefined))).entries.length, 1, 'no limit');
    assert.equal((await assembleCv({ ...asked, rest: undefined }, context(CONTEXT_FLOOR))).entries.length, 1, 'no rest, no limit');

    // The pieces' own budget holds whatever anyone has set, and the assembly says so itself.
    const wide = chat({ body: cv([acmeOf(PICKS_BUDGET + 1)]) });
    try {
      const over = bindCvScope(CONTEXT, { documents: wide.s.deps.documents, retrieval: { search: async () => [] }, index: wide.s.deps.index });
      await assert.rejects(
        assembleCv({ pins: [], once: [ACME], auto: 'off', question: QUESTION }, { ...over, signal: new AbortController().signal, contextId: CONTEXT }),
        (error: { code?: string }) => error.code === 'grounding_budget'
      );
    } finally {
      wide.dispose();
    }
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------- where */

test('every run that belongs to a conversation has the limit, a saved offer\'s too, and a run that does not has none', () => {
  const c = chat();
  try {
    c.limitStore.set(CHAT, 3_000);
    const fields = (conversationId?: string) => ({
      runId: 'r',
      traceId: 't',
      ...(conversationId === undefined ? {} : { conversationId }),
      contextId: CONTEXT,
      capability: 'ask_profile',
      input: {},
      signal: new AbortController().signal,
      deadlineAt: 0
    });
    const limitOf = (context: RunContext) => context.limits?.context();

    assert.equal(limitOf(buildRunContext(c.deps, fields(CHAT))), 3_000);
    assert.equal(buildRunContext(c.deps, fields(CHAT)).walls !== undefined, true, 'a profile conversation has walls as well');

    const offer = buildRunContext({ ...c.deps, offerId: 'an-offer' }, fields(CHAT));
    assert.equal(limitOf(offer), 3_000, 'a conversation about a saved offer is limited');
    assert.equal(offer.walls, undefined, 'though no exclusion names what it reads');

    assert.equal(buildRunContext(c.deps, fields()).limits, undefined, 'a run with no conversation has no limit to live under');
    const { limits, ...unlimited } = c.deps;
    void limits;
    assert.equal(buildRunContext(unlimited, fields(CHAT)).limits, undefined, 'a runtime that keeps none');

    c.limitStore.set(CHAT, 4_000);
    const context = buildRunContext(c.deps, fields(CHAT));
    c.limitStore.set(CHAT, 5_000);
    assert.equal(limitOf(context), 5_000, 'asked again at every message and not when the run was made');
  } finally {
    c.dispose();
  }
});
