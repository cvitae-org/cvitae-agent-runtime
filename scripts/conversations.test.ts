/**
 * The transcript, over the channels a client actually calls.
 *
 * What a person asked about their own CV is not derivable from anything else in
 * the database — a run knows what it was told to do, not that somebody wanted
 * to know it — so this is the one table in the runtime whose contents are the
 * user's rather than the machinery's. Everything asserted here is about that
 * outliving the window it was typed into.
 *
 * Driven through `dispatch` rather than the store, because the store is not
 * what the client holds. A conversation that is correct in TypeScript and
 * unreachable over the wire is not persistence, it is a data structure.
 *
 * Confirmed by breaking things, each mutation run and reverted:
 *
 *   `open` creates unconditionally — reopening the app starts a blank page
 *     every time and the transcript from yesterday is somewhere with no way in.
 *   `create` resumes instead of creating — New chat hands back the conversation
 *     that is already on screen, so the second subject can never be started.
 *   `list` ignores the subject it was given — the profile's list shows every
 *     offer conversation in the database.
 *   `append` numbers from the whole table instead of per conversation — the
 *     two-subject test finds an offer's first message numbered 3, and a client
 *     that asked for "everything after 2" would silently skip it.
 *   `append` does not bump `updated_at` — the list stays in creation order, so
 *     a conversation someone is in the middle of sinks below one they abandoned
 *     last week.
 *   the messages table drops its cascade — the deleted conversation's rows
 *     survive it, and re-sending the same message collides with a row nothing
 *     can read any more.
 *   `rename` stores a blank title rather than clearing it — a conversation
 *     whose name was erased shows an empty line where the client's placeholder
 *     should be.
 *   the marker is trusted rather than clamped — two clients summarising at once
 *     leave it behind the note, and the turns in between are folded in twice
 *     and read as having been said twice.
 *   a blank note is stored as an empty string — a prompt goes on labelling and
 *     sending a heading with nothing under it.
 *   the marker is not read back from the row — every restart starts folding
 *     from turn one again, and the note is rewritten from turns it already
 *     covers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { createHarness, silentLogger, type Harness } from '../src/runtime/create.js';
import type { CapabilityMap, Conversation, Message } from '../src/contracts/index.js';
import { noop, stage, transform } from './support/spine.js';

/* ------------------------------------------------------------------- setup */

/** One capability, so a message has a real run to point at. */
const answers: CapabilityMap = {
  answer: noop('answer', [
    stage('only', [transform('reply', async () => ({ answer: 'Distributed systems.' }))])
  ])
};

type Bench = {
  readonly harness: Harness;
  readonly dispatch: ReturnType<typeof createDispatch>;
  /** Closes this runtime and opens another over the same file. */
  restart(): Bench;
  dispose(): void;
};

const bench = (on?: string): Bench => {
  const dir = on ?? mkdtempSync(join(tmpdir(), 'harness-conversations-'));

  // A clock that always moves. Two conversations touched inside the same
  // millisecond tie on `updated_at`, and a test that asserts an order the data
  // does not determine passes or fails on how fast the machine is.
  let tick = Date.now();

  const harness = createHarness({
    databasePath: join(dir, 'harness.db'),
    capabilities: answers,
    logger: silentLogger,
    env: {},
    probe: () => Promise.reject(new Error('no local server in these tests')),
    now: () => tick++
  });

  return {
    harness,
    dispatch: createDispatch(harness),
    restart() {
      harness.close();
      return bench(dir);
    },
    dispose() {
      try {
        harness.close();
      } catch {
        // Already closed by `restart`. Closing twice is not a failure.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const error = (response: Response): { code: string; message: string } => {
  assert.ok(!response.ok, `expected a failure, got ${JSON.stringify(response)}`);
  return response.error;
};

const profile = { kind: 'profile', id: '' } as const;

const opened = async (it: Bench, subject: unknown): Promise<Conversation> =>
  data<{ conversation: Conversation }>(await it.dispatch('conversations.open', { subject }))
    .conversation;

const started = async (it: Bench, subject: unknown): Promise<Conversation> =>
  data<{ conversation: Conversation }>(
    await it.dispatch('conversations.create', { subject })
  ).conversation;

const listed = async (it: Bench, subject?: unknown): Promise<Conversation[]> =>
  data<{ conversations: Conversation[] }>(
    await it.dispatch('conversations.list', subject ? { subject } : {})
  ).conversations;

const said = async (
  it: Bench,
  conversationId: string,
  role: 'user' | 'assistant',
  text: string,
  id?: string
): Promise<Message> =>
  data<{ message: Message }>(
    await it.dispatch('conversations.append', {
      conversationId,
      message: { role, text, ...(id ? { id } : {}) }
    })
  ).message;

/* ------------------------------------------------------------------- tests */

test('opening a subject resumes; starting one is a separate ask', async () => {
  const it = bench();

  try {
    const first = await opened(it, profile);
    const again = await opened(it, { kind: 'profile' });

    // Resuming, which is what a window restoring itself needs. An `open` that
    // started a fresh page would lose yesterday's transcript on every launch.
    assert.equal(again.id, first.id);
    assert.equal(again.subject.kind, 'profile');
    assert.equal(again.subject.id, '');

    // And starting one is the other button. Rewriting a summary and working out
    // what to say about a gap are both about this CV and are not one thread.
    const second = await started(it, profile);
    assert.notEqual(second.id, first.id);
    assert.equal(second.messageCount, 0);

    // Which the next open resumes, because it is the most recent.
    assert.equal((await opened(it, profile)).id, second.id);

    // An offer's conversations are its own, and the empty id is not a wildcard
    // that collides with the profile's.
    const offer = await opened(it, { kind: 'offer', id: 'offer-1' });
    assert.notEqual(offer.id, first.id);

    // Explicit profile subjects must name a registered context.
    assert.equal(
      error(await it.dispatch('conversations.open', {
        subject: { kind: 'profile', id: 'sneaky' }
      })).code,
      'context_not_found'
    );
    assert.equal(
      error(await it.dispatch('conversations.open', { subject: { kind: 'offer' } })).code,
      'invalid_input'
    );
    assert.equal(
      error(await it.dispatch('conversations.create', {
        subject: { kind: 'profile', id: 'sneaky' }
      })).code,
      'context_not_found'
    );

    assert.equal((await listed(it)).length, 3);
  } finally {
    it.dispose();
  }
});

test('a list can be narrowed to the subject someone is looking at', async () => {
  const it = bench();

  try {
    const mine = await opened(it, profile);
    const alsoMine = await started(it, profile);
    const theirs = await opened(it, { kind: 'offer', id: 'offer-1' });
    await started(it, { kind: 'offer', id: 'offer-2' });

    // The panel showing the profile's chats is asking about the profile. An
    // unfiltered list would put every offer someone has ever looked at in it,
    // and the filter is the reason 0007 kept an index it stopped using for
    // uniqueness.
    assert.deepEqual(
      (await listed(it, profile)).map((conversation) => conversation.id),
      [alsoMine.id, mine.id]
    );

    // One offer's conversations are not another's, even though both are offers.
    assert.deepEqual(
      (await listed(it, { kind: 'offer', id: 'offer-1' })).map(
        (conversation) => conversation.id
      ),
      [theirs.id]
    );

    // Still ordered by activity within the subject: a message on the older one
    // brings it back to the top of its own list.
    await said(it, mine.id, 'user', 'Back to me.');
    assert.deepEqual(
      (await listed(it, profile)).map((conversation) => conversation.id),
      [mine.id, alsoMine.id]
    );

    assert.equal((await listed(it)).length, 4);
  } finally {
    it.dispose();
  }
});

test('messages are numbered per conversation, from one, without gaps', async () => {
  const it = bench();

  try {
    const mine = await opened(it, profile);
    const theirs = await opened(it, { kind: 'offer', id: 'offer-1' });

    await said(it, mine.id, 'user', 'What am I good at?');
    await said(it, mine.id, 'assistant', 'Distributed systems, mostly.');
    const third = await said(it, mine.id, 'user', 'And what am I not?');

    assert.equal(third.seq, 3);

    // The other conversation starts at one. `seq` answers "have I seen
    // everything in *this* transcript", and a number shared across transcripts
    // answers a question nobody asked.
    const other = await said(it, theirs.id, 'user', 'Is this worth applying for?');
    assert.equal(other.seq, 1);

    const read = data<{ conversation: Conversation; messages: Message[] }>(
      await it.dispatch('conversations.get', { conversationId: mine.id })
    );

    assert.deepEqual(read.messages.map((message) => message.seq), [1, 2, 3]);
    assert.deepEqual(read.messages.map((message) => message.role), [
      'user',
      'assistant',
      'user'
    ]);
    assert.equal(read.conversation.messageCount, 3);
  } finally {
    it.dispose();
  }
});

test('a transcript is still there after the process that wrote it has gone', async () => {
  let it = bench();

  try {
    const conversation = await opened(it, profile);
    await said(it, conversation.id, 'user', 'Remember this.');
    await said(it, conversation.id, 'assistant', 'It is written down.');

    it = it.restart();

    // Same subject, same conversation, same words. This is the whole feature:
    // the second day is worth as much as the first.
    const reopened = await opened(it, profile);
    assert.equal(reopened.id, conversation.id);

    const read = data<{ messages: Message[] }>(
      await it.dispatch('conversations.get', { conversationId: reopened.id })
    );
    assert.deepEqual(read.messages.map((message) => message.text), [
      'Remember this.',
      'It is written down.'
    ]);
  } finally {
    it.dispose();
  }
});

test('the list is ordered by what someone is actually doing', async () => {
  const it = bench();

  try {
    const first = await opened(it, profile);
    const second = await opened(it, { kind: 'offer', id: 'offer-1' });

    // Opened second, so it leads. Then the older one gets a message and takes
    // the top — a conversation someone is in the middle of should not sink
    // below one they abandoned.
    assert.deepEqual(
      (await listed(it)).map((conversation) => conversation.id),
      [second.id, first.id]
    );

    await said(it, first.id, 'user', 'Back to me.');

    const now = await listed(it);

    assert.deepEqual(now.map((conversation) => conversation.id), [first.id, second.id]);
    assert.deepEqual(now.map((conversation) => conversation.messageCount), [1, 0]);
  } finally {
    it.dispose();
  }
});

test('deleting a conversation takes its messages with it', async () => {
  const it = bench();

  try {
    const conversation = await opened(it, profile);
    await said(it, conversation.id, 'user', 'Forget this.', 'message-1');

    assert.deepEqual(
      data(await it.dispatch('conversations.delete', { conversationId: conversation.id })),
      { deleted: true }
    );

    assert.equal(
      error(await it.dispatch('conversations.get', { conversationId: conversation.id })).code,
      'not_found'
    );

    // Appending to something that is gone is a reason, not a constraint name.
    // A client that deleted a conversation and then finished a run in it should
    // read "there is no such conversation", not a foreign key violation.
    assert.equal(
      error(
        await it.dispatch('conversations.append', {
          conversationId: conversation.id,
          message: { role: 'assistant', text: 'Too late.' }
        })
      ).code,
      'not_found'
    );

    // Reopening and re-sending the same message id proves the old rows really
    // went: message ids are unique across the table, so a surviving orphan
    // would collide here.
    const fresh = await opened(it, profile);
    assert.notEqual(fresh.id, conversation.id);
    const message = await said(it, fresh.id, 'user', 'Starting over.', 'message-1');
    assert.equal(message.seq, 1);

    assert.deepEqual(
      data(await it.dispatch('conversations.delete', { conversationId: 'never-existed' })),
      { deleted: false }
    );
  } finally {
    it.dispose();
  }
});

test('a message can name the run it came from, and a title can be taken back', async () => {
  const it = bench();

  try {
    const conversation = await opened(it, profile);

    assert.equal(conversation.title, undefined);

    const named = data<{ conversation: Conversation }>(
      await it.dispatch('conversations.rename', {
        conversationId: conversation.id,
        title: '  Career questions  '
      })
    ).conversation;
    assert.equal(named.title, 'Career questions');

    // Blank clears it rather than storing an empty string, so the client falls
    // back to its own localised placeholder instead of rendering a blank line
    // where a name goes.
    assert.equal(
      data<{ conversation: Conversation }>(
        await it.dispatch('conversations.rename', {
          conversationId: conversation.id,
          title: '   '
        })
      ).conversation.title,
      undefined
    );

    assert.equal(
      error(await it.dispatch('conversations.rename', {
        conversationId: 'never-existed',
        title: 'x'
      })).code,
      'not_found'
    );
  } finally {
    it.dispose();
  }
});

test('an answer points back at the run that produced it', async () => {
  const it = bench();

  try {
    const conversation = await opened(it, profile);
    await said(it, conversation.id, 'user', 'What am I good at?');

    const { runId } = data<{ runId: string }>(
      await it.dispatch('run.start', { capability: 'answer', input: {} })
    );
    const outcome = data<{ data: { answer: string } }>(
      await it.dispatch('run.await', { runId })
    );

    data(await it.dispatch('conversations.append', {
      conversationId: conversation.id,
      message: { role: 'assistant', text: outcome.data.answer, runId }
    }));

    // The text of the answer is here because it is what a person reads. Its
    // steps, its degradations and its cost are not copied — they are in the
    // run, and this link is how a reloaded transcript finds them.
    const read = data<{ messages: Message[] }>(
      await it.dispatch('conversations.get', { conversationId: conversation.id })
    );

    assert.deepEqual(read.messages.map((message) => message.runId), [undefined, runId]);
    assert.equal(read.messages[1]?.text, 'Distributed systems.');

    // And a link to a run that is not there is refused by name. The column has
    // a foreign key behind it, which on its own answers "FOREIGN KEY constraint
    // failed" — true, and no help at all to a client holding two ids and no way
    // to tell which one the database did not recognise.
    const orphan = error(
      await it.dispatch('conversations.append', {
        conversationId: conversation.id,
        message: { role: 'assistant', text: 'From nowhere.', runId: 'never-ran' }
      })
    );
    assert.equal(orphan.code, 'not_found');
    assert.match(orphan.message, /never-ran/);
  } finally {
    it.dispose();
  }
});

/* --------------------------------------------------------------- the note */

const noted = async (
  it: Bench,
  conversationId: string,
  summary: string,
  through: number
): Promise<Conversation> =>
  data<{ conversation: Conversation }>(
    await it.dispatch('conversations.summarise', { conversationId, summary, through })
  ).conversation;

test('a conversation nothing has folded carries no note and no marker', async () => {
  const it = bench();

  try {
    const conversation = await opened(it, profile);

    // Not NULL and not absent: every use of the marker is a comparison against
    // a message's `seq`, and NULL compares false to all of them.
    assert.equal(conversation.summarisedThrough, 0);
    assert.equal(conversation.summary, undefined);
  } finally {
    it.dispose();
  }
});

test('a note outlives the process that wrote it', async () => {
  let it = bench();

  try {
    const conversation = await opened(it, profile);
    await said(it, conversation.id, 'user', 'What did I do at Acme?');
    await said(it, conversation.id, 'assistant', 'You rewrote the billing pipeline.');
    await noted(it, conversation.id, 'GOAL: position for a backend role.', 2);

    it = it.restart();

    // The whole reason it is a column. A note held in a client is a note that
    // is gone at the next launch, which is exactly when the transcript it
    // stands in for is longest.
    const [back] = await listed(it, profile);
    assert.equal(back?.summary, 'GOAL: position for a backend role.');
    assert.equal(back?.summarisedThrough, 2);
  } finally {
    it.dispose();
  }
});

test('the marker never moves backwards', async () => {
  const it = bench();

  try {
    const conversation = await opened(it, profile);
    await noted(it, conversation.id, 'GOAL: a backend role.', 6);

    // Two clients summarising at once, the slower one having read the marker
    // before the faster one moved it. Left at 2, the four turns in between
    // would be folded in a second time and read as having been said twice.
    const raced = await noted(it, conversation.id, 'GOAL: a backend role.', 2);

    assert.equal(raced.summarisedThrough, 6);
  } finally {
    it.dispose();
  }
});

test('a note trimmed to nothing is no note, not an empty one', async () => {
  const it = bench();

  try {
    const conversation = await opened(it, profile);
    await noted(it, conversation.id, 'GOAL: a backend role.', 2);

    // Same rule as `rename`, for the same reason one layer on: an empty string
    // is something a prompt would go on labelling and sending, and a heading
    // with nothing under it is worse than no heading.
    const cleared = await noted(it, conversation.id, '   ', 2);

    assert.equal(cleared.summary, undefined);
  } finally {
    it.dispose();
  }
});

test('a note for a conversation that is not there is a miss, not a write', async () => {
  const it = bench();

  try {
    assert.equal(
      error(
        await it.dispatch('conversations.summarise', {
          conversationId: 'no-such-conversation',
          summary: 'GOAL: something.',
          through: 2
        })
      ).code,
      'not_found'
    );
  } finally {
    it.dispose();
  }
});
