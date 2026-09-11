/**
 * The merge policy, and the summary parser that needs no model.
 *
 * The policy under test is one sentence — an import may add, and may fill a
 * blank, but may never overwrite — and it is the sentence that decides whether
 * a bad extraction is an inconvenience or a data loss. Every assertion here is
 * that sentence from a different angle.
 *
 * Mutations run, not assumed. Each was applied, the suite run, the failures
 * counted, and the mutation reverted:
 *
 *   `fill` drops its blank check            2  fills a blank … / re-merging …
 *   experience matched on company alone     2  a promotion … / may date an undated …
 *   a `null` finish becomes fillable        1  may date an undated …
 *   a union keeps the incoming casing       1  a union keeps the casing …
 *   sources overwritten, not appended       1  re-merging …
 *   the section test moved after the        1  the fallback scan stops …
 *     heading-like test
 *   `MIN_SUMMARY_LENGTH` lowered to 0       2  an unlabelled … / no summary …
 *
 * The last-but-one was worth the trouble: on the first pass it killed *nothing*,
 * because every summary fixture either had an explicit heading or found its
 * paragraph before reaching a section boundary, so the fallback loop's ordering
 * was never exercised. "The fallback scan stops at the first section heading"
 * exists because of that null result.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CV_ID,
  CV_KIND,
  asCvDocument,
  cvDocumentSchema,
  emptyDocument,
  experienceEntrySchema,
  type CvDocument,
  type ExperienceEntry
} from '../src/capabilities/cv/document.js';
import { mergeDocument } from '../src/capabilities/cv/merge.js';
import { findSummary } from '../src/capabilities/cv/summary.js';
import { createDocumentStore } from '../src/storage/sqlite/document-store.js';
import { scratch } from './support/db.js';

const doc = (over: Record<string, unknown> = {}): CvDocument => cvDocumentSchema.parse(over);

/** An experience entry from whatever a test cares about, defaults for the rest. */
const job = (over: Record<string, unknown>): ExperienceEntry => experienceEntrySchema.parse(over);

/* --------------------------------------------------------------- the policy */

test('an import fills a blank and leaves everything else alone', () => {
  const existing = doc({
    personal: { name: 'Ada Lovelace', email: '', links: { github: 'https://github.test/ada' } },
    role_description: 'Analytical engine programmer.'
  });

  const { document, report } = mergeDocument(existing, {
    personal: {
      name: 'A. Lovelace',
      email: 'ada@example.test',
      phone: '',
      location: 'London',
      links: { github: 'https://elsewhere.test/ada', linkedin: 'https://li.test/ada' }
    },
    role_description: 'Something a model made up.'
  });

  assert.equal(document.personal.name, 'Ada Lovelace', 'a filled name was overwritten');
  assert.equal(document.personal.email, 'ada@example.test', 'a blank was not filled');
  assert.equal(document.personal.location, 'London');
  assert.equal(document.personal.phone, '', 'a blank incoming value counts as nothing');
  assert.equal(document.role_description, 'Analytical engine programmer.');

  assert.equal(document.personal.links.github, 'https://github.test/ada', 'a link was replaced');
  assert.equal(document.personal.links.linkedin, 'https://li.test/ada');

  assert.deepEqual(report.filled.sort(), [
    'personal.email',
    'personal.links.linkedin',
    'personal.location'
  ]);

  // The mutator may be re-run when a write loses the revision check, so it has
  // to leave its argument untouched.
  assert.equal(existing.personal.email, '', 'mergeDocument mutated the document it was given');
});

test('the same company twice is a promotion, not a duplicate', () => {
  const existing = doc({
    experience: [{ company: 'Acme', title: 'Engineer', highlights: ['Shipped the parser.'] }]
  });

  const { document, report } = mergeDocument(existing, {
    experience: [
      job({ company: 'ACME  ', title: 'engineer', highlights: ['Shipped the parser.', 'Cut p99.'] }),
      job({ company: 'Acme', title: 'Senior Engineer', highlights: ['Led the rewrite.'] })
    ]
  });

  assert.equal(document.experience.length, 2, 'the promotion collapsed into the first entry');
  assert.deepEqual(document.experience[0]?.highlights, ['Shipped the parser.', 'Cut p99.']);
  assert.equal(document.experience[1]?.title, 'Senior Engineer');
  assert.equal(report.added.experience, 1);
  assert.equal(report.added.highlights, 2, 'one unioned bullet plus one whole new entry');
});

test('a union keeps the casing already stored', () => {
  const existing = doc({ skills: { programming_languages: ['TypeScript', 'Rust'] } });

  const { document } = mergeDocument(existing, {
    skills: {
      role: '',
      // No rows of its own, which is what an extraction produces: the merge
      // reads the three arrays as the rows they imply.
      groups: [],
      programming_languages: ['typescript', 'Go'],
      frameworks: [],
      libraries_and_tools: []
    }
  });

  assert.deepEqual(
    document.skills.programming_languages,
    ['TypeScript', 'Rust', 'Go'],
    'a hand-corrected casing was undone by an import'
  );
});

test('an import may date an undated role but may not close an open one', () => {
  const existing = doc({
    experience: [
      { company: 'Acme', title: 'Ongoing', finished: null },
      { company: 'Acme', title: 'Undated', finished: '' },
      { company: 'Acme', title: 'Dated', finished: '2020-01' }
    ]
  });

  const { document } = mergeDocument(existing, {
    experience: ['Ongoing', 'Undated', 'Dated'].map((title) =>
      job({ company: 'Acme', title, finished: '2023-06' })
    )
  });

  assert.equal(document.experience[0]?.finished, null, 'an import closed an open-ended role');
  assert.equal(document.experience[1]?.finished, '2023-06', 'an unknown end date was not filled');
  assert.equal(document.experience[2]?.finished, '2020-01', 'a stated end date was overwritten');
});

test('re-merging the same import changes nothing but provenance', () => {
  const incoming: Partial<CvDocument> = {
    personal: { name: 'Ada', email: '', phone: '', location: '', links: {} },
    experience: [job({ company: 'Acme', title: 'Engineer', started: '2019', highlights: ['a'], skills: ['Rust'] })],
    education: [{ university: 'Cambridge', degree: 'MSc', started: '', finished: '', thesis: '', mark: '' }],
    certificates: [{ name: 'CKA', issuer: 'CNCF', started: '', finished: '' }],
    languages: [{ name: 'Polish', level: 'native' }],
    sources: [{ kind: 'pdf', reference: 'cv.pdf', imported_at: '2026-01-01T00:00:00.000Z' }]
  };

  const once = mergeDocument(emptyDocument(), incoming).document;
  const { document: twice, report } = mergeDocument(once, incoming);

  // Everything but `sources` is idempotent, which is what makes this safe as a
  // mutator that may be run a second time after losing a revision check.
  assert.deepEqual({ ...twice, sources: [] }, { ...once, sources: [] });
  assert.deepEqual(report.filled, []);
  assert.deepEqual(report.added, {
    experience: 0,
    education: 0,
    certificates: 0,
    languages: 0,
    highlights: 0,
    skills: 0
  });

  // Provenance is the exception on purpose: two imports happened, and the record
  // of where a field came from stays true even when the second added nothing.
  assert.equal(twice.sources.length, 2);
});

/* ----------------------------------------------------------- the skills strip */

/**
 * The rows, and the three arrays that are now derived from them.
 *
 * What these are really testing is that a category the author invents survives
 * being stored. It did not before: the strip's only shape was three fixed
 * arrays, so a fourth row was folded into `libraries_and_tools` on the way in
 * and read back under that name — which made adding and renaming a category
 * something the interface could offer and the document could not keep.
 */

test('a body stored before rows existed comes back with them', () => {
  const stored = asCvDocument({
    version: 1,
    skills: {
      role: 'Backend Engineer',
      programming_languages: ['TypeScript'],
      frameworks: ['NestJS'],
      libraries_and_tools: []
    }
  });

  assert.deepEqual(stored.skills.groups, [
    { label: 'Languages', items: ['TypeScript'] },
    { label: 'Frameworks', items: ['NestJS'] }
  ]);

  // Not three rows, one of them empty. An empty legacy array means "this CV has
  // no tools listed", and reviving it as a row would greet every migrated
  // document with a heading it never had.
  assert.equal(stored.skills.groups.length, 2);
});

test('the rows are the document, and the three arrays restate them', () => {
  const stored = asCvDocument({
    version: 1,
    skills: {
      role: '',
      groups: [
        { label: 'Languages', items: ['Rust'] },
        { label: 'Blockchain', items: ['ICP', 'Solidity'] }
      ],
      // Stale, and deliberately disagreeing: a client that sent both is a client
      // whose fold is a frame behind its rows. The rows win.
      programming_languages: ['TypeScript'],
      frameworks: ['NestJS'],
      libraries_and_tools: []
    }
  });

  assert.deepEqual(stored.skills.programming_languages, ['Rust']);
  assert.deepEqual(stored.skills.frameworks, []);

  // A row the fold has no bucket for keeps its own heading and still reaches
  // every reader that concatenates the three. This is the limitation stated
  // plainly: the label survives, the *category* does not reach board search.
  assert.deepEqual(stored.skills.libraries_and_tools, ['ICP', 'Solidity']);
  assert.equal(stored.skills.groups[1]?.label, 'Blockchain');
});

test('a row that was removed stays removed', () => {
  // The bug this whole change exists for. Emptying `frameworks` used to be the
  // only way to remove a row, and adding one was not expressible at all.
  const after = asCvDocument({
    version: 1,
    skills: {
      role: '',
      groups: [{ label: 'Languages', items: ['Rust'] }],
      programming_languages: ['Rust'],
      frameworks: ['NestJS'],
      libraries_and_tools: []
    }
  });

  assert.deepEqual(after.skills.groups.map((group) => group.label), ['Languages']);
  assert.deepEqual(after.skills.frameworks, [], 'a removed row came back through the fold');
});

test('an import adds a row it has not seen and unions into one it has', () => {
  const existing = doc({
    skills: {
      role: 'Backend Engineer',
      groups: [
        { label: 'Languages', items: ['TypeScript'] },
        { label: 'Blockchain', items: ['ICP'] }
      ]
    }
  });

  const { document, report } = mergeDocument(existing, {
    skills: {
      role: 'Staff Engineer',
      groups: [],
      // An extraction answers in the three lists — see `skillFields` — so the
      // merge has to read them as the rows they imply.
      programming_languages: ['typescript', 'Go'],
      frameworks: ['NestJS'],
      libraries_and_tools: []
    }
  });

  assert.deepEqual(
    document.skills.groups,
    [
      // Matched on the heading, and the stored casing survives.
      { label: 'Languages', items: ['TypeScript', 'Go'] },
      { label: 'Blockchain', items: ['ICP'] },
      // A heading the CV did not have is an *add*, appended after what is there.
      { label: 'Frameworks', items: ['NestJS'] }
    ],
    'an import moved or renamed a row that was already stored'
  );

  assert.equal(report.added.skills, 2, 'Go and NestJS');
  assert.equal(document.skills.role, 'Backend Engineer', 'an import overwrote a stated role');
});

test('a row is matched by its heading however it is cased or spaced', () => {
  const existing = doc({ skills: { groups: [{ label: 'Libraries & Tools', items: ['Sentry'] }] } });

  const { document } = mergeDocument(existing, {
    skills: {
      role: '',
      groups: [{ label: '  libraries  &   TOOLS ', items: ['Sentry', 'Datadog'] }],
      programming_languages: [],
      frameworks: [],
      libraries_and_tools: []
    }
  });

  assert.equal(document.skills.groups.length, 1, 'one heading became two rows');
  assert.deepEqual(document.skills.groups[0]?.items, ['Sentry', 'Datadog']);
  assert.equal(document.skills.groups[0]?.label, 'Libraries & Tools', 'the stored heading was recased');
});

/* ---------------------------------------------------------------- the store */

test('two merges through the store leave both writers work', () => {
  const s = scratch();
  const documents = createDocumentStore(s.db);

  try {
    const merge =
      (incoming: Partial<CvDocument>) =>
      (current: Readonly<Record<string, unknown>> | undefined) =>
        mergeDocument(asCvDocument(current), incoming).document;

    documents.update(CV_ID, CV_KIND, merge({ personal: { name: 'Ada', email: '', phone: '', location: '', links: {} } }));
    const second = documents.update(
      CV_ID,
      CV_KIND,
      merge({ languages: [{ name: 'Polish', level: 'native' }] })
    );

    const stored = asCvDocument(second.body);
    assert.equal(stored.personal.name, 'Ada', 'the second merge dropped the first');
    assert.equal(stored.languages[0]?.name, 'Polish');
    assert.equal(second.revision, 2);
  } finally {
    s.dispose();
  }
});

test('a body the schema does not recognise throws rather than starting over', () => {
  assert.deepEqual(asCvDocument(undefined), emptyDocument(), 'an absent document is an empty one');
  assert.throws(
    () => asCvDocument({ version: 1, experience: [{ title: 'no company' }] }),
    /does not match the document schema/
  );
});

/* -------------------------------------------------------------- the summary */

const CV = [
  'Ada Lovelace',
  'ada@example.test · +48 500 100 200',
  '',
  'Summary',
  '',
  'Backend engineer with eight years on payment systems, mostly TypeScript and',
  'PostgreSQL. Comfortable owning a service end to end, from schema to on-call.',
  '',
  'Experience',
  '',
  'Acme — Senior Engineer',
  'Rewrote the billing pipeline and cut p99 latency by half.'
].join('\n');

test('the summary comes from under its heading', () => {
  assert.match(findSummary(CV), /^Backend engineer with eight years/);
  assert.doesNotMatch(findSummary(CV), /Acme/, 'the scan ran into the experience section');
});

test('an unlabelled opening paragraph is found, and the contact block is not', () => {
  const unlabelled = [
    'Ada Lovelace',
    'ada@example.test',
    '',
    'Backend engineer with eight years on payment systems, mostly TypeScript and',
    'PostgreSQL. Comfortable owning a service end to end.',
    '',
    'Experience'
  ].join('\n');

  assert.match(findSummary(unlabelled), /^Backend engineer/);
});

test('the fallback scan stops at the first section heading', () => {
  // No summary heading, so the fallback runs; and the only long paragraph in
  // the document sits *after* a section boundary. A scan that treats
  // "EXPERIENCE" as merely heading-like and skips past it returns a job
  // description as the person's own words — which is why the section test has
  // to come before the heading-like test rather than after it.
  const noSummary = [
    'Ada Lovelace',
    'ada@example.test',
    '',
    'EXPERIENCE',
    '',
    'Acme — Senior Engineer',
    'Rewrote the billing pipeline and cut p99 latency by half, then owned the',
    'on-call rotation for two years.'
  ].join('\n');

  assert.equal(findSummary(noSummary), '', 'a job description was returned as the summary');
});

test('no summary is an empty string, not a guess', () => {
  const bare = ['Ada Lovelace', 'Frontend Developer, Warsaw', '', 'Experience', '', 'Acme'].join(
    '\n'
  );
  assert.equal(findSummary(bare), '', 'a job title was returned as a summary');
});
