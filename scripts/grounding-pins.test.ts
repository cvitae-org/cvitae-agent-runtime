/**
 * What a conversation keeps in every message, and how it is asked to.
 *
 * An exclusion says what a conversation will not be shown (`grounding-selection`).
 * A pin says the opposite: a piece of the CV the person wants in front of the model
 * with every message, until they say otherwise. It is stored in the conversation
 * beside the exclusions and moves the same revision, so two windows cannot each
 * pin something over the other's change.
 *
 * What is pinned is a piece of the CV the conversation is about, by its address. It
 * is not a copy of the piece: what a message sends is read when the message is run
 * (`grounding-assembly`), so an edit to the CV shows in the next one and the pin
 * does not move.
 *
 * The questions, in order:
 *
 *   keeping      pins are the conversation's, in the order they were made, once
 *                each, and still there after a restart and after the other changes
 *   what may be  only a section or an entry of the conversation's own CV, in a
 *   pinned       profile conversation, with no version and no digest
 *   what it says a pin an exclusion covers is `blocked`, whatever else is true of
 *                it; one nothing carries is `gone`; the exclusion wins and nothing
 *                is lost, so lifting it makes the pin live again
 *   how much     at most `MAX_PINS`, and a change that goes over writes nothing
 *   how long     a pin lives and dies with its conversation
 *   the wire     the channel takes `pin` and `unpin` and nothing else new, the
 *                conflict carries the pins, and the feature is announced
 *   the schema   the table is new, and what a database had before it is unchanged
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 48 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * keeping:
 *   a read says nothing is pinned                  13
 *   pins are read newest first                     4
 *   pins are read in no order                      4
 *   pins are counted from the start                3
 *   a pin takes the last place's number            3
 *   a pin made twice is refused by the table       2
 *   a pin made twice is a change                   1
 *   a pin is not a change                          10
 *   a pin is not kept                              14
 *   an unpin is not a change                       2
 *   an unpin takes nothing away                    4
 *   an unpin of anything is a change               2
 *   an unpin takes the piece from every conversation 1
 *   a conversation is read with every conversation's pins 1
 *
 * how much:
 *   pins are not limited                           2
 *   one pin short of the limit is refused          1
 *   one pin over the limit is allowed              1
 *
 * what a run reads:
 *   the pins a run reads are every conversation's  1
 *   a conversation's pins are not its walls        1
 *
 * how long:
 *   a pin outlives its conversation                1
 *   a piece can be pinned by two rows              2
 *   a pin may have no conversation                 1
 *
 * what may be pinned:
 *   a pin may name a version                       1
 *   a pin may name a digest                        1
 *   a pin may name a well that is not known        1
 *   a discovery conversation may pin               1
 *   a profile conversation may pin an offer        1
 *   a pin may be of another CV                     1
 *   a pin may be of the whole CV                   1
 *   a pin is kept as it was spelled                2
 *   a pin request pins nothing                     16
 *   an unpin request unpins nothing                5
 *   an unpin is looked for as it was spelled       1
 *
 * what it says:
 *   a pin is never gone                            1
 *   a pin is never blocked                         3
 *   a pin that is gone is blocked by an exclusion of its address only 2
 *   a view has no pins                             12
 *
 * the wire:
 *   a request cannot pin                           16
 *   a request cannot unpin                         8
 *   a request may pin fifty-one at once            1
 *   a request may pin forty-nine at most           1
 *   a request may unpin without a limit            1
 *   a pin is not passed on                         16
 *   an unpin is not passed on                      5
 *   a conflict does not carry the pins             1
 *   a conflict carries the exclusions as the pins  1
 *   assembly is not announced                      1
 *   assembly is announced twice                    1
 *
 * Two more were tried and are not in the table, because nothing a reader of the
 * selection can see changes: a pin numbered from the largest number in any
 * conversation (the number only orders one conversation's own, and still goes up),
 * and the revision written before the limit is checked (a refused change is rolled
 * back whole either way).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { MAX_PINS } from '../src/contracts/index.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import { createConversationStore } from '../src/storage/sqlite/conversations.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createSelectionStore } from '../src/storage/sqlite/grounding-selection.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { open } from '../src/storage/sqlite/open.js';
import { scratch } from './support/db.js';

/* ---------------------------------------------------------------- fixtures */

type View = {
  revision: number;
  exclusions: { ref: string; state: 'live' | 'gone' }[];
  pins: { ref: string; state: 'live' | 'gone' | 'blocked' }[];
};

const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const refused = (response: Response) => {
  assert.ok(!response.ok, `expected a refusal, got ${JSON.stringify(response)}`);
  return response.error;
};

const BODY = {
  personal: { name: 'Ada Lovelace', email: 'ada@example.com' },
  role_description: 'Engineer',
  experience: [
    { company: 'Acme', title: 'Engineer', highlights: ['Built the thing'] },
    { company: 'Globex', title: 'Lead', highlights: ['Led the other thing'] }
  ],
  education: [{ university: 'Oxford', degree: 'Maths' }]
};

const world = () => {
  const s = scratch();
  const cv = createCvContextStore(s.db).create(randomUUID(), 'en');
  const start = () =>
    createHarness({
      databasePath: s.path,
      capabilities: {},
      logger: silentLogger,
      env: {},
      probe: () => Promise.reject(new Error('no local server in these tests'))
    });

  let harness = start();
  harness.profile.replaceContext(cv.id, BODY, 0);

  const chat = harness.conversations.create({ kind: 'profile', id: cv.id });
  let dispatch = createDispatch(harness);

  const w = {
    cv,
    chat,
    s,
    get harness() {
      return harness;
    },
    get dispatch() {
      return dispatch;
    },
    ref: (...path: string[]) => `cv:${cv.id}${path.map((segment) => `/${segment}`).join('')}`,
    get: async (conversationId = chat.id) => data<View>(await dispatch('selection.get', { conversationId })),
    update: (
      change: { expectedRevision: number; exclude?: string[]; clear?: string[]; pin?: string[]; unpin?: string[] },
      conversationId = chat.id
    ) => dispatch('selection.update', { conversationId, ...change }),
    restart() {
      harness.close();
      harness = start();
      dispatch = createDispatch(harness);
    },
    dispose() {
      harness.close();
      s.dispose();
    }
  };

  return w;
};

const ACME = 'acme~engineer';
const GLOBEX = 'globex~lead';

/* ----------------------------------------------------------------- keeping */

test('pins are kept in the order they were made, once each, and after a restart', async () => {
  const w = world();

  try {
    const first = data<View>(
      await w.update({ expectedRevision: 0, pin: [w.ref('experience', GLOBEX), w.ref('overview', 'role_description')] })
    );
    assert.deepEqual(first, {
      revision: 1,
      exclusions: [],
      pins: [
        { ref: w.ref('experience', GLOBEX), state: 'live' },
        { ref: w.ref('overview', 'role_description'), state: 'live' }
      ]
    });

    // Pinned again, and with one more: the old one keeps its place and is not doubled.
    const second = data<View>(
      await w.update({ expectedRevision: 1, pin: [w.ref('experience', GLOBEX), w.ref('education')] })
    );
    assert.deepEqual(
      second.pins.map((pin) => pin.ref),
      [w.ref('experience', GLOBEX), w.ref('overview', 'role_description'), w.ref('education')]
    );
    assert.equal(second.revision, 2);

    w.restart();
    assert.deepEqual(await w.get(), second, 'what was answered is what is stored, in a process that opens the file again');
  } finally {
    w.dispose();
  }
});

test('a pin that is not new, and an unpin of what is not pinned, change nothing and do not move the revision', async () => {
  const w = world();

  try {
    data(await w.update({ expectedRevision: 0, pin: [w.ref('education')] }));
    const same = data<View>(await w.update({ expectedRevision: 1, pin: [w.ref('education')], unpin: [w.ref('languages')] }));
    assert.equal(same.revision, 1);
    assert.equal(same.pins.length, 1);
  } finally {
    w.dispose();
  }
});

test('unpinning removes the pin, and one that is pinned again goes last', async () => {
  const w = world();

  try {
    data(await w.update({ expectedRevision: 0, pin: [w.ref('education'), w.ref('languages')] }));
    const removed = data<View>(await w.update({ expectedRevision: 1, unpin: [w.ref('education')] }));
    assert.deepEqual(removed.pins.map((pin) => pin.ref), [w.ref('languages')]);

    const again = data<View>(await w.update({ expectedRevision: 2, pin: [w.ref('education')] }));
    assert.deepEqual(again.pins.map((pin) => pin.ref), [w.ref('languages'), w.ref('education')]);

    // One request that unpins and pins the same piece leaves it pinned, last.
    const moved = data<View>(await w.update({ expectedRevision: 3, unpin: [w.ref('languages')], pin: [w.ref('languages')] }));
    assert.deepEqual(moved.pins.map((pin) => pin.ref), [w.ref('education'), w.ref('languages')]);
  } finally {
    w.dispose();
  }
});

test('pins and exclusions are two lists that share one revision, and neither changes the other', async () => {
  const w = world();

  try {
    data(await w.update({ expectedRevision: 0, pin: [w.ref('education')] }));
    const both = data<View>(await w.update({ expectedRevision: 1, exclude: [w.ref('languages')], pin: [w.ref('certificates')] }));
    assert.equal(both.revision, 2, 'one change is one revision');
    assert.deepEqual(both.exclusions.map((each) => each.ref), [w.ref('languages')]);
    assert.deepEqual(both.pins.map((each) => each.ref), [w.ref('education'), w.ref('certificates')]);

    const cleared = data<View>(await w.update({ expectedRevision: 2, clear: [w.ref('languages')] }));
    assert.deepEqual(cleared.pins.map((each) => each.ref), [w.ref('education'), w.ref('certificates')], 'clearing an exclusion kept the pins');

    const unpinned = data<View>(await w.update({ expectedRevision: 3, unpin: [w.ref('education')], exclude: [w.ref('languages')] }));
    assert.deepEqual(unpinned.exclusions.map((each) => each.ref), [w.ref('languages')], 'unpinning kept the exclusions');
  } finally {
    w.dispose();
  }
});

test('the pins of one conversation are not the pins of another', async () => {
  const w = world();

  try {
    const other = w.harness.conversations.create({ kind: 'profile', id: w.cv.id });
    data(await w.update({ expectedRevision: 0, pin: [w.ref('education')] }));

    assert.deepEqual(await w.get(other.id), { revision: 0, exclusions: [], pins: [] });
    assert.deepEqual(
      createSelectionStore(w.s.db).pins(w.chat.id).map((pin) => pin.path.join('/')),
      ['education']
    );
    assert.deepEqual(createSelectionStore(w.s.db).pins(other.id), []);

    // The same piece pinned in both is two pins, and taking one back leaves the other.
    data(await w.update({ expectedRevision: 0, pin: [w.ref('education')] }, other.id));
    data(await w.update({ expectedRevision: 1, unpin: [w.ref('education')] }));
    assert.deepEqual((await w.get()).pins, []);
    assert.deepEqual((await w.get(other.id)).pins.map((pin) => pin.ref), [w.ref('education')]);

    // A pin is not a wall: nothing is held back for it, in either conversation.
    assert.deepEqual(createSelectionStore(w.s.db).walls(other.id), []);
  } finally {
    w.dispose();
  }
});

/* ------------------------------------------------------- what may be pinned */

test('a pin names a section or an entry of this conversation\'s own CV, and nothing else', async () => {
  const w = world();

  try {
    const cases: [string, string, string][] = [
      ['the whole CV', w.ref(), 'invalid_selection'],
      ['another CV', 'cv:elsewhere/experience', 'invalid_selection'],
      ['an offer', 'offers:offer-1', 'invalid_selection'],
      ['a piece of an offer', 'offers:offer-1/requirements', 'invalid_selection'],
      ['a well nobody knows', 'tickets:one/open', 'unknown_well'],
      ['a section no CV has', w.ref('hobbies'), 'invalid_selection'],
      ['an overview item no CV has', w.ref('overview', 'mood'), 'invalid_selection'],
      ['a version of a piece', `cv:${w.cv.id}@3/education`, 'invalid_selection'],
      ['a digest of a piece', `${w.ref('education')}#0123456789abcdef`, 'invalid_selection'],
      ['an address spelled another way', `${w.ref('experience')}/globex%7Elead`, 'invalid_ref']
    ];

    for (const [name, ref, code] of cases) {
      const error = refused(await w.update({ expectedRevision: 0, pin: [ref] }));
      assert.equal(error.code, code, name);
    }

    assert.deepEqual(await w.get(), { revision: 0, exclusions: [], pins: [] }, 'a refused pin was written');

    // One bad ref in a request writes none of the good ones.
    refused(await w.update({ expectedRevision: 0, pin: [w.ref('education'), w.ref()] }));
    assert.deepEqual((await w.get()).pins, []);

    // Taking a pin back is looked for under the same spelling a pin is kept in.
    const spelled = refused(await w.update({ expectedRevision: 0, unpin: [`${w.ref('experience')}/globex%7Elead`] }));
    assert.equal(spelled.code, 'invalid_ref');
  } finally {
    w.dispose();
  }
});

test('only a profile conversation pins, and the refusal says so', async () => {
  const w = world();

  try {
    const offerChat = w.harness.conversations.open({ kind: 'offer', id: 'offer-1' });
    const error = refused(await w.update({ expectedRevision: 0, pin: [w.ref('education')] }, offerChat.id));
    assert.equal(error.code, 'invalid_selection');
    assert.match(error.message, /profile conversation/);
  } finally {
    w.dispose();
  }
});

test('a pin may be taken back whatever it names, so one that can no longer be made can still be removed', async () => {
  const w = world();

  try {
    data(await w.update({ expectedRevision: 0, pin: [w.ref('education')] }));
    // Straight into the store, as a row from an older runtime would be.
    const store = createSelectionStore(w.s.db);
    store.change(w.chat.id, { expectedRevision: 1, exclude: [], clear: [], pin: ['cv:elsewhere/experience/x'] });
    assert.equal((await w.get()).pins.length, 2);

    const view = data<View>(await w.update({ expectedRevision: 2, unpin: ['cv:elsewhere/experience/x'] }));
    assert.deepEqual(view.pins.map((pin) => pin.ref), [w.ref('education')]);
  } finally {
    w.dispose();
  }
});

/* -------------------------------------------------------------- what it says */

test('a pin is live while its piece is there, and gone once nothing carries its address', async () => {
  const w = world();

  try {
    data(
      await w.update({
        expectedRevision: 0,
        pin: [w.ref('experience', ACME), w.ref('experience', 'nobody~nothing'), w.ref('overview', 'skills'), w.ref('languages')]
      })
    );

    const view = await w.get();
    assert.deepEqual(
      view.pins.map((pin) => [pin.ref.replace(`cv:${w.cv.id}/`, ''), pin.state]),
      [
        [`experience/${ACME}`, 'live'],
        ['experience/nobody~nothing', 'gone'],
        ['overview/skills', 'live'],
        ['languages', 'live']
      ]
    );

    // Renamed: the entry has a new key, and the pin on the old one names nothing.
    w.harness.profile.replaceContext(
      w.cv.id,
      { ...BODY, experience: [{ ...BODY.experience[0]!, company: 'Initech' }, BODY.experience[1]!] },
      (w.harness.documents.read(w.cv.id)?.revision ?? 0)
    );
    const renamed = await w.get();
    assert.equal(renamed.pins.find((pin) => pin.ref.endsWith(`/${ACME}`))?.state, 'gone');
  } finally {
    w.dispose();
  }
});

test('an exclusion that covers a pin makes it blocked, not gone and not lost, and lifting it makes the pin live again', async () => {
  const w = world();

  try {
    data(await w.update({ expectedRevision: 0, pin: [w.ref('experience', GLOBEX), w.ref('education')] }));

    // The piece itself, then a section above it, then the whole CV.
    for (const [exclude, blocked] of [
      [w.ref('experience', GLOBEX), [GLOBEX]],
      [w.ref('experience'), [GLOBEX]],
      [w.ref(), [GLOBEX, 'education']]
    ] as [string, string[]][]) {
      const before = await w.get();
      const on = data<View>(await w.update({ expectedRevision: before.revision, exclude: [exclude] }));
      const states = Object.fromEntries(on.pins.map((pin) => [pin.ref.split('/').slice(-1)[0], pin.state]));
      assert.equal(states[GLOBEX], 'blocked', `${exclude}: the pinned entry`);
      assert.equal(states.education, blocked.includes('education') ? 'blocked' : 'live', `${exclude}: the other pin`);

      const off = data<View>(await w.update({ expectedRevision: on.revision, clear: [exclude] }));
      assert.ok(off.pins.every((pin) => pin.state === 'live'), `${exclude}: lifted`);
      assert.equal(off.pins.length, 2, 'the pins were not lost');
    }
  } finally {
    w.dispose();
  }
});

test('a pin that is excluded while it is also gone is reported as the exclusion it is', async () => {
  const w = world();

  try {
    data(await w.update({ expectedRevision: 0, pin: [w.ref('experience', 'nobody~nothing')], exclude: [w.ref('experience')] }));
    assert.equal((await w.get()).pins[0]?.state, 'blocked');
  } finally {
    w.dispose();
  }
});

test('a pin may be made on a piece that is already excluded, and an exclusion on a piece that is pinned', async () => {
  const w = world();

  try {
    data(await w.update({ expectedRevision: 0, exclude: [w.ref('experience', GLOBEX)] }));
    const view = data<View>(await w.update({ expectedRevision: 1, pin: [w.ref('experience', GLOBEX)] }));
    assert.deepEqual(view.exclusions.map((each) => each.ref), [w.ref('experience', GLOBEX)]);
    assert.deepEqual(view.pins, [{ ref: w.ref('experience', GLOBEX), state: 'blocked' }]);
  } finally {
    w.dispose();
  }
});

/* ---------------------------------------------------------------- how much */

test('a conversation can pin only so many pieces, and going over writes nothing', async () => {
  const w = world();

  try {
    const keys = Array.from({ length: MAX_PINS }, (_, at) => w.ref('experience', `k${at}`));
    data(await w.update({ expectedRevision: 0, pin: keys.slice(0, 10) }));
    data(await w.update({ expectedRevision: 1, pin: keys.slice(10) }));

    const full = await w.get();
    assert.equal(full.pins.length, MAX_PINS);

    const over = refused(
      await w.update({ expectedRevision: full.revision, pin: [w.ref('education'), w.ref('languages')], unpin: [keys[0]!] })
    );
    assert.equal(over.code, 'selection_limit');
    assert.deepEqual(await w.get(), full, 'the unpin that came with the refused change was kept');

    const swapped = data<View>(await w.update({ expectedRevision: full.revision, pin: [w.ref('education')], unpin: [keys[0]!] }));
    assert.equal(swapped.pins.length, MAX_PINS);

    // The limit is on pins and not on exclusions: a full set of pins leaves the room for exclusions it had.
    const excluded = data<View>(await w.update({ expectedRevision: swapped.revision, exclude: [w.ref('languages')] }));
    assert.equal(excluded.exclusions.length, 1);
  } finally {
    w.dispose();
  }
});

/* ---------------------------------------------------------------- how long */

test('a pin and the revision go with their conversation', async () => {
  const w = world();

  try {
    const other = w.harness.conversations.create({ kind: 'profile', id: w.cv.id });
    data(await w.update({ expectedRevision: 0, pin: [w.ref('education')] }, other.id));

    const count = () =>
      (w.s.db.prepare('SELECT count(*) AS n FROM grounding_pin WHERE conversation_id = ?').get(other.id) as { n: number }).n;
    assert.equal(count(), 1);

    w.s.db.prepare('DELETE FROM conversations WHERE id = ?').run(other.id);
    assert.equal(count(), 0, 'the pin outlived its conversation');
    assert.deepEqual(w.s.db.pragma('foreign_key_check'), []);
  } finally {
    w.dispose();
  }
});

/* ---------------------------------------------------------------- the wire */

test('the channel takes pin and unpin as lists of refs, at most fifty, and nothing else new', async () => {
  const w = world();

  try {
    const good = { conversationId: w.chat.id, expectedRevision: 0 };
    for (const payload of [
      { ...good, pin: 'cv:x' },
      { ...good, pin: [''] },
      { ...good, pin: [7] },
      { ...good, pin: Array.from({ length: 51 }, (_, at) => w.ref('experience', `k${at}`)) },
      { ...good, unpin: [''] },
      { ...good, unpin: Array.from({ length: 51 }, (_, at) => w.ref('experience', `k${at}`)) },
      { ...good, attach: [w.ref('education')] }
    ]) {
      assert.equal(refused(await w.dispatch('selection.update', payload)).code, 'invalid_input', JSON.stringify(payload).slice(0, 80));
    }
    assert.deepEqual(await w.get(), { revision: 0, exclusions: [], pins: [] });

    // Fifty is the most, and it is the pin limit and not the channel that stops them.
    const fifty = Array.from({ length: 50 }, (_, at) => w.ref('experience', `k${at}`));
    assert.equal(refused(await w.dispatch('selection.update', { ...good, pin: fifty })).code, 'selection_limit');
    assert.equal(data<View>(await w.dispatch('selection.update', { ...good, unpin: fifty })).revision, 0);

    // A host that has never heard of pins sends neither, and the request is what it always was.
    assert.equal(data<View>(await w.update({ expectedRevision: 0, exclude: [w.ref('languages')] })).revision, 1);
  } finally {
    w.dispose();
  }
});

test('a change against a revision that is no longer current carries the pins that are current', async () => {
  const w = world();

  try {
    data(await w.update({ expectedRevision: 0, pin: [w.ref('education')] }));
    const error = refused(await w.update({ expectedRevision: 0, pin: [w.ref('languages')] }));

    assert.equal(error.code, 'selection_conflict');
    assert.deepEqual(error.details, { revision: 1, exclusions: [], pins: [{ ref: w.ref('education'), state: 'live' }] });
    assert.deepEqual((await w.get()).pins.map((pin) => pin.ref), [w.ref('education')], 'the stale pin was written');
  } finally {
    w.dispose();
  }
});

test('the runtime announces that it assembles pieces, once', async () => {
  const w = world();

  try {
    const { features } = data<{ features: string[] }>(await w.dispatch('protocol.get', {}));
    assert.equal(features.filter((feature) => feature === 'grounding-assembly').length, 1);
    assert.ok(features.includes('grounding-selection'), 'the list was added to');
  } finally {
    w.dispose();
  }
});

/* --------------------------------------------------------------- the schema */

test('the migration adds the pin table and leaves what a database had before it as it was', () => {
  const db = open(':memory:');

  try {
    migrate(db, migrations.filter((step) => step.version <= 42));
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'grounding_pin'").get(), undefined);

    const old = createConversationStore(db).create({ kind: 'profile', id: '' });
    db.prepare("INSERT INTO grounding_selection (conversation_id, ref, kind, ordinal) VALUES (?, 'cv:x/education', 'exclude', 1)").run(old.id);
    db.prepare('INSERT INTO grounding_selection_revision (conversation_id, revision) VALUES (?, 4)').run(old.id);
    const tables = () =>
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    const before = tables();

    // Up to this migration and no further: a later one adds tables of its own.
    migrate(db, migrations.filter((step) => step.version <= 43));

    assert.deepEqual(tables(), [...before, 'grounding_pin'].sort(), 'it adds one table and nothing else');
    assert.deepEqual(createSelectionStore(db).read(old.id), {
      conversationId: old.id,
      revision: 4,
      exclude: ['cv:x/education'],
      pin: []
    });
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});
