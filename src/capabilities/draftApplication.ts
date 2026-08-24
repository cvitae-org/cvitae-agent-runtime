/**
 * Writes the application email for one offer. It does not send it.
 *
 * A declared pipeline with exactly **one model call**, which is the whole design
 * and worth defending. Three things a covering email needs are already known to
 * the runtime — who the candidate is, what the position is called, and where
 * applications go — and only the middle part, the prose that connects one to the
 * other, is genuinely absent from the input. That is the line `findSummary`
 * draws and it lands in the same place here: generate what is not there, parse
 * what is.
 *
 * So the subject line is a template and the recipient is a regex, and neither
 * can hallucinate. The body is a model call, because a paragraph arguing that
 * this person suits this job is not sitting anywhere in the inputs.
 *
 * **Nothing here sends anything.** The result is a draft and a *suggested*
 * recipient, and `confirmation_required` says so in the payload. `mail/` is not
 * imported by this file and must not be: the moment a capability can both read
 * an offer and send mail, offer text — written by whoever posted it — is one
 * prompt injection away from an outbound channel. The seam is that cvitae shows
 * the draft, a person picks the address, and only then does anything call
 * `createDraft`.
 */

import { z } from 'zod';
import type { Capability, Plan, RunContext, TransformStep } from '../core/types.js';
import { RuntimeError } from '../core/types.js';
import type { SearchHit } from '../store/lance.js';
import type { ChunkRow } from '../store/store.js';
import { resolveOffer } from '../offers/resolve.js';
import {
  DRAFTING_RULES,
  compose,
  renderCandidate,
  renderOfferBrief,
  renderProfileContext
} from '../prompt/builder.js';
import { findApplicationEmails, reviewDraft, type KnownValues } from './applicationText.js';

/**
 * The candidate, as cvitae holds it in the browser.
 *
 * A narrow projection rather than the whole `CvDocument`, for the same reason
 * `renderCandidate` is narrow: education dates and certificate issuers are not
 * what a covering letter is made of. A caller that omits it gets the stored
 * `cv.json` instead.
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

const TONES = {
  formal: 'Keep the register formal and plain.',
  warm: 'Keep the register warm and direct, without being casual.',
  direct: 'Keep it brief and factual. No pleasantries beyond the greeting.'
} as const;

/** Only what this project actually sees. An unknown code passes through. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  pl: 'Polish',
  de: 'German',
  es: 'Spanish',
  fr: 'French'
};

export const inputSchema = z
  .object({
    offerText: z.string().optional(),
    url: z.string().optional(),
    offer: offerFactsSchema.partial().optional(),
    candidate: candidateSchema.partial().optional(),
    language: z.string().default('en'),
    tone: z.enum(['formal', 'warm', 'direct']).default('formal'),
    /**
     * A covering email that runs past this is not read. The ceiling is a word
     * count rather than a token budget because it is the thing a user would
     * want to change, and `maxOutputTokens` is derived from it below.
     */
    max_words: z.number().int().min(80).max(400).default(180)
  })
  .refine(
    (input) =>
      Boolean(input.offerText?.trim()) ||
      Boolean(input.url?.trim()) ||
      Boolean(input.offer?.position?.trim()),
    { message: 'Provide offerText, url, or an offer with a position.' }
  );

export type DraftApplicationInput = z.infer<typeof inputSchema>;

/** How many CV bullets reach the prompt. Beyond this the model summarises. */
const HIGHLIGHT_LIMIT = 8;

/**
 * The CV bullets most relevant to this offer.
 *
 * Retrieval first, because that is what the chunk index is for. The fallback
 * matters more than it looks: `searchProfile` needs an embedding model, and the
 * README is explicit that neither installed Ollama model can embed — so on a
 * machine without `nomic-embed-text` the ranked path is simply unavailable.
 * Failing the capability for that would be wrong. An unranked handful of recent
 * highlights writes a decent letter; no highlights at all writes a generic one.
 */
const relevantHighlights = async (
  context: RunContext,
  candidate: Candidate,
  query: string
): Promise<SearchHit<ChunkRow>[]> => {
  if (query.trim()) {
    try {
      const hits = await context.store.searchProfile(query, HIGHLIGHT_LIMIT);
      if (hits.length > 0) return hits;
    } catch (error) {
      // An embedder that is not running is a configuration state, not a fault
      // in this run. Named at warn so it is visible, then stepped around.
      console.warn(
        'Profile retrieval is unavailable; drafting from recent experience instead.',
        error
      );
    }
  }

  // The same bullets, in CV order rather than ranked order. Shaped as hits so
  // the prompt renderer does not need a second code path for the poorer input.
  return candidate.experience
    .flatMap((entry) =>
      entry.highlights.map((text) => ({ text, company: entry.company, title: entry.title }))
    )
    .slice(0, HIGHLIGHT_LIMIT)
    .map((highlight, index) => ({
      row: {
        id: `unranked:${index}`,
        kind: 'highlight' as const,
        text: highlight.text,
        company: highlight.company,
        title: highlight.title,
        position: index,
        vector: []
      },
      rank: index + 1,
      score: 0
    }));
};

/**
 * The subject line, assembled rather than generated.
 *
 * An application subject is one of the most conventional strings in
 * professional correspondence — the recruiter wants the position and the name,
 * in that order, and nothing else. Every part of it is already known here, so a
 * model call would buy variation in the one place variation is a liability, and
 * spend a request against a daily quota to do it.
 *
 * If a board ever needs a reference number in the subject, that is the argument
 * for making this an `extract` step. Until then it is a template.
 */
const subjectFor = (position: string, name: string, language: string): string => {
  const role = position.trim();
  const who = name.trim();

  const lead =
    language.toLowerCase().startsWith('pl')
      ? role
        ? `Aplikacja na stanowisko: ${role}`
        : 'Aplikacja'
      : role
        ? `Application for ${role}`
        : 'Application';

  return who ? `${lead} — ${who}` : lead;
};

/** Fills the projection from `cv.json` when the caller supplied none. */
const candidateFromStore = async (context: RunContext): Promise<Candidate> => {
  const document = await context.store.documents.read();

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

export const draftApplication: Capability<DraftApplicationInput> = {
  name: 'draft_application',
  describe:
    'Write a job application email for one offer, using the CV. Returns a draft and a suggested recipient; sends nothing.',
  input: inputSchema,

  plan: async (input, context): Promise<Plan> => {
    // Read while planning rather than as a step, for the reason `analyze_offer`
    // gives: the body prompt needs the text, so a fetch that fails should fail
    // before any model call is paid for.
    const provided = input.offerText?.trim() ?? '';
    const url = input.url?.trim() ?? '';

    let text = provided;

    if (!text && url) {
      const outcome = await resolveOffer(url, context.signal);

      if (outcome.status !== 'ok') {
        throw new RuntimeError(outcome.detail, 'unreadable_source');
      }

      text = outcome.text;
    }

    const candidate = candidateSchema.parse(
      input.candidate ?? (await candidateFromStore(context))
    );

    const facts = offerFactsSchema.parse(input.offer ?? {});

    // The offer's own text is the query, which is what `searchProfile` is
    // documented for: the ranked bullets are the ones this posting makes
    // relevant, not the ones the CV happens to list first.
    const hits = await relevantHighlights(
      context,
      candidate,
      text || [facts.position, facts.company, ...facts.required_skills].join(' ')
    );

    const language = LANGUAGE_NAMES[input.language.toLowerCase()] ?? input.language;

    const prompt = compose(
      renderOfferBrief({
        position: facts.position,
        company: facts.company,
        requirements: facts.required_skills,
        text
      }),
      renderCandidate({
        name: candidate.name,
        role: candidate.role,
        summary: candidate.summary,
        skills: candidate.skills,
        recent: candidate.experience.map((entry) => ({
          company: entry.company,
          title: entry.title
        }))
      }),
      renderProfileContext(hits)
    );

    const known: KnownValues = {
      name: candidate.name,
      company: facts.company,
      position: facts.position,
      email: candidate.email,
      phone: candidate.phone
    };

    /**
     * Addresses out of the offer text, and nothing else.
     *
     * A transform because it is pure TypeScript, and non-critical because an
     * offer with no address in it is ordinary — plenty of boards have only an
     * apply button. The result is `to_suggestion`, never `to`: naming it after
     * what it is stops it being read as a decision this runtime made.
     */
    const recipient: TransformStep = {
      kind: 'transform',
      name: 'recipient',
      critical: false,
      run: async () => ({
        to_suggestion: findApplicationEmails(`${text}\n${facts.how_to_apply}`),
        apply_hint: facts.how_to_apply,
        // Stated in the payload rather than only in a comment, so a UI that
        // sends without asking is visibly ignoring the contract rather than
        // merely unaware of it.
        confirmation_required: true
      })
    };

    /**
     * Everything deterministic about the finished draft.
     *
     * Runs after the model step and merges last, so its `body` overrides the
     * raw one — the same override pattern `analyze_offer` uses for board facts.
     * Written to be total: it reads with defaults and never throws, because
     * losing a paid-for body to a formatting check would be a poor trade.
     */
    const review: TransformStep = {
      kind: 'transform',
      name: 'review',
      critical: false,
      run: async (runContext) => {
        const drafted = String(runContext.completed.body?.body ?? '');

        const reviewed = reviewDraft({
          subject: subjectFor(facts.position, candidate.name, input.language),
          body: drafted,
          known
        });

        return {
          subject: reviewed.subject,
          body: reviewed.body,
          warnings: reviewed.warnings,
          placeholders_filled: reviewed.filled,
          language: input.language,
          // Provenance, so cvitae can show which bullets fed the letter and the
          // user can tell a retrieved claim from an invented one.
          used_highlights: hits.map((hit) => ({
            text: hit.row.text,
            company: hit.row.company,
            title: hit.row.title
          }))
        };
      }
    };

    return {
      capability: 'draft_application',
      source: 'declared',
      concurrency: 'auto',
      steps: [
        {
          /**
           * `generate`, not `extract`, and that was measured rather than
           * assumed. Written first as an extraction returning `{ body: string }`
           * it failed on every model and every prompt variant tried — the table
           * is in `GenerateStep`. A schema around a single prose string is not a
           * safeguard here, it is the thing that breaks.
           */
          kind: 'generate',
          name: 'body',
          key: 'body',
          system: compose(
            `Write the body of an email applying for the job below. Write in ${language}.`,
            TONES[input.tone],
            `Keep it under ${input.max_words} words.`,
            DRAFTING_RULES
          ),
          prompt,
          /**
           * Sized from the word ceiling rather than fixed, since `max_words` is
           * what a caller changes. Three tokens per word is deliberate slack:
           * Polish tokenises considerably worse than English on these models,
           * and a body truncated mid-sentence is a wasted call.
           */
          maxOutputTokens: input.max_words * 3 + 200,
          // The one critical step. A draft with no body is not a draft, and
          // unlike a missing salary there is no useful partial result.
          critical: true
        },
        recipient,
        review
      ]
    };
  }
};
