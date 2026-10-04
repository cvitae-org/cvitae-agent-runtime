/**
 * What a CV and an offer are as wells: what their pieces are called, and what a
 * read of one says.
 *
 * The engine knows no domain (`grounding-engine.test.ts` runs it over a
 * helpdesk). This file is the other half: that a CV divides into the pieces the
 * plan names, that each piece is called the same thing however the model got it,
 * and that an entry says exactly what was digested. The digests here are never
 * taken from the code under test. A piece is digested from the literal in this
 * file, so an entry that digested the wrong thing, such as the bounded copy in
 * place of the original or the stored body in place of the normalised one, has
 * nothing to agree with.
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 73 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * how a name is made:
 *   a name is not normalised                       1
 *   a name keeps its case                          14
 *   only ascii letters are kept                    4
 *   digits are separators                          1
 *   a separator run becomes nothing                13
 *   a leading dash is kept                         1
 *   a name is not cut                              2
 *   a name is cut at ninety-nine                   1
 *   a name is cut at a hundred and one             2
 *   a name is not cut by what it costs             2
 *   a name that costs the limit is cut             1
 *   a name one byte over the limit is kept         1
 *   a cut leaves its separator                     3
 *   a part is cut by what it costs in letters, not in bytes 2
 *   a part that says nothing is joined             1
 *   a name that says nothing has no name           1
 *   parts are joined with a dash                   15
 *
 * two items with one name:
 *   a taken name is not numbered                   8
 *   numbering starts at one                        8
 *   numbering skips a number                       8
 *   a name is forgotten once given                 8
 *
 * what names an item:
 *   experience is keyed by employer only           13
 *   experience is keyed by title only              15
 *   education is keyed by the school only          2
 *   certificates are keyed by the issuer           4
 *   languages are keyed by level                   2
 *   an item is addressed by its section            15
 *   an item is addressed by its key alone          15
 *   a key with no section is addressed             1
 *
 * what an entry says:
 *   a body that is not a CV is an empty one        1
 *   a body is not normalised                       5
 *   the version is a number                        13
 *   the version is the next revision               5
 *   the digest is of what was shown                6
 *   what was shown is not recorded                 5
 *   what was shown is the whole                    5
 *   an entry is from the client                    4
 *   an entry is always included                    2
 *   an entry has no channel of its own             4
 *
 * the whole CV and the overview:
 *   the whole CV is addressed as the overview      1
 *   the whole CV is digested as the stored body    1
 *   the overview leaves out the skills             1
 *   the overview names pieces in another order     1
 *   a piece nobody handed over is recorded         2
 *   a piece is digested as the model got it        1
 *   a piece says nothing of what it was cut to     1
 *
 * a page of a list section:
 *   an item is named by its place in the page      2
 *   an item the document lacks is recorded         1
 *   a page with no items is believed               2
 *   an item says nothing of what it was cut to     1
 *   an item is digested as the model got it        1
 *   an unknown section is read as a list           1
 *   any text is a section                          1
 *
 * where a passage belongs:
 *   a passage is placed by its position alone      1
 *   a passage is placed by its employer alone      1
 *   a passage is placed by its title alone         1
 *   a passage position may be text                 1
 *   a passage is never placed in an entry          3
 *   a passage of an empty description is placed in it 1
 *   a passage of the description is never placed   1
 *   a placed passage is digested as the whole CV   3
 *   a passage that cannot be placed is not recorded 3
 *   a passage that is not shown is shown           2
 *   a passage that is shown is not                 3
 *   a passage is shown as its piece                3
 *   a passage read is included                     1
 *
 * the posting, and the wells a runtime starts with:
 *   the posting is another section                 1
 *   the posting is addressed by another scope      1
 *   the offers well is called something else       2
 *   the preferences well is not declared           1
 *   the conversation well is not declared          1
 *   the preferences well has another name          1
 *   the cv well has another name                   18
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationError } from '../src/contracts/index.js';
import type { RecordEntry } from '../src/contracts/index.js';
import { cvHitEntries, cvKeys, cvOf, cvReadEntries, cvRef, cvWholeEntry } from '../src/capabilities/cv/well.js';
import type { CvHit } from '../src/capabilities/cv/well.js';
import { OFFERS_WELL, postingRef } from '../src/capabilities/offers/well.js';
import { createRecordBook, digest, encodeSegment, parseRef } from '../src/grounding/index.js';
import { defaultWells } from '../src/runtime/grounding.js';

/* ---------------------------------------------------------------- fixtures */

const SCOPE = 'ctx-1';
const REVISION = 7;

/** A stored body, written the way an older version wrote it: skills in three arrays, no groups. */
const body = {
  version: 1,
  personal: { name: 'Ada Example', email: 'ada@example.com', phone: '', location: 'Kraków', links: {} },
  role_description: 'Backend engineer focused on billing systems.',
  skills: {
    role: 'Engineer',
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
      highlights: ['Rewrote the billing pipeline.', 'Halved p99 latency.'],
      skills: ['Go']
    },
    {
      company: 'Globex',
      title: 'Engineer',
      started: '2018',
      finished: '2021',
      highlights: ['Built the design system.'],
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
    { university: 'MIT', degree: 'BSc Computer Science', started: '2012', finished: '2016', thesis: '', mark: '' }
  ],
  certificates: [{ name: 'AWS Solutions Architect', issuer: 'Amazon', started: '2020', finished: '' }],
  languages: [
    { name: 'Polish', level: 'native' },
    { name: 'English', level: 'C1' }
  ],
  sources: []
};

/** What the tools and the ports see of that body: the skills strip has its rows. */
const SKILLS = {
  role: 'Engineer',
  groups: [
    { label: 'Languages', items: ['TypeScript', 'Go'] },
    { label: 'Frameworks', items: ['React'] },
    { label: 'Libraries & Tools', items: ['Postgres'] }
  ],
  programming_languages: ['TypeScript', 'Go'],
  frameworks: ['React'],
  libraries_and_tools: ['Postgres']
};

const as = { ...body, skills: SKILLS };

const document = (() => {
  const parsed = cvOf(body);
  assert.ok(parsed, 'the fixture is a CV');
  return parsed;
})();

/** The entry as the record keeps it, which is what a reader of the record sees. */
const kept = (entries: readonly RecordEntry[]): readonly RecordEntry[] => {
  const book = createRecordBook(defaultWells());
  for (const entry of entries) book.add(entry);
  return book.entries();
};

const read = { status: 'included', via: 'tool:read_cv' } as const;

/** What `read_cv` hands over for an experience page: the page, with the items it kept. */
const page = (section: string, offset: number, items: readonly unknown[]) => ({
  offset,
  limit: 5,
  total: 3,
  hasMore: false,
  items
});

/* -------------------------------------------------------------------- keys */

test('an item is called after what it says, and one document always gets the same names', () => {
  const keys = cvKeys(document);

  assert.deepEqual(keys.experience, ['acme~senior-engineer', 'globex~engineer', 'acme~senior-engineer-2']);
  assert.deepEqual(keys.education, ['mit~bsc-computer-science']);
  assert.deepEqual(keys.certificates, ['aws-solutions-architect']);
  assert.deepEqual(keys.languages, ['polish', 'english']);

  // Parsed again from the same body: nothing about a name is chosen at random or by time.
  assert.deepEqual(cvKeys(cvOf(body)!), keys);
});

test('two items that say the same thing are told apart in the order the document has them', () => {
  const same = { ...document, certificates: ['Same', 'Same', 'Same', 'Same'].map((name) => ({ ...document.certificates[0]!, name })) };
  assert.deepEqual(cvKeys(same).certificates, ['same', 'same-2', 'same-3', 'same-4']);
});

test('a name that was earned is not taken by one that was only numbered', () => {
  // `A` twice, then something really called `A-2`: the numbered one must not take its address.
  const rows = (names: string[]) => ({
    ...document,
    certificates: names.map((name) => ({ ...document.certificates[0]!, name }))
  });

  assert.deepEqual(cvKeys(rows(['A', 'A', 'A-2'])).certificates, ['a', 'a-2', 'a-2-2']);
  assert.deepEqual(cvKeys(rows(['A-2', 'A', 'A'])).certificates, ['a-2', 'a', 'a-3']);
});

test('an item that says nothing a name can be made of is called entry', () => {
  const blank = {
    ...document,
    experience: [
      { ...document.experience[0]!, company: '', title: '' },
      { ...document.experience[0]!, company: '!!!', title: '--' },
      { ...document.experience[0]!, company: 'Acme', title: '' }
    ]
  };

  // A part that says nothing is left out, not joined: `acme~` would be a name nobody typed.
  assert.deepEqual(cvKeys(blank).experience, ['entry', 'entry-2', 'acme']);
});

test('a name is the same however it was typed: width, case and punctuation do not make a second item', () => {
  const typed = (company: string, title: string) => ({
    ...document,
    experience: [{ ...document.experience[0]!, company, title }]
  });

  assert.deepEqual(cvKeys(typed('ＡＣＭＥ', 'Sr.  Dev')).experience, ['acme~sr-dev']);
  assert.deepEqual(cvKeys(typed('Acme', 'sr dev')).experience, ['acme~sr-dev']);
  assert.deepEqual(cvKeys(typed('  --Acme--  ', '(Sr) Dev!')).experience, ['acme~sr-dev']);
});

test('letters of any script are part of a name, and the address still reads back', () => {
  const named = {
    ...document,
    experience: [{ ...document.experience[0]!, company: 'Zażółć Sp. z o.o.', title: 'Programista' }]
  };
  const key = cvKeys(named).experience[0]!;
  assert.equal(key, 'zażółć-sp-z-o-o~programista');

  const ref = cvRef(SCOPE, 'experience', key);
  // Written as UTF-8 bytes, so the address survives a place that only carries ASCII.
  assert.ok(/^[\x21-\x7e]+$/.test(ref), ref);
  assert.deepEqual(parseRef(ref), { well: 'cv', scope: SCOPE, path: ['experience', key] });
});

test('a long name is cut by what its address costs, and the address is still one the engine accepts', () => {
  const long = 'あ'.repeat(300);
  const named = {
    ...document,
    experience: [{ ...document.experience[0]!, company: long, title: long }]
  };

  const key = cvKeys(named).experience[0]!;
  const [company, title] = key.split('~') as [string, string];

  // Three bytes a letter and three characters a byte: 200 is what a part may cost in an address.
  assert.ok(encodeSegment(company).length <= 200, String(encodeSegment(company).length));
  assert.ok(encodeSegment(title).length <= 200);
  assert.ok(company.length > 10, 'cut, but not to nothing');

  const ref = cvRef(SCOPE, 'experience', key);
  assert.deepEqual(parseRef(ref).path, ['experience', key]);
});

test('two long names that are cut to the same thing are still two items', () => {
  const head = 'い'.repeat(300);
  const named = {
    ...document,
    experience: [
      { ...document.experience[0]!, company: `${head}x`, title: 'Engineer' },
      { ...document.experience[0]!, company: `${head}y`, title: 'Engineer' }
    ]
  };

  const keys = cvKeys(named).experience;
  assert.equal(new Set(keys).size, 2);
  assert.equal(keys[1], `${keys[0]}-2`);
});

test('a name that costs exactly what an address allows is kept whole, and one byte more is not', () => {
  // Thirty-three of a two-byte letter cost six characters each in an address, 198 in all.
  const named = (company: string) => ({
    ...document,
    experience: [{ ...document.experience[0]!, company, title: 'b' }]
  });
  const company = (text: string): string => cvKeys(named(text)).experience[0]!.split('~')[0]!;

  assert.equal(encodeSegment(company('é'.repeat(33) + 'aa')).length, 200);
  assert.equal(company('é'.repeat(33) + 'aa'), 'é'.repeat(33) + 'aa');
  assert.equal(company('é'.repeat(33) + 'aaa'), 'é'.repeat(33) + 'aa');
});

test('a cut never leaves a separator at the end of a part', () => {
  const named = {
    ...document,
    experience: [{ ...document.experience[0]!, company: `${'a'.repeat(99)} ${'b'.repeat(10)}`, title: 'c' }]
  };

  // The hundredth letter would have been the dash between the words.
  assert.equal(cvKeys(named).experience[0], `${'a'.repeat(99)}~c`);
});

test('a name is cut at a hundred letters even where the address would allow more', () => {
  const named = {
    ...document,
    experience: [{ ...document.experience[0]!, company: 'a'.repeat(250), title: 'b' }]
  };

  assert.equal(cvKeys(named).experience[0], `${'a'.repeat(100)}~b`);
});

test('the address of a piece is the CV, a section, or an item, and nothing else', () => {
  assert.equal(cvRef(SCOPE), 'cv:ctx-1');
  assert.equal(cvRef(SCOPE, 'overview'), 'cv:ctx-1/overview');
  assert.equal(cvRef(SCOPE, 'experience', 'acme~senior-engineer'), 'cv:ctx-1/experience/acme~senior-engineer');
  // An item with no section has no address: the key goes only where a section came first.
  assert.equal(cvRef(SCOPE, undefined, 'orphan'), 'cv:ctx-1');
});

/* ------------------------------------------------------------ the document */

test('the document is read as the tools read it: normalised, and nothing for a body that is not a CV', () => {
  // The skills strip comes back with its rows, which is what every reader of the CV sees.
  assert.deepEqual(cvOf(body), as);

  assert.equal(cvOf({ version: 2 }), undefined);
  assert.equal(cvOf({ experience: 'not a list' }), undefined);
  assert.equal(cvOf({ experience: [{ title: 'no company' }] }), undefined);

  // An empty body is a CV with nothing in it, and has no items to name.
  const empty = cvOf({});
  assert.ok(empty);
  assert.deepEqual(cvKeys(empty), { experience: [], education: [], certificates: [], languages: [] });
});

test('the whole CV is one piece, digested as the document and not as the body that was stored', () => {
  const entry = cvWholeEntry(SCOPE, REVISION, document, { status: 'read', via: 'port:documents' });

  assert.deepEqual(entry, {
    ref: 'cv:ctx-1',
    version: '7',
    digest: digest(as),
    status: 'read',
    origin: 'server',
    via: 'port:documents'
  });
  // The stored body has no skill rows, and a digest of it would never agree with the one a tool made.
  assert.notEqual(entry.digest, digest(body));
});

test('a read says which revision it was, as the text of a number', () => {
  assert.equal(cvWholeEntry(SCOPE, 0, document, read).version, '0');
  assert.equal(cvWholeEntry(SCOPE, 12, document, read).version, '12');
});

/* ---------------------------------------------------------- read_cv, overview */

test('the overview names the three pieces it hands over, each with the digest of what it is', () => {
  const data = { version: 1, personal: body.personal, role_description: body.role_description, skills: SKILLS };
  const entries = kept(cvReadEntries(SCOPE, REVISION, document, { section: 'overview', offset: 0 }, data, 'tool:read_cv'));

  assert.deepEqual(entries, [
    { ref: 'cv:ctx-1/overview/personal', version: '7', digest: digest(body.personal), status: 'included', origin: 'server', via: 'tool:read_cv' },
    { ref: 'cv:ctx-1/overview/role_description', version: '7', digest: digest(body.role_description), status: 'included', origin: 'server', via: 'tool:read_cv' },
    { ref: 'cv:ctx-1/overview/skills', version: '7', digest: digest(SKILLS), status: 'included', origin: 'server', via: 'tool:read_cv' }
  ]);
});

test('a piece the model got only part of says what part, and is not mistaken for the whole', () => {
  const clipped = 'Backend engineer focused on billing';
  const data = { version: 1, personal: body.personal, role_description: clipped, skills: SKILLS };
  const entries = kept(cvReadEntries(SCOPE, REVISION, document, { section: 'overview', offset: 0 }, data, 'tool:read_cv'));

  const description = entries.find((entry) => entry.ref === 'cv:ctx-1/overview/role_description');
  assert.equal(description?.digest, digest(body.role_description), 'the piece is the whole of it');
  assert.equal(description?.shown, digest(clipped), 'what the model got is what was left');

  // The pieces that came whole say nothing of the sort.
  assert.equal(entries.find((entry) => entry.ref.endsWith('/personal'))?.shown, undefined);
  assert.equal(entries.find((entry) => entry.ref.endsWith('/skills'))?.shown, undefined);
});

test('a piece the budget had no room for was not handed over, and has no entry', () => {
  const data = { version: 1, personal: body.personal };
  const entries = kept(cvReadEntries(SCOPE, REVISION, document, { section: 'overview', offset: 0 }, data, 'tool:read_cv'));

  assert.deepEqual(entries.map((entry) => entry.ref), ['cv:ctx-1/overview/personal']);
});

test('a result that is not an object handed nothing over', () => {
  for (const data of [null, undefined, 'text', 4, []]) {
    assert.deepEqual(cvReadEntries(SCOPE, REVISION, document, { section: 'overview', offset: 0 }, data, 'tool:read_cv'), []);
    assert.deepEqual(cvReadEntries(SCOPE, REVISION, document, { section: 'experience', offset: 0 }, data, 'tool:read_cv'), []);
  }
});

/* ------------------------------------------------------ read_cv, list pages */

test('a page of a list names each item it holds, by the key of the item in the document', () => {
  const data = page('experience', 0, [body.experience[0], body.experience[1]]);
  const entries = kept(cvReadEntries(SCOPE, REVISION, document, { section: 'experience', offset: 0 }, data, 'tool:read_cv'));

  assert.deepEqual(entries, [
    { ref: 'cv:ctx-1/experience/acme~senior-engineer', version: '7', digest: digest(body.experience[0]), status: 'included', origin: 'server', via: 'tool:read_cv' },
    { ref: 'cv:ctx-1/experience/globex~engineer', version: '7', digest: digest(body.experience[1]), status: 'included', origin: 'server', via: 'tool:read_cv' }
  ]);
});

test('an item is named by where it is in the document, and not by where it is in the page', () => {
  // The third item, asked for with an offset: the second page of a list of three.
  const data = page('experience', 2, [body.experience[2]]);
  const entries = kept(cvReadEntries(SCOPE, REVISION, document, { section: 'experience', offset: 2 }, data, 'tool:read_cv'));

  assert.deepEqual(entries.map((entry) => entry.ref), ['cv:ctx-1/experience/acme~senior-engineer-2']);
  assert.equal(entries[0]?.digest, digest(body.experience[2]));
});

test('an item the model got only part of says what part', () => {
  const cut = { ...body.experience[0], highlights: ['Rewrote the billing pipeline.'] };
  const data = page('experience', 0, [cut, body.experience[1]]);
  const entries = kept(cvReadEntries(SCOPE, REVISION, document, { section: 'experience', offset: 0 }, data, 'tool:read_cv'));

  assert.equal(entries[0]?.digest, digest(body.experience[0]), 'the item, whole');
  assert.equal(entries[0]?.shown, digest(cut), 'the item as it was cut');
  assert.equal(entries[1]?.shown, undefined, 'the other came whole');
});

test('items the page had no room for are not recorded', () => {
  // Three in the document, and the budget kept one.
  const data = page('experience', 0, [body.experience[0]]);
  const entries = kept(cvReadEntries(SCOPE, REVISION, document, { section: 'experience', offset: 0 }, data, 'tool:read_cv'));

  assert.deepEqual(entries.map((entry) => entry.ref), ['cv:ctx-1/experience/acme~senior-engineer']);
});

test('nothing is recorded for an item the document does not have', () => {
  // A page past the end of the list is empty, and a page claiming more than the list holds is not believed.
  assert.deepEqual(
    cvReadEntries(SCOPE, REVISION, document, { section: 'experience', offset: 3 }, page('experience', 3, []), 'tool:read_cv'),
    []
  );
  assert.deepEqual(
    cvReadEntries(SCOPE, REVISION, document, { section: 'experience', offset: 2 }, page('experience', 2, [body.experience[2], { company: 'Ghost', title: 'Imagined' }]), 'tool:read_cv')
      .map((entry) => entry.ref),
    ['cv:ctx-1/experience/acme~senior-engineer-2']
  );
  assert.deepEqual(cvReadEntries(SCOPE, REVISION, document, { section: 'experience', offset: 0 }, { offset: 0 }, 'tool:read_cv'), []);
});

test('every list section is a section of the well, with the keys of its own items', () => {
  const sections = [
    ['education', body.education, ['cv:ctx-1/education/mit~bsc-computer-science']],
    ['certificates', body.certificates, ['cv:ctx-1/certificates/aws-solutions-architect']],
    ['languages', body.languages, ['cv:ctx-1/languages/polish', 'cv:ctx-1/languages/english']]
  ] as const;

  for (const [section, items, refs] of sections) {
    const entries = kept(cvReadEntries(SCOPE, REVISION, document, { section, offset: 0 }, page(section, 0, items), 'tool:read_cv'));
    assert.deepEqual(entries.map((entry) => entry.ref), refs, section);
    assert.deepEqual(entries.map((entry) => entry.digest), items.map((item) => digest(item)), section);
  }
});

test('a section the CV does not have is a mistake of the tool, and is said so', () => {
  assert.throws(
    () => cvReadEntries(SCOPE, REVISION, document, { section: 'photo', offset: 0 }, page('photo', 0, []), 'tool:read_cv'),
    (error: unknown) => error instanceof OperationError && error.code === 'invalid_entry' && /photo/.test(error.message)
  );
});

test('what a read is called is what the caller said it was', () => {
  const entries = cvReadEntries(SCOPE, REVISION, document, { section: 'languages', offset: 0 }, page('languages', 0, body.languages), 'tool:somebody_else');
  assert.deepEqual(entries.map((entry) => entry.via), ['tool:somebody_else', 'tool:somebody_else']);
});

/* ----------------------------------------------------- retrieved passages */

const passage = (text: string, meta: Record<string, unknown>): CvHit => ({ kind: 'highlight', text, meta });
const inEntry = (entry: number, company: string, title: string) => ({ section: 'experience', entry, company, title });

test('a passage is placed in the item it was cut from, and says what part of it the model got', () => {
  const hit = passage('Rewrote the billing pipeline.', inEntry(0, 'Acme', 'Senior Engineer'));
  const entries = kept(cvHitEntries(SCOPE, REVISION, document, [hit], { status: 'included', via: 'tool:search_profile', passage: true }));

  assert.deepEqual(entries, [
    {
      ref: 'cv:ctx-1/experience/acme~senior-engineer',
      version: '7',
      digest: digest(body.experience[0]),
      shown: digest('Rewrote the billing pipeline.'),
      status: 'included',
      origin: 'server',
      via: 'tool:search_profile'
    }
  ]);
});

test('a passage read and not shown says nothing of what part', () => {
  const hit = passage('Rewrote the billing pipeline.', inEntry(0, 'Acme', 'Senior Engineer'));
  const [entry] = cvHitEntries(SCOPE, REVISION, document, [hit], { status: 'read', via: 'port:retrieval', passage: false });

  assert.equal(entry?.status, 'read');
  assert.equal(entry?.via, 'port:retrieval');
  assert.equal('shown' in (entry ?? {}), false);
});

test('a passage from a repeated employer is placed by what the entry says as well as where it is', () => {
  const hit = passage('An earlier stint.', inEntry(2, 'Acme', 'Senior Engineer'));
  const [entry] = cvHitEntries(SCOPE, REVISION, document, [hit], { status: 'included', via: 'x', passage: true });

  assert.equal(entry?.ref, 'cv:ctx-1/experience/acme~senior-engineer-2');
  assert.equal(entry?.digest, digest(body.experience[2]));
});

test('a passage whose item has since changed is recorded as the whole CV, which is less and never wrong', () => {
  const whole = { ref: 'cv:ctx-1', digest: digest(as) };
  const misplaced: CvHit[] = [
    // The index says Globex is at 1, and now it is Acme there.
    passage('x', inEntry(1, 'Acme', 'Senior Engineer')),
    // Another title in the same company.
    passage('x', inEntry(0, 'Acme', 'Staff Engineer')),
    // The same title at another company.
    passage('x', inEntry(1, 'Initech', 'Engineer')),
    // A position that no longer exists.
    passage('x', inEntry(9, 'Acme', 'Senior Engineer')),
    // A position that is not one.
    passage('x', { section: 'experience', entry: '0', company: 'Acme', title: 'Senior Engineer' }),
    passage('x', { section: 'experience', company: 'Acme', title: 'Senior Engineer' }),
    passage('x', { section: 'experience', entry: -1, company: 'Acme', title: 'Senior Engineer' })
  ];

  for (const hit of misplaced) {
    const [entry] = cvHitEntries(SCOPE, REVISION, document, [hit], { status: 'included', via: 'x', passage: true });
    assert.equal(entry?.ref, whole.ref, JSON.stringify(hit.meta));
    assert.equal(entry?.digest, whole.digest, JSON.stringify(hit.meta));
    assert.equal(entry?.shown, digest('x'));
  }
});

test('a passage of the role description is placed in it, unless there is none to place it in', () => {
  const hit = passage('Backend engineer focused on billing systems.', { section: 'role_description' });

  const [placed] = cvHitEntries(SCOPE, REVISION, document, [hit], { status: 'included', via: 'x', passage: true });
  assert.equal(placed?.ref, 'cv:ctx-1/overview/role_description');
  assert.equal(placed?.digest, digest(body.role_description));

  const bare = { ...document, role_description: '  ' };
  const [whole] = cvHitEntries(SCOPE, REVISION, bare, [hit], { status: 'included', via: 'x', passage: true });
  assert.equal(whole?.ref, 'cv:ctx-1');
});

test('a passage of anything else is recorded as the whole CV', () => {
  for (const meta of [{ section: 'education' }, { section: 'skills' }, {}, { section: 7 }]) {
    const [entry] = cvHitEntries(SCOPE, REVISION, document, [passage('x', meta)], { status: 'included', via: 'x', passage: true });
    assert.equal(entry?.ref, 'cv:ctx-1', JSON.stringify(meta));
  }
});

test('each passage has an entry, in the order they came, and one piece found twice is one entry in the record', () => {
  const hits = [
    passage('Rewrote the billing pipeline.', inEntry(0, 'Acme', 'Senior Engineer')),
    passage('Built the design system.', inEntry(1, 'Globex', 'Engineer')),
    passage('Halved p99 latency.', inEntry(0, 'Acme', 'Senior Engineer'))
  ];

  const raw = cvHitEntries(SCOPE, REVISION, document, hits, { status: 'read', via: 'port:retrieval', passage: false });
  assert.deepEqual(raw.map((entry) => entry.ref), [
    'cv:ctx-1/experience/acme~senior-engineer',
    'cv:ctx-1/experience/globex~engineer',
    'cv:ctx-1/experience/acme~senior-engineer'
  ]);

  // With nothing to tell the two Acme passages apart, the record holds the piece once.
  assert.equal(kept(raw).length, 2);
});

test('with a passage shown, two passages of one item are two entries, because they are two things the model got', () => {
  const hits = [
    passage('Rewrote the billing pipeline.', inEntry(0, 'Acme', 'Senior Engineer')),
    passage('Halved p99 latency.', inEntry(0, 'Acme', 'Senior Engineer'))
  ];

  const entries = kept(cvHitEntries(SCOPE, REVISION, document, hits, { status: 'included', via: 'tool:search_profile', passage: true }));
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.shown), [digest(hits[0]!.text), digest(hits[1]!.text)]);
});

/* ------------------------------------------------------------------ offers */

test('the posting of an offer is addressed by the offer, and any id reads back', () => {
  assert.equal(OFFERS_WELL, 'offers');
  assert.equal(postingRef('offer-1'), 'offers:offer-1/posting');

  const odd = 'a b/c#d~é';
  assert.deepEqual(parseRef(postingRef(odd)), { well: 'offers', scope: odd, path: ['posting'] });
});

/* ------------------------------------------------------------------- wells */

test('the wells a runtime starts with are the four the plan names, and nothing else is known', () => {
  const wells = defaultWells();

  for (const id of ['cv', 'offers', 'preferences', 'conversation']) assert.equal(wells.has(id), true, id);
  assert.equal(wells.has('tickets'), false);
  assert.equal(wells.ids().length, 4);
});
