/**
 * The grounding engine: the formats a record is written in, and the arithmetic
 * over them.
 *
 * A ref, a digest and a record entry are written down by one process and read
 * back by another, a host that keeps a citation, a later version of this code, a
 * store being queried by prefix. So what these tests pin is not behaviour that
 * happens to work but the formats themselves: one spelling for one address, one
 * digest for one value whatever order its keys were built in, one key for one
 * entry. The digests are known answers computed by a second implementation, not
 * copied out of this one, so a change to the canonical form shows as a failed
 * answer and not as two halves of the same code agreeing with each other.
 *
 * The engine is also run over a helpdesk (`support/helpdesk.ts`), tickets and
 * articles with awkward keys, and a last test reads the engine's own source for
 * the words of the domain this repository serves. An engine only ever exercised
 * with the vocabulary it was written against has not been shown to be neutral,
 * and the first time it is not is the day a second consumer finds out.
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 91 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * canonical JSON:
 *   keys not sorted                            4
 *   keys sorted by locale                      2
 *   keys sorted by code point                  1
 *   space after array comma                    4
 *   space after member comma                   4
 *   undefined member kept                      1
 *   undefined array item becomes null          1
 *   array holes skipped                        1
 *   cycle not detected                         1
 *   shared object taken for a cycle            1
 *   non-plain object accepted                  1
 *   null-prototype object refused              1
 *   non-finite number accepted                 1
 *   bigint, function, symbol written as text   1
 *
 * the digest:
 *   12 characters                       11
 *   SHA-1                                1
 *   plain JSON, not canonical            2
 *   text digested as bare bytes          1
 *   isDigest upper case allowed          1
 *   isDigest shorter allowed             2
 *   isDigest not anchored at the end     1
 *   isDigest not anchored at the start   1
 *
 * refs:
 *   dot-only segment written as dots       2
 *   lower-case hex                         5
 *   second spelling accepted               2
 *   three segments allowed                 1
 *   three segments parse                   2
 *   lone surrogate accepted                2
 *   empty segment accepted                 2
 *   well id of 64 characters               1
 *   well id may start with a digit         1
 *   no length limit on writing             1
 *   length limit 2048                      2
 *   version written unescaped              3
 *   digest unchecked on writing            1
 *   path length unchecked on writing       1
 *   well id unchecked on writing           1
 *   no match not refused                   1
 *   address keeps the version              2
 *   hyphen escaped                        18
 *   dot escaped                            2
 *   underscore escaped                     2
 *   tilde escaped                          2
 *   digit range short at the top           6
 *   upper-case range short at the top      1
 *   lower-case range short at the bottom   8
 *   at sign left unescaped                 5
 *   slash left unescaped                   5
 *   hash left unescaped                    4
 *   percent left unescaped                 3
 *   space left unescaped                   4
 *
 * walls:
 *   string prefix, not whole segments    1
 *   scope ignored                        2
 *   well ignored                         1
 *   version compared                     4
 *   digest compared                      4
 *   last wall named, not the first       1
 *   isWalled inverted                    4
 *   within includes the ref's own wall   1
 *   within turned around                 2
 *   within ignores the scope             1
 *
 * the registry:
 *   a repeated id accepted     1
 *   a bad id accepted          1
 *   an unknown well accepted   3
 *   ids in reverse             1
 *
 * the record book:
 *   ref not part of the key                    3
 *   version not part of the key                3
 *   digest not part of the key                 1
 *   shown not part of the key                  1
 *   status not part of the key                 1
 *   origin not part of the key                 1
 *   channel not part of the key                2
 *   shown equal to digest kept                 1
 *   stored as given, not as cleaned            1
 *   a digest inside the ref accepted           1
 *   a version inside the ref accepted          1
 *   well not checked                           2
 *   digest not checked                         1
 *   shown digest not checked                   1
 *   status not checked                         1
 *   origin not checked                         1
 *   channel not anchored                       1
 *   channel of 128 characters                  1
 *   version not checked                        1
 *   a duplicate reported as new                3
 *   entries in reverse                         4
 *   existing entries ignored                   2
 *   existing entries checked again             1
 *   everything but blocked counts as reached   1
 *
 * the domain-word scan:
 *   domain word in the contract   1
 *   domain word in the engine     1
 *
 * Ten more were applied and survived, which is the design and not a gap.
 * `parseRef` writes out what it parsed and compares that with what it was given,
 * so nine looser parsing rules (a lower-case escape, a malformed escape, a
 * character outside ASCII, invalid UTF-8, text after the digest, an upper-case
 * digest, a ref over the length limit, an empty scope, an empty segment) change
 * nothing a caller can see while that comparison stands. Each of the nine was
 * applied again with the comparison removed, and each then broke two tests, which
 * is what shows the rules are checked and not merely backed up. The tenth is the
 * length guard in `contains`: `every` over a longer path already fails on the
 * missing segment, so the guard is there to be read and changes no answer.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { OperationError } from '../src/contracts/index.js';
import type { PieceRef, RecordEntry } from '../src/contracts/index.js';
import {
  canonicalJson,
  contains,
  createRecordBook,
  createWellRegistry,
  digest,
  entryKey,
  formatRef,
  isDigest,
  isRef,
  isWalled,
  parseRef,
  reached,
  refAddress,
  refKey,
  wallFor,
  wallsWithin
} from '../src/grounding/index.js';
import { articlePieces, helpdeskWells, queue, readSection, ref, ticketPieces } from './support/helpdesk.js';

const code = (expected: string) => (error: unknown) => error instanceof OperationError && error.code === expected;

/* ----------------------------------------------------------- canonical JSON */

test('canonical JSON writes keys in order with nothing spaced, whoever built the object', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, 2], c: null } }), '{"a":{"c":null,"d":[1,2]},"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
});

test('canonical JSON sorts by UTF-16 code unit: capitals first, accents after plain letters', () => {
  assert.equal(canonicalJson({ é: 1, e: 2, Z: 3, a: 4 }), '{"Z":3,"a":4,"e":2,"é":1}');
  // Past the Basic Multilingual Plane the two orders part ways: by code point
  // U+FF5E comes before U+1F600, by code unit (D83D DE00 against FF5E) after it.
  assert.equal(canonicalJson({ '～': 1, '\u{1F600}': 2 }), '{"\u{1F600}":2,"～":1}');
});

test('canonical JSON drops an undefined member, keeps array order, and takes a shared object twice', () => {
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
  const shared = { x: 1 };
  assert.equal(canonicalJson({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}');
  assert.equal(canonicalJson(Object.assign(Object.create(null) as object, { a: 1 })), '{"a":1}');
});

test('canonical JSON writes numbers and strings as JSON does', () => {
  assert.equal(canonicalJson([0.1, -0, 1e21, 5]), '[0.1,0,1e+21,5]');
  assert.equal(canonicalJson('a"b\\c\n'), '"a\\"b\\\\c\\n"');
  assert.equal(canonicalJson('😀'), '"😀"');
  assert.equal(canonicalJson('\ud800'), '"\\ud800"');
});

test('canonical JSON refuses what two writers could disagree about', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const holey: unknown[] = new Array<unknown>(2);
  holey[1] = 1;
  const refused: unknown[] = [
    [undefined],
    holey,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    () => 1,
    Symbol('x'),
    new Date(0),
    new Map(),
    Object.create({ inherited: 1 }) as object,
    cycle
  ];
  for (const value of refused) assert.throws(() => canonicalJson(value), code('not_canonical'));
});

/* ------------------------------------------------------------------- digest */

test('a digest is the first 16 hex characters of a SHA-256 computed outside this code', () => {
  assert.equal(digest({ a: 1, b: [true, null, 'x'] }), 'eca8cfb31ab74533');
  assert.equal(digest('a'), 'ac8d8342bbb2362d');
  assert.equal(digest(['a']), '0eb5b8d6f81bc677');
  assert.equal(digest('zażółć gęślą jaźń'), '4c8419b94ef0f915');
  assert.equal(digest({ é: 1, e: 2, Z: 3, a: 4 }), 'e660b19d2b4b5810');
});

test('a digest ignores key order and sees any change', () => {
  const piece = { number: 'T-1', body: 'a', tags: ['x', 'y'] };
  assert.equal(digest(piece), digest({ tags: ['x', 'y'], body: 'a', number: 'T-1' }));
  for (const changed of [
    { ...piece, body: 'b' },
    { ...piece, tags: ['y', 'x'] },
    { ...piece, number: 'T-2' },
    { ...piece, extra: 1 }
  ]) {
    assert.notEqual(digest(changed), digest(piece));
  }
  assert.notEqual(digest('a'), digest(['a']));
});

test('isDigest accepts what digest writes and nothing looser', () => {
  assert.equal(isDigest(digest('x')), true);
  for (const bad of ['', 'abc', '9F86D081884C7D65', '9f86d081884c7d6', '9f86d081884c7d650', '9f86d081884c7d6g', 16, undefined]) {
    assert.equal(isDigest(bad), false, String(bad));
  }
});

/* --------------------------------------------------------------------- refs */

const SPELLINGS: [PieceRef, string][] = [
  [{ well: 'tickets', scope: 'support', path: ['open', 'T-1042'] }, 'tickets:support/open/T-1042'],
  [
    { well: 'tickets', scope: 'support', version: '12', path: ['open', 'T-1042'], digest: '9f86d081884c7d65' },
    'tickets:support@12/open/T-1042#9f86d081884c7d65'
  ],
  [{ well: 'kb', scope: 'main', path: [] }, 'kb:main'],
  [{ well: 'kb', scope: 'main', version: '3', path: ['billing'] }, 'kb:main@3/billing'],
  [{ well: 'kb', scope: 'main', version: '3', path: [] }, 'kb:main@3'],
  [{ well: 'kb', scope: 'main', path: ['how/to', 'zażółć-hasło'] }, 'kb:main/how%2Fto/za%C5%BC%C3%B3%C5%82%C4%87-has%C5%82o'],
  [{ well: 'kb', scope: 'a b:c%', path: ['x@y', 'z#1'] }, 'kb:a%20b%3Ac%25/x%40y/z%231'],
  [{ well: 'kb', scope: '.', path: ['..', 'a.b'] }, 'kb:%2E/%2E%2E/a.b'],
  [{ well: 'kb', scope: 'main', path: ['😀'] }, 'kb:main/%F0%9F%98%80'],
  [{ well: 'kb-2', scope: 'a~b_c-d.e', path: [] }, 'kb-2:a~b_c-d.e'],
  [{ well: 'w'.repeat(32), scope: 's', path: [] }, `${'w'.repeat(32)}:s`]
];

test('a ref is written one way, and parses back to the same piece', () => {
  for (const [parts, text] of SPELLINGS) {
    assert.equal(formatRef(parts), text);
    assert.deepEqual(parseRef(text), parts);
  }
});

test('of the ASCII range only the unreserved characters are written as themselves', () => {
  for (let code = 0; code < 128; code += 1) {
    const char = String.fromCharCode(code);
    const written = /[A-Za-z0-9._~-]/.test(char) ? char : `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
    assert.equal(formatRef({ well: 'kb', scope: `x${char}x`, path: [] }), `kb:x${written}x`, `U+${code.toString(16)}`);
  }
});

test('any segment survives the round trip, whatever it holds', () => {
  const pool = ['a', 'Z', '0', '/', '@', '#', '%', ':', '.', '~', '-', '_', ' ', 'é', 'ż', '😀', '\n', '\u0000', '?', '&', '+'];
  let seed = 7;
  const next = (below: number): number => {
    seed = (seed * 48271) % 2147483647;
    return seed % below;
  };
  const segment = (): string => Array.from({ length: 1 + next(8) }, () => pool[next(pool.length)] as string).join('');

  for (let round = 0; round < 400; round += 1) {
    const parts: PieceRef = {
      well: 'kb',
      scope: segment(),
      path: Array.from({ length: next(3) }, segment),
      ...(next(2) === 0 ? {} : { version: segment() }),
      ...(next(2) === 0 ? {} : { digest: digest(round) })
    };
    const text = formatRef(parts);
    assert.deepEqual(parseRef(text), parts, text);
    assert.match(text, /^[A-Za-z0-9._~\-:@/#%]+$/);
  }
});

test('a slash, an at sign or a hash inside a segment stays inside it', () => {
  assert.deepEqual(parseRef('kb:a%2Fb%40c%23d/x%2Fy/z'), { well: 'kb', scope: 'a/b@c#d', path: ['x/y', 'z'] });
});

test('only the canonical spelling parses', () => {
  const refused = [
    '',
    'tickets',
    'tickets:',
    ':support',
    'Tickets:support',
    '1tickets:support',
    'tickets:support/',
    'tickets:support//open',
    'tickets:support/a/b/c',
    'tickets:support@/open',
    'tickets:support@1@2/open',
    'tickets:support#abc',
    'tickets:support#9F86D081884C7D65',
    'tickets:support#9f86d081884c7d65/open',
    'tickets:support/open/T#1',
    'tickets:sup%6Frt',
    'tickets:sup%6frt',
    'tickets:za%C5',
    'tickets:a%2',
    'tickets:zażółć',
    'tickets:a b',
    'tickets:.',
    'tickets:%2e',
    'tickets:support/..',
    `${'w'.repeat(33)}:support`,
    `kb:${'x'.repeat(1100)}`
  ];
  for (const text of refused) {
    assert.throws(() => parseRef(text), code('invalid_ref'), text);
    assert.equal(isRef(text), false, text);
  }
  assert.equal(isRef(undefined), false);
  assert.equal(isRef(42), false);
  assert.equal(isRef('tickets:support/open'), true);
});

test('a ref that cannot be written is refused, not bent', () => {
  const unwritable: PieceRef[] = [
    { well: 'Tickets', scope: 's', path: [] },
    { well: '', scope: 's', path: [] },
    { well: 'a b', scope: 's', path: [] },
    { well: 'w'.repeat(33), scope: 's', path: [] },
    { well: '1kb', scope: 's', path: [] },
    { well: 'kb', scope: '', path: [] },
    { well: 'kb', scope: 's', path: [''] },
    { well: 'kb', scope: 's', path: ['a', 'b', 'c'] },
    { well: 'kb', scope: 's', version: '', path: [] },
    { well: 'kb', scope: '\ud800', path: [] },
    { well: 'kb', scope: 's', path: [], digest: 'XYZ' },
    { well: 'kb', scope: 'x'.repeat(1100), path: [] }
  ];
  for (const parts of unwritable) assert.throws(() => formatRef(parts), code('invalid_ref'), JSON.stringify(parts).slice(0, 60));
});

test('two citations of one piece share a key, and the key is the address', () => {
  const first = parseRef('tickets:support@12/open/T-1#9f86d081884c7d65');
  const later = parseRef('tickets:support@13/open/T-1#0000000000000000');
  assert.equal(refKey(first), 'tickets:support/open/T-1');
  assert.equal(refKey(later), refKey(first));
  assert.deepEqual(refAddress(first), { well: 'tickets', scope: 'support', path: ['open', 'T-1'] });
});

/* -------------------------------------------------------------------- walls */

test('a wall covers itself and everything beneath it, and nothing above', () => {
  assert.equal(contains(ref('tickets:support/open'), ref('tickets:support/open')), true);
  assert.equal(contains(ref('tickets:support/open'), ref('tickets:support/open/T-1')), true);
  assert.equal(contains(ref('tickets:support'), ref('tickets:support/closed/T-9')), true);
  assert.equal(contains(ref('tickets:support/open/T-1'), ref('tickets:support/open')), false);
  assert.equal(contains(ref('tickets:support/open/T-1'), ref('tickets:support')), false);
});

test('a wall works on whole segments, not on string prefixes', () => {
  assert.equal(contains(ref('kb:main/billing'), ref('kb:main/billing-faq/x')), false);
  assert.equal(contains(ref('kb:main/bill'), ref('kb:main/billing')), false);
  assert.equal(contains(ref('kb:main/billing/x'), ref('kb:main/billing/xy')), false);
});

test('a wall is for one scope of one well', () => {
  assert.equal(contains(ref('tickets:support/open'), ref('tickets:sales/open/T-1')), false);
  assert.equal(contains(ref('tickets:support'), ref('kb:support/open')), false);
});

test('a wall follows the live revision: version and digest are not compared', () => {
  assert.equal(contains(ref('tickets:support/open'), ref('tickets:support@12/open/T-1#9f86d081884c7d65')), true);
  assert.equal(contains(ref('tickets:support@5/open'), ref('tickets:support@12/open/T-1')), true);
});

test('wallFor names the wall that held a piece back, and isWalled agrees', () => {
  const walls = [ref('tickets:support/closed'), ref('kb:main/internal/refund-policy')];
  assert.deepEqual(wallFor(walls, ref('tickets:support/closed/T-0987')), walls[0]);
  assert.deepEqual(wallFor(walls, ref('kb:main/internal/refund-policy')), walls[1]);
  assert.equal(wallFor(walls, ref('kb:main/internal/escalation')), undefined);
  const nested = [ref('tickets:support/closed'), ref('tickets:support/closed/T-0987')];
  assert.deepEqual(wallFor(nested, ref('tickets:support/closed/T-0987')), nested[0]);
  assert.equal(isWalled(walls, ref('tickets:support/closed/T-0987')), true);
  assert.equal(isWalled(walls, ref('tickets:support/open/T-1042')), false);
  assert.equal(isWalled([], ref('tickets:support/open/T-1042')), false);
});

test('wallsWithin gives the walls strictly inside a ref, which a read of it must leave out', () => {
  const walls = [
    ref('tickets:support/closed/T-9'),
    ref('tickets:support/open/T-2'),
    ref('tickets:support/open'),
    ref('tickets:other/open/T-3')
  ];
  assert.deepEqual(wallsWithin(walls, ref('tickets:support/open')), [ref('tickets:support/open/T-2')]);
  assert.deepEqual(wallsWithin(walls, ref('tickets:support')), [
    ref('tickets:support/closed/T-9'),
    ref('tickets:support/open/T-2'),
    ref('tickets:support/open')
  ]);
  assert.deepEqual(wallsWithin(walls, ref('tickets:support/open/T-2')), []);
});

/* ----------------------------------------------------------------- registry */

test('the registry knows the ids it was built with, and checks a ref against them', () => {
  assert.deepEqual(helpdeskWells.ids(), ['tickets', 'kb']);
  assert.equal(helpdeskWells.has('kb'), true);
  assert.equal(helpdeskWells.has('cv'), false);
  assert.match(helpdeskWells.get('kb')?.describe ?? '', /Knowledge-base/);
  assert.doesNotThrow(() => helpdeskWells.check(ref('kb:main/billing')));
  assert.throws(() => helpdeskWells.check(ref('ghost:x/y')), code('unknown_well'));
});

test('a registry refuses a bad id and a repeated one', () => {
  assert.throws(() => createWellRegistry([{ id: 'Bad Id', describe: 'x' }]), code('invalid_well'));
  assert.throws(
    () =>
      createWellRegistry([
        { id: 'kb', describe: 'x' },
        { id: 'kb', describe: 'y' }
      ]),
    code('invalid_well')
  );
});

/* --------------------------------------------------------------------- book */

const entry = (over: Partial<RecordEntry> = {}): RecordEntry => ({
  ref: 'tickets:support/open/T-1042',
  version: '12',
  digest: digest('T-1042 at 12'),
  status: 'included',
  origin: 'server',
  via: 'tool:read_ticket',
  ...over
});

test('equal entries are one entry, kept in the order they were first recorded', () => {
  const book = createRecordBook(helpdeskWells);
  assert.equal(book.add(entry()), true);
  assert.equal(book.add(entry({ ref: 'tickets:support/open/T-7' })), true);
  assert.equal(book.add(entry()), false);
  assert.deepEqual(
    book.entries().map((each) => each.ref),
    ['tickets:support/open/T-1042', 'tickets:support/open/T-7']
  );
});

test('a changed digest, version, form, status, origin or channel is a different entry', () => {
  const variants: Partial<RecordEntry>[] = [
    { digest: digest('T-1042 at 13') },
    { version: '13' },
    { shown: digest('an excerpt') },
    { status: 'read' },
    { origin: 'client' },
    { via: 'tool:search' }
  ];
  const book = createRecordBook(helpdeskWells);
  book.add(entry());
  for (const [at, variant] of variants.entries()) {
    assert.equal(book.add(entry(variant)), true, JSON.stringify(variant));
    assert.equal(book.entries().length, at + 2);
  }
  assert.equal(new Set(book.entries().map(entryKey)).size, variants.length + 1);
});

test('an entry with no version is its own entry, and a shown digest equal to the digest is no different from none', () => {
  const unversioned = entry();
  delete (unversioned as { version?: string }).version;
  const book = createRecordBook(helpdeskWells);
  assert.equal(book.add(entry()), true);
  assert.equal(book.add(unversioned), true);

  assert.equal(book.add(entry({ shown: entry().digest })), false);
  assert.equal(book.entries().length, 2);

  assert.equal(book.add(entry({ ref: 'tickets:support/open/T-9', shown: entry().digest })), true);
  assert.equal('shown' in (book.entries()[2] as object), false);
});

test('a channel name is up to 64 characters', () => {
  const book = createRecordBook(helpdeskWells);
  assert.equal(book.add(entry({ via: 'a'.repeat(64) })), true);
  assert.equal(book.add(entry({ via: 'tool:read_ticket' })), true);
  assert.equal(book.add(entry({ via: 'port:documents.v2-x' })), true);
});

test('an entry is checked before it is recorded, and a refused one leaves no trace', () => {
  const refused: [string, Partial<RecordEntry>, string][] = [
    ['an unknown well', { ref: 'ghost:x/y' }, 'unknown_well'],
    ['a version inside the ref', { ref: 'tickets:support@12/open/T-1' }, 'invalid_entry'],
    ['a digest inside the ref', { ref: 'tickets:support/open#9f86d081884c7d65' }, 'invalid_entry'],
    ['a ref in a second spelling', { ref: 'tickets:sup%6Frt/open' }, 'invalid_ref'],
    ['a digest that is not one', { digest: 'XYZ' }, 'invalid_entry'],
    ['a shown digest that is not one', { shown: '1234' }, 'invalid_entry'],
    ['an empty version', { version: '' }, 'invalid_ref'],
    ['an ill-formed version', { version: '\ud800' }, 'invalid_ref'],
    ['a status nobody defined', { status: 'maybe' as RecordEntry['status'] }, 'invalid_entry'],
    ['an origin nobody defined', { origin: 'nobody' as RecordEntry['origin'] }, 'invalid_entry'],
    ['an empty channel', { via: '' }, 'invalid_entry'],
    ['a channel with a capital', { via: 'Tool' }, 'invalid_entry'],
    ['a channel with a space', { via: 'a b' }, 'invalid_entry'],
    ['a channel of 65 characters', { via: 'a'.repeat(65) }, 'invalid_entry']
  ];
  const book = createRecordBook(helpdeskWells);
  for (const [what, over, expected] of refused) {
    assert.throws(() => book.add(entry(over)), code(expected), what);
  }
  assert.deepEqual(book.entries(), []);
});

test('a book resumes from what a store already holds, and does not record it twice', () => {
  const first = createRecordBook(helpdeskWells);
  first.add(entry());
  first.add(entry({ ref: 'tickets:support/open/T-7' }));

  const resumed = createRecordBook(helpdeskWells, first.entries());
  assert.equal(resumed.add(entry()), false);
  assert.equal(resumed.add(entry({ ref: 'tickets:support/open/T-8' })), true);
  assert.equal(resumed.entries().length, 3);
  assert.deepEqual(resumed.entries().slice(0, 2), first.entries());
});

test('entries from a well that is no longer registered still load, and no new ones are taken from it', () => {
  const old = entry({ ref: 'ghost:x/y' });
  const book = createRecordBook(helpdeskWells, [old]);
  assert.deepEqual(book.entries(), [old]);
  assert.throws(() => book.add(entry({ ref: 'ghost:x/z' })), code('unknown_well'));
  assert.deepEqual(book.entries(), [old]);
});

test('only an included entry reached the model, and a status nobody knows never did', () => {
  assert.equal(reached({ status: 'included' }), true);
  for (const status of ['read', 'blocked', 'compact', '']) assert.equal(reached({ status }), false, status);
});

/* ---------------------------------------------------------------- helpdesk */

test('over a helpdesk, walls hold back what they cover and the record lists what was read', () => {
  const pieces = [...ticketPieces(), ...articlePieces()];
  const walls = [ref('tickets:support/closed'), ref('kb:main/internal/refund-policy')];
  const book = createRecordBook(helpdeskWells);
  const numbers = (read: { ref: PieceRef }[]): string[] => read.map((piece) => piece.ref.path[1] as string);

  assert.deepEqual(numbers(readSection(pieces, ref('tickets:support/open'), walls, book)), ['T-1042', 'T-1043']);
  assert.deepEqual(readSection(pieces, ref('tickets:support/closed'), walls, book), []);
  assert.deepEqual(readSection(pieces, ref('tickets:support/closed/T-0987'), walls, book), []);
  assert.deepEqual(numbers(readSection(pieces, ref('tickets:support'), walls, book)), ['T-1042', 'T-1043']);
  assert.deepEqual(numbers(readSection(pieces, ref('kb:main/internal'), walls, book)), ['escalation']);
  assert.deepEqual(numbers(readSection(pieces, ref('kb:main/how%2Fto'), walls, book)), ['zażółć-hasło']);

  const recorded = book.entries().map((each) => each.ref);
  assert.deepEqual(recorded, [
    'tickets:support/open/T-1042',
    'tickets:support/open/T-1043',
    'kb:main/internal/escalation',
    'kb:main/how%2Fto/za%C5%BC%C3%B3%C5%82%C4%87-has%C5%82o'
  ]);
  assert.equal(recorded.some((text) => text.includes('closed') || text.includes('refund-policy')), false);
});

test('over a helpdesk, an entry becomes a citation that names the piece it came from', () => {
  const pieces = ticketPieces();
  const book = createRecordBook(helpdeskWells);
  readSection(pieces, ref('tickets:support/open/T-1042'), [], book);

  const [only] = book.entries();
  assert.ok(only);
  const citation = formatRef({ ...parseRef(only.ref), ...(only.version === undefined ? {} : { version: only.version }), digest: only.digest });
  assert.equal(citation, `tickets:support@12/open/T-1042#${digest(queue.tickets[0])}`);
  assert.equal(refKey(parseRef(citation)), only.ref);
});

test('over a helpdesk, an edit between two reads shows in the record', () => {
  const book = createRecordBook(helpdeskWells);
  readSection(ticketPieces(), ref('tickets:support/open'), [], book);

  const edited = {
    ...queue,
    revision: 13,
    tickets: queue.tickets.map((ticket) => (ticket.number === 'T-1042' ? { ...ticket, body: 'Reset mail now arrives.' } : ticket))
  };
  readSection(ticketPieces(edited), ref('tickets:support/open'), [], book);

  const changed = book.entries().filter((each) => each.ref === 'tickets:support/open/T-1042');
  assert.equal(changed.length, 2);
  assert.notEqual(changed[0]?.digest, changed[1]?.digest);
  assert.deepEqual(changed.map((each) => each.version), ['12', '13']);

  const untouched = book.entries().filter((each) => each.ref === 'tickets:support/open/T-1043');
  assert.equal(untouched[0]?.digest, untouched[1]?.digest);
});

/* ------------------------------------------------------------ domain-neutral */

test('the engine and its vocabulary name no domain', () => {
  const folder = new URL('../src/grounding/', import.meta.url);
  const files = [
    ...readdirSync(folder)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => new URL(name, folder)),
    new URL('../src/contracts/grounding.ts', import.meta.url)
  ];
  assert.ok(files.length >= 8, 'the engine files were found');

  const words = /\b(cvs?|resumes?|offers?|candidates?|employers?|jobs?|experience|profile|recruit\w*)\b/i;
  for (const file of files) {
    const found = readFileSync(file, 'utf8').match(words)?.[0];
    assert.equal(found, undefined, `${file.pathname} says "${found}"`);
  }
});
