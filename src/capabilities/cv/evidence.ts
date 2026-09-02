/**
 * Writes the professional summary at the top of a CV, aimed at one offer.
 *
 * The paragraph a recruiter reads first, and the one place on a CV where the
 * writing is an argument rather than a record. That is what makes it the
 * riskiest thing here to hand to a model: every other capability restructures
 * facts that already exist, so a wrong answer is a mangled fact and looks like
 * one. This one is asked to persuade, and a model persuading rounds B2 up to
 * fluent, four years up to five, and reaches for a technology it saw in the
 * vacancy rather than in the CV — each of which improves the paragraph and puts
 * a lie in front of an employer who will ask about it.
 *
 * So the model is not asked for a paragraph. It is asked for claims with their
 * sources attached, one per line, and `claims.ts` throws away or refuses the
 * ones that do not hold up. The summary is what survives, joined.
 *
 * **The catalogue is built here, not supplied by the caller.** The previous
 * runtime made facts and requirements required input, with ids the caller
 * minted, because it had no store to read a CV from and no way to check an id
 * anyway. The harness has both, so the same code mints `job:0:2` and later
 * resolves it back to `experience[0].highlights[2]` — which is the difference
 * between a citation that is well-formed and one that is *checkable*. Every
 * verification below rests on that: without it, "cites a fact that exists" is
 * unanswerable and the protocol degrades into formatting.
 *
 * One model call. The review that follows it is deterministic, and none of it
 * re-asks: the executor retries nothing by design, and a second attempt at a
 * paragraph the first attempt got wrong is a second chance to invent the same
 * number. Claims are dropped individually instead, and the floor is checked at
 * the end, so one bad sentence out of five costs a sentence rather than a run.
 */

import { z } from 'zod';
import { RuntimeError, type Capability, type Plan, type StepContext } from '../../contracts/index.js';
import { DEFAULT_BUDGET } from '../../context/budget.js';
import { compose, labelled } from '../../context/render.js';
import { languageName, localeSchema } from '../language.js';
import { CV_ID, cvDocumentSchema, type CvDocument } from './document.js';
import {
  MAX_CLAIMS,
  MIN_CLAIMS,
  minChars,
  review,
  withoutContacts,
  type Fact,
  type Requirement,
  type Review
} from './claims.js';

/* ------------------------------------------------------------------- limits */

const MAX_CHARS_FLOOR = 200;
const MAX_CHARS_CEILING = 1_200;
const DEFAULT_MAX_CHARS = 600;

/**
 * Enough of a CV to argue from, and not so much that the model stops reading.
 *
 * A catalogue is a list of short lines, so these are generous in practice — a
 * fifteen-year CV lands near 120 facts. The cap exists for the pathological
 * import, where a badly-chunked PDF turns one bullet into forty.
 */
const MAX_FACTS = 200;
const MAX_REQUIREMENTS = 60;

const CHARS_PER_TOKEN = 3;
/** `EVIDENCE(...) REQUIREMENTS(...) :: ` costs roughly this much per claim. */
const MARKER_TOKENS = 25;
/**
 * Room for a model that reasons before it answers, measured rather than guessed.
 *
 * Four runs of the identical prompt against gemma4:12b: one finished inside a
 * 4,400-token ceiling, one hit that ceiling without finishing, and two given
 * room spent 5,468 and 4,582 output tokens to produce 640 and 744 characters
 * of visible text — a couple of hundred tokens of answer apiece, and the rest
 * reasoning Ollama never reports. So the spend is both large relative to the
 * answer and variable enough between identical calls to straddle any ceiling
 * set near its mean. Note the direction of the second pair: the longer answer
 * came from the smaller spend, so the reasoning does not scale with the output
 * and cannot be budgeted from it.
 *
 * Which makes tuning to the mean the wrong move. This is a ceiling, not a
 * budget: a call that needs less spends less, so setting it high costs nothing
 * on a well-behaved run, while setting it low guarantees a truncation on a run
 * that would have succeeded. The failures are not symmetric, and the generous
 * side is the cheap one.
 *
 * 12,000 is a little over twice the largest spend observed. It stays
 * a real limit rather than a decorative one: at the 23 tokens/second measured
 * here it is reached around eight and a half minutes, inside the ten-minute run
 * deadline, so a genuinely runaway response still trips this check and says so
 * instead of dying anonymously at the deadline. Guarding the pathological case
 * is the deadline's job; not truncating a legitimate one is this constant's.
 */
const THINKING_ALLOWANCE = 12_000;

/* ------------------------------------------------------------------- input */

const offerSchema = z.object({
  position: z.string().default(''),
  company: z.string().default(''),
  /** Both arrays come straight from `analyze_offer`'s duties step. */
  required_skills: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([])
});

export const inputSchema = z
  .object({
    offer: offerSchema,
    language: localeSchema.default('en'),
    /**
     * The ceiling the finished paragraph must fit under, in characters.
     *
     * Characters and not words, because the constraint is physical: this
     * paragraph sits in a fixed block at the top of a page, and what overflows
     * it is a line of text, not a count of words.
     */
    max_chars: z.number().int().min(MAX_CHARS_FLOOR).max(MAX_CHARS_CEILING).default(DEFAULT_MAX_CHARS),
    /**
     * Summarise this instead of the stored CV.
     *
     * Same reasoning as `translate_cv`: the harness holds the document, so
     * making a caller post it back would be asking them to keep state the
     * runtime keeps better — but a caller summarising a variant it has not
     * saved has nowhere else to put it.
     */
    document: cvDocumentSchema.optional()
  })
  .refine(
    (input) => input.offer.required_skills.length + input.offer.responsibilities.length > 0,
    {
      message:
        'The offer lists no requirements, so there is nothing for the summary to argue '
        + 'against. Run analyze_offer first.',
      path: ['offer']
    }
  );

export type EvidenceSummaryInput = z.infer<typeof inputSchema>;

export type EvidenceSummaryResult = {
  /** The claims that survived review, joined. This is the paragraph. */
  readonly summary: string;
  readonly claims: readonly {
    readonly text: string;
    readonly evidence: readonly string[];
    readonly requirements: readonly string[];
  }[];
  readonly chars: number;
  /** What was dropped and why. Empty when nothing was. */
  readonly warnings: readonly string[];
  readonly provenance: {
    readonly provider_id: string;
    readonly model_id: string;
    readonly facts: number;
    readonly requirements: number;
    /**
     * The stored CV's revision, when the summary was built from the store.
     *
     * The previous runtime asked the caller for a fingerprint string it had no
     * way to verify. A revision is a number the document store maintains and
     * checks on every write, so "which CV is this summary about" has an answer
     * the runtime can stand behind — and absent, honestly, when the caller
     * passed a document of its own.
     */
    readonly cv_revision?: number;
  };
};

/* ---------------------------------------------------------- the catalogue */

/** `''` is not stated, `null` is ongoing — see `endish` in `document.ts`. */
const period = (started: string, finished: string | null): string => {
  const end = finished === null ? 'present' : finished;
  if (!started && !end) return '';
  if (!started) return end;
  if (!end) return started;
  return `${started}–${end}`;
};

const push = (facts: Fact[], id: string, kind: Fact['kind'], text: string): void => {
  const value = withoutContacts(text).replace(/\s+/g, ' ').trim();
  if (value.length > 0 && facts.length < MAX_FACTS) facts.push({ id, kind, text: value });
};

/**
 * Every citable fact in the CV, with the id a claim must use to reach it.
 *
 * The id encodes the path — `job:2:0` is the first highlight of the third
 * position — so resolving a citation is a lookup rather than a search, and a
 * fabricated id fails to resolve instead of matching something near it.
 *
 * Contacts are stripped on the way in. The model never sees a phone number, so
 * it cannot put one in the summary by accident; the check on the output side
 * covers the case where it invents one.
 */
export const catalogueOf = (document: CvDocument): Fact[] => {
  const facts: Fact[] = [];

  push(facts, 'role', 'role', document.skills.role);
  push(facts, 'summary', 'summary', document.role_description);

  const skills = [
    ...document.skills.programming_languages,
    ...document.skills.frameworks,
    ...document.skills.libraries_and_tools
  ];
  skills.forEach((skill, index) => push(facts, `skill:${index}`, 'skill', skill));

  document.experience.forEach((entry, index) => {
    const when = period(entry.started, entry.finished);
    push(
      facts,
      `job:${index}`,
      'job',
      [entry.title, entry.company && `at ${entry.company}`, when && `(${when})`]
        .filter(Boolean)
        .join(' ')
    );

    entry.highlights.forEach((highlight, at) =>
      push(facts, `job:${index}:${at}`, 'highlight', highlight)
    );
  });

  document.education.forEach((entry, index) =>
    push(
      facts,
      `edu:${index}`,
      'education',
      [entry.degree, entry.university && `at ${entry.university}`, period(entry.started, entry.finished)]
        .filter(Boolean)
        .join(' ')
    )
  );

  document.certificates.forEach((entry, index) =>
    push(
      facts,
      `cert:${index}`,
      'certificate',
      [entry.name, entry.issuer && `issued by ${entry.issuer}`, entry.started]
        .filter(Boolean)
        .join(' ')
    )
  );

  // Rendered as "X — level Y" rather than "X (Y)" because the level is the
  // claim being checked, and a bare parenthetical reads as an aside.
  document.languages.forEach((entry, index) =>
    push(facts, `lang:${index}`, 'language', `${entry.name} — level ${entry.level}`)
  );

  return facts;
};

/**
 * What the offer asks for, as things a claim can answer.
 *
 * Skills first, then responsibilities: `analyze_offer` produces no priority
 * field, and inventing one would be asserting something no step measured.
 * Order is the honest substitute — a requirement the offer stated as a required
 * skill is more binding than one it stated as a duty, and that much is in the
 * shape of the data rather than in a guess about it.
 */
export const requirementsOf = (offer: z.infer<typeof offerSchema>): Requirement[] =>
  [
    ...offer.required_skills.map((text) => ({ category: 'skill' as const, text })),
    ...offer.responsibilities.map((text) => ({ category: 'responsibility' as const, text }))
  ]
    .map((entry) => ({ ...entry, text: entry.text.replace(/\s+/g, ' ').trim() }))
    .filter((entry) => entry.text.length > 0)
    .slice(0, MAX_REQUIREMENTS)
    .map((entry, index) => ({ id: `req:${index}`, ...entry }));

/* ------------------------------------------------------------------ prompts */

/**
 * Nine rules, seven of which a deterministic check enforces.
 *
 * Deliberately shorter than the fifteen this carried in the previous runtime,
 * on a cost measured while porting `translate_cv`: prompt length buys reasoning
 * time roughly linearly on the local model, where one extra worked example
 * turned a 45-second step into a 69-second timeout. A rule nothing checks is
 * paid for on every call and enforced on none, so the ones that survived are
 * the ones with a check behind them, plus two that are cheap and cannot be
 * checked — leading with the strongest overlap, and not claiming to be the
 * perfect fit.
 *
 * The dropped rules were "vary your sentence structure", "prefer direct
 * language", "read the whole catalogue" and "demonstrate fit through the cited
 * facts" — style advice a 12B model does not act on, and a restatement of the
 * format rule.
 */
const rules = (max: number): string =>
  [
    'Rules:',
    '- Use only the facts listed below. Never state a number, date or duration that is not in a fact you cite.',
    '- Cite the ids you used. A line with no EVIDENCE ids is thrown away.',
    `- Write ${MIN_CLAIMS} to ${MAX_CLAIMS} lines, ${minChars(max)} to ${max} characters in total.`,
    '- Open with the strongest overlap between the facts and the requirements.',
    '- Each line is one complete sentence and ends with a full stop.',
    '- The "summary" fact is the candidate\'s own earlier description: use it as evidence, never copy a sentence from it.',
    '- State a language level only from a "lang" fact, at exactly the level it gives.',
    '- Never claim the candidate is the best, perfect or ideal fit.',
    '- Output the lines and nothing else. No preamble, no heading, no closing line.'
  ].join('\n');

const FORMAT = [
  'Every line must have exactly this form:',
  'EVIDENCE(fact-id,fact-id) REQUIREMENTS(requirement-id) :: The sentence.',
  '',
  'For example:',
  'EVIDENCE(job:0,skill:3) REQUIREMENTS(req:1) :: Four years building payment services in Go.'
].join('\n');

const renderFacts = (facts: readonly Fact[]): string =>
  labelled(
    'FACTS',
    facts.map((fact) => `${fact.id} | ${fact.text}`).join('\n'),
    DEFAULT_BUDGET.source
  );

const renderRequirements = (requirements: readonly Requirement[]): string =>
  labelled(
    'REQUIREMENTS',
    requirements.map((entry) => `${entry.id} | (${entry.category}) ${entry.text}`).join('\n'),
    DEFAULT_BUDGET.retrieved
  );

/* ------------------------------------------------------------------- steps */

type Material = {
  readonly facts: Fact[];
  readonly requirements: Requirement[];
  readonly revision?: number;
};

const materialOf = (context: StepContext): Material => {
  const gathered = context.completed.catalogue;

  if (!gathered) {
    throw new RuntimeError(
      'The summary review ran without a catalogue to check against.',
      'step_failed'
    );
  }

  return gathered as unknown as Material;
};

/* -------------------------------------------------------------- capability */

export const generateEvidenceSummary: Capability<EvidenceSummaryInput> = {
  name: 'generate_evidence_summary',
  describe:
    'Writes the professional summary at the top of a CV for one offer, from cited facts only.',
  input: inputSchema,

  plan: (input): Plan => {
    const language = languageName(input.language) ?? input.language;

    return {
      capability: 'generate_evidence_summary',
      source: 'declared',
      stages: [
        /**
         * The catalogue, before anything is paid for.
         *
         * Critical and alone in its stage: there is nothing to write from
         * without it, and a CV that is missing or unparseable should cost no
         * model call to discover.
         */
        {
          name: 'read',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'catalogue',
              critical: true,
              run: async (context) => {
                let revision: number | undefined;
                let document = input.document;

                if (!document) {
                  const record = context.documents.read(CV_ID);

                  if (!record) {
                    throw new RuntimeError(
                      'There is no stored CV to summarise. Import one first, or pass a document.',
                      'invalid_input'
                    );
                  }

                  document = cvDocumentSchema.parse(record.body);
                  revision = record.revision;
                }

                const facts = catalogueOf(document);

                if (facts.length < MIN_CLAIMS) {
                  throw new RuntimeError(
                    `The CV holds ${facts.length} usable ${facts.length === 1 ? 'fact' : 'facts'}; `
                      + `a summary needs at least ${MIN_CLAIMS} to cite.`,
                    'invalid_input'
                  );
                }

                return { facts, requirements: requirementsOf(input.offer), revision };
              }
            }
          ]
        },

        /**
         * The one model call.
         *
         * `generate`, not `extract`, for the reason `GenerateStep` states with
         * the measurements behind it: a schema wrapped around a single prose
         * string is what breaks these steps on a small model. The citation
         * markers do the job a schema would have — they are plain text the
         * model writes inline, so there is no object to get wrong, and a
         * malformed marker costs one claim rather than the whole response.
         */
        {
          name: 'write',
          concurrency: 1,
          steps: [
            {
              kind: 'generate',
              name: 'summary_draft',
              key: 'draft',
              critical: true,
              system: compose(
                `Write the professional summary for the CV below, aimed at the job offer below. `
                  + `Write in ${language}.`,
                FORMAT,
                rules(input.max_chars)
              ),
              prompt: (context) => {
                const material = materialOf(context);
                return compose(
                  renderFacts(material.facts),
                  renderRequirements(material.requirements)
                );
              },
              /**
               * Sized from the ceiling the caller set, plus the markers, plus
               * room to reason. The local model thinks before it answers and
               * reports none of those tokens, so a budget covering only the
               * visible output truncates mid-sentence.
               */
              maxOutputTokens:
                Math.ceil(input.max_chars / CHARS_PER_TOKEN)
                + MAX_CLAIMS * MARKER_TOKENS
                + THINKING_ALLOWANCE
            }
          ]
        },

        /**
         * Every check, and the paragraph.
         *
         * Critical, unlike the review step in `draft_application`, and the
         * difference is what failure means in each. A draft that skips its
         * review is a draft with placeholders left in it — visibly unfinished,
         * and a person reads it before it goes anywhere. A summary that skips
         * its review is uncited prose that looks exactly like checked prose,
         * and it goes on a CV. There is no safe degraded form of this step, so
         * it does not have one.
         */
        {
          name: 'review',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'summary',
              critical: true,
              run: async (context) => {
                const material = materialOf(context);
                const draft = String(context.completed.summary_draft?.draft ?? '');

                const reviewed: Review = review(draft, {
                  facts: material.facts,
                  requirements: material.requirements,
                  maxChars: input.max_chars
                });

                const { providerId, modelId } = context.effects.ai.describe();

                return {
                  summary: reviewed.claims.map((claim) => claim.text).join(' '),
                  claims: reviewed.claims.map((claim) => ({
                    text: claim.text,
                    evidence: claim.evidenceIds,
                    requirements: claim.requirementIds
                  })),
                  chars: reviewed.chars,
                  warnings: reviewed.warnings,
                  provenance: {
                    provider_id: providerId,
                    model_id: modelId,
                    facts: material.facts.length,
                    requirements: material.requirements.length,
                    ...(material.revision === undefined ? {} : { cv_revision: material.revision })
                  }
                };
              }
            }
          ]
        }
      ]
    };
  },

  /**
   * The reviewed step, alone.
   *
   * A shallow merge would fold the catalogue and the raw draft into the result
   * beside the checked summary — including `draft`, the unverified prose this
   * capability exists to not hand anybody. Returning one step's value is the
   * only shape where the caller cannot reach past the review.
   */
  aggregate: (outcomes) =>
    (outcomes.find((outcome) => outcome.step === 'summary')?.value as
      | Record<string, unknown>
      | undefined) ?? {}
};
