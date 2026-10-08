/**
 * The strict scope: a person's employers and schools are kept from a model too.
 *
 * The default masks what identifies a person to whoever reads a message: the name,
 * the email, the phone and the links the CV states, and what has the shape of an
 * identifier. A person who chooses `strict` also has the company of every
 * experience entry and the university of every education entry kept, as `[ORG_n]`.
 * Six claims.
 *
 *   engine      an employer is one value, whole: a word of it by itself is not it,
 *               and the company without its legal form is, because that is how a
 *               company is said; nothing is stripped but the end; the longest of
 *               two values that begin together is the one used
 *   seeds       the scope that is asked for decides which values the CV gives,
 *               entry by entry, and only the company and the university
 *   in a run    a run is held to the scope a person had set when it began, and a
 *               change is in force from the next message; a host that names no
 *               scope is held to the default
 *   stored      the setting is kept like the others, survives a restart, is
 *               refused when it is not a scope and read as strict when it got into
 *               the file anyway, and a save that does not name it keeps it
 *   in force    a message asked after a change is masked as the change says, with
 *               no restart in between: the real harness, a real file, a CV in it,
 *               a `fetch` that is the network, and what comes home is put right
 *   embedding   an embedder that is not on this machine is not told an employer
 *               either, in the text the index is made from and in a question
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 177 were applied: 176 fail at least one test here, and 1 cannot be told from the original.
 *
 * src/effects/mask.ts:
 *   an employer placeholder is called something else          31
 *   an employer is a name                                     31
 *   an employer is read as a name is                          32
 *   an employer is read as a link is                          31
 *   the name is not folded                                    31
 *   the end of a name is not stripped                         15
 *   only the front of a name is stripped                      15
 *   only the end of a name is stripped                        1
 *   a digit at the edge of a name is stripped                 1
 *   a digit at the end of a name is stripped                  1
 *   a digit at the front of a name is stripped                1
 *   one punctuation mark at the front is stripped, not a run  1
 *   one punctuation mark at the end is stripped, not a run    1
 *   the whole name is never a pattern                         12
 *   the short name is never a pattern                         8
 *   a name is taken only above the minimum                    3
 *   a name is taken at two characters                         2
 *   a name is taken at any length                             2
 *   the short name is taken at any length                     1
 *   the whole name is taken at any length                     1
 *   every pattern is the whole name                           8
 *   every pattern is the short name                           12
 *   the length is counted in the name as written              2
 *   the form is looked for in the name as written             8
 *   the form is not taken off                                 8
 *   every form is taken off                                   1
 *   the form is taken off and so is a word before it          5
 *   the short name is the whole one with its first word off   4
 *   a name is not bounded before                              1
 *   a name is not bounded after                               2
 *   the words of a name are joined by one space               1
 *   the words of a name are joined by a space or none         1
 *   the words of a name are split on one space                1
 *   the words of a name are not escaped                       1
 *   only the first word of a name is escaped                  1
 *   a name weighs nothing                                     33
 *   a name weighs one                                         33
 *   a name weighs less the longer it is                       33
 *   a form needs no space before it                           1
 *   a form needs a space and not a comma before it            1
 *   a form needs a comma and not a space before it            8
 *   a form may be anywhere                                    1
 *   a form may be at the start                                1
 *   a form need not be a word of its own                      1
 *   "sp. z o.o." is not a legal form                          5
 *   "s.a." is not a legal form                                2
 *   "sp. k. / sp. j." is not a legal form                     1
 *   "inc" is not a legal form                                 4
 *   "ltd" is not a legal form                                 1
 *   "llc" is not a legal form                                 1
 *   "gmbh" is not a legal form                                1
 *   "plc" is not a legal form                                 1
 *   "corp" is not a legal form                                1
 *   "limited" is not a legal form                             1
 *   "ag" is not a legal form                                  1
 *   "b.v." is not a legal form                                1
 *   "sp. z o.o." needs no stop after sp                       5
 *   "sp. z o.o." needs the stop after sp                      1
 *   "sp. z o.o." needs no space before z                      5
 *   "sp. z o.o." needs no space between z and o               5
 *   "sp. z o.o." needs no stop between its o                  5
 *   "sp. z o.o." needs no space between its o                 1
 *   "sp. z o.o." needs the stop between its o                 1
 *   "s.a." needs no stop after s                              1
 *   "s.a." needs no space before a                            1
 *   "sp. k." needs no stop after sp                           1
 *   "sp. k." needs no space before k                          1
 *   "sp. k." is not "sp. j."                                  1
 *   "sp. j." is not "sp. k."                                  1
 *   "b.v." needs no stop after b                              1
 *   "b.v." needs no space before v                            1
 *
 * src/contracts/mask.ts:
 *   an employer is not a kind of value                        1
 *   there is a third kind                                     1
 *   the scopes are spelled differently                        4
 *   the scopes are in the other order                         2
 *   the strict scope is called otherwise                      14
 *   the default scope is strict                               9
 *   every value is a scope                                    6
 *   no value is a scope                                       15
 *   a scope is told by its case                               3
 *   a scope is told with its padding                          2
 *   a scope is told by its start                              1
 *   nothing stored is strict                                  7
 *   a stored value that is not known is the default           3
 *   every stored value is strict                              2
 *   every stored value is the default                         10
 *   a known stored value is the other                         8
 *
 * src/capabilities/cv/seeds.ts:
 *   no scope named is strict                                  1
 *   the scope is ignored: always strict                       12
 *   the scope is ignored: never strict                        20
 *   the scope is reversed                                     26
 *   the personal scope adds employers                         0 (equivalent: a scope is one of two, and
 *       what is stored that is not `personal` is read as `strict`, so both conditions pick the same entries)
 *   the universities come before the companies                3
 *   the companies are not seeds                               19
 *   the universities are not seeds                            14
 *   the companies are read from the education                 19
 *   the universities are read from the experience             14
 *   the title is the company                                  20
 *   the degree is the university                              15
 *   the issuer of a certificate is a seed                     2
 *   the thesis is a seed                                      2
 *   a CV employer is a name                                   20
 *   a section that is not a list is read                      5
 *   an entry that is not an object with the field is read     1
 *   an entry with a field of another type is read             1
 *   a bad entry stops the others                              1
 *   only the first entry is read                              4
 *   only the last entry is read                               3
 *   a blank seed is kept                                      1
 *   a padded seed is trimmed                                  1
 *   an unreadable personal section stops the employers        3
 *   no CV is an error                                         2
 *   the CV is read under another id                           21
 *   the personal section is read from elsewhere               18
 *
 * src/providers/environment.ts:
 *   a scope is not validated                                  2
 *   a missing scope is refused                                4
 *   every scope is refused                                    13
 *   a refusal of a scope is the wrong kind                    2
 *   a refusal of a scope names the mode                       1
 *   a refusal of a scope does not say which                   1
 *   a scope is not blanked                                    1
 *   a scope is not kept                                       13
 *   a scope takes the mode                                    11
 *   a mode takes the scope                                    7
 *   a scope is validated as a mode                            14
 *
 * src/storage/sqlite/settings.ts:
 *   the store does not read the scope                         16
 *   the store reads the mode as the scope                     14
 *   the store does not write the scope                        14
 *   the store writes the mode as the scope                    12
 *   the store writes the scope as the mode                    7
 *   the store swaps the mode and the scope                    13
 *   the store writes the scope into the mode column           13
 *   the store does not put the scope in its statement         14
 *
 * src/storage/sqlite/migrations/0047-mask-scope.ts:
 *   the column has another name                               24
 *   the column defaults to strict                             11
 *   the column defaults to personal                           6
 *   the column is required                                    12
 *
 * src/storage/sqlite/migrate.ts:
 *   the migration is not listed                               24
 *   the migration is listed under another version             1
 *   the migration is the one before                           35
 *
 * src/adapters/ipc/channels.ts:
 *   the channel takes a scope only when set                   3
 *   the channel takes a scope only when named                 1
 *   the channel takes any text as a scope                     1
 *   the channel takes a mode as a scope                       11
 *   the channel does not take a scope                         11
 *
 * src/adapters/ipc/dispatch.ts:
 *   a save that names no scope clears it                      1
 *   a save keeps the scope when it is cleared                 3
 *   a save never changes the scope                            11
 *   a save keeps the mode as the scope                        1
 *   a save never keeps the scope                              1
 *   a save that sets the scope clears the mode                4
 *   the feature is not reported                               1
 *   the feature is reported twice                             1
 *   the feature is spelled differently                        1
 *   the feature replaces the embedding one                    1
 *
 * src/runtime/run.ts:
 *   a run with no scope named is strict                       1
 *   a run never asks for the scope                            12
 *   a run is always strict                                    9
 *   a run reads the scope at each call                        3
 *   a run asks the scope at each call and once                1
 *   a run seeds without the scope                             11
 *   a run reads the seeds without the scope                   11
 *   a run is strict when the scope is personal                15
 *   a run asks the scope before the mode                      1
 *   a run does not mask an employer in discovery by failing   1
 *
 * src/runtime/create.ts:
 *   the embedder seeds without the scope                      4
 *   the embedder is always strict                             2
 *   the embedder is always personal                           4
 *   the embedder takes what is stored without reading it      1
 *   the embedder takes the mode as the scope                  3
 *   the embedder reads the scope once, when it is built       4
 *   the runtime is given no scope                             5
 *   the runtime is given the default scope                    5
 *   the runtime is given strict                               4
 *   the runtime is given what is stored without reading it    1
 *   the runtime is given the mode as the scope                4
 *   the runtime reads the scope once, when it is built        5
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response as Reply } from '../src/adapters/ipc/channels.js';
import { CV_ID, CV_KIND, cvDocumentSchema } from '../src/capabilities/cv/document.js';
import { cvSeeds } from '../src/capabilities/cv/seeds.js';
import {
  OperationError,
  defaultMaskScope,
  isMaskScope,
  maskScopeOf,
  maskScopes,
  maskSeedKinds
} from '../src/contracts/index.js';
import type { AiGateway, CapabilityMap, ChunkHit, MaskMode, MaskScope, MaskSeed, Settings } from '../src/contracts/index.js';
import { createVault } from '../src/effects/mask.js';
import { bindDiscoveryScope } from '../src/runtime/discovery-scope.js';
import { createHarness, silentLogger, type Harness } from '../src/runtime/create.js';
import { beginRun, buildRunContext, scopedDeps } from '../src/runtime/run.js';
import type { RuntimeDeps } from '../src/runtime/run.js';
import { open } from '../src/storage/sqlite/open.js';
import { createSettingsStore } from '../src/storage/sqlite/settings.js';
import { latestVersion, migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { CHAT, CHAT_RUN, CONTEXT, chat, cv, job, ref, settle } from './support/chat.js';
import type { Chat } from './support/chat.js';
import { noop, stage, transform } from './support/spine.js';

const ACME = 'Acme Sp. z o.o.';
const UNI = 'Politechnika Warszawska';

const orgs: readonly MaskSeed[] = [
  { kind: 'org', value: ACME },
  { kind: 'org', value: UNI }
];

const masked = (text: string, seeds: readonly MaskSeed[] = orgs): string => createVault(seeds).mask(text);
const org = (value: string): MaskSeed => ({ kind: 'org', value });

/* ----------------------------------------------------------------------- engine */

test('an employer and a school are each one value, replaced whole and put back as they were written', () => {
  const vault = createVault(orgs);
  const text = `I worked at ${ACME} and studied at ${UNI}.`;

  const out = vault.mask(text);
  // The stop after "o.o" is the end of the sentence as much as of the name, and stays.
  assert.equal(out, 'I worked at [ORG_1]. and studied at [ORG_2].');
  assert.equal(vault.restore(out), text);
});

test('a word of an employer or a school by itself is not one, and neither is a legal form', () => {
  assert.equal(masked('Politechnika is a word, and so is Warszawska.'), 'Politechnika is a word, and so is Warszawska.');
  assert.equal(masked('Beta Sp. z o.o. is another firm.'), 'Beta Sp. z o.o. is another firm.');
  assert.equal(masked('Sp. z o.o.'), 'Sp. z o.o.');
});

test('case and accents are not what tells an employer from a word', () => {
  const seeds = [org('Akademia Górniczo-Hutnicza')];
  assert.equal(masked('Akademia Górniczo-Hutnicza', seeds), '[ORG_1]');
  assert.equal(masked('akademia gorniczo-hutnicza', seeds), '[ORG_1]');
  assert.equal(masked('AKADEMIA GÓRNICZO-HUTNICZA', seeds), '[ORG_1]');
});

test('the company without its legal form is the company, as it is said', () => {
  for (const value of [
    'Acme Sp. z o.o.',
    'Acme sp. z o. o.',
    'Acme Sp. z o.o',
    'Acme Sp.z o.o.',
    'Acme Sp z o.o.',
    'Acme Sp. z oo',
    'Acme Sp z oo',
    'Acme SP. Z O. O.',
    'Acme Sp. k.',
    'Acme S. A.',
    'Acme B. V.',
    'Acme S.A.',
    'Acme SA',
    'Acme Sp.k.',
    'Acme sp. j.',
    'Acme Inc.',
    'Acme Inc',
    'Acme, Inc.',
    'Acme Ltd',
    'Acme LTD.',
    'Acme Limited',
    'Acme LLC',
    'Acme GmbH',
    'Acme PLC',
    'Acme Corp.',
    'Acme AG',
    'Acme B.V.',
    'Acme BV'
  ]) {
    assert.equal(masked('We met Acme today.', [org(value)]), 'We met [ORG_1] today.', `${value}: said without it`);
    assert.equal(masked(`We met ${value} today.`, [org(value)]).includes('Acme'), false, `${value}: said as written`);
  }
});

test('the whole name is used before the short one, and the two are different surfaces', () => {
  const vault = createVault([org('Acme Sp. z o.o.')]);

  assert.equal(vault.mask('Acme Sp. z o.o. and Acme'), '[ORG_1]. and [ORG_2]');
  assert.equal(vault.restore('[ORG_1] and [ORG_2]'), 'Acme Sp. z o.o and Acme');
});

test('only the end of a name is a legal form, and only once', () => {
  assert.equal(masked('Systems and Inc', [org('Inc Systems')]), 'Systems and Inc', 'a form at the front is a word of the name');
  assert.equal(masked('Inc Systems', [org('Inc Systems')]), '[ORG_1]');
  assert.equal(masked('Acme Ltd and Acme', [org('Acme Ltd Inc')]), '[ORG_1] and Acme', 'one form is taken off, not two');
  assert.equal(masked('Acme Ltd Inc', [org('Acme Ltd Inc')]), '[ORG_1]');
  assert.equal(masked('Acme Systems and Acme', [org('Acme Ltd Systems')]), 'Acme Systems and Acme', 'a form in the middle is a word of the name');
  assert.equal(masked('Acme Ltd Systems', [org('Acme Ltd Systems')]), '[ORG_1]');
  assert.equal(masked('Costa and Cost', [org('Cost Sa')]), 'Costa and [ORG_1]', 'Costa is another word');
  assert.equal(masked('Globex and Globexsa', [org('Globexsa')]), 'Globex and [ORG_1]', 'a form is a word of its own at the end');
});

test('what is left once the form is off has to be long enough to be a name', () => {
  assert.equal(masked('Ab and Abc', [org('Ab Inc')]), 'Ab and Abc', 'two letters are not a company');
  assert.equal(masked('Ab Inc', [org('Ab Inc')]), '[ORG_1]');
  assert.equal(masked('Ab and Abc', [org('Abc Inc')]), 'Ab and [ORG_1]', 'three are');
  assert.equal(masked('IBM and Ab', [org('IBM')]), '[ORG_1] and Ab', 'three letters, with no form to take off, are');
  assert.equal(masked('Ab and Abc', [org('Ab')]), 'Ab and Abc', 'two, with no form, are not');
});

test('a value of fewer than three characters is no value, with or without its punctuation', () => {
  assert.equal(masked('Go to AB', [org('AB')]), 'Go to AB');
  assert.equal(masked('Go to ABC', [org('ABC')]), 'Go to [ORG_1]');
  assert.equal(masked('Go to AB', [org('(AB)')]), 'Go to AB', 'the brackets are not part of the name, and what is left is two letters');
  assert.equal(masked('Go to (ABC)', [org('(ABC)')]), 'Go to ([ORG_1])');
  assert.equal(masked('Go to ABC', [org('  ABC.  ')]), 'Go to [ORG_1]');
  assert.equal(masked('Go to ABC', [org('--ABC--')]), 'Go to [ORG_1]', 'a run of marks goes, not one');
  assert.equal(masked('Go to (ABC)', [org('((ABC))')]), 'Go to ([ORG_1])', 'at both ends');
});

test('a name that begins or ends with a digit keeps it', () => {
  assert.equal(masked('Work at 3M Poland.', [org('3M Poland')]), 'Work at [ORG_1].');
  assert.equal(masked('Work at 3 Poland.', [org('3M Poland')]), 'Work at 3 Poland.');
  assert.equal(masked('Work at Studio 54 and Studio.', [org('Studio 54')]), 'Work at [ORG_1] and Studio.');
});

test('a name written with a double space is the name with one', () => {
  assert.equal(masked('At Politechnika Warszawska.', [org('Politechnika  Warszawska')]), 'At [ORG_1].');
});

test('only a whole word is a name: nothing of a letter or a digit on either side', () => {
  const seeds = [org('Acme')];

  assert.equal(masked('Acmeville', seeds), 'Acmeville');
  assert.equal(masked('MegaAcme', seeds), 'MegaAcme');
  assert.equal(masked('Acme2', seeds), 'Acme2');
  assert.equal(masked('2Acme', seeds), '2Acme');
  assert.equal(masked('Acme-based, (Acme), "Acme" and Acme.', seeds), '[ORG_1]-based, ([ORG_1]), "[ORG_1]" and [ORG_1].');
});

test('the words of a name are separated by any run of white space', () => {
  const seeds = [org(UNI)];

  assert.equal(masked('Politechnika   Warszawska', seeds), '[ORG_1]');
  assert.equal(masked('Politechnika\nWarszawska', seeds), '[ORG_1]');
  assert.equal(masked('Politechnika Warszawska', seeds), '[ORG_1]');
  assert.equal(masked('PolitechnikaWarszawska', seeds), 'PolitechnikaWarszawska');
});

test('what a name is spelled with is spelled, and is never a pattern', () => {
  assert.equal(masked('Allegro.pl and Allegroxpl', [org('Allegro.pl')]), '[ORG_1] and Allegroxpl');
  assert.equal(masked('AT&T and AT and T', [org('AT&T Inc')]), '[ORG_1] and AT and T');
  assert.equal(masked('Aaa (Bbb) Ccc and Aaa Bbb Ccc', [org('Aaa (Bbb) Ccc')]), '[ORG_1] and Aaa Bbb Ccc');
  assert.equal(masked('Aaa (Bbb) and Aaa Bbb', [org('Aaa (Bbb)')]), '[ORG_1]) and Aaa Bbb', 'the end of a name that is not a letter is not part of it');
  assert.equal(masked('a+b and aab', [org('a+b')]), '[ORG_1] and aab');
});

test('the longest of two values that begin together is used, whoever they are', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'name', value: 'Anna Kowalska' }, org('Anna Kowalska Consulting Sp. z o.o.')];
  const vault = createVault(seeds);

  assert.equal(vault.mask('Anna Kowalska Consulting Sp. z o.o. hired Anna Kowalska.'), '[ORG_1]. hired [NAME_1].');
  assert.equal(vault.mask('Anna Kowalska Consulting hired Anna Kowalska.'), '[ORG_2] hired [NAME_1].');
});

test('each employer has its own number, the same one the same, and each kind counts for itself', () => {
  const vault = createVault([...orgs, { kind: 'name', value: 'Anna Kowalska' }, org('Globex')]);
  const out = vault.mask('Acme, Globex, Acme, Anna Kowalska, Politechnika Warszawska and Globex.');

  assert.equal(out, '[ORG_1], [ORG_2], [ORG_1], [NAME_1], [ORG_3] and [ORG_2].');
  assert.equal(vault.restore(out), 'Acme, Globex, Acme, Anna Kowalska, Politechnika Warszawska and Globex.');
});

test('a placeholder for an employer is put right as the models write it, and in a stream', () => {
  const vault = createVault(orgs);
  vault.mask(`${ACME} and ${UNI}`);

  assert.equal(vault.restore('[org_1], [ORG\\_2] and [ ORG 1 ]'), 'Acme Sp. z o.o, Politechnika Warszawska and Acme Sp. z o.o');

  const out: string[] = [];
  const stream = vault.restorer((text) => out.push(text));
  for (const fragment of ['At [O', 'RG', '_1], and ', '[ORG_2', '] too, [OR']) stream.push(fragment);
  stream.end();
  assert.equal(out.join(''), 'At Acme Sp. z o.o, and Politechnika Warszawska too, [OR');
});

test('text that already spells a placeholder is not mistaken for one issued', () => {
  const vault = createVault([org('Acme')]);

  assert.equal(vault.mask('[ORG_1] then Acme'), '[ORG_1] then [ORG_2]');
  assert.equal(vault.restore('[ORG_1] then [ORG_2]'), '[ORG_1] then Acme');
});

test('an employer is a kind of value a CV can give', () => {
  assert.ok((maskSeedKinds as readonly string[]).includes('org'));
  assert.equal(maskSeedKinds.length, 6);
});

/* -------------------------------------------------------------------- the scope */

test('there are two scopes, spelled as this release spells them, and the default is the narrower', () => {
  assert.deepEqual([...maskScopes], ['personal', 'strict']);
  assert.equal(defaultMaskScope, 'personal');
  assert.equal(isMaskScope('personal'), true);
  assert.equal(isMaskScope('strict'), true);

  for (const other of ['Strict', 'PERSONAL', ' strict', '', 'wide', 'always', undefined, null, 1]) {
    assert.equal(isMaskScope(other), false, String(other));
  }
});

test('nothing stored is the default, and a value that is not known is the wider scope', () => {
  assert.equal(maskScopeOf(undefined), 'personal');
  assert.equal(maskScopeOf('personal'), 'personal');
  assert.equal(maskScopeOf('strict'), 'strict');

  for (const unknown of ['', 'Personal', 'a-scope-from-a-later-release', ' strict']) {
    assert.equal(maskScopeOf(unknown), 'strict', JSON.stringify(unknown));
  }
});

/* ------------------------------------------------------------------------ seeds */

type Body = Record<string, unknown>;

const store = (body: Body | undefined): Parameters<typeof cvSeeds>[0] =>
  ({ read: () => (body === undefined ? undefined : { body }) }) as unknown as Parameters<typeof cvSeeds>[0];

const personal = { name: 'Ada Example', email: 'ada@example.com', phone: '+44 7700 900123', location: 'Krakow', links: {} };

const document: Body = {
  personal,
  experience: [
    { company: 'Acme Sp. z o.o.', title: 'Engineer' },
    { company: 'Globex', title: 'Lead' }
  ],
  education: [{ university: 'Politechnika Warszawska', degree: 'MSc', thesis: 'Billing' }],
  certificates: [{ name: 'Cloud', issuer: 'Coursera' }]
};

const values = (seeds: readonly MaskSeed[]): string[] => seeds.map((seed) => `${seed.kind}:${seed.value}`);

const PERSONAL = ['name:Ada Example', 'email:ada@example.com', 'phone:+44 7700 900123'];

test('the personal scope gives what identifies the person, and it is what is given when no scope is named', () => {
  assert.deepEqual(values(cvSeeds(store(document))), PERSONAL);
  assert.deepEqual(values(cvSeeds(store(document), 'personal')), PERSONAL);
});

test('the strict scope adds each company and each university, in the order of the CV, and nothing else of the entries', () => {
  assert.deepEqual(values(cvSeeds(store(document), 'strict')), [
    ...PERSONAL,
    'org:Acme Sp. z o.o.',
    'org:Globex',
    'org:Politechnika Warszawska'
  ]);
});

test('an entry is read on its own, and one that cannot be read costs only itself', () => {
  const body: Body = {
    personal,
    experience: [{ company: 'Acme' }, { title: 'No company' }, { company: 7 }, null, 'Acme again', { company: 'Globex' }],
    education: [{ degree: 'MSc' }, { university: 'Politechnika Warszawska' }, ['Politechnika Gdańska']]
  };

  assert.deepEqual(values(cvSeeds(store(body), 'strict')).slice(PERSONAL.length), [
    'org:Acme',
    'org:Globex',
    'org:Politechnika Warszawska'
  ]);
});

test('a section that is not a list gives nothing, and does not stop the other', () => {
  const body: Body = { personal, experience: 'Acme', education: { university: 'Politechnika Warszawska' } };
  assert.deepEqual(values(cvSeeds(store(body), 'strict')), PERSONAL);

  const other: Body = { personal, experience: { company: 'Acme' }, education: [{ university: 'Politechnika Warszawska' }] };
  assert.deepEqual(values(cvSeeds(store(other), 'strict')), [...PERSONAL, 'org:Politechnika Warszawska']);
});

test('a blank company is no seed, and what is written is what is given', () => {
  const body: Body = { personal, experience: [{ company: '   ' }, { company: '' }, { company: ' Globex ' }] };
  assert.deepEqual(values(cvSeeds(store(body), 'strict')).slice(PERSONAL.length), ['org: Globex ']);
});

test('a CV whose personal section cannot be read still gives its employers in the strict scope, and nothing in the other', () => {
  const body: Body = { personal: 5, experience: [{ company: 'Acme' }], education: [{ university: 'Politechnika Warszawska' }] };

  assert.deepEqual(values(cvSeeds(store(body), 'personal')), []);
  assert.deepEqual(values(cvSeeds(store(body), 'strict')), ['org:Acme', 'org:Politechnika Warszawska']);
  assert.deepEqual(values(cvSeeds(store({ experience: [{ company: 'Acme' }] }), 'strict')), ['org:Acme']);
});

test('no CV gives nothing, in either scope', () => {
  assert.deepEqual(cvSeeds(store(undefined), 'personal'), []);
  assert.deepEqual(cvSeeds(store(undefined), 'strict'), []);
  assert.deepEqual(cvSeeds(store({}), 'strict'), []);
});

test('the place, the title, the degree, the thesis and the issuer of a certificate are not seeds', () => {
  const seeds = values(cvSeeds(store(document), 'strict')).join('|');

  for (const kept of ['Krakow', 'Engineer', 'Lead', 'MSc', 'Billing', 'Coursera', 'Cloud']) {
    assert.equal(seeds.includes(kept), false, kept);
  }
});

/* ----------------------------------------------------------------------- in a run */

const body = {
  ...cv([job(ACME, 'Senior Engineer', 'Rewrote the billing pipeline.')]),
  personal,
  education: [{ university: UNI, degree: 'MSc', started: '2015', finished: null, thesis: '', mark: '' }]
};

const ASKED = `Did Ada Example work at ${ACME} and study at ${UNI}?`;

const rig = (answer?: () => string): Chat => chat({ body, ...(answer ? { answer } : {}) });

const maskedBy = (
  c: Chat,
  mode: () => MaskMode,
  scope: (() => MaskScope) | undefined,
  providerId = 'openrouter'
): RuntimeDeps => ({
  ...c.deps,
  masking: scope === undefined ? { mode } : { mode, scope },
  effects: {
    ...c.deps.effects,
    ai: { ...c.deps.effects.ai, describe: () => ({ providerId, modelId: 'a-model' }) } as AiGateway
  }
});

const ask = async (deps: RuntimeDeps, question = ASKED) => {
  const run = beginRun(deps, { capability: 'ask_profile', input: { question }, ...CHAT_RUN });
  await run.settled;
  return run;
};

const told = (c: Chat, from = 0): { acme: boolean; school: boolean; name: boolean; org: boolean } => {
  const texts = c.requests.slice(from).flatMap((request) => [request.system, request.prompt, ...request.history]);

  return {
    acme: texts.some((text) => text.includes('Acme')),
    school: texts.some((text) => text.includes('Politechnika')),
    name: texts.some((text) => text.includes('Ada Example')),
    org: texts.some((text) => /\[ORG_\d\]/.test(text))
  };
};

const fields = () => ({
  runId: 'r',
  traceId: 't',
  contextId: CONTEXT,
  conversationId: CHAT,
  capability: 'ask_profile',
  input: {},
  signal: new AbortController().signal,
  deadlineAt: 0
});

const contextOf = (deps: RuntimeDeps) => buildRunContext(scopedDeps(deps, CONTEXT, CHAT), fields() as never);

test('under strict a hosted model is told neither the employer nor the school, nor who the person is', async () => {
  const c = rig();

  try {
    await ask(maskedBy(c, () => 'hosted', () => 'strict'));

    assert.ok(c.requests.length >= 2);
    assert.deepEqual(told(c), { acme: false, school: false, name: false, org: true });
  } finally {
    c.dispose();
  }
});

test('under the personal scope the same model is told them, and who the person is is still kept', async () => {
  const c = rig();

  try {
    await ask(maskedBy(c, () => 'hosted', () => 'personal'));

    assert.deepEqual(told(c), { acme: true, school: true, name: false, org: false });
  } finally {
    c.dispose();
  }
});

test('a host that names no scope is held to the personal one', async () => {
  const c = rig();

  try {
    await ask(maskedBy(c, () => 'hosted', undefined));

    assert.deepEqual(told(c), { acme: true, school: true, name: false, org: false });
  } finally {
    c.dispose();
  }
});

test('the scope decides which values, and the mode decides which calls: a model on this machine is not masked by it', async () => {
  const c = rig();

  try {
    await ask(maskedBy(c, () => 'hosted', () => 'strict', 'local'));
    assert.deepEqual(told(c), { acme: true, school: true, name: true, org: false });

    const first = c.requests.length;
    await ask(maskedBy(c, () => 'always', () => 'strict', 'local'));
    assert.deepEqual(told(c, first), { acme: false, school: false, name: false, org: true });
  } finally {
    c.dispose();
  }
});

test('the answer is in the person’s words, as they wrote the employer', async () => {
  const c = rig(() => 'You worked at [ORG_1] and studied at [ORG_2], [NAME_1].');

  try {
    const run = await ask(maskedBy(c, () => 'hosted', () => 'strict'));
    const { data } = await settle(run);

    assert.match(JSON.stringify(data), /You worked at Acme Sp\. z o\.o and studied at Politechnika Warszawska, Ada Example\./);
    assert.doesNotMatch(JSON.stringify(data), /\[(ORG|NAME)_\d\]/);
  } finally {
    c.dispose();
  }
});

test('the scope is asked for each run, once and not for each call it makes, and not before it', async () => {
  const c = rig();
  const asked: string[] = [];
  let scope: MaskScope = 'personal';

  try {
    const deps = maskedBy(c, () => 'hosted', () => {
      asked.push(scope);
      return scope;
    });

    assert.equal(asked.length, 0, 'not when the runtime is built');

    await ask(deps);
    assert.equal(asked.length, 1);
    assert.ok(c.requests.length >= 2);

    scope = 'strict';
    await ask(deps);
    assert.deepEqual(asked, ['personal', 'strict']);
  } finally {
    c.dispose();
  }
});

test('a change of scope between two messages is in force on the second', async () => {
  const c = rig();
  let scope: MaskScope = 'personal';

  try {
    const deps = maskedBy(c, () => 'hosted', () => scope);

    await ask(deps);
    const first = c.requests.length;
    assert.equal(told(c).acme, true);

    scope = 'strict';
    await ask(deps);
    assert.deepEqual(told(c, first), { acme: false, school: false, name: false, org: true });
  } finally {
    c.dispose();
  }
});

test('a run is held to the scope it began with, whatever is set while it runs', async () => {
  const c = rig();
  let scope: MaskScope = 'personal';

  try {
    const context = contextOf(maskedBy(c, () => 'always', () => scope));
    const say = (prompt: string) =>
      context.effects.ai.generateText({ traceId: 't', signal: new AbortController().signal, system: 's', prompt, maxOutputTokens: 10 });

    await say(`At ${ACME}.`);
    scope = 'strict';
    await say(`At ${ACME}.`);

    assert.equal(c.requests.at(-2)!.prompt, `At ${ACME}.`);
    assert.equal(c.requests.at(-1)!.prompt, `At ${ACME}.`, 'the second call of the same run');
  } finally {
    c.dispose();
  }
});

test('the employers are read from the stored CV, and not from what a message is allowed to see', async () => {
  const c = rig();

  try {
    c.exclude(ref('experience/acme~senior-engineer'));
    assert.ok(c.selections.walls(CHAT).length > 0, 'the piece is left out of what the model reads');

    const context = contextOf(maskedBy(c, () => 'always', () => 'strict', 'local'));
    await context.effects.ai.generateText({ traceId: 't', signal: new AbortController().signal, system: 's', prompt: `At ${ACME}`, maxOutputTokens: 10 });

    assert.equal(c.requests.at(-1)!.prompt, 'At [ORG_1].');
  } finally {
    c.dispose();
  }
});

test('what is kept is what the CV says now: an employer added after the run began is kept at the next call', async () => {
  const c = rig();

  try {
    const context = contextOf(maskedBy(c, () => 'always', () => 'strict', 'local'));
    const say = () =>
      context.effects.ai.generateText({ traceId: 't', signal: new AbortController().signal, system: 's', prompt: 'At Initech and Acme.', maxOutputTokens: 10 });

    await say();
    assert.equal(c.requests.at(-1)!.prompt, 'At Initech and [ORG_1].');

    c.deps.documents.update(CONTEXT, CV_KIND, (current) => ({
      ...(current as Record<string, unknown>),
      experience: [...((current as { experience: unknown[] }).experience ?? []), { company: 'Initech', title: 'Dev', started: '2020', finished: null, highlights: [], skills: [] }]
    }) as never);
    await say();
    assert.equal(c.requests.at(-1)!.prompt, 'At [ORG_1] and [ORG_2].');
  } finally {
    c.dispose();
  }
});

test('discovery, which may not read the CV, has no employer to keep and is not refused for it', async () => {
  const c = rig();

  try {
    const deps = bindDiscoveryScope(maskedBy(c, () => 'always', () => 'strict'));
    const context = buildRunContext(deps, { ...fields(), contextId: undefined, conversationId: undefined } as never);

    assert.throws(() => deps.documents.read('cv'), (error: unknown) => error instanceof OperationError && error.code === 'search_scope');

    await context.effects.ai.generateText({ traceId: 't', signal: new AbortController().signal, system: 's', prompt: `Is ${ACME} hiring?`, maxOutputTokens: 10 });
    assert.equal(c.requests.at(-1)!.prompt, `Is ${ACME} hiring?`);
  } finally {
    c.dispose();
  }
});

/* ---------------------------------------------------------------------- harness */

type Wire = { readonly url: string; readonly body: string };
type Dispatch = ReturnType<typeof createDispatch>;

const completion = (text: string): Response =>
  new Response(
    JSON.stringify({
      id: 'cmpl',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

const vectors = (request: Wire): Response => {
  const inputs = (JSON.parse(request.body) as { input?: unknown[] }).input ?? [];
  return new Response(
    JSON.stringify({
      object: 'list',
      data: inputs.map((_, index) => ({ object: 'embedding', index, embedding: [3, 4] })),
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 3, total_tokens: 3 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

/** The network, for as long as `run` takes: every request is kept and answered, with vectors or with a sentence. */
const onTheWire = async (run: (wire: Wire[]) => Promise<void>, reply = 'Dear [NAME_1].'): Promise<void> => {
  const wire: Wire[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }): Promise<Response> => {
    const request: Wire = {
      url: typeof input === 'string' ? input : ((input as { url?: string }).url ?? String(input)),
      body: typeof init?.body === 'string' ? init.body : ''
    };
    wire.push(request);
    return /\/embeddings/.test(request.url) ? vectors(request) : completion(reply);
  }) as typeof globalThis.fetch;

  try {
    await run(wire);
  } finally {
    globalThis.fetch = real;
  }
};

const QUESTION = `Write to Ada Example at ada@example.com about the job at ${ACME} and the degree from ${UNI}.`;

const hits: ChunkHit[][] = [];
const query = `${ACME} billing`;
let between: () => void = () => undefined;

const capabilities: CapabilityMap = {
  probe: noop('probe', [
    stage('ask', [
      transform('ask', async (context) => {
        const { text } = await context.effects.ai.generateText({
          traceId: context.traceId,
          signal: context.signal,
          system: 'You help.',
          prompt: QUESTION,
          maxOutputTokens: 20,
          maxRetries: 0
        });
        return { text };
      })
    ])
  ]),
  twice: noop('twice', [
    stage('first', [
      transform('first', async (context) => {
        await context.effects.ai.generateText({ traceId: context.traceId, signal: context.signal, system: 'You help.', prompt: QUESTION, maxOutputTokens: 20, maxRetries: 0 });
        between();
        return {};
      })
    ]),
    stage('second', [
      transform('second', async (context) => {
        await context.effects.ai.generateText({ traceId: context.traceId, signal: context.signal, system: 'You help.', prompt: QUESTION, maxOutputTokens: 20, maxRetries: 0 });
        return {};
      })
    ])
  ]),
  search: noop('search', [
    stage('search', [
      transform('search', async (context) => {
        hits.push(await context.retrieval.search({ text: query, limit: 3 }, context.signal));
        return {};
      })
    ])
  ])
};

type Bench = {
  readonly harness: Harness;
  readonly dispatch: Dispatch;
  readonly path: string;
  restart(env?: Readonly<Record<string, string>>): Bench;
  dispose(): void;
};

const bench = (options: { env?: Readonly<Record<string, string>>; on?: string; indexRecovery?: boolean } = {}): Bench => {
  const dir = options.on ?? mkdtempSync(join(tmpdir(), 'harness-strict-'));
  const path = join(dir, 'harness.db');
  const harness = createHarness({
    databasePath: path,
    capabilities,
    logger: silentLogger,
    env: options.env ?? {},
    ...(options.indexRecovery ? { indexRecovery: true } : {}),
    probe: () => Promise.reject(new Error('connection refused'))
  });
  // What Studio says when it connects. Until it is said, a rebuild that would be
  // masked waits (`masking-terms.test.ts`).
  harness.maskTerms.set([]);

  return {
    harness,
    dispatch: createDispatch(harness),
    path,
    restart(env) {
      harness.close();
      return bench({ on: dir, ...(env ? { env } : options.env ? { env: options.env } : {}) });
    },
    dispose() {
      try {
        harness.close();
      } catch {
        // Closed by `restart`.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

const data = <T>(response: Reply): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const failure = (response: Reply): { code: string; message: string } => {
  assert.ok(!response.ok, `expected a failure, got ${JSON.stringify(response)}`);
  return response.error;
};

const scopeOf = (it: Bench): string | undefined => it.harness.settings.read().maskScope;
const modeOf = (it: Bench): string | undefined => it.harness.settings.read().maskMode;

const set = (it: Bench, settings: Record<string, unknown>) => it.dispatch('settings.set', { settings } as never);

/* ----------------------------------------------------------------------- stored */

const columns = (db: ReturnType<typeof open>): string[] =>
  (db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]).map((column) => column.name);

test('a fresh file has the column, and it is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-strict-fresh-'));
  const db = open(join(dir, 'harness.db'));

  try {
    assert.equal(migrate(db), latestVersion);
    assert.ok(latestVersion >= 47);
    assert.ok(columns(db).includes('mask_scope'));
    assert.equal((db.prepare('SELECT mask_scope FROM settings WHERE id = 1').get() as { mask_scope: unknown }).mask_scope, null);
    assert.equal(createSettingsStore(db).read().maskScope, undefined);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file from before the setting is carried over with what it held, the mode included, and nothing in its place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-strict-old-'));
  const db = open(join(dir, 'harness.db'));

  try {
    migrate(db, migrations.filter((each) => each.version <= 46));
    assert.equal(columns(db).includes('mask_scope'), false, 'before');

    db.prepare("UPDATE settings SET provider_id = 'openai', model_id = 'gpt-4o-mini', mask_mode = 'always' WHERE id = 1").run();
    assert.equal(migrate(db), latestVersion);
    // One after the other, none skipped: the next migration is numbered from the last.
    assert.deepEqual(
      migrations.map((each) => each.version),
      migrations.map((_, index) => index + 1)
    );

    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, unknown>;
    assert.equal(row.provider_id, 'openai');
    assert.equal(row.model_id, 'gpt-4o-mini');
    assert.equal(row.mask_mode, 'always');
    assert.equal(row.mask_scope, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scope chosen in the app is still chosen after a restart, whatever the shell says', async () => {
  let it = bench();

  try {
    const reply = data<{ settings: Settings }>(await set(it, { maskScope: 'strict' }));
    assert.equal(reply.settings.maskScope, 'strict');

    it = it.restart({ AI_PROVIDER: 'local', MASK_SCOPE: 'personal' });
    assert.equal(scopeOf(it), 'strict');
    assert.equal(data<{ settings: Settings }>(await it.dispatch('settings.get', {})).settings.maskScope, 'strict');
  } finally {
    it.dispose();
  }
});

test('the scope is not a setting of the environment, and says nothing of which model is reached', async () => {
  const it = bench({ env: { AI_PROVIDER: 'openai', AI_MODEL: 'gpt-4o' } });

  try {
    await set(it, { maskScope: 'strict' });
    const status = data<{ providerId: string; modelId: string }>(await it.dispatch('providers.status', {}));
    assert.equal(status.providerId, 'openai');
    assert.equal(status.modelId, 'gpt-4o');
  } finally {
    it.dispose();
  }
});

/* ---------------------------------------------------------------------- written */

test('a scope is changed to the other, and back to the default with null', async () => {
  const it = bench();

  try {
    assert.equal(scopeOf(it), undefined);
    assert.equal(data<{ settings: Settings }>(await set(it, { maskScope: 'strict' })).settings.maskScope, 'strict');
    assert.equal(data<{ settings: Settings }>(await set(it, { maskScope: 'personal' })).settings.maskScope, 'personal');
    assert.equal(data<{ settings: Settings }>(await set(it, { maskScope: 'strict' })).settings.maskScope, 'strict');
    assert.equal(data<{ settings: Settings }>(await set(it, { maskScope: null })).settings.maskScope, undefined);
    assert.equal(scopeOf(it), undefined);
  } finally {
    it.dispose();
  }
});

test('a save that does not name the scope keeps it, as Studio before this one saves, and a save of the scope keeps the mode', async () => {
  const it = bench();

  try {
    await set(it, { maskScope: 'strict', maskMode: 'always' });

    const saved = data<{ settings: Settings }>(await set(it, { providerId: 'openai', modelId: 'gpt-4o' }));
    assert.equal(saved.settings.maskScope, 'strict');
    assert.equal(saved.settings.maskMode, 'always');
    assert.equal(scopeOf(it), 'strict');

    const scoped = data<{ settings: Settings }>(await set(it, { maskScope: 'personal' }));
    assert.equal(scoped.settings.maskScope, 'personal');
    assert.equal(scoped.settings.maskMode, 'always', 'the mode is not the scope');

    const moded = data<{ settings: Settings }>(await set(it, { maskMode: 'hosted' }));
    assert.equal(moded.settings.maskMode, 'hosted');
    assert.equal(moded.settings.maskScope, 'personal', 'and the scope is not the mode');

    await set(it, { maskScope: null });
    assert.equal(modeOf(it), 'hosted', 'clearing the scope leaves the mode');
  } finally {
    it.dispose();
  }
});

test('a scope set alongside the others is stored with them', async () => {
  const it = bench();

  try {
    const reply = data<{ settings: Settings }>(
      await set(it, { providerId: 'openai', modelId: 'gpt-4o', maskMode: 'always', maskScope: 'strict' })
    );
    assert.equal(reply.settings.providerId, 'openai');
    assert.equal(reply.settings.modelId, 'gpt-4o');
    assert.equal(reply.settings.maskMode, 'always');
    assert.equal(reply.settings.maskScope, 'strict');
  } finally {
    it.dispose();
  }
});

test('protocol.get says the runtime keeps employers and schools from a model, once', async () => {
  const it = bench();

  try {
    const { features } = data<{ features: string[] }>(await it.dispatch('protocol.get', {}));
    assert.equal(features.filter((feature) => feature === 'masking-strict').length, 1);
    for (const earlier of ['masking', 'masking-detectors', 'masking-embedding']) assert.ok(features.includes(earlier), earlier);
    assert.equal(new Set(features).size, features.length, 'and every other once');
  } finally {
    it.dispose();
  }
});

/* ---------------------------------------------------------------------- refused */

test('a scope nobody knows is refused at the channel, and what was stored stays', async () => {
  const it = bench();

  try {
    await set(it, { maskScope: 'strict' });

    for (const bad of ['wide', 'off', 'STRICT', '', 'strict ', 7]) {
      const refused = failure(await set(it, { maskScope: bad }));
      assert.equal(refused.code, 'invalid_input', `${JSON.stringify(bad)}`);
      assert.equal(scopeOf(it), 'strict', 'and nothing of it reached the file');
    }
  } finally {
    it.dispose();
  }
});

test('a scope nobody knows is refused by the store too, and the mode that went with it is not stored', () => {
  const it = bench();

  try {
    assert.throws(
      () => it.harness.settings.write({ maskScope: 'wide', maskMode: 'always' }),
      (error: unknown) => (error as { code?: string }).code === 'misconfigured' && /Unknown mask scope "wide"\. Supported: personal, strict\./.test(String(error))
    );
    assert.equal(scopeOf(it), undefined);
    assert.equal(modeOf(it), undefined);
    assert.equal(it.harness.settings.write({ maskScope: 'strict' }).maskScope, 'strict');
    assert.equal(it.harness.settings.write({ maskScope: '  ' }).maskScope, undefined, 'a blank is no value, as with every setting');
    assert.equal(it.harness.settings.write({ maskScope: ' strict ' }).maskScope, 'strict', 'padding is not part of the word');
  } finally {
    it.dispose();
  }
});

test('a scope is spelled as this release spells it, and nothing else is a scope', () => {
  const it = bench();

  try {
    for (const spelled of ['Strict', 'PERSONAL', 'strict,', 'wide', 'always', 'hosted']) {
      assert.throws(
        () => it.harness.settings.write({ maskScope: spelled }),
        (error: unknown) => (error as { code?: string }).code === 'misconfigured',
        spelled
      );
    }
    assert.equal(scopeOf(it), undefined);
  } finally {
    it.dispose();
  }
});

test('the table is never given a blank, whoever writes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-strict-blank-'));
  const db = open(join(dir, 'harness.db'));

  try {
    migrate(db);
    const settings = createSettingsStore(db);

    assert.equal(settings.replace({ maskScope: '   ' }).maskScope, undefined);
    assert.equal((db.prepare('SELECT mask_scope FROM settings WHERE id = 1').get() as { mask_scope: unknown }).mask_scope, null);
    assert.equal(settings.replace({ maskScope: ' strict ' }).maskScope, 'strict');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/* --------------------------------------------------------------------- in force */

const OPENROUTER = { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-not-a-real-key' };

const writeCv = (it: Bench, extra: Record<string, unknown> = {}): void => {
  it.harness.documents.update(CV_ID, CV_KIND, () =>
    cvDocumentSchema.parse({
      personal,
      role_description: `Ada Example (ada@example.com) rewrote the billing pipeline at ${ACME}, after a degree at ${UNI}.`,
      experience: [{ company: ACME, title: 'Engineer', highlights: ['Rewrote the billing pipeline.'] }],
      education: [{ university: UNI, degree: 'MSc' }],
      ...extra
    })
  );
};

const sends = async (it: Bench, capability = 'probe'): Promise<Wire> => {
  let sent: Wire | undefined;

  await onTheWire(async (wire) => {
    await it.harness.run({ capability, input: {} });
    sent = wire.at(-1);
  });

  assert.ok(sent, 'a model was asked');
  return sent;
};

const carries = (wire: Wire): { acme: boolean; school: boolean; name: boolean; org: boolean } => ({
  acme: wire.body.includes('Acme'),
  school: wire.body.includes('Politechnika'),
  name: wire.body.includes('Ada Example'),
  org: /\[ORG_\d\]/.test(wire.body)
});

test('with nothing set a hosted model is told the employer and the school, and not who the person is', async () => {
  const it = bench({ env: OPENROUTER });

  try {
    writeCv(it);
    assert.equal(scopeOf(it), undefined);

    const wire = await sends(it);
    assert.match(wire.url, /openrouter/);
    assert.deepEqual(carries(wire), { acme: true, school: true, name: false, org: false });
  } finally {
    it.dispose();
  }
});

test('a change to strict is in force on the next message, with no restart, and a change back is too', async () => {
  const it = bench({ env: OPENROUTER });

  try {
    writeCv(it);
    assert.deepEqual(carries(await sends(it)), { acme: true, school: true, name: false, org: false }, 'before');

    await set(it, { maskScope: 'strict' });
    assert.deepEqual(carries(await sends(it)), { acme: false, school: false, name: false, org: true }, 'after');

    await set(it, { maskScope: 'personal' });
    assert.deepEqual(carries(await sends(it)), { acme: true, school: true, name: false, org: false }, 'and back');

    await set(it, { maskScope: 'strict' });
    await set(it, { maskScope: null });
    assert.deepEqual(carries(await sends(it)), { acme: true, school: true, name: false, org: false }, 'and to the default');
  } finally {
    it.dispose();
  }
});

test('a scope that is in the file and is not one this release knows keeps the employers too', async () => {
  const it = bench({ env: OPENROUTER });

  try {
    writeCv(it);
    assert.equal(carries(await sends(it)).acme, true, 'with nothing set it is told');

    const db = open(it.path);
    db.prepare("UPDATE settings SET mask_scope = 'a-scope-from-a-later-release' WHERE id = 1").run();
    db.close();

    assert.deepEqual(carries(await sends(it)), { acme: false, school: false, name: false, org: true });
  } finally {
    it.dispose();
  }
});

test('strict does not mask what the mode leaves alone, and always masks it', async () => {
  const it = bench({ env: { AI_PROVIDER: 'local' } });

  try {
    writeCv(it);
    await set(it, { maskScope: 'strict' });
    assert.deepEqual(carries(await sends(it)), { acme: true, school: true, name: true, org: false }, 'a model on this machine, under hosted');

    await set(it, { maskScope: 'strict', maskMode: 'always' });
    assert.deepEqual(carries(await sends(it)), { acme: false, school: false, name: false, org: true }, 'and under always');
  } finally {
    it.dispose();
  }
});

test('the answer to a run is in the person’s words, and the employer is written as the CV writes it', async () => {
  const it = bench({ env: OPENROUTER });

  try {
    writeCv(it);
    await set(it, { maskScope: 'strict' });

    await onTheWire(async () => {
      const result = await it.harness.run({ capability: 'probe', input: {} });
      assert.deepEqual(result.data, { text: 'Dear Ada Example, of Acme Sp. z o.o and Politechnika Warszawska.' });
    }, 'Dear [NAME_1], of [ORG_1] and [ORG_2].');
  } finally {
    it.dispose();
  }
});

test('a run that is in the middle of its calls is held to the scope it began with', async () => {
  const it = bench({ env: OPENROUTER });

  try {
    writeCv(it);
    between = () => void it.harness.settings.write({ ...it.harness.settings.read(), maskScope: 'strict' });

    await onTheWire(async (wire) => {
      await it.harness.run({ capability: 'twice', input: {} });
      const asked = wire.filter((request) => !/\/embeddings/.test(request.url));

      assert.equal(asked.length, 2);
      assert.equal(carries(asked[0]!).acme, true);
      assert.equal(carries(asked[1]!).acme, true, 'the second call of the same run');
    });

    assert.deepEqual(carries(await sends(it)), { acme: false, school: false, name: false, org: true }, 'and the next run is held to the new one');
  } finally {
    between = () => undefined;
    it.dispose();
  }
});

test('a person with no CV has no employer to keep, and is asked what everyone is', async () => {
  const it = bench({ env: OPENROUTER });

  try {
    await set(it, { maskScope: 'strict' });
    const wire = await sends(it);

    assert.deepEqual(carries(wire), { acme: true, school: true, name: true, org: false });
  } finally {
    it.dispose();
  }
});

/* -------------------------------------------------------------------- embedding */

const hostedEmbedder = { AI_PROVIDER: 'local', EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-not-a-real-key' };

const until = async (what: string, done: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(done(), what);
};

const inputsOf = (wire: Wire): string[] => (JSON.parse(wire.body) as { input: string[] }).input;

const indexed = async (it: Bench): Promise<void> => {
  await until('the index holds its chunks', () => it.harness.chunks.lexical({ text: 'billing', limit: 3 }).length > 0);
  await until('and its vectors', () => {
    const summary = it.harness.indexRecovery.indexed(CV_ID);
    return summary.chunks > 0 && !summary.keywordOnly;
  });
};

test('the index is built from placeholders for an employer under strict when its embedder is hosted, and the text kept is the CV’s own', async () => {
  const it = bench({ env: hostedEmbedder, indexRecovery: true });

  try {
    await set(it, { maskScope: 'strict' });

    await onTheWire(async (wire) => {
      writeCv(it);
      await indexed(it);

      const sent = wire.flatMap(inputsOf);
      assert.ok(sent.length > 0, 'the embedder was called');
      assert.equal(sent.some((text) => text.includes('Acme') || text.includes('Politechnika')), false);
      assert.ok(sent.some((text) => /\[ORG_\d\]/.test(text)));

      const [stored] = it.harness.chunks.lexical({ text: 'billing', limit: 3 });
      assert.ok(stored!.text.includes('Acme') || stored!.text.includes('Ada Example'), 'the person reads their own words');
    });
  } finally {
    it.dispose();
  }
});

test('under the personal scope the index is told the employer, as it always was, and the person is kept', async () => {
  const it = bench({ env: hostedEmbedder, indexRecovery: true });

  try {
    await onTheWire(async (wire) => {
      writeCv(it);
      await indexed(it);

      const sent = wire.flatMap(inputsOf);
      assert.equal(sent.some((text) => text.includes('Ada Example') || text.includes('ada@example.com')), false);
      assert.ok(sent.some((text) => text.includes('Acme')));
      assert.equal(sent.some((text) => /\[ORG_\d\]/.test(text)), false);
    });
  } finally {
    it.dispose();
  }
});

test('a question is searched for with the employer as a placeholder under strict, and as it is under the other scope, as the scope is set', async () => {
  const it = bench({ env: hostedEmbedder, indexRecovery: true });

  try {
    await onTheWire(async (wire) => {
      writeCv(it);
      await indexed(it);

      const asked = async (): Promise<string> => {
        const before = wire.length;
        await it.harness.run({ capability: 'search', input: {} });
        return inputsOf(wire[before]!)[0]!;
      };

      assert.equal(await asked(), `${ACME} billing`);
      assert.ok((await set(it, { maskScope: 'strict' })).ok);
      assert.equal(await asked(), '[ORG_1]. billing');
      assert.ok((await set(it, { maskScope: null })).ok);
      assert.equal(await asked(), `${ACME} billing`);
    });
  } finally {
    it.dispose();
  }
});

test('a scope in the file that this release does not know masks an embedding too', async () => {
  const it = bench({ env: hostedEmbedder, indexRecovery: true });

  try {
    await onTheWire(async (wire) => {
      writeCv(it);
      await indexed(it);

      const db = open(it.path);
      db.prepare("UPDATE settings SET mask_scope = 'a-scope-from-a-later-release' WHERE id = 1").run();
      db.close();

      const before = wire.length;
      await it.harness.run({ capability: 'search', input: {} });
      assert.equal(inputsOf(wire[before]!)[0], '[ORG_1]. billing');
    });
  } finally {
    it.dispose();
  }
});

test('an embedder on this machine is sent the employer as it always was, until the person says always', async () => {
  const it = bench({ env: {}, indexRecovery: true });

  try {
    await onTheWire(async (wire) => {
      writeCv(it);
      await indexed(it);

      const asked = async (): Promise<string> => {
        const before = wire.length;
        await it.harness.run({ capability: 'search', input: {} });
        return inputsOf(wire[before]!)[0]!;
      };

      await set(it, { maskScope: 'strict' });
      assert.equal(await asked(), `${ACME} billing`);
      await set(it, { maskScope: 'strict', maskMode: 'always' });
      assert.equal(await asked(), '[ORG_1]. billing');
    });
  } finally {
    it.dispose();
  }
});
