/**
 * The contact details: a piece of their own, read only when they are needed.
 *
 * A model that looked at the overview of a CV used to be given the email, the
 * phone and the links with the name, on every read, whatever it was asked. Now
 * the overview has the name and the place, and the rest is `read_cv`'s `contact`
 * section, `cv:<scope>/overview/contact`. What has to hold:
 *
 *   the piece      the two parts of the one `personal` field, and what each reads as
 *   read_cv        the overview has nothing of how to reach the person; `contact`
 *                  has it, and the record says so only when it was read
 *   a wall         leaving out the personal details leaves out the contact details,
 *                  however they are asked for; leaving out the contact details alone
 *                  keeps the name, and an edit puts them back as they were
 *   asked for      a pin of the personal details sends both, as it did when they
 *                  were one piece; the contact details are never evidence of fit
 *   the host       a conversation may exclude and pin the piece, an edit is not
 *                  aimed at it, and the runtime says it has it
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 38 were applied; 35 broke at least one
 * test, and the three that broke none cannot be told from the code as it is. The
 * number is how many tests failed.
 *
 * the piece:
 *   the personal details keep how to reach the person      5
 *   the contact details drop the links                     8
 *   the contact details drop the phone                     8
 *   the personal details say the email                     1
 *   the contact details have no heading                    3
 *   the contact details drop the links as text             3
 *   the contact details drop the phone as text             3
 *   contact details that say nothing are a block           1
 *
 * read_cv:
 *   the overview hands over the whole personal field       2
 *   the overview hands over the contact details            1
 *   the overview records the whole field for personal      1
 *   there is no contact section                            4
 *   the contact section reads through a wall               2
 *   the model is not told when to read the contact details 1
 *   a read of the contact details is not recorded          1
 *   a read with nothing in it is recorded                  2
 *   the contact details are recorded as a section          1
 *   the contact details are digested as the whole field    1
 *
 * a wall:
 *   a wall on the contact details is not looked at         4
 *   a wall on the contact details keeps the email          1
 *   the contact details cut out are not remembered         4
 *   the contact details are remembered by reference        1
 *   the contact details are remembered beside the personal 1
 *   the contact details do not go with the personal        3
 *   the contact details are not put back                   1
 *   the edit writes over the contact details put back      1
 *   the contact details are not a piece the CV holds       2
 *   the personal details cannot be edited with the
 *     contact details left out                             1
 *
 * asked for:
 *   a pin of the personal details is the name alone        2
 *   a piece is held back only when it was cut itself       1
 *   a piece is digested as the whole field                 3
 *   the contact details are evidence                       1
 *
 * the host:
 *   the contact details are an edit target                 1
 *   protocol.get does not say cv-contact                   1
 *   a conversation cannot leave out the contact details    1
 *
 * the same as the code, so no test can break them:
 *   the contact details are put back over the personal details put back: a
 *     view never cuts the contact details out apart when it cuts the personal
 *     details, so both cannot be remembered
 *   the overview asks only whether an item was cut itself: it never hands over
 *     the contact details, and for the rest that is the whole question
 *   a piece is read from the stored CV and not from what is shown: a piece
 *     that was cut is held back before it is read, and one that was not is
 *     the same in both
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { staleCv } from '../src/capabilities/cv/assembly.js';
import { CV_ID, CV_KIND } from '../src/capabilities/cv/document.js';
import type { CvDocument } from '../src/capabilities/cv/document.js';
import { render } from '../src/capabilities/cv/render.js';
import { sectionOf } from '../src/capabilities/cv/target.js';
import { readCvTool } from '../src/capabilities/cv/tools.js';
import { cvHolds, cvTargetWalled, cvView, restoreCv, withheldItem } from '../src/capabilities/cv/walls.js';
import { cvOf, overviewPiece } from '../src/capabilities/cv/well.js';
import type {
  ChunkIndex,
  DocumentRecord,
  DocumentStore,
  EffectSet,
  PieceRef,
  RecordEntry,
  RecordSink,
  Retriever,
  ToolContext
} from '../src/contracts/index.js';
import { createRecordBook, digest, parseRef } from '../src/grounding/index.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import { defaultWells } from '../src/runtime/grounding.js';
import { wallPorts } from '../src/runtime/walls.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { chat, offer, settle } from './support/chat.js';
import type { Chat } from './support/chat.js';
import { scratch } from './support/db.js';

/* ---------------------------------------------------------------- fixtures */

/** The scope `chat()` binds its CV to, which the unit tests use too. */
const CONTEXT = 'ctx';

const BODY = {
  version: 1,
  personal: {
    name: 'Ada Example',
    email: 'ada@example.com',
    phone: '+48 600 100 200',
    location: 'Krakow',
    links: { github: 'https://github.com/ada' }
  },
  role_description: 'Backend engineer focused on billing systems.',
  skills: { role: 'Engineer', groups: [{ label: 'Languages', items: ['Go'] }], programming_languages: ['Go'], frameworks: [], libraries_and_tools: [] },
  experience: [
    { company: 'Acme', title: 'Senior Engineer', started: '2021', finished: null, highlights: ['Rewrote the billing pipeline.'], skills: ['Go'] }
  ],
  education: [],
  certificates: [],
  languages: [],
  sources: []
};

assert.deepEqual(cvOf(BODY), BODY, 'the fixture CV is in the shape the document parses to');
const DOCUMENT = cvOf(BODY) as CvDocument;

/** What the overview's `personal` is now: who and where. */
const NAME_AND_PLACE = { name: 'Ada Example', location: 'Krakow' };
/** What the `contact` piece is: how to reach them. */
const CONTACT_DETAILS = { email: 'ada@example.com', phone: '+48 600 100 200', links: { github: 'https://github.com/ada' } };
/** Each of the contact details as it would turn up in a payload. None is anywhere else in the CV. */
const HOW_TO_REACH = ['ada@example.com', '600 100 200', 'github.com/ada'];

const PERSONAL_TEXT = 'Personal details:\nAda Example\nKrakow';
const CONTACT_TEXT = 'Contact details:\nada@example.com\n+48 600 100 200\ngithub: https://github.com/ada';

const ref = (path = ''): string => `cv:${CONTEXT}${path === '' ? '' : `/${path}`}`;
const PERSONAL = ref('overview/personal');
const CONTACT = ref('overview/contact');
const ROLE = ref('overview/role_description');
const SKILLS = ref('overview/skills');

const walls = (...refs: string[]): PieceRef[] => refs.map((each) => parseRef(each));

const record = (body: unknown = BODY, revision = 3): DocumentRecord =>
  ({ id: CV_ID, kind: CV_KIND, revision, body, createdAt: 1, updatedAt: 2 }) as unknown as DocumentRecord;

const notReached = (what: string) => (): never => {
  throw new Error(`${what} was reached`);
};

/** The documents and retrieval ports a run in the conversation is given: the CV, behind the walls. */
const walled = (body: unknown, ...excluded: string[]) =>
  wallPorts(
    {
      documents: { read: (id: string) => (id === CV_ID ? record(body) : undefined), update: notReached('documents.update') } as unknown as DocumentStore,
      retrieval: { search: notReached('retrieval.search') } as unknown as Retriever,
      index: {} as unknown as ChunkIndex
    },
    { pieces: () => walls(...excluded) },
    CONTEXT
  );

/**
 * `read_cv` over the CV behind the walls given, the way a run reads it: through the
 * walled documents port, with a record book that keeps what the tool says it handed
 * over, as a run's record keeps it.
 */
const reader = (...excluded: string[]) => {
  const book = createRecordBook(defaultWells());
  const sink: RecordSink = {
    scopes: { cv: CONTEXT },
    add: (entries) => {
      for (const entry of entries) book.add(entry);
    },
    sent: notReached('record.sent'),
    masking: notReached('record.masking')
  };
  const ports = walled(BODY, ...excluded);
  const context = {
    traceId: 'trace-1',
    runId: 'run-1',
    step: 'step-1',
    signal: new AbortController().signal,
    effects: {} as unknown as EffectSet,
    documents: ports.documents,
    retrieval: ports.retrieval,
    record: sink
  } as ToolContext;
  const [handle] = createToolRegistry([readCvTool]).handles(['read_cv'], context);

  return {
    get added() {
      return book.entries();
    },
    read: async (section: string) => (await handle!.invoke({ section })) as { section: string; data: Record<string, unknown> }
  };
};

/* ---------------------------------------------------------------- the piece */

test('the personal details are two pieces of the one field: who and where, and how to reach them', () => {
  assert.deepEqual(overviewPiece(DOCUMENT, 'personal'), NAME_AND_PLACE);
  assert.deepEqual(overviewPiece(DOCUMENT, 'contact'), CONTACT_DETAILS);
  // The other items are their fields, as they always were.
  assert.equal(overviewPiece(DOCUMENT, 'role_description'), DOCUMENT.role_description);
  assert.equal(overviewPiece(DOCUMENT, 'skills'), DOCUMENT.skills);
});

test('each reads as a block of its own, and contact details that say nothing are no block', () => {
  assert.equal(render('overview/personal', overviewPiece(DOCUMENT, 'personal')), PERSONAL_TEXT);
  assert.equal(render('overview/contact', overviewPiece(DOCUMENT, 'contact')), CONTACT_TEXT);
  assert.equal(render('overview/contact', { email: '', phone: '', links: {} }), '');
  // The personal details no longer say how to reach anyone, even when handed the whole field.
  assert.equal(render('overview/personal', DOCUMENT.personal), PERSONAL_TEXT);
});

/* ------------------------------------------------------------------ read_cv */

test('the overview has the name and the place, and nothing of how to reach the person', async () => {
  const r = reader();
  const overview = await r.read('overview');

  assert.deepEqual(overview.data.personal, NAME_AND_PLACE);
  assert.equal('contact' in overview.data, false);
  for (const value of HOW_TO_REACH) assert.ok(!JSON.stringify(overview).includes(value), value);

  // The record names what was handed over, and the contact details were not.
  assert.deepEqual(r.added.map((entry) => entry.ref), [PERSONAL, ROLE, SKILLS]);
  const personal = r.added[0];
  assert.equal(personal?.digest, digest(NAME_AND_PLACE));
  assert.equal(personal?.shown, undefined, 'the piece was handed over whole');
});

test('the contact section has how to reach them, and the record says it was read', async () => {
  const r = reader();
  const contact = await r.read('contact');

  assert.equal(contact.section, 'contact');
  assert.deepEqual(contact.data, CONTACT_DETAILS);
  assert.deepEqual(r.added, [
    { ref: CONTACT, version: '3', digest: digest(CONTACT_DETAILS), status: 'included', origin: 'server', via: 'tool:read_cv' }
  ]);
});

test('the model is told the contact details are a section to read when they are needed, and of no other', () => {
  assert.match(readCvTool.describe, /contact section only when the email, phone or links are needed/);
  assert.equal(readCvTool.input.safeParse({ section: 'contact' }).success, true);
  assert.equal(readCvTool.input.safeParse({ section: 'phone' }).success, false);
});

test('with the contact details left out, the name is still read and the contact section is empty and unrecorded', async () => {
  const r = reader(CONTACT);

  const overview = await r.read('overview');
  assert.deepEqual(overview.data.personal, NAME_AND_PLACE);

  const contact = await r.read('contact');
  assert.deepEqual(contact.data, {});
  assert.deepEqual(r.added.map((entry) => entry.ref), [PERSONAL, ROLE, SKILLS]);
  for (const value of HOW_TO_REACH) assert.ok(!JSON.stringify([overview, contact]).includes(value), value);
});

test('with the personal details left out, the contact details are left out with them', async () => {
  const r = reader(PERSONAL);

  const overview = await r.read('overview');
  assert.equal('personal' in overview.data, false);

  const contact = await r.read('contact');
  assert.deepEqual(contact.data, {});
  assert.deepEqual(r.added.map((entry) => entry.ref), [ROLE, SKILLS]);
  for (const value of [...HOW_TO_REACH, 'Ada']) assert.ok(!JSON.stringify([overview, contact]).includes(value), value);
});

/* -------------------------------------------------------------------- a wall */

test('a wall on the contact details empties them and keeps the name, and remembers them', () => {
  const view = cvView(DOCUMENT, walls(CONTACT), CONTEXT);

  assert.equal(view.walled, true);
  assert.deepEqual(view.shown.personal, { name: 'Ada Example', email: '', phone: '', location: 'Krakow', links: {} });
  assert.deepEqual(view.withheld.items, { contact: CONTACT_DETAILS });
  assert.notEqual((view.withheld.items.contact as typeof CONTACT_DETAILS).links, DOCUMENT.personal.links, 'a copy');
  assert.equal(withheldItem(view.withheld, 'contact'), true);
  assert.equal(withheldItem(view.withheld, 'personal'), false);
  // The rest of the CV is as it was.
  assert.equal(view.shown.role_description, DOCUMENT.role_description);
  assert.deepEqual(view.shown.experience, DOCUMENT.experience);
});

test('a wall on the personal details, or on the overview, takes the contact details with it', () => {
  const personal = cvView(DOCUMENT, walls(PERSONAL), CONTEXT);
  assert.deepEqual(personal.withheld.items, { personal: DOCUMENT.personal }, 'the whole field, once');
  assert.equal(withheldItem(personal.withheld, 'contact'), true);
  assert.equal(withheldItem(personal.withheld, 'role_description'), false);

  // Both at once is the personal details, and nothing is remembered twice.
  const both = cvView(DOCUMENT, walls(PERSONAL, CONTACT), CONTEXT);
  assert.deepEqual(both.withheld.items, { personal: DOCUMENT.personal });

  const overview = cvView(DOCUMENT, walls(ref('overview')), CONTEXT);
  assert.deepEqual(Object.keys(overview.withheld.items), ['personal', 'role_description', 'skills']);
  assert.equal(withheldItem(overview.withheld, 'contact'), true);
});

test('an edit made without the contact details gets them back as they were, and keeps what it did to the name', () => {
  const view = cvView(DOCUMENT, walls(CONTACT), CONTEXT);
  const edited: CvDocument = {
    ...view.shown,
    personal: { name: 'Ada M. Example', email: 'invented@example.org', phone: '', location: 'Warsaw', links: {} }
  };

  assert.deepEqual(restoreCv(edited, view.withheld).personal, {
    name: 'Ada M. Example',
    location: 'Warsaw',
    ...CONTACT_DETAILS
  });

  // With the personal details left out, the edit has no say in any of them.
  const whole = cvView(DOCUMENT, walls(PERSONAL), CONTEXT);
  assert.deepEqual(restoreCv({ ...whole.shown, personal: edited.personal }, whole.withheld).personal, DOCUMENT.personal);
});

test('the personal details can be edited with the contact details left out, and not with themselves left out', () => {
  assert.equal(cvTargetWalled(walls(CONTACT), CONTEXT, 'personal', DOCUMENT), false);
  assert.equal(cvTargetWalled(walls(PERSONAL), CONTEXT, 'personal', DOCUMENT), true);
});

test('the contact details are a piece the CV holds, and an item it has not is not', () => {
  assert.equal(cvHolds(DOCUMENT, ['overview', 'contact']), true);
  assert.equal(cvHolds(DOCUMENT, ['overview', 'address']), false);
});

/* ---------------------------------------------------------------- asked for */

const QUESTION = { question: 'What should my header say?' };

const LABEL = 'SELECTED CV PARTS — SOURCE DATA';
const loopOf = (c: Chat): string => {
  const loops = c.requests.filter((request) => request.kind === 'loop');
  assert.equal(loops.length, 1, 'one model call was made');
  return loops[0]?.prompt ?? '';
};
const everything = (c: Chat): string => c.requests.map((request) => [request.system, request.prompt].join('\n')).join('\n');

test('a pin of the personal details sends the name and the contact details, as it did when they were one', async () => {
  const c = chat({ body: BODY });
  try {
    c.pin(PERSONAL);
    const run = c.begin(QUESTION);
    const settled = await settle(run);

    assert.equal(loopOf(c), `${QUESTION.question}\n\n${LABEL}:\n${PERSONAL_TEXT}\n\n${CONTACT_TEXT}`);
    assert.deepEqual(
      c.entries(run).filter((entry) => entry.via === 'ground:pin').map((entry) => [entry.ref, entry.digest]),
      [[PERSONAL, digest(NAME_AND_PLACE)], [CONTACT, digest(CONTACT_DETAILS)]]
    );
    assert.deepEqual((settled.data.grounding as { included: string[] }).included, [PERSONAL, CONTACT]);
  } finally {
    c.dispose();
  }
});

test('a pin of the contact details sends them alone', async () => {
  const c = chat({ body: BODY });
  try {
    c.pin(CONTACT);
    await settle(c.begin(QUESTION));
    assert.equal(loopOf(c), `${QUESTION.question}\n\n${LABEL}:\n${CONTACT_TEXT}`);
  } finally {
    c.dispose();
  }
});

test('the contact details left out are held back from a pin of the personal details, which still sends the name', async () => {
  const c = chat({ body: BODY });
  try {
    c.pin(PERSONAL);
    c.exclude(CONTACT);
    const settled = await settle(c.begin(QUESTION));

    assert.equal(loopOf(c), `${QUESTION.question}\n\n${LABEL}:\n${PERSONAL_TEXT}`);
    for (const value of HOW_TO_REACH) assert.ok(!everything(c).includes(value), value);
    assert.deepEqual((settled.data.grounding as { blocked: string[] }).blocked, [CONTACT]);
  } finally {
    c.dispose();
  }
});

test('the personal details left out hold back a pin of the contact details', async () => {
  const c = chat({ body: BODY });
  try {
    c.pin(CONTACT);
    c.exclude(PERSONAL);
    const settled = await settle(c.begin(QUESTION));

    assert.equal(loopOf(c), QUESTION.question, 'nothing was sent');
    for (const value of HOW_TO_REACH) assert.ok(!everything(c).includes(value), value);
    assert.deepEqual((settled.data.grounding as { blocked: string[] }).blocked, [CONTACT]);
  } finally {
    c.dispose();
  }
});

test('a new email makes a copy of the contact details stale, and not one of the name', () => {
  const entry = (at: string, original: unknown): RecordEntry => ({
    ref: at,
    version: '3',
    digest: digest(original),
    status: 'included',
    origin: 'server',
    via: 'ground:pin'
  });
  const sent = [entry(PERSONAL, NAME_AND_PLACE), entry(CONTACT, CONTACT_DETAILS)];
  // As a run that waited reads it: the CV through the walls of the conversation now.
  const reading = (body: unknown, ...excluded: string[]) => ({
    documents: walled(body, ...excluded).documents,
    walls: { pieces: () => walls(...excluded) }
  });

  assert.deepEqual(staleCv(reading(BODY), sent), []);
  assert.deepEqual(staleCv(reading({ ...BODY, personal: { ...BODY.personal, email: 'ada@new.example' } }), sent), [CONTACT]);
  // Left out since, through the personal details they are part of.
  assert.deepEqual(staleCv(reading(BODY, PERSONAL), sent), [PERSONAL, CONTACT]);
});

test('the contact details are never evidence of fit, whatever an offer lists', async () => {
  const c = chat({ body: BODY });
  try {
    c.saveOffer(offer('gh', { position: 'Engineer', skills: ['github', 'example.com', 'Go'], text: '.' }));
    await settle(c.begin({ ...QUESTION, grounding: { offerIds: ['gh'] } }));

    const prompt = loopOf(c);
    assert.ok(prompt.includes('Experience, Senior Engineer at Acme'), 'what matches is evidence');
    assert.equal(prompt.includes('Contact details'), false);
    for (const value of HOW_TO_REACH) assert.equal(prompt.includes(value), false, value);
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------ the host */

const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

test('a conversation may leave out and pin the contact details, and the runtime says it has them', async () => {
  const s = scratch();
  const harness = createHarness({
    databasePath: s.path,
    capabilities: {},
    logger: silentLogger,
    env: {},
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });
  try {
    const dispatch = createDispatch(harness);
    const cv = harness.cvContexts.create(randomUUID(), 'en');
    harness.profile.replaceContext(cv.id, BODY as never, 0);
    const conversation = harness.conversations.create({ kind: 'profile', id: cv.id });
    const at = (item: string) => `cv:${cv.id}/overview/${item}`;

    const view = data<{ exclusions: { ref: string; state: string }[]; pins: { ref: string; state: string }[] }>(
      await dispatch('selection.update', { conversationId: conversation.id, expectedRevision: 0, exclude: [at('contact')], pin: [at('contact')] })
    );
    assert.deepEqual(view.exclusions, [{ ref: at('contact'), state: 'live' }]);
    assert.deepEqual(view.pins.map((pin) => pin.ref), [at('contact')]);

    const refused = await dispatch('selection.update', { conversationId: conversation.id, expectedRevision: 1, exclude: [at('address')] });
    assert.equal(refused.ok, false);
    assert.equal((refused as { error: { code: string } }).error.code, 'invalid_selection');

    assert.ok(data<{ features: string[] }>(await dispatch('protocol.get', {})).features.includes('cv-contact'));
  } finally {
    harness.close();
    s.dispose();
  }
});

test('an edit is aimed at the personal details, and not at the contact details they hold', () => {
  assert.equal(sectionOf(PERSONAL, CONTEXT), 'personal');
  assert.throws(() => sectionOf(CONTACT, CONTEXT), (error: { code?: string }) => error.code === 'invalid_selection');
});
