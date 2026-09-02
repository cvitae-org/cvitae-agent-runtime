/**
 * Writes the application email for one offer. It does not send it.
 *
 * A declared pipeline with exactly **one model call**, which is the whole
 * design and worth defending. Three of the things a covering email needs are
 * already known to the runtime — who the candidate is, what the position is
 * called, and where applications go — and only the middle part, the prose that
 * connects one to the other, is genuinely absent from the input. So the subject
 * line is a template and the recipient is a regex, and neither can hallucinate.
 * The body is a model call, because a paragraph arguing that this person suits
 * this job is not sitting anywhere in the inputs.
 *
 * **Nothing here sends anything.** The result is a draft and a *suggested*
 * recipient, and `confirmation_required` says so in the payload rather than
 * only in a comment, so an interface that sends without asking is visibly
 * ignoring the contract rather than merely unaware of it. `effects/mail.ts` is
 * not reachable from a capability at all — it is absent from `EffectSet` and a
 * boundary rule keeps it out of `tools/` — and that is not belt and braces: this
 * step reads text written by whoever posted the offer, and a send function one
 * capability away from that text is an exfiltration path with a cover story.
 * The seam is that a person sees the draft, picks the address, and only then
 * does an adapter call the sender.
 */

import { z } from 'zod';
import {
  RuntimeError,
  type Capability,
  type Plan,
  type StepContext,
  type StepOutcome
} from '../../contracts/index.js';
import { DEFAULT_BUDGET } from '../../context/budget.js';
import { compose, fields, labelled, numbered } from '../../context/render.js';
import { CV_ID, cvDocumentSchema } from '../cv/document.js';
import { languageName, localeSchema } from '../language.js';
import { findApplicationEmails, reviewDraft, type KnownValues } from './text.js';

/* ------------------------------------------------------------------ prompts */

/**
 * The rule set for writing an application email.
 *
 * Short declarative sentences, because that is what these models follow. Two of
 * the four exist because of measured failures rather than general caution: the
 * placeholder line addresses what small models actually emit in letter-writing
 * tasks, and the invention line is the same concern the extraction rules carry,
 * in a task with far more room to embellish than to copy.
 *
 * Unlike the extraction rules, **this wording is not carried over from anything
 * that was measured.** It is a starting point. If a model starts returning
 * empty completions, this string is the first suspect, and changing it wants
 * something to measure against.
 */
const DRAFTING_RULES = `Use only facts from the candidate summary and the listed experience. Do not invent employers, projects, dates or numbers.
Write the finished text. Do not leave placeholders in brackets.
Address the reader directly. Do not describe what you are writing.
Do not restate the whole CV. Choose the two or three points that answer this offer.`;

const TONES = {
  formal: 'Keep the register formal and plain.',
  warm: 'Keep the register warm and direct, without being casual.',
  direct: 'Keep it brief and factual. No pleasantries beyond the greeting.'
} as const;

/**
 * How much of the posting reaches the drafting prompt.
 *
 * Cut far harder than extraction cuts it. Extraction needs the whole posting
 * because a field can appear anywhere in it; drafting needs enough to write
 * about, and the rest is context a small model has to hold while generating
 * prose — which is where adherence goes.
 */
const POSTING_BUDGET = 4_000;

/**
 * Three tokens per word is deliberate slack: Polish tokenises considerably
 * worse than English on these models, and a body truncated mid-sentence is a
 * wasted call.
 */
const TOKENS_PER_WORD = 3;

/**
 * What the model spends before the letter starts, and it is not small.
 *
 * Measured against `gemma4:12b`, the local default, on the same offer: a
 * 740-token ceiling finished with `length` and **zero characters** of text,
 * while 950 tokens produced a complete 603-character letter. The model reasons
 * first, and reasoning is billed against the same ceiling as the answer, so a
 * budget sized only for the prose buys nothing at all.
 *
 * Sized above the observed overhead rather than at it. An unused ceiling costs
 * nothing — generation stops at `stop` — whereas one token too few costs the
 * whole call, which is 25 seconds of local GPU for an empty string.
 */
const THINKING_ALLOWANCE = 900;

/** How many retrieved passages reach the prompt. Beyond this it is padding. */
const PASSAGE_LIMIT = 8;

/* ------------------------------------------------------------------- input */

/**
 * The candidate, as a caller holds it.
 *
 * A narrow projection rather than the whole `CvDocument`, for the same reason
 * the prompt is narrow: education dates and certificate issuers are not what a
 * covering letter is made of. A caller that omits it gets the stored CV.
 */
const candidateSchema = z.object({
  name: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  role: z.string().default(''),
  summary: z.string().default(''),
  skills: z.array(z.string()).default([]),
  experience: z
    .array(
      z.object({
        company: z.string().default(''),
        title: z.string().default(''),
        highlights: z.array(z.string()).default([])
      })
    )
    .default([])
});

type Candidate = z.infer<typeof candidateSchema>;

/** What `analyze_offer` already worked out, when the caller kept it. */
const offerFactsSchema = z.object({
  position: z.string().default(''),
  company: z.string().default(''),
  required_skills: z.array(z.string()).default([]),
  /**
   * Prose a model wrote about how to apply. Carried through to the caller as
   * something for a person to read — never parsed into a recipient. The
   * addresses in `to_suggestion` come from the offer text itself.
   */
  how_to_apply: z.string().default('')
});

type OfferFacts = z.infer<typeof offerFactsSchema>;

export const inputSchema = z
  .object({
    offerText: z.string().optional(),
    url: z.string().optional(),
    offer: offerFactsSchema.partial().optional(),
    candidate: candidateSchema.partial().optional(),
    language: localeSchema.default('en'),
    tone: z.enum(['formal', 'warm', 'direct']).default('formal'),
    /**
     * A covering email that runs past this is not read. The ceiling is a word
     * count rather than a token budget because it is the thing a person would
     * want to change; `maxOutputTokens` is derived from it below.
     */
    max_words: z.number().int().min(80).max(400).default(180)
  })
  .refine(
    (input) =>
      Boolean(input.offerText?.trim())
      || Boolean(input.url?.trim())
      || Boolean(input.offer?.position?.trim()),
    { message: 'Provide offerText, url, or an offer with a position.' }
  );

export type DraftApplicationInput = z.infer<typeof inputSchema>;

/* --------------------------------------------------------------- the subject */

/**
 * The subject line, assembled rather than generated.
 *
 * An application subject is one of the most conventional strings in
 * professional correspondence — the recruiter wants the position and the name,
 * in that order, and nothing else. Every part of it is already known here, so a
 * model call would buy variation in the one place variation is a liability, and
 * spend a request against a quota to do it.
 *
 * Two languages, and a third gets the English lead with its own position and
 * name. That is a table, which `language.ts` argues against — the difference is
 * that `Intl` will name any language for you and no platform will write you a
 * subject line, so this phrase has to come from somewhere. When a third
 * language matters, it is one line here.
 */
export const subjectFor = (position: string, name: string, language: string): string => {
  const role = position.trim();
  const who = name.trim();

  const lead = language.toLowerCase().startsWith('pl')
    ? role
      ? `Aplikacja na stanowisko: ${role}`
      : 'Aplikacja'
    : role
      ? `Application for ${role}`
      : 'Application';

  return who ? `${lead} — ${who}` : lead;
};

/* ------------------------------------------------------------- the material */

/** One passage of the candidate's own writing, with where it came from. */
export type Passage = {
  readonly text: string;
  readonly company: string;
  readonly title: string;
};

const stringOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The CV passages most relevant to this offer.
 *
 * Retrieval first, because that is what the index is for: the ranked passages
 * are the ones this posting makes relevant, not the ones the CV happens to list
 * first. The fallback matters more than it looks. Search needs an embedding
 * model, and on a machine whose provider cannot embed, the ranked path is
 * simply unavailable — failing the capability for that would be wrong. An
 * unranked handful of recent bullets writes a decent letter; no bullets at all
 * writes a generic one.
 *
 * The fallback is plain records rather than fabricated search hits. Both ends
 * of this are in one file, so there is no reason to dress the poorer input up
 * as the richer one and then explain the disguise.
 */
const relevantPassages = async (
  context: StepContext,
  candidate: Candidate,
  query: string
): Promise<Passage[]> => {
  if (query.trim()) {
    try {
      const hits = await context.retrieval.search(
        { text: query, documentId: CV_ID, limit: PASSAGE_LIMIT },
        context.signal
      );

      if (hits.length > 0) {
        return hits.map((hit) => ({
          text: hit.text,
          company: stringOf(hit.meta.company),
          title: stringOf(hit.meta.title)
        }));
      }
    } catch (error) {
      // An embedder that is not running is a configuration state, not a fault
      // in this run. Named at warn so it is visible, then stepped around.
      console.warn(
        'Profile retrieval is unavailable; drafting from recent experience instead.',
        error
      );
    }
  }

  return candidate.experience
    .flatMap((entry) =>
      entry.highlights.map((text) => ({ text, company: entry.company, title: entry.title }))
    )
    .slice(0, PASSAGE_LIMIT);
};

/** Fills the projection from the stored CV when the caller supplied none. */
const candidateFromStore = (context: StepContext): Candidate => {
  const record = context.documents.read(CV_ID);

  if (!record) {
    throw new RuntimeError(
      'There is no stored CV to write from. Import one first, or pass a candidate.',
      'invalid_input'
    );
  }

  const document = cvDocumentSchema.parse(record.body);

  return candidateSchema.parse({
    name: document.personal.name,
    email: document.personal.email,
    phone: document.personal.phone,
    role: document.skills.role,
    summary: document.role_description,
    skills: [
      ...document.skills.programming_languages,
      ...document.skills.frameworks,
      ...document.skills.libraries_and_tools
    ],
    experience: document.experience.map((entry) => ({
      company: entry.company,
      title: entry.title,
      highlights: entry.highlights
    }))
  });
};

/* ------------------------------------------------------------------ rendering */

/** What the application is answering. */
const renderOffer = (facts: OfferFacts, text: string): string =>
  compose(
    fields('THE OFFER', [
      ['Position', facts.position],
      ['Company', facts.company],
      ['Asks for', facts.required_skills.slice(0, 12).join(', ')]
    ]),
    labelled('POSTING', text, POSTING_BUDGET)
  );

/**
 * The candidate, as a compact factual block.
 *
 * Deliberately not the whole document. A small model given every field spends
 * its output restating them, and the fields left out here — education dates,
 * certificate issuers, exhaustive tool lists — are the ones that pad a covering
 * letter without answering anything the offer asked. The contact details are
 * held for the placeholder guard and never rendered: a letter that recites its
 * sender's phone number in the second paragraph reads as generated.
 */
const renderCandidate = (candidate: Candidate): string =>
  fields('CANDIDATE', [
    ['Name', candidate.name],
    ['Current role', candidate.role],
    ['Skills', candidate.skills.slice(0, 24).join(', ')],
    [
      'Recent positions',
      candidate.experience
        .slice(0, 4)
        .map((entry) => `${entry.title} at ${entry.company}`)
        .join('; ')
    ],
    ['Summary', candidate.summary]
  ]);

const renderPassages = (passages: readonly Passage[]): string =>
  numbered(
    'RELEVANT EXPERIENCE FROM THE CV',
    passages.map((passage) => passage.text),
    { total: DEFAULT_BUDGET.retrieved, each: DEFAULT_BUDGET.passage }
  );

/** What the `source` step leaves behind for the two steps that follow it. */
type Material = {
  readonly offer_text: string;
  readonly facts: OfferFacts;
  readonly candidate: Candidate;
  readonly passages: readonly Passage[];
  /** Carried through the step rather than closed over, so `aggregate` — which
   *  is handed outcomes and nothing else — can still name it. */
  readonly language: string;
};

const materialOf = (context: StepContext): Material => context.completed.source as Material;

/* -------------------------------------------------------------------- plan */

export const draftApplication: Capability<DraftApplicationInput> = {
  name: 'draft_application',
  describe:
    'Write a job application email for one offer, using the CV. Returns a draft and a '
    + 'suggested recipient; sends nothing.',
  input: inputSchema,

  plan: (input): Plan => {
    const provided = input.offerText?.trim() ?? '';
    const url = input.url?.trim() ?? '';
    const language = languageName(input.language) ?? input.language;

    return {
      capability: 'draft_application',
      source: 'declared',
      stages: [
        /**
         * Everything the letter is made of, gathered before anything is paid
         * for.
         *
         * A step rather than work done while planning, for the reason offer
         * analysis gives: a fetch that happens inside `plan()` is outside the
         * run's timing, its failure policy, its events and the elapsed time the
         * caller is shown. Critical and alone in its stage — there is nothing
         * to write from without it, and failing here costs no model call.
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
                let text = provided;

                if (!text && url) {
                  const offer = await context.effects.offers.resolve(url, {
                    traceId: context.traceId,
                    runId: context.runId,
                    step: context.step.name,
                    signal: context.signal
                  });

                  if (!offer.text.trim()) {
                    throw new RuntimeError(
                      `Nothing readable at ${offer.finalUrl}. The page may need a browser to `
                        + 'render, or may have refused the request.',
                      'unreadable_source'
                    );
                  }

                  text = offer.text;
                }

                const candidate = candidateSchema.parse(
                  input.candidate ?? candidateFromStore(context)
                );
                const facts = offerFactsSchema.parse(input.offer ?? {});

                // The posting's own words are the query. Falling back to the
                // stated facts covers the case this capability allows on
                // purpose: a caller with an analysis and no text at all.
                const passages = await relevantPassages(
                  context,
                  candidate,
                  text || [facts.position, facts.company, ...facts.required_skills].join(' ')
                );

                return { offer_text: text, facts, candidate, passages, language: input.language };
              }
            }
          ]
        },

        /**
         * The one model call.
         *
         * `generate`, not `extract`, and that was measured rather than assumed:
         * written first as an extraction returning `{ body: string }` it failed
         * on every model and every prompt variant tried. The table is in
         * `GenerateStep`. A schema around a single prose string is not a
         * safeguard here, it is the thing that breaks.
         */
        {
          name: 'write',
          concurrency: 1,
          steps: [
            {
              kind: 'generate',
              name: 'body',
              key: 'body',
              system: compose(
                `Write the body of an email applying for the job below. Write in ${language}.`,
                TONES[input.tone],
                `Keep it under ${input.max_words} words.`,
                DRAFTING_RULES
              ),
              prompt: (context) => {
                const material = materialOf(context);
                return compose(
                  renderOffer(material.facts, material.offer_text),
                  renderCandidate(material.candidate),
                  renderPassages(material.passages)
                );
              },
              /**
               * Sized from the word ceiling rather than fixed, since
               * `max_words` is what a caller changes.
               */
              maxOutputTokens: input.max_words * TOKENS_PER_WORD + THINKING_ALLOWANCE,
              // The only critical step. A draft with no body is not a draft,
              // and unlike a missing salary there is no useful partial result.
              critical: true
            }
          ]
        },

        {
          name: 'finish',
          concurrency: 1,
          steps: [
            /**
             * Addresses out of the offer text, and nothing else.
             *
             * A transform because it is pure TypeScript, and non-critical
             * because an offer with no address in it is ordinary — plenty of
             * boards have only an apply button. The result is `to_suggestion`,
             * never `to`: naming it after what it is stops it being read as a
             * decision this runtime made.
             */
            {
              kind: 'transform',
              name: 'recipient',
              critical: false,
              run: async (context) => {
                const material = materialOf(context);
                return {
                  to_suggestion: findApplicationEmails(
                    `${material.offer_text}\n${material.facts.how_to_apply}`
                  ),
                  apply_hint: material.facts.how_to_apply
                };
              }
            },

            /**
             * Everything deterministic about the finished draft.
             *
             * Runs after the model call, so it can fill the placeholders the
             * model left behind with values the runtime was holding all along.
             * Non-critical, and `reviewDraft` never throws, so the worst it can
             * do is not run — which the aggregator is written to survive.
             */
            {
              kind: 'transform',
              name: 'review',
              critical: false,
              run: async (context) => {
                const material = materialOf(context);

                const known: KnownValues = {
                  name: material.candidate.name,
                  company: material.facts.company,
                  position: material.facts.position,
                  email: material.candidate.email,
                  phone: material.candidate.phone
                };

                const reviewed = reviewDraft({
                  subject: subjectFor(
                    material.facts.position,
                    material.candidate.name,
                    input.language
                  ),
                  body: String(context.completed.body?.body ?? ''),
                  known
                });

                return {
                  subject: reviewed.subject,
                  body: reviewed.body,
                  warnings: reviewed.warnings,
                  placeholders_filled: reviewed.filled
                };
              }
            }
          ]
        }
      ]
    };
  },

  /**
   * Assembled by name rather than merged.
   *
   * The default shallow merge would work and would be wrong in one specific
   * way: `confirmation_required` would come from a step, and a step that
   * degraded would drop it. A result that omits the field is indistinguishable
   * from one that never made the promise, and the field exists precisely so an
   * interface cannot send without seeing it. It belongs to the capability, so
   * the capability states it, unconditionally.
   *
   * The body is read from the review and falls back to the raw one. Losing a
   * paid-for letter because a formatting pass degraded would be a poor trade —
   * the warnings would be missing, and the words would still be worth reading.
   */
  aggregate: (outcomes: readonly StepOutcome[]) => {
    const valueOf = (step: string) => outcomes.find((outcome) => outcome.step === step)?.value;

    const source = valueOf('source');
    const drafted = String(valueOf('body')?.body ?? '');
    const reviewed = valueOf('review');
    const recipient = valueOf('recipient');
    const material = source as Material | undefined;

    return {
      subject: String(reviewed?.subject ?? ''),
      body: String(reviewed?.body ?? drafted),
      warnings: reviewed?.warnings ?? [],
      placeholders_filled: reviewed?.placeholders_filled ?? [],
      language: material?.language ?? '',
      to_suggestion: recipient?.to_suggestion ?? [],
      apply_hint: recipient?.apply_hint ?? '',
      confirmation_required: true,
      used_passages: material?.passages ?? []
    };
  }
};
