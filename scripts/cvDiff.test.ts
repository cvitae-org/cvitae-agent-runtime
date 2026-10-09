/**
 * What changed between two CVs, and applying it (`src/capabilities/cv/diff.ts`).
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 59 were applied. The number is how many
 * tests failed.
 *
 * same:
 *   equal values are not equal                                 28
 *   two lists of different length are the same                 8
 *   two objects with different keys are the same               5
 *   a key the other lacks is not looked for                    0 (equivalent: what the other lacks reads as undefined, which no JSON value equals)
 *   an object is the same as a list                            4
 *   a list is the same as something that is not one            1
 *
 * aligning two lists:
 *   two lists are aligned up to one more comparison than the limit 1
 *   two lists as long as the limit are not aligned             1
 *   the head stops at the end of the first list only           0 (equivalent: past the end of the other list an entry is undefined, which no entry equals)
 *   the head stops at the end of the second list only          0 (equivalent: past the end of the other list an entry is undefined, which no entry equals)
 *   the tail may take what the head took                       2
 *   the tail may take what the head took of the second list    2
 *   a middle with nothing on one side is looked into           0 (equivalent: aligning against nothing finds nothing, and what is left is added or removed all the same)
 *   a tie in the table takes the other way                     2
 *   the table keeps the shorter run                            2
 *   the table does not count a match                           3
 *
 * the difference of two lists:
 *   a gap is walked as far as the longer side                  16
 *   every entry of what went is removed                        11
 *   a removal is at the index it began at                      4
 *   an insertion is at the index after those paired            6
 *   the next gap starts after what the last one held of the first list 9
 *   a shared entry does not move the next gap on               16
 *   the next gap starts at the shared entry of the first list  18
 *   the next gap starts at the shared entry of the second list 17
 *   what comes after the last shared entry is looked at        0 (equivalent: the end of both lists is the last pair, and nothing is read after it)
 *
 * the difference of two documents:
 *   a key that went is not removed                             4
 *   a key that came is not added                               5
 *   two equal values are replaced                              13
 *   a list that changed is replaced whole                      15
 *   an object that changed is replaced whole                   5
 *   a change says what was in the input and not a copy         3
 *   a difference between things that are not documents is none 1
 *
 * applying:
 *   a path is as long as a person likes                        1
 *   a path may name nothing                                    1
 *   a path goes through the end of a list                      0 (equivalent: the entry past the end is undefined, and the next step refuses in the same words)
 *   an entry is added two places after the end of a list       1
 *   an entry may not be added at the end of a list             9
 *   an entry past the end is looked for                        1
 *   an entry of a list is changed whatever it was              1
 *   an entry of a list is not removed                          8
 *   a key may be added twice                                   1
 *   a key is changed whatever it was                           2
 *   a key is not removed                                       4
 *   a key that is added is assigned                            3
 *   a value that is added is the one in the change             1
 *   a document that is applied to is the one that was given    6
 *   a copy is made by assigning keys                           3
 *   a copy keeps what is undefined, as null                    1
 *   a key is set by assigning it                               3
 *   a change does not say where it was                         5
 *
 * scope, shapes:
 *   the changes outside a key are those inside it              1
 *   a key that is touched twice is said twice                  2
 *   a list of changes may be 2,001 long                        1
 *   a path may be 13 places long                               1
 *   a path of no places is a change                            1
 *   a path has no depth to keep to in a stored change          1
 *   a replace may carry more than it says                      1
 *   an add may carry more than it says                         1
 *   a remove may carry more than it says                       1
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChangesDoNotApply,
  PATH_DEPTH,
  applyCv,
  applyJson,
  cvChangeSchema,
  cvChangesSchema,
  diffCv,
  diffJson,
  outside,
  same,
  touched
} from '../src/capabilities/cv/diff.js';
import type { CvChange, Json } from '../src/capabilities/cv/diff.js';
import { cvOf } from '../src/capabilities/cv/well.js';
import type { CvDocument } from '../src/capabilities/cv/document.js';

/* ---------------------------------------------------------------- fixtures */

/** Said by no change and no message: a CV is personal, and an error is logged. */
const CANARY = 'ZEBRA-DIFF-6120';

const job = (company: string, title: string, highlights: string[] = []) => ({
  company,
  title,
  started: '2020',
  finished: null,
  highlights,
  skills: []
});

const CV = cvOf({
  version: 1,
  personal: { name: 'Ada Example', email: 'ada@example.com', phone: '', location: 'Krakow', links: {} },
  role_description: 'Backend engineer.',
  skills: {
    role: 'Engineer',
    groups: [{ label: 'Languages', items: ['TypeScript', 'Go'] }],
    programming_languages: ['TypeScript', 'Go'],
    frameworks: [],
    libraries_and_tools: []
  },
  experience: [job('Acme', 'Senior Engineer', ['Rewrote billing.', 'Led a team.']), job('Globex', 'Engineer', ['Built a design system.'])],
  education: [{ university: 'MIT', degree: 'BSc', started: '2012', finished: '2016', thesis: '', mark: '' }],
  certificates: [],
  languages: [
    { name: 'Polish', level: 'native' },
    { name: 'English', level: 'C1' }
  ],
  sources: []
}) as CvDocument;

/** A deep copy that no test of this file can reach back into the fixture through. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const frozen = <T>(value: T): T => {
  const freeze = (inner: unknown): void => {
    if (typeof inner === 'object' && inner !== null) {
      Object.freeze(inner);
      Object.values(inner).forEach(freeze);
    }
  };
  freeze(value);
  return value;
};

const changed = (mutate: (draft: CvDocument) => void): CvDocument => {
  const draft = copy(CV);
  mutate(draft);
  return draft;
};

/** Applying a list that cannot be applied says which change it was, and not what the document held. */
const refuses = (document: unknown, changes: CvChange[], at: number, pattern?: RegExp): void => {
  assert.throws(
    () => applyJson(document, changes),
    (error: unknown) => {
      assert.ok(error instanceof ChangesDoNotApply, String(error));
      assert.equal(error.at, at, error.message);
      assert.equal(error.message.startsWith(`Change ${at + 1} does not apply: `), true, error.message);
      assert.equal(error.message.endsWith('.'), true, error.message);
      if (pattern !== undefined) assert.match(error.message, pattern);
      assert.ok(!error.message.includes(CANARY), 'an error names a place, not what was there');
      return true;
    },
    JSON.stringify(changes)
  );
};

/** Both ways round: what a diff says, applied, is the other document, and the document it was made from is as it was. */
const roundTrip = (from: unknown, to: unknown): CvChange[] => {
  const before = JSON.stringify(from);
  const after = JSON.stringify(to);
  const changes = diffJson(from, to);

  assert.equal(JSON.stringify(from), before, 'a diff does not touch what it reads');
  assert.equal(JSON.stringify(to), after, 'a diff does not touch what it reads');
  assert.ok(same(applyJson(from, changes), to as Json), `applying the diff does not give the other document: ${JSON.stringify(changes)}`);
  assert.equal(cvChangesSchema.safeParse(changes).success, true, 'what a diff says is what a store accepts');
  return changes;
};

/* ------------------------------------------------------------------- same */

test('two values are the same when they hold the same, whatever order an object keeps its keys in', () => {
  assert.equal(same({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 }), true);
  assert.equal(same([], []), true);
  assert.equal(same({}, {}), true);
  assert.equal(same('a', 'a'), true);
  assert.equal(same(null, null), true);
  assert.equal(same(0, 0), true);

  // The order of a list is part of what it says.
  assert.equal(same([1, 2], [2, 1]), false);
  // A list is not an object that has the same entries, and an object is not a list.
  assert.equal(same([], {}), false);
  assert.equal(same({}, []), false);
  assert.equal(same({ 0: 'a' }, ['a']), false);
  assert.equal(same(['a'], { 0: 'a' }), false);
  assert.equal(same(null, {}), false);
  assert.equal(same({}, null), false);
  assert.equal(same(null, 0), false);
  assert.equal(same('1', 1), false);
  assert.equal(same(false, 0), false);
  assert.equal(same(false, null), false);
  // A length, a key, a value.
  assert.equal(same([1], [1, 2]), false);
  assert.equal(same([1, 2], [1]), false);
  assert.equal(same({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(same({ a: 1, b: 2 }, { a: 1 }), false);
  assert.equal(same({ a: 1 }, { b: 1 }), false);
  assert.equal(same({ a: { b: 1 } }, { a: { b: 2 } }), false);
  assert.equal(same([[1]], [[2]]), false);
});

test('a key the other object does not have is not the same as a key that holds null', () => {
  assert.equal(same({ a: null, b: 1 }, { b: 1, c: null }), false);
  assert.equal(same({ a: null }, { b: null }), false);
});

test('an object that has an own key of Object.prototype is told apart from one that inherits it', () => {
  const inherited = Object.create({ toString: 'x' }) as Record<string, Json>;
  assert.equal(same({ toString: 'x' }, inherited), false);
  assert.equal(same(inherited, { toString: 'x' }), false);
});

/* ------------------------------------------------------------------ diffing */

test('two documents that are the same have nothing between them', () => {
  assert.deepEqual(diffCv(CV, copy(CV)), []);
  assert.deepEqual(diffJson({}, {}), []);
  // Key order is not a difference, and a key that holds nothing at all is not a key.
  assert.deepEqual(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 }), []);
  assert.deepEqual(diffJson({ a: 1, b: undefined }, { a: 1 }), []);
  assert.deepEqual(diffJson({ a: 1 }, { a: 1, b: undefined }), []);
});

test('a difference is made between two documents, and a document is an object', () => {
  for (const [a, b] of [
    [[], []],
    ['a', 'b'],
    [null, {}],
    [{}, null],
    [{}, []],
    [[], {}],
    [1, 1]
  ] as const) {
    assert.throws(() => diffJson(a, b), TypeError, JSON.stringify([a, b]));
  }
});

test('a changed value is a replace that says what it was and what it became', () => {
  const changes = diffCv(CV, changed((draft) => (draft.role_description = 'Staff engineer.')));
  assert.deepEqual(changes, [{ op: 'replace', path: ['role_description'], before: 'Backend engineer.', after: 'Staff engineer.' }]);
});

test('a change is found as deep as it is, and says the way there', () => {
  const changes = diffCv(CV, changed((draft) => ((draft.experience[1] as { highlights: string[] }).highlights[0] = 'Built two.')));
  assert.deepEqual(changes, [
    { op: 'replace', path: ['experience', 1, 'highlights', 0], before: 'Built a design system.', after: 'Built two.' }
  ]);
});

test('a value that changes kind is replaced whole, and one that is a list in both is not', () => {
  assert.deepEqual(diffJson({ a: 'x' }, { a: ['x'] }), [{ op: 'replace', path: ['a'], before: 'x', after: ['x'] }]);
  assert.deepEqual(diffJson({ a: ['x'] }, { a: { 0: 'x' } }), [{ op: 'replace', path: ['a'], before: ['x'], after: { 0: 'x' } }]);
  assert.deepEqual(diffJson({ a: { 0: 'x' } }, { a: ['x'] }), [{ op: 'replace', path: ['a'], before: { 0: 'x' }, after: ['x'] }]);
  assert.deepEqual(diffJson({ a: null }, { a: {} }), [{ op: 'replace', path: ['a'], before: null, after: {} }]);
  assert.deepEqual(diffJson({ a: {} }, { a: null }), [{ op: 'replace', path: ['a'], before: {}, after: null }]);
  assert.deepEqual(diffJson({ a: 1 }, { a: '1' }), [{ op: 'replace', path: ['a'], before: 1, after: '1' }]);
});

test('a key that is new is an add, and one that is gone is a remove that says what it held', () => {
  assert.deepEqual(diffJson({ a: 1 }, { a: 1, b: { c: 2 } }), [{ op: 'add', path: ['b'], after: { c: 2 } }]);
  assert.deepEqual(diffJson({ a: 1, b: { c: 2 } }, { a: 1 }), [{ op: 'remove', path: ['b'], before: { c: 2 } }]);
  // Both at once: what is gone is said before what is new, each in the order it was in.
  assert.deepEqual(diffJson({ a: 1, b: 2, c: 3 }, { x: 1, c: 3, y: 2 }), [
    { op: 'remove', path: ['a'], before: 1 },
    { op: 'remove', path: ['b'], before: 2 },
    { op: 'add', path: ['x'], after: 1 },
    { op: 'add', path: ['y'], after: 2 }
  ]);
  // A key that is in both and changed is placed where the key is, among the removals that came before it.
  assert.deepEqual(diffJson({ a: 1, b: 2 }, { b: 3, c: 4 }), [
    { op: 'remove', path: ['a'], before: 1 },
    { op: 'replace', path: ['b'], before: 2, after: 3 },
    { op: 'add', path: ['c'], after: 4 }
  ]);
});

test('a bullet added to a job is one add, and not an edit of everything after it', () => {
  const changes = diffCv(CV, changed((draft) => (draft.experience[0] as { highlights: string[] }).highlights.splice(1, 0, 'Hired two.')));
  assert.deepEqual(changes, [{ op: 'add', path: ['experience', 0, 'highlights', 1], after: 'Hired two.' }]);
});

test('an entry added at the end, the start, and the middle of a list is one add at that index', () => {
  const entry = job('Initech', 'Lead');
  assert.deepEqual(diffCv(CV, changed((draft) => draft.experience.push(entry as never))), [
    { op: 'add', path: ['experience', 2], after: entry }
  ]);
  assert.deepEqual(diffCv(CV, changed((draft) => draft.experience.unshift(entry as never))), [
    { op: 'add', path: ['experience', 0], after: entry }
  ]);
  assert.deepEqual(diffCv(CV, changed((draft) => draft.experience.splice(1, 0, entry as never))), [
    { op: 'add', path: ['experience', 1], after: entry }
  ]);
});

test('an entry taken out of a list is one remove at its index, and says what it held', () => {
  for (const index of [0, 1]) {
    assert.deepEqual(diffCv(CV, changed((draft) => draft.experience.splice(index, 1))), [
      { op: 'remove', path: ['experience', index], before: CV.experience[index] }
    ]);
  }
  assert.deepEqual(diffCv(CV, changed((draft) => draft.languages.splice(0, 2))), [
    { op: 'remove', path: ['languages', 0], before: CV.languages[0] },
    { op: 'remove', path: ['languages', 0], before: CV.languages[1] }
  ]);
});

test('an entry that was edited is edited where it is, and the entries around it stay put', () => {
  const changes = diffCv(CV, changed((draft) => (draft.experience[0] as { title: string }).title = 'Staff Engineer'));
  assert.deepEqual(changes, [{ op: 'replace', path: ['experience', 0, 'title'], before: 'Senior Engineer', after: 'Staff Engineer' }]);
});

test('the first of what went is edited into the first of what came, and the rest are taken out or put in', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'];
  // Between two entries both lists have: two went, one came.
  assert.deepEqual(diffJson({ l: [a, b, c, d] }, { l: [a, 'X', d] }), [
    { op: 'replace', path: ['l', 1], before: b, after: 'X' },
    { op: 'remove', path: ['l', 2], before: c }
  ]);
  // One went, two came.
  assert.deepEqual(diffJson({ l: [a, b, d] }, { l: [a, 'X', 'Y', d] }), [
    { op: 'replace', path: ['l', 1], before: b, after: 'X' },
    { op: 'add', path: ['l', 2], after: 'Y' }
  ]);
  // Two gaps, and the second one is placed by what the first left.
  assert.deepEqual(diffJson({ l: [a, b, c, d, e] }, { l: [a, 'X', 'Y', c, 'Z', e] }), [
    { op: 'replace', path: ['l', 1], before: b, after: 'X' },
    { op: 'add', path: ['l', 2], after: 'Y' },
    { op: 'replace', path: ['l', 4], before: d, after: 'Z' }
  ]);
  // Three went and nothing came, between two that stayed: every removal is at the same index.
  assert.deepEqual(diffJson({ l: [a, b, c, d, e] }, { l: [a, e] }), [
    { op: 'remove', path: ['l', 1], before: b },
    { op: 'remove', path: ['l', 1], before: c },
    { op: 'remove', path: ['l', 1], before: d }
  ]);
  // Nothing went and three came.
  assert.deepEqual(diffJson({ l: [a, e] }, { l: [a, b, c, d, e] }), [
    { op: 'add', path: ['l', 1], after: b },
    { op: 'add', path: ['l', 2], after: c },
    { op: 'add', path: ['l', 3], after: d }
  ]);
  // Entries are edited into each other when they are lists and records, and found deeper.
  assert.deepEqual(diffJson({ l: [{ n: 1, m: 1 }, a] }, { l: [{ n: 1, m: 2 }, a] }), [
    { op: 'replace', path: ['l', 0, 'm'], before: 1, after: 2 }
  ]);
});

test('what a gap holds is compared after the entries that stay, in the list as it has become', () => {
  // The first gap adds one entry, so the second gap is at an index one larger than in either list.
  assert.deepEqual(diffJson({ l: ['a', 'b', 'c', 'd'] }, { l: ['a', 'X', 'Y', 'b', 'Z', 'd'] }), [
    { op: 'add', path: ['l', 1], after: 'X' },
    { op: 'add', path: ['l', 2], after: 'Y' },
    { op: 'replace', path: ['l', 4], before: 'c', after: 'Z' }
  ]);
});

test('an entry moved is taken out and put in, which is what moved it', () => {
  const moved = changed((draft) => {
    const [first] = draft.experience.splice(0, 1);
    draft.experience.push(first as never);
  });
  assert.deepEqual(diffCv(CV, moved), [
    { op: 'remove', path: ['experience', 0], before: CV.experience[0] },
    { op: 'add', path: ['experience', 1], after: CV.experience[0] }
  ]);
  assert.deepEqual(applyCv(CV, diffCv(CV, moved)), moved);

  // The other direction: the last entry to the front.
  const back = changed((draft) => draft.languages.reverse());
  const said = diffCv(CV, back);
  assert.equal(said.length, 2);
  assert.deepEqual(applyCv(CV, said), back);
});

test('what is the same in both lists at either end stays where it is, even when it repeats', () => {
  // Without the bound that stops the tail at the head, the last `x` would be paired twice.
  assert.deepEqual(diffJson({ l: ['x', 'x', 'x'] }, { l: ['x', 'x'] }), [{ op: 'remove', path: ['l', 2], before: 'x' }]);
  assert.deepEqual(diffJson({ l: ['x', 'x'] }, { l: ['x', 'x', 'x'] }), [{ op: 'add', path: ['l', 2], after: 'x' }]);
  assert.deepEqual(diffJson({ l: ['x'] }, { l: ['x', 'x', 'x'] }), [
    { op: 'add', path: ['l', 1], after: 'x' },
    { op: 'add', path: ['l', 2], after: 'x' }
  ]);
  assert.deepEqual(diffJson({ l: ['x', 'y', 'x'] }, { l: ['x', 'x'] }), [{ op: 'remove', path: ['l', 1], before: 'y' }]);
  assert.deepEqual(diffJson({ l: ['a', 'x', 'x'] }, { l: ['b', 'x', 'x'] }), [{ op: 'replace', path: ['l', 0], before: 'a', after: 'b' }]);
  assert.deepEqual(diffJson({ l: ['x', 'x', 'a'] }, { l: ['x', 'x', 'b'] }), [{ op: 'replace', path: ['l', 2], before: 'a', after: 'b' }]);
});

test('a list that is emptied is removed from entry by entry, and one that is filled is added to', () => {
  assert.deepEqual(diffJson({ l: ['a', 'b'] }, { l: [] }), [
    { op: 'remove', path: ['l', 0], before: 'a' },
    { op: 'remove', path: ['l', 0], before: 'b' }
  ]);
  assert.deepEqual(diffJson({ l: [] }, { l: ['a', 'b'] }), [
    { op: 'add', path: ['l', 0], after: 'a' },
    { op: 'add', path: ['l', 1], after: 'b' }
  ]);
});

test('adding a language is one add, and what it says is a language and not a document', () => {
  const changes = diffCv(CV, changed((draft) => draft.languages.push({ name: 'German', level: 'B2' })));
  assert.deepEqual(changes, [{ op: 'add', path: ['languages', 2], after: { name: 'German', level: 'B2' } }]);
});

test('the common entries are found in the middle, however the ends differ', () => {
  // `b` and `c` are in both, and the ends differ: they are kept and the ends are edited.
  const changes = diffJson({ l: ['p', 'b', 'c', 'q'] }, { l: ['r', 'b', 'c', 's'] });
  assert.deepEqual(changes, [
    { op: 'replace', path: ['l', 0], before: 'p', after: 'r' },
    { op: 'replace', path: ['l', 3], before: 'q', after: 's' }
  ]);
  // A common entry in the middle that is not the longest run, and the table that finds them.
  assert.deepEqual(diffJson({ l: ['a', 'x', 'b', 'y', 'c'] }, { l: ['z', 'a', 'b', 'c', 'w'] }), [
    { op: 'add', path: ['l', 0], after: 'z' },
    { op: 'remove', path: ['l', 2], before: 'x' },
    { op: 'remove', path: ['l', 3], before: 'y' },
    { op: 'add', path: ['l', 4], after: 'w' }
  ]);
});

test('between two ties the alignment takes the same one every time', () => {
  // Two ways to keep one of them: the first stays.
  assert.deepEqual(diffJson({ l: ['a', 'b'] }, { l: ['b', 'a'] }), [
    { op: 'remove', path: ['l', 0], before: 'a' },
    { op: 'add', path: ['l', 1], after: 'a' }
  ]);
  assert.deepEqual(diffJson({ l: ['b', 'a'] }, { l: ['a', 'b'] }), [
    { op: 'remove', path: ['l', 0], before: 'b' },
    { op: 'add', path: ['l', 1], after: 'b' }
  ]);
});

test('two lists too long to align are compared in order, and the same limit holds either side of it', () => {
  const run = (n: number) => {
    const a = Array.from({ length: n }, (_, k) => `x${k}`);
    const b = [...a.slice(1), 'y'];
    return { a, b, changes: roundTrip({ l: a }, { l: b }) };
  };

  // 500 x 500 is the most that is aligned, and the one entry that went and the one that came are all it says.
  assert.equal(run(500).changes.length, 2);
  // One entry more on one side, and every entry is edited into the next.
  const long = run(501);
  assert.equal(long.changes.length, 501);
  assert.ok(long.changes.every((change) => change.op === 'replace'));

  // The limit is on a product and not on a length: 500 by 499 is aligned, and 501 by 500 is not.
  const a = Array.from({ length: 500 }, (_, k) => `x${k}`);
  assert.equal(roundTrip({ l: a }, { l: [...a.slice(1, 499), 'y'] }).length, 2);
  const more = [...a, 'x500'];
  assert.equal(roundTrip({ l: more }, { l: [...more.slice(1, 500), 'y'] }).length, 501);
});

test('what a diff says does not point into what it was made from, and an apply does not point into what it was given', () => {
  const from = { a: { n: 1 }, l: [{ k: 'old' }] };
  const to = { a: { n: 1 }, l: [{ k: 'old' }, { k: 'new', deep: { x: [1] } }], b: { m: [2] } };
  const changes = diffJson(from, to);

  const added = changes.find((change) => change.op === 'add' && change.path[0] === 'b') as unknown as { after: { m: number[] } };
  added.after.m.push(3);
  const inserted = changes.find((change) => change.op === 'add' && change.path[0] === 'l') as unknown as { after: { deep: { x: number[] } } };
  inserted.after.deep.x.push(9);
  assert.deepEqual(to.b, { m: [2] });
  assert.deepEqual(to.l[1], { k: 'new', deep: { x: [1] } });

  const clean = diffJson(from, to);
  const result = applyJson(from, clean) as { b: { m: number[] }; l: { deep?: { x: number[] } }[] };
  result.b.m.push(7);
  (result.l[1]?.deep as { x: number[] }).x.push(8);
  const [add1, add2] = clean.filter((change) => change.op === 'add') as { after: unknown }[];
  assert.deepEqual([add1?.after, add2?.after].map((each) => JSON.stringify(each)).sort(), ['{"k":"new","deep":{"x":[1]}}', '{"m":[2]}']);
  assert.deepEqual(from, { a: { n: 1 }, l: [{ k: 'old' }] });
});

test('a replace says a copy of what was there', () => {
  const from = { a: { n: [1] } };
  const [change] = diffJson(from, { a: 'x' }) as unknown as [{ before: { n: number[] } }];
  change.before.n.push(2);
  assert.deepEqual(from, { a: { n: [1] } });
});

test('a key called __proto__ is a key, in a diff and in an apply, and changes nothing it should not', () => {
  const links = JSON.parse('{"__proto__": "https://example.com"}') as Record<string, string>;
  assert.equal(Object.keys(links).includes('__proto__'), true);

  const changes = diffJson({ personal: { links: {} } }, { personal: { links } });
  assert.deepEqual(changes, [{ op: 'add', path: ['personal', 'links', '__proto__'], after: 'https://example.com' }]);

  const result = applyJson({ personal: { links: {} } }, changes) as { personal: { links: Record<string, string> } };
  assert.equal(Object.prototype.hasOwnProperty.call(result.personal.links, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(result.personal.links), Object.prototype, 'the prototype of the object was not set');
  assert.equal(({} as Record<string, unknown>)['https://example.com'], undefined);
  assert.equal((({}) as { polluted?: unknown }).polluted, undefined);
  assert.equal(same(result as unknown as Json, { personal: { links } } as unknown as Json), true);

  // And the way back: a key called __proto__ is removed and replaced, and told apart from the prototype.
  assert.deepEqual(diffJson({ personal: { links } }, { personal: { links: {} } }), [
    { op: 'remove', path: ['personal', 'links', '__proto__'], before: 'https://example.com' }
  ]);
  const edited = JSON.parse('{"__proto__": "https://other.example"}') as Record<string, string>;
  const replaced = diffJson({ links }, { links: edited });
  assert.deepEqual(replaced, [{ op: 'replace', path: ['links', '__proto__'], before: 'https://example.com', after: 'https://other.example' }]);
  const back = applyJson({ links }, replaced) as { links: Record<string, string> };
  assert.equal(Object.getPrototypeOf(back.links), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(back.links, '__proto__')?.value, 'https://other.example');
  // A key __proto__ inside what is copied is a key there too.
  const nested = applyJson({}, [{ op: 'add', path: ['a'], after: { x: links } }]) as { a: { x: Record<string, string> } };
  assert.equal(Object.getPrototypeOf(nested.a.x), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(nested.a.x, '__proto__')?.value, 'https://example.com');
});

/* ----------------------------------------------------------------- applying */

test('the changes are applied in order, each to what the one before left', () => {
  const result = applyJson({ l: ['a', 'b', 'c'] }, [
    { op: 'remove', path: ['l', 0], before: 'a' },
    { op: 'add', path: ['l', 2], after: 'd' },
    { op: 'replace', path: ['l', 0], before: 'b', after: 'B' },
    { op: 'add', path: ['l', 0], after: 'z' }
  ]);
  assert.deepEqual(result, { l: ['z', 'B', 'c', 'd'] });
});

test('an apply makes a copy, and the document it was given is as it was', () => {
  const document = frozen(copy(CV));
  const changes = diffCv(CV, changed((draft) => ((draft.experience[0] as { title: string }).title = 'Staff')));
  const result = applyCv(document, changes);

  assert.equal((result.experience[0] as { title: string }).title, 'Staff');
  assert.equal(document.experience[0]?.title, 'Senior Engineer');
  assert.notEqual(result, document);
  assert.notEqual(result.education, document.education, 'what was not changed is a copy too');
  assert.deepEqual(applyJson(document, []), document);
  assert.notEqual(applyJson(document, []), document);
});

test('every kind of change applies, in a list and in an object', () => {
  assert.deepEqual(applyJson({ a: 1 }, [{ op: 'add', path: ['b'], after: 2 }]), { a: 1, b: 2 });
  assert.deepEqual(applyJson({ a: 1, b: 2 }, [{ op: 'remove', path: ['b'], before: 2 }]), { a: 1 });
  assert.deepEqual(applyJson({ a: 1 }, [{ op: 'replace', path: ['a'], before: 1, after: 2 }]), { a: 2 });
  assert.deepEqual(applyJson({ l: [1, 2] }, [{ op: 'add', path: ['l', 1], after: 9 }]), { l: [1, 9, 2] });
  assert.deepEqual(applyJson({ l: [1, 2] }, [{ op: 'add', path: ['l', 2], after: 9 }]), { l: [1, 2, 9] });
  assert.deepEqual(applyJson({ l: [1, 2] }, [{ op: 'remove', path: ['l', 0], before: 1 }]), { l: [2] });
  assert.deepEqual(applyJson({ l: [1, 2] }, [{ op: 'replace', path: ['l', 1], before: 2, after: 9 }]), { l: [1, 9] });
  // A value that is null, false, zero or empty is a value, and is found where it is.
  assert.deepEqual(applyJson({ a: null }, [{ op: 'replace', path: ['a'], before: null, after: 0 }]), { a: 0 });
  assert.deepEqual(applyJson({ a: '' }, [{ op: 'remove', path: ['a'], before: '' }]), {});
  assert.deepEqual(applyJson({ l: [false] }, [{ op: 'remove', path: ['l', 0], before: false }]), { l: [] });
});

test('a change finds what it expected, whatever order the keys of it are in', () => {
  assert.deepEqual(applyJson({ a: { x: 1, y: 2 } }, [{ op: 'replace', path: ['a'], before: { y: 2, x: 1 }, after: 3 }]), { a: 3 });
  assert.deepEqual(applyJson({ l: [{ x: 1, y: 2 }] }, [{ op: 'remove', path: ['l', 0], before: { y: 2, x: 1 } }]), { l: [] });
});

test('a change that does not find what it expected does not apply, and says which one it was', () => {
  const document = { a: 'old', l: [CANARY, 'two'], o: { k: CANARY } };

  refuses(document, [{ op: 'replace', path: ['a'], before: 'else', after: 'x' }], 0, /a is not what it was/);
  refuses(document, [{ op: 'remove', path: ['a'], before: 'else' }], 0, /a is not what it was/);
  refuses(document, [{ op: 'replace', path: ['l', 0], before: 'else', after: 'x' }], 0, /l\.0 is not what it was/);
  refuses(document, [{ op: 'remove', path: ['l', 1], before: 'else' }], 0, /l\.1 is not what it was/);
  refuses(document, [{ op: 'replace', path: ['o', 'k'], before: 'else', after: 'x' }], 0, /o\.k is not what it was/);
  // A before that is a part of what is there is not what is there.
  refuses({ o: { x: 1, y: 2 } }, [{ op: 'replace', path: ['o'], before: { x: 1 }, after: 0 }], 0, /o is not what it was/);
  refuses({ o: { x: 1 } }, [{ op: 'replace', path: ['o'], before: { x: 1, y: 2 }, after: 0 }], 0, /o is not what it was/);
});

test('a change that is not where it says does not apply', () => {
  const document = { a: 1, l: [1, 2], o: { k: 1 }, s: 'text', n: null };

  refuses(document, [{ op: 'replace', path: ['missing'], before: 1, after: 2 }], 0, /missing is not in the document/);
  refuses(document, [{ op: 'remove', path: ['missing'], before: 1 }], 0, /missing is not in the document/);
  refuses(document, [{ op: 'replace', path: ['l', 2], before: 1, after: 2 }], 0, /l\.2 is not in the document/);
  refuses(document, [{ op: 'remove', path: ['l', 2], before: 1 }], 0, /l\.2 is not in the document/);
  refuses(document, [{ op: 'remove', path: ['l', 9], before: 1 }], 0, /l\.9 is not in the document/);
  refuses(document, [{ op: 'replace', path: ['gone', 'k'], before: 1, after: 2 }], 0, /gone\.k is not in the document/);
  refuses(document, [{ op: 'replace', path: ['l', 5, 'k'], before: 1, after: 2 }], 0, /l\.5\.k is not in the document/);
  refuses(document, [{ op: 'replace', path: ['l', 2, 'k'], before: 1, after: 2 }], 0, /l\.2\.k is not in the document/);
  // A step that does not fit what it steps into: a key into a list, an index into an object.
  refuses(document, [{ op: 'replace', path: ['l', 'k', 'x'], before: 1, after: 2 }], 0, /l\.k\.x is not in the document/);
  refuses(document, [{ op: 'replace', path: ['o', 0, 'x'], before: 1, after: 2 }], 0, /o\.0\.x is not in the document/);
  refuses(document, [{ op: 'add', path: ['l', 'k'], after: 2 }], 0, /l\.k is not an index of a list/);
  refuses(document, [{ op: 'add', path: ['o', 0], after: 2 }], 0, /o\.0 is not a key of an object/);
  refuses(document, [{ op: 'replace', path: ['l', 'k'], before: 1, after: 2 }], 0, /l\.k is not an index of a list/);
  refuses(document, [{ op: 'remove', path: ['o', 0], before: 1 }], 0, /o\.0 is not a key of an object/);
  // Whatever is stepped into that holds no places: a string, a null, a number.
  refuses(document, [{ op: 'add', path: ['s', 'x'], after: 1 }], 0, /s\.x is not in the document/);
  refuses(document, [{ op: 'add', path: ['n', 'x'], after: 1 }], 0, /n\.x is not in the document/);
  refuses(document, [{ op: 'add', path: ['a', 0], after: 1 }], 0, /a\.0 is not in the document/);
  refuses(document, [{ op: 'replace', path: ['s', 0], before: 't', after: 1 }], 0, /s\.0 is not in the document/);
});

test('an add does not apply where a key is already, or an index is past the end of the list', () => {
  const document = { a: 1, l: [1, 2], o: { k: 1 } };

  refuses(document, [{ op: 'add', path: ['a'], after: 2 }], 0, /a is there already/);
  refuses(document, [{ op: 'add', path: ['o', 'k'], after: 2 }], 0, /o\.k is there already/);
  refuses(document, [{ op: 'add', path: ['l', 3], after: 2 }], 0, /l\.3 is past the end of the list/);
  refuses(document, [{ op: 'add', path: ['l', 9], after: 2 }], 0, /l\.9 is past the end of the list/);
  refuses({ l: [] }, [{ op: 'add', path: ['l', 1], after: 2 }], 0, /l\.1 is past the end of the list/);
  // A key that is there and holds nothing is there.
  refuses({ a: null }, [{ op: 'add', path: ['a'], after: 2 }], 0, /a is there already/);
  // The end of the list, and an empty one, are places.
  assert.deepEqual(applyJson({ l: [] }, [{ op: 'add', path: ['l', 0], after: 2 }]), { l: [2] });
});

test('a change that names no place, or one too deep, does not apply', () => {
  refuses({ a: 1 }, [{ op: 'add', path: [], after: 1 }], 0, /does not name a place/);
  refuses({ a: 1 }, [{ op: 'replace', path: [], before: { a: 1 }, after: {} }], 0, /does not name a place/);
  refuses({ a: 1 }, [{ op: 'remove', path: [], before: { a: 1 } }], 0, /does not name a place/);

  // PATH_DEPTH steps are as deep as a change may go, and one more is refused whatever the document holds.
  const nest = (depth: number): Json => (depth === 0 ? 'leaf' : { k: nest(depth - 1) });
  const path = (depth: number): string[] => Array.from({ length: depth }, () => 'k');
  assert.deepEqual(
    applyJson({ k: nest(PATH_DEPTH - 1) }, [{ op: 'replace', path: path(PATH_DEPTH), before: 'leaf', after: 'new' }]),
    { k: JSON.parse(`${'{"k":'.repeat(PATH_DEPTH - 1)}"new"${'}'.repeat(PATH_DEPTH - 1)}`) }
  );
  refuses({ k: nest(PATH_DEPTH) }, [{ op: 'replace', path: path(PATH_DEPTH + 1), before: 'leaf', after: 'new' }], 0, /does not name a place/);
  assert.equal(PATH_DEPTH, 12);
});

test('the first change that does not apply stops the rest, and nothing is returned', () => {
  const document = { a: 1, b: 2 };
  refuses(
    document,
    [
      { op: 'replace', path: ['a'], before: 1, after: 10 },
      { op: 'replace', path: ['b'], before: 'else', after: 20 },
      { op: 'replace', path: ['c'], before: 1, after: 30 }
    ],
    1,
    /b is not what it was/
  );
  assert.deepEqual(document, { a: 1, b: 2 });
  // The second change is the one that fails because of what the first did.
  refuses(document, [{ op: 'remove', path: ['a'], before: 1 }, { op: 'remove', path: ['a'], before: 1 }], 1, /a is not in the document/);
  // Counted from 1 in a message, from 0 in `at`.
  assert.equal(new ChangesDoNotApply(0, 'x').message, 'Change 1 does not apply: x.');
  assert.equal(new ChangesDoNotApply(4, 'x').at, 4);
  assert.equal(new ChangesDoNotApply(4, 'x').name, 'ChangesDoNotApply');
});

test('a CV with a change applied is a CV, and one that was changed back is the one it was', () => {
  const to = changed((draft) => {
    (draft.experience[0] as { highlights: string[] }).highlights.push('Mentored five engineers.');
    draft.languages.push({ name: 'German', level: 'B2' });
    draft.skills.role = 'Staff Engineer';
    draft.experience.reverse();
  });
  const there = diffCv(CV, to);
  assert.deepEqual(applyCv(CV, there), to);
  assert.deepEqual(applyCv(to, diffCv(to, CV)), CV);
  assert.deepEqual(touched(there), ['skills', 'experience', 'languages'].sort((a, b) => touched(there).indexOf(a) - touched(there).indexOf(b)));
});

/* ------------------------------------------------------------------- scope */

test('the changes outside a key are the ones that touch something else', () => {
  const changes: CvChange[] = [
    { op: 'replace', path: ['experience', 0, 'title'], before: 'a', after: 'b' },
    { op: 'add', path: ['languages', 2], after: 'c' },
    { op: 'remove', path: ['skills'], before: 'd' }
  ];
  assert.deepEqual(outside(changes, 'experience'), [changes[1], changes[2]]);
  assert.deepEqual(outside(changes, 'languages'), [changes[0], changes[2]]);
  assert.deepEqual(outside(changes, 'personal'), changes);
  assert.deepEqual(outside([], 'experience'), []);
  assert.deepEqual(outside(changes.slice(0, 1), 'experience'), []);
  // A key is a key, and not a prefix of one, and an index is not a key.
  assert.deepEqual(outside([{ op: 'add', path: ['experiences', 0], after: 1 }], 'experience').length, 1);
  assert.deepEqual(outside([{ op: 'add', path: [0, 1], after: 1 }], '0').length, 1);
});

test('the keys the changes touch are said once each, in the order they first appear', () => {
  const changes: CvChange[] = [
    { op: 'add', path: ['languages', 2], after: 'a' },
    { op: 'replace', path: ['experience', 0], before: 'a', after: 'b' },
    { op: 'remove', path: ['languages', 0], before: 'a' },
    { op: 'replace', path: ['skills', 'role'], before: 'a', after: 'b' },
    { op: 'add', path: ['experience', 1], after: 'a' }
  ];
  assert.deepEqual(touched(changes), ['languages', 'experience', 'skills']);
  assert.deepEqual(touched([]), []);
});

/* ------------------------------------------------------------------- schema */

test('a stored change has one of three shapes, and nothing else', () => {
  const good: unknown[] = [
    { op: 'replace', path: ['a'], before: 1, after: 2 },
    { op: 'replace', path: ['a', 0, 'b'], before: null, after: { x: [1, 'two', true, null] } },
    { op: 'add', path: ['a'], after: 'x' },
    { op: 'remove', path: ['a', 3], before: [] },
    { op: 'replace', path: Array.from({ length: PATH_DEPTH }, () => 'k'), before: 0, after: 1 }
  ];
  for (const change of good) assert.equal(cvChangeSchema.safeParse(change).success, true, JSON.stringify(change));

  const bad: [string, unknown][] = [
    ['an unknown kind', { op: 'move', path: ['a'], after: 1 }],
    ['no kind', { path: ['a'], after: 1 }],
    ['an add that says what it found', { op: 'add', path: ['a'], before: 1, after: 2 }],
    ['an add with nothing to add', { op: 'add', path: ['a'] }],
    ['a remove that says what it adds', { op: 'remove', path: ['a'], before: 1, after: 2 }],
    ['a remove with nothing it found', { op: 'remove', path: ['a'] }],
    ['a replace with nothing it found', { op: 'replace', path: ['a'], after: 2 }],
    ['a replace with nothing it becomes', { op: 'replace', path: ['a'], before: 2 }],
    ['an extra key', { op: 'add', path: ['a'], after: 1, why: 'because' }],
    ['a replace with an extra key', { op: 'replace', path: ['a'], before: 1, after: 2, why: 'because' }],
    ['a remove with an extra key', { op: 'remove', path: ['a'], before: 1, why: 'because' }],
    ['no place', { op: 'add', path: [], after: 1 }],
    ['a place that is not a list', { op: 'add', path: 'a', after: 1 }],
    ['a place that is too deep', { op: 'add', path: Array.from({ length: PATH_DEPTH + 1 }, () => 'k'), after: 1 }],
    ['a negative index', { op: 'add', path: ['a', -1], after: 1 }],
    ['an index that is not whole', { op: 'add', path: ['a', 1.5], after: 1 }],
    ['a step that is neither', { op: 'add', path: ['a', null], after: 1 }],
    ['a value that is not data', { op: 'add', path: ['a'], after: undefined }],
    ['a value that is a function', { op: 'add', path: ['a'], after: () => 1 }]
  ];
  for (const [what, change] of bad) assert.equal(cvChangeSchema.safeParse(change).success, false, what);

  // An index of 0 is an index, and an empty key is a key.
  assert.equal(cvChangeSchema.safeParse({ op: 'add', path: ['a', 0], after: 1 }).success, true);
  assert.equal(cvChangeSchema.safeParse({ op: 'add', path: [''], after: 1 }).success, true);
});

test('a list of changes is at most 2,000 long', () => {
  const one: CvChange = { op: 'add', path: ['a'], after: 1 };
  assert.equal(cvChangesSchema.safeParse([]).success, true);
  assert.equal(cvChangesSchema.safeParse(Array.from({ length: 2_000 }, () => one)).success, true);
  assert.equal(cvChangesSchema.safeParse(Array.from({ length: 2_001 }, () => one)).success, false);
  assert.equal(cvChangesSchema.safeParse([one, { op: 'nope' }]).success, false);
  assert.equal(cvChangesSchema.safeParse(one).success, false, 'a list, not a change');
});

/* --------------------------------------------------------------------- fuzz */

/** A small generator that gives the same documents for the same seed. */
const generator = (seed: number) => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n: number): number => Math.floor(next() * n);
  const pick = <T>(items: readonly T[]): T => items[below(items.length)] as T;

  const scalar = (): Json => pick<Json>(['a', 'b', 'c', 'd', '', 'longer text', 0, 1, 2, true, false, null]);
  const value = (depth: number): Json => {
    if (depth <= 0 || next() < 0.4) return scalar();
    if (next() < 0.5) return Array.from({ length: below(5) }, () => value(depth - 1));
    return Object.fromEntries(Array.from({ length: below(4) }, () => [pick(['k1', 'k2', 'k3', 'k4', '__proto__']), value(depth - 1)]));
  };
  const record = (): Record<string, Json> =>
    Object.fromEntries(Array.from({ length: 1 + below(4) }, () => [pick(['p', 'q', 'r', 's', 't']), value(4)]));

  /** Changes a copy of a value in a few places: the edits a model makes. */
  const edit = (input: Json, depth = 0): Json => {
    if (Array.isArray(input)) {
      const list = input.map((each) => (next() < 0.3 ? edit(each, depth + 1) : each));
      for (let k = below(3); k > 0; k -= 1) {
        const at = below(list.length + 1);
        const roll = next();
        if (roll < 0.35) list.splice(at, 0, value(2));
        else if (roll < 0.7 && list.length > 0) list.splice(at % list.length, 1);
        else if (list.length > 1) list.splice(below(list.length), 0, ...list.splice(below(list.length), 1));
      }
      return list;
    }
    if (typeof input === 'object' && input !== null) {
      const out: Record<string, Json> = {};
      const record = input as { readonly [key: string]: Json };
      for (const key of Object.keys(record)) {
        const roll = next();
        if (roll < 0.15) continue;
        Object.defineProperty(out, key, { value: roll < 0.5 ? edit(record[key] as Json, depth + 1) : (record[key] as Json), enumerable: true, writable: true, configurable: true });
      }
      if (next() < 0.3) Object.defineProperty(out, pick(['n1', 'n2', '__proto__']), { value: value(2), enumerable: true, writable: true, configurable: true });
      return out;
    }
    return next() < 0.5 ? scalar() : input;
  };

  return { record, edit, below };
};

test('over a few thousand random edits, what a diff says applied to the document is the one it was made to', () => {
  let total = 0;
  let empty = 0;
  for (let seed = 1; seed <= 3_000; seed += 1) {
    const g = generator(seed);
    const from = g.record();
    const to = g.edit(from) as Record<string, Json>;
    const changes = roundTrip(from, to);
    total += changes.length;
    if (changes.length === 0) empty += 1;

    // The way back, and nothing between a document and itself.
    assert.ok(same(applyJson(to, diffJson(to, from)), from as Json), `seed ${seed}: the way back`);
    assert.deepEqual(diffJson(to, copy(to)), [], `seed ${seed}: a document and a copy of it`);
    if (empty > 3_000) break;
  }
  // The generator makes edits and not only documents that are the same.
  assert.ok(total > 3_000, `${total} changes over 3,000 edits`);
  assert.ok(empty < 1_500, `${empty} of 3,000 edits changed nothing`);
});

test('over a few hundred random edits of a CV, an apply of the diff is the CV that was meant', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const g = generator(seed * 7);
    const to = g.edit(CV as unknown as Json) as unknown as CvDocument;
    assert.deepEqual(applyCv(CV, diffCv(CV, to)), JSON.parse(JSON.stringify(to)), `seed ${seed}`);
  }
});
