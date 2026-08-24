/**
 * CV extraction: sources in, `cv.json` out.
 *
 * This is the pipeline from the diagram, with one extraction step per artefact
 * — personal details, role description, skills, experience, education,
 * certificates, languages — and an assemble step standing in for the parsers
 * and aggregator. The shape is inherited rather than invented: cvitae's offer
 * analysis established that one wide object is the thing that fails, and a CV
 * has more fields than an offer, not fewer.
 *
 * Two things differ from `analyze_offer`, both because sources are partial.
 *
 * No extraction step is critical. There, five agents all read the same complete
 * offer, so an agent returning nothing meant the model failed. Here a
 * certificate PDF genuinely has no employment history and a screenshot of a
 * profile header genuinely has no education, so "this step found nothing" is
 * the normal case and must not fail the run. What *is* critical is `assemble`,
 * which fails when *every* step came back empty — that really does mean the
 * import did not work, and silently writing an empty document would be worse
 * than an error.
 *
 * And the result is merged rather than written. See `store/merge.ts`: an import
 * may add and may fill a blank, but never overwrites. A hand-corrected job
 * title has to survive a later screenshot of the same profile.
 */

import { z } from 'zod';
import type { Capability, Plan, RunContext, Step, TransformStep } from '../core/types.js';
import { RuntimeError } from '../core/types.js';
import { cvDocumentSchema, type CvDocument } from '../store/cvDocument.js';
import { mergeDocument, type MergeReport } from '../store/merge.js';
import { readSources } from '../sources/index.js';
import { findSummary } from './findSummary.js';
import type { SourceInput, SourceRecord } from '../sources/index.js';

/**
 * Dates are strings, and "present" is a sentinel rather than `null`.
 *
 * `z.string().nullable()` becomes a union in the JSON schema, and a small model
 * asked for a union puts the string "null" in it about as often as a real null.
 * A sentinel it has to spell is one token it either produces or does not, and
 * `assemble` converts it once, in one place.
 */
const PRESENT = 'present';

const dateField = (what: string) =>
  z.string().describe(`${what} as written, e.g. "2021-03" or "2021". Empty string if not stated.`);

const endDateField = z
  .string()
  .describe(
    `End date as written, or exactly "${PRESENT}" if this is ongoing. Empty string if not stated.`
  );

const personalSchema = z.object({
  name: z.string().describe('Full name of the person the CV belongs to. Empty string if absent.'),
  email: z.string().describe('Email address. Empty string if absent.'),
  phone: z.string().describe('Phone number. Empty string if absent.'),
  location: z.string().describe('City or country of residence. Empty string if absent.'),
  links: z
    .array(
      z.object({
        name: z.string().describe('e.g. "github", "linkedin", "portfolio".'),
        url: z.string()
      })
    )
    .describe('Profile and portfolio links. Empty array if none.')
});

const skillsSchema = z.object({
  role: z.string().describe('Current job title, e.g. "Frontend Developer". Empty string if absent.'),
  programming_languages: z.array(z.string()).describe('Languages only, e.g. TypeScript, Python.'),
  frameworks: z.array(z.string()).describe('Frameworks only, e.g. React, Next.js, Django.'),
  libraries_and_tools: z
    .array(z.string())
    .describe('Everything else technical: libraries, tools, platforms, databases.')
});

const experienceSchema = z.object({
  experience: z
    .array(
      z.object({
        company: z.string().describe('Employer name.'),
        title: z.string().describe('Job title at that employer.'),
        started: dateField('Start date'),
        finished: endDateField,
        highlights: z
          .array(z.string())
          .describe(
            'What they did in this role, one statement per item, copied from the source. Do not merge two bullets into one.'
          ),
        skills: z.array(z.string()).describe('Technologies named in this role. Empty array if none.')
      })
    )
    .describe('Every job in the source, most recent first. Empty array if none.')
});

const educationSchema = z.object({
  education: z
    .array(
      z.object({
        university: z.string().describe('Institution name.'),
        degree: z.string().describe('Degree or field of study. Empty string if absent.'),
        started: dateField('Start date'),
        finished: endDateField,
        thesis: z.string().describe('Thesis title. Empty string if absent.'),
        mark: z.string().describe('Grade or classification. Empty string if absent.')
      })
    )
    .describe('Every school, university or course in the source. Empty array if none.')
});

const certificatesSchema = z.object({
  certificates: z
    .array(
      z.object({
        name: z.string().describe('Certificate name.'),
        issuer: z.string().describe('Who issued it. Empty string if absent.'),
        started: dateField('Issue date'),
        finished: endDateField
      })
    )
    .describe('Every certificate, licence or accreditation. Empty array if none.')
});

const languagesSchema = z.object({
  languages: z
    .array(
      z.object({
        name: z
          .string()
          .describe('A human language, e.g. "English", "Polish", "German".'),
        level: z.string().describe('Stated level, e.g. "B2", "native". Empty string if absent.')
      })
    )
    .describe(
      'Human languages the person speaks. Never programming languages. Empty array if none.'
    )
});

/**
 * Names that are never a spoken language, however the CV labels them.
 *
 * A guard, not a substitute for the prompt. Measured against the real cvitae CV:
 * its skills section is literally headed `languages: Javascript, HTML, CSS,
 * JSX, Typescript, Rust`, and gemma3:4b returned all six as spoken languages
 * with empty levels — the word "languages" on that line outweighed every
 * instruction about which kind. Sharpening the prompt fixed that sample; this
 * list is what makes the failure impossible rather than unlikely, because the
 * next CV will label the section something else again.
 */
const NOT_SPOKEN = new Set([
  'javascript', 'typescript', 'js', 'ts', 'jsx', 'tsx', 'python', 'java', 'c',
  'c++', 'c#', 'go', 'golang', 'rust', 'ruby', 'php', 'swift', 'kotlin',
  'scala', 'perl', 'html', 'html5', 'css', 'css3', 'sass', 'scss', 'sql',
  'bash', 'shell', 'solidity', 'dart', 'elixir', 'erlang', 'haskell', 'lua',
  'objective-c', 'assembly', 'vba', 'groovy', 'clojure', 'f#', 'r', 'matlab',
  'graphql', 'json', 'yaml', 'xml'
]);

/**
 * Whether a name is plausibly a language a person speaks.
 *
 * `NOT_SPOKEN` cannot list every technology, and measurement showed why it does
 * not have to: one run returned "React (Proficient)", and React was already
 * sitting in the frameworks the skills step had extracted from the same CV. So
 * the general guard is the cross-check — anything the CV itself presents as a
 * technical skill is not a spoken language — and the fixed list is the fallback
 * for when the skills step degrades and there is nothing to cross-check against.
 */
const isSpokenLanguage = (name: string, technical: Set<string>): boolean => {
  const key = name.trim().toLowerCase();
  return Boolean(key) && !NOT_SPOKEN.has(key) && !technical.has(key);
};

/**
 * Rejects a "certificate" that is just a skill the CV listed elsewhere.
 *
 * The same cross-check as `isSpokenLanguage`, against the same set, because it
 * is the same failure: a section reaching into a neighbouring one. Measured on
 * the real CV, the certificates step returned `ICP Blockchain SDK` — a line
 * from `libraries_and_tools` — beside the genuine certificate. It did that on
 * two runs in five at the provider's default temperature and on every run once
 * decoding went greedy, which is what made it worth a guard rather than a note.
 *
 * Matched on the whole name only. A real certificate is usually named after the
 * technology it covers, so anything looser would throw away "AWS Certified
 * Cloud Practitioner" for containing "AWS".
 */
const isCertificate = (name: string, technical: Set<string>): boolean => {
  const key = name.trim().toLowerCase();
  return Boolean(key) && !technical.has(key);
};

/**
 * Kept short and declarative, for the reason recorded in `prompt/builder.ts`:
 * with a small model the phrasing is load-bearing, and emphatic instructions
 * measurably did worse than plain ones.
 */
const RULES = `Use only what the sources contain. Do not infer or invent.
When the sources do not mention something, leave it empty.`;

export const inputSchema = z.object({
  sources: z
    .array(
      z.union([
        z.object({
          kind: z.literal('text'),
          label: z.string().optional(),
          content: z.string().min(1)
        }),
        z.object({ kind: z.literal('file'), path: z.string().min(1) }),
        // For callers with bytes and no path — see `sources/types.ts`. The
        // browser application this runtime exists to serve is one of them.
        z.object({
          kind: z.literal('upload'),
          filename: z.string().min(1),
          content: z.string().min(1)
        })
      ])
    )
    .min(1, 'At least one source is required.'),
  /**
   * Writes the merged document and rebuilds the index. On by default: the
   * capability exists to populate `cv.json`, and the merge cannot destroy
   * anything, so the safe default is the useful one.
   */
  persist: z.boolean().default(true),
  /**
   * Which artefacts to extract. All of them when omitted.
   *
   * The seven extractions are independent passes over the same corpus, and on
   * one local GPU the orchestrator runs them in turn — so a whole import is the
   * sum of seven model calls, and the caller pays for all of it inside a single
   * request budget. A 12B model on a full CV exceeded four minutes of it, which
   * fails the entire import for want of the last step.
   *
   * Naming a subset makes each request one model call. Nothing about the
   * pipeline changes — these steps never depended on each other, which is what
   * makes splitting them a scheduling decision rather than a redesign.
   */
  sections: z
    .array(
      z.enum([
        'personal',
        'role_description',
        'skills',
        'experience',
        'education',
        'certificates',
        'languages'
      ])
    )
    .min(1)
    .optional(),
  /**
   * Technical skills already known, for the guards that cross-check against
   * them.
   *
   * `isSpokenLanguage` and `isCertificate` both reject a value that the CV
   * lists as a skill elsewhere — which works only while the `skills` step ran
   * beside them. Splitting sections into separate requests broke that silently:
   * asked for `certificates` alone, the run has no skills to compare with, and
   * `ICP Blockchain SDK` came back as a certificate again, exactly as it did
   * before the guard existed. Measured on the real CV, both guards regressed
   * the moment the request was narrowed.
   *
   * So a caller running section by section passes back what it already has. The
   * guards then behave the same whether the seven steps ran together or apart,
   * which is the property that makes splitting them safe.
   */
  known_skills: z.array(z.string()).optional()
});

export type ExtractCvInput = z.infer<typeof inputSchema>;

export type ExtractCvResult = {
  document: CvDocument;
  merge: MergeReport | null;
  sources: SourceRecord[];
  /**
   * The corpus the extractions read.
   *
   * Returned so a caller running section by section can read the files once and
   * pass this back as a `text` source for the remaining sections. Without it,
   * splitting an import into seven requests re-reads the sources seven times —
   * which is merely wasteful for a PDF and genuinely expensive for a screenshot,
   * because reading an image *is* a model call.
   */
  text: string;
  skipped: { reference: string; reason: string }[];
  indexed: { embedded: number; removed: number; total: number } | null;
  /** Set when the document was saved but the index could not be rebuilt. */
  index_error: string | null;
  persisted: boolean;
};

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? (value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[])
    : [];

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];

/** `"present"` and `""` both become `null`, which is what the document stores. */
const endDate = (value: unknown): string | null => {
  const text = asString(value);
  if (!text || text.toLowerCase() === PRESENT) return null;
  return text;
};

/**
 * Builds the partial document from whatever the extraction steps produced.
 *
 * Every field is read defensively. These objects came from a model, and while
 * `generateObject` validates them against the schema, a *degraded* step
 * contributes `{}` — so any key here can legitimately be missing.
 */
const assembleDocument = (
  completed: Record<string, Record<string, unknown>>,
  records: SourceRecord[],
  /** Skills from earlier requests, when this run did not extract them itself. */
  knownSkills: string[] = []
): Partial<CvDocument> => {
  const personal = completed.personal ?? {};
  const links = Object.fromEntries(
    asArray(personal.links)
      .map((link) => [asString(link.name), asString(link.url)])
      .filter(([name, url]) => name && url)
  );

  const skills = completed.skills ?? {};

  // Parsed from the sources rather than generated, so it is verbatim by
  // construction and needs no verification.
  const summary = asString(completed.role_description?.role_description);

  // Everything the CV presents as a technical skill, for the language check.
  const technical = new Set(
    [
      ...asStringArray(skills.programming_languages),
      ...asStringArray(skills.frameworks),
      ...asStringArray(skills.libraries_and_tools),
      ...knownSkills
    ].map((value) => value.trim().toLowerCase()).filter(Boolean)
  );

  return cvDocumentSchema.partial().parse({
    personal: {
      name: asString(personal.name),
      email: asString(personal.email),
      phone: asString(personal.phone),
      location: asString(personal.location),
      links
    },
    role_description: summary,
    skills: {
      role: asString(skills.role),
      programming_languages: asStringArray(skills.programming_languages),
      frameworks: asStringArray(skills.frameworks),
      libraries_and_tools: asStringArray(skills.libraries_and_tools)
    },
    experience: asArray(completed.experience?.experience)
      .map((entry) => ({
        company: asString(entry.company),
        title: asString(entry.title),
        started: asString(entry.started),
        finished: endDate(entry.finished),
        highlights: asStringArray(entry.highlights),
        skills: asStringArray(entry.skills)
      }))
      // An entry with neither employer nor title is not a job, it is the model
      // filling the array because the schema said array.
      .filter((entry) => entry.company || entry.title),
    education: asArray(completed.education?.education)
      .map((entry) => ({
        university: asString(entry.university),
        degree: asString(entry.degree),
        started: asString(entry.started),
        finished: endDate(entry.finished),
        thesis: asString(entry.thesis),
        mark: asString(entry.mark)
      }))
      .filter((entry) => entry.university),
    certificates: asArray(completed.certificates?.certificates)
      .map((entry) => ({
        name: asString(entry.name),
        issuer: asString(entry.issuer),
        started: asString(entry.started),
        finished: endDate(entry.finished)
      }))
      .filter((entry) => isCertificate(entry.name, technical)),
    languages: asArray(completed.languages?.languages)
      .map((entry) => ({ name: asString(entry.name), level: asString(entry.level) }))
      .filter((entry) => isSpokenLanguage(entry.name, technical)),
    sources: records.map(({ kind, reference, imported_at }) => ({
      kind,
      reference,
      imported_at
    }))
  });
};

/** True when the extraction produced nothing worth saving. */
const isEmpty = (document: Partial<CvDocument>): boolean =>
  !document.personal?.name &&
  !document.role_description &&
  !document.skills?.role &&
  (document.experience?.length ?? 0) === 0 &&
  (document.education?.length ?? 0) === 0 &&
  (document.certificates?.length ?? 0) === 0 &&
  (document.languages?.length ?? 0) === 0;

export const extractCv: Capability<ExtractCvInput> = {
  name: 'extract_cv',
  describe:
    'Read a CV from pasted text, text files, PDFs or screenshots and merge it into the stored CV document.',
  input: inputSchema,

  plan: async (input, context: RunContext): Promise<Plan> => {
    // Reading happens while planning, because the extraction steps need the
    // corpus in their prompts. Images go through the model, so this can be the
    // slowest part of the run.
    const { text, records, skipped } = await readSources({
      inputs: input.sources as SourceInput[],
      model: await context.model(),
      signal: context.signal,
      ai: {
        aiLogger: context.aiLogger,
        traceId: context.traceId,
        providerId: context.providerId,
        modelId: context.modelId,
        capability: context.capability
      }
    });

    if (!text) {
      const detail = skipped.map((entry) => `${entry.reference}: ${entry.reason}`).join('; ');
      throw new RuntimeError(
        `None of the sources could be read.${detail ? ` ${detail}` : ''}`,
        'step_failed'
      );
    }

    const prompt = `CV SOURCES:\n${text}`;

    const assemble: TransformStep = {
      kind: 'transform',
      name: 'assemble',
      // The one step that must work: it is what turns seven independent
      // extractions into a document, and it is where an entirely failed import
      // is caught rather than written out as an empty CV.
      critical: true,
      run: async (runContext) => {
        const extracted = assembleDocument(
          runContext.completed,
          records,
          input.known_skills
        );

        /**
         * Only a whole import can be judged empty.
         *
         * This guard exists to catch sources that were not a CV at all, and it
         * reads a run's total emptiness as that failure. A run of one named
         * section cannot support the inference: asking only for certificates,
         * from a CV that has none, is a correct answer that looks identical.
         */
        if (!input.sections && isEmpty(extracted)) {
          throw new Error(
            'Nothing could be extracted from the sources. They may not be a CV, or the model may have returned nothing usable.'
          );
        }

        if (!input.persist) {
          const preview = mergeDocument(cvDocumentSchema.parse({}), extracted);
          return {
            document: preview.document,
            merge: preview.report,
            sources: records,
            text,
            skipped,
            indexed: null,
            index_error: null,
            persisted: false
          } satisfies ExtractCvResult as unknown as Record<string, unknown>;
        }

        const existing = await runContext.store.documents.read();
        const { document, report } = mergeDocument(existing, extracted);
        const saved = await runContext.store.documents.write(document);

        // Indexing needs an embedding model, and the document is already safely
        // on disk by this point. A missing `nomic-embed-text` must therefore
        // degrade to "saved but not searchable" rather than losing the import.
        let indexed: ExtractCvResult['indexed'] = null;
        let indexError: string | null = null;

        try {
          indexed = await runContext.store.reindex(saved);
        } catch (error) {
          indexError = (error as Error).message;
          // The message only. A provider error carries the whole request body,
          // and dumping that for an expected, already-handled condition buries
          // the one line that says what to do about it.
          console.warn(`The CV was saved but could not be indexed: ${indexError}`);
        }

        return {
          document: saved,
          merge: report,
          sources: records,
          text,
          skipped,
          indexed,
          index_error: indexError,
          persisted: true
        } satisfies ExtractCvResult as unknown as Record<string, unknown>;
      }
    };

    const extractionSteps: Step[] = [
        {
          kind: 'extract',
          name: 'personal',
          schema: personalSchema,
          system: `Extract the person's contact details from the CV.\n${RULES}`,
          prompt,
          maxOutputTokens: 700,
          critical: false,
          fallback: {}
        },
        {
          kind: 'transform',
          name: 'role_description',
          // Not a model call. See `findSummary` for the measurements: every
          // phrasing tried returned the instruction rather than the paragraph
          // at least four times in five, because quoting contiguous text is the
          // one job here that is parsing rather than generation.
          critical: false,
          run: async () => ({ role_description: findSummary(text) })
        },
        {
          kind: 'extract',
          name: 'skills',
          schema: skillsSchema,
          system: `Extract the technical skills from the CV, sorted into the three groups.\n${RULES}`,
          prompt,
          maxOutputTokens: 1_200,
          critical: false,
          fallback: {}
        },
        {
          kind: 'extract',
          name: 'experience',
          schema: experienceSchema,
          system: `List every job in the CV with its dates and what the person did.\n${RULES}`,
          prompt,
          // By far the widest output here: an array of objects each containing
          // its own array. `analyze_offer` measured truncation at exactly 900
          // tokens on two flat string arrays, and this is a great deal more —
          // and truncation costs a whole job, not a bullet.
          maxOutputTokens: 6_000,
          critical: false,
          fallback: {}
        },
        {
          kind: 'extract',
          name: 'education',
          schema: educationSchema,
          system: `List the education history from the CV.\n${RULES}`,
          prompt,
          maxOutputTokens: 1_500,
          critical: false,
          fallback: {}
        },
        {
          kind: 'extract',
          name: 'certificates',
          schema: certificatesSchema,
          system: `List the certificates and accreditations from the CV.\n${RULES}`,
          prompt,
          maxOutputTokens: 1_200,
          critical: false,
          fallback: {}
        },
        {
          kind: 'extract',
          name: 'languages',
          schema: languagesSchema,
          // Split from `skills`, and then sharpened again after the split alone
          // proved insufficient. A real CV headed its skills line `languages:
          // Javascript, HTML, CSS` and the model took all of them — so the
          // instruction now names the trap rather than only the target. The
          // `NOT_SPOKEN` filter catches whatever this still misses.
          system: `List the human languages the person speaks, with the stated level of each.
A CV often has a skills line labelled "languages" that lists programming languages such as JavaScript, HTML or Rust. That line is not what this is asking for. Ignore it.
Return only languages people speak to each other, such as English, Polish or German.
${RULES}`,
          prompt,
          maxOutputTokens: 600,
          critical: false,
          fallback: {}
        }
    ];

    /**
     * Kept in declared order rather than the caller's.
     *
     * `assemble` reads `completed` by step name, so order does not affect the
     * document — but it does decide what runs first when several sections are
     * asked for at once, and reading a CV top-down is the order a person would
     * expect a partially-filled preview to arrive in.
     */
    const wanted = input.sections;
    const steps = wanted
      ? extractionSteps.filter((step) => wanted.includes(step.name as typeof wanted[number]))
      : extractionSteps;

    return {
      capability: 'extract_cv',
      source: 'declared',
      concurrency: 'auto',
      steps: [...steps, assemble]
    };
  },

  /** The assemble step already produced the result shape; pass it through. */
  aggregate: (outcomes) =>
    outcomes.find((outcome) => outcome.step === 'assemble')?.value ?? {}
};
