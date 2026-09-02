/**
 * The model-free half of evidence-summary generation.
 *
 * A live-provider test would prove only that one model happened to follow the
 * prompt once. These tests pin the lasting contract instead: prose is requested
 * with `generate`, citation markers are reviewed locally, ids and numbers cannot
 * escape their catalogues, and the caller's character budget is enforced.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EVIDENCE_SUMMARY_CONTRACT_VERSION,
  EVIDENCE_SUMMARY_PROMPT_VERSION,
  evidenceSummaryInputSchema,
  generateEvidenceSummary,
  reviewEvidenceSummary,
  summaryMinChars,
  summaryOutputTokenBudget,
  type EvidenceSummaryInput
} from '../src/capabilities/generateEvidenceSummary.js';
import { defaultCapabilities } from '../src/capabilities/index.js';
import { RuntimeError, type RunContext } from '../src/core/types.js';
import { HOSTED_CAPABILITIES } from '../src/server/policy.js';

const input = (summaryMaxChars = 600): EvidenceSummaryInput => ({
  language: 'en',
  summaryMaxChars,
  sourceCvFingerprint: 'fp-v1-0123456789abcdef',
  sourceOfferFingerprint: 'fp-v1-fedcba9876543210',
  candidateFacts: [
    {
      id: 'summary:0',
      kind: 'summary',
      text: 'Product-focused frontend engineer building accessible web and mobile products.'
    },
    {
      id: 'skill:0:0',
      kind: 'skill',
      text: 'React'
    },
    {
      id: 'skill:0:1',
      kind: 'skill',
      text: 'TypeScript'
    },
    {
      id: 'experience:0:bullet:0',
      kind: 'experience-bullet',
      text: 'Owned frontend architecture and delivery for accessible web and mobile applications.',
      jobIndex: 0,
      bulletIndex: 0
    },
    {
      id: 'experience:0:bullet:1',
      kind: 'experience-bullet',
      text: 'Led product work across design and engineering while mentoring other developers.',
      jobIndex: 0,
      bulletIndex: 1
    }
  ],
  offer: {
    company: 'Acme',
    position: 'Senior Frontend Engineer',
    requirements: [
      {
        id: 'req-react',
        exactText: 'Strong React and TypeScript experience',
        sourceQuote: 'You have strong React and TypeScript experience.',
        category: 'skill',
        priority: 'required'
      },
      {
        id: 'req-leadership',
        exactText: 'Technical leadership',
        sourceQuote: 'You provide technical leadership to the product team.',
        category: 'experience',
        priority: 'preferred'
      }
    ]
  }
});

const provenance = {
  providerId: 'openai',
  modelId: 'gpt-test'
} satisfies Pick<RunContext, 'providerId' | 'modelId'>;

const substantiveCompletion = `EVIDENCE(summary:0,experience:0:bullet:0,skill:0:0,skill:0:1) REQUIREMENTS(req-react) :: Product-focused frontend engineer experienced in shaping accessible web and mobile products, combining React and TypeScript knowledge with ownership of frontend architecture and dependable delivery across the product lifecycle.
EVIDENCE(experience:0:bullet:0,experience:0:bullet:1) REQUIREMENTS(req-leadership) :: Brings hands-on collaboration across design and engineering, leads product work from technical decisions through implementation, and mentors developers while keeping the resulting experience grounded in practical delivery.`;

test('the strict input accepts only the sanitised catalogue contract', () => {
  assert.equal(evidenceSummaryInputSchema.safeParse(input()).success, true);

  const correction = {
    ...input(),
    forbiddenTechnologies: [' Kubernetes '],
    rewriteSourceDescription: true,
    repairProfessionalQuality: true,
    enforceExactLanguageLevels: true
  };
  const parsedCorrection = evidenceSummaryInputSchema.safeParse(correction);
  assert.equal(parsedCorrection.success, true);
  assert.deepEqual(
    parsedCorrection.success
      ? parsedCorrection.data.forbiddenTechnologies
      : undefined,
    ['Kubernetes']
  );

  const excessiveCorrection = {
    ...input(),
    forbiddenTechnologies: Array.from(
      { length: 51 },
      (_, index) => `technology-${index}`
    )
  };
  assert.equal(
    evidenceSummaryInputSchema.safeParse(excessiveCorrection).success,
    false
  );

  const withCredential = { ...input(), apiKey: 'must-not-cross-capability-input' };
  assert.equal(evidenceSummaryInputSchema.safeParse(withCredential).success, false);

  const duplicate = input();
  duplicate.candidateFacts.push({ ...duplicate.candidateFacts[0]! });
  const parsed = evidenceSummaryInputSchema.safeParse(duplicate);
  assert.equal(parsed.success, false);
  assert.match(parsed.success ? '' : parsed.error.message, /Duplicate candidate fact id/);
});

test('fingerprints are required in their reproducible snapshot format', () => {
  const wrong = { ...input(), sourceCvFingerprint: 'latest' };
  assert.equal(evidenceSummaryInputSchema.safeParse(wrong).success, false);
});

test('the plan writes prose with generateText and derives a small token ceiling', async () => {
  const value = input();
  const plan = await generateEvidenceSummary.plan(value, {} as RunContext);
  const draft = plan.steps[0];

  assert.equal(plan.capability, 'generate_evidence_summary');
  assert.equal(draft?.kind, 'generate');
  assert.equal(draft?.maxOutputTokens, summaryOutputTokenBudget(value.summaryMaxChars));
  assert.equal(draft?.maxRetries, 0);
  assert.ok((draft?.maxOutputTokens ?? Infinity) < 8_000);

  if (draft?.kind !== 'generate') assert.fail('Expected a generate step.');
  assert.match(draft.system, /untrusted data/i);
  assert.match(draft.system, /complete replacement/i);
  assert.match(draft.system, /previous description/i);
  assert.match(draft.system, /prioritising required requirements/i);
  assert.match(draft.system, /never call the candidate the best/i);
  assert.match(draft.system, /complete, standalone sentence/i);
  assert.match(draft.system, /Preserve the exact stated level/i);
  assert.match(draft.system, /Return no heading, Markdown, JSON or commentary/);
  assert.match(draft.prompt, /TARGET OFFER/);
  assert.match(draft.prompt, /PREVIOUS CV DESCRIPTION/);
  assert.match(draft.prompt, /OTHER VERIFIED CV FACTS/);
  assert.doesNotMatch(draft.prompt, /generateObject/);
});

test('the offer catalog puts required requirements before preferred ones', async () => {
  const value = input();
  value.offer.requirements.reverse();

  const plan = await generateEvidenceSummary.plan(value, {} as RunContext);
  const draft = plan.steps[0];

  if (draft?.kind !== 'generate') assert.fail('Expected a generate step.');
  assert.ok(draft.prompt.indexOf('req-react') < draft.prompt.indexOf('req-leadership'));
});

test('a correction attempt hides vacancy-only technologies from the offer prompt', async () => {
  const value = input();
  value.forbiddenTechnologies = [' Kubernetes ', 'kubernetes'];
  value.offer.position = 'Kubernetes Platform Engineer';
  value.offer.requirements.push({
    id: 'req-kubernetes',
    exactText: 'Production Kubernetes experience',
    sourceQuote: 'Operate production Kubernetes clusters.',
    category: 'skill',
    priority: 'required'
  });

  const plan = await generateEvidenceSummary.plan(value, {} as RunContext);
  const draft = plan.steps[0];

  if (draft?.kind !== 'generate') assert.fail('Expected a generate step.');
  assert.match(draft.system, /\["kubernetes"\]/);
  assert.match(draft.system, /Do not use any of them in the claim prose/);
  assert.doesNotMatch(draft.prompt, /req-kubernetes|Kubernetes/iu);
  assert.match(draft.prompt, /vacancy-only technology removed/);
  assert.match(draft.prompt, /req-react/);
});

test('plain-text citation markers become a bounded, provenance-bearing result', () => {
  const value = input();
  const result = reviewEvidenceSummary(substantiveCompletion, value, provenance);

  assert.equal(result.version, EVIDENCE_SUMMARY_CONTRACT_VERSION);
  assert.equal(result.sourceCvFingerprint, value.sourceCvFingerprint);
  assert.equal(result.sourceOfferFingerprint, value.sourceOfferFingerprint);
  assert.equal(result.summaryClaims.length, 2);
  assert.deepEqual(result.summaryClaims[0]?.requirementIds, ['req-react']);
  assert.ok(result.summaryClaims[0]?.evidenceIds.includes('skill:0:0'));
  assert.equal(result.meta.generator, 'generateText');
  assert.equal(result.meta.providerId, 'openai');
  assert.equal(result.meta.modelId, 'gpt-test');
  assert.equal(result.meta.promptVersion, EVIDENCE_SUMMARY_PROMPT_VERSION);
  assert.ok(result.meta.summaryChars >= summaryMinChars(value.summaryMaxChars));
  assert.ok(result.meta.summaryChars <= value.summaryMaxChars);
});

test('unknown citation ids are removed and named without exposing prose', () => {
  const generated = substantiveCompletion.replace(
    'summary:0,experience:0:bullet:0,skill:0:0,skill:0:1',
    'summary:0,unknown-fact,experience:0:bullet:0,skill:0:0,skill:0:1'
  ).replace('REQUIREMENTS(req-react)', 'REQUIREMENTS(req-react,unknown-req)');

  const result = reviewEvidenceSummary(generated, input(), provenance);

  assert.ok(!result.summaryClaims[0]?.evidenceIds.includes('unknown-fact'));
  assert.ok(!result.summaryClaims[0]?.requirementIds.includes('unknown-req'));
  assert.equal(result.meta.warnings.length, 2);
  assert.match(result.meta.warnings.join(' '), /unknown evidence id/);
  assert.match(result.meta.warnings.join(' '), /unknown requirement id/);
});

test('a number absent from the cited facts is refused locally', () => {
  const generated = substantiveCompletion.replace(
    'Product-focused frontend engineer',
    'Product-focused frontend engineer with 12 years of experience'
  );

  assert.throws(
    () => reviewEvidenceSummary(generated, input(), provenance),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.code, 'step_failed');
      assert.match(error.message, /numeric claim/);
      assert.doesNotMatch(error.message, /12 years/);
      return true;
    }
  );
});

test('a correction attempt refuses a forbidden technology that still escapes the model', () => {
  const value = input();
  value.forbiddenTechnologies = ['kubernetes'];
  const generated = substantiveCompletion.replace(
    'React and TypeScript knowledge',
    'React, TypeScript, and Kubernetes knowledge'
  );

  assert.throws(
    () => reviewEvidenceSummary(generated, value, provenance),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.code, 'step_failed');
      assert.match(error.message, /vacancy-only technology/);
      assert.doesNotMatch(error.message, /kubernetes/i);
      return true;
    }
  );
});

test('a focused rewrite correction refuses a copied source-description sentence', () => {
  const value = input(400);
  value.rewriteSourceDescription = true;
  const generated = `EVIDENCE(summary:0) REQUIREMENTS(NONE) :: Product-focused frontend engineer building accessible web and mobile products.
EVIDENCE(experience:0:bullet:0,experience:0:bullet:1) REQUIREMENTS(req-leadership) :: Brings hands-on collaboration across design and engineering, leads product work from technical decisions through implementation, and mentors developers while keeping delivery grounded in practical outcomes.`;

  assert.throws(
    () => reviewEvidenceSummary(generated, value, provenance),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.code, 'step_failed');
      assert.match(error.message, /previous CV description/);
      assert.doesNotMatch(error.message, /Product-focused frontend engineer/);
      return true;
    }
  );
});

test('overlong prose is refused when it cannot fit without cutting a sentence', () => {
  const value = input(200);
  const generated = `EVIDENCE(summary:0,experience:0:bullet:0) REQUIREMENTS(NONE) :: Product-focused frontend engineer building accessible web and mobile products with careful ownership of architecture, implementation, collaboration, quality, and dependable delivery throughout the product lifecycle.
EVIDENCE(experience:0:bullet:1) REQUIREMENTS(req-leadership) :: Collaborative technical contributor leading product work across design and engineering, mentoring developers, and carrying decisions through practical implementation and dependable delivery.`;

  assert.throws(
    () => reviewEvidenceSummary(generated, value, provenance),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.code, 'step_failed');
      assert.match(error.message, /without cutting a sentence/);
      return true;
    }
  );
});

test('incomplete prose and unsupported language inflation are omitted as whole claims', () => {
  const value = input();
  value.candidateFacts.push({
    id: 'language:0',
    kind: 'language',
    text: 'English — B2'
  });
  value.offer.requirements.push({
    id: 'req-language',
    exactText: 'English C1',
    sourceQuote: 'English at C1 is required.',
    category: 'language',
    priority: 'required'
  });
  const generated = `${substantiveCompletion}
EVIDENCE(experience:0:bullet:1) REQUIREMENTS(req-leadership) :: I have led technical.
EVIDENCE(language:0) REQUIREMENTS(req-language) :: I am fluent in English and meet the C1 requirement.`;

  const result = reviewEvidenceSummary(generated, value, provenance);

  assert.equal(result.summaryClaims.length, 2);
  assert.doesNotMatch(
    result.summaryClaims.map((claim) => claim.text).join(' '),
    /led technical|fluent|C1/i
  );
  assert.match(result.meta.warnings.join(' '), /Incomplete generated claim/);
  assert.match(result.meta.warnings.join(' '), /language proficienc(?:y|ies)/);
});

test('the capability is registered and is safe for the stateless hosted runtime', () => {
  assert.equal(defaultCapabilities.generate_evidence_summary, generateEvidenceSummary);
  assert.equal(HOSTED_CAPABILITIES.has('generate_evidence_summary'), true);
});
