/**
 * Preferences, salary parsing and the scorer.
 *
 * These assertions are not new. They were written against the old runtime and
 * put in `scripts/smoke.ts`, which `scripts/*.test.ts` does not match — so a
 * commit titled "Cover the shortlist" added eight checks that `pnpm test` has
 * never once run. They are carried here, as tests, against the ported modules.
 *
 * Nothing below touches a model or a network. The whole point of this half of
 * the pipeline is that a score is deterministic: two runs over the same offer
 * and the same requirements must agree, or "which offers need rescoring?"
 * cannot be answered by comparing fingerprints.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfferRecord } from '../src/contracts/index.js';
import {
  emptyPreferences,
  fingerprintPreferences,
  preferencesSchema
} from '../src/capabilities/offers/preferences.js';
import { parseSalary } from '../src/capabilities/offers/salary.js';
import { evaluate } from '../src/capabilities/offers/criteria.js';

const AT = 1_760_000_000_000;

const prefs = preferencesSchema.parse({
  work_mode: { strength: 'must', accept: ['remote', 'hybrid'] },
  contract_type: { strength: 'prefer', accept: ['b2b', 'uop'] },
  salary: { strength: 'must', floor: 22000, currency: 'PLN', period: 'month', basis: 'any' },
  skills: { strength: 'prefer', require: ['React', 'TypeScript', 'Go'] }
});

const offer = (over: Partial<OfferRecord> = {}): OfferRecord => ({
  id: 'scored',
  position: 'Senior Frontend Developer',
  company: 'Acme',
  location: 'Warsaw',
  workMode: 'remote',
  seniority: 'Senior',
  contractType: 'B2B',
  salary: '20 000 - 25 000 PLN',
  salaryReading: { min: 20000, max: 25000, currency: 'PLN', period: 'month' },
  skills: ['React', 'TypeScript', 'Node.js'],
  text: 'A posting.',
  firstSeenAt: AT,
  lastSeenAt: AT,
  processing: 'fetched',
  disposition: 'active',
  ...over
});

const salaryVerdict = (result: ReturnType<typeof evaluate>) =>
  result.detail.criteria.find((c) => c.criterion === 'salary');

/* ------------------------------------------------------------ preferences -- */

test('the defaults state nothing, and therefore filter nothing', () => {
  const empty = emptyPreferences();
  assert.equal(empty.work_mode.accept.length, 0);
  assert.equal(empty.salary.floor, null);
  assert.equal(empty.skills.require.length, 0);
});

/**
 * The fingerprint decides which offers need rescoring. Rewriting the document
 * without changing what it asks for must not invalidate every score on disk.
 */
test('the fingerprint follows the ask, not the file', () => {
  const touched = preferencesSchema.parse({ ...prefs, updated_at: '2026-09-02T10:00:00.000Z' });
  assert.equal(fingerprintPreferences(touched), fingerprintPreferences(prefs));

  const raised = preferencesSchema.parse({ ...prefs, salary: { ...prefs.salary, floor: 25000 } });
  assert.notEqual(fingerprintPreferences(raised), fingerprintPreferences(prefs));
});

/**
 * A floor with no currency is a number, not a requirement: 15000 is a different
 * ask in PLN and in EUR. Parsed cleanly it would evaluate to `unknown` on every
 * offer forever — a stated preference that silently never fires, which is worse
 * than a rejected file.
 */
test('a floor without a currency is refused rather than stored', () => {
  assert.throws(() =>
    preferencesSchema.parse({ salary: { floor: 22000, currency: '', period: 'month' } })
  );
  assert.throws(() =>
    preferencesSchema.parse({ salary: { floor: 22000, currency: 'PLN', period: '' } })
  );
});

/* ----------------------------------------------------------------- salary -- */

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
 * becomes a two-zloty lower bound, and every floor comparison then passes.
 */
test('a digit that is not money is not read as money', () => {
  assert.equal(parseSalary('18 000 - 24 000 PLN B2B').min, 18000);
  assert.equal(parseSalary('20 000 PLN + 5 000 bonus').min, 20000);
});

/* ---------------------------------------------------------------- scoring -- */

test('an offer meeting every must is eligible', () => {
  const result = evaluate(offer(), prefs);
  assert.equal(result.eligibility, 'eligible');
  // Five of six decided criteria pass; Go is the one the posting never names.
  assert.equal(result.fit, 0.83);
  assert.equal(result.completeness, 1);
});

test('a failed must is ineligible', () => {
  assert.equal(evaluate(offer({ workMode: 'onsite' }), prefs).eligibility, 'ineligible');
});

/**
 * The distinction the whole design turns on. A posting that says nothing about
 * money has not failed a salary requirement, and a scorer forced to answer yes
 * or no will say one of those two things about it.
 */
test('an unstated salary is provisional, not ineligible', () => {
  const silent = evaluate(offer({ salary: '', salaryReading: undefined }), prefs);

  assert.equal(silent.eligibility, 'provisional');
  assert.equal(salaryVerdict(silent)?.verdict, 'unknown');

  // Four of five decided, not four of six: the unknown leaves the denominator
  // rather than counting as a miss.
  assert.equal(silent.fit, 0.8);

  // While completeness records that something is missing, so the two numbers
  // disagree in the way they are meant to.
  assert.ok(silent.completeness < 1);
  assert.ok(silent.detail.missing.includes('salary'));
});

/**
 * Same numbers, different money. The gap between a B2B rate and a permanent
 * salary depends on tax choices this runtime does not know, so there is no
 * honest multiplier — and therefore no comparison.
 */
test('a B2B figure against a permanent-contract floor is unknown, not a pass', () => {
  const uopFloor = preferencesSchema.parse({
    ...prefs,
    salary: { ...prefs.salary, basis: 'uop' }
  });
  const result = evaluate(offer({ contractType: 'B2B' }), uopFloor);

  assert.equal(salaryVerdict(result)?.verdict, 'unknown');
});

/**
 * The failure a single matched-over-named ratio would have hidden: a posting
 * that states one thing and matches it is not a better offer than one that
 * states five and matches four.
 */
test('a vague posting reads as high fit and low completeness', () => {
  const vague = evaluate(
    offer({
      salary: '',
      salaryReading: undefined,
      contractType: '',
      seniority: '',
      location: '',
      skills: []
    }),
    prefs
  );

  assert.equal(vague.fit, 1);
  assert.equal(vague.completeness, 0.43);
  assert.equal(vague.eligibility, 'provisional');
});

/**
 * An unset slot must produce no criterion at all rather than an undecidable
 * one. "I don't care about contract type" and "I care and the offer didn't
 * say" must not both come out as provisional, or every offer would be
 * provisional for every user who left a field blank.
 */
test('a requirement nobody stated does not make every offer provisional', () => {
  const result = evaluate(offer({ salary: '', salaryReading: undefined }), emptyPreferences());

  assert.equal(result.detail.criteria.length, 0);
  assert.equal(result.eligibility, 'eligible');
});

/** The same inputs must produce the same score, or rescoring never converges. */
test('scoring is deterministic', () => {
  const a = evaluate(offer(), prefs);
  const b = evaluate(offer(), prefs);
  assert.deepEqual(a, b);
});
