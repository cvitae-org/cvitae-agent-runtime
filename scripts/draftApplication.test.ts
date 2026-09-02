/**
 * The parts of `draft_application` that do not need a model.
 *
 * Which, by design, is most of it. The recipient, the subject and every check
 * on the finished draft are deterministic — that split is the capability's
 * central claim, and it is also what makes this file able to assert anything
 * useful. The one model call is isolated behind a step boundary and stubbed.
 *
 * Two assertions here are about the shape of the plan rather than its output,
 * and both are guarding a decision that a later reader would plausibly undo.
 * The body is a `generate` step and not an `extract` one, which looks like an
 * inconsistency with every other capability in the tree and is a measurement
 * (the table is in `GenerateStep`). And the plan spends exactly one model call,
 * which is the difference between this capability and the obvious version of it
 * that also asks a model for the subject and the address.
 *
 * The rest is the promise. `confirmation_required` is asserted through
 * `aggregate` directly rather than through a run, because the case that matters
 * is the one a run cannot easily produce: the review step absent. A payload
 * that omits the field is indistinguishable from one that never made the
 * promise, and an interface reading its absence as permission is the failure
 * this capability exists to prevent.
 *
 * Mutations run, not assumed. Each was applied, the whole suite run, the
 * failures counted, and the mutation reverted:
 *
 *   `confirmation_required` dropped      2  the draft is never presented … /
 *                                           the promise survives a review …
 *   a degraded review loses the body     1  a degraded review does not lose …
 *   no custom aggregate at all           4  the two above, plus
 *                                           ranked passages are preferred … /
 *                                           the draft is never presented …
 *   the retrieval fallback returns []    3  a retriever that fails is stepped … /
 *                                           a supplied candidate is used … /
 *                                           with nothing indexed the prompt …
 *   a failing retriever fails the run    1  a retriever that fails is stepped …
 *   the output ceiling is fixed          1  the output ceiling follows the word …
 *   the Polish subject template dropped  1  a Polish draft gets a Polish subject
 *   the candidate is always read         3  a supplied candidate is used … (+2 smoke)
 *   the body step is not critical        1  a letter that could not be written …
 *   the review gets no known values      1  the review fills what the runtime …
 *   the subject is not flattened         1  a newline in the subject is flattened …
 *   unattended mailboxes not excluded    1  unattended mailboxes are excluded
 *   asset filenames not excluded         1  asset filenames are not mistaken …
 *   recruiting addresses not ranked      1  recruitment addresses are offered …
 *   the short-body floor removed         1  a body too short to send is flagged
 *   angle brackets swallow an address    1  an address in angle brackets is not …
 *
 * Two of these need reading rather than counting. Removing the custom
 * `aggregate` altogether kills four, which is the case for having written one:
 * the default merge loses the unconditional promise, loses the fallback to the
 * raw body, and — because a merge folds every step's whole output under that
 * step's own keys — publishes the `source` step's working material while the
 * named result field it was gathered for never appears. And the candidate
 * mutation is the only one here that also breaks the smoke suite, because the
 * fixture passes a candidate against an empty database, so the store branch
 * throws where the smoke run expects a result.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { CV_ID, CV_KIND } from '../src/capabilities/cv/document.js';
import { draftApplication, inputSchema, subjectFor } from '../src/capabilities/apply/draft.js';
import {
  countWords,
  findApplicationEmails,
  reviewDraft,
  reviewPlaceholders
} from '../src/capabilities/apply/text.js';
import { startRun } from '../src/runtime/run.js';
import { spine, type Spine } from './support/spine.js';
import type { AiGateway, Retriever, StepOutcome, TextRequest } from '../src/contracts/index.js';

/* ------------------------------------------------------------- recipients */

test('an application address is found in offer prose', () => {
  assert.deepEqual(
    findApplicationEmails('Send your CV to rekrutacja@firma.pl before the end of the month.'),
    ['rekrutacja@firma.pl']
  );
});

test('recruitment addresses are offered before general ones', () => {
  assert.deepEqual(
    findApplicationEmails('General enquiries: kontakt@firma.pl. Applications: jobs@firma.pl.'),
    ['jobs@firma.pl', 'kontakt@firma.pl']
  );
});

test('asset filenames are not mistaken for addresses', () => {
  // A retina sprite parses as an email perfectly: local part, domain, and three
  // alphabetic characters of "TLD". Board pages are full of them.
  assert.deepEqual(
    findApplicationEmails('background: url(/static/logo@2x.png); apply at hr@firma.pl'),
    ['hr@firma.pl']
  );
});

test('unattended mailboxes are excluded', () => {
  // Writing an application to one is the same outcome as writing to nobody,
  // minus the chance of noticing.
  assert.deepEqual(
    findApplicationEmails('Sent from no-reply@board.com. Questions to kontakt@firma.pl.'),
    ['kontakt@firma.pl']
  );
});

test('addresses are deduplicated and stripped of trailing punctuation', () => {
  assert.deepEqual(
    findApplicationEmails('Write to kontakt@firma.pl, or to kontakt@firma.pl. Thanks.'),
    ['kontakt@firma.pl']
  );
});

test('no address is a legitimate answer, not an error', () => {
  assert.deepEqual(findApplicationEmails('Apply through the button below.'), []);
});

/* ------------------------------------------------------------ placeholders */

test('known placeholders are filled and reported', () => {
  const reviewed = reviewPlaceholders('Dear [Company Name] team,\n\nRegards,\n[Your Name]', {
    name: 'Jan Kowalski',
    company: 'Acme'
  });

  assert.match(reviewed.text, /Dear Acme team/);
  assert.match(reviewed.text, /Regards,\nJan Kowalski/);
  assert.deepEqual(reviewed.remaining, []);
  assert.equal(reviewed.filled.length, 2);
});

test('an unknown placeholder is reported rather than deleted', () => {
  // An empty gap where a value belongs reads as a typo; the bracket reads as
  // what it is, and the person sending has to see it to fix it.
  const reviewed = reviewPlaceholders('We spoke about [Project X] last week.', { name: 'Jan' });

  assert.equal(reviewed.text, 'We spoke about [Project X] last week.');
  assert.deepEqual(reviewed.remaining, ['[Project X]']);
});

test('placeholder spelling variants resolve to the same value', () => {
  const reviewed = reviewPlaceholders('{{YOUR_NAME}} and [Your name]', { name: 'Jan' });

  assert.equal(reviewed.text, 'Jan and Jan');
  assert.equal(reviewed.filled.length, 2);
});

test('an address in angle brackets is not treated as a placeholder', () => {
  const reviewed = reviewPlaceholders('Reply to <Jan@example.com> directly.', { name: 'Jan' });

  assert.equal(reviewed.text, 'Reply to <Jan@example.com> directly.');
  assert.deepEqual(reviewed.filled, []);
  // Not reported either. A warning naming a quoted address as an unfilled
  // placeholder teaches the reader to ignore the warnings.
  assert.deepEqual(reviewed.remaining, []);
});

/* -------------------------------------------------------------- the review */

/** A body long enough to clear the "too short to send" floor. */
const body = (words: number): string => Array.from({ length: words }, () => 'word').join(' ');

test('a newline in the subject is flattened before it can become a header', () => {
  const reviewed = reviewDraft({
    subject: 'Application\r\nBcc: someone@else.test',
    body: body(60),
    known: {}
  });

  assert.ok(!reviewed.subject.includes('\n'));
  assert.ok(!reviewed.subject.includes('\r'));
});

test('a body too short to send is flagged', () => {
  const reviewed = reviewDraft({ subject: 'Application', body: body(10), known: {} });

  assert.equal(reviewed.warnings.length, 1);
  assert.match(reviewed.warnings[0] ?? '', /10 words/);
});

test('a model that answers the operator instead of the reader is flagged', () => {
  const reviewed = reviewDraft({
    subject: 'Application',
    body: `Sure! Here is the letter. ${body(60)}`,
    known: {}
  });

  assert.match(reviewed.warnings.join(' '), /addressing the request/);
});

test('operator-facing commentary is flagged', () => {
  const reviewed = reviewDraft({
    subject: 'Application',
    body: `${body(60)} Hope this helps!`,
    known: {}
  });

  assert.match(reviewed.warnings.join(' '), /commentary aimed at the operator/);
});

test('a clean draft produces no warnings', () => {
  const reviewed = reviewDraft({ subject: 'Application', body: body(60), known: {} });

  assert.deepEqual(reviewed.warnings, []);
});

test('countWords ignores surrounding whitespace', () => {
  assert.equal(countWords('  one   two \n three  '), 3);
});

/* ------------------------------------------------------------- the subject */

test('the subject carries the position and the name, in that order', () => {
  assert.equal(
    subjectFor('Senior Frontend Engineer', 'Jan Kowalski', 'en'),
    'Application for Senior Frontend Engineer — Jan Kowalski'
  );
});

test('a Polish draft gets a Polish subject', () => {
  assert.equal(
    subjectFor('Starszy Programista Frontend', 'Jan Kowalski', 'pl'),
    'Aplikacja na stanowisko: Starszy Programista Frontend — Jan Kowalski'
  );
});

test('a language with no template of its own gets the English lead', () => {
  // Named rather than hidden: this is the capability's one real limit, and a
  // German applicant gets an English subject line over a German letter.
  assert.equal(subjectFor('Softwareentwickler', 'Jan Kowalski', 'de'),
    'Application for Softwareentwickler — Jan Kowalski');
});

/* ----------------------------------------------------------------- the run */

const CV = {
  version: 1 as const,
  personal: {
    name: 'Jan Kowalski',
    email: 'jan@example.test',
    phone: '+48 600 000 000',
    location: 'Warszawa',
    links: {}
  },
  role_description: 'Frontend developer with eight years of React.',
  skills: {
    role: 'Frontend Developer',
    programming_languages: ['TypeScript'],
    frameworks: ['React'],
    libraries_and_tools: []
  },
  experience: [
    {
      company: 'Acme',
      title: 'Senior Frontend',
      started: '2020',
      finished: null,
      highlights: ['Rebuilt the checkout in React, cutting load time in half.'],
      skills: []
    }
  ],
  education: [],
  certificates: [],
  languages: [],
  sources: []
};

const OFFER = 'Senior Frontend Engineer at Acme. React, TypeScript. Send your CV to jobs@acme.test.';

/** What the model was asked, so a test can assert on the prompt it received. */
type Asked = { readonly requests: TextRequest[] };

const harness = async <T>(
  options: { answer?: string; throws?: string; retrieval?: Retriever },
  run: (s: Spine, asked: Asked) => Promise<T>
): Promise<T> => {
  const requests: TextRequest[] = [];

  const ai: Partial<AiGateway> = {
    generateText: async (request) => {
      requests.push(request);
      if (options.throws) throw new Error(options.throws);
      return {
        text: options.answer ?? `Dear [Company Name], ${body(60)} Regards, [Your Name]`,
        finishReason: 'stop',
        usage: {}
      };
    }
  };

  const s = spine(capabilities, {
    ai,
    ...(options.retrieval ? { retrieval: options.retrieval } : {})
  });

  try {
    return await run(s, { requests });
  } finally {
    s.dispose();
  }
};

const draft = (s: Spine, input: Record<string, unknown> = {}) =>
  startRun(s.deps, {
    capability: 'draft_application',
    input: {
      offerText: OFFER,
      offer: { position: 'Senior Frontend Engineer', company: 'Acme' },
      ...input
    }
  });

/** Writes the CV, so the projection step has something to read. */
const seed = (s: Spine) => s.deps.documents.update(CV_ID, CV_KIND, () => CV);

test('the plan makes exactly one model call, and it is the body', async () => {
  await harness({}, async (s) => {
    seed(s);
    const result = await draft(s);

    const model = result.outcomes.filter((outcome) => outcome.step === 'body');

    assert.equal(model.length, 1);
    assert.equal(result.outcomes.length, 4, 'the plan gained or lost a step');
  });
});

test('the body is generated as prose, never through a schema', async () => {
  // Not a stylistic assertion. As an `extract` step this failed on every model
  // and every prompt variant measured — see `GenerateStep`. Someone converting
  // it back for consistency with the other capabilities should land here.
  const plan = await draftApplication.plan(
    inputSchema.parse({ offerText: OFFER }),
    undefined as never
  );

  const step = plan.stages.flatMap((stage) => stage.steps).find((entry) => entry.name === 'body');

  assert.equal(step?.kind, 'generate');
});

test('the plan is built without reading the run context', async () => {
  // The offer fetch is a step, not planning work: inside `plan()` it would be
  // outside the run's timing, its failure policy and its events.
  const forbidden = new Proxy({}, { get: () => { throw new Error('plan read the context'); } });

  assert.doesNotThrow(() =>
    draftApplication.plan(inputSchema.parse({ url: 'https://example.test/x' }), forbidden as never)
  );
});

test('the recipient is parsed from the offer, not generated', async () => {
  await harness({}, async (s) => {
    seed(s);
    const result = await draft(s);

    assert.deepEqual(result.data.to_suggestion, ['jobs@acme.test']);
  });
});

test('the review fills what the runtime already knew', async () => {
  await harness({}, async (s) => {
    seed(s);
    const result = await draft(s);

    assert.equal(result.data.subject, 'Application for Senior Frontend Engineer — Jan Kowalski');
    assert.match(String(result.data.body), /Dear Acme,/);
    assert.match(String(result.data.body), /Regards, Jan Kowalski/);
    assert.deepEqual(result.data.warnings, []);
  });
});

test('the draft is never presented as ready to send', async () => {
  await harness({}, async (s) => {
    seed(s);
    assert.equal((await draft(s)).data.confirmation_required, true);
  });
});

test('a letter that could not be written fails the run', async () => {
  // The one critical step. Unlike a missing salary reading there is no useful
  // partial result here: a draft with no body is not a draft, and returning the
  // subject and the address alone would look like a result.
  await harness({ throws: 'the model is unreachable' }, async (s) => {
    seed(s);
    await assert.rejects(() => draft(s), /the model is unreachable/);
  });
});

test('with nothing indexed the prompt still carries the CV bullets', async () => {
  // The state on a machine whose provider cannot embed. An unranked handful of
  // recent bullets writes a decent letter; no bullets writes a generic one.
  await harness({}, async (s, asked) => {
    seed(s);
    await draft(s);

    assert.match(asked.requests[0]?.prompt ?? '', /Rebuilt the checkout in React/);
  });
});

test('a retriever that fails is stepped around, not fatal', async () => {
  const broken: Retriever = { search: async () => { throw new Error('no embedder'); } };

  await harness({ retrieval: broken }, async (s, asked) => {
    seed(s);
    const result = await draft(s);

    assert.equal(result.degraded.length, 0, 'a missing embedder degraded a step');
    assert.match(asked.requests[0]?.prompt ?? '', /Rebuilt the checkout in React/);
  });
});

test('ranked passages are preferred over CV order', async () => {
  const ranked: Retriever = {
    search: async () => [
      {
        id: 'c0',
        documentId: CV_ID,
        kind: 'highlight',
        text: 'Cut the checkout bundle by 40% at Acme.',
        position: 0,
        meta: { company: 'Acme', title: 'Senior Frontend' },
        score: 1,
        found: ['lexical'] as const
      }
    ]
  };

  await harness({ retrieval: ranked }, async (s, asked) => {
    seed(s);
    const result = await draft(s);

    assert.match(asked.requests[0]?.prompt ?? '', /Cut the checkout bundle/);
    assert.ok(!(asked.requests[0]?.prompt ?? '').includes('Rebuilt the checkout'));

    // Provenance, so a reader can tell a retrieved claim from an invented one.
    const used = result.data.used_passages as { text: string }[];
    assert.equal(used[0]?.text, 'Cut the checkout bundle by 40% at Acme.');
  });
});

test('the output ceiling follows the word ceiling, over a fixed allowance', async () => {
  await harness({}, async (s, asked) => {
    seed(s);
    await draft(s, { max_words: 300 });

    // The allowance is not padding. `gemma4:12b` reasons before it writes and
    // the reasoning is billed against the same ceiling, so the shipped default
    // of 180 words returned `length` with zero characters of letter until this
    // was measured and raised. See `THINKING_ALLOWANCE`.
    assert.equal(asked.requests[0]?.maxOutputTokens, 300 * 3 + 900);
  });

  await harness({}, async (s, asked) => {
    seed(s);
    await draft(s, { max_words: 180 });

    assert.equal(asked.requests[0]?.maxOutputTokens, 180 * 3 + 900);
  });
});

test('a caller with no candidate and no stored CV gets a legible error', async () => {
  await harness({}, async (s) => {
    await assert.rejects(() => draft(s), /no stored CV/);
  });
});

test('a supplied candidate is used instead of the stored one', async () => {
  await harness({}, async (s, asked) => {
    seed(s);
    await draft(s, {
      candidate: { name: 'Ada Lovelace', experience: [{ company: 'Globex', title: 'Engineer', highlights: ['Built the analytical engine.'] }] }
    });

    assert.match(asked.requests[0]?.prompt ?? '', /Built the analytical engine/);
    assert.ok(!(asked.requests[0]?.prompt ?? '').includes('Jan Kowalski'));
  });
});

/* --------------------------------------------------------------- the fold */

const outcome = (step: string, value: Record<string, unknown>): StepOutcome =>
  ({ step, status: 'ok', value });

test('the promise survives a review that never ran', () => {
  // The reason `aggregate` exists here at all. Under the default merge this
  // field comes from a step, and a step that degraded drops it — leaving a
  // payload an interface can read as permission to send.
  const folded = draftApplication.aggregate?.([
    outcome('source', { offer_text: '', facts: {}, candidate: {}, passages: [], language: 'en' }),
    outcome('body', { body: 'A letter that was paid for.' })
  ]);

  assert.equal(folded?.confirmation_required, true);
});

test('a degraded review does not lose the letter', () => {
  const folded = draftApplication.aggregate?.([
    outcome('body', { body: 'A letter that was paid for.' })
  ]);

  assert.equal(folded?.body, 'A letter that was paid for.');
});

/* ---------------------------------------------------------------- the input */

test('an input with neither text, url nor position is rejected', () => {
  assert.equal(inputSchema.safeParse({ language: 'en' }).success, false);
});

test('a language tag no platform can name is rejected', () => {
  assert.equal(inputSchema.safeParse({ offerText: OFFER, language: 'zz' }).success, false);
  assert.equal(inputSchema.safeParse({ offerText: OFFER, language: 'pt-BR' }).success, true);
});
