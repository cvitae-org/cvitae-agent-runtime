/**
 * The mask engine: a person's own identifiers out of a text, and back in.
 *
 * It is the part of masking that decides what is a value to keep from a model,
 * and the one place it can be wrong in a way nobody sees: a value it misses is
 * sent, and a value it takes that was not one is lost to the model. The questions,
 * in order:
 *
 *   what is taken     each kind of value, in the spellings a person uses for it,
 *                     as a whole word and never as a piece of another
 *   what is not       a value too short to be one, and a text that has none
 *   placeholders      numbered from 1 inside one vault, the same for the same
 *                     text, and a vault of its own for every call
 *   what comes back   a placeholder put right however a model has written it, and
 *                     a stream of them put right wherever it was cut
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 101 were applied: 98 fail at least one test here, and 3 cannot be told from the original.
 *
 * src/effects/detect.ts:
 *   a NIP needs no label                                                      1
 *   a handle needs no network before it                                       1
 *
 * src/effects/mask.ts:
 *   a vault that does not detect is not empty when it has no seeds            6
 *   a vault detects when it was not asked to                                  14
 *   a vault gives the later span when two begin together                      10
 *   a vault takes a span that begins where another ends                       34
 *   a detected span is counted twice                                          2
 *   a text with a shape in it is returned as it was                           42
 *   a seed of two characters is masked                                        3
 *   a seed of three characters is not masked                                  2
 *   a seed of 301 characters is masked                                        1
 *   a seed of 300 characters is not masked                                    1
 *   a phone number of six digits is masked                                    1
 *   a phone number of seven digits is not masked                              1
 *   a national number of eight digits is masked                               1
 *   a national number of nine digits is not masked                            5
 *   a link of three characters is masked                                      1
 *   a link of four characters is not masked                                   2
 *   ł is not folded                                                           3
 *   Ł is not folded                                                           3
 *   a character that would change the length is folded anyway                 1
 *   an ascii text is not put in lower case                                    14
 *   accents are kept in the folded copy                                       3
 *   a name is taken inside a longer word, at the front                        3
 *   a name is taken inside a longer word, at the back                         3
 *   a name is not taken in the other order                                    2
 *   a name of three parts is taken in the other order too                     1
 *   each word of a name is not taken alone                                    21
 *   a word of two letters is taken alone                                      1
 *   a word of three letters is not taken alone                                2
 *   a hyphenated name is not taken by halves                                  1
 *   a name does not match across any run of whitespace                        1
 *   a name keeps the punctuation around its parts                             1
 *   the whole name is not taken as one                                        20
 *   an email is taken as the tail of a longer address                         2
 *   an email is taken as the head of a longer domain                          1
 *   an email is taken before a sentence's full stop is a domain dot           1
 *   an email is not escaped                                                   1
 *   a phone number is taken inside a longer number                            1
 *   a phone number is not taken with its sign                                 7
 *   a phone number has no separators                                          11
 *   a phone number may not be separated by a dot                              2
 *   a phone number may not be separated by a dash                             2
 *   a phone number may not be separated by parentheses                        1
 *   a 00 prefix is kept in the digits                                         1
 *   a number is not taken without its country code                            5
 *   a number is taken without its country code even when written without one  1
 *   a country code of three digits is not dropped                             1
 *   a country code of four digits is dropped                                  1
 *   a national number is taken inside a longer one                            2
 *   a link needs its scheme                                                   5
 *   a link needs its www                                                      5
 *   a link seed keeps its scheme                                              5
 *   a link seed keeps its www                                                 3
 *   a link seed keeps its trailing slash                                      1
 *   a link with a trailing slash is not taken whole                           2
 *   a link is taken as the tail of a longer one                               1
 *   a link is taken as the head of a longer path                              1
 *   a link is taken inside an email address                                   1
 *   the shorter value is tried first                                          23
 *   patterns are not sorted                                                   7
 *   a value that is too short to keep is kept                                 2
 *   a value with spaces around it is not trimmed                              3
 *   a kind is dropped from a pattern's identity                               0 (equivalent: two seeds of different kinds never compile to the same source)
 *   the matcher is case sensitive in the original too                         33
 *   the same text is given a new placeholder each time                        2
 *   placeholders are numbered across kinds                                    7
 *   the number of a placeholder starts from zero                              50
 *   a placeholder that is taken is issued anyway                              2
 *   a text is not looked at for placeholders when it is masked                1
 *   reserve notes nothing                                                     2
 *   reserve notes a placeholder under its own case                            1
 *   an unknown placeholder is removed                                         3
 *   a placeholder in another case is not put right                            1
 *   a placeholder is not put right when nothing was masked                    0 (equivalent: with nothing issued the replacer finds no value and hands each match back as it was)
 *   a placeholder is not put right                                            14
 *   a placeholder may not be padded                                           3
 *   a placeholder may not have its underscore escaped                         4
 *   a placeholder may not have a space for its underscore                     2
 *   a placeholder may not be written in lower case                            2
 *   a placeholder of two digits is not put right                              1
 *   a placeholder of five digits is put right                                 0 (equivalent: it takes ten thousand placeholders in one call to differ, and a call issues a handful)
 *   a key of an object is not masked                                          1
 *   an array is not walked                                                    1
 *   an object is not walked                                                   2
 *   a class instance is walked as an object                                   1
 *   a vault with seeds is reported empty                                      4
 *   a vault with no seeds is reported not empty                               6
 *   a match is replaced by the folded text                                    14
 *   replaced is not counted                                                   2
 *   a fragment is not held back                                               7
 *   everything after a bracket is held                                        7
 *   a held fragment is longer than a placeholder can be                       1
 *   a held fragment is shorter than a placeholder can be                      2
 *   a held fragment may not be padded                                         3
 *   a held fragment may not have a backslash                                  1
 *   what is held back is lost when the stream ends                            2
 *   what is settled is not put right                                          6
 *   what is held is held again after a flush                                  8
 *   the end of a stream does not clear what it held                           1
 *   an empty fragment is emitted                                              5
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { MaskSeed } from '../src/contracts/index.js';
import {
  createVault,
  fold,
  MAX_SEED_LENGTH,
  MIN_SEED_LENGTH
} from '../src/effects/mask.js';

const anna: readonly MaskSeed[] = [
  { kind: 'name', value: 'Anna Kowalska' },
  { kind: 'email', value: 'anna.kowalska@example.com' },
  { kind: 'phone', value: '+48 600 123 456' },
  { kind: 'link', value: 'https://www.linkedin.com/in/anna-kowalska' }
];

const masked = (text: string, seeds: readonly MaskSeed[] = anna): string => createVault(seeds).mask(text);

/** What a vault makes of a text and what it makes of that, in one. */
const roundTrip = (text: string, seeds: readonly MaskSeed[] = anna): { out: string; back: string } => {
  const vault = createVault(seeds);
  const out = vault.mask(text);
  return { out, back: vault.restore(out) };
};

/** A vault's output for a text, restored from fragments cut at `cuts`. */
const streamed = (
  vault: ReturnType<typeof createVault>,
  text: string,
  cuts: readonly number[]
): { emitted: string[]; whole: string } => {
  const emitted: string[] = [];
  const restorer = vault.restorer((fragment) => emitted.push(fragment));
  let last = 0;
  for (const cut of [...cuts, text.length]) {
    restorer.push(text.slice(last, cut));
    last = cut;
  }
  restorer.end();
  return { emitted, whole: emitted.join('') };
};

/* ------------------------------------------------------------ what is taken */

test('each kind of value becomes a placeholder of its own kind, numbered from one', () => {
  assert.equal(
    masked(
      'I am Anna Kowalska, anna.kowalska@example.com, +48 600 123 456, linkedin.com/in/anna-kowalska.'
    ),
    'I am [NAME_1], [EMAIL_1], [PHONE_1], [LINK_1].'
  );
});

test('a name is taken in capitals, in the other order, and by each of its parts', () => {
  assert.equal(masked('ANNA KOWALSKA'), '[NAME_1]');
  assert.equal(masked('Kowalska Anna'), '[NAME_1]');
  assert.equal(masked('anna kowalska'), '[NAME_1]');
  assert.equal(masked('Anna wrote it'), '[NAME_1] wrote it');
  assert.equal(masked('Mrs Kowalska wrote it'), 'Mrs [NAME_1] wrote it');
});

test('the full name is one placeholder and not one for each part', () => {
  assert.equal(masked('Anna Kowalska'), '[NAME_1]');
  assert.equal(masked('Anna  Kowalska'), '[NAME_1]');
  assert.equal(masked('Anna\nKowalska'), '[NAME_1]');
});

test('a middle name is part of the full name, and each part is taken on its own as well', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'name', value: 'Anna Maria Kowalska' }];
  assert.equal(masked('Anna Maria Kowalska', seeds), '[NAME_1]');
  assert.equal(masked('Maria', seeds), '[NAME_1]');
  assert.equal(masked('Anna Kowalska', seeds), '[NAME_1] [NAME_2]');
});

test('each half of a hyphenated surname is taken on its own as well', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'name', value: 'Anna Nowak-Kowalska' }];
  assert.equal(masked('Anna Nowak-Kowalska', seeds), '[NAME_1]');
  assert.equal(masked('Ms Kowalska', seeds), 'Ms [NAME_1]');
  assert.equal(masked('Ms Nowak', seeds), 'Ms [NAME_1]');
});

test('Polish is taken with its letters and without them, in either case', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'name', value: 'Łukasz Żółć' }];
  assert.equal(masked('Łukasz Żółć', seeds), '[NAME_1]');
  assert.equal(masked('Lukasz Zolc', seeds), '[NAME_1]');
  assert.equal(masked('ŁUKASZ ŻÓŁĆ', seeds), '[NAME_1]');
  assert.equal(masked('lukasz zolc', seeds), '[NAME_1]');
});

test('a seed typed without its letters takes the text that has them', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'name', value: 'Lukasz Zolc' }];
  assert.equal(masked('Łukasz Żółć', seeds), '[NAME_1]');
});

test('folding keeps every character where it was, so what is cut out is what was matched', () => {
  const text = 'Łódź, Żółć, İstanbul, ǅ, 😀 Ünïcödé';
  assert.equal(fold(text).length, text.length);
  assert.equal(fold('ŁÓDŹ'), 'lodz');
  assert.equal(fold('Zażółć'), 'zazolc');
  assert.equal(fold('ASCII'), 'ascii');
  assert.equal(fold(''), '');
});

test('a name is taken as a whole word and never as a piece of one', () => {
  assert.equal(masked('Hanna and Annabelle and Annan'), 'Hanna and Annabelle and Annan');
  assert.equal(masked('Kowalskass'), 'Kowalskass');
  assert.equal(masked('Anna, Anna. Anna! (Anna) "Anna"'), '[NAME_1], [NAME_1]. [NAME_1]! ([NAME_1]) "[NAME_1]"');
});

test('a name next to a digit is not a whole word', () => {
  assert.equal(masked('Anna2 and 2Anna'), 'Anna2 and 2Anna');
});

test('an email is one placeholder, though the name is in it', () => {
  assert.equal(masked('Write to anna.kowalska@example.com.'), 'Write to [EMAIL_1].');
  assert.equal(masked('ANNA.KOWALSKA@EXAMPLE.COM'), '[EMAIL_1]');
});

test('an email is not taken as the tail of a longer address, nor the head of one', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'email', value: 'anna.kowalska@example.com' }];
  assert.equal(masked('xanna.kowalska@example.com', seeds), 'xanna.kowalska@example.com');
  assert.equal(masked('anna.kowalska@example.com.pl', seeds), 'anna.kowalska@example.com.pl');
  assert.equal(masked('anna.kowalska@example.company', seeds), 'anna.kowalska@example.company');
  assert.equal(masked('anna.kowalska@example.com-x', seeds), 'anna.kowalska@example.com-x');
  assert.equal(masked('1anna.kowalska@example.com', seeds), '1anna.kowalska@example.com');
  assert.equal(masked('<anna.kowalska@example.com>;', seeds), '<[EMAIL_1]>;');
  assert.equal(masked('anna.kowalska@example.com. Then', seeds), '[EMAIL_1]. Then');
});

test('another address with the name in it has the name taken and the rest left', () => {
  assert.equal(masked('xanna.kowalska@example.com'), 'xanna.[NAME_1]@example.com');
});

test('a name inside an address that is not the seed is still taken', () => {
  assert.equal(masked('anna@other.org'), '[NAME_1]@other.org');
});

test('a phone number is taken however it is spaced, and with or without its country code', () => {
  const taken = [
    '+48 600 123 456',
    '+48600123456',
    '0048 600-123-456',
    '48 600 123 456',
    '600 123 456',
    '600-123-456',
    '600.123.456',
    '600123456'
  ];

  for (const phone of taken) {
    assert.equal(masked(`call ${phone} now`), 'call [PHONE_1] now', phone);
  }
});

test('a phone number is not taken as a piece of a longer run of digits', () => {
  assert.equal(masked('order 9600123456'), 'order 9600123456');
  assert.equal(masked('id 6001234567'), 'id 6001234567');
  assert.equal(masked('1600 123 4567'), '1600 123 4567');
});

test('a phone seed written with no country code takes the number as it is said', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'phone', value: '600 123 456' }];
  assert.equal(masked('call 600 123 456', seeds), 'call [PHONE_1]');
  assert.equal(masked('call +48 600 123 456', seeds), 'call +48 [PHONE_1]');
});

test('a link is taken with or without its scheme, its www and its closing slash', () => {
  const taken = [
    'https://www.linkedin.com/in/anna-kowalska',
    'http://linkedin.com/in/anna-kowalska/',
    'www.linkedin.com/in/anna-kowalska',
    'linkedin.com/in/anna-kowalska',
    'LinkedIn.com/in/Anna-Kowalska'
  ];

  for (const link of taken) {
    assert.equal(masked(`see ${link} for more`), 'see [LINK_1] for more', link);
  }
});

test('a link is not taken as the tail of another host, nor of an address', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'link', value: 'https://www.linkedin.com/in/anna-kowalska' }];
  assert.equal(masked('notlinkedin.com/in/anna-kowalska', seeds), 'notlinkedin.com/in/anna-kowalska');
  assert.equal(masked('me@linkedin.com/in/anna-kowalska', seeds), 'me@linkedin.com/in/anna-kowalska');
  assert.equal(masked('x.linkedin.com/in/anna-kowalska', seeds), 'x.linkedin.com/in/anna-kowalska');
  assert.equal(masked('-linkedin.com/in/anna-kowalska', seeds), '-linkedin.com/in/anna-kowalska');
  assert.equal(masked('linkedin.com/in/anna-kowalska2', seeds), 'linkedin.com/in/anna-kowalska2');
  assert.equal(masked('(linkedin.com/in/anna-kowalska).', seeds), '([LINK_1]).');
});

test('what is not a value is left exactly as it was', () => {
  const text = 'A posting for a senior engineer in Warsaw, 12 000 PLN, contact: jobs@acme.pl';
  assert.equal(masked(text), text);
  assert.equal(createVault(anna).replaced(), 0);
});

/* ---------------------------------------------------------- what is not a seed */

test('a seed that is too short, too long or blank is not used', () => {
  const short = 'x'.repeat(MIN_SEED_LENGTH - 1);
  const long = 'y'.repeat(MAX_SEED_LENGTH + 1);

  const vault = createVault([
    { kind: 'name', value: short },
    { kind: 'name', value: long },
    { kind: 'email', value: '   ' },
    { kind: 'phone', value: '' }
  ]);

  assert.equal(vault.empty, true);
  assert.equal(vault.mask(`${short} ${long}`), `${short} ${long}`);
});

test('a seed of exactly the shortest and the longest length is used', () => {
  const least = 'x'.repeat(MIN_SEED_LENGTH);
  const most = 'z'.repeat(MAX_SEED_LENGTH);

  assert.equal(masked(`a ${least} b`, [{ kind: 'name', value: least }]), 'a [NAME_1] b');
  assert.equal(masked(most, [{ kind: 'name', value: most }]), '[NAME_1]');
});

test('a part of a name too short to be a word is not taken on its own', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'name', value: 'Li Wang' }];
  assert.equal(masked('Li Wang', seeds), '[NAME_1]');
  assert.equal(masked('Li', seeds), 'Li');
  assert.equal(masked('Wang', seeds), '[NAME_1]');
});

test('a phone with fewer than seven digits is not a phone', () => {
  assert.equal(createVault([{ kind: 'phone', value: '12 34 56' }]).empty, true);
  assert.equal(createVault([{ kind: 'phone', value: '123 4567' }]).empty, false);
});

test('a link with nothing but a scheme is not a link', () => {
  assert.equal(createVault([{ kind: 'link', value: 'https://' }]).empty, true);
  assert.equal(createVault([{ kind: 'link', value: 'https://a.io' }]).empty, false);
});

test('no seeds at all is an empty vault, and a text goes through whole', () => {
  const vault = createVault([]);
  assert.equal(vault.empty, true);
  assert.equal(vault.mask('Anna Kowalska'), 'Anna Kowalska');
  assert.equal(vault.restore('[NAME_1]'), '[NAME_1]');
});

test('a seed is trimmed, and the same seed twice is one', () => {
  const vault = createVault([
    { kind: 'name', value: '  Anna Kowalska  ' },
    { kind: 'name', value: 'Anna Kowalska' }
  ]);
  assert.equal(vault.mask('Anna Kowalska'), '[NAME_1]');
  assert.equal(vault.replaced(), 1);
});

test('a value is kept from a model whichever kind it was filed under', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'link', value: 'github.com/akowalska' }];
  assert.equal(masked('github.com/akowalska', seeds), '[LINK_1]');
});

/* -------------------------------------------------------------- placeholders */

test('the same text is the same placeholder, and a different one is another', () => {
  const vault = createVault(anna);
  assert.equal(vault.mask('Anna Kowalska and Anna Kowalska'), '[NAME_1] and [NAME_1]');
  assert.equal(vault.mask('ANNA KOWALSKA'), '[NAME_2]');
  assert.equal(vault.mask('Anna Kowalska'), '[NAME_1]');
});

test('each kind is numbered on its own', () => {
  const vault = createVault(anna);
  assert.equal(vault.mask('anna@example.com'), '[NAME_1]@example.com');
  assert.equal(vault.mask('anna.kowalska@example.com'), '[EMAIL_1]');
  assert.equal(vault.mask('Kowalska'), '[NAME_2]');
  assert.equal(vault.mask('ANNA.KOWALSKA@EXAMPLE.COM'), '[EMAIL_2]');
});

test('a vault is its own, and numbers nothing another has numbered', () => {
  const first = createVault(anna);
  const second = createVault(anna);

  assert.equal(first.mask('Kowalska'), '[NAME_1]');
  assert.equal(first.mask('Anna'), '[NAME_2]');
  assert.equal(second.mask('Anna'), '[NAME_1]');
  assert.equal(second.restore('[NAME_2]'), '[NAME_2]');
  assert.equal(first.restore('[NAME_2]'), 'Anna');
});

test('what was written is what is put back, in whatever case it was written', () => {
  const vault = createVault(anna);
  const out = vault.mask('ANNA KOWALSKA is Anna Kowalska');
  assert.equal(out, '[NAME_1] is [NAME_2]');
  assert.equal(vault.restore(out), 'ANNA KOWALSKA is Anna Kowalska');
});

test('a placeholder is never matched again by a value that spells part of it', () => {
  const seeds: readonly MaskSeed[] = [
    { kind: 'name', value: 'Name Smith' },
    { kind: 'email', value: 'email@smith.org' }
  ];
  assert.equal(masked('Name email@smith.org Smith', seeds), '[NAME_1] [EMAIL_1] [NAME_2]');
});

test('a placeholder already in the text is not issued for a value', () => {
  const vault = createVault(anna);
  vault.reserve('He wrote [NAME_1] and [email_2] and [ PHONE 3 ]');

  assert.equal(vault.mask('Anna'), '[NAME_2]');
  assert.equal(vault.mask('anna.kowalska@example.com'), '[EMAIL_1]');
  assert.equal(vault.mask('+48 600 123 456'), '[PHONE_1]');
  assert.equal(vault.mask('ANNA.KOWALSKA@EXAMPLE.COM'), '[EMAIL_3]');
  assert.equal(vault.mask('600-123-456'), '[PHONE_2]');
  assert.equal(vault.mask('600.123.456'), '[PHONE_4]');
});

test('a text that holds a placeholder is read as holding it before it is masked', () => {
  const vault = createVault(anna);
  assert.equal(vault.mask('[NAME_1] is Anna'), '[NAME_1] is [NAME_2]');
  assert.equal(vault.restore('[NAME_1] is [NAME_2]'), '[NAME_1] is Anna');
});

test('a placeholder that a model was never given is left as it is', () => {
  const vault = createVault(anna);
  vault.mask('Anna Kowalska');
  assert.equal(vault.restore('[NAME_7] and [LINK_1] and [AGE_1] and [NAME_1]'), '[NAME_7] and [LINK_1] and [AGE_1] and Anna Kowalska');
});

test('the number of values replaced is counted, and a value that is not replaced is not', () => {
  const vault = createVault(anna);
  vault.mask('Anna Kowalska, anna.kowalska@example.com, Anna, nobody');
  assert.equal(vault.replaced(), 3);
  vault.mask('nobody');
  assert.equal(vault.replaced(), 3);
});

/* ------------------------------------------------------------- what comes back */

test('a placeholder is put right however a model has written it', () => {
  const vault = createVault(anna);
  vault.mask('Anna Kowalska');

  for (const written of ['[NAME_1]', '[name_1]', '[Name_1]', '[NAME\\_1]', '[NAME 1]', '[ NAME_1 ]', '[NAME-1]', '[NAME__1]']) {
    assert.equal(vault.restore(`dear ${written},`), 'dear Anna Kowalska,', written);
  }
});

test('a bracket that is not a placeholder is left alone', () => {
  const vault = createVault(anna);
  vault.mask('Anna Kowalska');

  for (const text of ['[NAME]', '[NAME_]', '[NAME_x]', '[NAMES_1]', '[ NAME_12345 ]', '[1]', 'NAME_1', '(NAME_1)', '[NAME_1', '[[NAME_']) {
    assert.equal(vault.restore(text), text, text);
  }
});

test('a number of several digits is read whole', () => {
  const seeds: readonly MaskSeed[] = Array.from({ length: 12 }, (_, index): MaskSeed => ({
    kind: 'name',
    value: `Person${String.fromCharCode(97 + index).repeat(3)}`
  }));
  const vault = createVault(seeds);
  const out = vault.mask(seeds.map((seed) => seed.value).join(' '));

  assert.match(out, /\[NAME_12\]$/);
  assert.equal(vault.restore(out), seeds.map((seed) => seed.value).join(' '));
  assert.equal(vault.restore('[NAME_1]x'), 'Personaaax');
  assert.equal(vault.restore('[NAME_12]'), 'Personlll');
});

test('what a vault masks it restores, for text of every shape', () => {
  const texts = [
    '',
    'nothing here',
    'Anna Kowalska',
    'ANNA KOWALSKA\nanna.kowalska@example.com\n+48 600 123 456',
    'Anna, Anna Kowalska, Kowalska Anna, anna kowalska, anna.kowalska@example.com, linkedin.com/in/anna-kowalska',
    'a [bracket] and [NAME] and Anna',
    '{"name":"Anna Kowalska","email":"anna.kowalska@example.com"}',
    'zażółć gęślą jaźń Anna',
    'ends with Anna'
  ];

  for (const text of texts) {
    const { out, back } = roundTrip(text);
    assert.equal(back, text, text);
    if (/anna|kowalska|600/i.test(text)) assert.notEqual(out, text, text);
  }
});

test('masking a JSON-shaped value takes every string in it, keys included, and nothing else', () => {
  const vault = createVault(anna);
  const value = {
    'Anna Kowalska': ['anna.kowalska@example.com', 3, null, true, { deeper: '+48 600 123 456', n: 1.5 }],
    plain: 'nothing'
  };

  const out = vault.maskDeep(value);
  assert.deepEqual(out, {
    '[NAME_1]': ['[EMAIL_1]', 3, null, true, { deeper: '[PHONE_1]', n: 1.5 }],
    plain: 'nothing'
  });
  assert.deepEqual(vault.restoreDeep(out), value);
  assert.notEqual(out, value);
});

test('masking a value does not change the value it was given', () => {
  const vault = createVault(anna);
  const value = { who: 'Anna Kowalska', list: ['Anna'] };
  const before = JSON.stringify(value);
  vault.maskDeep(value);
  vault.restoreDeep(value);
  assert.equal(JSON.stringify(value), before);
});

test('a value that is not a string, an array or a plain object is handed back as it is', () => {
  const vault = createVault(anna);
  const date = new Date(0);
  const bytes = new Uint8Array([1, 2, 3]);
  class Holder {
    constructor(readonly who: string) {}
  }
  const holder = new Holder('Anna Kowalska');
  const dictionary = Object.assign(Object.create(null) as Record<string, string>, { who: 'Anna Kowalska' });

  assert.equal(vault.maskDeep(date), date);
  assert.equal(vault.maskDeep(bytes), bytes);
  assert.equal(vault.maskDeep(holder), holder);
  assert.equal(vault.maskDeep(undefined), undefined);
  assert.equal(vault.maskDeep(7), 7);
  assert.deepEqual(vault.maskDeep(dictionary), { who: '[NAME_1]' });
});

/* ------------------------------------------------------------------- streaming */

test('a stream is put right wherever it was cut, and says what the whole says', () => {
  const written = 'Dear [NAME_1], I will call [PHONE_1] or write to [EMAIL_1]. Best, [ NAME 2 ]!';

  const vault = createVault(anna);
  vault.mask('Anna Kowalska +48 600 123 456 anna.kowalska@example.com ANNA KOWALSKA');
  const expected = vault.restore(written);
  assert.notEqual(expected, written);

  for (let cut = 0; cut <= written.length; cut += 1) {
    assert.equal(streamed(vault, written, [cut]).whole, expected, `one cut at ${cut}`);
  }

  for (let first = 1; first < written.length; first += 3) {
    for (let second = first + 1; second < written.length; second += 4) {
      assert.equal(streamed(vault, written, [first, second]).whole, expected, `cuts at ${first}, ${second}`);
    }
  }

  const bytes = [...written].map((_, index) => index + 1).slice(0, -1);
  assert.equal(streamed(vault, written, bytes).whole, expected, 'one character at a time');
});

test('a fragment that cannot be the start of a placeholder is passed on at once', () => {
  const vault = createVault(anna);
  vault.mask('Anna');

  const emitted: string[] = [];
  const restorer = vault.restorer((fragment) => emitted.push(fragment));

  restorer.push('Hello there, ');
  assert.deepEqual(emitted, ['Hello there, ']);

  restorer.push('[NAME_1] and ');
  assert.deepEqual(emitted, ['Hello there, ', 'Anna and ']);

  restorer.push('plain');
  assert.deepEqual(emitted, ['Hello there, ', 'Anna and ', 'plain']);
  restorer.end();
  assert.equal(emitted.length, 3, 'nothing is left to say at the end');
});

test('only the end of a fragment that may become a placeholder is held back', () => {
  const vault = createVault(anna);
  vault.mask('Anna');

  const emitted: string[] = [];
  const restorer = vault.restorer((fragment) => emitted.push(fragment));

  restorer.push('Hi [NA');
  assert.deepEqual(emitted, ['Hi ']);
  restorer.push('ME_');
  assert.deepEqual(emitted, ['Hi ']);
  restorer.push('1] there');
  assert.deepEqual(emitted, ['Hi ', 'Anna there']);
  restorer.end();
});

test('a bracket that never becomes a placeholder is let go at the end', () => {
  const vault = createVault(anna);
  vault.mask('Anna');

  const atEnd = streamed(vault, 'ends with [NAME_', [10]);
  assert.equal(atEnd.whole, 'ends with [NAME_');
  assert.deepEqual(atEnd.emitted, ['ends with ', '[NAME_']);
});

test('a bracket is held back for as long as it could still be a placeholder, and no longer', () => {
  const vault = createVault(anna);
  vault.mask('Anna');

  const emitted: string[] = [];
  const restorer = vault.restorer((fragment) => emitted.push(fragment));

  // A bracket and eighteen characters is as long as one can be written before
  // its closing bracket, and one more cannot be.
  restorer.push(`[${'x'.repeat(18)}`);
  assert.deepEqual(emitted, []);
  restorer.push('x');
  assert.deepEqual(emitted, [`[${'x'.repeat(19)}`]);
  restorer.end();
  assert.equal(emitted.length, 1);
});

test('a placeholder written with every gap as wide as it may be is put right, cut anywhere', () => {
  const vault = createVault(anna);
  vault.mask('Anna +48 600 123 456');

  const widest = '[   PHONE___1   ]';
  assert.equal(vault.restore(widest), '+48 600 123 456');

  for (let cut = 1; cut < widest.length; cut += 1) {
    assert.equal(streamed(vault, `x ${widest} y`, [cut + 2]).whole, 'x +48 600 123 456 y', `cut at ${cut}`);
  }
});

test('a stream with two placeholders in a row restores both', () => {
  const vault = createVault(anna);
  vault.mask('Anna Kowalska +48 600 123 456');

  assert.equal(streamed(vault, '[NAME_1][PHONE_1]', [4, 12]).whole, 'Anna Kowalska+48 600 123 456');
  assert.equal(streamed(vault, '[NAME_1] [[PHONE_1]]', [9, 11]).whole, 'Anna Kowalska [+48 600 123 456]');
});

test('a stream with nothing to restore is passed on as it came', () => {
  const vault = createVault(anna);
  const { emitted } = streamed(vault, 'no values here at all', [3, 9]);
  assert.deepEqual(emitted, ['no ', 'values', ' here at all']);
});

test('an empty fragment says nothing', () => {
  const vault = createVault(anna);
  vault.mask('Anna');
  const emitted: string[] = [];
  const restorer = vault.restorer((fragment) => emitted.push(fragment));
  restorer.push('');
  restorer.end();
  assert.deepEqual(emitted, []);
});

test('a restorer ended twice says nothing the second time', () => {
  const vault = createVault(anna);
  vault.mask('Anna');
  const emitted: string[] = [];
  const restorer = vault.restorer((fragment) => emitted.push(fragment));
  restorer.push('end [NAM');
  restorer.end();
  restorer.end();
  assert.deepEqual(emitted, ['end ', '[NAM']);
});

/* ---------------------------------------------- bounds and spellings, as written */

// The tests above use the exported bounds, so a bound that moved would move with
// them. These say the numbers.

test('a seed has to be three characters and no more than three hundred, trimmed first', () => {
  assert.equal(MIN_SEED_LENGTH, 3);
  assert.equal(MAX_SEED_LENGTH, 300);

  assert.equal(masked('hi Jan', [{ kind: 'name', value: 'Jan' }]), 'hi [NAME_1]');
  assert.equal(masked('hi Li', [{ kind: 'name', value: 'Li' }]), 'hi Li');

  const edge = 'k'.repeat(300);
  const over = 'k'.repeat(301);
  assert.equal(masked(edge, [{ kind: 'name', value: edge }]), '[NAME_1]');
  assert.equal(masked(over, [{ kind: 'name', value: over }]), over);
  assert.equal(masked(edge, [{ kind: 'name', value: `  ${edge}  ` }]), '[NAME_1]', 'the padding is not counted');
});

test('a value is trimmed before it is judged, so padding does not make a short one long enough', () => {
  const padded: MaskSeed = { kind: 'email', value: '  a@  ' };
  assert.equal(createVault([padded]).empty, true);
  assert.equal(masked('write a@ now', [padded]), 'write a@ now');
  assert.equal(createVault([{ kind: 'email', value: 'a@b' }]).empty, false);
});

test('a link of three characters is not a link, and one of four is', () => {
  assert.equal(createVault([{ kind: 'link', value: 'a.b' }]).empty, true);
  assert.equal(createVault([{ kind: 'link', value: 'a.bc' }]).empty, false);
});

test('a link written with a closing slash is taken without it, and with it', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'link', value: 'https://example.com/' }];
  assert.equal(masked('see example.com now', seeds), 'see [LINK_1] now');
  assert.equal(masked('see example.com/ now', seeds), 'see [LINK_1] now');
});

test('a number is taken without its country code only while nine digits are left', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'phone', value: '+48600100200' }];
  assert.equal(masked('call 600 100 200', seeds), 'call [PHONE_1]', 'nine digits left after two');
  assert.equal(masked('ref 00100200', seeds), 'ref 00100200', 'eight left after three is the end of a number');
  assert.equal(masked('ref 00 100 200', seeds), 'ref 00 100 200');
});

test('a country code is taken off up to three digits long, and not four', () => {
  const czech: readonly MaskSeed[] = [{ kind: 'phone', value: '+420 777 123 456' }];
  assert.equal(masked('volejte 777 123 456', czech), 'volejte [PHONE_1]');

  const long: readonly MaskSeed[] = [{ kind: 'phone', value: '+4412345678901' }];
  assert.equal(masked('id 2345678901', long), 'id [PHONE_1]', 'three off, ten left');
  assert.equal(masked('id 345678901', long), 'id 345678901', 'four off, nine left, and a code is not four digits');
});

test('a number written with no country code is not also taken without its first digit', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'phone', value: '1234567890' }];
  assert.equal(masked('call 1234567890', seeds), 'call [PHONE_1]');
  assert.equal(masked('call 234567890', seeds), 'call 234567890');
});

test('a number written with 00 for its plus is the same number', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'phone', value: '0048 600 100 200' }];
  assert.equal(masked('call +48 600 100 200', seeds), 'call [PHONE_1]');
  assert.equal(masked('call 0048600100200', seeds), 'call [PHONE_1]');
  assert.equal(masked('call 600 100 200', seeds), 'call [PHONE_1]');
});

test('a number may be spaced with parentheses', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'phone', value: '221234567' }];
  assert.equal(masked('call 22 (123) 45 67 now', seeds), 'call [PHONE_1] now');
});

test('a whole number is not taken out of a longer one, on either side', () => {
  assert.equal(masked('id 948600123456'), 'id 948600123456');
  assert.equal(masked('id 486001234567'), 'id 486001234567');
});

test('an email is matched as it is spelled and not as a pattern', () => {
  const tagged: readonly MaskSeed[] = [{ kind: 'email', value: 'anna+cv@example.com' }];
  assert.equal(masked('write anna+cv@example.com', tagged), 'write [EMAIL_1]');

  const dotted: readonly MaskSeed[] = [{ kind: 'email', value: 'a.b@example.com' }];
  assert.equal(masked('x aXb@example.com', dotted), 'x aXb@example.com');
});

test('a name written with a comma between its parts is the name', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'name', value: 'Kowalska, Anna' }];
  assert.equal(masked('Anna Kowalska', seeds), '[NAME_1]');
  assert.equal(masked('Kowalska Anna', seeds), '[NAME_1]');
  assert.equal(masked('Anna', seeds), '[NAME_1]');
});

test('only a name of two parts is taken in the other order', () => {
  const seeds: readonly MaskSeed[] = [{ kind: 'name', value: 'Anna Maria Kowalska' }];
  assert.equal(masked('Anna Maria Kowalska', seeds), '[NAME_1]');
  assert.equal(masked('Kowalska Maria Anna', seeds), '[NAME_1] [NAME_2] [NAME_3]');
});

test('a character that does not fold to one is left as it is, so that offsets hold', () => {
  const korean = '한국어';
  assert.equal(fold(korean), korean);
  assert.equal(masked(`${korean} Anna Kowalska`), `${korean} [NAME_1]`);
});

test('a placeholder that a fragment ends in the middle of, after a markdown backslash, is held', () => {
  const vault = createVault(anna);
  vault.mask('anna.kowalska@example.com');

  const { emitted } = streamed(vault, '[EMAIL\\_1] ok', [7]);
  assert.deepEqual(emitted, ['anna.kowalska@example.com ok']);
});
