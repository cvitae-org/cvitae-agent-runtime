/**
 * The detectors, alone: what they take for an identifier and what they must not.
 *
 * `detect.ts` is given the folded text of a message and says where an identifier
 * is. These tests hold it to a list of things written the way people write them,
 * and to a longer list of things that look like an identifier and are not. The
 * second is the one that matters: a number taken for a person's is a number a
 * model can no longer read, and the corpus below is every such number that was
 * thought of, kept so that the next detector is held to it too.
 *
 *   found          each kind in the spellings people use, in Polish and in
 *                  English, and only the identifier and not the word that
 *                  labels it (`NIP: …`, `born …`)
 *   not found      amounts, versions, years, dates with no label, order numbers,
 *                  addresses of a machine, numbers with a currency after them,
 *                  numbers that are the tail of a longer one, annotations
 *   checked        a PESEL, a NIP and an IBAN are found only when they check out,
 *                  and a number that fails is not used up: what begins inside it
 *                  is still looked at
 *   trimmed        a number with a country code is as long as its country says
 *                  and not as long as what follows it; an IBAN is not made
 *                  longer by the word after it
 *   shape          every pattern is on folded text, has no capturing group, and
 *                  is linear in the text
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 391 were applied: 386 fail at least one test here, and 5 cannot be told from the original.
 *
 * src/effects/detect.ts:
 *   a PESEL is taken with any control digit                              2
 *   a PESEL of more than eleven digits is taken                          1
 *   the weights of a PESEL are not the ones it has                       2
 *   a month of a PESEL need not be a month                               11
 *   month zero is a month in a PESEL                                     5
 *   month thirteen is a month in a PESEL                                 5
 *   a day of a PESEL is not held to its month                            1
 *   day zero is a day in a PESEL                                         1
 *   every PESEL is of the 1900s                                          1
 *   the 2000s and the 2100s are swapped in a PESEL                       1
 *   a NIP is taken with any control digit                                4
 *   a NIP of nine digits is taken                                        1
 *   the weights of a NIP are not the ones it has                         38
 *   an IBAN may be of any length                                         3
 *   an IBAN of 14 characters is taken                                    1
 *   an IBAN of 35 characters is taken                                    1
 *   the country and check digits of an IBAN are not moved to the end     21
 *   the remainder of an IBAN is zero                                     21
 *   a letter is one less in an IBAN                                      20
 *   an IBAN is not read in lower case                                    7
 *   an IBAN with words after it is refused whole                         2
 *   an IBAN is cut at the wrong group                                    2
 *   a Polish account number is not given its country                     4
 *   a month first date is never read                                     2
 *   a day first date is never read                                       2
 *   a date with its year first is not told from one with it last         33
 *   a date with its month in words is read as numbers                    59
 *   the year of a date with a month in words is the first number         59
 *   a date with a month in words has no year                             59
 *   the month in words is not the month                                  21
 *   the first year of birth is 1800                                      1
 *   the last year of birth is 2200                                       2
 *   month thirteen is a month in a date                                  1
 *   month zero is a month in a date                                      2
 *   day zero is a day in a date                                          2
 *   a day of a date is not held to its month                             25
 *   the days in a month are those of the one before                      45
 *   the months are numbered from zero                                    44
 *   the months are numbered one late                                     44
 *   the month word january is not known                                  1
 *   the month word stycznia is not known                                 1
 *   the month word styczen is not known                                  1
 *   the month word jan is not known                                      1
 *   the month word february is not known                                 1
 *   the month word lutego is not known                                   1
 *   the month word luty is not known                                     1
 *   the month word feb is not known                                      1
 *   the month word march is not known                                    5
 *   the month word marca is not known                                    1
 *   the month word marzec is not known                                   1
 *   the month word mar is not known                                      1
 *   the month word april is not known                                    1
 *   the month word kwietnia is not known                                 1
 *   the month word kwiecien is not known                                 1
 *   the month word apr is not known                                      1
 *   the month word may is not known                                      1
 *   the month word maja is not known                                     1
 *   the month word maj is not known                                      1
 *   the month word june is not known                                     1
 *   the month word czerwca is not known                                  1
 *   the month word czerwiec is not known                                 1
 *   the month word jun is not known                                      1
 *   the month word july is not known                                     1
 *   the month word lipca is not known                                    1
 *   the month word lipiec is not known                                   1
 *   the month word jul is not known                                      1
 *   the month word august is not known                                   1
 *   the month word sierpnia is not known                                 1
 *   the month word sierpien is not known                                 1
 *   the month word aug is not known                                      1
 *   the month word september is not known                                1
 *   the month word wrzesnia is not known                                 1
 *   the month word wrzesien is not known                                 1
 *   the month word sept is not known                                     4
 *   the month word sep is not known                                      1
 *   the month word october is not known                                  1
 *   the month word pazdziernika is not known                             3
 *   the month word pazdziernik is not known                              1
 *   the month word oct is not known                                      1
 *   the month word november is not known                                 1
 *   the month word listopada is not known                                3
 *   the month word listopad is not known                                 1
 *   the month word nov is not known                                      1
 *   the month word december is not known                                 1
 *   the month word grudnia is not known                                  1
 *   the month word grudzien is not known                                 1
 *   the month word dec is not known                                      1
 *   the birth label date of birth is not known                           3
 *   the birth label birth date is not known                              1
 *   the birth label birthdate is not known                               1
 *   the birth label birthday is not known                                1
 *   the birth label d.o.b. is not known                                  2
 *   the birth label dob is not known                                     5
 *   the birth label born is not known                                    69
 *   the birth label data urodzenia is not known                          4
 *   the birth label ur. is not known                                     4
 *   the birth label urodzona dnia is not known                           2
 *   the birth label urodzona is not known                                3
 *   the birth label urodz. is not known                                  1
 *   a birth label may be part of a longer word                           1
 *   a label and its date need no colon                                   25
 *   a label and its date may not be parted by a hyphen                   1
 *   a label and its colon may not be parted by a space                   2
 *   a date of birth needs no label                                       55
 *   a date of birth may not follow "on"                                  2
 *   a date with its year first is not read                               4
 *   a date may not be parted by dots                                     30
 *   a date may not be parted by slashes                                  2
 *   a date may not be parted by hyphens                                  1
 *   a date with its year first may not be parted by dots                 1
 *   a date with its year first may not be parted by slashes              1
 *   a date with its year first may not be parted by hyphens              2
 *   a day may not have an ordinal                                        1
 *   a day may not have a dot                                             1
 *   a day may not be followed by "of"                                    1
 *   a month may not have a dot or a comma after it                       2
 *   a month may not have a comma after it                                1
 *   a month may not have a dot after it                                  1
 *   a date with its month first is not read                              51
 *   a day after its month may not have an ordinal                        1
 *   a day after its month may not have a comma                           49
 *   a month first date may not have a dot after its month                1
 *   a Polish number has ten digits after its code                        12
 *   a Polish number has eight digits after its code                      10
 *   a British number has eleven digits after its code                    2
 *   a British number has nine digits after its code                      3
 *   an American number has nine digits after its code                    4
 *   an American number has eleven digits after its code                  3
 *   a number from a country not known may be of six digits               2
 *   a number from a country not known must be of nine digits             1
 *   a number from a country not known may be of sixteen digits           1
 *   a number from a country not known may be of at most fourteen digits  1
 *   a number written with 00 is read as one written with a plus          2
 *   the digits of a code are not left out of the count                   3
 *   a number is not cut where its country says                           3
 *   a number is cut one digit late                                       15
 *   pln does not make a number an amount                                 2
 *   zl does not make a number an amount                                  2
 *   eur does not make a number an amount                                 2
 *   usd does not make a number an amount                                 1
 *   gbp does not make a number an amount                                 1
 *   chf does not make a number an amount                                 1
 *   czk does not make a number an amount                                 1
 *   € does not make a number an amount                                   1
 *   \\$ does not make a number an amount                                 1
 *   £ does not make a number an amount                                   1
 *   % does not make a number an amount                                   2
 *   kg does not make a number an amount                                  2
 *   km does not make a number an amount                                  2
 *   m2 does not make a number an amount                                  1
 *   m² does not make a number an amount                                  1
 *   mb does not make a number an amount                                  1
 *   gb does not make a number an amount                                  1
 *   kb does not make a number an amount                                  1
 *   ms does not make a number an amount                                  1
 *   an amount may not be a space from its currency                       23
 *   an amount may be two spaces from its currency                        1
 *   an amount may be followed by letters                                 2
 *   no number is told to be an amount                                    24
 *   a number may be the end of a longer one                              27
 *   a number may follow a digit and a space                              6
 *   a number may follow a digit and a dot                                2
 *   a number may follow a digit and a comma                              1
 *   a number may follow a digit                                          17
 *   a number may follow a plus                                           1
 *   a number may follow a hyphen                                         1
 *   a number may follow a euro sign                                      1
 *   a number may follow a dollar sign                                    1
 *   a number may follow a pound sign                                     1
 *   a number may be the start of a longer one                            6
 *   45 is not the start of a mobile                                      1
 *   50 is not the start of a mobile                                      1
 *   51 is not the start of a mobile                                      1
 *   53 is not the start of a mobile                                      1
 *   57 is not the start of a mobile                                      1
 *   60 is not the start of a mobile                                      8
 *   66 is not the start of a mobile                                      1
 *   69 is not the start of a mobile                                      1
 *   72 is not the start of a mobile                                      1
 *   73 is not the start of a mobile                                      1
 *   78 is not the start of a mobile                                      1
 *   79 is not the start of a mobile                                      1
 *   88 is not the start of a mobile                                      1
 *   59 is the start of a mobile                                          1
 *   a mobile need not be in threes                                       26
 *   a mobile may not have spaces                                         18
 *   a mobile may not have hyphens                                        1
 *   a mobile must have its groups parted                                 1
 *   a landline may not have brackets                                     1
 *   a landline may not have a bracket open                               1
 *   a landline may not have a bracket closed                             1
 *   a landline may not be parted by hyphens                              1
 *   a landline may not be parted by spaces                               3
 *   a landline may begin with zero                                       1
 *   an American number may not have brackets                             5
 *   an American number needs a space after its brackets                  1
 *   an American number may not have a space after its brackets           4
 *   an American number in brackets may not have a hyphen                 3
 *   an American number in brackets may not have a dot                    1
 *   an American number in brackets may not have a space                  1
 *   an American number with no brackets may not have hyphens             2
 *   an American number with no brackets may not have dots                1
 *   a British number may begin with zero zero                            2
 *   a British number in the short form is not read                       1
 *   a British number in the long form is not read                        2
 *   a British number of the long form may be short                       2
 *   a British number of the long form may be long                        2
 *   a number with its code may be of one group                           0 (equivalent: one group is at most seven digits with the code, and `fitInternational` wants eight, or the eleven or twelve of a country it knows)
 *   a number with its code may not be of many groups                     4
 *   a number with its code may not have dots                             2
 *   a number with its code may not have hyphens                          1
 *   a number with its code may not have brackets                         1
 *   a number with its code may begin with 00                             2
 *   a number with its code may begin with zero                           6
 *   a code may be of four digits                                         0 (equivalent: a digit the code takes is one the groups after it would take, and `fitInternational` reads the country from the digits and not from the pattern)
 *   a number with its code may follow a plus                             1
 *   a number with its code may follow a digit                            2
 *   a PESEL may be the end of a longer number                            2
 *   a PESEL may follow a digit                                           1
 *   a PESEL may be followed by a digit                                   1
 *   a NIP needs no label                                                 1
 *   a NIP label may be part of a longer word                             3
 *   NIP is not a label                                                   13
 *   VAT is not a label                                                   11
 *   VAT ID is not a label                                                4
 *   VAT NO is not a label                                                2
 *   VAT NUMBER is not a label                                            1
 *   VAT NR is not a label                                                1
 *   TAX ID is not a label                                                3
 *   UST ID is not a label                                                3
 *   a NIP label and its number may not have a colon                      19
 *   a NIP label and its number may not have a dot                        1
 *   a NIP label and its number may not have a hyphen                     1
 *   a NIP label and its number may not have a hash                       1
 *   a NIP may not have its country                                       19
 *   a NIP may not have a space after its country                         19
 *   a NIP may not have spaces                                            1
 *   a NIP may not have hyphens                                           1
 *   a NIP with a label may be the start of a longer number               1
 *   a NIP by its layout may follow a letter                              1
 *   a NIP by its layout may follow a digit                               1
 *   a NIP by its layout may follow a hyphen                              1
 *   a NIP in the layout of three, three, two and two is not read         2
 *   a NIP in the layout of three, two, two and three is not read         1
 *   a NIP with its country is not read                                   1
 *   a NIP by its layout may be the start of a longer number              2
 *   a NIP by its layout may be followed by a hyphen                      1
 *   an IBAN may follow a letter                                          1
 *   an IBAN may follow a digit                                           1
 *   an IBAN may be of one group                                          0 (equivalent: a text of fewer than two groups is under the fifteen characters `isIban` asks for)
 *   an IBAN may be of at most five groups                                3
 *   an IBAN may not have a last group of fewer than four                 9
 *   an IBAN may not have spaces                                          13
 *   a Polish account number may follow a digit                           1
 *   a Polish account number may be the start of a longer number          1
 *   a Polish account number may not have spaces                          2
 *   an address may follow a letter                                       2
 *   the name of an address may be of 65 characters                       1
 *   the name of an address may be of at most 63 characters               1
 *   an address may have no name                                          1
 *   the name of an address may not have a plus                           1
 *   the name of an address may not have a hyphen                         1
 *   the name of an address may not have a dot                            2
 *   the name of an address may not have an underscore                    1
 *   the name of an address may not have a percent sign                   1
 *   a part of a domain may be of 64 characters                           1
 *   a part of a domain may be of at most 62 characters                   1
 *   a top level may be of one letter                                     2
 *   a top level may be of 25 letters                                     1
 *   a top level may be of at most 23 letters                             1
 *   a top level may be of three letters at least                         2
 *   an address may be followed by a letter                               3
 *   an address may be followed by a dot and a word                       1
 *   an address may be followed by a hyphen                               1
 *   an address with no dot in its domain is one                          5
 *   a file is an address                                                 12
 *   png is not the ending of a file                                      3
 *   jpg is not the ending of a file                                      2
 *   jpeg is not the ending of a file                                     1
 *   gif is not the ending of a file                                      1
 *   svg is not the ending of a file                                      1
 *   webp is not the ending of a file                                     1
 *   bmp is not the ending of a file                                      1
 *   ico is not the ending of a file                                      1
 *   css is not the ending of a file                                      1
 *   js is not the ending of a file                                       1
 *   an address is judged by its start                                    1
 *   every address is a file                                              31
 *   a LinkedIn profile is not one                                        6
 *   a LinkedIn profile may not be called pub                             1
 *   a LinkedIn profile may not be called profile                         1
 *   a LinkedIn profile may not be called in                              4
 *   a GitHub profile is not one                                          10
 *   a GitLab profile is not one                                          1
 *   a Bitbucket profile is not one                                       1
 *   a Twitter profile is not one                                         1
 *   an X profile is not one                                              1
 *   an Instagram profile is not one                                      1
 *   a Facebook profile is not one                                        1
 *   a Behance profile is not one                                         1
 *   a Dribbble profile is not one                                        1
 *   a TikTok profile is not one                                          1
 *   a profile on a .net host is not one                                  1
 *   a profile on a .com host is not one                                  5
 *   a profile name may not begin with an at sign                         2
 *   a Medium profile is not one                                          1
 *   a Stack Overflow profile is not one                                  1
 *   a Goldenline profile is not one                                      1
 *   a Pracuj profile is not one                                          1
 *   an Aplikuj profile is not one                                        1
 *   an OLX profile is not one                                            1
 *   a Polish profile may not be called profil                            1
 *   a Polish profile may not be called profile                           1
 *   a Polish profile may not be called u                                 1
 *   a Polish profile may not be called user                              1
 *   a Telegram link is not one                                           1
 *   a profile may follow a letter                                        2
 *   a profile may follow a digit                                         1
 *   a profile may follow an at sign                                      1
 *   a profile may follow a dot                                           1
 *   a profile may follow a hyphen                                        1
 *   a profile is taken without its scheme                                2
 *   a profile is taken without its country                               3
 *   a profile may have a subdomain of four letters                       1
 *   a profile has a name of one character at least                       1
 *   a profile name may end in a dot                                      1
 *   a profile name may be of 40 characters                               1
 *   a profile name may be of at most 30 characters                       1
 *   a profile has no path                                                6
 *   a profile path may end in a dot                                      1
 *   a profile path may not end in a slash                                1
 *   a profile may be the start of a longer word                          1
 *   a handle after github is not one                                     2
 *   a handle after gitlab is not one                                     1
 *   a handle after twitter is not one                                    10
 *   a handle after instagram is not one                                  1
 *   a handle after telegram is not one                                   1
 *   a handle after skype is not one                                      1
 *   a handle after linkedin is not one                                   1
 *   a handle needs no network before it                                  1
 *   a network may be the end of a longer word                            1
 *   a network and its handle may not have a colon                        16
 *   a network and its handle may not have a hyphen                       1
 *   a network and its handle may not have a space before the colon       2
 *   a network and its handle may not have a space after the colon        17
 *   a handle may be of one character                                     1
 *   a handle may be of 31 characters                                     1
 *   a handle may be of at most 29 characters                             1
 *   a handle may end in a dot                                            1
 *   a handle may be the start of a longer one                            1
 *   a handle may not have a dot                                          1
 *   a handle may not have an underscore                                  9
 *   a guard is not a guard                                               0 (equivalent: a guard only saves work, and every text these files look at is checked to find the same with and without one)
 *   a detector is not run when its guard fails to find                   269
 *   what a detector found is not passed on                               268
 *   what a detector found is passed on with its shape and not its fit    4
 *   the fit of a detector is ignored                                     106
 *   a detector with no fit finds nothing                                 81
 *   what a detector found is used up                                     1
 *   what a check refuses is used up                                      1
 *   an empty span is a span                                              103
 *   a refused match is stepped over by two                               0 (equivalent: no detector with a check can begin a match one character into a refused one: each looks behind it for something that character is not)
 *   the kinds are not the detector's                                     11
 *   the email detector finds nothing                                     19
 *   the profile detector finds nothing                                   31
 *   the handle detector finds nothing                                    17
 *   the phone with country code detector finds nothing                   19
 *   the polish mobile detector finds nothing                             20
 *   the polish landline detector finds nothing                           4
 *   the us number detector finds nothing                                 8
 *   the uk number detector finds nothing                                 3
 *   the pesel detector finds nothing                                     16
 *   the nip with a label detector finds nothing                          30
 *   the nip by its layout detector finds nothing                         4
 *   the iban detector finds nothing                                      14
 *   the polish account number detector finds nothing                     3
 *   the date of birth detector finds nothing                             96
 *   the email detector names what it finds wrongly                       4
 *   the profile detector names what it finds wrongly                     3
 *   the handle detector names what it finds wrongly                      3
 *   the phone with country code detector names what it finds wrongly     3
 *   the polish mobile detector names what it finds wrongly               1
 *   the polish landline detector names what it finds wrongly             1
 *   the us number detector names what it finds wrongly                   1
 *   the uk number detector names what it finds wrongly                   1
 *   the pesel detector names what it finds wrongly                       3
 *   the nip with a label detector names what it finds wrongly            2
 *   the nip by its layout detector names what it finds wrongly           1
 *   the iban detector names what it finds wrongly                        2
 *   the polish account number detector names what it finds wrongly       1
 *   the date of birth detector names what it finds wrongly               4
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { detect, detectors, isIban, isNip, isPesel, isPolishAccount } from '../src/effects/detect.js';
import { fold } from '../src/effects/mask.js';

/**
 * What the vault would take of what the detectors find: the leftmost span, the
 * longest of those that start together, and none that begins inside one taken.
 * Detectors may overlap (a Polish account number is inside `PL` and itself).
 */
const taken = (text: string): { readonly kind: string; readonly text: string }[] => {
  // Every text any test here looks at is also looked at with no guard to save work:
  // a guard that hid something would be a detector that does not find what it is for,
  // and a pattern that finds what it should not would otherwise be hidden by one.
  assert.deepEqual(detect(fold(text), false), detect(fold(text)), `a guard hides something in: ${text}`);

  const spans = [...detect(fold(text))].sort((a, b) => a.start - b.start || b.end - a.end);
  const chosen: typeof spans = [];
  let until = 0;

  for (const span of spans) {
    if (span.start < until) continue;
    chosen.push(span);
    until = span.end;
  }

  return chosen.map((span) => ({ kind: span.kind, text: text.slice(span.start, span.end) }));
};

/** What the detectors find in a text, as the text of each span, in order. */
const found = (text: string): string[] => taken(text).map((span) => span.text);

const kinds = (text: string): string[] => taken(text).map((span) => span.kind);

/** Ten digits and the control digit a PESEL ends with, so that only what a test changes can be wrong with it. */
const withControl = (digits: string): string => {
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = weights.reduce((total, weight, index) => total + weight * Number(digits[index]), 0);
  return digits + String((10 - (sum % 10)) % 10);
};

/** An IBAN made of a country, a body and the check digits that make it one, of any length a test needs. */
const ibanOf = (country: string, body: string): string => {
  const numeric = [...`${body}${country}00`.toLowerCase()]
    .map((char) => (/\d/.test(char) ? char : String(char.charCodeAt(0) - 87)))
    .join('');
  return `${country}${String(98 - Number(BigInt(numeric) % 97n)).padStart(2, '0')}${body}`;
};

/** Written in groups of four, as a bank prints it. */
const inGroups = (text: string): string => text.match(/.{1,4}/g)!.join(' ');

/* ----------------------------------------------------------------------- found */

const FOUND: readonly (readonly [string, string, readonly string[]])[] = [
  ['an email', 'Write to jan.nowak@example.com today.', ['jan.nowak@example.com']],
  ['an email in capitals', 'Write to JAN.NOWAK@EXAMPLE.COM today.', ['JAN.NOWAK@EXAMPLE.COM']],
  ['an email with a tag and a subdomain', 'jan+cv@mail.example.co.uk,', ['jan+cv@mail.example.co.uk']],
  ['an email in brackets', 'Contact (jan@example.pl).', ['jan@example.pl']],
  ['two emails', 'a@example.com b@example.org', ['a@example.com', 'b@example.org']],
  ['a Polish mobile with its code', 'Zadzwoń: +48 600 700 800.', ['+48 600 700 800']],
  ['a Polish mobile with 0048', '0048 600 700 800', ['0048 600 700 800']],
  ['a Polish mobile in groups', 'Tel. 600 700 800, proszę.', ['600 700 800']],
  ['a Polish mobile before a word that only begins like a currency', 'Zadzwoń 600 700 800 zlecenie', ['600 700 800']],
  ['a Polish mobile before a word that only begins like a unit', 'tel. 600 700 800 mbank', ['600 700 800']],
  ['an address followed by a full stop', 'Mail jan@example.com.', ['jan@example.com']],
  ['two addresses with a comma between', 'jan@example.com,ewa@example.org', ['jan@example.com', 'ewa@example.org']],
  ['a Polish mobile with hyphens', 'kom. 600-700-800', ['600-700-800']],
  ['a Polish mobile in one piece', 'tel 600700800', ['600700800']],
  ['a Polish mobile with its code in one piece', '+48600700800', ['+48600700800']],
  ['a Polish landline with brackets', 'biuro (22) 123 45 67', ['(22) 123 45 67']],
  ['a Polish landline with an area code', 'biuro 22 123 45 67', ['22 123 45 67']],
  ['a Polish landline with its code', '+48 22 123 45 67', ['+48 22 123 45 67']],
  ['a British number with its code', '+44 20 7946 0958', ['+44 20 7946 0958']],
  ['a British landline', 'on 020 7946 0958', ['020 7946 0958']],
  ['a British mobile', '07911 123456', ['07911 123456']],
  ['an American number with its code', '+1 (555) 123-4567', ['+1 (555) 123-4567']],
  ['an American number with brackets', '(555) 123-4567', ['(555) 123-4567']],
  ['an American number with hyphens', '555-123-4567', ['555-123-4567']],
  ['an American number with dots', '555.123.4567', ['555.123.4567']],
  ['a German number', '+49 30 123456', ['+49 30 123456']],
  ['a PESEL', 'PESEL: 44051401359', ['44051401359']],
  ['a PESEL of the 2000s', 'pesel 02070803628', ['02070803628']],
  ['a NIP with its label', 'NIP: 123-456-32-18', ['123-456-32-18']],
  ['a NIP with its label and no hyphens', 'NIP 1234563218', ['1234563218']],
  ['a NIP with spaces', 'NIP 123 456 32 18', ['123 456 32 18']],
  ['a VAT number with its country', 'VAT ID: PL1234563218', ['PL1234563218']],
  ['a NIP by its layout alone', 'faktura 123-456-32-18 z dnia', ['123-456-32-18']],
  ['a NIP in the other layout', '123-45-63-218', ['123-45-63-218']],
  ['a NIP with its country by itself', 'PL1234563218', ['PL1234563218']],
  ['a Polish IBAN', 'IBAN PL61 1090 1014 0000 0712 1981 2874.', ['PL61 1090 1014 0000 0712 1981 2874']],
  ['a Polish IBAN in one piece', 'PL61109010140000071219812874', ['PL61109010140000071219812874']],
  ['an account number that ends an IBAN glued to a word is all that is found of it', 'PL61109010140000071219812874abc', ['61109010140000071219812874']],
  ['a Polish account number with no country', 'konto 61 1090 1014 0000 0712 1981 2874', ['61 1090 1014 0000 0712 1981 2874']],
  ['a British IBAN', 'GB82 WEST 1234 5698 7654 32', ['GB82 WEST 1234 5698 7654 32']],
  ['a date of birth with dots', 'Born: 3.11.1990', ['3.11.1990']],
  ['a date of birth with a year first', 'date of birth 1990-11-03', ['1990-11-03']],
  ['a date of birth with a Polish month', 'data urodzenia: 3 listopada 1990', ['3 listopada 1990']],
  ['a date of birth with a Polish month without its accents', 'data urodzenia: 12 pazdziernika 1985', ['12 pazdziernika 1985']],
  ['a date of birth with a Polish month with its accents', 'data urodzenia: 12 października 1985', ['12 października 1985']],
  ['a date of birth with slashes', 'ur. 03/11/1990', ['03/11/1990']],
  ['a date of birth with a month first', 'born on March 3, 1990', ['March 3, 1990']],
  ['a date of birth with a day first and an ordinal', 'DOB: 3rd of March 1990', ['3rd of March 1990']],
  ['a date of birth with the month written short', 'dob 3 sept 1990', ['3 sept 1990']],
  ['a date of birth in the American order', 'DOB 03/25/1990', ['03/25/1990']],
  ['a date of birth after "urodzona"', 'urodzona 7.05.1992 w Krakowie', ['7.05.1992']],
  ['a LinkedIn profile', 'See https://www.linkedin.com/in/anna-kowalska-123/ now', ['https://www.linkedin.com/in/anna-kowalska-123']],
  ['a LinkedIn profile with no scheme', 'linkedin.com/in/anna', ['linkedin.com/in/anna']],
  ['a GitHub profile', 'code at github.com/annak.', ['github.com/annak']],
  ['a GitHub repository', 'https://github.com/annak/cv-tools', ['https://github.com/annak/cv-tools']],
  ['a profile on a country subdomain', 'pl.linkedin.com/in/anna', ['pl.linkedin.com/in/anna']],
  ['a Twitter profile', 'x.com/annak and twitter.com/@annak', ['x.com/annak', 'twitter.com/@annak']],
  ['a Medium profile', 'medium.com/@annak', ['medium.com/@annak']],
  ['a Stack Overflow profile', 'stackoverflow.com/users/123456/anna', ['stackoverflow.com/users/123456/anna']],
  ['a handle with its network', 'twitter: @anna_k.', ['@anna_k']],
  ['a handle after a name and a hyphen', 'GitHub - @annak', ['@annak']],
  ['a handle after a name and a colon with a space before it', 'Twitter : @annak', ['@annak']],
  ['a handle of two characters', 'twitter: @ab', ['@ab']],
  ['a handle of thirty characters', `twitter: @${'a'.repeat(30)}`, [`@${'a'.repeat(30)}`]],
  ['an address of the longest local part there is', `${'x'.repeat(64)}@example.com`, [`${'x'.repeat(64)}@example.com`]],
  ['an address of the longest part of a domain there is', `a@${'x'.repeat(63)}.com`, [`a@${'x'.repeat(63)}.com`]],
  ['an address of the longest top level there is', `a@example.${'x'.repeat(24)}`, [`a@example.${'x'.repeat(24)}`]],
  ['a Polish landline with hyphens', 'biuro 22-123-45-67', ['22-123-45-67']],
  ['an American number with no space after its brackets', '(555)123-4567', ['(555)123-4567']],
  ['an American number with brackets and a hyphen', '(555) 123-4567', ['(555) 123-4567']],
  ['an American number with brackets and dots', '(555) 123.4567', ['(555) 123.4567']],
  ['a number with a country the table does not know, of eight digits', '+49 30 1234', ['+49 30 1234']],
  ['a number with a country the table does not know, of fifteen digits', '+81 90 1234 5678 901', ['+81 90 1234 5678 901']],
  ['a date of birth with a day over twelve', 'born 25.12.1990', ['25.12.1990']],
  ['a date of birth in the first year there is', 'born 1.1.1900', ['1.1.1900']],
  ['a date of birth in the last year there is', 'born 1.1.2100', ['1.1.2100']],
  ['a date of birth in the American order with a day over twelve', 'born 3.13.1990', ['3.13.1990']],
  ['a date of birth on the last day of February in a leap year', 'born 29.02.1992', ['29.02.1992']],
  ['a date of birth after a space before the colon', 'Born : 3.11.1990', ['3.11.1990']],
  ['a date of birth after a dash', 'DOB - 1990-11-03', ['1990-11-03']],
  ['a date of birth after "on"', 'born on 3.11.1990', ['3.11.1990']],
  ['a date of birth with hyphens', 'born 03-11-1990', ['03-11-1990']],
  ['a date of birth with a year first and dots', 'born 1990.11.03', ['1990.11.03']],
  ['a date of birth with a year first and slashes', 'born 1990/11/03', ['1990/11/03']],
  ['a date of birth with a dot after its day', 'ur. 3. listopada 1990', ['3. listopada 1990']],
  ['a date of birth with a dot after its month', 'born 3 sept. 1990', ['3 sept. 1990']],
  ['a date of birth with a comma after its month', 'born 3 March, 1990', ['3 March, 1990']],
  ['a date of birth with a month first and an ordinal', 'born March 3rd 1990', ['March 3rd 1990']],
  ['a date of birth with a month first and a dot', 'born Sept. 3 1990', ['Sept. 3 1990']],
  ['a date of birth with its label in capitals', 'DATE OF BIRTH: 3.11.1990', ['3.11.1990']],
  ['a LinkedIn profile of the older kind', 'linkedin.com/pub/anna-kowalska/1/2/3', ['linkedin.com/pub/anna-kowalska/1/2/3']],
  ['a LinkedIn profile that is called a profile', 'linkedin.com/profile/anna', ['linkedin.com/profile/anna']],
  ['a GitLab profile', 'gitlab.com/annak', ['gitlab.com/annak']],
  ['a Bitbucket profile', 'bitbucket.org/annak', ['bitbucket.org/annak']],
  ['an Instagram profile', 'instagram.com/annak', ['instagram.com/annak']],
  ['a Facebook profile', 'facebook.com/anna.kowalska', ['facebook.com/anna.kowalska']],
  ['a Behance profile', 'behance.net/annak', ['behance.net/annak']],
  ['a Dribbble profile', 'dribbble.com/annak', ['dribbble.com/annak']],
  ['a TikTok profile', 'tiktok.com/@annak', ['tiktok.com/@annak']],
  ['a Polish profile of one kind', 'goldenline.pl/profil/anna', ['goldenline.pl/profil/anna']],
  ['a Polish profile of another', 'pracuj.pl/user/anna', ['pracuj.pl/user/anna']],
  ['a Polish profile of a third', 'aplikuj.pl/u/anna', ['aplikuj.pl/u/anna']],
  ['a Polish profile of a fourth', 'olx.pl/profile/anna', ['olx.pl/profile/anna']],
  ['a Telegram link', 'write t.me/annak', ['t.me/annak']]
];

for (const [name, text, expected] of FOUND) {
  test(`found: ${name}`, () => {
    assert.deepEqual(found(text), expected);
  });
}

test('found: the kinds of what is found are what the placeholders will say', () => {
  assert.deepEqual(kinds('a@example.com'), ['email']);
  assert.deepEqual(kinds('+48 600 700 800'), ['phone']);
  assert.deepEqual(kinds('44051401359'), ['id']);
  assert.deepEqual(kinds('NIP 1234563218'), ['id']);
  assert.deepEqual(kinds('PL61109010140000071219812874'), ['id']);
  assert.deepEqual(kinds('born 3.11.1990'), ['dob']);
  assert.deepEqual(kinds('github.com/annak'), ['link']);
  assert.deepEqual(kinds('twitter: @annak'), ['link']);
});

test('found: a label is not taken with what it labels', () => {
  const text = 'Born: 3.11.1990, NIP: 123-456-32-18, PESEL: 44051401359, twitter: @anna_k';
  assert.deepEqual(found(text), ['3.11.1990', '123-456-32-18', '44051401359', '@anna_k']);
});

test('found: every identifier in a text, with the text between them untouched', () => {
  const text = 'Anna (jan@example.com, +48 600 700 800) pays PL61 1090 1014 0000 0712 1981 2874 for NIP 1234563218.';
  assert.deepEqual(found(text), ['jan@example.com', '+48 600 700 800', 'PL61 1090 1014 0000 0712 1981 2874', '1234563218']);
});

test('found: where a span starts and ends is where it is in the text, for any text', () => {
  const text = 'Zażółć gęślą jaźń: Łukasz, +48 600 700 800 i ŁUKASZ@EXAMPLE.COM';
  for (const span of detect(fold(text))) {
    assert.ok(['+48 600 700 800', 'ŁUKASZ@EXAMPLE.COM'].includes(text.slice(span.start, span.end)), text.slice(span.start, span.end));
  }
  assert.equal(detect(fold(text)).length, 2);
});

/* ------------------------------------------------------------------- not found */

const NOT_FOUND: readonly (readonly [string, string])[] = [
  ['an amount in złoty', '123 456 789 PLN'],
  ['an amount in złoty, written with the symbol', 'wynagrodzenie 600 700 800 zł'],
  ['an amount in euros', '600 700 800 EUR'],
  ['an amount with a currency before it', 'budget €600 700 800'],
  ['an amount that is a part of a longer one', '1 600 700 800'],
  ['a range of salaries', 'Salary 15 000 - 20 000 PLN'],
  ['a salary and a bonus', '8 000 - 12 000 zł brutto + 10% premii'],
  ['a version number', 'version 3.11.2'],
  ['a long version number', 'python 3.11.2.1'],
  ['a year', 'since 2019, until 2024'],
  ['a range of years', '2015-2019 and 2019 - 2024'],
  ['a date with no label', '2024-03-05 and 5.3.2024'],
  ['a date of birth with no day', 'Born in 1990'],
  ['a date of birth with a half of a date', 'Born 3.11.2'],
  ['a date of birth that was not', 'DOB 31.02.1990'],
  ['a date of birth in the future', 'born 3.11.2150'],
  ['a date of birth with no such month in either order', 'born 13.13.1990'],
  ['a date after a word that is not a label', 'reborn 3.11.1990 and unborn 3.11.1990'],
  ['an order number of eleven digits', 'order 12345678901 shipped'],
  ['a PESEL with a month that does not exist', '44991401359'],
  ['a PESEL with a control digit that is wrong', '44051401358'],
  ['a PESEL with a day that does not exist', '44053201352'],
  ['a NIP with a label and a control digit that is wrong', 'NIP 1234567890'],
  ['a NIP with a control digit of ten', 'NIP 1234567810'],
  ['a NIP in one piece with no label', 'ref 1234563218'],
  ['a NIP that is the end of a longer number', 'NIP 91234563218'],
  ['an IBAN that is not one', 'PL61 1090 1014 0000 0712 1981 2875'],
  ['an account number that is not one', '61 1090 1014 0000 0712 1981 2875'],
  ['a word and a number that look like the start of an IBAN', 'ab12 cdef ghij klmn'],
  ['an address of a machine', 'ip 192.168.100.1234 and 10.0.0.1'],
  ['a count and a unit', '600 700 800 kg and 600 700 800 km'],
  ['a count in percent', '600 700 800%'],
  ['a phone with too few digits', 'tel +48'],
  ['a phone with a plus and too few digits', '+48 600 700'],
  ['a phone with an area code and no number', '+1 555'],
  ['an operator and a number', 'C++ 11 20 14'],
  ['a plus in a sum', '1+1 2 3 4 5 6 7 8'],
  ['a percentage change', 'up +30% 12 34'],
  ['an annotation', '@Override public void run() and @Autowired and @media screen'],
  ['an at-sign with no network', 'ask @anna on the channel'],
  ['a network with a word after it', 'GitHub: Actions and Twitter: tweets'],
  ['a file that looks like an address', 'logo@2x.png and icon@3x.jpg'],
  ['an address with no dot', 'user@localhost'],
  ['an address with no name', '@example.com'],
  ['an address with a top level of one letter', 'a@b.c'],
  ['an address with a local part one too long', `${'x'.repeat(65)}@example.com`],
  ['an address with a part of its domain one too long', `a@${'x'.repeat(64)}.com`],
  ['an address with a top level one too long', `a@example.${'x'.repeat(25)}`],
  ['a handle of one character', 'twitter: @a'],
  ['a handle one too long', `twitter: @${'a'.repeat(31)}`],
  ['a date of birth in the year before the first', 'born 1.1.1899'],
  ['a date of birth in the year after the last', 'born 1.1.2101'],
  ['a date of birth in month zero', 'born 3.0.1990'],
  ['a date of birth on day zero', 'born 0.3.1990'],
  ['a date of birth on the 29th of February in a year that was not a leap year', 'born 29.02.1991'],
  ['a date of birth on the 29th of February in a century that was not a leap year', 'born 29.02.1900'],
  ['a date of birth on the 31st of a month with thirty days', 'born 31.04.1990'],
  ['an amount in two spaces from its currency', '600 700 800  PLN'],
  ['an amount after a dollar sign', '$600 700 800'],
  ['an amount after a pound sign', '£600 700 800'],
  ['an amount that is a part of a longer one with dots', '1.600 700 800'],
  ['an amount that is a part of a longer one with commas', '1,600 700 800'],
  ['a host with a name of four letters in front of the one of a profile', 'abcd.x.com/foo'],
  ['a host that is the end of a longer name, with a hyphen', 'my-x.com/foo'],
  ['an address with a name too long to be one', `${'x'.repeat(70)}@example.com`],
  ['a link that is not a profile', 'https://www.example.com/jobs/12345 and https://pracuj.pl/praca/dev,123'],
  ['a link to a site and not a profile', 'github.com and linkedin.com/jobs/view/123'],
  ['a host that ends in the name of one', 'linux.com/foo and dropbox.com/s/abc'],
  ['digits in a sentence', 'We have 12 345 users in 22 countries and 100 000 more'],
  ['a phone-like run with a letter in it', '600 700 80x'],
  ['a long digit run', '1234567890123456789012345678901234567890'],
  ['an identifier-like word', 'PESEL NIP IBAN VAT born dob'],
  ['nothing', ''],
  ['space', '   \n\t  ']
];

for (const [name, text] of NOT_FOUND) {
  test(`not found: ${name}`, () => {
    assert.deepEqual(found(text), []);
  });
}

const MONTH_WORDS: readonly (readonly [number, readonly string[]])[] = [
  [31, ['january', 'stycznia', 'styczen', 'jan']],
  [28, ['february', 'lutego', 'luty', 'feb']],
  [31, ['march', 'marca', 'marzec', 'mar']],
  [30, ['april', 'kwietnia', 'kwiecien', 'apr']],
  [31, ['may', 'maja', 'maj']],
  [30, ['june', 'czerwca', 'czerwiec', 'jun']],
  [31, ['july', 'lipca', 'lipiec', 'jul']],
  [31, ['august', 'sierpnia', 'sierpien', 'aug']],
  [30, ['september', 'wrzesnia', 'wrzesien', 'sept', 'sep']],
  [31, ['october', 'pazdziernika', 'pazdziernik', 'oct']],
  [30, ['november', 'listopada', 'listopad', 'nov']],
  [31, ['december', 'grudnia', 'grudzien', 'dec']]
];

for (const [days, words] of MONTH_WORDS) {
  for (const word of words) {
    test(`found: a date of birth in ${word}, on the last day of it`, () => {
      assert.deepEqual(found(`born ${days} ${word} 1990`), [`${days} ${word} 1990`]);
      assert.deepEqual(found(`born ${word} ${days}, 1990`), [`${word} ${days}, 1990`]);
    });

    test(`not found: a date of birth in ${word}, a day after the last day of it`, () => {
      assert.deepEqual(found(`born ${days + 1} ${word} 1990`), []);
    });
  }
}

const BIRTH_LABELS = [
  'date of birth',
  'birth date',
  'birthdate',
  'birthday',
  'd.o.b.',
  'd.o.b',
  'dob',
  'born',
  'data urodzenia',
  'data ur.',
  'ur.',
  'urodzony',
  'urodzona',
  'urodzona dnia',
  'urodzony dnia',
  'urodz.'
];

for (const label of BIRTH_LABELS) {
  test(`found: a date of birth after "${label}"`, () => {
    assert.deepEqual(found(`${label} 3.11.1990`), ['3.11.1990']);
    assert.deepEqual(found(`${label}: 3.11.1990`), ['3.11.1990']);
  });
}

for (const ending of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'css', 'js']) {
  test(`not found: a name with an at sign and a ${ending} ending is a file`, () => {
    assert.deepEqual(found(`see logo@2x.${ending} here`), []);
  });
}

for (const network of ['github', 'gitlab', 'twitter', 'instagram', 'telegram', 'skype', 'linkedin']) {
  test(`found: a handle after ${network}`, () => {
    assert.deepEqual(found(`${network}: @anna_k`), ['@anna_k']);
    assert.deepEqual(found(`${network} @anna_k`), ['@anna_k']);
    assert.deepEqual(found(`${network}@anna_k`), ['@anna_k']);
  });
}

const SAMPLES: readonly (readonly [string, string, string])[] = [
  ['email', 'jan@example.com', 'email'],
  ['profile', 'github.com/annak', 'link'],
  ['handle', 'twitter: @annak', 'link'],
  ['phone with country code', '+48 600 700 800', 'phone'],
  ['polish mobile', 'tel. 600 700 800', 'phone'],
  ['polish landline', 'biuro 22 123 45 67', 'phone'],
  ['us number', '555-123-4567', 'phone'],
  ['uk number', '020 7946 0958', 'phone'],
  ['pesel', '44051401359', 'id'],
  ['nip with a label', 'NIP 1234563218', 'id'],
  ['nip by its layout', 'faktura 123-456-32-18', 'id'],
  ['iban', 'GB82 WEST 1234 5698 7654 32', 'id'],
  ['polish account number', 'konto 61 1090 1014 0000 0712 1981 2874', 'id'],
  ['date of birth', 'born 3.11.1990', 'dob']
];

for (const [detector, text, kind] of SAMPLES) {
  test(`kind: what the ${detector} detector finds is called ${kind}`, () => {
    const spans = detect(fold(text));
    assert.ok(spans.length > 0, 'something is found');
    assert.deepEqual([...new Set(spans.map((span) => span.kind))], [kind]);
  });
}

test('found: a profile inside an address is not a second thing', () => {
  assert.equal(detect(fold('write me@x.com/foo')).length, 1);
});

test('found: what a detector found is not looked at again, so what lies inside it is not a second thing', () => {
  const text = 'github.com/foo/github.com/bar';
  assert.deepEqual(detect(fold(text)).map((span) => [span.start, span.end]), [[0, text.length]]);
});

const MOBILE_PREFIXES = ['45', '50', '51', '53', '57', '60', '66', '69', '72', '73', '78', '79', '88'];

for (const prefix of MOBILE_PREFIXES) {
  test(`found: a Polish mobile that begins with ${prefix}`, () => {
    assert.deepEqual(found(`tel. ${prefix}3 456 789`), [`${prefix}3 456 789`]);
  });
}

for (const prefix of ['20', '44', '55', '59', '90', '10']) {
  test(`not found: nine digits in threes that begin with ${prefix}, which no mobile does`, () => {
    assert.deepEqual(found(`ref ${prefix}3 456 789`), []);
  });
}

const AFTER_AN_AMOUNT = ['PLN', 'zł', 'EUR', 'USD', 'GBP', 'CHF', 'CZK', '€', '$', '£', '%', 'kg', 'km', 'm2', 'm²', 'MB', 'GB', 'KB', 'ms'];

for (const unit of AFTER_AN_AMOUNT) {
  test(`not found: nine digits in threes that are an amount in ${unit}`, () => {
    assert.deepEqual(found(`600 700 800 ${unit}`), []);
    assert.deepEqual(found(`600 700 800${unit}`), []);
  });
}

/* ------------------------------------------------------- the edges of each detector */

// A table is only as good as what it was made to tell apart. Each line below is the
// one thing a pattern's edge decides, written with every other part of it right.

const MORE_FOUND: readonly (readonly [string, string, readonly string[]])[] = [
  ['an American number in brackets with a space before its last part', '(555) 123 4567', ['(555) 123 4567']],
  ['a number with its code and dots', '+48.600.700.800', ['+48.600.700.800']],
  ['an American number with its code and dots', '+1.555.123.4567', ['+1.555.123.4567']],
  ['a NIP with its country and a space', 'VAT PL 1234563218', ['PL 1234563218']],
  ['a NIP with its country, a colon and a space', 'VAT ID: PL 1234563218', ['PL 1234563218']],
  ['a NIP with hyphens that are not where its layout has them', 'NIP 12-3456-3218', ['12-3456-3218']],
  ['a NIP followed by a number after a space', 'NIP 1234563218 5', ['1234563218']],
  ['a Norwegian IBAN, the shortest', inGroups(ibanOf('NO', '86011117947')), [inGroups(ibanOf('NO', '86011117947'))]],
  ['a profile with a name of one character', 'github.com/a', ['github.com/a']],
  ['a profile with a name of the longest length', `github.com/${'a'.repeat(39)}`, [`github.com/${'a'.repeat(39)}`]],
  ['a profile with www', 'www.linkedin.com/in/anna', ['www.linkedin.com/in/anna']],
  ['a profile with a path, at the end of a sentence', 'see github.com/annak/cv-tools.', ['github.com/annak/cv-tools']],
  ['a profile with a path that ends in a slash', 'github.com/annak/cv-tools/', ['github.com/annak/cv-tools/']],
  ['a handle with a dot in it', 'twitter: @anna.k', ['@anna.k']],
  ['an address with a hyphen in its name', 'jan-kowalski@example.com', ['jan-kowalski@example.com']],
  ['an address with an underscore in its name', 'jan_kowalski@example.com', ['jan_kowalski@example.com']],
  ['an address with a percent sign in its name', 'jan%kowalski@example.com', ['jan%kowalski@example.com']]
];

for (const [name, text, expected] of MORE_FOUND) {
  test(`found: ${name}`, () => {
    assert.deepEqual(found(text), expected);
  });
}

const PESEL = '44051401359';
const IBAN_GB = 'GB82 WEST 1234 5698 7654 32';
const ACCOUNT = '61 1090 1014 0000 0712 1981 2874';

const MORE_NOT_FOUND: readonly (readonly [string, string])[] = [
  // What stands next to a number decides whether it is the number or part of a longer one.
  ['a PESEL that is the end of a longer number', `9${PESEL}`],
  ['a PESEL that is the start of a longer number', `${PESEL}9`],
  ['a Polish account number that is the end of a longer number', `9${ACCOUNT}`],
  ['a Polish account number that is the start of a longer number', `${ACCOUNT}5`],
  ['an IBAN after a letter', `x${IBAN_GB}`],
  ['an IBAN after a digit', `9${IBAN_GB}`],
  ['a NIP with a label that is the start of a longer number', 'NIP 12345632189'],
  ['a NIP by its layout after a letter', 'ab123-456-32-18'],
  ['a NIP by its layout after a digit', '9123-456-32-18'],
  ['a NIP by its layout after a hyphen', 'x-123-456-32-18'],
  ['a NIP by its layout before a hyphen', '123-456-32-18-5'],
  ['a NIP with its country by itself that is the start of a longer number', 'PL12345632189'],
  ['a Polish mobile that is the start of a longer number', '600 700 8001'],
  ['a Polish landline that is the start of a longer number', '22 123 45 678'],
  ['an American number that is the start of a longer one', '555-123-45678'],
  ['an American number in brackets that is the start of a longer one', '(555) 123-45678'],
  ['a British number that is the start of a longer one', '020 7946 09581'],
  ['a number with its code that is the start of a longer one', `+48 ${'1234567890'.repeat(3)}`],
  ['a number after a plus, as in a sum', '1+600 700 800'],
  ['a number after a hyphen', 'ref-600 700 800'],
  ['a number with its code after a second plus', '++49 30 123456'],
  ['a number with its code after a digit', '1+49 30 123456'],
  ['a handle after a word that ends in a network', 'mygithub: @annak'],
  ['a profile after a digit', '9github.com/annak'],
  // The parts of a pattern that a number must have all of.
  ['a Polish landline with an area code that begins with zero', '02 123 45 67'],
  ['a British number that begins with two zeros', '000 1234 5678'],
  ['a number with the international prefix and too few digits for any country', '0012 345 6789'],
  ['a British number with a short middle', '020 79 0958'],
  ['a British number with a short end', '020 7946 09'],
  ['a British number with a long middle and a long end', '020 79461 09581'],
  ['a profile with a name one character too long', `github.com/${'a'.repeat(40)}`],
  // What is in a word that has the shape of a label is not the label.
  ['a NIP after a word that ends in the label', 'dnip 1234563218'],
  ['a VAT number after a word that ends in the label', 'canvat 1234563218'],
  ['a tax number after a word that ends in the label', 'rust id 1234563218'],
  // An address ends where its domain does.
  ['an address followed by a dot and one letter', 'jan@example.com.x'],
  ['an address followed by a hyphen and a word', 'jan@example.com-old'],
  ['a file that has a dot before the one of its name', 'icon.v2@2x.png']
];

for (const [name, text] of MORE_NOT_FOUND) {
  test(`not found: ${name}`, () => {
    assert.deepEqual(found(text), []);
  });
}

const NIP_LABELS = [
  'nip',
  'NIP',
  'vat',
  'VAT',
  'VAT ID',
  'VAT-ID',
  'VATID',
  'VAT NO',
  'VAT NO.',
  'VAT NUMBER',
  'VAT NR',
  'TAX ID',
  'TAX-ID',
  'TAXID',
  'UST ID',
  'UST-ID',
  'USTID'
];

for (const label of NIP_LABELS) {
  test(`found: a NIP after "${label}"`, () => {
    assert.deepEqual(found(`${label} 1234563218`), ['1234563218']);
    assert.deepEqual(found(`${label}: 1234563218`), ['1234563218']);
    assert.deepEqual(found(`${label} PL 1234563218`), ['PL 1234563218']);
  });
}

for (const separator of [':', '.', '-', '#']) {
  test(`found: a NIP after its label and "${separator}"`, () => {
    assert.deepEqual(found(`NIP${separator}1234563218`), ['1234563218']);
    assert.deepEqual(found(`NIP${separator} 1234563218`), ['1234563218']);
    assert.deepEqual(found(`NIP ${separator}1234563218`), ['1234563218']);
  });
}

// A PESEL carries its century in its month, so every month that is no month is one
// of eleven, and every one that is, of ten. The control digit is right in all of them:
// a number a check refuses for two reasons is a number that proves nothing about one.
for (const month of ['00', '13', '20', '33', '40', '53', '60', '73', '80', '93', '99']) {
  test(`checked: month ${month} is no month of a PESEL`, () => {
    const pesel = withControl(`90${month}010000`);
    assert.equal(isPesel(pesel), false);
    assert.deepEqual(found(pesel), []);
  });
}

for (const month of ['01', '12', '21', '32', '41', '52', '61', '72', '81', '92']) {
  test(`checked: month ${month} is a month of a PESEL`, () => {
    const pesel = withControl(`90${month}010000`);
    assert.equal(isPesel(pesel), true);
    assert.deepEqual(found(pesel), [pesel]);
  });
}

// An IBAN is 15 to 34 characters. The check digits are right in all of these.
for (const [length, expected] of [
  [14, false],
  [15, true],
  [16, true],
  [22, true],
  [28, true],
  [31, true],
  [34, true],
  [35, false]
] as const) {
  test(`checked: an IBAN of ${length} characters ${expected ? 'is' : 'is not'} one`, () => {
    const iban = ibanOf('NO', '1234567890123456789012345678901'.slice(0, length - 4));
    assert.equal(iban.length, length);
    assert.equal(isIban(iban), expected);
    assert.equal(isIban(inGroups(iban)), expected);
    assert.deepEqual(found(`iban ${inGroups(iban)}`), expected ? [inGroups(iban)] : []);
  });
}

test('not found: ordinary text of a CV and of a posting', () => {
  const text = [
    'Senior Backend Engineer, 2018 - 2023, Warszawa. Stack: Node.js 20, TypeScript 5.4, PostgreSQL 16.',
    'Led a team of 12 engineers; reduced latency by 35% and costs by 120 000 PLN a year.',
    'Wymagania: 5+ lat doświadczenia, znajomość Spring Boot 3.2, Kafka, REST API, @Transactional.',
    'Oferujemy: 18 000 - 24 000 PLN brutto na B2B, 26 dni urlopu, pakiet 1 500 zł rocznie.',
    'B.Sc. in Computer Science, University of Warsaw, 2012 - 2015. Grade: 4.5/5.0.'
  ].join('\n');

  assert.deepEqual(found(text), []);
});

/* --------------------------------------------------------------------- checked */

test('checked: a PESEL needs its control digit, and a birth date that exists', () => {
  assert.equal(isPesel('44051401359'), true);
  assert.equal(isPesel('44051401358'), false, 'the control digit');
  assert.equal(isPesel('02070803628'), true, 'the 2000s are the month plus 20');
  assert.equal(isPesel('44051401359 '), true, 'whatever is not a digit is not counted');
  assert.equal(isPesel('4405140135'), false, 'ten digits');
  assert.equal(isPesel('440514013590'), false, 'twelve digits');
  assert.equal(isPesel('44991401359'), false, 'month 99');
  assert.equal(isPesel('44001401359'), false, 'month 00');
  assert.equal(isPesel('44131401359'), false, 'month 13');
});

test('checked: a PESEL names the century in its month, and the day must be in that month', () => {
  // The first six digits are year, month (plus the century's offset) and day.
  assert.equal(isPesel(withControl('0022290000')), true, '29 February 2000: month 22 is the 2000s, and 2000 was a leap year');
  assert.equal(isPesel(withControl('0002290000')), false, '29 February 1900: month 02 is the 1900s, and 1900 was not');
  assert.equal(isPesel(withControl('0482290000')), true, '29 February 1804: month 82 is the 1800s');
  assert.equal(isPesel(withControl('0082290000')), false, '29 February 1800: not a leap year');
  assert.equal(isPesel(withControl('0042290000')), false, '29 February 2100: month 42 is the 2100s, not a leap year');
  assert.equal(isPesel(withControl('0462310000')), false, '31 February 2204: month 62 is the 2200s, and the day is not in the month');
  assert.equal(isPesel(withControl('9004310000')), false, '31 April 1990');
  assert.equal(isPesel(withControl('9004300000')), true, '30 April 1990');
  assert.equal(isPesel(withControl('9004000000')), false, 'day 0');
});

test('checked: a NIP needs its control digit, and ten digits', () => {
  assert.equal(isNip('1234563218'), true);
  assert.equal(isNip('123-456-32-18'), true);
  assert.equal(isNip('1234563219'), false);
  assert.equal(isNip('123456321'), false);
  assert.equal(isNip('12345632180'), false);
  assert.equal(isNip('PL1234563218'), true);
  assert.equal(isNip('1234567810'), false, 'a remainder of ten is no digit');
});

test('checked: an IBAN needs its remainder, and a length that a country can have', () => {
  assert.equal(isIban('PL61 1090 1014 0000 0712 1981 2874'), true);
  assert.equal(isIban('pl61109010140000071219812874'), true);
  assert.equal(isIban('PL61 1090 1014 0000 0712 1981 2875'), false);
  assert.equal(isIban('GB82 WEST 1234 5698 7654 32'), true);
  assert.equal(isIban('DE89 3704 0044 0532 0130 00'), true);
  assert.equal(isIban('XX00 0000 0000'), false, 'too short');
  assert.equal(isIban(`PL61${'0'.repeat(40)}`), false, 'too long');
});

test('checked: a Polish account number is an IBAN once PL is put in front of it', () => {
  assert.equal(isPolishAccount('61 1090 1014 0000 0712 1981 2874'), true);
  assert.equal(isPolishAccount('61109010140000071219812874'), true);
  assert.equal(isPolishAccount('61 1090 1014 0000 0712 1981 2875'), false);
});

test('checked: what a check refuses is not used up', () => {
  // The whole run is taken for an IBAN and refused, and a real one begins inside it.
  assert.deepEqual(found('ref ab12 PL61 1090 1014 0000 0712 1981 2874'), ['PL61 1090 1014 0000 0712 1981 2874']);
  // An eleven-digit number that is no PESEL, and a Polish mobile after it.
  assert.deepEqual(found('order 12345678901 tel. 600 700 800'), ['600 700 800']);
  // A NIP-shaped run the check refuses, and a phone after it.
  assert.deepEqual(found('NIP 1234567890 tel. 600 700 800'), ['600 700 800']);
});

/* --------------------------------------------------------------------- trimmed */

test('trimmed: a number with a country code is as long as its country says', () => {
  assert.deepEqual(found('call +48 600 700 800 12 times'), ['+48 600 700 800']);
  assert.deepEqual(found('+48 22 123 45 67 2024'), ['+48 22 123 45 67']);
  assert.deepEqual(found('+1 555 123 4567 2024'), ['+1 555 123 4567']);
  assert.deepEqual(found('+44 20 7946 0958 and 12'), ['+44 20 7946 0958']);
});

test('trimmed: a number with a country code that is too short for its country is not one', () => {
  assert.deepEqual(found('+48 600 700 80'), []);
  assert.deepEqual(found('+1 555 123 456'), []);
  assert.deepEqual(found('+44 20 7946 095'), []);
});

test('trimmed: a country the table does not know takes from 8 digits to 15', () => {
  assert.deepEqual(found('+49 30 123456'), ['+49 30 123456']);
  assert.deepEqual(found('+49 30 12'), [], 'six digits');
  assert.deepEqual(found('+49 30 123'), [], 'seven digits');
  assert.deepEqual(found('+81 90 1234 5678'), ['+81 90 1234 5678']);
  assert.deepEqual(found('+81 90 1234 5678 9012'), [], 'sixteen digits');
  assert.deepEqual(found('+81 90 1234 5678 9012 3456 7890'), [], 'more than E.164 allows');
});

test('trimmed: 00 is a country code in the same way as a plus', () => {
  assert.deepEqual(found('0048 600 700 800 12'), ['0048 600 700 800']);
  assert.deepEqual(found('0049 30 123456'), ['0049 30 123456']);
  assert.deepEqual(found('0049 30 12'), []);
});

test('trimmed: an IBAN is not made longer by the word that follows it', () => {
  assert.deepEqual(found('PL61 1090 1014 0000 0712 1981 2874 more words'), ['PL61 1090 1014 0000 0712 1981 2874']);
  assert.deepEqual(found('PL61 1090 1014 0000 0712 1981 2874 4321 more'), ['PL61 1090 1014 0000 0712 1981 2874']);
  assert.deepEqual(found('GB82 WEST 1234 5698 7654 32 is a UK IBAN'), ['GB82 WEST 1234 5698 7654 32']);
});

/* ----------------------------------------------------------------------- shape */

test('shape: no pattern has a capturing group, because the vault tells its seeds apart by group', () => {
  // `source|` matches the empty text by its second branch, and says how many groups the first has.
  for (const { name, source } of detectors) {
    assert.equal(new RegExp(`${source}|`, 'u').exec('')?.length, 1, `${name} has a capturing group`);
  }
});

test('shape: the detectors are those that were meant, once each', () => {
  assert.deepEqual(
    detectors.map(({ name }) => name),
    [
      'email',
      'profile',
      'handle',
      'phone with country code',
      'polish mobile',
      'polish landline',
      'us number',
      'uk number',
      'pesel',
      'nip with a label',
      'nip by its layout',
      'iban',
      'polish account number',
      'date of birth'
    ]
  );
  assert.deepEqual([...new Set(detectors.map(({ kind }) => kind))].sort(), ['dob', 'email', 'id', 'link', 'phone']);
});

test('shape: what each detector is for is what it finds, alone', () => {
  const kindOf = (text: string): string[] => taken(text).map((span) => span.kind);

  assert.deepEqual(kindOf('jan@example.com'), ['email']);
  assert.deepEqual(kindOf('github.com/annak'), ['link']);
  assert.deepEqual(kindOf('twitter: @annak'), ['link']);
  assert.deepEqual(kindOf('+48 600 700 800'), ['phone']);
  assert.deepEqual(kindOf('44051401359'), ['id']);
  assert.deepEqual(kindOf('born 3.11.1990'), ['dob']);
});

test('shape: no guard hides what its detector would have found', () => {
  // A guard is a saving and nothing else, so a text gives the same with all of them off.
  const texts = [...FOUND.map(([, text]) => text), ...NOT_FOUND.map(([, text]) => text)];
  for (const text of texts) assert.deepEqual(detect(fold(text), false), detect(fold(text)), text);
});

test('shape: a text with none of what a guard looks for does not reach the pattern', () => {
  assert.deepEqual(detect(fold('plain words and nothing else'), false), []);
  assert.deepEqual(detect(fold('plain words and nothing else')), []);
});

test('shape: a text a hundred times as long takes about a hundred times as long, and not ten thousand', () => {
  const adversarial = [
    '1'.repeat(200_000),
    '0'.repeat(200_000),
    '+1'.repeat(100_000),
    '+48 6'.repeat(40_000),
    'a'.repeat(200_000),
    `${'a.'.repeat(100_000)}@`,
    'a@'.repeat(100_000),
    '1-'.repeat(100_000),
    '12 345 '.repeat(30_000),
    'pl61 1090 '.repeat(20_000),
    '(555) '.repeat(40_000),
    'born '.repeat(40_000),
    'born 1.1.1'.repeat(20_000),
    'github.com/'.repeat(20_000),
    'x.com/a'.repeat(30_000)
  ];

  const started = performance.now();
  for (const text of adversarial) detect(fold(text));
  const seconds = (performance.now() - started) / 1000;

  assert.ok(seconds < 10, `fifteen texts of 200 thousand characters took ${seconds.toFixed(1)} s`);
});
