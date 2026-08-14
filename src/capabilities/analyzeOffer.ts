/**
 * Offer analysis, as a declared plan.
 *
 * This is cvitae's `analyzeOffer` expressed in the runtime's vocabulary, and it
 * is the first capability on purpose: it is the piece with real operating
 * history behind it, so porting it is the honest test of whether the
 * abstraction fits work that already exists rather than work invented to suit
 * it. The five agents, their token ceilings, their criticality and their exact
 * prompt strings are carried over unchanged.
 *
 * The original comment is worth restating, because it is the reason for the
 * shape: one 23-field object was the source of recurring failures. Long JSON
 * gives a small model more room to truncate or corrupt a key, and a single slip
 * discards the whole response. Five focused calls each emit a short object, and
 * four of the five are allowed to fail without taking the record with them.
 *
 * What the runtime adds is that the five steps no longer need their own pooling
 * loop, their own retry, or their own fallback merge — the orchestrator does
 * all three for any capability. What it must not add is a tool loop: these
 * steps copy values out of text that is already in the prompt, and giving a
 * small model tools to do that is slower and strictly less reliable.
 */

import { z } from 'zod';
import type { Capability, Plan } from '../core/types.js';
import { EXTRACTION_RULES, renderOffer } from '../prompt/builder.js';

export const workModes = ['remote', 'hybrid', 'onsite', 'unknown'] as const;

const factsSchema = z.object({
  company: z.string().describe('Company name, or "Unknown".'),
  company_type: z
    .string()
    .describe(
      'What the business does, e.g. "IT outsourcing", "car parts e-commerce", "AI medical imaging". Not "software company".'
    ),
  company_size: z.string().describe('Headcount if stated, else "Not stated".'),
  team: z.string().describe('Team size or structure if described, else "Not stated".')
});

const roleSchema = z.object({
  position: z.string().describe('Job title exactly as stated.'),
  role_profile: z
    .string()
    .describe('Role plus core stack, e.g. "Frontend Developer (React, TypeScript)".'),
  seniority: z.string().describe('Junior/Mid/Senior/Lead, or "Unknown".'),
  ideal_candidate: z
    .string()
    .describe('1-2 sentences describing the candidate the offer wants.')
});

const compensationSchema = z.object({
  salary: z
    .string()
    .describe(
      'Range exactly as stated including currency and period, else "Not stated".'
    ),
  contract_type: z
    .string()
    .describe(
      'Form of employment only: B2B, UoP (umowa o pracę), zlecenie, or a combination. Never a date. "Not stated" if absent.'
    ),
  engagement_length: z
    .string()
    .describe(
      'How long the engagement runs: long-term, permanent, or a fixed project duration such as "6 months". Never a start date, and never how long the posting stays online ("valid until", "Oferta ważna do"). "Not stated" if absent.'
    )
});

const logisticsSchema = z.object({
  location: z.string().describe('City, or "Unknown".'),
  work_mode: z.enum(workModes),
  start_date: z
    .string()
    .describe('When the work begins: a date or "ASAP". "Not stated" if absent.'),
  how_to_apply: z
    .string()
    .describe(
      'How to apply: apply form or button, email address, recruiter contact, or referral. "Not stated" if absent.'
    )
});

const dutiesSchema = z.object({
  responsibilities: z
    .array(z.string())
    .describe('Day-to-day duties from the offer. Empty array if none listed.'),
  required_skills: z
    .array(z.string())
    .describe('Every skill, technology or qualification the offer requires.')
});

export const inputSchema = z.object({
  offerText: z.string().min(1, 'The offer text is required.'),
  locale: z.string().default('en')
});

export type AnalyzeOfferInput = z.infer<typeof inputSchema>;

export const analyzeOffer: Capability<AnalyzeOfferInput> = {
  name: 'analyze_offer',
  describe:
    'Read a job offer and extract a structured record: company, role, pay, logistics and duties.',
  input: inputSchema,

  plan: (input): Plan => {
    const prompt = renderOffer(input.offerText);

    return {
      capability: 'analyze_offer',
      source: 'declared',
      // Resolved against the provider: 1 for a local server, five-wide for a
      // hosted one. See `resolveConcurrency`.
      concurrency: 'auto',
      steps: [
        {
          kind: 'extract',
          name: 'facts',
          schema: factsSchema,
          system: `Extract company details from the job offer.\n${EXTRACTION_RULES}`,
          prompt,
          maxOutputTokens: 800,
          critical: false,
          fallback: {
            company: 'Unknown',
            company_type: 'Not stated',
            company_size: 'Not stated',
            team: 'Not stated'
          }
        },
        {
          kind: 'extract',
          name: 'role',
          schema: roleSchema,
          // Kept to the bare instruction. Appending the extraction rules or a
          // language directive here made gemma4:12b return an empty completion
          // every time, with the same schema that succeeds without them. The
          // field descriptions carry the guidance instead.
          system: 'Extract the role being advertised.',
          prompt,
          maxOutputTokens: 900,
          // The only critical step: a record with no role is not a record.
          critical: true
        },
        {
          kind: 'extract',
          name: 'compensation',
          schema: compensationSchema,
          system: `Extract the commercial terms of the job offer: pay, form of employment, and how long the engagement lasts.\n${EXTRACTION_RULES}`,
          prompt,
          maxOutputTokens: 900,
          critical: false,
          fallback: {
            salary: 'Not stated',
            contract_type: 'Not stated',
            engagement_length: 'Not stated'
          }
        },
        {
          kind: 'extract',
          name: 'logistics',
          schema: logisticsSchema,
          // Split out of a single 7-field "terms" agent, which repeatedly put a
          // start date into contract_type and engagement_length. Separating pay
          // from place-and-time keeps each field next to the ones it can be
          // confused with.
          system: `Extract where and when the work happens, and how to apply.\n${EXTRACTION_RULES}`,
          prompt,
          maxOutputTokens: 700,
          critical: false,
          fallback: {
            location: 'Unknown',
            work_mode: 'unknown',
            start_date: 'Not stated',
            how_to_apply: 'Not stated'
          }
        },
        {
          kind: 'extract',
          name: 'duties',
          schema: dutiesSchema,
          system: `List the responsibilities and required skills from the job offer.\n${EXTRACTION_RULES}`,
          prompt,
          // Two arrays in one object: measured at exactly 900 output tokens with
          // finishReason "length", i.e. truncated mid-array. This is the widest
          // output of any step and needs the most headroom, not the least.
          maxOutputTokens: 2_500,
          critical: false,
          fallback: { responsibilities: [], required_skills: [] }
        }
      ]
    };
  }
};
