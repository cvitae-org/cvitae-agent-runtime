/**
 * Editing one section of a CV: the ref an edit is aimed at, what it says it
 * changed, and an accept that writes that and nothing else.
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 59 were applied. The number is how many
 * tests failed.
 *
 * the target ref:
 *   every section is a list section                            10
 *   every section is an item of the overview                   11
 *   an entry of a list is a section                            2
 *   a ref of another well is a section                         1
 *   a ref of another CV is a section                           5
 *   a ref that names no section is one                         2
 *   an item of the overview needs a second place               0 (equivalent: no second place reads as undefined, and undefined is not an item)
 *   an item of the overview may have more after it             0 (equivalent: a ref is read to two places and no further, so nothing can follow)
 *   a refusal does not say what a section is                   1
 *
 * the input:
 *   a target may be empty                                      1
 *   a target may be 1,025 characters                           1
 *   a target must be given                                     6
 *   a ref and a section that differ are not told apart         2
 *   a ref and a section that agree are not told apart          1
 *   the section wins over the ref                              0 (equivalent: the two are the same section by then, or the refusal has been thrown)
 *   a ref is read in the legacy CV                             22
 *   a ref is read and not kept                                 13
 *
 * what an edit says:
 *   an edit says the section and not the ref                   9
 *   an edit says the ref of the legacy CV                      8
 *   an edit always says it changed something                   1
 *   an edit says nothing changed when anything did             1
 *   an edit lists what changed against what it was shown       2
 *   a proposal that reaches outside its section is not refused 2
 *   a proposal that reaches outside is said once per change    1
 *   a proposal that reaches outside says what the model wrote  1
 *
 * what an edit needs:
 *   an edit that names nothing needs something                 1
 *   an edit that names a section needs nothing                 2
 *   an excluded section is not found out early                 3
 *   a section is excluded in the legacy CV only                2
 *   an excluded section has no code of its own                 3
 *   an excluded section is not said                            2
 *
 * a proposal is stored:
 *   a proposal is stored without what it was aimed at          4
 *   changes are stored without being read                      1
 *   a target alone is stored                                   1
 *   changes alone are stored                                   1
 *   a proposal's target is not kept                            8
 *   a proposal's changes are not kept                          6
 *   a proposal is read without its target                      2
 *   a proposal is read without its changes                     2
 *   a proposal stored again may have another target            1
 *   a proposal stored again may have other changes             1
 *
 * an accept:
 *   an accept does not check the revision                      1
 *   an accept writes the proposal's own document               6
 *   a proposal with no changes is not accepted as it was       2
 *   a proposal whose changes cannot be read is accepted        2
 *   a proposal with no target is accepted                      2
 *   a proposal with unreadable changes is read anyway          2
 *   a target is read in the legacy CV                          6
 *   changes outside the section are accepted                   2
 *   a refusal does not say which part                          1
 *   changes that do not apply are not a conflict               1
 *   changes that do not apply are said with what was there     1
 *   changes that make another document are accepted            1
 *   changes that make another document are a different refusal 1
 *
 * the host:
 *   the host is not told an edit aims at a section             1
 *   the column for the target is not added                     16
 *   the column for the changes is not added                    16
 *   the column for the target is required                      6
 *   an old proposal is given changes                           4
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { CV_ID, CV_KIND, emptyDocument, normaliseCv } from '../src/capabilities/cv/document.js';
import type { CvDocument } from '../src/capabilities/cv/document.js';
import { applyCv, same } from '../src/capabilities/cv/diff.js';
import type { CvChange } from '../src/capabilities/cv/diff.js';
import { editCv, inputSchema, proposalChanges, sectionNames } from '../src/capabilities/cv/edit.js';
import type { Section } from '../src/capabilities/cv/edit.js';
import { sectionOf, targetOf } from '../src/capabilities/cv/target.js';
import { cvOf } from '../src/capabilities/cv/well.js';
import type { CvLifecycle, DocumentBody, RunContext } from '../src/contracts/index.js';
import { parseRef } from '../src/grounding/index.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { bindCvScope } from '../src/runtime/cv-scope.js';
import { createHarness } from '../src/runtime/create.js';
import { defaultWells } from '../src/runtime/grounding.js';
import { beginRun, startRun } from '../src/runtime/run.js';
import type { RunHandle, RunRequest, RuntimeDeps } from '../src/runtime/run.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createCvLifecycle } from '../src/storage/sqlite/cv-lifecycle.js';
import { createDocumentStore } from '../src/storage/sqlite/document-store.js';
import { createRecordStore } from '../src/storage/sqlite/grounding-record.js';
import { createSelectionStore } from '../src/storage/sqlite/grounding-selection.js';
import { open } from '../src/storage/sqlite/open.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { createChunkIndex } from '../src/storage/sqlite/chunk-index.js';
import { noop, spine, stage, transform } from './support/spine.js';
import type { Spine } from './support/spine.js';
import { scratch } from './support/db.js';

/* ---------------------------------------------------------------- fixtures */

const CONTEXT = 'ctx';
const CHAT = 'chat';

/** One in each piece an edit must not carry anywhere it was not aimed. */
const CANARY = {
  acme: 'ZEBRA-ACME1-4410',
  globex: 'ZEBRA-GLOBEX-7731',
  summary: 'ZEBRA-SUMMARY-2208',
  home: 'ZEBRA-HOME-9142'
} as const;

const BODY = cvOf({
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
  education: [{ university: 'MIT', degree: 'BSc Computer Science', started: '2012', finished: '2016', thesis: 'Compilers', mark: '' }],
  certificates: [{ name: 'AWS Solutions Architect', issuer: 'Amazon', started: '2020', finished: '' }],
  languages: [
    { name: 'Polish', level: 'native' },
    { name: 'English', level: 'C1' }
  ],
  sources: [{ kind: 'text', reference: 'cv.txt', imported_at: '2026-01-05T00:00:00.000Z' }]
}) as CvDocument;

const [ACME, GLOBEX, ACME_2] = ['acme~senior-engineer', 'globex~engineer', 'acme~senior-engineer-2'] as const;

const ref = (path = ''): string => `cv:${CONTEXT}${path === '' ? '' : `/${path}`}`;

/** What each section of the stored CV looks like when the model hands it back whole, in the shape it was asked for. */
const SAME: Readonly<Record<Section, unknown>> = {
  personal: { personal: BODY.personal },
  role_description: { summary: BODY.role_description },
  skills: { skills: { role: BODY.skills.role, groups: BODY.skills.groups } },
  experience: { experience: BODY.experience.map((job) => ({ ...job, finished: job.finished ?? 'present' })) },
  education: { education: BODY.education.map((entry) => ({ ...entry, finished: entry.finished ?? 'present' })) },
  certificates: { certificates: BODY.certificates.map((entry) => ({ ...entry, finished: entry.finished ?? 'present' })) },
  languages: { languages: BODY.languages }
};

/** Each section with one thing different, which is all a model's answer ever is. */
const EDITED: Readonly<Record<Section, unknown>> = {
  personal: { personal: { ...BODY.personal, location: 'Berlin' } },
  role_description: { summary: 'A shorter description.' },
  skills: {
    skills: {
      role: 'Staff Engineer',
      groups: [{ label: 'Languages', items: ['TypeScript', 'Go', 'Ruby'] }, ...BODY.skills.groups.slice(1)]
    }
  },
  experience: {
    experience: [
      { ...BODY.experience[0], title: 'Staff Engineer', finished: 'present' },
      { ...BODY.experience[1] },
      { ...BODY.experience[2] }
    ]
  },
  education: { education: [{ ...BODY.education[0], degree: 'MSc Computer Science' }] },
  certificates: {
    certificates: [...BODY.certificates, { name: 'CKA', issuer: 'CNCF', started: '2022', finished: 'present' }]
  },
  languages: { languages: [...BODY.languages, { name: 'German', level: 'B2' }] }
};

/* ----------------------------------------------------------------- runtime */

type Runtime = {
  readonly s: Spine;
  readonly lifecycle: CvLifecycle;
  /** The step of every model call, in order. */
  readonly steps: string[];
  /** Everything every model call was told. */
  readonly payloads: string[];
  exclude(...refs: string[]): void;
  begin(input: Record<string, unknown>, over?: Partial<RunRequest>): RunHandle;
  /** An edit that is aimed with these inputs. */
  edit(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** The stored CV. */
  stored(): CvDocument;
  dispose(): void;
};

const runtime = (answers: Readonly<Record<string, unknown>> = EDITED, options: { readonly selection?: boolean } = {}): Runtime => {
  const steps: string[] = [];
  const payloads: string[] = [];

  const s = spine(capabilities, {
    ai: {
      generateObject: async (request) => {
        steps.push(request.step ?? '');
        payloads.push(JSON.stringify({ system: request.system, prompt: request.prompt }));
        const object = request.step === 'route' ? { section: 'experience', reason: 'It names a job.' } : answers[request.step ?? ''];
        assert.ok(object !== undefined, `nothing answers the step ${request.step ?? '(none)'}`);
        return { object: object as never, finishReason: 'stop', usage: {} };
      }
    }
  });

  s.db.prepare("INSERT INTO cv_contexts (id, language, created_at, updated_at) VALUES (?, 'en', 1, 1)").run(CONTEXT);
  s.db
    .prepare('INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
    .run(CHAT, 'profile', CONTEXT);
  s.deps.documents.update(CONTEXT, CV_KIND, () => BODY);

  const bound = () =>
    bindCvScope(CONTEXT, { documents: s.deps.documents, retrieval: { search: async () => [] }, index: s.deps.index });
  const selections = createSelectionStore(s.db);
  const revision = (): number => s.deps.documents.read(CONTEXT)?.revision ?? 0;

  const deps: RuntimeDeps = {
    ...s.deps,
    scopeCv: () => ({ ...bound(), contextGeneration: 0, contextRevision: revision() }),
    grounding: { records: createRecordStore(s.db), wells: defaultWells() },
    ...(options.selection === false ? {} : { selection: selections })
  };

  const lifecycle = createCvLifecycle(
    s.db,
    createCvContextStore(s.db),
    s.deps.documents,
    s.chunks,
    () => emptyDocument() as unknown as DocumentBody
  );

  const begin = (input: Record<string, unknown>, over: Partial<RunRequest> = { contextId: CONTEXT, conversationId: CHAT }): RunHandle =>
    beginRun(deps, { capability: 'edit_cv', input, ...over } as RunRequest);

  return {
    s,
    lifecycle,
    steps,
    payloads,
    exclude: (...refs) => {
      const { revision: expectedRevision } = selections.read(CHAT);
      assert.ok(selections.change(CHAT, { expectedRevision, exclude: refs, clear: [] }).applied);
    },
    begin,
    edit: async (input) => (await begin(input).settled).data,
    stored: () => s.deps.documents.read(CONTEXT)?.body as unknown as CvDocument,
    dispose: () => s.dispose()
  };
};

/** The code a run was refused with. */
const codeOf = async (run: RunHandle): Promise<string> => {
  try {
    await run.settled;
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
  return 'did not fail';
};

const targetOfRun = (data: Record<string, unknown>): string => data.target as string;
const changesOf = (data: Record<string, unknown>): CvChange[] => data.changes as CvChange[];
const documentOf = (data: Record<string, unknown>): CvDocument => data.document as CvDocument;

const INSTRUCTION = 'Change it.';

/* ---------------------------------------------------------- the target ref */

test('every section has one ref, and the ref names that section and no other', () => {
  const expected: Record<Section, string> = {
    personal: 'cv:ctx/overview/personal',
    role_description: 'cv:ctx/overview/role_description',
    skills: 'cv:ctx/overview/skills',
    experience: 'cv:ctx/experience',
    education: 'cv:ctx/education',
    certificates: 'cv:ctx/certificates',
    languages: 'cv:ctx/languages'
  };

  assert.deepEqual([...sectionNames].sort(), Object.keys(expected).sort());
  for (const section of sectionNames) {
    assert.equal(targetOf(CONTEXT, section), expected[section]);
    assert.equal(sectionOf(expected[section], CONTEXT), section);
  }
  assert.equal(new Set(sectionNames.map((section) => targetOf(CONTEXT, section))).size, sectionNames.length);
});

test('a ref names a section of this conversation own CV, and a version or a digest on it is not a different section', () => {
  assert.equal(sectionOf('cv:ctx@7/experience', CONTEXT), 'experience');
  assert.equal(sectionOf('cv:ctx/overview/skills#0123456789abcdef', CONTEXT), 'skills');
  assert.equal(sectionOf('cv:ctx@7/overview/personal#0123456789abcdef', CONTEXT), 'personal');
  // The scope is the conversation's, whatever else is true of the ref.
  assert.equal(sectionOf('cv:cv/education', CV_ID), 'education');
});

test('a ref that is not a section of this CV is refused as a selection, and the message says what would be', () => {
  const refused = [
    // another well
    'offers:offer-1',
    'offers:ctx/experience',
    'preferences:ctx/experience',
    // another CV
    'cv:other/experience',
    'cv:other/overview/skills',
    // the whole CV, the whole overview
    'cv:ctx',
    'cv:ctx/overview',
    // an entry of a list
    `cv:ctx/experience/${ACME}`,
    'cv:ctx/education/mit~bsc-computer-science',
    // not a section
    'cv:ctx/hobbies',
    'cv:ctx/overview/photo',
    'cv:ctx/overview/experience',
    'cv:ctx/skills',
    'cv:ctx/personal',
    'cv:ctx/sources',
    'cv:ctx/overview/sources'
  ];

  for (const text of refused) {
    assert.throws(
      () => sectionOf(text, CONTEXT),
      (error: Error & { code?: string }) =>
        error.code === 'invalid_selection' &&
        error.message.includes('cv:ctx/experience') &&
        error.message.includes('cv:ctx/overview/skills'),
      text
    );
  }
});

test('a ref that is not a ref is refused as one, whatever it would have meant', () => {
  const malformed = [
    'experience',
    'ctx/experience',
    'cv:',
    'cv:ctx/experience/a/b',
    'cv:ctx/overview/skills/x',
    'CV:ctx/experience',
    'cv:ctx/experi%65nce',
    'cv:ctx/experience#nothex',
    ' cv:ctx/experience'
  ];

  for (const text of malformed) {
    assert.throws(() => sectionOf(text, CONTEXT), { code: 'invalid_ref' }, JSON.stringify(text));
  }
});

test('the target is a string of one to 1,024 characters, and the schema says nothing else about it', () => {
  const parses = (target: unknown) => inputSchema.safeParse({ instruction: INSTRUCTION, target }).success;

  assert.equal(parses(ref('experience')), true);
  assert.equal(parses('x'), true, 'a ref is checked when the edit is made, not when it is parsed');
  assert.equal(parses('x'.repeat(1_024)), true);
  assert.equal(parses('x'.repeat(1_025)), false);
  assert.equal(parses(''), false);
  assert.equal(parses(7), false);
  assert.equal(inputSchema.safeParse({ instruction: INSTRUCTION }).success, true, 'it is optional');
});

/* -------------------------------------------------- what an edit says it did */

test('an edit aimed with a ref is not routed, and says which ref and which section it changed', async () => {
  for (const section of sectionNames) {
    const rt = runtime();
    try {
      const data = await rt.edit({ instruction: INSTRUCTION, target: targetOf(CONTEXT, section) });
      assert.deepEqual(rt.steps, [section], `${section}: only the revision asks a model`);
      assert.equal(data.section, section);
      assert.equal(targetOfRun(data), targetOf(CONTEXT, section));
      assert.equal(data.changed, true);
    } finally {
      rt.dispose();
    }
  }
});

test('an edit aimed with a section name says the ref as well', async () => {
  const rt = runtime();
  try {
    const data = await rt.edit({ instruction: INSTRUCTION, section: 'skills' });
    assert.equal(targetOfRun(data), ref('overview/skills'));
    assert.equal(data.section, 'skills');
  } finally {
    rt.dispose();
  }
});

test('an edit that names no section is routed, and says the ref of the one it was routed to', async () => {
  const rt = runtime();
  try {
    const data = await rt.edit({ instruction: INSTRUCTION });
    assert.deepEqual(rt.steps, ['route', 'experience']);
    assert.equal(targetOfRun(data), ref('experience'));
  } finally {
    rt.dispose();
  }
});

test('a ref and a section that name the same section are one instruction, and two that differ are not', async () => {
  const same = runtime();
  try {
    const data = await same.edit({ instruction: INSTRUCTION, target: ref('overview/skills'), section: 'skills' });
    assert.equal(data.section, 'skills');
  } finally {
    same.dispose();
  }

  const differ = runtime();
  try {
    const run = differ.begin({ instruction: INSTRUCTION, target: ref('overview/skills'), section: 'experience' });
    await assert.rejects(
      run.settled,
      (error: Error & { code?: string }) =>
        error.code === 'invalid_input' && error.message.includes('skills') && error.message.includes('experience')
    );
    assert.deepEqual(differ.steps, [], 'no model was asked which of two to believe');
  } finally {
    differ.dispose();
  }
});

test('a ref that is refused is refused before any model is asked, with the code its fault has', async () => {
  const cases: [string, string][] = [
    ['offers:offer-1', 'invalid_selection'],
    ['cv:other/experience', 'invalid_selection'],
    [ref(), 'invalid_selection'],
    [ref(`experience/${ACME}`), 'invalid_selection'],
    ['experience', 'invalid_ref']
  ];

  for (const [target, code] of cases) {
    const rt = runtime();
    try {
      assert.equal(await codeOf(rt.begin({ instruction: INSTRUCTION, target })), code, target);
      assert.deepEqual(rt.steps, [], target);
      assert.equal(rt.stored().experience.length, 3);
    } finally {
      rt.dispose();
    }
  }
});

test('an edit outside a conversation is aimed at the one CV there is, and at no other', async () => {
  const s = spine(capabilities, {
    ai: { generateObject: async (request) => ({ object: EDITED[request.step as Section] as never, finishReason: 'stop', usage: {} }) }
  });
  try {
    s.deps.documents.update(CV_ID, CV_KIND, () => BODY);
    const run = (input: Record<string, unknown>) => startRun(s.deps, { capability: 'edit_cv', input: { instruction: INSTRUCTION, ...input } });

    const data = (await run({ target: 'cv:cv/education' })).data;
    assert.equal(data.target, 'cv:cv/education');
    assert.equal(data.section, 'education');

    await assert.rejects(run({ target: ref('education') }), { code: 'invalid_selection' });
  } finally {
    s.dispose();
  }
});

test('the changes of an edit are what is different, in the section it was aimed at and in no other', async () => {
  const rt = runtime();
  try {
    const title = await rt.edit({ instruction: INSTRUCTION, target: ref('experience') });
    assert.deepEqual(changesOf(title), [
      { op: 'replace', path: ['experience', 0, 'title'], before: 'Senior Engineer', after: 'Staff Engineer' }
    ]);

    const location = await rt.edit({ instruction: INSTRUCTION, target: ref('overview/personal') });
    assert.deepEqual(changesOf(location), [
      { op: 'replace', path: ['personal', 'location'], before: `Krakow ${CANARY.home}`, after: 'Berlin' }
    ]);

    const summary = await rt.edit({ instruction: INSTRUCTION, target: ref('overview/role_description') });
    assert.deepEqual(changesOf(summary), [
      { op: 'replace', path: ['role_description'], before: BODY.role_description, after: 'A shorter description.' }
    ]);

    const added = await rt.edit({ instruction: INSTRUCTION, target: ref('languages') });
    assert.deepEqual(changesOf(added), [{ op: 'add', path: ['languages', 2], after: { name: 'German', level: 'B2' } }]);

    const certificate = await rt.edit({ instruction: INSTRUCTION, target: ref('certificates') });
    assert.deepEqual(changesOf(certificate), [
      { op: 'add', path: ['certificates', 1], after: { name: 'CKA', issuer: 'CNCF', started: '2022', finished: null } }
    ]);
  } finally {
    rt.dispose();
  }
});

test('whatever an edit changes, applying its changes to the stored CV makes the CV it proposes, and only that section moves', async () => {
  for (const section of sectionNames) {
    const rt = runtime();
    try {
      const data = await rt.edit({ instruction: INSTRUCTION, target: targetOf(CONTEXT, section) });
      const proposed = documentOf(data);

      assert.ok(same(applyCv(BODY, changesOf(data)) as never, proposed as never), `${section}: the changes are the proposal`);
      assert.notDeepEqual(changesOf(data), [], section);
      for (const change of changesOf(data)) assert.equal(change.path[0], section, `${section}: ${JSON.stringify(change.path)}`);

      for (const other of sectionNames) {
        if (other !== section) assert.deepEqual(proposed[other], BODY[other], `${section} moved ${other}`);
      }
      assert.deepEqual(rt.stored(), BODY, `${section}: nothing was written`);
    } finally {
      rt.dispose();
    }
  }
});

test('an edit that hands back what it was given changes nothing, and says so', async () => {
  for (const section of sectionNames) {
    const rt = runtime(SAME as Record<string, unknown>);
    try {
      const data = await rt.edit({ instruction: INSTRUCTION, target: targetOf(CONTEXT, section) });
      assert.deepEqual(changesOf(data), [], section);
      assert.equal(data.changed, false, section);
      assert.deepEqual(documentOf(data), normaliseCv(BODY), section);
    } finally {
      rt.dispose();
    }
  }
});

test('an edit sends the model what it sent before the target existed', async () => {
  const named = runtime();
  const aimed = runtime();
  const plain = runtime(EDITED, { selection: false });
  try {
    for (const section of sectionNames) {
      await named.edit({ instruction: INSTRUCTION, section });
      await aimed.edit({ instruction: INSTRUCTION, target: targetOf(CONTEXT, section) });
      await plain.edit({ instruction: INSTRUCTION, section });
    }
    assert.deepEqual(aimed.payloads, named.payloads);
    assert.deepEqual(plain.payloads, named.payloads);
    assert.equal(named.payloads.length, sectionNames.length);
  } finally {
    named.dispose();
    aimed.dispose();
    plain.dispose();
  }
});

/* ---------------------------------------------------------------- the walls */

const ctx = (walls: readonly string[], contextId: string | undefined = CONTEXT): RunContext =>
  ({ contextId, ...(walls.length === 0 ? {} : { walls: { pieces: () => walls.map((text) => parseRef(text)) } }) }) as unknown as RunContext;

const needsOf = (input: Record<string, unknown>, context: RunContext) =>
  editCv.needs!({ instruction: INSTRUCTION, ...input } as never, context);

test('an edit that names no section needs nothing of the run, so it is routed first', () => {
  assert.deepEqual(needsOf({}, ctx([])), []);
  assert.deepEqual(needsOf({}, ctx([ref()])), [], 'not even when the whole CV is excluded: what it is routed to is checked later');
});

test('an edit that names a section needs it, and says it is unmet only when the whole section is excluded', () => {
  const needs = (input: Record<string, unknown>, walls: string[]) => needsOf(input, ctx(walls));

  for (const input of [{ section: 'skills' }, { target: ref('overview/skills') }]) {
    assert.deepEqual(needs(input, []), [{ name: 'target', required: true }]);
    assert.deepEqual(needs(input, [ref('overview/personal'), ref('experience')]), [{ name: 'target', required: true }]);

    for (const wall of [ref(), ref('overview'), ref('overview/skills')]) {
      const [need, ...rest] = needs(input, [wall]);
      assert.equal(rest.length, 0);
      assert.equal(need?.name, 'target');
      assert.equal(need?.required, true);
      assert.equal(need?.code, 'target_excluded', wall);
      assert.ok(need?.unmet?.startsWith('The skills of this CV is excluded from the conversation'), wall);
    }
  }

  for (const wall of [ref(), ref('experience')]) {
    assert.equal(needs({ section: 'experience' }, [wall])[0]?.code, 'target_excluded', wall);
  }
  assert.equal(needs({ section: 'experience' }, [ref('overview')])[0]?.unmet, undefined, 'the overview is not the experience');
});

test('a list that has some entries left is not excluded, and one that has none is found out when the document is read', () => {
  const entries = [ACME, GLOBEX, ACME_2].map((key) => ref(`experience/${key}`));
  const [need] = needsOf({ section: 'experience' }, ctx(entries));
  assert.equal(need?.unmet, undefined, 'a wall of entries is not a wall of the section: the document is not read yet');
});

test('walls of another CV exclude nothing here, and a run in no conversation has none', () => {
  assert.equal(needsOf({ section: 'skills' }, ctx(['cv:other/overview/skills', 'cv:other']))[0]?.unmet, undefined);
  assert.equal(needsOf({ section: 'skills' }, ctx([]))[0]?.unmet, undefined);
  // And with no conversation at all the scope is the one CV there is.
  const legacy = needsOf({ section: 'skills' }, ({ walls: { pieces: () => [parseRef('cv:cv/overview/skills')] } }) as unknown as RunContext);
  assert.equal(legacy[0]?.code, 'target_excluded');
});

test('a ref that is refused is refused when the run asks what it needs', () => {
  assert.throws(() => needsOf({ target: 'cv:other/experience' }, ctx([])), { code: 'invalid_selection' });
  assert.throws(() => needsOf({ target: 'nonsense' }, ctx([])), { code: 'invalid_ref' });
  assert.throws(() => needsOf({ target: ref('overview/skills'), section: 'education' }, ctx([])), { code: 'invalid_input' });
});

test('an edit of what is excluded is refused with its own code, before a plan is made and before a model is asked', async () => {
  const cases: [Record<string, unknown>, string[]][] = [
    [{ target: ref('experience') }, [ref('experience')]],
    [{ section: 'experience' }, [ref()]],
    [{ target: ref('overview/role_description') }, [ref('overview/role_description')]],
    [{ target: ref('overview/skills') }, [ref('overview')]]
  ];

  for (const [input, excluded] of cases) {
    const rt = runtime();
    try {
      rt.exclude(...excluded);
      const run = rt.begin({ instruction: INSTRUCTION, ...input });
      await assert.rejects(run.settled, (error: Error & { code?: string }) =>
        error.code === 'target_excluded' && error.message.startsWith('The '));
      assert.deepEqual(rt.steps, []);
      // No step was begun: this was said before there was anything to run.
      const types = rt.s.events.since(run.runId, 0, 500).map((event) => event.type);
      assert.ok(!types.some((type) => type.startsWith('step.')), `${JSON.stringify(input)} ran a step: ${types.join(' ')}`);
    } finally {
      rt.dispose();
    }
  }
});

test('a list whose every entry is excluded is still refused, when the document is read, with the same code', async () => {
  const rt = runtime();
  try {
    rt.exclude(...[ACME, GLOBEX, ACME_2].map((key) => ref(`experience/${key}`)));
    const run = rt.begin({ instruction: INSTRUCTION, target: ref('experience') });
    await assert.rejects(run.settled, { code: 'target_excluded' });
    assert.deepEqual(rt.steps, []);
    const types = rt.s.events.since(run.runId, 0, 500).map((event) => event.type);
    assert.ok(types.some((type) => type.startsWith('step.')), 'it got as far as reading the CV');
  } finally {
    rt.dispose();
  }
});

test('an instruction that is routed to what is excluded is refused when the document is read', async () => {
  const rt = runtime();
  try {
    rt.exclude(ref('experience'));
    await assert.rejects(rt.begin({ instruction: INSTRUCTION }).settled, { code: 'target_excluded' });
    assert.deepEqual(rt.steps, ['route'], 'it was routed, and then it was found out');
  } finally {
    rt.dispose();
  }
});

test('an exclusion elsewhere is not an exclusion of the section, and the proposal puts it back untouched', async () => {
  // The model is shown two of the three jobs, so it answers with two.
  const shown = [{ ...BODY.experience[0], title: 'Staff Engineer', finished: 'present' }, { ...BODY.experience[2] }];
  const rt = runtime({ ...EDITED, experience: { experience: shown } });
  try {
    rt.exclude(ref('overview/role_description'), ref(`experience/${GLOBEX}`));

    const skills = await rt.edit({ instruction: INSTRUCTION, target: ref('overview/skills') });
    assert.equal(documentOf(skills).role_description, BODY.role_description);
    assert.ok(!rt.payloads.join('\n').includes(CANARY.summary));
    for (const change of changesOf(skills)) assert.equal(change.path[0], 'skills');

    const jobs = await rt.edit({ instruction: INSTRUCTION, target: ref('experience') });
    assert.ok(!rt.payloads.join('\n').includes(CANARY.globex));
    assert.deepEqual(documentOf(jobs).experience, [
      { ...BODY.experience[0], title: 'Staff Engineer' },
      BODY.experience[1],
      BODY.experience[2]
    ].map((job) => ({ ...job })));
    // The excluded job is in neither the changes nor the gap between the two jobs that were shown.
    assert.deepEqual(changesOf(jobs), [
      { op: 'replace', path: ['experience', 0, 'title'], before: 'Senior Engineer', after: 'Staff Engineer' }
    ]);
    assert.ok(same(applyCv(BODY, changesOf(jobs)) as never, documentOf(jobs) as never));
  } finally {
    rt.dispose();
  }
});

test('an edit that drops what it was not shown does not drop it from the proposal, and does not claim to', async () => {
  // The model is shown two of the three jobs and hands back one.
  const rt = runtime({ ...EDITED, experience: { experience: [{ ...BODY.experience[0], finished: 'present' }] } });
  try {
    rt.exclude(ref(`experience/${GLOBEX}`));
    const data = await rt.edit({ instruction: INSTRUCTION, target: ref('experience') });
    const companies = documentOf(data).experience.map((job) => `${job.company}/${job.started}`);
    assert.deepEqual(companies, ['Acme/2021', 'Globex/2018'], 'the job that was cut is back, and the one that was dropped is gone');
    assert.deepEqual(changesOf(data), [{ op: 'remove', path: ['experience', 2], before: BODY.experience[2] }]);
  } finally {
    rt.dispose();
  }
});

/* ---------------------------------------------------------- the scope guard */

test('a proposal that changes something other than the section it was aimed at is refused, and says which', () => {
  const elsewhere = { ...BODY, role_description: 'Rewritten.' } as CvDocument;
  const both = { ...BODY, role_description: 'Rewritten.', education: [] } as CvDocument;
  const mine = { ...BODY, languages: [] } as CvDocument;

  assert.throws(
    () => proposalChanges(BODY, elsewhere, 'skills'),
    (error: Error & { code?: string }) => error.code === 'proposal_out_of_scope' && error.message.includes('role_description') && !error.message.includes('Rewritten')
  );
  assert.throws(
    () => proposalChanges(BODY, both, 'languages'),
    (error: Error & { code?: string }) =>
      error.code === 'proposal_out_of_scope' && error.message.includes('role_description, education') && error.message.includes('languages')
  );
  // Two changes in one place are one place said.
  const twice = { ...BODY, personal: { ...BODY.personal, name: 'A', location: 'B' } } as CvDocument;
  assert.throws(
    () => proposalChanges(BODY, twice, 'skills'),
    (error: Error & { code?: string }) => error.message === 'The edit to skills also changes personal, which it was not aimed at.'
  );
  assert.deepEqual(proposalChanges(BODY, mine, 'languages').map((change) => change.path[0]), ['languages', 'languages']);
  assert.deepEqual(proposalChanges(BODY, BODY, 'languages'), []);
});

test('what a model has no say in is not a section: the version and the sources are out of scope too', () => {
  for (const key of ['version', 'sources'] as const) {
    const touched = { ...BODY, [key]: key === 'version' ? 2 : [] } as unknown as CvDocument;
    for (const section of sectionNames) {
      assert.throws(() => proposalChanges(BODY, touched, section), { code: 'proposal_out_of_scope' }, `${key} ${section}`);
    }
  }
});

/* ---------------------------------------------------- a proposal is stored */

/** An edit that proposes what it is told to, the way the real one does, for the hook that stores it. */
const proposing = (result: (context: Parameters<Parameters<typeof transform>[1]>[0]) => Record<string, unknown>) =>
  noop('edit_cv', [stage('work', [transform('proposal', async (context) => result(context))])]);

const baseOf = (context: { contextId?: string; contextGeneration?: number; documents: { read(id: string): { revision: number } | undefined } }) => ({
  contextId: context.contextId as string,
  generation: context.contextGeneration ?? 0,
  revision: context.documents.read(context.contextId as string)?.revision ?? 0
});

const PROPOSED = normaliseCv({ ...BODY, languages: [...BODY.languages, { name: 'German', level: 'B2' }] } as CvDocument);
const ADD_GERMAN: CvChange[] = [{ op: 'add', path: ['languages', 2], after: { name: 'German', level: 'B2' } }];

const withHarness = async (
  edit: ReturnType<typeof proposing>,
  body: (h: ReturnType<typeof createHarness>, id: string, lifecycle: CvLifecycle) => Promise<void> | void
): Promise<void> => {
  const s = scratch();
  const id = createCvContextStore(s.db).create(randomUUID(), 'pl').id;
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { edit_cv: edit } });
  try {
    h.profile.replaceContext(id, BODY as never, 0);
    // The harness shows a host what it may do; storing a proposal is the runtime's own act.
    const lifecycle = createCvLifecycle(
      s.connect(), createCvContextStore(s.db), createDocumentStore(s.db), createChunkIndex(s.db), () => emptyDocument() as unknown as DocumentBody
    );
    await body(h, id, lifecycle);
  } finally {
    h.close();
    s.dispose();
  }
};

test('a run that proposes stores what the edit was aimed at and what it changed, with the proposal', async () => {
  const edit = proposing((context) => ({
    document: PROPOSED, changed: true, base: baseOf(context), target: `cv:${context.contextId}/languages`, changes: ADD_GERMAN
  }));

  await withHarness(edit, async (h, id) => {
    const run = await h.run({ capability: 'edit_cv', input: {}, contextId: id, runId: 'p1' });
    assert.equal(run.data.proposalId, 'p1');

    const [stored] = h.cvLifecycle.list(id);
    assert.equal(stored?.target, `cv:${id}/languages`);
    assert.deepEqual(stored?.changes, ADD_GERMAN);
    assert.equal(stored?.status, 'pending');
  });
});

test('a proposal made without them is stored as it always was, and has neither', async () => {
  const edit = proposing((context) => ({ document: PROPOSED, changed: true, base: baseOf(context) }));

  await withHarness(edit, async (h, id) => {
    await h.run({ capability: 'edit_cv', input: {}, contextId: id, runId: 'p1' });
    const [stored] = h.cvLifecycle.list(id);
    assert.ok(stored);
    assert.equal('target' in stored, false);
    assert.equal('changes' in stored, false);
  });
});

test('a target with no changes, or changes with no target, are not stored as half of what they were', async () => {
  for (const half of [{ target: 'cv:x/languages' }, { changes: ADD_GERMAN }]) {
    const edit = proposing((context) => ({ document: PROPOSED, changed: true, base: baseOf(context), ...half }));
    await withHarness(edit, async (h, id) => {
      await h.run({ capability: 'edit_cv', input: {}, contextId: id, runId: 'p1' });
      const [stored] = h.cvLifecycle.list(id);
      assert.equal('target' in (stored ?? {}), false, JSON.stringify(half));
      assert.equal('changes' in (stored ?? {}), false, JSON.stringify(half));
    });
  }
});

test('an edit that changes nothing stores no proposal, however many changes it lists', async () => {
  const edit = proposing((context) => ({
    document: PROPOSED, changed: false, base: baseOf(context), target: `cv:${context.contextId}/languages`, changes: []
  }));

  await withHarness(edit, async (h, id) => {
    const run = await h.run({ capability: 'edit_cv', input: {}, contextId: id, runId: 'p1' });
    assert.equal(run.data.proposalId, undefined);
    assert.deepEqual(h.cvLifecycle.list(id), []);
  });
});

test('changes that are not changes fail the run that made them, and store nothing', async () => {
  const unreadable: unknown[] = [
    [{ op: 'swap', path: ['languages', 0] }],
    [{ op: 'add', path: [], after: 1 }],
    [{ op: 'add', path: ['languages', -1], after: 1 }],
    [{ op: 'add', path: ['languages', 2], after: 1, extra: true }],
    'add',
    { op: 'add' }
  ];

  for (const changes of unreadable) {
    const edit = proposing((context) => ({
      document: PROPOSED, changed: true, base: baseOf(context), target: `cv:${context.contextId}/languages`, changes
    }));
    await withHarness(edit, async (h, id) => {
      await assert.rejects(h.run({ capability: 'edit_cv', input: {}, contextId: id, runId: 'p1' }), Error, JSON.stringify(changes));
      assert.equal(h.runs.get('p1')?.status, 'failed');
      assert.deepEqual(h.cvLifecycle.list(id), []);
    });
  }
});

test('storing the same proposal again is the same proposal, and a different one under its id is a conflict', async () => {
  const edit = proposing((context) => ({
    document: PROPOSED, changed: true, base: baseOf(context), target: `cv:${context.contextId}/languages`, changes: ADD_GERMAN
  }));

  await withHarness(edit, async (h, id, lifecycle) => {
    await h.run({ capability: 'edit_cv', input: {}, contextId: id, runId: 'p1' });
    const base = { contextId: id, generation: 0, revision: 1 };
    const document = PROPOSED as unknown as DocumentBody;
    const details = { target: `cv:${id}/languages`, changes: ADD_GERMAN };

    assert.deepEqual(lifecycle.propose('p1', base, document, details), h.cvLifecycle.list(id)[0]);

    const conflicts: [string, Parameters<CvLifecycle['propose']>[3]][] = [
      ['another target', { ...details, target: `cv:${id}/education` }],
      ['other changes', { ...details, changes: [{ op: 'add', path: ['languages', 2], after: { name: 'French', level: 'A2' } }] }],
      ['no changes', { ...details, changes: [] }],
      ['no details', undefined]
    ];
    for (const [name, other] of conflicts) {
      assert.throws(() => lifecycle.propose('p1', base, document, other), { code: 'context_conflict' }, name);
    }
    assert.equal(h.cvLifecycle.list(id).length, 1);
  });
});

/* ------------------------------------------------------------ an accept */

/** What a real edit proposes, stored the way the hook stores it, over the runtime's own database. */
const proposed = async (rt: Runtime, input: Record<string, unknown>): Promise<{ id: string; data: Record<string, unknown> }> => {
  const run = rt.begin({ instruction: INSTRUCTION, ...input });
  const data = (await run.settled).data;
  rt.lifecycle.propose(run.runId, data.base as never, normaliseCv(documentOf(data)) as unknown as DocumentBody, {
    target: data.target as string,
    changes: data.changes as CvChange[]
  });
  return { id: run.runId, data };
};

const tamper = (rt: Runtime, id: string, column: 'changes' | 'target' | 'document', value: string | null): void => {
  rt.s.db.prepare(`UPDATE cv_proposals SET ${column} = ? WHERE id = ?`).run(value, id);
};

test('accepting what an edit proposed writes the document it proposed, one revision on, and nothing else moved', async () => {
  for (const section of sectionNames) {
    const rt = runtime();
    try {
      const { id, data } = await proposed(rt, { target: targetOf(CONTEXT, section) });
      const before = rt.s.deps.documents.read(CONTEXT);
      assert.deepEqual(rt.stored(), BODY, 'a proposal is not a save');

      const record = rt.lifecycle.accept(CONTEXT, id);
      assert.equal(record.revision, (before?.revision ?? 0) + 1, section);
      assert.deepEqual(rt.stored(), normaliseCv(documentOf(data)), section);
      assert.equal(rt.lifecycle.list(CONTEXT)[0]?.status, 'accepted');
      for (const other of sectionNames) {
        if (other !== section) assert.deepEqual(rt.stored()[other], BODY[other], `${section} moved ${other}`);
      }
    } finally {
      rt.dispose();
    }
  }
});

test('an accept that is made again is the same accept, and writes nothing more', async () => {
  const rt = runtime();
  try {
    const { id } = await proposed(rt, { target: ref('experience') });
    const first = rt.lifecycle.accept(CONTEXT, id);
    const again = rt.lifecycle.accept(CONTEXT, id);
    assert.deepEqual(again, first);
    assert.equal(rt.s.deps.documents.read(CONTEXT)?.revision, first.revision);
  } finally {
    rt.dispose();
  }
});

test('a proposal made over an older revision is not accepted, and waits', async () => {
  const rt = runtime();
  try {
    const { id } = await proposed(rt, { target: ref('experience') });
    rt.s.deps.documents.update(CONTEXT, CV_KIND, (current) => ({ ...(current as object), role_description: 'Changed by hand.' }));

    assert.throws(() => rt.lifecycle.accept(CONTEXT, id), { code: 'document_conflict' });
    assert.equal(rt.lifecycle.list(CONTEXT)[0]?.status, 'pending');
    assert.equal(rt.stored().role_description, 'Changed by hand.');
    assert.equal(rt.stored().experience[0]?.title, 'Senior Engineer');
  } finally {
    rt.dispose();
  }
});

test('an accept writes the stored document with the changes applied, not the proposal own copy of it', async () => {
  const rt = runtime();
  try {
    const { id, data } = await proposed(rt, { target: ref('overview/personal') });
    // The same document, kept in another order. What is written follows the stored one.
    const reordered = JSON.stringify(documentOf(data), (_key, value: unknown) =>
      value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
    tamper(rt, id, 'document', reordered);

    rt.lifecycle.accept(CONTEXT, id);
    const written = JSON.stringify(rt.stored());
    assert.equal(written, JSON.stringify(applyCv(BODY, changesOf(data))));
    assert.notEqual(written, reordered);
  } finally {
    rt.dispose();
  }
});

test('changes that reach outside the section they were aimed at are refused when they are accepted, whoever stored them', async () => {
  const rt = runtime();
  try {
    const { id, data } = await proposed(rt, { target: ref('overview/skills') });
    const elsewhere: CvChange[] = [
      ...changesOf(data),
      { op: 'replace', path: ['role_description'], before: BODY.role_description, after: 'Rewritten.' }
    ];
    tamper(rt, id, 'changes', JSON.stringify(elsewhere));
    tamper(rt, id, 'document', JSON.stringify({ ...documentOf(data), role_description: 'Rewritten.' }));

    assert.throws(
      () => rt.lifecycle.accept(CONTEXT, id),
      (error: Error & { code?: string }) => error.code === 'proposal_out_of_scope' && error.message.includes('role_description') && !error.message.includes('Rewritten')
    );
    assert.deepEqual(rt.stored(), BODY, 'nothing was written');
    assert.equal(rt.lifecycle.list(CONTEXT)[0]?.status, 'pending');
  } finally {
    rt.dispose();
  }
});

test('a proposal whose changes cannot be read, or that has none to name a target for, is not accepted', async () => {
  const cases: [string, 'changes' | 'target', string | null][] = [
    ['changes that are not a list', 'changes', '{"not":"a list"}'],
    ['changes that are not changes', 'changes', '[{"op":"swap"}]'],
    ['no target', 'target', null],
    ['a target that is not a section', 'target', 'cv:ctx/hobbies'],
    ['the target of another CV', 'target', 'cv:elsewhere/experience']
  ];

  for (const [name, column, value] of cases) {
    const rt = runtime();
    try {
      const { id } = await proposed(rt, { target: ref('experience') });
      tamper(rt, id, column, value);
      assert.throws(() => rt.lifecycle.accept(CONTEXT, id), (error: Error & { code?: string }) =>
        ['proposal_out_of_scope', 'invalid_selection', 'invalid_ref'].includes(error.code ?? ''), name);
      assert.deepEqual(rt.stored(), BODY, name);
      assert.equal(rt.lifecycle.list(CONTEXT)[0]?.status, 'pending', name);
    } finally {
      rt.dispose();
    }
  }
});

test('an unreadable list of changes, and a target that is missing, are the proposal being out of scope', async () => {
  for (const [column, value] of [['changes', '{"not":"a list"}'], ['target', null]] as const) {
    const rt = runtime();
    try {
      const { id } = await proposed(rt, { target: ref('experience') });
      tamper(rt, id, column, value);
      assert.throws(() => rt.lifecycle.accept(CONTEXT, id), { code: 'proposal_out_of_scope' }, column);
    } finally {
      rt.dispose();
    }
  }
});

test('changes that do not apply to the document, or that do not make the document the proposal holds, are a conflict', async () => {
  const rt = runtime();
  try {
    const stale = await proposed(rt, { target: ref('experience') });
    // It says the title was something it was not.
    tamper(rt, stale.id, 'changes', JSON.stringify([{ op: 'replace', path: ['experience', 0, 'title'], before: 'Someone Else', after: 'Staff Engineer' }]));
    assert.throws(
      () => rt.lifecycle.accept(CONTEXT, stale.id),
      (error: Error & { code?: string }) => error.code === 'context_conflict' && error.message.startsWith('Change 1 does not apply') && !error.message.includes('Someone Else') && !error.message.includes('Senior Engineer') && !error.message.includes(CANARY.acme)
    );

    const short = await proposed(rt, { target: ref('experience') });
    // It applies, and does not make what the proposal holds.
    tamper(rt, short.id, 'changes', '[]');
    assert.throws(
      () => rt.lifecycle.accept(CONTEXT, short.id),
      (error: Error & { code?: string }) => error.code === 'context_conflict' && error.message.includes('do not make the document')
    );

    assert.deepEqual(rt.stored(), BODY);
    assert.deepEqual(rt.lifecycle.list(CONTEXT).map((each) => each.status), ['pending', 'pending']);
  } finally {
    rt.dispose();
  }
});

test('a proposal made before changes were kept is accepted as the document it holds', async () => {
  const rt = runtime();
  try {
    const run = rt.begin({ instruction: INSTRUCTION, target: ref('overview/personal') });
    const data = (await run.settled).data;
    rt.lifecycle.propose(run.runId, data.base as never, normaliseCv(documentOf(data)) as unknown as DocumentBody);

    rt.lifecycle.accept(CONTEXT, run.runId);
    assert.deepEqual(rt.stored(), normaliseCv(documentOf(data)));
  } finally {
    rt.dispose();
  }
});

test('a proposal that is discarded or invalidated is not accepted, with or without changes', async () => {
  const rt = runtime();
  try {
    const { id } = await proposed(rt, { target: ref('experience') });
    rt.lifecycle.discard(CONTEXT, id);
    assert.throws(() => rt.lifecycle.accept(CONTEXT, id), { code: 'context_conflict' });
    assert.deepEqual(rt.stored(), BODY);
  } finally {
    rt.dispose();
  }
});

/* ------------------------------------------------------------- the host */

test('the host is told what was kept: the target and the changes of each proposal, and the code of a refusal', async () => {
  const s = scratch();
  const id = createCvContextStore(s.db).create(randomUUID(), 'pl').id;
  const edit = proposing((context) => ({
    document: PROPOSED, changed: true, base: baseOf(context), target: `cv:${context.contextId}/languages`, changes: ADD_GERMAN
  }));
  const h = createHarness({ databasePath: s.path, env: {}, capabilities: { edit_cv: edit } });
  try {
    h.profile.replaceContext(id, BODY as never, 0);
    await h.run({ capability: 'edit_cv', input: {}, contextId: id, runId: 'p1' });
    const dispatch = createDispatch(h);

    const listed = await dispatch('profile.proposals.list', { contextId: id });
    assert.equal(listed.ok, true);
    const [first] = (listed as unknown as { data: { proposals: Record<string, unknown>[] } }).data.proposals;
    assert.equal(first?.target, `cv:${id}/languages`);
    assert.deepEqual(first?.changes, ADD_GERMAN);

    s.db.prepare("UPDATE cv_proposals SET target = 'cv:' || context_id || '/overview/skills' WHERE id = 'p1'").run();
    const refused = await dispatch('profile.proposals.accept', { contextId: id, proposalId: 'p1' });
    assert.equal(refused.ok, false);
    assert.equal((refused as unknown as { error: { code: string } }).error.code, 'proposal_out_of_scope');

    s.db.prepare("UPDATE cv_proposals SET target = 'cv:' || context_id || '/languages' WHERE id = 'p1'").run();
    const accepted = await dispatch('profile.proposals.accept', { contextId: id, proposalId: 'p1' });
    assert.equal(accepted.ok, true);
  } finally {
    h.close();
    s.dispose();
  }
});

test('the host can ask whether the runtime aims an edit at a section', async () => {
  const s = scratch();
  const h = createHarness({ databasePath: s.path, env: {} });
  try {
    const result = await createDispatch(h)('protocol.get', {});
    assert.equal(result.ok, true);
    const features = (result as unknown as { data: { features: string[] } }).data.features;
    assert.ok(features.includes('grounding-edits'));
    assert.equal(new Set(features).size, features.length);
  } finally {
    h.close();
    s.dispose();
  }
});

/* ------------------------------------------------------------- migration */

test('the columns are added to a store that has proposals, and what it held is what it holds', async () => {
  const db = open(':memory:');
  try {
    migrate(db, migrations.filter((m) => m.version <= 44));
    assert.deepEqual(
      (db.prepare("SELECT name FROM pragma_table_info('cv_proposals') ORDER BY cid").all() as { name: string }[]).map((c) => c.name),
      ['id', 'context_id', 'base_revision', 'generation', 'document', 'status', 'accepted_record', 'created_at']
    );

    db.prepare("INSERT INTO cv_contexts (id, language, created_at, updated_at) VALUES ('c1', 'en', 1, 1)").run();
    db.prepare("INSERT INTO runs (id, capability, status, input, trace_id, created_at, context_id, context_generation) VALUES ('r1', 'edit_cv', 'succeeded', '{}', 't', 1, 'c1', 0)").run();
    db.prepare("INSERT INTO cv_proposals (id, context_id, base_revision, generation, document, status, created_at) VALUES ('r1', 'c1', 0, 0, ?, 'pending', 5)")
      .run(JSON.stringify({ role_description: 'old' }));
    const before = db.prepare("SELECT * FROM cv_proposals WHERE id = 'r1'").get();

    migrate(db);
    migrate(db);

    assert.deepEqual(
      (db.prepare("SELECT name FROM pragma_table_info('cv_proposals') ORDER BY cid").all() as { name: string }[]).map((c) => c.name),
      ['id', 'context_id', 'base_revision', 'generation', 'document', 'status', 'accepted_record', 'created_at', 'target', 'changes']
    );
    assert.deepEqual(db.prepare("SELECT * FROM cv_proposals WHERE id = 'r1'").get(), { ...(before as object), target: null, changes: null });

    const lifecycle = createCvLifecycle(db, createCvContextStore(db), createDocumentStore(db), createChunkIndex(db), () => ({}) as DocumentBody);
    const [old] = lifecycle.list('c1');
    assert.deepEqual(old, { id: 'r1', base: { contextId: 'c1', revision: 0, generation: 0 }, document: { role_description: 'old' }, status: 'pending', createdAt: 5 });

    lifecycle.accept('c1', 'r1');
    assert.deepEqual(createDocumentStore(db).read('c1')?.body, { role_description: 'old' });
  } finally {
    db.close();
  }
});
