/**
 * The parts of `draft_application` that do not need a model.
 *
 * Which, by design, is most of it: the recipient, the subject and every check
 * on the finished draft are deterministic, so they are testable, and the one
 * model call is isolated behind a step boundary. That split is the reason this
 * file can assert anything useful at all.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countWords,
  findApplicationEmails,
  reviewDraft,
  reviewPlaceholders
} from '../src/capabilities/applicationText.js';
import { draftApplication, inputSchema } from '../src/capabilities/draftApplication.js';
import type { RunContext, TransformStep } from '../src/core/types.js';

// --- recipients ---------------------------------------------------------------

test('an application address is found in offer prose', () => {
  const found = findApplicationEmails(
    'Send your CV to rekrutacja@firma.pl before the end of the month.'
  );

  assert.deepEqual(found, ['rekrutacja@firma.pl']);
});

test('recruitment addresses are offered before general ones', () => {
  const found = findApplicationEmails(
    'General enquiries: kontakt@firma.pl. Applications: jobs@firma.pl.'
  );

  assert.deepEqual(found, ['jobs@firma.pl', 'kontakt@firma.pl']);
});

test('asset filenames are not mistaken for addresses', () => {
  // A retina sprite parses as an email perfectly: local part, domain, and three
  // alphabetic characters of "TLD". Board pages are full of them.
  const found = findApplicationEmails(
    'background: url(/static/logo@2x.png); apply at hr@firma.pl'
  );

  assert.deepEqual(found, ['hr@firma.pl']);
});

test('unattended mailboxes are excluded', () => {
  const found = findApplicationEmails(
    'Sent from no-reply@board.com. Questions to kontakt@firma.pl.'
  );

  assert.deepEqual(found, ['kontakt@firma.pl']);
});

test('addresses are deduplicated and stripped of trailing punctuation', () => {
  const found = findApplicationEmails(
    'Write to kontakt@firma.pl, or to kontakt@firma.pl. Thanks.'
  );

  assert.deepEqual(found, ['kontakt@firma.pl']);
});

test('no address is a legitimate answer, not an error', () => {
  assert.deepEqual(findApplicationEmails('Apply through the button below.'), []);
});

// --- placeholders --------------------------------------------------------------

test('known placeholders are filled and reported', () => {
  const reviewed = reviewPlaceholders(
    'Dear [Company Name] team,\n\nRegards,\n[Your Name]',
    { name: 'Jan Kowalski', company: 'Acme' }
  );

  assert.match(reviewed.text, /Dear Acme team/);
  assert.match(reviewed.text, /Regards,\nJan Kowalski/);
  assert.equal(reviewed.remaining.length, 0);
  assert.equal(reviewed.filled.length, 2);
});

test('an unknown placeholder is reported rather than deleted', () => {
  // Deleting it would leave a gap that reads as a typo. Left visible, it reads
  // as what it is, and the person about to send can see it.
  const reviewed = reviewPlaceholders('Ref [Requisition ID] applies.', {
    name: 'Jan Kowalski'
  });

  assert.match(reviewed.text, /\[Requisition ID\]/);
  assert.deepEqual(reviewed.remaining, ['[Requisition ID]']);
});

test('placeholder spelling variants resolve to the same value', () => {
  for (const spelling of ['[Your Name]', '[YOUR_NAME]', '{{full name}}', '<Your Name>']) {
    const reviewed = reviewPlaceholders(spelling, { name: 'Jan Kowalski' });
    assert.equal(reviewed.text, 'Jan Kowalski', spelling);
  }
});

test('an address in angle brackets is not treated as a placeholder', () => {
  const reviewed = reviewPlaceholders('Reply to <jan@example.com> please.', {
    name: 'Jan Kowalski'
  });

  assert.equal(reviewed.remaining.length, 0);
  assert.match(reviewed.text, /<jan@example\.com>/);
});

// --- the whole-draft review -----------------------------------------------------

const body = (words: number): string => Array.from({ length: words }, () => 'word').join(' ');

test('a newline in the subject is flattened before it can become a header', () => {
  const reviewed = reviewDraft({
    subject: 'Application\r\nBcc: someone@else.com',
    body: body(60),
    known: {}
  });

  assert.ok(!reviewed.subject.includes('\n'));
  assert.ok(!reviewed.subject.includes('\r'));
});

test('a body too short to send is flagged', () => {
  const reviewed = reviewDraft({ subject: 'Application', body: 'Hi.', known: {} });

  assert.ok(reviewed.warnings.some((warning) => /too short/.test(warning)));
});

test('a model that answers the operator instead of the reader is flagged', () => {
  const reviewed = reviewDraft({
    subject: 'Application',
    body: `Sure, here is a cover letter for you. ${body(60)}`,
    known: {}
  });

  assert.ok(
    reviewed.warnings.some((warning) => /addressing the request/.test(warning))
  );
});

test('operator-facing commentary is flagged', () => {
  const reviewed = reviewDraft({
    subject: 'Application',
    body: `${body(60)} Let me know if you would like changes.`,
    known: {}
  });

  assert.ok(reviewed.warnings.some((warning) => /commentary/.test(warning)));
});

test('a clean draft produces no warnings', () => {
  const reviewed = reviewDraft({
    subject: 'Application for Senior Frontend Engineer — Jan Kowalski',
    body: `Dear Acme team, ${body(60)} Regards, Jan Kowalski`,
    known: { name: 'Jan Kowalski', company: 'Acme' }
  });

  assert.deepEqual(reviewed.warnings, []);
});

test('countWords ignores surrounding whitespace', () => {
  assert.equal(countWords('  one   two \n three  '), 3);
});

// --- the plan --------------------------------------------------------------------

/**
 * The only parts of `RunContext` that `plan` touches. Cast through `unknown`
 * because building a real one means LanceDB and an embedding server, which is
 * what `pnpm smoke` is for — this asserts the shape of the plan, not the store.
 */
const stubContext = (): RunContext =>
  ({
    store: {
      documents: {
        read: async () => ({
          personal: { name: 'Jan Kowalski', email: 'jan@example.com', phone: '', location: '', links: {} },
          role_description: 'Frontend developer with eight years of React.',
          skills: {
            role: 'Frontend Developer',
            programming_languages: ['TypeScript'],
            frameworks: ['React'],
            libraries_and_tools: []
          },
          experience: [
            { company: 'Acme', title: 'Senior Frontend', started: '2020', finished: null, highlights: ['Rebuilt the checkout in React, cutting load time in half.'], skills: [] }
          ],
          education: [],
          certificates: [],
          languages: []
        })
      },
      // Nothing indexed, which is the state on a machine with no embedding
      // model — the case the fallback exists for.
      searchProfile: async () => []
    },
    input: {},
    completed: {}
  }) as unknown as RunContext;

const planFor = async (input: unknown) =>
  draftApplication.plan(inputSchema.parse(input), stubContext());

test('the plan makes exactly one model call', async () => {
  const plan = await planFor({
    offerText: 'Senior Frontend Engineer at Acme. React, TypeScript. Apply: jobs@acme.com',
    offer: { position: 'Senior Frontend Engineer', company: 'Acme' }
  });

  const modelSteps = plan.steps.filter((step) => step.kind !== 'transform');

  assert.equal(modelSteps.length, 1);
  assert.equal(modelSteps[0]?.name, 'body');
  assert.equal(modelSteps[0]?.critical, true);
});

test('the body is generated as prose, never through a schema', async () => {
  // Not a stylistic assertion. As an `extract` step this failed on every model
  // and every prompt variant measured — see `GenerateStep`. If someone converts
  // it back for consistency with the other capabilities, this should stop them.
  const plan = await planFor({
    offerText: 'Senior Frontend Engineer at Acme.',
    offer: { position: 'Senior Frontend Engineer', company: 'Acme' }
  });

  const bodyStep = plan.steps.find((step) => step.name === 'body');

  assert.equal(bodyStep?.kind, 'generate');
});

test('the recipient is parsed from the offer, not generated', async () => {
  const plan = await planFor({
    offerText: 'Senior Frontend Engineer at Acme. Send your CV to jobs@acme.com.',
    offer: { position: 'Senior Frontend Engineer', company: 'Acme' }
  });

  const step = plan.steps.find((entry) => entry.name === 'recipient') as TransformStep;
  const result = await step.run(stubContext());

  assert.deepEqual(result.to_suggestion, ['jobs@acme.com']);
  assert.equal(result.confirmation_required, true);
});

test('the review supplies the subject and overrides the raw body', async () => {
  const plan = await planFor({
    offerText: 'Senior Frontend Engineer at Acme.',
    offer: { position: 'Senior Frontend Engineer', company: 'Acme' }
  });

  const step = plan.steps.find((entry) => entry.name === 'review') as TransformStep;

  const context = stubContext();
  context.completed.body = { body: `Dear [Company Name], ${body(60)} Regards, [Your Name]` };

  const result = await step.run(context);

  assert.equal(result.subject, 'Application for Senior Frontend Engineer — Jan Kowalski');
  assert.match(String(result.body), /Dear Acme,/);
  assert.match(String(result.body), /Regards, Jan Kowalski/);
  assert.deepEqual(result.warnings, []);
});

test('a Polish draft gets a Polish subject', async () => {
  const plan = await planFor({
    offerText: 'Starszy Programista Frontend w Acme.',
    offer: { position: 'Starszy Programista Frontend', company: 'Acme' },
    language: 'pl'
  });

  const step = plan.steps.find((entry) => entry.name === 'review') as TransformStep;
  const context = stubContext();
  context.completed.body = { body: body(60) };

  const result = await step.run(context);

  assert.equal(
    result.subject,
    'Aplikacja na stanowisko: Starszy Programista Frontend — Jan Kowalski'
  );
});

test('with nothing indexed the prompt still carries the CV bullets', async () => {
  const plan = await planFor({ offerText: 'React work at Acme.' });

  const bodyStep = plan.steps.find((step) => step.name === 'body');

  assert.ok(bodyStep && bodyStep.kind === 'generate');
  assert.match(bodyStep.prompt, /Rebuilt the checkout in React/);
});

test('an input with neither text, url nor position is rejected', () => {
  assert.equal(inputSchema.safeParse({ language: 'en' }).success, false);
});
