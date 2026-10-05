/**
 * What an exclusion cuts out of a conversation's CV, and that nothing of it
 * gets round the cut.
 *
 * `grounding-selection.test.ts` asks what a person may exclude. This file asks
 * what the exclusion then does, and the question that matters is not "is the
 * tool filtered" but "is there a path the text still takes". So the CV here
 * carries a unique string in every piece that gets excluded (a canary), the
 * gateway is a spy that is handed every request the real `ask_profile`,
 * `edit_cv` and `translate_cv` make, and the test reads what the model was
 * given and what each tool told it. A canary anywhere in that is a leak, by
 * whichever door it came.
 *
 * The other half is as important and is asserted just as often: what is not
 * excluded is still there. A wall that blanks the CV passes every canary test.
 *
 * In the order of the tests:
 *
 *   the cut          what is left of a document under a set of walls, where
 *                    each remaining entry sat in the stored one, and that
 *                    putting back what was cut gives the stored document
 *   the ports        a documents port, a retriever and an index that answer
 *                    with the walls applied; the walls read again at every
 *                    access; writes untouched
 *   a chat run       the real `ask_profile` over the real tools: no canary
 *                    reaches any payload, the keys a record names are the stored
 *                    ones, an exclusion made mid-run or while a run waited for a
 *                    person is honoured, and with nothing excluded the payloads
 *                    are the ones there were before
 *   what it binds    a run in a conversation of a CV has walls, and no other does
 *   an edit          the model is shown what is left and the proposal puts the
 *                    rest back; an edit aimed at what is excluded says so
 *   a translation    what is excluded is not sent to be translated and is not
 *                    lost from the result
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 72 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * the cut, what is left of a document and putting it back:
 *   a wall on another CV cuts this one             1
 *   a wall on another well cuts this one           1
 *   the keys of what is left are the first keys of the stored list 3
 *   the rows of what is left are counted from the start 3
 *   an excluded entry is not taken out             21
 *   an excluded entry is not remembered            9
 *   an excluded item of the overview is not emptied 3
 *   an excluded item of the overview is not remembered 7
 *   a view cut only of overview items says nothing was cut 6
 *   a view that cut nothing is a copy              4
 *   the whole CV keeps where it came from          1
 *   the whole CV does not remember where it came from 2
 *   an overview item is not put back               4
 *   an entry is put back at the end                7
 *   entries are put back last first                2
 *   the account of where the CV came from is not put back 1
 *   an overview item cannot be a target            3
 *   a whole section is not a target                1
 *   a section cut in part is a target              3
 *   a section with nothing in it is a target       1
 *   the record a port hands out is not remembered  9
 *   a record is taken for the document it holds    9
 *
 * the ports, the documents, the retriever and the index:
 *   the cut record's body is the stored one        6
 *   the cut record forgets what it was cut from    9
 *   a document is not cut                          14
 *   a document that is not a CV is cut             1
 *   a CV that cannot be read is handed over        1
 *   a write is made over the cut document          1
 *   walls are read once                            4
 *   a passage that cannot be placed is handed over 6
 *   a passage of an excluded piece is handed over  6
 *   a passage is dropped when the walls name nothing the CV holds 2
 *   a search with no CV to place passages in hands them over 1
 *   passages are placed in the document the model is shown 4
 *   a search is not cut                            8
 *   the keyword half of the index is not cut       3
 *   the vector half of the index is not cut        1
 *   the index is not part of the ports             3
 *   the index is not asked what it was embedded with 1
 *   the index is not written to                    1
 *   the index is not cleared                       1
 *   the index does not keep text                   1
 *
 * the run, what it is given and when:
 *   a run is given no walls                        16
 *   a run in no conversation is given walls        2
 *   a snapshot run is given walls                  1
 *   a run with walls reads the ports it always did 13
 *   the context does not carry the walls           6
 *   the record sees the retriever that is not cut  4
 *   the run reads an index that is not cut         1
 *   the production runtime holds no selections     1
 *
 * the record, naming what was cut by what is stored:
 *   the record states the cut document as the original 1
 *   the record does not say what the model was shown of the CV 1
 *   the record places passages in the document the model is shown 5
 *   a search names the piece in the document the model is shown 5
 *
 * the tools, what read_cv and a search hand over:
 *   read_cv reads the document it was cut from     3
 *   read_cv blanks an overview item                2
 *   read_cv names entries by their place in what was shown 1
 *   read_cv records the document the model was shown 3
 *   a read names the row by its place in what was shown 1
 *   a read names the key by its place in what was shown 1
 *
 * an edit:
 *   an edit is proposed without what it was not shown 3
 *   an edit is not refused when its target is excluded 2
 *   an edit of the stored CV is shown the whole of it 1
 *   an edit of the stored CV does not remember what it was not shown 2
 *   an edit of a document that was sent is shown the whole of it 1
 *   an edit of a document that was sent is not refused 1
 *   an edit of the stored CV is not refused        1
 *   an edit looks for the walls of another CV      2
 *   an edit is given no walls                      2
 *
 * a translation:
 *   a document that was sent is translated whole   1
 *   what a translation was not shown is not remembered 1
 *   a translation does not put back what it was not shown 2
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { CV_ID, CV_KIND, emptyDocument } from '../src/capabilities/cv/document.js';
import type { CvDocument } from '../src/capabilities/cv/document.js';
import { cvTargetWalled, cvView, restoreCv, storedCv, viewOf } from '../src/capabilities/cv/walls.js';
import { cvKeys, cvOf } from '../src/capabilities/cv/well.js';
import { isRunSuspension } from '../src/contracts/index.js';
import type {
  CapabilityMap,
  ChunkHit,
  ChunkIndex,
  DocumentRecord,
  DocumentStore,
  PieceRef,
  Retriever,
  ScoredChunk,
  ToolLoopRequest,
  Walls
} from '../src/contracts/index.js';
import { digest, parseRef } from '../src/grounding/index.js';
import { bindCvScope } from '../src/runtime/cv-scope.js';
import { defaultWells } from '../src/runtime/grounding.js';
import { createHarness } from '../src/runtime/create.js';
import { beginRun } from '../src/runtime/run.js';
import type { RunHandle, RunRequest, RuntimeDeps } from '../src/runtime/run.js';
import { wallPorts } from '../src/runtime/walls.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createRecordStore } from '../src/storage/sqlite/grounding-record.js';
import { createSelectionStore } from '../src/storage/sqlite/grounding-selection.js';
import { resumeRun } from '../src/runtime/resume.js';
import { scratch } from './support/db.js';
import type { Scratch } from './support/db.js';
import { noop, spine, stage, transform } from './support/spine.js';
import type { Spine } from './support/spine.js';
import { defaultTools } from '../src/tools/index.js';
import { createToolRegistry } from '../src/tools/registry.js';

/* ---------------------------------------------------------------- fixtures */

const CONTEXT = 'ctx';
const CHAT = 'chat';
const OFFER = 'offer-1';
const OFFER_CHAT = 'offer-chat';
const SNAPSHOT = 'snap-1';

/** One in each piece the tests exclude. Nothing else in the CV says any of them. */
const CANARY = {
  acme: 'ZEBRA-ACME1-4410',
  globex: 'ZEBRA-GLOBEX-7731',
  summary: 'ZEBRA-SUMMARY-2208',
  home: 'ZEBRA-HOME-9142',
  thesis: 'ZEBRA-THESIS-5530'
} as const;

const BODY = {
  version: 1,
  personal: { name: 'Ada Example', email: 'ada@example.com', phone: '', location: `Krakow ${CANARY.home}`, links: {} },
  role_description: `Backend engineer focused on billing systems. ${CANARY.summary}`,
  skills: {
    role: 'Engineer',
    groups: [
      { label: 'Languages', items: ['TypeScript', 'Go'] },
      { label: 'Frameworks', items: ['React'] },
      { label: 'Libraries & Tools', items: ['Postgres'] }
    ],
    programming_languages: ['TypeScript', 'Go'],
    frameworks: ['React'],
    libraries_and_tools: ['Postgres']
  },
  experience: [
    {
      company: 'Acme',
      title: 'Senior Engineer',
      started: '2021',
      finished: null,
      highlights: [`Rewrote the billing pipeline. ${CANARY.acme}`],
      skills: ['Go']
    },
    {
      company: 'Globex',
      title: 'Engineer',
      started: '2018',
      finished: '2021',
      highlights: [`Built the design system. ${CANARY.globex}`],
      skills: []
    },
    {
      company: 'Acme',
      title: 'Senior Engineer',
      started: '2016',
      finished: '2018',
      highlights: ['An earlier stint.'],
      skills: []
    }
  ],
  education: [
    {
      university: 'MIT',
      degree: 'BSc Computer Science',
      started: '2012',
      finished: '2016',
      thesis: `Compilers ${CANARY.thesis}`,
      mark: ''
    }
  ],
  certificates: [{ name: 'AWS Solutions Architect', issuer: 'Amazon', started: '2020', finished: '' }],
  languages: [
    { name: 'Polish', level: 'native' },
    { name: 'English', level: 'C1' }
  ],
  sources: [{ kind: 'text', reference: 'cv.txt', imported_at: '2026-01-05T00:00:00.000Z' }]
};

assert.deepEqual(cvOf(BODY), BODY, 'the fixture CV is in the shape the document parses to');

const DOCUMENT = cvOf(BODY) as CvDocument;

/** The stored keys of the three jobs: the second Acme entry is `-2` because of the first. */
const [ACME, GLOBEX, ACME_2] = ['acme~senior-engineer', 'globex~engineer', 'acme~senior-engineer-2'] as const;

/** A set of refs as the walls a run is given. */
const walls = (...refs: string[]): PieceRef[] => refs.map((ref) => parseRef(ref));

const ref = (path = ''): string => `cv:${CONTEXT}${path === '' ? '' : `/${path}`}`;

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

/**
 * Five passages: three placed in a job, one in the description, and one that
 * belongs to no piece (the thesis).
 */
const passages = (revision: number): ChunkHit[] => [
  hit(revision, 0, `Rewrote the billing pipeline. ${CANARY.acme}`, { section: 'experience', entry: 0, company: 'Acme', title: 'Senior Engineer' }),
  hit(revision, 1, `Built the design system. ${CANARY.globex}`, { section: 'experience', entry: 1, company: 'Globex', title: 'Engineer' }),
  hit(revision, 2, BODY.role_description, { section: 'role_description' }),
  hit(revision, 3, `Compilers ${CANARY.thesis}`, { section: 'education' }),
  hit(revision, 4, 'An earlier stint.', { section: 'experience', entry: 2, company: 'Acme', title: 'Senior Engineer' })
];

const texts = (hits: readonly { readonly text: string }[]): string[] => hits.map((each) => each.text);

/** The CV as the model is shown it when these jobs are cut. */
const without = (...jobs: number[]) => ({
  ...BODY,
  experience: BODY.experience.filter((_, index) => !jobs.includes(index))
});

/* ------------------------------------------------------------------ the cut */

test('with nothing excluded the view is the document itself, whatever walls exist for other things', () => {
  const view = cvView(DOCUMENT, [], CONTEXT);
  assert.equal(view.shown, DOCUMENT);
  assert.equal(view.original, DOCUMENT);
  assert.equal(view.walled, false);
  assert.deepEqual(view.keys.experience, [ACME, GLOBEX, ACME_2]);
  assert.deepEqual(view.rows.experience, [0, 1, 2]);

  // A wall on another CV, on another well, or on a piece this CV does not have, cuts nothing.
  for (const other of [
    walls(`cv:elsewhere/experience/${GLOBEX}`),
    walls(`tickets:${CONTEXT}/experience/${GLOBEX}`),
    walls(ref('experience/nobody~nothing'), ref('overview/nothing'), ref('hobbies'))
  ]) {
    const same = cvView(DOCUMENT, other, CONTEXT);
    assert.equal(same.shown, DOCUMENT, JSON.stringify(other));
    assert.equal(same.walled, false);
    assert.deepEqual(same.rows.experience, [0, 1, 2]);
  }
});

test('an excluded job is taken out, and the ones left keep the keys they are stored under', () => {
  const view = cvView(DOCUMENT, walls(ref(`experience/${ACME}`)), CONTEXT);

  assert.equal(view.walled, true);
  assert.deepEqual(view.shown.experience, [BODY.experience[1], BODY.experience[2]]);
  assert.deepEqual(view.rows.experience, [1, 2]);
  assert.deepEqual(view.keys.experience, [GLOBEX, ACME_2]);
  assert.deepEqual(view.withheld.entries.experience, [{ index: 0, entry: BODY.experience[0] }]);

  // The point of carrying the keys: worked out from what is left, the last job
  // would be called `acme~senior-engineer` and a record would name the wrong one.
  assert.deepEqual(cvKeys(view.shown).experience, [GLOBEX, ACME]);

  // Nothing else was touched, and what was cut is a copy that the document cannot change.
  assert.deepEqual(view.shown.education, DOCUMENT.education);
  assert.deepEqual(view.shown.personal, BODY.personal);
  assert.notEqual(view.withheld.entries.experience[0]?.entry, DOCUMENT.experience[0]);
});

test('an excluded item of the overview is emptied in the document and remembered', () => {
  const blank = emptyDocument();

  const description = cvView(DOCUMENT, walls(ref('overview/role_description')), CONTEXT);
  assert.equal(description.shown.role_description, blank.role_description);
  assert.deepEqual(description.shown.personal, BODY.personal);
  assert.deepEqual(description.shown.skills, BODY.skills);
  assert.deepEqual(description.withheld.items, { role_description: BODY.role_description });

  const personal = cvView(DOCUMENT, walls(ref('overview/personal')), CONTEXT);
  assert.deepEqual(personal.shown.personal, blank.personal);
  assert.equal(personal.shown.role_description, BODY.role_description);

  const overview = cvView(DOCUMENT, walls(ref('overview')), CONTEXT);
  assert.deepEqual(overview.shown.personal, blank.personal);
  assert.equal(overview.shown.role_description, blank.role_description);
  assert.deepEqual(overview.shown.skills, blank.skills);
  assert.deepEqual(Object.keys(overview.withheld.items).sort(), ['personal', 'role_description', 'skills']);
  assert.deepEqual(overview.shown.experience, BODY.experience, 'the lists are not part of the overview');
});

test('a whole section goes, and the whole CV goes with the account of where it came from', () => {
  const section = cvView(DOCUMENT, walls(ref('experience')), CONTEXT);
  assert.deepEqual(section.shown.experience, []);
  assert.deepEqual(section.rows.experience, []);
  assert.deepEqual(section.keys.experience, []);
  assert.equal(section.withheld.entries.experience.length, 3);
  assert.deepEqual(section.shown.sources, BODY.sources, 'a section is not the whole CV');

  const everything = cvView(DOCUMENT, walls(ref()), CONTEXT);
  assert.deepEqual(everything.shown, {
    ...emptyDocument(),
    version: DOCUMENT.version
  });
  assert.deepEqual(everything.withheld.sources, BODY.sources);
  for (const section of ['experience', 'education', 'certificates', 'languages'] as const) {
    assert.deepEqual(everything.shown[section], [], section);
    assert.deepEqual(everything.rows[section], [], section);
  }
});

test('putting back what was cut gives the stored document, whichever walls cut it', () => {
  const sets = [
    [ref(`experience/${ACME}`)],
    [ref(`experience/${ACME}`), ref(`experience/${ACME_2}`)],
    [ref(`experience/${GLOBEX}`), ref('overview/personal')],
    [ref('experience')],
    [ref('education'), ref('certificates'), ref('languages/polish')],
    [ref('overview')],
    [ref()],
    [ref('overview/skills'), ref('languages/english'), ref(`experience/${ACME_2}`)]
  ];

  for (const set of sets) {
    const view = cvView(DOCUMENT, walls(...set), CONTEXT);
    assert.equal(view.walled, true, set.join(' '));
    assert.deepEqual(restoreCv(view.shown, view.withheld), BODY, set.join(' '));
  }
});

test('an edit of what is left changes that and nothing that was cut', () => {
  const view = cvView(DOCUMENT, walls(ref(`experience/${GLOBEX}`), ref('overview/role_description'), ref('overview/personal')), CONTEXT);

  const edited = {
    ...view.shown,
    // The model writes into the places it was shown as empty, and changes a job.
    role_description: 'A new description the model wrote.',
    personal: { ...view.shown.personal, name: 'Someone Else' },
    experience: [{ ...view.shown.experience[0], title: 'Staff Engineer' }, view.shown.experience[1]]
  } as CvDocument;
  const whole = restoreCv(edited, view.withheld);

  assert.equal(whole.role_description, BODY.role_description, 'the model has no say in what it was not shown');
  assert.deepEqual(whole.personal, BODY.personal);
  assert.deepEqual(whole.experience, [
    { ...BODY.experience[0], title: 'Staff Engineer' },
    BODY.experience[1],
    BODY.experience[2]
  ]);
});

test('an entry goes back at the place it had, and at the end when the list is now shorter', () => {
  const view = cvView(DOCUMENT, walls(ref(`experience/${ACME}`), ref(`experience/${GLOBEX}`)), CONTEXT);
  assert.deepEqual(view.withheld.entries.experience.map((cut) => cut.index), [0, 1]);

  const kept = restoreCv(view.shown, view.withheld);
  assert.deepEqual(kept.experience.map((job) => job.company), ['Acme', 'Globex', 'Acme']);

  // The model emptied the list it was shown: both come back, in the order they had.
  const emptied = restoreCv({ ...view.shown, experience: [] }, view.withheld);
  assert.deepEqual(emptied.experience, [BODY.experience[0], BODY.experience[1]]);

  const last = cvView(DOCUMENT, walls(ref(`experience/${ACME_2}`)), CONTEXT);
  const shortened = restoreCv({ ...last.shown, experience: [] }, last.withheld);
  assert.deepEqual(shortened.experience, [BODY.experience[2]]);
});

test('an edit has something to work on while some of its section is left, and not when none is', () => {
  const cases: [string, string[], boolean][] = [
    ['skills', [], false],
    ['skills', [ref('overview/skills')], true],
    ['skills', [ref('overview')], true],
    ['skills', [ref('overview/personal')], false],
    ['personal', [ref('overview/personal')], true],
    ['role_description', [ref('overview/role_description')], true],
    ['role_description', [ref('overview/personal')], false],
    ['experience', [ref(`experience/${GLOBEX}`)], false],
    ['experience', [ref(`experience/${ACME}`), ref(`experience/${GLOBEX}`)], false],
    ['experience', [ref(`experience/${ACME}`), ref(`experience/${GLOBEX}`), ref(`experience/${ACME_2}`)], true],
    ['experience', [ref('experience')], true],
    ['experience', [ref()], true],
    ['education', [ref('experience')], false],
    ['education', [ref('education')], true],
    ['languages', [ref('languages/polish')], false],
    ['languages', [ref('languages/polish'), ref('languages/english')], true]
  ];

  for (const [section, set, expected] of cases) {
    assert.equal(cvTargetWalled(walls(...set), CONTEXT, section, DOCUMENT), expected, `${section} under ${set.join(' ')}`);
  }

  // A section with nothing in it has nothing excluded in it, unless the section is.
  const bare = cvOf({ ...BODY, certificates: [] }) as CvDocument;
  assert.equal(cvTargetWalled(walls(ref(`experience/${GLOBEX}`)), CONTEXT, 'certificates', bare), false);
  assert.equal(cvTargetWalled(walls(ref('certificates')), CONTEXT, 'certificates', bare), true);

  // Walls that name another CV are not this one's.
  assert.equal(cvTargetWalled(walls(`cv:elsewhere/overview/skills`), CONTEXT, 'skills', DOCUMENT), false);
});

/* ---------------------------------------------------------------- the ports */

type Ports = {
  documents: DocumentStore;
  retrieval: Retriever;
  index: ChunkIndex;
  /** What was written through the documents port, and what the mutator was shown. */
  readonly writes: { id: string; kind: string; shown: unknown; options: unknown }[];
  /** The index calls that were forwarded. */
  readonly forwarded: string[];
};

/** Ports over one stored CV, returning five passages from a search and from either half of the index. */
const ports = (body: Record<string, unknown> = BODY): Ports => {
  const writes: Ports['writes'] = [];
  const forwarded: string[] = [];
  let stored: DocumentRecord = { id: CV_ID, kind: CV_KIND, revision: 7, body, createdAt: 1, updatedAt: 1 };
  const notes: DocumentRecord = { id: 'notes', kind: 'notes', revision: 1, body: { text: CANARY.globex }, createdAt: 1, updatedAt: 1 };
  const chunks = (): ScoredChunk[] => passages(7);

  return {
    writes,
    forwarded,
    documents: {
      read: (id) => (id === CV_ID ? stored : id === 'notes' ? notes : undefined),
      update: (id, kind, mutate, options) => {
        writes.push({ id, kind, shown: stored.body, options });
        stored = { ...stored, revision: stored.revision + 1, body: mutate(stored.body) };
        return stored;
      }
    },
    retrieval: { search: async () => passages(7) },
    index: {
      lexical: chunks,
      neighbours: chunks,
      fingerprintOf: (id) => {
        forwarded.push(`fingerprintOf ${id}`);
        return undefined;
      },
      replace: (id) => {
        forwarded.push(`replace ${id}`);
        return 0;
      },
      clear: (id) => {
        forwarded.push(`clear ${id}`);
        return 0;
      },
      keepText: (id) => {
        forwarded.push(`keepText ${id}`);
        return 0;
      }
    }
  };
};

/** Walls a test can change between two reads. */
const changing = (initial: PieceRef[] = []): Walls & { set(next: PieceRef[]): void } => {
  let current = initial;
  return { pieces: () => current, set: (next) => void (current = next) };
};

const asked = { text: 'billing', limit: 10 } as const;

const FINGERPRINT = { provider: 'p', model: 'm', dim: 1, normalisation: 'none', chunkerVersion: 1 } as const;

test('a documents port with nothing excluded hands back the record it was asked for', () => {
  const under = ports();
  const behind = wallPorts(under, changing(), CONTEXT);

  assert.equal(behind.documents.read(CV_ID), under.documents.read(CV_ID));

  // Walls that name something else leave it as it was too.
  const elsewhere = wallPorts(under, changing(walls('cv:elsewhere/overview', ref('experience/nobody~nothing'))), CONTEXT);
  assert.equal(elsewhere.documents.read(CV_ID), under.documents.read(CV_ID));
  assert.equal(elsewhere.documents.read('missing'), undefined);
});

test('a documents port cuts the CV, and says what it was cut from', () => {
  const under = ports();
  const behind = wallPorts(under, changing(walls(ref(`experience/${GLOBEX}`), ref('overview/role_description'))), CONTEXT);

  const cut = behind.documents.read(CV_ID);
  assert.ok(cut);
  assert.equal(cut.revision, 7, 'it is the revision the store holds');
  assert.equal(cut.kind, CV_KIND);
  assert.deepEqual(cut.body, {
    ...without(1),
    role_description: ''
  });

  // Nothing reading `body` can see what was cut: not the canaries, whatever the path.
  for (const secret of [CANARY.globex, CANARY.summary]) assert.ok(!JSON.stringify(cut).includes(secret), secret);
  assert.ok(JSON.stringify(cut).includes(CANARY.acme));

  // The record remembers what it was cut from, and the stored document is not what it held.
  assert.deepEqual(storedCv(cut), BODY);
  assert.deepEqual(viewOf(cut)?.keys.experience, [ACME, ACME_2]);
  assert.deepEqual(viewOf(cut)?.rows.experience, [0, 2]);
  assert.deepEqual(under.documents.read(CV_ID)?.body, BODY, 'the store was not touched');
});

test('what is excluded is read again at every access', () => {
  const live = changing();
  const behind = wallPorts(ports(), live, CONTEXT);

  assert.equal(behind.documents.read(CV_ID)?.body.experience instanceof Array && (behind.documents.read(CV_ID)?.body.experience as unknown[]).length, 3);

  live.set(walls(ref(`experience/${GLOBEX}`)));
  assert.equal((behind.documents.read(CV_ID)?.body.experience as unknown[]).length, 2);

  live.set(walls(ref(`experience/${GLOBEX}`), ref(`experience/${ACME}`)));
  assert.equal((behind.documents.read(CV_ID)?.body.experience as unknown[]).length, 1);

  live.set([]);
  assert.equal((behind.documents.read(CV_ID)?.body.experience as unknown[]).length, 3, 'including it again lifts the wall');
});

test('a write goes to the stored document, and what is excluded is not cut out of it', () => {
  const under = ports();
  const behind = wallPorts(under, changing(walls(ref(`experience/${GLOBEX}`))), CONTEXT);

  const written = behind.documents.update(CV_ID, CV_KIND, (current) => ({ ...current, version: 1 }), { expectedRevision: 7 });

  assert.deepEqual(under.writes, [{ id: CV_ID, kind: CV_KIND, shown: BODY, options: { expectedRevision: 7 } }]);
  assert.deepEqual(written.body.experience, BODY.experience, 'the write kept the job that is excluded');
});

test('a document that is not a CV is not cut, and a CV that cannot be read is not guessed at', () => {
  const behind = wallPorts(ports(), changing(walls(ref(), `cv:elsewhere/overview`)), CONTEXT);
  const notes = behind.documents.read('notes');
  assert.deepEqual(notes?.body, { text: CANARY.globex }, 'the walls are about a CV');

  const broken = ports({ experience: 'not a list' });
  const walled = wallPorts(broken, changing(walls(ref(`experience/${GLOBEX}`))), CONTEXT);
  assert.throws(() => walled.documents.read(CV_ID), (error: Error & { code?: string }) => error.code === 'walled_unreadable');

  // With nothing excluded there is nothing to tell apart, so it reads as it always did,
  // and so it does when what is excluded is another CV's or another well's.
  for (const other of [[], walls('cv:elsewhere/overview/skills'), walls(`tickets:${CONTEXT}/overview/skills`)]) {
    const open = wallPorts(broken, changing(other), CONTEXT);
    assert.deepEqual(open.documents.read(CV_ID)?.body, { experience: 'not a list' }, JSON.stringify(other));
  }
});

test('a search and both halves of the index drop the passages of what is excluded', async () => {
  const live = changing();
  const behind = wallPorts(ports(), live, CONTEXT);
  const everything = texts(passages(7));
  const search = async () => texts(await behind.retrieval.search(asked, new AbortController().signal));
  const lexical = () => texts(behind.index.lexical(asked));
  const neighbours = () => texts(behind.index.neighbours({ ...asked, vector: new Float32Array(1), fingerprint: FINGERPRINT }));

  assert.deepEqual(await search(), everything, 'nothing excluded, nothing dropped');
  assert.deepEqual(lexical(), everything);
  assert.deepEqual(neighbours(), everything);

  live.set(walls(ref(`experience/${GLOBEX}`), ref('overview/role_description')));
  const left = [passages(7)[0]?.text, passages(7)[4]?.text];
  assert.deepEqual(await search(), left);
  assert.deepEqual(lexical(), left);
  assert.deepEqual(neighbours(), left);

  // Read again, like the document.
  live.set([]);
  assert.deepEqual(await search(), everything);
});

test('a passage that cannot be placed is dropped while something of the CV is excluded, and not otherwise', async () => {
  const live = changing(walls(ref('overview/skills')));
  const behind = wallPorts(ports(), live, CONTEXT);
  const search = async () => texts(await behind.retrieval.search(asked, new AbortController().signal));

  // The thesis belongs to no piece. Whether it came from something excluded is
  // not known, and a CV with something excluded is a reason not to guess.
  const found = await search();
  assert.ok(!found.includes(`Compilers ${CANARY.thesis}`));
  assert.equal(found.length, 4);

  // Walls that name a piece the CV does not have exclude nothing of it.
  live.set(walls(ref('hobbies'), ref('experience/nobody~nothing')));
  assert.deepEqual(await search(), texts(passages(7)));

  // Walls that name another CV are not this one's.
  live.set(walls('cv:elsewhere/overview/skills'));
  assert.deepEqual(await search(), texts(passages(7)));
});

test('a passage placed in a job the document no longer has there is dropped, not trusted', async () => {
  // The index was built before the second job was renamed, so its passage says Globex and the document says Initech.
  const renamed = { ...BODY, experience: [BODY.experience[0], { ...BODY.experience[1], company: 'Initech' }, BODY.experience[2]] };
  const behind = wallPorts(ports(renamed), changing(walls(ref('overview/skills'))), CONTEXT);

  const found = texts(await behind.retrieval.search(asked, new AbortController().signal));
  assert.ok(!found.includes(`Built the design system. ${CANARY.globex}`));
  assert.ok(found.includes('An earlier stint.'));
});

test('a search with no CV to place its passages in returns nothing while anything is excluded', async () => {
  const under = ports();
  const empty: DocumentStore = { ...under.documents, read: () => undefined };
  const behind = wallPorts({ ...under, documents: empty }, changing(walls(ref('overview/skills'))), CONTEXT);

  assert.deepEqual(await behind.retrieval.search(asked, new AbortController().signal), []);
  assert.deepEqual(behind.index.lexical(asked), []);
});

test('what only changes the index is not cut', () => {
  const under = ports();
  const behind = wallPorts(under, changing(walls(ref())), CONTEXT);

  behind.index.fingerprintOf(CV_ID);
  behind.index.replace(CV_ID, FINGERPRINT, [], { expectedRevision: 7 });
  behind.index.clear(CV_ID, { expectedRevision: 7 });
  behind.index.keepText(CV_ID, [], { expectedRevision: 7 });

  assert.deepEqual(under.forwarded, [`fingerprintOf ${CV_ID}`, `replace ${CV_ID}`, `clear ${CV_ID}`, `keepText ${CV_ID}`]);
});

/* ------------------------------------------------------------------- runtime */

type Call = (tool: string, input: unknown) => Promise<unknown>;
type Received = { readonly tool: string; readonly input: unknown; readonly result: unknown };

type Options = {
  /** Capabilities that exist only in a test, next to the real ones. */
  readonly probes?: CapabilityMap;
  /** What the model does inside the tool loop. By default it answers at once. */
  readonly loop?: (request: ToolLoopRequest, call: Call) => Promise<string>;
  /** Answers of the structured calls `edit_cv` and `translate_cv` make, by step. */
  readonly answers?: Readonly<Record<string, unknown>>;
  /** `false` builds a runtime that keeps no selections. */
  readonly selection?: boolean;
  readonly on?: Scratch;
};

type Runtime = {
  readonly s: Spine;
  readonly records: ReturnType<typeof createRecordStore>;
  readonly selections: ReturnType<typeof createSelectionStore>;
  /** Every request any model call was made with, as the text it carried. */
  readonly payloads: string[];
  /** What each tool returned to the model. */
  readonly received: Received[];
  /** Everything the model was handed, whichever way it came. */
  everything(): string;
  /** Excludes pieces of the conversation, as a window would. */
  exclude(...refs: string[]): void;
  begin(input: Record<string, unknown>, capability?: string, over?: Omit<RunRequest, 'capability' | 'input'>): RunHandle;
  resume(runId: string): Promise<{ readonly data: Record<string, unknown> }>;
  dispose(): void;
};

const CHAT_RUN = { contextId: CONTEXT, conversationId: CHAT } as const;

const runtime = (options: Options = {}): Runtime => {
  const payloads: string[] = [];
  const received: Received[] = [];
  const taken = (request: { system?: string; prompt?: string; history?: unknown }): void => {
    payloads.push(JSON.stringify({ system: request.system, prompt: request.prompt, history: request.history }));
  };

  const call = (request: ToolLoopRequest): Call => async (name, input) => {
    const tool = request.tools.find((each) => each.name === name);
    assert.ok(tool, `the model was not granted ${name}`);
    const result = await tool.invoke(input);
    received.push({ tool: name, input, result });
    return result;
  };

  const s = spine({ ...capabilities, ...options.probes }, {
    ai: {
      generateObject: async (request) => {
        taken(request);
        const object = request.step === 'plan' ? { tools: ['search_profile', 'read_cv'] } : options.answers?.[request.step ?? ''];
        assert.ok(object !== undefined, `nothing answers the step ${request.step ?? '(none)'}`);
        return { object: object as never, finishReason: 'stop', usage: {} };
      },
      generateText: async (request) => {
        taken(request);
        return { text: 'x', finishReason: 'stop', usage: {} };
      },
      runToolLoop: async (request) => {
        taken(request);
        const text = await (options.loop ?? (async () => 'An answer.'))(request, call(request));
        return { text, steps: 1, finishReason: 'stop', usage: {} };
      }
    },
    tools: createToolRegistry(defaultTools),
    ...(options.on === undefined ? {} : { on: options.on })
  });
  // A tool loop's payload is what it is told. What its tools return to it is kept in `received`.

  const generation = (): number =>
    (s.db.prepare('SELECT generation FROM cv_contexts WHERE id = ?').get(CONTEXT) as { generation: number }).generation;
  const revision = (): number => s.deps.documents.read(CONTEXT)?.revision ?? 0;

  if (options.on === undefined) {
    s.db.prepare("INSERT INTO cv_contexts (id, language, created_at, updated_at) VALUES (?, 'en', 1, 1)").run(CONTEXT);
    const conversation = s.db.prepare(
      'INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1)'
    );
    conversation.run(CHAT, 'profile', CONTEXT);
    conversation.run(OFFER_CHAT, 'offer', OFFER);
    s.deps.documents.update(CONTEXT, CV_KIND, () => BODY);
    s.db
      .prepare(
        'INSERT INTO offer_snapshots (id, offer_id, context_id, conversation_id, request, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, 1)'
      )
      .run(SNAPSHOT, OFFER, CONTEXT, OFFER_CHAT, '{}', JSON.stringify({ context: { generation: generation() }, document: { revision: revision() } }));
  }

  const retrieval: Retriever = { search: async () => passages(revision()) };
  const bound = () => bindCvScope(CONTEXT, { documents: s.deps.documents, retrieval, index: s.deps.index });
  const selections = createSelectionStore(s.db);

  const deps: RuntimeDeps = {
    ...s.deps,
    scopeCv: () => ({ ...bound(), contextGeneration: generation(), contextRevision: revision() }),
    scopeOffer: () => ({
      ...bound(),
      effects: s.deps.effects,
      offerId: OFFER,
      contextGeneration: generation(),
      contextRevision: revision()
    }),
    offerInput: (_snapshot, _capability, input) => ({ ...(input as Record<string, unknown>), offerText: 'A Go engineer.' }),
    grounding: { records: createRecordStore(s.db), wells: defaultWells() },
    ...(options.selection === false ? {} : { selection: selections })
  };

  return {
    s,
    records: createRecordStore(s.db),
    selections,
    payloads,
    received,
    everything: () => `${payloads.join('\n')}\n${JSON.stringify(received.map((each) => each.result))}`,
    exclude: (...refs) => {
      const { revision: expectedRevision } = selections.read(CHAT);
      const { applied } = selections.change(CHAT, { expectedRevision, exclude: refs, clear: [] });
      assert.ok(applied);
    },
    begin: (input, capability = 'ask_profile', over = CHAT_RUN) => beginRun(deps, { capability, input, ...over }),
    resume: (runId) => resumeRun(deps, { runId }) as Promise<{ readonly data: Record<string, unknown> }>,
    dispose: () => s.dispose()
  };
};

const question = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  question: 'What did I do with billing?',
  ...over
});

/** The model's visit to the CV: every section, and a search that finds all five passages. */
const touring: NonNullable<Options['loop']> = async (_request, call) => {
  await call('read_cv', { section: 'overview' });
  await call('read_cv', { section: 'experience' });
  await call('read_cv', { section: 'education' });
  await call('read_cv', { section: 'certificates' });
  await call('read_cv', { section: 'languages' });
  await call('search_profile', { query: 'billing' });
  return 'You did billing at Acme.';
};

/** What `read_cv` and `search_profile` return, as far as these tests look at it. */
type Result = {
  readonly data: { readonly total: number; readonly items: readonly { readonly company: string }[] } & Record<string, unknown>;
  readonly results: readonly { readonly text: string }[];
};

const resultOf = (rt: Runtime, tool: string, nth = 0): Result => {
  const found = rt.received.filter((each) => each.tool === tool)[nth];
  assert.ok(found, `${tool} was not called ${nth + 1} times`);
  return found.result as Result;
};

/** The entries a run's record holds for one channel, as the ref and the digest of what was read. */
const entriesVia = (rt: Runtime, run: RunHandle, via: string) =>
  (rt.records.read(run.runId)?.entries ?? []).filter((each) => each.via === via);

/* ---------------------------------------------------------------- a chat run */

test('the text of what is excluded reaches the model by no door, and the rest still does', async () => {
  const rt = runtime({ loop: touring });
  try {
    rt.exclude(ref(`experience/${GLOBEX}`), ref('overview/role_description'), ref('education'));
    const run = rt.begin(question());
    await run.settled;

    const seen = rt.everything();
    for (const [piece, canary] of [['the second job', CANARY.globex], ['the description', CANARY.summary], ['the thesis', CANARY.thesis]]) {
      assert.ok(!seen.includes(canary as string), `${piece} reached the model`);
    }
    // What was not excluded, by the same doors.
    for (const canary of [CANARY.acme, CANARY.home]) assert.ok(seen.includes(canary), `${canary} was cut though nothing excluded it`);

    assert.equal(resultOf(rt, 'read_cv', 1).data.total, 2, 'the list says how many of its entries there are to read');
    assert.deepEqual(
      resultOf(rt, 'read_cv', 1).data.items.map((job: { company: string }) => job.company),
      ['Acme', 'Acme']
    );
    assert.equal(resultOf(rt, 'read_cv', 2).data.total, 0, 'an excluded section is a list with nothing in it');
    assert.equal(resultOf(rt, 'read_cv', 3).data.total, 1);

    // The passages that are left are the two jobs that are not excluded.
    assert.deepEqual(
      resultOf(rt, 'search_profile').results.map((passage: { text: string }) => passage.text),
      [`Rewrote the billing pipeline. ${CANARY.acme}`, 'An earlier stint.']
    );
  } finally {
    rt.dispose();
  }
});

test('an item of the overview that is excluded is left out of what the model reads, not blanked', async () => {
  const rt = runtime({ loop: touring });
  try {
    rt.exclude(ref('overview/personal'));
    await rt.begin(question()).settled;

    const overview = resultOf(rt, 'read_cv', 0).data;
    assert.deepEqual(Object.keys(overview), ['version', 'role_description', 'skills']);
    assert.ok(!rt.everything().includes(CANARY.home));
    assert.ok(!rt.everything().includes('ada@example.com'));
    assert.ok(rt.everything().includes(CANARY.summary), 'the rest of the overview is there');
  } finally {
    rt.dispose();
  }
});

test('with the whole CV excluded the model is handed no text of it, by any call', async () => {
  const rt = runtime({ loop: touring });
  try {
    rt.exclude(ref());
    await rt.begin(question()).settled;

    // Everything is excluded: the model has been handed no text of the CV at all.
    const seen = rt.everything();
    for (const canary of Object.values(CANARY)) assert.ok(!seen.includes(canary), canary);
    assert.ok(!seen.includes('Ada Example'));
    assert.ok(!seen.includes('billing systems'));
    assert.equal(resultOf(rt, 'read_cv', 1).data.total, 0);
    assert.deepEqual(resultOf(rt, 'search_profile').results, []);
  } finally {
    rt.dispose();
  }
});

test('a record names an entry by the key it is stored under, and records what the document was and what was shown of it', async () => {
  const rt = runtime({
    loop: async (_request, call) => {
      await call('read_cv', { section: 'experience' });
      return 'Two jobs.';
    }
  });
  try {
    rt.exclude(ref(`experience/${ACME}`));
    const run = rt.begin(question());
    await run.settled;

    // Worked out from what the model was shown, the last job would be `acme~senior-engineer`.
    const handed = entriesVia(rt, run, 'tool:read_cv').map((each) => [each.ref, each.digest]);
    assert.deepEqual(handed, [
      [ref(`experience/${GLOBEX}`), digest(BODY.experience[1])],
      [ref(`experience/${ACME_2}`), digest(BODY.experience[2])]
    ]);

    // The CV was read from the store whole and the model was shown less of it.
    const [read] = entriesVia(rt, run, 'port:documents');
    assert.ok(read);
    assert.equal(read.ref, ref());
    assert.equal(read.digest, digest(BODY));
    assert.equal(read.shown, digest(without(0)));
    assert.equal(read.status, 'read');
  } finally {
    rt.dispose();
  }
});

test('what the model was not shown of the overview is not recorded as handed to it', async () => {
  const rt = runtime({
    loop: async (_request, call) => {
      await call('read_cv', { section: 'overview' });
      return 'Seen.';
    }
  });
  try {
    rt.exclude(ref('overview/role_description'));
    const run = rt.begin(question());
    await run.settled;

    const handed = entriesVia(rt, run, 'tool:read_cv').map((each) => each.ref);
    assert.deepEqual(handed, [ref('overview/personal'), ref('overview/skills')]);
  } finally {
    rt.dispose();
  }
});

test('a passage is placed in the stored document, so the record names the job it came from', async () => {
  const rt = runtime({
    loop: async (_request, call) => {
      await call('search_profile', { query: 'billing' });
      return 'Found.';
    }
  });
  try {
    rt.exclude(ref(`experience/${ACME}`));
    const run = rt.begin(question());
    await run.settled;

    // The last passage is the third job's. Placed in the document the model was shown,
    // it would be taken for the first, which is the one that is excluded.
    const handed = entriesVia(rt, run, 'tool:search_profile').map((each) => each.ref);
    assert.ok(handed.includes(ref(`experience/${ACME_2}`)), handed.join(' '));
    assert.ok(!handed.includes(ref(`experience/${ACME}`)), handed.join(' '));
    assert.ok(handed.includes(ref(`experience/${GLOBEX}`)), 'the second job is not excluded and its passage is placed');
  } finally {
    rt.dispose();
  }
});

test('an exclusion made while the model is working is honoured by what it reads next', async () => {
  const rt = runtime({
    loop: async (_request, call) => {
      await call('read_cv', { section: 'experience' });
      await call('search_profile', { query: 'billing' });
      rt.exclude(ref(`experience/${GLOBEX}`));
      await call('read_cv', { section: 'experience' });
      await call('search_profile', { query: 'billing' });
      return 'Done.';
    }
  });
  try {
    await rt.begin(question()).settled;

    assert.equal(resultOf(rt, 'read_cv', 0).data.total, 3);
    assert.equal(resultOf(rt, 'read_cv', 1).data.total, 2, 'the next read is already cut');
    const before = resultOf(rt, 'search_profile', 0).results.map((passage: { text: string }) => passage.text);
    const after = resultOf(rt, 'search_profile', 1).results.map((passage: { text: string }) => passage.text);
    assert.ok(before.some((text: string) => text.includes(CANARY.globex)));
    assert.ok(!after.some((text: string) => text.includes(CANARY.globex)));
  } finally {
    rt.dispose();
  }
});

/** How many jobs the CV a run reads has. */
const jobsIn = (documents: DocumentStore): number => {
  const body = documents.read(CV_ID)?.body;
  return (body === undefined ? undefined : cvOf(body))?.experience.length ?? -1;
};

/** A run that reads the CV, waits for a person, and reads it again. */
const waiting = (): CapabilityMap => {
  const read = (context: { documents: DocumentStore; walls?: Walls }) => {
    return { jobs: jobsIn(context.documents), walls: context.walls?.pieces().length ?? null };
  };

  return {
    probe: noop('probe', [
      stage('before', [transform('first', async (context) => ({ before: read(context) }))]),
      stage('ask', [
        transform('confirm', async (context) => {
          const decision = context.approvals.request({ key: 'go', kind: 'confirm', question: 'Go on?', payload: {} });
          return { went: decision.status };
        })
      ]),
      stage('after', [transform('second', async (context) => ({ after: read(context) }))])
    ])
  };
};

test('a run that waited for a person honours what was excluded while it waited, in a process that opens the same file', async () => {
  const first = runtime({ probes: waiting() });
  let second: Runtime | undefined;
  try {
    const run = first.begin({}, 'probe');
    await assert.rejects(run.settled, (error: unknown) => isRunSuspension(error));

    // Excluded while the run is parked, by a window that has nothing to do with the process.
    first.exclude(ref(`experience/${GLOBEX}`));
    const [approval] = first.s.approvals.pending(run.runId);
    assert.ok(approval);
    first.s.approvals.decide(approval.id, { status: 'granted', decision: { confirmed: true }, decidedAt: Date.now() });

    second = runtime({ on: first.s.scratch, probes: waiting() });
    const result = await second.resume(run.runId);

    assert.deepEqual(result.data.before, { jobs: 3, walls: 0 }, 'what it read before the wait was read before the exclusion');
    assert.deepEqual(result.data.after, { jobs: 2, walls: 1 }, 'what it reads after is cut');
  } finally {
    second?.dispose();
    first.dispose();
  }
});

test('a run is given the same payloads with no exclusions as it was before there were any', async () => {
  const everythingOf = async (options: Options, exclude: string[] = []) => {
    const rt = runtime({ loop: touring, ...options });
    try {
      rt.exclude(...exclude);
      const run = rt.begin(question());
      await run.settled;
      return { seen: rt.everything(), record: entriesVia(rt, run, 'tool:read_cv').map((each) => [each.ref, each.digest, each.shown]) };
    } finally {
      rt.dispose();
    }
  };

  const before = await everythingOf({ selection: false });
  const none = await everythingOf({});
  assert.equal(none.seen, before.seen);
  assert.deepEqual(none.record, before.record);

  // A wall that names another CV is not this one's.
  const elsewhere = await everythingOf({}, ['cv:elsewhere/experience', `cv:elsewhere/overview/skills`]);
  assert.equal(elsewhere.seen, before.seen);
  assert.deepEqual(elsewhere.record, before.record);

  // A wall that names a piece this CV does not have excludes nothing of it, so
  // the model reads the CV as it was.
  const gone = await everythingOf({}, [ref('experience/nobody~nothing'), ref('hobbies')]);
  assert.deepEqual(gone.record, before.record);
  assert.deepEqual(gone.seen, before.seen);
});

/* ------------------------------------------------------------- what it binds */

const looking = (): CapabilityMap => ({
  probe: noop('probe', [
    stage('only', [
      transform('look', async (context) => ({
        walls: context.walls === undefined ? null : context.walls.pieces().map((wall) => wall.path.join('/')),
        jobs: jobsIn(context.documents)
      }))
    ])
  ])
});

test('only a run in a conversation of a CV has walls, and the walls are that conversation\'s', async () => {
  const rt = runtime({ probes: looking() });
  try {
    rt.exclude(ref(`experience/${GLOBEX}`));
    // Another conversation's exclusions are not this one's.
    rt.selections.change(OFFER_CHAT, { expectedRevision: 0, exclude: [ref(`experience/${ACME}`)], clear: [] });

    const live = await rt.begin({}, 'probe').settled;
    assert.deepEqual(live.data, { walls: [`experience/${GLOBEX}`], jobs: 2 });

    const bare = await rt.begin({}, 'probe', { contextId: CONTEXT }).settled;
    assert.deepEqual(bare.data, { walls: null, jobs: 3 }, 'a run in no conversation reads the CV as it is');

    // A run about a saved offer reads a copy of the CV captured with it, and nothing names that.
    const snapshot = await rt.begin({}, 'probe', { offerSnapshotId: SNAPSHOT, contextId: CONTEXT, conversationId: OFFER_CHAT }).settled;
    assert.deepEqual(snapshot.data, { walls: null, jobs: 3 });
  } finally {
    rt.dispose();
  }
});

test('a runtime that keeps no selections gives a run no walls', async () => {
  const rt = runtime({ probes: looking(), selection: false });
  try {
    rt.exclude(ref(`experience/${GLOBEX}`));
    const run = await rt.begin({}, 'probe').settled;
    assert.deepEqual(run.data, { walls: null, jobs: 3 });
  } finally {
    rt.dispose();
  }
});

test('the index a run reads is cut like the documents', async () => {
  const lexical = noop('probe', [
    stage('only', [
      transform('look', async (context) => ({
        found: context.index.lexical({ text: 'zebra', documentId: CV_ID, limit: 10 }).map((chunk) => chunk.text)
      }))
    ])
  ]);
  const rt = runtime({ probes: { probe: lexical } });
  try {
    const revision = rt.s.deps.documents.read(CONTEXT)?.revision ?? 0;
    rt.s.chunks.keepText(
      CONTEXT,
      passages(revision).map((chunk) => ({ id: chunk.id, kind: chunk.kind, text: chunk.text, position: chunk.position, meta: chunk.meta })),
      { expectedRevision: revision }
    );

    const all = await rt.begin({}, 'probe').settled;
    assert.equal((all.data.found as string[]).length, 4, 'the passages that say the word, with nothing excluded');

    rt.exclude(ref(`experience/${GLOBEX}`), ref('overview/role_description'));
    const left = await rt.begin({}, 'probe').settled;
    assert.deepEqual(left.data.found, [`Rewrote the billing pipeline. ${CANARY.acme}`]);
  } finally {
    rt.dispose();
  }
});

/* ------------------------------------------------------ the production runtime */

test('the production runtime gives a run in a conversation the walls of that conversation', async () => {
  const s = scratch();
  const cv = createCvContextStore(s.db).create(randomUUID(), 'en');
  const probe = noop('probe', [
    stage('only', [
      transform('look', async (context) => ({
        jobs: jobsIn(context.documents),
        walls: context.walls === undefined ? null : context.walls.pieces().length
      }))
    ])
  ]);
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { probe } });
  const job = (company: string) => ({ company, title: 'Engineer', started: '2020', finished: null, highlights: ['One.'], skills: [] });

  try {
    h.profile.replaceContext(cv.id, { experience: [job('Acme'), job('Globex')] }, 0);
    const chat = h.conversations.create({ kind: 'profile', id: cv.id });
    const run = () => h.run({ capability: 'probe', input: {}, contextId: cv.id, conversationId: chat.id });

    assert.deepEqual((await run()).data, { jobs: 2, walls: 0 });

    const changed = h.selection.update(chat.id, { expectedRevision: 0, exclude: [`cv:${cv.id}/experience/globex~engineer`] });
    assert.equal(changed?.applied, true);
    assert.deepEqual((await run()).data, { jobs: 1, walls: 1 });

    // Read from the file, so another process sees it too, and a run in no conversation does not.
    const bare = await h.run({ capability: 'probe', input: {}, contextId: cv.id });
    assert.deepEqual(bare.data, { jobs: 2, walls: null });
  } finally {
    h.close();
    s.dispose();
  }
});

/* -------------------------------------------------------------------- an edit */

const EDITED = {
  experience: {
    experience: [
      { ...BODY.experience[0], title: 'Staff Engineer' },
      { ...BODY.experience[2] }
    ]
  },
  role_description: { summary: 'A shorter description.' },
  skills: {
    skills: { role: 'Staff Engineer', groups: BODY.skills.groups }
  }
};

test('an edit is shown what is left, and the proposal puts back what it was not shown', async () => {
  const rt = runtime({ answers: EDITED });
  try {
    rt.exclude(ref(`experience/${GLOBEX}`));
    const run = rt.begin({ instruction: 'Make my title Staff Engineer.', section: 'experience' }, 'edit_cv');
    const result = await run.settled;

    const seen = rt.everything();
    assert.ok(!seen.includes(CANARY.globex), 'the job that is excluded was sent to the model');
    assert.ok(seen.includes(CANARY.acme), 'the job that is not excluded was left out of the prompt');

    const proposed = (result.data.document as CvDocument).experience;
    assert.deepEqual(proposed, [
      { ...BODY.experience[0], title: 'Staff Engineer' },
      BODY.experience[1],
      BODY.experience[2]
    ]);
    assert.equal(result.data.changed, true);
    // It is proposed over the stored document, and says which.
    assert.deepEqual(result.data.base, { contextId: CONTEXT, revision: rt.s.deps.documents.read(CONTEXT)?.revision, generation: 0 });
  } finally {
    rt.dispose();
  }
});

test('an edit of the skills keeps the description that is excluded, whatever the model would have written', async () => {
  const rt = runtime({ answers: EDITED });
  try {
    rt.exclude(ref('overview/role_description'));
    const run = rt.begin({ instruction: 'Make my skills role Staff Engineer.', section: 'skills' }, 'edit_cv');
    const result = await run.settled;
    const document = result.data.document as CvDocument;

    assert.equal(document.role_description, BODY.role_description, 'what was never shown is the stored one');
    assert.equal(document.skills.role, 'Staff Engineer');
    assert.ok(!rt.everything().includes(CANARY.summary));
  } finally {
    rt.dispose();
  }
});

test('an edit aimed at what is excluded says so, and calls no model', async () => {
  const cases: [string, string[], string][] = [
    ['experience', [ref(`experience/${ACME}`), ref(`experience/${GLOBEX}`), ref(`experience/${ACME_2}`)], 'experience'],
    ['experience', [ref('experience')], 'experience'],
    ['role_description', [ref('overview/role_description')], 'role_description'],
    ['skills', [ref('overview')], 'skills'],
    ['skills', [ref()], 'skills']
  ];

  for (const [section, excluded, named] of cases) {
    const rt = runtime({ answers: EDITED });
    try {
      rt.exclude(...excluded);
      const run = rt.begin({ instruction: 'Change it.', section }, 'edit_cv');
      await assert.rejects(
        run.settled,
        (error: Error & { code?: string }) => error.code === 'target_excluded' && error.message.includes(`The ${named} of this CV`),
        excluded.join(' ')
      );
      assert.deepEqual(rt.payloads, [], 'no model was asked');
    } finally {
      rt.dispose();
    }
  }
});

test('a document sent with an edit is cut like the stored one, and the proposal is made over it whole', async () => {
  const rt = runtime({ answers: EDITED });
  try {
    rt.exclude(ref(`experience/${GLOBEX}`), ref('overview/role_description'));
    const run = rt.begin({ instruction: 'Make my title Staff Engineer.', section: 'experience', document: BODY }, 'edit_cv');
    const result = await run.settled;

    const seen = rt.everything();
    assert.ok(!seen.includes(CANARY.globex));
    assert.ok(!seen.includes(CANARY.summary));
    assert.deepEqual((result.data.document as CvDocument).experience[1], BODY.experience[1]);
    assert.equal((result.data.document as CvDocument).role_description, BODY.role_description);
    assert.equal(result.data.base, undefined, 'a document that was sent is not a stored base');

    // And an edit of what the sent document has excluded is refused the same way.
    const aimed = rt.begin({ instruction: 'Change it.', section: 'role_description', document: BODY }, 'edit_cv');
    await assert.rejects(aimed.settled, (error: Error & { code?: string }) => error.code === 'target_excluded');
  } finally {
    rt.dispose();
  }
});

test('an edit with nothing excluded is sent what it was sent before', async () => {
  const withSelections = runtime({ answers: EDITED });
  const without = runtime({ answers: EDITED, selection: false });
  try {
    const input = { instruction: 'Make my title Staff Engineer.', section: 'experience' };
    const left = await withSelections.begin(input, 'edit_cv').settled;
    const right = await without.begin(input, 'edit_cv').settled;

    assert.deepEqual(withSelections.payloads, without.payloads);
    assert.deepEqual(left.data, right.data);
  } finally {
    withSelections.dispose();
    without.dispose();
  }
});

/* ----------------------------------------------------------------- translation */

const POLISH = {
  experience: {
    experience: [
      {
        company: 'Acme',
        title: 'Starszy inżynier',
        started: '2021',
        finished: 'present',
        highlights: [`Przepisałem system rozliczeń. ${CANARY.acme}`]
      },
      {
        company: 'Acme',
        title: 'Starszy inżynier',
        started: '2016',
        finished: '2018',
        highlights: ['Wcześniejszy epizod.']
      }
    ]
  }
};

test('a translation is not sent what is excluded, and its result still has it, as it was stored', async () => {
  const rt = runtime({ answers: POLISH });
  try {
    rt.exclude(ref(`experience/${GLOBEX}`));
    const run = rt.begin({ source_language: 'en', target_language: 'pl', sections: ['experience'] }, 'translate_cv');
    const result = await run.settled;

    assert.ok(!rt.everything().includes(CANARY.globex), 'the job that is excluded was sent to be translated');
    const jobs = (result.data.document as CvDocument).experience;
    assert.equal(jobs.length, 3);
    assert.equal(jobs[0]?.title, 'Starszy inżynier');
    assert.deepEqual(jobs[1], BODY.experience[1], 'it comes back in English, in the place it had');
    assert.equal(jobs[2]?.title, 'Starszy inżynier');
  } finally {
    rt.dispose();
  }
});

test('a document sent to be translated is cut like the stored one', async () => {
  const rt = runtime({ answers: POLISH });
  try {
    rt.exclude(ref(`experience/${GLOBEX}`));
    const run = rt.begin({ source_language: 'en', target_language: 'pl', sections: ['experience'], document: BODY }, 'translate_cv');
    const result = await run.settled;

    assert.ok(!rt.everything().includes(CANARY.globex));
    assert.deepEqual((result.data.document as CvDocument).experience[1], BODY.experience[1]);
  } finally {
    rt.dispose();
  }
});
