/**
 * Offer analysis: read a posting, return a structured record.
 *
 * The first capability, deliberately. It is the one with real operating history
 * behind it, so porting it is the honest test of whether the runtime fits work
 * that already exists rather than work invented to suit it. The five extraction
 * agents, their token ceilings, their criticality and their prompt strings are
 * carried over unchanged, because every one of them is a measurement.
 *
 * Why five calls and not one. A single 23-field object was the source of
 * recurring failures: long JSON gives a small model more room to truncate or
 * corrupt a key, and one slip discards the whole response. Five focused calls
 * each emit a short object, and four of the five may fail without taking the
 * record down with them — an analysis missing its salary reading is still worth
 * reading, and an analysis missing its role is not.
 *
 * What is new here is the shape of the plan. The fetch is a *step*, in a stage
 * of its own that runs before the extractors. Previously it happened inside
 * `plan()`, which put the slowest and least reliable part of the work outside
 * the timing, outside the failure policy, outside the events and invisible in
 * the elapsed time the caller was shown. Three stages now: read, extract,
 * overlay.
 *
 * What the runtime must *not* add is a tool loop. These steps copy values out
 * of text that is already in the prompt, and handing a small model tools to do
 * that is slower and strictly less reliable.
 */

import { z } from 'zod';
import {
  RuntimeError,
  isWorkMode,
  workModes,
  type Capability,
  type Plan,
  type StatedFacts,
  type StatedKey,
  type StepContext
} from '../contracts/index.js';
import { DEFAULT_BUDGET } from '../context/budget.js';
import { labelled } from '../context/render.js';

/**
 * The rule set for copying values out of a source document.
 *
 * Kept verbatim and kept plain. This exact wording is known to work against
 * gemma3:12b, and it is not worth improving the prose of a string whose failure
 * mode is an empty response. It lives in this file rather than in `context/`
 * because a prompt is domain knowledge; when a second extracting capability
 * wants it, that is the moment to share it, and not before.
 */
const EXTRACTION_RULES = `Use only information present in the offer. Do not infer or invent.
When the offer does not mention a field, answer: Not stated`;

/* ----------------------------------------------------------------- schemas */

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
    .describe('Range exactly as stated including currency and period, else "Not stated".'),
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

/* ------------------------------------------------------------------- input */

/**
 * Either the text or a URL to read it from.
 *
 * Text wins when both are given, because a caller holding the text means the
 * fetch already failed or was never wanted — a stored scrape is replayed this
 * way, along with the board's own figures, so that re-analysing cannot lose
 * them.
 */
export const inputSchema = z
  .object({
    offerText: z.string().optional(),
    url: z.string().optional(),
    /**
     * What the board published as data, replayed by a caller holding a stored
     * row. A live fetch produces the same thing itself, so this is only for
     * text that arrives without one.
     */
    stated: z.custom<StatedFacts>().optional()
  })
  .refine((input) => Boolean(input.offerText?.trim()) || Boolean(input.url?.trim()), {
    message: 'Provide either offerText or url.'
  });

export type AnalyzeOfferInput = z.infer<typeof inputSchema>;

/* -------------------------------------------------------- the board overlay */

/**
 * The strings this treats as "the offer did not say".
 *
 * Broader than the two literals the fallbacks use, and deliberately so: the
 * aggregator canonicalises absence *after* every step has run, so at the moment
 * this decides whether to fill a field the model's "N/A" or "brak" has not been
 * normalised yet. Testing only for "Not stated" here would leave those fields
 * looking answered and skip the board value that would have filled them.
 */
const ABSENT = /^(not[\s_-]?stated|unknown|n\/?a|none|brak|nie podano|nieznane)$/i;

const isAbsent = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim().length === 0 || ABSENT.test(value.trim());

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Merges two skill lists without duplicating case variants.
 *
 * Neither source is a superset. A board's tag list is canonical but short —
 * nofluffjobs lists ten technologies — while the model reads requirements
 * written in prose that never became tags. Both are "what the offer asks for",
 * so both go in, board first because those are the offer's own words.
 */
const mergeSkills = (
  fromBoard: readonly string[] | undefined,
  fromModel: unknown
): string[] | undefined => {
  const board = (fromBoard ?? []).map((skill) => skill.trim()).filter(Boolean);
  if (board.length === 0) return undefined;

  const model = Array.isArray(fromModel)
    ? fromModel.filter((skill): skill is string => typeof skill === 'string')
    : [];

  const seen = new Set<string>();
  const merged: string[] = [];

  for (const skill of [...board, ...model]) {
    const key = skill.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(skill.trim());
  }

  return merged;
};

export type Overlay = {
  /** Only the keys the board actually changed. */
  readonly overrides: Readonly<Record<string, unknown>>;
  /** The same keys, as a list, for the source note shown to the user. */
  readonly applied: readonly string[];
};

/**
 * Lays what the board stated over what the model inferred.
 *
 * Two policies, because the fields differ in how far the board can be trusted
 * over a reader:
 *
 *   Replace — the board states these as data and is simply more accurate:
 *     company, position, salary, seniority, start_date.
 *
 *   Fill only — the board's version is coarser, so it is used only where the
 *     model found nothing: location. A remote posting reports its location as
 *     "Remote", which is true but would overwrite a city the model correctly
 *     read out of the text, and `work_mode` already carries the remote part.
 *
 * What is deliberately *not* taken from the board:
 *
 *   contract_type — schema.org's `employmentType` is a different axis. It
 *     answers FULL_TIME/CONTRACTOR/PART_TIME where this record wants the Polish
 *     form of employment: B2B, UoP, zlecenie. Overriding turned a correct "B2B"
 *     into "CONTRACTOR" and a correct "umowa o pracę" into "FULL_TIME". One
 *     board happens to emit the real contract form in that field; two others
 *     emit the enum, and the field cannot tell you which one you got.
 *
 *   posted_at — stated, genuinely useful, and there is nowhere to put it. A
 *     field for it is a change to the stored shape, not to this function.
 */
export const applyStated = (
  analysis: Readonly<Record<string, unknown>>,
  stated: StatedFacts
): Overlay => {
  const overrides: Record<string, unknown> = {};
  const applied: string[] = [];

  const replace = (key: StatedKey, value: string | undefined): void => {
    const next = clean(value);
    if (!next || analysis[key] === next) return;
    overrides[key] = next;
    applied.push(key);
  };

  const fill = (key: StatedKey, value: string | undefined): void => {
    const next = clean(value);
    if (!next || !isAbsent(analysis[key])) return;
    overrides[key] = next;
    applied.push(key);
  };

  replace('company', stated.company);
  replace('position', stated.title);
  replace('salary', stated.salary);
  replace('seniority', stated.seniority);
  replace('start_date', stated.start_date);
  fill('location', stated.location);

  // Guarded rather than assigned: `work_mode` is an enum a consumer switches
  // on, and an unrecognised string renders as a broken badge rather than as a
  // value anyone can see is wrong.
  if (isWorkMode(stated.work_mode) && analysis.work_mode !== stated.work_mode) {
    overrides.work_mode = stated.work_mode;
    applied.push('work_mode');
  }

  const skills = mergeSkills(stated.required_skills, analysis.required_skills);
  if (skills) {
    overrides.required_skills = skills;
    applied.push('required_skills');
  }

  return { overrides, applied };
};

/* -------------------------------------------------------------------- plan */

/** The offer text, labelled the way the extraction agents expect. */
const renderOffer = (context: StepContext): string =>
  labelled('JOB OFFER', String(context.completed.source?.offer_text ?? ''), DEFAULT_BUDGET.source);

/** How the text was obtained, so a caller can say so without guessing. */
type Origin = {
  readonly source_url: string;
  readonly source_mode: 'url' | 'manual';
};

export const analyzeOffer: Capability<AnalyzeOfferInput> = {
  name: 'analyze_offer',
  describe:
    'Read a job offer and extract a structured record: company, role, pay, logistics and duties.',
  input: inputSchema,

  plan: (input): Plan => {
    const provided = input.offerText?.trim() ?? '';
    const url = input.url?.trim() ?? '';

    return {
      capability: 'analyze_offer',
      source: 'declared',
      stages: [
        /**
         * Reading the offer, as a step.
         *
         * Critical, and the only step in its stage: there is nothing to analyse
         * without it, and failing here costs no model call. That ordering is
         * the point — a board that blocks us should not be discovered after
         * five extractions have been paid for.
         */
        {
          name: 'read',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'source',
              critical: true,
              run: async (context) => {
                const origin: Origin = {
                  source_url: url,
                  source_mode: provided ? 'manual' : 'url'
                };

                if (provided || !url) {
                  return {
                    offer_text: provided,
                    ...origin,
                    via: 'provided',
                    ...(input.stated ? { stated: input.stated } : {})
                  };
                }

                const offer = await context.effects.offers.resolve(url, {
                  traceId: context.traceId,
                  runId: context.runId,
                  step: context.step.name,
                  signal: context.signal
                });

                // A page that answered with nothing is a failure here rather
                // than five model calls against an empty prompt. The model
                // would not error on one — it would invent an offer, and the
                // record would look extracted rather than absent.
                if (!offer.text.trim()) {
                  throw new RuntimeError(
                    `Nothing readable at ${offer.finalUrl}. The page may need a browser to render, `
                      + 'or may have refused the request.',
                    'unreadable_source'
                  );
                }

                // `stated` from the live fetch wins over a replayed copy: if
                // both exist the caller is re-analysing a stored row against a
                // fresh read of the same page, and the fresh one is the page.
                const stated = offer.stated ?? input.stated;

                return {
                  offer_text: offer.text,
                  source_url: offer.finalUrl,
                  source_mode: origin.source_mode,
                  via: 'fetched',
                  ...(offer.board ? { board: offer.board } : {}),
                  ...(stated ? { stated } : {})
                };
              }
            }
          ]
        },

        /**
         * The five extractions.
         *
         * `'auto'`, which resolves to 1 against a local provider and to five
         * otherwise. A local server is one GPU and five concurrent calls only
         * contend; one measured run starved a call into returning nothing at
         * all — not slower, empty.
         */
        {
          name: 'extract',
          concurrency: 'auto',
          steps: [
            {
              kind: 'extract',
              name: 'facts',
              schema: factsSchema,
              system: `Extract company details from the job offer.\n${EXTRACTION_RULES}`,
              prompt: renderOffer,
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
              // Kept to the bare instruction. Appending the extraction rules or
              // a language directive here made gemma3:12b return an empty
              // completion every time, with the same schema that succeeds
              // without them. The field descriptions carry the guidance.
              system: 'Extract the role being advertised.',
              prompt: renderOffer,
              maxOutputTokens: 900,
              // The only critical extraction: a record with no role is not a
              // record.
              critical: true
            },
            {
              kind: 'extract',
              name: 'compensation',
              schema: compensationSchema,
              system: `Extract the commercial terms of the job offer: pay, form of employment, and how long the engagement lasts.\n${EXTRACTION_RULES}`,
              prompt: renderOffer,
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
              // Split out of a single seven-field "terms" agent, which
              // repeatedly put a start date into contract_type and
              // engagement_length. Separating pay from place-and-time keeps
              // each field next to the ones it can be confused with.
              system: `Extract where and when the work happens, and how to apply.\n${EXTRACTION_RULES}`,
              prompt: renderOffer,
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
              prompt: renderOffer,
              // Two arrays in one object: measured at exactly 900 output tokens
              // with finishReason "length", truncated mid-array. This is the
              // widest output of any step and needs the most headroom, not the
              // least.
              maxOutputTokens: 2_500,
              critical: false,
              fallback: { responsibilities: [], required_skills: [] }
            }
          ]
        },

        /**
         * The board's own figures, laid over the model's reading.
         *
         * A stage of its own so it runs after every extraction and merges last,
         * which is what makes it an override rather than a suggestion. After
         * rather than before, because a degraded step fills its fields with
         * "Not stated" and those are exactly the gaps worth covering.
         *
         * Non-critical: a posting with no structured data is the normal case,
         * and this step having nothing to do is not a failure.
         */
        {
          name: 'overlay',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'board_facts',
              critical: false,
              run: async (context) => {
                // The same shallow merge the aggregator will perform, needed
                // here for a different reason: deciding whether a field is
                // absent requires seeing what the extractions actually
                // produced. Only the changed keys are returned, so the merge is
                // read here and written once, downstream.
                const merged: Record<string, unknown> = {};
                for (const value of Object.values(context.completed)) {
                  Object.assign(merged, value);
                }

                const stated = context.completed.source?.stated as StatedFacts | undefined;
                if (!stated) return { board_facts_applied: [] };

                const { overrides, applied } = applyStated(merged, stated);
                return { ...overrides, board_facts_applied: applied };
              }
            }
          ]
        }
      ]
    };
  }
};
