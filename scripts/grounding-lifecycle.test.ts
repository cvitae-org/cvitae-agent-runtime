/**
 * What becomes of what a conversation chose and what it made, when the
 * conversation or its CV goes, and what an edit is made against.
 *
 * Choosing pieces, a limit, a selection and a record of what each answer was
 * given are all kept for as long as the conversation is, and not longer. One
 * assertion for each rule:
 *
 *   a conversation   its selection, its pins and its limit go with it, and nothing
 *                    of any other conversation's does
 *   its runs         the runs it made and the record of what each was given go with
 *                    it, once they have ended; a run still going stays, and so does
 *                    a run a CV proposal still points at, which is the person's to
 *                    accept or discard
 *   a copy of a CV   copies no selection, no pin and no limit, so a copy starts
 *                    with every piece of it in
 *   a cleared CV     leaves the pins on it where they are, and they say they are gone
 *   an edit          is made against the original CV, whatever a message was sent
 *                    shortened
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 19 were applied.
 *
 * what goes with a conversation:
 *   a conversation that is deleted leaves its runs             2
 *   a conversation that is deleted leaves its records          1
 *   a conversation that is deleted is deleted before its runs  0 (equivalent: in one transaction, and each statement matches on stored columns, not on the conversation)
 *   a conversation that is deleted takes the runs of every conversation 1
 *   a conversation that is deleted takes the records of every conversation 1
 *   a conversation that is deleted takes a run that is going   1
 *   a conversation that is deleted takes a run that failed     1
 *   a conversation that is deleted takes a run that was cancelled 1
 *   a conversation that is deleted takes a run that succeeded  3
 *   a conversation that is deleted takes a run a proposal points at 1
 *   a conversation that is deleted takes the record of a run that is going 1
 *   a conversation that is deleted fails when it has runs      1
 *   a conversation that is not there is deleted                1
 *   a conversation that is deleted is not deleted              3
 *   a run that is not kept may be attached to a chat           1
 *   a conversation that is deleted is not deleted as one       1
 *
 * a cleared CV, and an edit:
 *   a cleared CV takes the pins on it                          1
 *   a cleared CV takes the selection on it                     1
 *   an edit takes a grounding input                            1
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import { inputSchema } from '../src/capabilities/cv/edit.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { renderCompact } from '../src/capabilities/cv/compact.js';
import { scratch } from './support/db.js';
import { ACME, CHAT, CONTEXT, chat, cv, job as plainJob, ref, settle } from './support/chat.js';
import type { Chat } from './support/chat.js';

const count = (c: Chat, table: string, where = '', ...params: string[]): number =>
  (c.s.db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...params) as { n: number }).n;

const OTHER = 'other';

/** Two conversations of the same CV, each with something chosen, a limit, and runs that have a record. */
const busy = async (): Promise<Chat> => {
  const c = chat();
  c.s.db
    .prepare('INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
    .run(OTHER, 'profile', CONTEXT);

  for (const id of [CHAT, OTHER]) {
    const { revision } = c.selections.read(id);
    assert.ok(c.selections.change(id, { expectedRevision: revision, exclude: [ref('experience/nobody~nothing')], clear: [], pin: [ACME], unpin: [] }).applied);
    c.limitStore.set(id, 5_000);
  }

  // A turn in each, as a host does it: the question, the run, the answer.
  await c.turn('What did I do?', { grounding: { once: [ACME] } });
  await c.turn('And before that?');
  c.conversations.append(OTHER, { role: 'user', text: 'Hello.' });
  const run = c.begin({ question: 'Hello.', grounding: { once: [ACME] } }, 'ask_profile', { contextId: CONTEXT, conversationId: OTHER, runId: 'o1' });
  await settle(run);
  c.conversations.append(OTHER, { role: 'assistant', text: 'Hi.', runId: 'o1' });
  return c;
};

/* ------------------------------------------------------------ a conversation */

test('a conversation that is deleted takes its selection, its pins and its limit with it, and no other conversation\'s', async () => {
  const c = await busy();
  try {
    assert.ok(c.selections.read(CHAT).revision > 0 && c.limitStore.read(CHAT).conversation === 5_000, 'there was something');

    assert.equal(c.conversations.delete(CHAT), true);

    assert.deepEqual(c.selections.read(CHAT), { conversationId: CHAT, revision: 0, exclude: [], pin: [] }, 'nothing is left of what it left out or kept in');
    assert.equal(c.limitStore.read(CHAT).conversation, undefined);
    assert.equal(count(c, 'grounding_selection', 'WHERE conversation_id = ?', CHAT), 0);
    assert.equal(count(c, 'grounding_conversation_limit', 'WHERE conversation_id = ?', CHAT), 0);

    assert.equal(c.selections.read(OTHER).pin.length, 1, 'the other conversation keeps its pin');
    assert.equal(c.selections.read(OTHER).exclude.length, 1, 'and what it left out');
    assert.equal(c.limitStore.read(OTHER).conversation, 5_000, 'and its limit');
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------ its runs */

/** What is kept of the runs a conversation made, table by table. */
const tally = (c: Chat, conversationId: string): Record<string, number> => {
  const runs = '(SELECT id FROM runs WHERE conversation_id = ?)';
  return {
    runs: count(c, 'runs', 'WHERE conversation_id = ?', conversationId),
    run_steps: count(c, 'run_steps', `WHERE run_id IN ${runs}`, conversationId),
    events: count(c, 'events', `WHERE run_id IN ${runs}`, conversationId),
    grounding_record: count(c, 'grounding_record', `WHERE run_id IN ${runs}`, conversationId),
    grounding_entry: count(c, 'grounding_entry', `WHERE run_id IN ${runs}`, conversationId)
  };
};

test('a conversation that is deleted takes the runs it made and the record of what each was given, however each ended, and no other conversation\'s', async () => {
  const c = await busy();
  try {
    // One run of each way a run ends: r1 failed, r2 was cancelled, r3 succeeded.
    await c.turn('And after that?');
    c.s.db.prepare("UPDATE runs SET status = 'failed' WHERE id = 'r1'").run();
    c.s.db.prepare("UPDATE runs SET status = 'cancelled' WHERE id = 'r2'").run();
    assert.deepEqual(
      (c.s.db.prepare('SELECT id, status FROM runs WHERE conversation_id = ? ORDER BY id').all(CHAT) as { id: string; status: string }[]).map((row) => `${row.id} ${row.status}`),
      ['r1 failed', 'r2 cancelled', 'r3 succeeded']
    );

    const mine = tally(c, CHAT);
    const theirs = tally(c, OTHER);
    for (const table of ['runs', 'grounding_record', 'grounding_entry'])
      assert.ok(mine[table]! >= 2 && theirs[table]! >= 1, `${table} has something of each: ${JSON.stringify({ mine, theirs })}`);

    c.conversations.delete(CHAT);

    assert.deepEqual(
      tally(c, CHAT),
      { runs: 0, run_steps: 0, events: 0, grounding_record: 0, grounding_entry: 0 },
      'nothing of what it made is left'
    );
    assert.equal(count(c, 'grounding_record', 'WHERE conversation_id = ?', CHAT), 0, 'nor a record that names it');
    assert.deepEqual(tally(c, OTHER), theirs, 'what the other conversation made is as it was');

    // A run that went with its conversation is no more to be attached to another
    // chat than it was while its own was there, and says so, and not as a failure
    // of the store.
    assert.throws(() => c.conversations.append(OTHER, { role: 'assistant', text: 'late', runId: 'r1' }), { code: 'context_conflict' });
  } finally {
    c.dispose();
  }
});

test('a run that is still going is not taken with its conversation, and nor is a run a proposal points at, which is the person\'s to accept or discard', async () => {
  const c = await busy();
  try {
    c.s.db.prepare("UPDATE runs SET status = 'running' WHERE id = 'r1'").run();
    c.s.db
      .prepare(
        `INSERT INTO cv_proposals (id, context_id, base_revision, generation, document, status, created_at)
         VALUES ('r2', ?, 1, 0, '{}', 'pending', 1)`
      )
      .run(CONTEXT);

    assert.equal(c.conversations.delete(CHAT), true, 'the conversation goes all the same');
    assert.equal(c.conversations.read(CHAT), undefined);

    assert.deepEqual(
      (c.s.db.prepare("SELECT id FROM runs WHERE conversation_id = ? ORDER BY id").all(CHAT) as { id: string }[]).map((row) => row.id),
      ['r1', 'r2'],
      'the run that is going and the run that is proposed from'
    );
    assert.equal(count(c, 'cv_proposals', "WHERE id = 'r2'"), 1, 'the proposal is as it was');
    assert.equal(count(c, 'grounding_record', 'WHERE run_id = ?', 'r1'), 1, 'the record of the run that is going goes on being written');
    assert.equal(count(c, 'grounding_record', 'WHERE run_id = ?', 'r2'), 0, 'a record is a note about the chat, and not what a proposal needs');

    // Nothing else of the conversation was spared.
    assert.equal(count(c, 'runs', 'WHERE conversation_id = ?', CHAT), 2);
    assert.equal(c.selections.read(CHAT).pin.length, 0);
  } finally {
    c.dispose();
  }
});

test('a conversation whose runs cannot be deleted is not deleted, and keeps its records, its selection and its limit', async () => {
  const c = await busy();
  try {
    c.s.db.exec("CREATE TRIGGER no_run_goes BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT, 'no run goes'); END");
    const before = tally(c, CHAT);

    assert.throws(() => c.conversations.delete(CHAT), /no run goes/);

    assert.deepEqual(tally(c, CHAT), before, 'every run and every record is as it was');
    assert.notEqual(c.conversations.read(CHAT), undefined, 'and so is the conversation');
    assert.equal(c.selections.read(CHAT).pin.length, 1);
    assert.equal(c.limitStore.read(CHAT).conversation, 5_000);
  } finally {
    c.dispose();
  }
});

test('deleting a conversation that has made no run, or is not there, is as it always was', async () => {
  const c = chat();
  try {
    assert.equal(c.conversations.delete('nobody'), false);
    assert.equal(c.conversations.delete(CHAT), true, 'no runs to take');
    assert.equal(c.conversations.delete(CHAT), false, 'and only once');
    assert.equal(count(c, 'runs'), 0);
  } finally {
    c.dispose();
  }
});

/* -------------------------------------------------- a copy, and a cleared CV */

const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

type View = {
  revision: number;
  exclusions: { ref: string; state: string }[];
  pins: { ref: string; state: string }[];
};

const BODY = {
  personal: { name: 'Ada Lovelace', email: 'ada@example.com' },
  role_description: 'Engineer',
  experience: [{ company: 'Acme', title: 'Engineer', highlights: ['Built the thing'] }],
  education: [{ university: 'Oxford', degree: 'Maths' }]
};

const world = () => {
  const s = scratch();
  const source = createCvContextStore(s.db).create(randomUUID(), 'en');
  const harness = createHarness({
    databasePath: s.path,
    capabilities: {},
    logger: silentLogger,
    env: {},
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });
  harness.profile.replaceContext(source.id, BODY, 0);
  const conversation = harness.conversations.create({ kind: 'profile', id: source.id });
  const dispatch = createDispatch(harness);

  return {
    s,
    harness,
    source,
    conversation,
    dispatch,
    ref: (id: string, ...path: string[]) => `cv:${id}${path.map((segment) => `/${segment}`).join('')}`,
    dispose: () => {
      harness.close();
      s.dispose();
    }
  };
};

test('a copy of a CV copies no selection, no pin and no limit, and the source keeps all of them', async () => {
  const w = world();
  try {
    data(
      await w.dispatch('selection.update', {
        conversationId: w.conversation.id,
        expectedRevision: 0,
        exclude: [w.ref(w.source.id, 'education')],
        pin: [w.ref(w.source.id, 'experience', 'acme~engineer')]
      })
    );
    data(await w.dispatch('limits.set', { conversationId: w.conversation.id, context: 4_000 }));

    const copyId = randomUUID();
    const revision = w.harness.documents.read(w.source.id)?.revision ?? 0;
    data(await w.dispatch('profile.contexts.copy', { protocolVersion: 2, id: copyId, language: 'pl', sourceContextId: w.source.id, expectedSourceRevision: revision }));
    const there = w.harness.conversations.create({ kind: 'profile', id: copyId });

    const copy = data<View>(await w.dispatch('selection.get', { conversationId: there.id }));
    assert.deepEqual(copy, { revision: 0, exclusions: [], pins: [] }, 'nothing left out and nothing kept in');
    assert.equal(data<{ conversation: number | null }>(await w.dispatch('limits.get', { conversationId: there.id })).conversation, null, 'and no limit of its own');
    assert.equal(w.harness.selection.get(there.id)?.revision, 0);

    const source = data<View>(await w.dispatch('selection.get', { conversationId: w.conversation.id }));
    assert.equal(source.exclusions.length, 1, 'the source keeps what it left out');
    assert.equal(source.pins.length, 1, 'and what it kept in');
    assert.equal(data<{ conversation: number | null }>(await w.dispatch('limits.get', { conversationId: w.conversation.id })).conversation, 4_000);
  } finally {
    w.dispose();
  }
});

test('a CV that is cleared leaves the pins on it where they are, and each says that nothing carries its address any more', async () => {
  const w = world();
  try {
    data(
      await w.dispatch('selection.update', {
        conversationId: w.conversation.id,
        expectedRevision: 0,
        exclude: [w.ref(w.source.id, 'overview', 'personal')],
        pin: [w.ref(w.source.id, 'experience', 'acme~engineer'), w.ref(w.source.id, 'education', 'oxford~maths')]
      })
    );
    const before = data<View>(await w.dispatch('selection.get', { conversationId: w.conversation.id }));
    assert.deepEqual(before.pins.map((pin) => pin.state), ['live', 'live']);
    assert.ok(before.exclusions.length > 0, 'and something is left out');

    const revision = w.harness.documents.read(w.source.id)?.revision ?? 0;
    data(await w.dispatch('profile.context.clearContent', { contextId: w.source.id, expectedRevision: revision, operationId: 'clear-1' }));

    const after = data<View>(await w.dispatch('selection.get', { conversationId: w.conversation.id }));
    assert.deepEqual(
      after.pins.map((pin) => [pin.ref, pin.state]),
      before.pins.map((pin) => [pin.ref, 'gone']),
      'the same pins, in the same order, each of them gone'
    );
    assert.equal(after.revision, before.revision, 'and the selection is not touched by it');
    assert.deepEqual(after.exclusions, before.exclusions, 'what was left out is left out still');
  } finally {
    w.dispose();
  }
});

/* ------------------------------------------------------------------- an edit */

const SAID = (what: string): string => `${what}: ${'a piece of work that took a whole quarter, '.repeat(10)}`.trimEnd();

test('an edit is made against the original CV and shows the model every part of it, in a conversation whose messages were sent shortened', async () => {
  const alpha = { ...plainJob('Alpha', 'Senior Engineer', SAID('One')), highlights: [SAID('One'), SAID('Two'), SAID('Three'), SAID('Four')] };
  const jobs = [alpha, plainJob('Bravo', 'Engineer', 'b'.repeat(300))];
  const c = chat({
    body: cv(jobs),
    // The edit gives back what it was shown, which is no change at all if what it was shown is the CV.
    object: (request) => (request.step === 'experience' ? { experience: jobs } : { tools: ['search_profile', 'read_cv'] })
  });
  try {
    const refs = [ref('experience/alpha~senior-engineer'), ref('experience/bravo~engineer')];
    c.limitStore.set(CHAT, 2_000);

    // A message that does not fit as it is, sent shortened.
    const { data: answered } = await settle(c.begin({ question: 'What did I do?', grounding: { once: refs, overflow: 'compact' } }));
    assert.deepEqual((answered.grounding as { compacted?: string[] }).compacted, [refs[0]], 'it was shortened');
    assert.ok(renderCompact('experience', alpha) !== undefined, 'to a form of its own');

    const { data: made } = await settle(c.begin({ instruction: 'Keep it as it is.', target: ref('experience') }, 'edit_cv'));
    const shown = c.requests.map((each) => `${each.system}\n${each.prompt}`).filter((each) => each.includes(SAID('One')));
    const edit = shown.at(-1) ?? '';

    assert.ok(edit.includes(SAID('Four')), 'the model was shown the whole of the entry, the last highlight too');
    assert.ok(!edit.includes('shortened'), 'and nothing that says a part of it was left out');
    assert.deepEqual(made.changes, [], 'and what it gave back is no change from the original');
  } finally {
    c.dispose();
  }
});

test('an edit takes no instruction to shorten what it is shown: what it is shown is the same whether or not one is sent', async () => {
  assert.ok(!('grounding' in inputSchema.shape) && !('overflow' in inputSchema.shape), 'it has no such input');

  const jobs = [plainJob('Alpha', 'Senior Engineer', SAID('One'))];
  const c = chat({
    body: cv(jobs),
    object: (request) => (request.step === 'experience' ? { experience: jobs } : { tools: ['search_profile', 'read_cv'] })
  });
  try {
    const shown = async (extra: Record<string, unknown>): Promise<string> => {
      const before = c.requests.length;
      await settle(c.begin({ instruction: 'Keep it as it is.', target: ref('experience'), ...extra }, 'edit_cv'));
      return c.requests
        .slice(before)
        .map((each) => `${each.system}\n${each.prompt}`)
        .join('\n---\n');
    };

    const plain = await shown({});
    assert.ok(plain.includes(SAID('One')), 'it was shown the CV');
    assert.equal(await shown({ grounding: { overflow: 'compact', full: [ref('experience/alpha~senior-engineer')] } }), plain);
  } finally {
    c.dispose();
  }
});
