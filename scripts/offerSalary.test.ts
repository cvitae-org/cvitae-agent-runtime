/**
 * Salary parsing.
 *
 * Discovery, enrichment and the offer query projection all turn a posting's
 * salary line into figures with it, and the projection's figures are what an
 * offer query reads. Nothing below touches a model or a network: a line
 * parses the same way every time, or two readings of one posting disagree
 * about what it pays.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSalary } from '../src/capabilities/offers/salary.js';

test('salary lines parse to figures, or to nothing', () => {
  const cases: [string, ReturnType<typeof parseSalary>][] = [
    ['20 000 - 25 000 PLN netto/mies.', { min: 20000, max: 25000, currency: 'PLN', period: 'month' }],
    ['20-25k PLN', { min: 20000, max: 25000, currency: 'PLN', period: '' }],
    ['1 200 - 1 600 PLN/dzien B2B', { min: 1200, max: 1600, currency: 'PLN', period: 'day' }],
    ['od 20 000 zl', { min: 20000, max: null, currency: 'PLN', period: '' }],
    ['do 25 000 zl', { min: null, max: 25000, currency: 'PLN', period: '' }],
    ['$120,000 - $150,000 per year', { min: 120000, max: 150000, currency: 'USD', period: 'year' }],
    ['Not stated', { min: null, max: null, currency: '', period: '' }]
  ];

  for (const [line, want] of cases) {
    assert.deepEqual(parseSalary(line), want, line);
  }
});

/**
 * `b2b` carries a digit and sits on most Polish salary lines. Read naively it
 * becomes a two-zloty lower bound, and every filter on the lowest figure then
 * lets the posting through.
 */
test('a digit that is not money is not read as money', () => {
  assert.equal(parseSalary('18 000 - 24 000 PLN B2B').min, 18000);
  assert.equal(parseSalary('20 000 PLN + 5 000 bonus').min, 20000);
});
