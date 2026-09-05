/**
 * Changing the stored CV by saying what to change, and never by writing it.
 *
 * The panel beside this in the studio makes every field a tap target, which is
 * the right way to fix one word in a job title and a poor way to say "I left
 * Acme in June and started at Globex as a staff engineer". This is the other
 * half: an instruction in, a **proposed** document out.
 *
 * **It persists nothing, and that is the whole design.** There is no revision
 * history yet, so a write here would be unrecoverable, and the instruction can
 * arrive from a CV that was itself extracted from a PDF somebody else wrote —
 * `ask_profile` keeps its tool registry read-only for exactly that reason. A
 * capability that could rewrite the CV from prose would hand a prompt injection
 * the one thing the read-only registry denies it. So the result is a document
 * for a person to look at, and applying it goes back through the same
 * `profile.update` a manual edit uses, after they have seen what changed.
 *
 * That also settles what the result does *not* carry: a sentence from the model
 * saying what it did. The caller has the stored document and the proposed one,
 * so it can show the difference exactly, and a fluent summary of a change the
 * reader can see for themselves is a second claim to check rather than help.
 *
 * **One section per edit.** The section is chosen first, and then only that
 * section is sent, revised and merged back. Two reasons, and the second is the
 * load-bearing one:
 *
 * - A narrow schema is answered; a wide one is not. `contracts/capability.ts`
 *   records the measurement — a model that answers four fields reliably returns
 *   `{}` for twenty — and the whole CV is around sixty.
 * - The blast radius of a wrong answer is one section. An instruction about
 *   skills cannot lose a job, because employment history is never in the
 *   request and is copied from the source on the way out. `version` and
 *   `sources` are copied the same way: the first says which schema the body was
 *   written against, and the second is provenance, and neither is the model's
 *   to restate.
 *
 * What is given up is an instruction that spans two sections — "I moved to
 * Berlin and left Acme" edits the location and not the job. The caller is told
 * which section was changed, so the honest answer is to say it again for the
 * other one, and that is better than a schema wide enough to lose something.
 *
 * **An instruction arrives in a conversation, and only routing is told.**
 * "Make it shorter" is not an instruction until you know what *it* is, and this
 * was blind to that for as long as `ask_profile` was: the section was routed
 * from a sentence with no subject. Routing takes what was said before, and
 * measurably needs it — the same three words reach four different sections
 * depending on the exchange in front of them.
 *
 * The revision does not, and was measured actively harmed by it. By then the
 * section is chosen and its current contents are in the prompt, so the
 * conversation adds nothing the step is missing — and it can contradict the
 * instruction, because it is a transcript of somebody thinking out loud. Given
 * an assistant turn calling the summary "a single condensed narrative" and then
 * told to shorten it, `gemma4:12b` never stopped: `finish: length` at 3,200
 * output tokens, at 4,000 and at 6,000, where the same call without the
 * conversation answered in 38. Nought of three against three of three, and a
 * bigger ceiling only bought a longer wait for the same failure.
 *
 * So the conversation resolves the instruction and is then done. What the
 * revision gets is what it always got: one section, and a sentence about it.
 */

import { z } from 'zod';
import {
  HISTORY_BUDGET,
  SUMMARY_BUDGET,
  historySchema,
  renderTurns,
  summarySchema
} from '../../context/conversation.js';
import { compose, labelled } from '../../context/render.js';
import {
  RuntimeError,
  type Capability,
  type Plan,
  type RunContext,
  type Step,
  type StepContext
} from '../../contracts/index.js';
import {
  CV_ID,
  certificateSchema,
  cvDocumentSchema,
  educationEntrySchema,
  experienceEntrySchema,
  languageSchema,
  personalSchema,
  skillsSchema,
  type CvDocument
} from './document.js';

/* ------------------------------------------------------------------ sections */

/**
 * The editable sections, which are the document's own top-level keys minus the
 * two nobody dictates.
 *
 * Spelled out here rather than imported from `translate.ts`. The lists are the
 * same seven words today and they are not the same list: translation's
 * `personal` step means the location alone, because a name has no translation,
 * while an edit's `personal` is every contact detail. Sharing the constant
 * would make the next divergence a silent one.
 */
export const sectionNames = [
  'personal',
  'role_description',
  'skills',
  'experience',
  'education',
  'certificates',
  'languages'
] as const;

export type Section = (typeof sectionNames)[number];

const isSection = (value: unknown): value is Section =>
  typeof value === 'string' && (sectionNames as readonly string[]).includes(value);

/** What each section holds, for the model choosing between them. */
const describes: Readonly<Record<Section, string>> = {
  personal: 'name, email, phone, location and links',
  role_description: 'the summary paragraph about the person',
  skills: 'the professional role and the lists of languages, frameworks and tools',
  experience: 'jobs held: company, title, dates, highlights',
  education: 'degrees: university, degree, dates, thesis, mark',
  certificates: 'certificates and their issuers and dates',
  languages: 'spoken languages and levels'
};

/* --------------------------------------------------------------------- input */

export const inputSchema = z.object({
  instruction: z.string().min(1, 'Say what to change.'),
  /**
   * Skips the routing call.
   *
   * Present because a caller who knows already should not pay a model turn to
   * be told: a panel where somebody clicked into Experience and typed a
   * sentence has the answer in the click. Absent from chat, where the sentence
   * is all there is.
   */
  section: z.enum(sectionNames).optional(),
  /**
   * Edit this instead of the stored CV. Same reasoning as `translate_cv`: the
   * runtime holds the document, and a caller working on something it has not
   * saved has nowhere else to put it.
   */
  document: cvDocumentSchema.optional(),
  /**
   * What was said before, oldest first, without `instruction`.
   *
   * "Make it shorter" is not an instruction until you know what *it* is, and
   * before this the answer was nothing: the section was routed from a sentence
   * with no subject, and whichever section it landed on was then rewritten from
   * the same sentence. `ask_profile` gained this first; the blindness was
   * always shared and the fix is the same fix.
   */
  history: historySchema,
  /** What the turns before those came to. Standing context, not a turn. */
  summary: summarySchema
});

export type EditCvInput = z.infer<typeof inputSchema>;

export type EditCvResult = {
  /** The whole CV with one section revised. Nothing has been written. */
  readonly document: CvDocument;
  readonly section: Section;
  /** False when the model handed back what it was given. */
  readonly changed: boolean;
};

/* -------------------------------------------------------------- conversation */

/**
 * The conversation as prompt context, for the routing call and no other.
 *
 * **Context, not messages, and this is where `edit_cv` parts company with
 * `ask_profile`.** There the turns go to the provider as messages, because the
 * model is having the conversation and the next thing it says is the next turn
 * of it. Here it is not: it is handed a fixed list of section names and asked
 * which one applies, and prior assistant turns are prose. Sent as messages they
 * invite a reply in kind — which is the one thing a structured-output step
 * cannot use — and the run is spent on a paragraph where a name was due.
 *
 * The note keeps the label `ask_profile` gives it. Same content and same name,
 * so a person reading two prompts side by side is not asked to work out whether
 * they are the same thing.
 *
 * Empty when the conversation is empty, which is the property that matters:
 * `labelled` returns nothing for an empty body and `compose` drops it, so a
 * first instruction produces the prompt this capability was measured on, byte
 * for byte. Nothing here changes what already worked.
 */
const conversation = (input: EditCvInput): string =>
  compose(
    labelled('EARLIER IN THIS CONVERSATION', input.summary, SUMMARY_BUDGET),
    labelled('THE CONVERSATION SO FAR', renderTurns(input.history), HISTORY_BUDGET)
  );

/* ------------------------------------------------------------------- routing */

/**
 * An enum rather than a string, which is where this differs from
 * `routeWithModel` — that one picks from the capability map, which is built at
 * runtime and cannot be a static schema, so it validates by lookup afterwards.
 * The sections are known at compile time, so the list can reach the provider's
 * structured-output grammar instead of only being described in the prompt.
 *
 * `isSection` still guards the answer. A provider that honours the grammar
 * cannot get here with a wrong value; a small local model that ignores it can,
 * and this repo is largely a record of small local models ignoring things.
 */
const routing = z.object({
  section: z.enum(sectionNames).describe('The section the instruction changes.'),
  reason: z.string().describe('One short sentence saying why.')
});

/**
 * Which section the instruction is about.
 *
 * A model call in `plan()`, which is the exception `ask_profile` already makes
 * and for the same reason: the one thing a model decides here is which of a
 * fixed list of names applies, and the step that follows cannot be declared
 * until it is known — a `Step`'s schema is fixed when the plan is made.
 *
 * The prompt is shaped after `routeWithModel`, which asks the same kind of
 * question and was measured answering it 6 of 6 on `gemma4:12b`. Note that
 * `selectTools` failed 3 of 3 with a near-identical instruction and a different
 * opening verb, so this wording is worth leaving alone unless it is measured
 * again.
 *
 * Unlike both of those, a failure here cannot fall back to doing everything.
 * Tool selection can offer the whole registry and routing can decline to route;
 * an edit with no section is an edit with nothing to send. So it refuses, with
 * the one thing the caller can act on: name the section.
 */
const route = async (input: EditCvInput, context: RunContext): Promise<Section> => {
  if (input.section) return input.section;

  const refuse = (why: string): never => {
    throw new RuntimeError(
      `Could not tell which part of the CV to change (${why}). Say which section — ${sectionNames.join(', ')}.`,
      'invalid_input'
    );
  };

  try {
    const { object } = await context.effects.ai.generateObject({
      traceId: context.traceId,
      runId: context.runId,
      step: 'route',
      signal: context.signal,
      schema: routing,
      system: 'Choose the CV section the instruction changes. Use only a name from the list.',
      // The conversation first, then the wording that was measured, unchanged
      // and in the order it was measured in. This is the call that most needs
      // it: "make it shorter" names no section, and without what came before it
      // this is a choice between seven made from a sentence with no subject.
      prompt: compose(
        conversation(input),
        `INSTRUCTION:\n${input.instruction}`,
        `SECTIONS:\n${sectionNames.map((name) => `- ${name}: ${describes[name]}`).join('\n')}`
      ),
      /**
       * A truncation guard, not a budget, and it must clear the floor under
       * which structured output stops working at all.
       *
       * A routed answer is 29 to 49 output tokens and that number does not move
       * when this one is raised — the model stops on its own, so a generous
       * ceiling costs nothing. What it is guarding against is the other end.
       * Measured on `gemma4:12b` through Ollama's OpenAI-compatible endpoint,
       * three trials at each ceiling, with the JSON-schema grammar in force:
       *
       * ```
       * ceiling   no conversation        with a conversation
       * 200       length, at 200 tokens  length, at 200 tokens
       * 300       length, at 300 tokens  ok, 44-49 tokens
       * 400+      ok, 29-32 tokens       ok, 44 tokens
       * ```
       *
       * Below the floor the model does not run out of room part-way through a
       * long answer — the answer is thirty tokens. It emits filler to the limit
       * and never opens the object, which arrives as `AI_NoObjectGeneratedError`
       * and, here, as a refusal telling the person to name the section. The
       * floor is higher when the instruction is more ambiguous, which is the
       * wrong way round: the case that most needs routing was the one that
       * could not get it.
       *
       * 600 is half again the worst floor measured, and twelve times what an
       * answer actually costs. The previous 300 sat under the floor for exactly
       * the instructions this capability exists to handle.
       */
      maxOutputTokens: 600,
      temperature: 0
    });

    return isSection(object.section) ? object.section : refuse(`it answered "${object.section}"`);
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    // The message only. A raw SDK error carries the prompt and the response
    // body, and the gateway has already redacted what it throws.
    return refuse(String((error as Error)?.message ?? error));
  }
};

/* ------------------------------------------------------------------ schemas */

/**
 * `present` rather than `null`, for the same measured reason extraction and
 * translation both carry the sentinel: a small model asked for a nullable
 * string puts the four characters `null` in it. `closed` turns it back.
 */
const PRESENT = 'present';

const endish = z
  .string()
  .describe(`The end date, or exactly "${PRESENT}" when it has not ended.`);

const experience = z.object({
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      started: z.string().describe('The start date, as written on the CV.'),
      finished: endish,
      highlights: z.array(z.string()).describe('One achievement per entry, never a paragraph.'),
      skills: z.array(z.string()).describe('Technologies used in this job.')
    })
  )
});

const education = z.object({
  education: z.array(
    z.object({
      university: z.string(),
      degree: z.string(),
      started: z.string(),
      finished: endish,
      thesis: z.string(),
      mark: z.string()
    })
  )
});

const certificates = z.object({
  certificates: z.array(
    z.object({ name: z.string(), issuer: z.string(), started: z.string(), finished: endish })
  )
});

const languages = z.object({
  languages: z.array(
    z.object({
      name: z.string().describe('A spoken language, not a programming language.'),
      level: z.string()
    })
  )
});

/**
 * `summary`, not `role_description`, and this is not a style choice.
 *
 * `translate.ts` measured it: named after the field it fills, this step returns
 * an English persona statement — "You are a professional translator who…" —
 * because the model reads the property name as an instruction and a CV's *role
 * description* collides with the model's own *role*. 0 of 2 under the field
 * name, 2 of 2 under `summary`. `merge` maps it back.
 */
const summary = z.object({
  summary: z.string().describe('The complete summary paragraph, as one string.')
});

const personal = z.object({ personal: personalSchema });
const skills = z.object({ skills: skillsSchema });

/* --------------------------------------------------------------------- step */

/**
 * What the model spends before the JSON starts, and it dwarfs the JSON.
 *
 * Not a guess: `translate.ts` measured roughly two thousand tokens of
 * deliberation against sixty-five tokens of payload on `gemma4:12b`, and a
 * budget sized for the payload returned zero characters. The same allowance is
 * added to every step here, because an unused ceiling costs nothing —
 * generation stops at `stop` — and running out costs the whole edit.
 */
const THINKING_ALLOWANCE = 2_000;

type Shape = {
  readonly schema: z.ZodTypeAny;
  readonly tokens: number;
  /** The section as the model should see it, and what to call it. */
  readonly show: (document: CvDocument) => readonly [string, unknown];
  readonly extra?: string;
};

const shapes: Readonly<Record<Section, Shape>> = {
  personal: {
    schema: personal,
    tokens: 400,
    show: (document) => ['CURRENT CONTACT DETAILS', document.personal]
  },
  role_description: {
    schema: summary,
    tokens: 1_200,
    show: (document) => ['CURRENT SUMMARY', document.role_description],
    extra: 'Return the complete summary as one string, not a list.'
  },
  skills: {
    schema: skills,
    tokens: 600,
    show: (document) => ['CURRENT SKILLS', document.skills]
  },
  experience: {
    schema: experience,
    tokens: 8_000,
    show: (document) => ['CURRENT JOBS', document.experience],
    extra: `Return every job, including the ones the instruction does not mention. Use "${PRESENT}" for a job that has not ended.`
  },
  education: {
    schema: education,
    tokens: 2_000,
    show: (document) => ['CURRENT EDUCATION', document.education],
    extra: 'Return every entry, including the ones the instruction does not mention.'
  },
  certificates: {
    schema: certificates,
    tokens: 1_800,
    show: (document) => ['CURRENT CERTIFICATES', document.certificates],
    extra: 'Return every certificate, including the ones the instruction does not mention.'
  },
  languages: {
    schema: languages,
    tokens: 700,
    show: (document) => ['CURRENT SPOKEN LANGUAGES', document.languages],
    extra: 'Return every language, including the ones the instruction does not mention.'
  }
};

/**
 * What the model is allowed to do, and the two things it must not.
 *
 * "Change only what the instruction asks for" is the rule the whole capability
 * rests on, because the section comes back whole: a model that rewrites the two
 * jobs it was not asked about has produced a false CV, and one that returns
 * only the job it was asked about has deleted the rest. Both are stated.
 *
 * "Do not invent" is the same line `ask_profile` ends on. A model filling a
 * plausible employer into a half-given instruction is worse than one that
 * leaves it blank, because nobody rereading their own CV notices a detail they
 * would have written anyway.
 */
const rules = (section: Section, extra?: string): string =>
  [
    "You edit one section of the user's CV.",
    'Apply the instruction and change nothing else.',
    'Return the whole section, with the parts the instruction does not mention exactly as they are.',
    'Do not invent facts, dates, employers or numbers. Leave unknown values empty.',
    `The section is ${section}: ${describes[section]}.`,
    /*
     * There was a sixth line here — "The conversation is background. Apply only
     * the instruction." — added when the revision was given the conversation,
     * to stop it reapplying instructions that had already been applied. It went
     * out with the conversation it was about. An instruction the model cannot
     * see needs no sentence telling it what to make of it, and
     * `context/tools.ts` and `cv/evidence.ts` both measured that an extra line
     * costs reasoning time and is followed unreliably.
     */
    ...(extra ? [extra] : [])
  ].join('\n');

const source = (context: StepContext): CvDocument =>
  context.completed.source?.document as CvDocument;

const reviseStep = (section: Section, input: EditCvInput): Step => {
  const shape = shapes[section];

  return {
    kind: 'extract',
    name: section,
    schema: shape.schema,
    system: rules(section, shape.extra),
    // The instruction last, next to where the answer starts, and the section it
    // applies to immediately before it. The conversation is deliberately not
    // here — see the header. By this point it has done its work, which was
    // deciding which section `shape` is.
    prompt: (context) => {
      const [label, value] = shape.show(source(context));
      return compose(
        `${label}:\n${JSON.stringify(value, null, 2)}`,
        `INSTRUCTION:\n${input.instruction}`
      );
    },
    // See `THINKING_ALLOWANCE`: the first number is what the JSON needs, which
    // is not what the call costs.
    maxOutputTokens: shape.tokens + THINKING_ALLOWANCE,
    /**
     * Critical, like translation's steps and unlike extraction's.
     *
     * Not the difference between failing and succeeding — a degraded step
     * arrives at `merge` with no answer, which refuses as well, so the run ends
     * either way. It is the difference between a failure that says the provider
     * is down and one that says the edit produced nothing, and only the first
     * points at where the problem is.
     */
    critical: true
  };
};

/* ------------------------------------------------------------------ merging */

/** `present` back to the document's `null`; anything else through unchanged. */
const closed = (value: string): string | null => (value.trim() === PRESENT ? null : value);

/** Turns each entry's `present` into `null` before the document schema sees it. */
const withEnds = (value: unknown, section: Section): unknown[] => {
  if (!Array.isArray(value)) {
    throw new RuntimeError(`The edit to ${section} did not return a list.`, 'step_failed');
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const record = entry as Record<string, unknown>;
    return typeof record.finished === 'string'
      ? { ...record, finished: closed(record.finished) }
      : record;
  });
};

/**
 * The source document with one section replaced.
 *
 * Parsed rather than trusted. The executor validates the model's answer against
 * the step schema, and this parses it a second time against the *document's*
 * schema — which is a different question: the step schema says the model
 * answered the shape it was asked for, and this says the answer is a CV. The
 * two differ exactly where the sentinel is, and a section that cannot become a
 * document has to fail the run rather than reach a caller who is about to save
 * it.
 */
/**
 * One section's answer, checked against the shape the *document* wants.
 *
 * Named rather than raw, because a bare zod message on a top-level mismatch is
 * `expected array, received string` with an empty path — true, and it does not
 * say which section, which is the only part a person reading the failure can
 * act on. The issue text is carried through and the value is not: zod says what
 * shape was wrong, never what was in it, so nothing here puts the model's
 * output into a log.
 */
const parsed = <T>(schema: z.ZodType<T>, value: unknown, section: Section): T => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || section}: ${issue.message}`)
    .join('; ');

  throw new RuntimeError(`The edit to ${section} is not a usable section (${issues}).`, 'step_failed');
};

const merge = (context: StepContext, section: Section): EditCvResult => {
  const from = source(context);
  const answer = context.completed[section];

  if (!answer) {
    throw new RuntimeError(`The edit to ${section} produced nothing.`, 'step_failed');
  }

  const document: CvDocument = structuredClone(from);

  switch (section) {
    case 'personal':
      document.personal = parsed(personalSchema, answer.personal, section);
      break;
    case 'role_description':
      // `summary` on the wire. See the schema for the measurement.
      document.role_description = parsed(z.string(), answer.summary, section);
      break;
    case 'skills':
      document.skills = parsed(skillsSchema, answer.skills, section);
      break;
    case 'experience':
      document.experience = parsed(
        z.array(experienceEntrySchema),
        withEnds(answer.experience, section),
        section
      );
      break;
    case 'education':
      document.education = parsed(
        z.array(educationEntrySchema),
        withEnds(answer.education, section),
        section
      );
      break;
    case 'certificates':
      document.certificates = parsed(
        z.array(certificateSchema),
        withEnds(answer.certificates, section),
        section
      );
      break;
    case 'languages':
      document.languages = parsed(z.array(languageSchema), answer.languages, section);
      break;
  }

  return {
    // The whole document, so `version` and `sources` are proven to still be
    // the ones that were read rather than whatever the model had to say.
    document: cvDocumentSchema.parse(document),
    section,
    changed: JSON.stringify(document[section]) !== JSON.stringify(from[section])
  };
};

/* --------------------------------------------------------------- capability */

export const editCv: Capability<EditCvInput> = {
  name: 'edit_cv',
  describe:
    "Apply a written instruction to one section of the user's stored CV and return the proposed document without saving it.",
  input: inputSchema,

  plan: async (input, context: RunContext): Promise<Plan> => {
    const section = await route(input, context);

    return {
      capability: 'edit_cv',
      source: 'llm',
      stages: [
        /**
         * The read is a step, not something `plan()` does, for the reason
         * `translate_cv` gives: reaching into the store from a plan puts the
         * read outside the run's events and outside its failure policy.
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
                if (input.document) return { document: input.document };

                const record = context.documents.read(CV_ID);
                /**
                 * An empty document rather than a refusal, which is where this
                 * parts company with `translate_cv`. There is nothing to
                 * translate when there is no CV; there is everything to say
                 * when there is no CV, and dictating the first line of one is a
                 * reasonable way to start. Nothing is written either way, so
                 * the caller decides whether the proposal becomes a document.
                 */
                return {
                  document: record ? cvDocumentSchema.parse(record.body) : cvDocumentSchema.parse({})
                };
              }
            }
          ]
        },

        { name: 'revise', concurrency: 1, steps: [reviseStep(section, input)] },

        {
          name: 'assemble',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'proposal',
              critical: true,
              run: async (context) =>
                merge(context, section) as unknown as Record<string, unknown>
            }
          ]
        }
      ]
    };
  },

  aggregate: (outcomes) => outcomes.find((outcome) => outcome.step === 'proposal')?.value ?? {}
};
