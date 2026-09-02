/**
 * The shape of the plan, which is where this capability's guarantees live.
 *
 * Three of them matter enough to pin down: that verification makes no model
 * call unless one is explicitly asked for, that asking for one beside a
 * board-stated website buys nothing and so is not done, and that the web tier
 * is present by default — it is the difference between checking one source and
 * answering the question.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inputSchema, verifyRecipient } from '../src/capabilities/verifyRecipient.js';
import type { RunContext } from '../src/core/types.js';

/** `plan` touches nothing when the offer text is supplied. */
const stub = (): RunContext =>
  ({ store: {}, tools: {}, input: {}, completed: {} }) as unknown as RunContext;

const planFor = async (input: unknown) =>
  verifyRecipient.plan(inputSchema.parse(input), stub());

const base = {
  offerText: 'Lead Developer at Upvanta. Remote.',
  company: 'Upvanta',
  position: 'Lead Developer'
};

test('by default the whole verification makes no model call', async () => {
  const plan = await planFor(base);

  // Asserted as a property rather than a count: the tier list grows, and a
  // test that breaks when it does says nothing about what it was protecting.
  assert.ok(plan.steps.every((step) => step.kind === 'transform'));
});

test('the web tier is on by default and can be turned off', async () => {
  const on = await planFor(base);
  const off = await planFor({ ...base, check_web: false });

  // Both steps: one asks the engine, the other opens what it pointed at.
  assert.ok(on.steps.some((step) => step.name === 'web_lookup'));
  assert.ok(on.steps.some((step) => step.name === 'web_pages'));

  // Off is a run-time skip rather than a missing step, so the payload still
  // reports the tier and says why it did nothing.
  assert.ok(off.steps.some((step) => step.name === 'web_lookup'));
});

test('the web tier costs no model call', async () => {
  const plan = await planFor(base);

  const web = plan.steps.filter((step) => step.name.startsWith('web_'));

  assert.equal(web.length, 2);
  assert.ok(web.every((step) => step.kind === 'transform'));
  assert.ok(web.every((step) => step.critical === false));
});

test('the employer domain is established before pages are opened against it', async () => {
  // `web_pages` decides whether a page is the employer's own or a stranger's by
  // comparing domains, so it cannot run until `company_site` has settled one.
  const plan = await planFor(base);
  const order = plan.steps.map((step) => step.name);

  assert.ok(order.indexOf('web_lookup') < order.indexOf('company_site'));
  assert.ok(order.indexOf('company_site') < order.indexOf('web_pages'));
  assert.ok(order.indexOf('web_pages') < order.indexOf('rank'));
});

test('a company name alone is enough to ask for a verification', async () => {
  // It was not before: with no offer text and no URL there was nothing to read,
  // and now there is a search to run.
  assert.doesNotThrow(() => inputSchema.parse({ company: 'Upvanta' }));
  assert.throws(() => inputSchema.parse({ position: 'Lead Developer' }));
});

test('search is added only when it is asked for', async () => {
  const without = await planFor(base);
  const with_ = await planFor({ ...base, search_web: true });

  assert.ok(!without.steps.some((step) => step.name === 'web_search'));

  const search = with_.steps.find((step) => step.name === 'web_search');

  assert.ok(search);
  assert.equal(search.kind, 'extract');
  // Never fatal: a verification that skipped the search is worth far more than
  // an error in front of someone about to send a CV.
  assert.equal(search.critical, false);
});

test('search is skipped when the board already stated the website', async () => {
  // A stated anchor outranks anything a search can propose, so paying for a
  // model call beside one buys nothing.
  const plan = await planFor({
    ...base,
    search_web: true,
    company_url: 'https://upvanta.com'
  });

  assert.ok(!plan.steps.some((step) => step.name === 'web_search'));
});

test('search is skipped when there is no company name to search for', async () => {
  const plan = await planFor({
    offerText: 'Lead Developer. Remote.',
    search_web: true
  });

  assert.ok(!plan.steps.some((step) => step.name === 'web_search'));
});

test('the search step asks for a website and never for an address', async () => {
  // The distinction the whole tier rests on. Asked for an address, a model
  // reports what a stranger's page claims; asked for a domain, the worst it can
  // do is point somewhere that then gets checked.
  const plan = await planFor({ ...base, search_web: true });
  const search = plan.steps.find((step) => step.name === 'web_search');

  assert.ok(search && search.kind === 'extract');

  const prompt = `${search.system} ${search.prompt}`.toLowerCase();

  assert.ok(!prompt.includes('email'));
  assert.ok(!prompt.includes('address'));
  assert.ok(!prompt.includes('contact'));
  assert.match(search.system, /website/i);
});

test('transforms run after the search, so they can read it', async () => {
  const plan = await planFor({ ...base, search_web: true });
  const kinds = plan.steps.map((step) => step.kind);

  assert.equal(kinds[0], 'extract');
  assert.ok(kinds.slice(1).every((kind) => kind === 'transform'));
});
