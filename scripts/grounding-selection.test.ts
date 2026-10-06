/**
 * What a person can exclude from a conversation, and what the runtime says back.
 *
 * Nothing here runs a model. The walls those exclusions become are tested where
 * they bite (`grounding-walls.test.ts`). This file asks the questions that come
 * before: what may a conversation exclude, what does it say about each exclusion
 * afterwards, what happens when two windows change it at once, and does it still
 * hold after the process has gone.
 *
 * The harness is real, over a database on disk, and every call goes through
 * `dispatch` the way Studio does, so a refusal is the envelope a window receives.
 *
 * In the order of the tests:
 *
 *   the door          the channels take exactly their fields
 *   reading           nothing selected reads as revision 0; a conversation that
 *                     does not exist is not an empty selection
 *   changing          exclude and clear; the order refs come back in; a repeat
 *                     changes nothing and does not move the revision; one change
 *                     is one revision
 *   two windows       a change made against a stale revision writes nothing and
 *                     carries what is current
 *   what it says      an exclusion is live while its piece is there and gone when
 *                     it is not, and a gone one still holds and can be cleared
 *   what it accepts   per kind of conversation, and never a version
 *   how much          the limit, and that going over it writes nothing
 *   how long          it survives a restart and goes with its conversation
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 56 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * the payloads:
 *   the read channel takes more than a conversation id 1
 *   the update channel takes more than its fields  1
 *   the update channel takes no revision           1
 *   the update channel takes a negative revision   1
 *   the update channel takes a fractional revision 1
 *   the update channel takes an empty ref to exclude 1
 *   the update channel takes any number of refs to exclude 1
 *   the update channel takes an empty ref to clear 1
 *   the update channel takes any number of refs to clear 1
 *
 * reading:
 *   a conversation that is not there reads as an empty selection 2
 *   an update does not look for the conversation   1
 *   a conversation that is not there is another code on read 2
 *   a conversation that is not there is another code on update 1
 *
 * changing:
 *   the revision never moves                       5
 *   the revision moves when nothing changed        1
 *   refs come back in alphabetical order           2
 *   every ref is given the same place              2
 *   a clear is not applied                         5
 *   an exclusion is not applied                    9
 *   the answer is not what is stored               8
 *
 * two windows:
 *   the revision is not checked                    2
 *   a stale change is said to have been applied    2
 *   a stale change writes anyway                   2
 *   a conflict is answered ok                      2
 *   a conflict is another code                     2
 *   a conflict does not say what is current        1
 *   the revision is shared by every conversation   2
 *   the exclusions are shared by every conversation 2
 *
 * what it says:
 *   a gone exclusion is said to be live            3
 *   an exclusion is said to be gone while its piece is there 4
 *   every item of a CV is said to be there         1
 *   no item of a CV is said to be there            2
 *   a CV with nothing in it has no whole           1
 *   a CV with nothing in it has every piece        1
 *   a CV is not read to see what is in it          2
 *   an offer is said to be there whatever its id   1
 *
 * what it accepts:
 *   a version is accepted                          1
 *   a digest is accepted                           1
 *   a well nobody registered is accepted           1
 *   a profile conversation excludes from any well  1
 *   a profile conversation excludes another CV     2
 *   a section no CV has is accepted                1
 *   an overview item no CV has is accepted         1
 *   the legacy profile conversation is not about the CV named cv 1
 *   a discovery conversation excludes parts of an offer 1
 *   a discovery conversation excludes from any well 1
 *   an offer conversation excludes pieces of a CV  1
 *   a refusal is another code                      3
 *   a clear is held to what may be excluded        1
 *   a clear is not checked to be a ref             1
 *
 * how much:
 *   the limit is not enforced                      1
 *   the limit is one too low                       1
 *   going over the limit is another code           1
 *   going over the limit keeps what was written before it 1
 *
 * how long:
 *   an exclusion outlives its conversation         1
 *   a revision outlives its conversation           1
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { MAX_EXCLUSIONS } from '../src/contracts/index.js';
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
    /** Closes the harness and opens another over the same file, as a restart does. */
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

type World = ReturnType<typeof world>;

/** A discovery conversation over a ready search, made the way the store's own tests make one. */
const discoveryChat = (w: World) => {
  const searchId = randomUUID();
  w.s.db
    .prepare(
      `INSERT INTO discovery_searches(id,import_key,manifest,status,row_count,revision,created_at,updated_at)
       VALUES(?, ?, '{}', 'ready', 0, 1, 1, 1)`
    )
    .run(searchId, 'native');
  return w.harness.conversations.open({ kind: 'discovery', id: searchId });
};

/* ------------------------------------------------------------------- tests */

test('the channels take exactly their fields', async () => {
  const w = world();

  try {
    for (const payload of [{}, { conversationId: '' }, { conversationId: w.chat.id, extra: 1 }]) {
      assert.equal(refused(await w.dispatch('selection.get', payload)).code, 'invalid_input', JSON.stringify(payload));
    }

    const good = { conversationId: w.chat.id, expectedRevision: 0 };
    for (const payload of [
      { conversationId: w.chat.id },
      { ...good, expectedRevision: -1 },
      { ...good, expectedRevision: 0.5 },
      { ...good, expectedRevision: '0' },
      { ...good, extra: true },
      { ...good, exclude: 'cv:x' },
      { ...good, exclude: [''] },
      { ...good, exclude: [7] },
      { ...good, exclude: Array.from({ length: 51 }, (_, at) => w.ref('experience', `k${at}`)) },
      { ...good, clear: [''] },
      { ...good, clear: Array.from({ length: 51 }, (_, at) => w.ref('experience', `k${at}`)) }
    ]) {
      assert.equal(refused(await w.dispatch('selection.update', payload)).code, 'invalid_input', JSON.stringify(payload));
    }

    assert.deepEqual(await w.get(), { revision: 0, exclusions: [], pins: [] }, 'a refused payload changed something');
  } finally {
    w.dispose();
  }
});

test('nothing selected reads as revision 0, and a conversation that is not there is not an empty selection', async () => {
  const w = world();

  try {
    assert.deepEqual(await w.get(), { revision: 0, exclusions: [], pins: [] });

    assert.equal(refused(await w.dispatch('selection.get', { conversationId: 'nope' })).code, 'not_found');
    assert.equal(refused(await w.update({ expectedRevision: 0, exclude: [w.ref()] }, 'nope')).code, 'not_found');
  } finally {
    w.dispose();
  }
});

test('exclude and clear: refs come back in the order they were excluded, and one change is one revision', async () => {
  const w = world();

  try {
    const first = data<View>(await w.update({ expectedRevision: 0, exclude: [w.ref('education'), w.ref('experience', 'acme~engineer')] }));
    assert.deepEqual(first, {
      revision: 1,
      exclusions: [
        { ref: w.ref('education'), state: 'live' },
        { ref: w.ref('experience', 'acme~engineer'), state: 'live' }
      ],
      pins: []
    });

    const second = data<View>(await w.update({ expectedRevision: 1, exclude: [w.ref('overview', 'personal')] }));
    assert.deepEqual(
      second.exclusions.map((entry) => entry.ref),
      [w.ref('education'), w.ref('experience', 'acme~engineer'), w.ref('overview', 'personal')],
      'the order of exclusion is kept'
    );
    assert.equal(second.revision, 2);

    // One change that clears one and excludes another is one revision, not two.
    const third = data<View>(
      await w.update({ expectedRevision: 2, clear: [w.ref('education')], exclude: [w.ref('experience', 'globex~lead')] })
    );
    assert.equal(third.revision, 3);
    assert.deepEqual(
      third.exclusions.map((entry) => entry.ref),
      [w.ref('experience', 'acme~engineer'), w.ref('overview', 'personal'), w.ref('experience', 'globex~lead')]
    );

    assert.deepEqual(await w.get(), third, 'what was answered is what is stored');
  } finally {
    w.dispose();
  }
});

test('a change that changes nothing does not move the revision', async () => {
  const w = world();

  try {
    data(await w.update({ expectedRevision: 0, exclude: [w.ref('education')] }));

    const again = data<View>(await w.update({ expectedRevision: 1, exclude: [w.ref('education')] }));
    assert.equal(again.revision, 1, 'excluding what is already excluded');

    const clearing = data<View>(await w.update({ expectedRevision: 1, clear: [w.ref('languages')] }));
    assert.equal(clearing.revision, 1, 'clearing what was never excluded');

    const empty = data<View>(await w.update({ expectedRevision: 1 }));
    assert.equal(empty.revision, 1, 'a change with nothing in it');

    const cleared = data<View>(await w.update({ expectedRevision: 1, clear: [w.ref('education')] }));
    assert.deepEqual(cleared, { revision: 2, exclusions: [], pins: [] });
  } finally {
    w.dispose();
  }
});

test('a change against a revision that is no longer current writes nothing and carries what is current', async () => {
  const w = world();

  try {
    // Two windows read revision 0. One excludes, and then the other tries to.
    data(await w.update({ expectedRevision: 0, exclude: [w.ref('education')] }));

    const stale = await w.update({ expectedRevision: 0, exclude: [w.ref('languages')], clear: [w.ref('education')] });
    const error = refused(stale);

    assert.equal(error.code, 'selection_conflict');
    assert.deepEqual(error.details, { revision: 1, exclusions: [{ ref: w.ref('education'), state: 'live' }], pins: [] });
    assert.deepEqual(await w.get(), { revision: 1, exclusions: [{ ref: w.ref('education'), state: 'live' }], pins: [] });

    // A revision from the future is just as stale.
    assert.equal(refused(await w.update({ expectedRevision: 5, exclude: [w.ref('languages')] })).code, 'selection_conflict');

    // Reloaded and offered again, it goes through.
    const retried = data<View>(await w.update({ expectedRevision: 1, exclude: [w.ref('languages')] }));
    assert.equal(retried.revision, 2);
  } finally {
    w.dispose();
  }
});

test('an exclusion is live while its piece is there, gone when it is not, and a gone one still holds and can be cleared', async () => {
  const w = world();

  try {
    const key = w.ref('experience', 'acme~engineer');
    data(await w.update({ expectedRevision: 0, exclude: [key, w.ref('experience', 'never~existed'), w.ref()] }));

    const before = await w.get();
    assert.deepEqual(
      before.exclusions.map((entry) => entry.state),
      ['live', 'gone', 'live'],
      'an item that never existed is gone, and the whole CV is there'
    );

    // The entry is renamed, so its key is now another and the old address names nothing.
    const stored = w.harness.documents.read(w.cv.id)!;
    const renamed = {
      ...(stored.body as typeof BODY),
      experience: [{ company: 'Acme Corp', title: 'Engineer', highlights: ['Built the thing'] }, BODY.experience[1]!]
    };
    w.harness.profile.replaceContext(w.cv.id, renamed, stored.revision);

    const after = await w.get();
    assert.deepEqual(after.exclusions.find((entry) => entry.ref === key), { ref: key, state: 'gone' });
    assert.equal(after.exclusions.length, 3, 'a gone exclusion is still an exclusion');

    const cleared = data<View>(await w.update({ expectedRevision: after.revision, clear: [key] }));
    assert.ok(!cleared.exclusions.some((entry) => entry.ref === key));
  } finally {
    w.dispose();
  }
});

test('a profile conversation excludes the pieces of its own CV and whole saved offers, and nothing else', async () => {
  const w = world();

  try {
    const other = createCvContextStore(w.s.db).create(randomUUID(), 'pl').id;

    for (const ref of [
      w.ref(),
      w.ref('overview'),
      w.ref('overview', 'skills'),
      w.ref('experience'),
      w.ref('education', 'oxford~maths'),
      w.ref('certificates', 'anything'),
      w.ref('languages', 'polish'),
      // A message that compares offers leaves this one out.
      `offers:${randomUUID()}`
    ]) {
      const view = data<View>(await w.update({ expectedRevision: (await w.get()).revision, exclude: [ref] }));
      assert.ok(view.exclusions.some((entry) => entry.ref === ref), `refused ${ref}`);
    }

    const before = await w.get();

    for (const ref of [
      `cv:${other}/experience`,
      w.ref('overview', 'photo'),
      w.ref('skills'),
      w.ref('sources'),
      // Only the whole of an offer can be left out: nothing reads its sections behind a wall.
      `offers:${randomUUID()}/posting`,
      `offers:${randomUUID()}/card`,
      `preferences:${w.cv.id}`,
      `conversation:${w.chat.id}/history`,
      `cv:${w.cv.id}@3/experience`,
      `${w.ref('experience')}#0123456789abcdef`
    ]) {
      assert.equal(
        refused(await w.update({ expectedRevision: before.revision, exclude: [ref] })).code,
        'invalid_selection',
        `accepted ${ref}`
      );
    }

    assert.deepEqual(await w.get(), before, 'a refused ref changed something');
  } finally {
    w.dispose();
  }
});

test('a ref that is not a ref, or names no well, is refused with its own code', async () => {
  const w = world();

  try {
    assert.equal(refused(await w.update({ expectedRevision: 0, exclude: ['not a ref'] })).code, 'invalid_ref');
    assert.equal(refused(await w.update({ expectedRevision: 0, exclude: [`${w.ref('experience')}/a/b`] })).code, 'invalid_ref');
    assert.equal(refused(await w.update({ expectedRevision: 0, exclude: ['tickets:desk/open'] })).code, 'unknown_well');
    assert.equal(refused(await w.update({ expectedRevision: 0, clear: ['not a ref'] })).code, 'invalid_ref');
    assert.deepEqual(await w.get(), { revision: 0, exclusions: [], pins: [] });
  } finally {
    w.dispose();
  }
});

test('a legacy profile conversation, about the CV with no id, excludes pieces of the CV named cv', async () => {
  const w = world();

  try {
    // The legacy conversation is about the profile with an empty id, which is the context named `cv`.
    const legacy = w.harness.conversations.create({ kind: 'profile', id: '' });

    data(await w.update({ expectedRevision: 0, exclude: ['cv:cv/experience'] }, legacy.id));
    assert.equal(
      refused(await w.update({ expectedRevision: 1, exclude: [w.ref('experience')] }, legacy.id)).code,
      'invalid_selection'
    );
  } finally {
    w.dispose();
  }
});

test('a discovery conversation excludes whole saved offers, and an offer conversation excludes nothing yet', async () => {
  const w = world();

  try {
    const discovery = discoveryChat(w);
    const offerId = randomUUID();

    const view = data<View>(await w.update({ expectedRevision: 0, exclude: [`offers:${offerId}`] }, discovery.id));
    assert.deepEqual(view, { revision: 1, exclusions: [{ ref: `offers:${offerId}`, state: 'gone' }], pins: [] });

    for (const ref of [`offers:${offerId}/posting`, w.ref('experience'), `preferences:${offerId}`]) {
      assert.equal(
        refused(await w.update({ expectedRevision: 1, exclude: [ref] }, discovery.id)).code,
        'invalid_selection',
        `a discovery conversation accepted ${ref}`
      );
    }

    const offer = w.harness.conversations.create({ kind: 'offer', id: offerId });
    for (const ref of [`offers:${offerId}`, `offers:${offerId}/posting`, w.ref('experience')]) {
      assert.equal(
        refused(await w.update({ expectedRevision: 0, exclude: [ref] }, offer.id)).code,
        'invalid_selection',
        `an offer conversation accepted ${ref}`
      );
    }
    assert.deepEqual(await w.get(offer.id), { revision: 0, exclusions: [], pins: [] });
  } finally {
    w.dispose();
  }
});

test('an exclusion that is no longer allowed can still be cleared', async () => {
  const w = world();

  try {
    // Written straight to the table, as an earlier version that allowed more might have.
    w.s.db.prepare("INSERT INTO grounding_selection (conversation_id, ref, kind, ordinal) VALUES (?, ?, 'exclude', 1)").run(
      w.chat.id,
      'offers:left-behind'
    );
    w.s.db.prepare('INSERT INTO grounding_selection_revision (conversation_id, revision) VALUES (?, 1)').run(w.chat.id);

    assert.equal((await w.get()).exclusions.length, 1);

    const cleared = data<View>(await w.update({ expectedRevision: 1, clear: ['offers:left-behind'] }));
    assert.deepEqual(cleared, { revision: 2, exclusions: [], pins: [] });
  } finally {
    w.dispose();
  }
});

test('a conversation can exclude only so many pieces, and going over writes nothing', async () => {
  const w = world();

  try {
    const keys = Array.from({ length: MAX_EXCLUSIONS }, (_, at) => w.ref('experience', `k${at}`));
    for (let from = 0; from < keys.length; from += 50) {
      data(await w.update({ expectedRevision: from / 50, exclude: keys.slice(from, from + 50) }));
    }

    const full = await w.get();
    assert.equal(full.exclusions.length, MAX_EXCLUSIONS);

    // One too many, together with a clear that is real: nothing of it may stick.
    const over = refused(
      await w.update({ expectedRevision: full.revision, exclude: [w.ref('education'), w.ref('languages')], clear: [keys[0]!] })
    );
    assert.equal(over.code, 'selection_limit');
    assert.deepEqual(await w.get(), full, 'the clear that came with the refused change was kept');

    // Clearing one makes room for one.
    const swapped = data<View>(
      await w.update({ expectedRevision: full.revision, exclude: [w.ref('education')], clear: [keys[0]!] })
    );
    assert.equal(swapped.exclusions.length, MAX_EXCLUSIONS);
  } finally {
    w.dispose();
  }
});

test('exclusions survive a restart, and go with the conversation', async () => {
  const w = world();

  try {
    data(await w.update({ expectedRevision: 0, exclude: [w.ref('education'), w.ref('experience', 'acme~engineer')] }));
    const before = await w.get();

    w.restart();

    assert.deepEqual(await w.get(), before);

    // A change after the restart is checked against the revision that survived it.
    assert.equal(refused(await w.update({ expectedRevision: 0, exclude: [w.ref('languages')] })).code, 'selection_conflict');

    data(await w.dispatch('conversations.delete', { conversationId: w.chat.id }));

    assert.equal(refused(await w.dispatch('selection.get', { conversationId: w.chat.id })).code, 'not_found');
    const left = w.s.db.prepare('SELECT count(*) AS n FROM grounding_selection').get() as { n: number };
    const revisions = w.s.db.prepare('SELECT count(*) AS n FROM grounding_selection_revision').get() as { n: number };
    assert.equal(left.n, 0, 'the rows outlived their conversation');
    assert.equal(revisions.n, 0, 'the revision outlived its conversation');
  } finally {
    w.dispose();
  }
});

test('one conversation excluding something does not exclude it from another', async () => {
  const w = world();

  try {
    const second = w.harness.conversations.create({ kind: 'profile', id: w.cv.id });
    data(await w.update({ expectedRevision: 0, exclude: [w.ref('education')] }));

    assert.deepEqual(await w.get(second.id), { revision: 0, exclusions: [], pins: [] });
    assert.equal(w.harness.conversations.read(second.id)?.conversation.id, second.id);
  } finally {
    w.dispose();
  }
});

test('a CV with nothing written to it is there as a whole and has no pieces', async () => {
  const w = world();

  try {
    const empty = createCvContextStore(w.s.db).create(randomUUID(), 'pl');
    const chat = w.harness.conversations.create({ kind: 'profile', id: empty.id });

    const view = data<View>(
      await w.update({ expectedRevision: 0, exclude: [`cv:${empty.id}`, `cv:${empty.id}/experience/acme~engineer`] }, chat.id)
    );

    assert.deepEqual(view.exclusions, [
      { ref: `cv:${empty.id}`, state: 'live' },
      { ref: `cv:${empty.id}/experience/acme~engineer`, state: 'gone' }
    ]);
  } finally {
    w.dispose();
  }
});

test('the migration adds the tables and leaves a conversation from before it with nothing excluded', () => {
  const db = open(':memory:');

  try {
    migrate(db, migrations.filter((step) => step.version <= 40));
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'grounding_selection%'").get(), undefined);

    const old = createConversationStore(db).create({ kind: 'profile', id: '' });

    migrate(db);

    assert.deepEqual(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'grounding_selection%' ORDER BY name").all() as { name: string }[]).map((row) => row.name),
      ['grounding_selection', 'grounding_selection_revision']
    );
    assert.deepEqual(createSelectionStore(db).read(old.id), { conversationId: old.id, revision: 0, exclude: [], pin: [] });
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});
