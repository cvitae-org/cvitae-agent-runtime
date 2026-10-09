/**
 * The same CV in another language: every fact preserved, nothing improved.
 *
 * Three things shape this capability, and all three are constraints rather than
 * features.
 *
 * **It is split by section, like extraction, for the same measured reason.** A
 * whole CV is more output than a small local model produces in one request, and
 * seven narrow calls have bounded output and name the section that failed.
 *
 * **It verifies rather than trusts.** A translation that quietly drops a
 * percentage, spells a digit out, or returns four highlights where the source
 * had five is not a worse translation, it is a false CV — and unlike a clumsy
 * phrase, nobody rereading it in a language they do not speak will catch it. So
 * the model's answer is checked against the source field by field, and a
 * mismatch fails the run with the field named.
 *
 * **It persists nothing.** There is one CV document, and writing a translation
 * over it would destroy the original: the store has no locale in its key, and
 * inventing one here would create a second document that goes silently stale
 * the next time an import touches the first. Until something owns that
 * question, the honest thing is to hand the translation back and let the caller
 * decide.
 *
 * What is deliberately not carried over from the previous runtime: a second CV
 * schema. That one existed because a browser held user-named skill groups, and
 * a capability that takes a document shaped like one client's UI is a
 * capability that cannot be called by anything else. This translates the stored
 * `CvDocument`, whose skill groups are three fixed keys — so there are no group
 * labels to translate, and the `skills` step translates the job title alone.
 */

import { z } from 'zod';
import { RuntimeError, type Capability, type Plan, type Step, type StepContext } from '../../contracts/index.js';
import { languageName, localeSchema } from '../language.js';
import {
  CV_ID,
  cvDocumentSchema,
  type CvDocument
} from './document.js';
import { cvView, restoreCv, viewOf } from './walls.js';
import type { CvWithheld } from './walls.js';

/* ------------------------------------------------------------------- input */

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

export const inputSchema = z
  .object({
    source_language: localeSchema,
    target_language: localeSchema,
    sections: z.array(z.enum(sectionNames)).min(1).optional(),
    /**
     * Translate this instead of the stored CV.
     *
     * Optional because the harness has the document already and making a caller
     * post it back would be asking them to hold state the runtime holds better.
     * Present because a caller translating something it has not saved — a
     * preview, a draft, a variant — has nowhere else to put it.
     */
    document: cvDocumentSchema.optional()
  })
  .refine((input) => input.source_language !== input.target_language, {
    message: 'Source and target languages must be different.',
    path: ['target_language']
  });

export type TranslateCvInput = z.infer<typeof inputSchema>;

export type TranslateCvResult = {
  /** The whole CV. Sections that were not translated are still in the source language. */
  readonly document: CvDocument;
  /** Which sections are in the target language. Everything else is not. */
  readonly translated: readonly Section[];
  readonly source_language: string;
  readonly target_language: string;
};

/* ---------------------------------------------------------- the guard rails */

const numericTokens = (value: string): string[] => value.match(/\p{N}+/gu) ?? [];

/**
 * Which numbers a translation lost and which it invented.
 *
 * Compared as a multiset rather than a sequence, and that is the whole of the
 * change from the first version of this guard. Sequence comparison rejected
 * every bullet whose clauses moved, which between two languages is most of
 * them: Polish fronts the time adverbial where English trails it, so
 * "W 2020 roku zwiększyłem sprzedaż o 30%" becomes "Increased sales by 30% in
 * 2020" and `2020|30` fails to equal `30|2020`. Measured over seven realistic
 * pairs, three were refused and two of those were nothing but reordering — a
 * correct translation, every figure intact, blocked for putting the figures in
 * the order the target language wants.
 *
 * What is given up is the inversion: "from Python 2 to Python 3" rendered as
 * "from Python 3 to Python 2" holds the same two numbers and passes here. That
 * is a real risk and a far rarer one than clause reordering, it is the kind of
 * error a reader catches, and nothing is written by this capability anyway.
 * Refusing every reordered bullet to catch it was the worse trade, because it
 * refused work that was correct.
 *
 * Returns null when nothing moved.
 */
export const numberDrift = (source: string, translated: string): string | null => {
  const before = numericTokens(source);
  const remaining = [...numericTokens(translated)];
  const lost: string[] = [];

  for (const token of before) {
    const at = remaining.indexOf(token);
    if (at === -1) lost.push(token);
    else remaining.splice(at, 1);
  }

  if (lost.length === 0 && remaining.length === 0) return null;

  // Named, because "Translation changed a number in experience.0.highlights.7"
  // says which field and nothing else — not which figure, not what became of
  // it, and not whether the model dropped a percentage or spelled out a five.
  // The user cannot act on that, and neither can anyone reading a bug report.
  if (lost.length > 0 && remaining.length > 0) {
    return `${lost.join(', ')} became ${remaining.join(', ')}`;
  }

  return lost.length > 0
    ? `${lost.join(', ')} went missing`
    : `${remaining.join(', ')} was not in the source`;
};

/** A translation may change words, but never a date, level, amount or metric. */
const translated = (source: string, output: unknown, path: string): string => {
  // An empty source field has no translation and needs no model output. This is
  // also what makes a mostly-empty CV translatable at all: most people have no
  // thesis and no certificate issuer.
  if (!source.trim()) return '';

  const answer = typeof output === 'string' ? output.trim() : '';
  if (!answer) throw new Error(`Translation dropped ${path}.`);

  const drift = numberDrift(source, answer);
  if (drift) throw new Error(`Translation changed a number in ${path}: ${drift}.`);

  return answer;
};

/**
 * An end date, in the three states the document defines.
 *
 * `null` means still ongoing and is copied rather than translated: it is a fact
 * about the job, not a word, and the model has no standing to reinterpret it.
 * `''` means not stated and stays empty. Only a real date is sent through the
 * number check, where translating the month name is allowed and changing the
 * year is not.
 */
const endDate = (source: string | null, output: unknown, path: string): string | null =>
  source === null ? null : translated(source, output, path);

/** The model's answer for a list, checked for length before anything reads it. */
const sameLength = (output: unknown, expected: number, what: string): unknown[] => {
  if (!Array.isArray(output) || output.length !== expected) {
    const got = Array.isArray(output) ? output.length : 'none';
    throw new Error(`Translation returned ${got} ${what} where the source has ${expected}.`);
  }
  return output as unknown[];
};

/** One list entry, as an object the field readers can index. */
const entryAt = (answers: readonly unknown[], index: number): Record<string, unknown> => {
  const answer = answers[index];
  return answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : {};
};

/* ----------------------------------------------------------------- schemas */

/**
 * The end-date sentinel, and why it is a word rather than `null`.
 *
 * Same reason as extraction: a small model asked for a nullable string puts the
 * four characters `null` in it. Nothing downstream reads this — `endDate`
 * copies an ongoing role straight from the source — but the schema still has to
 * offer the model somewhere to put "ongoing", or it invents a date.
 */
const PRESENT = 'present';

const endish = z
  .string()
  .describe(`The translated end date, or exactly "${PRESENT}" when the role is ongoing.`);

const personalTranslation = z.object({
  location: z.string().describe('The translated location.')
});

/**
 * `summary`, not `role_description`, and the name is the whole of it.
 *
 * Named after the section it fills, this step returned an English persona
 * statement — "You are a professional translator who translates CV content from
 * English to Polish…" — instead of a translation. Every time. The model reads
 * the property name as an instruction, and a CV's *role description* collides
 * exactly with the model's own *role*, so it described itself.
 *
 * Measured against `gemma4:12b`, same rules, same prompt, same budget, only the
 * property name changing, two attempts each:
 *
 *   role_description   0/2   "You are a professional translator who…"
 *   summary            2/2   "Starszy Inżynier Backendu z dziewięcioma latami…"
 *   translation        2/2   "Starszy Inżynier Backendu z dziewięcioma latami…"
 *
 * The prompt was ruled out first: three different shapes — these rules as a
 * system prompt, the text fenced between markers, and everything in the user
 * turn with no system prompt at all — all returned the persona statement while
 * the name stayed `role_description`.
 *
 * So a wire name is not free, and it does not have to match the field it lands
 * in. `assemble` maps this one back.
 */
const roleTranslation = z.object({
  summary: z.string().describe('The complete translated summary, as one string.')
});

const skillsTranslation = z.object({
  role: z.string().describe('The translated professional role, e.g. "Backend Engineer".')
});

const experienceTranslation = z.object({
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      started: z.string(),
      finished: endish,
      highlights: z.array(z.string())
    })
  )
});

const educationTranslation = z.object({
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

const certificatesTranslation = z.object({
  certificates: z.array(
    z.object({ name: z.string(), issuer: z.string(), started: z.string(), finished: endish })
  )
});

const languagesTranslation = z.object({
  languages: z.array(z.object({ name: z.string(), level: z.string() }))
});

/* ------------------------------------------------------------------- steps */

/** The document that is translated: the source, with whatever the conversation excludes taken out. */
const source = (context: StepContext): CvDocument =>
  context.completed.source?.document as CvDocument;

/** What was taken out of it. It is not translated, and goes back into the result as it was. */
const withheldOf = (context: StepContext): CvWithheld | undefined =>
  context.completed.source?.withheld as CvWithheld | undefined;

const rules = (input: TranslateCvInput): string => {
  const from = languageName(input.source_language) ?? input.source_language;
  const to = languageName(input.target_language) ?? input.target_language;

  /**
   * Short, and every line that went is a line that was measured out.
   *
   * The rules used to spell out what "keep the numbers" means with a worked
   * example: `"5 osób" is "5 people", not "five people"`. On `gemma4:12b` that
   * one clause is the difference between an answer and a timeout. Translating
   * the one-sentence summary, ceiling 2 000 output tokens, temperature 0:
   *
   *   with the bilingual example         `length`, zero characters, 69s
   *   the same rules without it          answered, 63s
   *   also without the number rule       answered, 30s
   *   names rule on one line             answered, 45s
   *   neither rule                       answered, 23s
   *
   * Reasoning time tracks the length of this string almost linearly, and the
   * example costs more than its own length: it is a Polish-to-English pair sitting
   * inside an English-to-Polish instruction, so the model has to work out that it
   * is an illustration rather than the job. Raising the ceiling instead of cutting
   * the string does not rescue it — the same call needed somewhere between 4 000
   * and 8 000 tokens and four and a half minutes to answer, per section, which is
   * not a translation anyone waits for.
   *
   * The two rules are kept because they earn their keep — the technology names
   * survive verbatim and the digits stay digits — but each is one line now.
   */
  return [
    `Translate CV content from ${from} to ${to}.`,
    'Translate faithfully. Preserve every fact, meaning, number, list item and list order.',
    'Do not improve, summarise, expand, omit or invent anything.',
    'Keep personal names, contact details, URLs, company and product names, technology names and acronyms unchanged.',
    'Write every number with the same digits as the source.',
    `Use natural professional ${to}.`
  ].join('\n');
};

/** The source, as JSON, under a heading. Counts are stated where a list has one. */
const shown = (label: string, value: unknown): string => {
  const count = Array.isArray(value)
    ? `\nReturn exactly ${value.length} entries, in this order.`
    : '';
  return `${label}:\n${JSON.stringify(value, null, 2)}${count}`;
};

/**
 * What the model spends before the JSON starts, and it dwarfs the JSON.
 *
 * Measured against `gemma4:12b`, the local default, on the shipped prompt for
 * the one-sentence summary — the 1 200 tokens that step declares against the
 * 3 200 the allowance gives it:
 *
 *   1 200   `length`, zero characters, 39s
 *   3 200   the complete object, 45s, payload 65 tokens
 *
 * So roughly two thousand tokens go on reasoning to produce sixty-five tokens of
 * answer, and a budget sized for the payload buys nothing at all. This is with
 * `rules` already cut to the short form; the long one needed four times as much
 * again.
 *
 * Ollama does not report those tokens — `usage.outputTokens` came back as 65 on
 * the call that spent them, and as exactly the ceiling on the call that ran out.
 * They cannot be read off a successful response, only bracketed by failure,
 * which is why this is a constant with a number in a comment rather than
 * something derived.
 *
 * Added to every step rather than to the one that failed. `personal` finishes
 * inside 200 tokens because "Warsaw" needs no deliberation, but which sections
 * make this model think is not predictable from here, and an unused ceiling
 * costs nothing: 2 400 and 3 000 both returned the same object in the same 51
 * seconds, because generation stops at `stop`.
 *
 * None of which makes this capability comfortable locally. `experience` is one
 * call carrying every job, and on this model it did not finish inside the run's
 * ten-minute deadline. The allowance is what lets the small sections through;
 * the large one wants a hosted provider.
 */
const THINKING_ALLOWANCE = 2_000;

/**
 * Every translation step is critical, which is the opposite of extraction.
 *
 * An extraction step that finds nothing has found a true fact about a partial
 * source. A translation step that fails has left a section in the wrong
 * language, and a CV half in Polish is not a degraded answer — it is one nobody
 * can send. So there are no fallbacks here, and a failure ends the run.
 */
const step = (
  name: Section,
  schema: z.ZodTypeAny,
  extra: string,
  maxOutputTokens: number,
  prompt: (document: CvDocument) => string
): Step => ({
  kind: 'extract',
  name,
  schema,
  system: extra,
  prompt: (context) => prompt(source(context)),
  // The number each step passes is what its JSON needs. See `THINKING_ALLOWANCE`
  // for why that is not what the call costs.
  maxOutputTokens: maxOutputTokens + THINKING_ALLOWANCE,
  critical: true
});

/**
 * The counts in each prompt are what the schema used to carry.
 *
 * The previous version built `z.array(...).length(n)` from the source document,
 * which it could do because the caller posted the document in. Reading it from
 * the store instead means the source is not known until a step runs, and a
 * `Step`'s schema is fixed when the plan is made. The count moved to the prompt,
 * which is where a model reads it anyway; what is genuinely lost is the
 * executor's one retry on a schema mismatch, so a miscount now fails in
 * `assemble` with the field named instead of being retried once first.
 */
const steps = (input: TranslateCvInput): readonly Step[] => {
  const shared = rules(input);
  const also = (line: string) => `${shared}\n${line}`;

  return [
    step(
      'personal',
      personalTranslation,
      also('Translate only the location. Names, contact details and links are copied by the runtime and are not in the prompt.'),
      200,
      (document) => shown('SOURCE LOCATION', document.personal.location)
    ),
    step(
      'role_description',
      roleTranslation,
      also('Return the complete summary as one string.'),
      1_200,
      (document) => shown('SOURCE SUMMARY', document.role_description)
    ),
    step(
      'skills',
      skillsTranslation,
      also('Translate only the professional role. The skill lists are technology names and are copied verbatim by the runtime.'),
      300,
      (document) => shown('SOURCE ROLE', document.skills.role)
    ),
    step(
      'experience',
      experienceTranslation,
      also(`Return every job and every highlight in exactly the source order. Translate month names in dates. Use "${PRESENT}" for a null end date. The technical skill list of each job is copied separately and is not in the prompt.`),
      8_000,
      (document) =>
        shown(
          'SOURCE EXPERIENCE',
          document.experience.map(({ company, title, started, finished, highlights }) => ({
            company,
            title,
            started,
            finished,
            highlights
          }))
        )
    ),
    step(
      'education',
      educationTranslation,
      also(`Return every education entry in exactly the source order. Translate month names in dates. Use "${PRESENT}" for a null end date.`),
      2_000,
      (document) => shown('SOURCE EDUCATION', document.education)
    ),
    step(
      'certificates',
      certificatesTranslation,
      also(`Return every certificate in exactly the source order. Translate month names in dates. Use "${PRESENT}" for a null end date.`),
      1_800,
      (document) => shown('SOURCE CERTIFICATES', document.certificates)
    ),
    step(
      'languages',
      languagesTranslation,
      also('These are human languages the person speaks, not programming languages. Return every entry in exactly the source order.'),
      700,
      (document) => shown('SOURCE SPOKEN LANGUAGES', document.languages)
    )
  ];
};

/* --------------------------------------------------------------- assembling */

/**
 * The source document with the translated sections swapped in.
 *
 * Starting from the source rather than from an empty document is the one change
 * of substance from the previous version. That one returned only the sections
 * it had translated and left a client to merge them, which was right when the
 * client held two locale documents and knew how to reconcile them. Here nobody
 * does, and a document with four empty sections is indistinguishable from a CV
 * that has no education. Returning the whole CV, with `translated` naming which
 * parts are in the target language, says the same thing without the ambiguity.
 *
 * Every copied field is copied on purpose. Contact details, links, technology
 * names and `sources` are the same in any language, and asking a model to
 * reproduce them is asking it to make a mistake.
 */
const assemble = (context: StepContext): CvDocument => {
  const from = source(context);
  const done = context.completed;
  const document: CvDocument = structuredClone(from);

  if (done.personal) {
    document.personal = {
      ...from.personal,
      location: translated(from.personal.location, done.personal.location, 'personal.location')
    };
  }

  if (done.role_description) {
    // `summary` on the wire, `role_description` in the document. See the schema.
    document.role_description = translated(
      from.role_description,
      done.role_description.summary,
      'role_description'
    );
  }

  if (done.skills) {
    document.skills = {
      ...from.skills,
      role: translated(from.skills.role, done.skills.role, 'skills.role')
    };
  }

  if (done.experience) {
    const answers = sameLength(done.experience.experience, from.experience.length, 'jobs');

    document.experience = from.experience.map((entry, index) => {
      const answer = entryAt(answers, index);
      const at = `experience.${index}`;
      const highlights = sameLength(answer.highlights, entry.highlights.length, `highlights in ${at}`);

      return {
        company: translated(entry.company, answer.company, `${at}.company`),
        title: translated(entry.title, answer.title, `${at}.title`),
        started: translated(entry.started, answer.started, `${at}.started`),
        finished: endDate(entry.finished, answer.finished, `${at}.finished`),
        highlights: entry.highlights.map((highlight, at2) =>
          translated(highlight, highlights[at2], `${at}.highlights.${at2}`)
        ),
        // Technology names, copied. See the note above.
        skills: [...entry.skills]
      };
    });
  }

  if (done.education) {
    const answers = sameLength(done.education.education, from.education.length, 'education entries');

    document.education = from.education.map((entry, index) => {
      const answer = entryAt(answers, index);
      const at = `education.${index}`;
      return {
        university: translated(entry.university, answer.university, `${at}.university`),
        degree: translated(entry.degree, answer.degree, `${at}.degree`),
        started: translated(entry.started, answer.started, `${at}.started`),
        finished: endDate(entry.finished, answer.finished, `${at}.finished`),
        thesis: translated(entry.thesis, answer.thesis, `${at}.thesis`),
        mark: translated(entry.mark, answer.mark, `${at}.mark`)
      };
    });
  }

  if (done.certificates) {
    const answers = sameLength(
      done.certificates.certificates,
      from.certificates.length,
      'certificates'
    );

    document.certificates = from.certificates.map((entry, index) => {
      const answer = entryAt(answers, index);
      const at = `certificates.${index}`;
      return {
        name: translated(entry.name, answer.name, `${at}.name`),
        issuer: translated(entry.issuer, answer.issuer, `${at}.issuer`),
        started: translated(entry.started, answer.started, `${at}.started`),
        finished: endDate(entry.finished, answer.finished, `${at}.finished`)
      };
    });
  }

  if (done.languages) {
    const answers = sameLength(done.languages.languages, from.languages.length, 'spoken languages');

    document.languages = from.languages.map((entry, index) => {
      const answer = entryAt(answers, index);
      const at = `languages.${index}`;
      return {
        name: translated(entry.name, answer.name, `${at}.name`),
        level: translated(entry.level, answer.level, `${at}.level`)
      };
    });
  }

  return document;
};

/** The assembled document with what was never shown to the model put back. */
const restored = (context: StepContext, document: CvDocument): CvDocument => {
  const withheld = withheldOf(context);
  return withheld === undefined ? document : restoreCv(document, withheld);
};

/* -------------------------------------------------------------- capability */

export const translateCv: Capability<TranslateCvInput> = {
  name: 'translate_cv',
  describe: 'Translate the stored CV into another language, preserving every fact and its structure.',
  input: inputSchema,

  plan: (input): Plan => {
    const wanted = input.sections;
    const selected = steps(input).filter(
      (step) => !wanted || wanted.includes(step.name as Section)
    );

    return {
      capability: 'translate_cv',
      source: 'declared',
      stages: [
        /**
         * Reading the CV, as a step, for the same reason extraction reads its
         * sources as one: a plan is made before any step exists, and reaching
         * into the store from `plan()` would put the read outside the run's
         * events and outside its failure policy.
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
                // What the conversation has excluded is not sent to a model, so
                // it is not translated. It is not lost either: the result is a
                // whole document, and `assemble` puts it back.
                if (input.document) {
                  const view = cvView(input.document, context.walls?.pieces() ?? [], context.contextId ?? CV_ID);
                  return view.walled ? { document: view.shown, withheld: view.withheld } : { document: input.document };
                }

                const record = context.documents.read(CV_ID);
                if (!record) {
                  throw new RuntimeError(
                    'There is no stored CV to translate. Import one first, or pass a document.',
                    'invalid_input'
                  );
                }

                const cut = viewOf(record);
                return {
                  document: cvDocumentSchema.parse(record.body),
                  ...(cut?.walled === true ? { withheld: cut.withheld } : {})
                };
              }
            }
          ]
        },

        {
          name: 'translate',
          // One call per section. They share nothing, and against a local
          // provider `'auto'` runs them one at a time anyway.
          concurrency: 'auto',
          steps: selected
        },

        {
          name: 'verify',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'assemble',
              // Where every check lives, and the reason a bad translation is a
              // failed run rather than a saved falsehood.
              critical: true,
              run: async (context) =>
                ({
                  document: restored(context, assemble(context)),
                  translated: selected.map((step) => step.name as Section),
                  source_language: input.source_language,
                  target_language: input.target_language
                }) satisfies TranslateCvResult as unknown as Record<string, unknown>
            }
          ]
        }
      ]
    };
  },

  aggregate: (outcomes) => outcomes.find((outcome) => outcome.step === 'assemble')?.value ?? {}
};
