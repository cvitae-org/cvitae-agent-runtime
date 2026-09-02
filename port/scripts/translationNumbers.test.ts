/**
 * What the number guard lets through, and what it stops.
 *
 * The guard is the only thing standing between a model and a CV that claims a
 * different figure than the one its owner wrote, so it has to stay strict about
 * numbers while staying quiet about word order. Those two pull against each
 * other, and the first version resolved them the wrong way: it compared the
 * numbers as a sequence, which refused nearly every dated bullet on the
 * grounds that English puts the year at the end.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { numberDrift } from '../src/capabilities/translateCv.js';

test('reordering the same numbers is not drift', () => {
  // Polish fronts the time adverbial, English trails it. This is the shape of
  // the false positive that made the guard unusable: `2020|30` against
  // `30|2020`, every figure present, the bullet correct, the section refused.
  assert.equal(
    numberDrift(
      'W 2020 roku zwiększyłem sprzedaż o 30%.',
      'Increased sales by 30% in 2020.'
    ),
    null
  );

  assert.equal(
    numberDrift(
      'Od 2019 do 2023 prowadziłem 4 projekty.',
      'Led 4 projects from 2019 to 2023.'
    ),
    null
  );
});

test('formatting that does not change the digits is not drift', () => {
  // Thousands and decimal separators differ between the two languages, and the
  // tokens fall the same way either side, which is why they may.
  assert.equal(
    numberDrift('Obsługiwałem 1 500 000 zapytań dziennie.', 'Handled 1,500,000 requests per day.'),
    null
  );
  assert.equal(numberDrift('Dostępność na poziomie 99,9%.', 'Availability of 99.9%.'), null);
});

test('a number that disappears is named', () => {
  // Spelling a digit out loses it. The prompt forbids this; the guard is what
  // happens when the model does it anyway.
  assert.equal(
    numberDrift('Zespół liczący 5 osób.', 'A team of five people.'),
    '5 went missing'
  );
});

test('a number that was never in the source is named', () => {
  assert.equal(
    numberDrift('Zwiększyłem sprzedaż.', 'Increased sales by 30%.'),
    '30 was not in the source'
  );
});

test('a number that was altered names both halves', () => {
  // The failure the guard exists for: a CV that claims a figure its owner did
  // not write. The message has to carry both numbers, because "changed a
  // number in experience.0.highlights.7" is not something a reader can act on.
  assert.equal(
    numberDrift('Zwiększyłem sprzedaż o 30%.', 'Increased sales by 50%.'),
    '30 became 50'
  );
});

test('repeated numbers are counted, not just matched', () => {
  // A multiset, not a set. Dropping one of two identical figures is still a
  // dropped figure, and a set comparison would call this unchanged.
  assert.equal(
    numberDrift('2 zespoły po 2 osoby.', 'Two teams of 2 people.'),
    '2 went missing'
  );
});

test('an inversion passes, which is the trade this makes', () => {
  // Documented rather than defended. The same two numbers in the other order
  // is a real error and this does not catch it — the alternative, refusing
  // every reordered bullet, refused far more work that was correct. The
  // preview is where a reader catches this one.
  assert.equal(
    numberDrift('Migracja z Pythona 2 na Pythona 3.', 'Migration from Python 3 to Python 2.'),
    null
  );
});
