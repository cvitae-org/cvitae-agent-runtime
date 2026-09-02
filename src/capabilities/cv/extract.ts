/**
 * CV extraction: sources in, a merged CV document out.
 *
 * One extraction step per artefact — personal details, role description, skills,
 * experience, education, certificates, languages — and an assemble step that
 * folds them into the stored document. The shape is inherited rather than
 * invented: offer analysis established that one wide object is the thing that
 * fails, and a CV has more fields than an offer, not fewer.
 *
 * Two things differ from `analyze_offer`, both because sources are partial.
 *
 * **No extraction step is critical.** There, five steps all read the same
 * complete offer, so a step returning nothing meant the model failed. Here a
 * certificate PDF genuinely has no employment history and a screenshot of a
 * profile header genuinely has no education, so "this step found nothing" is the
 * normal case and must not fail the run. What *is* critical is `assemble`, which
 * fails when *every* step came back empty — that really does mean the import did
 * not work, and silently saving an empty document would be worse than an error.
 *
 * **The result is merged rather than written.** See `merge.ts`: an import may
 * add and may fill a blank, but never overwrites. A hand-corrected job title has
 * to survive a later screenshot of the same profile.
 *
 * Reading is a stage rather than something `plan()` does on the way past. That
 * matters more here than anywhere else in this runtime: transcribing a
 * screenshot is a vision call, so source reading is often the slowest and least
 * reliable part of the whole import, and doing it inside `plan()` would put it
 * outside the timing, the failure policy, the events and the elapsed time the
 * caller is shown.
 */

import { z } from 'zod';
import {
  RuntimeError,
  type Capability,
  type Plan,
  type SourceInput,
  type Step,
  type StepContext
} from '../../contracts/index.js';
import { DEFAULT_BUDGET } from '../../context/budget.js';
import { chunkPieces } from '../../retrieval/chunk.js';
import { embedChunks } from '../../retrieval/embed.js';
import { labelled } from '../../context/render.js';
import {
  CV_ID,
  CV_KIND,
  asCvDocument,
  cvDocumentSchema,
  emptyDocument,
  type CvDocument
} from './document.js';
import { mergeDocument, type MergeReport } from './merge.js';
import { cvPieces } from './pieces.js';
import { findSummary } from './summary.js';

/* ---------------------------------------------------------------- the model */

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

const personalFields = z.object({
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

const skillFields = z.object({
  role: z
    .string()
    .describe('Current job title, e.g. "Frontend Developer". Empty string if absent.'),
  programming_languages: z.array(z.string()).describe('Languages only, e.g. TypeScript, Python.'),
  frameworks: z.array(z.string()).describe('Frameworks only, e.g. React, Next.js, Django.'),
  libraries_and_tools: z
    .array(z.string())
    .describe('Everything else technical: libraries, tools, platforms, databases.')
});

const experienceFields = z.object({
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
        skills: z
          .array(z.string())
          .describe('Technologies named in this role. Empty array if none.')
      })
    )
    .describe('Every job in the source, most recent first. Empty array if none.')
});

const educationFields = z.object({
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

const certificateFields = z.object({
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

const languageFields = z.object({
  languages: z
    .array(
      z.object({
        name: z.string().describe('A human language, e.g. "English", "Polish", "German".'),
        level: z.string().describe('Stated level, e.g. "B2", "native". Empty string if absent.')
      })
    )
    .describe('Human languages the person speaks. Never programming languages. Empty array if none.')
});

/**
 * Names that are never a spoken language, however the CV labels them.
 *
 * A guard, not a substitute for the prompt. Measured against a real CV whose
 * skills section is literally headed `languages: Javascript, HTML, CSS, JSX,
 * Typescript, Rust`: gemma3:4b returned all six as spoken languages with empty
 * levels, because the word "languages" on that line outweighed every instruction
 * about which kind. Sharpening the prompt fixed that sample; this list is what
 * makes the failure impossible rather than unlikely, because the next CV will
 * label the section something else again.
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
const isSpokenLanguage = (name: string, technical: ReadonlySet<string>): boolean => {
  const key = name.trim().toLowerCase();
  return Boolean(key) && !NOT_SPOKEN.has(key) && !technical.has(key);
};

/**
 * Rejects a "certificate" that is just a skill the CV listed elsewhere.
 *
 * The same cross-check as `isSpokenLanguage`, against the same set, because it
 * is the same failure: a section reaching into a neighbouring one. Measured on a
 * real CV, the certificates step returned `ICP Blockchain SDK` — a line from
 * `libraries_and_tools` — beside the genuine certificate. It did that on two
 * runs in five at the provider's default temperature and on every run once
 * decoding went greedy, which is what made it worth a guard rather than a note.
 *
 * Matched on the whole name only. A real certificate is usually named after the
 * technology it covers, so anything looser would throw away "AWS Certified Cloud
 * Practitioner" for containing "AWS".
 */
const isCertificate = (name: string, technical: ReadonlySet<string>): boolean => {
  const key = name.trim().toLowerCase();
  return Boolean(key) && !technical.has(key);
};

/**
 * Kept short and declarative. With a small model the phrasing is load-bearing,
 * and emphatic instructions measurably did worse than plain ones.
 */
const RULES = `Use only what the sources contain. Do not infer or invent.
When the sources do not mention something, leave it empty.`;

/* ------------------------------------------------------------------- input */

/**
 * A source as it arrives from outside, which is not quite `SourceInput`.
 *
 * `SourceInput` carries a `Uint8Array`, and a run's input is stored as JSON in
 * `runs.input` — bytes have to arrive as base64 or the round-trip through the
 * run row loses them. The cost is real and stated rather than hidden: a 2MB
 * screenshot is a 2.7MB run row. The alternative, a `file` kind carrying a path,
 * would put filesystem access behind a capability input, and a path arriving
 * from an adapter is a path an attacker-shaped payload can also supply. The
 * adapter reads the file; the harness never opens one.
 */
const sourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    /** What to call it in the provenance record. */
    label: z.string().optional(),
    text: z.string().min(1)
  }),
  z.object({
    kind: z.literal('bytes'),
    label: z.string().optional(),
    mime: z.string().min(1),
    // Shape-checked here because `Buffer.from(s, 'base64')` silently drops
    // anything it does not recognise: garbage in produces an empty file and a
    // confusing "that source is empty" rather than "that was not base64".
    base64: z.string().min(1).regex(/^[A-Za-z0-9+/\s]*={0,2}$/, 'Not valid base64.')
  })
]);

export const sectionNames = [
  'personal',
  'role_description',
  'skills',
  'experience',
  'education',
  'certificates',
  'languages'
] as const;

export const inputSchema = z.object({
  sources: z.array(sourceSchema).min(1, 'At least one source is required.'),
  /**
   * Merges into the stored document. On by default: the capability exists to
   * populate the CV, and the merge cannot destroy anything, so the safe default
   * is the useful one.
   */
  persist: z.boolean().default(true),
  /**
   * Which artefacts to extract. All of them when omitted.
   *
   * The seven extractions are independent passes over the same corpus, and on
   * one local GPU they run in turn — so a whole import is the sum of seven model
   * calls, and the caller pays for all of it inside one request budget. A 12B
   * model on a full CV exceeded four minutes of it, which fails the entire
   * import for want of the last step.
   *
   * Naming a subset makes each request one model call. Nothing about the
   * pipeline changes — these steps never depended on each other, which is what
   * makes splitting them a scheduling decision rather than a redesign.
   */
  sections: z.array(z.enum(sectionNames)).min(1).optional(),
  /**
   * Technical skills already known, for the guards that cross-check against
   * them.
   *
   * `isSpokenLanguage` and `isCertificate` both reject a value the CV lists as a
   * skill elsewhere — which works only while the `skills` step ran beside them.
   * Splitting sections into separate requests broke that silently: asked for
   * `certificates` alone, the run has no skills to compare with, and `ICP
   * Blockchain SDK` came back as a certificate again, exactly as it did before
   * the guard existed. Both guards regressed the moment the request narrowed.
   *
   * So a caller running section by section passes back what it already has. The
   * guards then behave the same whether the seven steps ran together or apart,
   * which is the property that makes splitting them safe.
   */
  known_skills: z.array(z.string()).optional()
});

export type ExtractCvInput = z.infer<typeof inputSchema>;

export type SourceRecord = {
  readonly kind: string;
  readonly reference: string;
  readonly imported_at: string;
};

export type ExtractCvResult = {
  readonly document: CvDocument;
  readonly merge: MergeReport;
  readonly sources: readonly SourceRecord[];
  /**
   * The corpus the extractions read.
   *
   * Returned so a caller running section by section can read the sources once
   * and pass this back as a `text` source for the rest. Without it, splitting an
   * import into seven requests re-reads the sources seven times — merely
   * wasteful for a PDF, and genuinely expensive for a screenshot, because
   * reading an image *is* a model call.
   */
  readonly text: string;
  readonly skipped: readonly { reference: string; reason: string }[];
  readonly persisted: boolean;
  /** Set when the document was saved; `null` on a preview. See `revision`. */
  readonly revision: number | null;

  /**
   * Chunks written to the search index, or `null` when indexing did not run.
   *
   * Three-state on purpose, and the three states are different answers to
   * "is this CV searchable?": a number means yes and says how much of it, `0`
   * means the document has no prose worth searching (a certificate-only import
   * is exactly this), and `null` means nobody tried — a preview, or an
   * embedding call that failed and degraded the step. Collapsing `null` into
   * `0` would report a broken embedder as an empty CV.
   */
  readonly indexed: number | null;
};

/* --------------------------------------------------------------- assembling */

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? (value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[])
    : [];

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : [];

/** The sentinel becomes `null` (ongoing); an unanswered field stays `''`. */
const endDate = (value: unknown): string | null => {
  const text = asString(value);
  return text.toLowerCase() === PRESENT ? null : text;
};

/**
 * Builds the partial document from whatever the extraction steps produced.
 *
 * Every field is read defensively. These objects came from a model, and while
 * the executor validates them against the schema, a *degraded* step contributes
 * its fallback — so any key here can legitimately be missing.
 */
const assembleDocument = (
  completed: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  records: readonly SourceRecord[],
  /** Skills from earlier requests, when this run did not extract them itself. */
  knownSkills: readonly string[] = []
): Partial<CvDocument> => {
  const personal = completed.personal ?? {};
  const links = Object.fromEntries(
    asArray(personal.links)
      .map((link) => [asString(link.name), asString(link.url)])
      .filter(([name, url]) => name && url)
  );

  const skills = completed.skills ?? {};

  // Parsed from the sources rather than generated, so it is verbatim by
  // construction and needs no verification. See `summary.ts`.
  const summary = asString(completed.role_description?.role_description);

  // Everything the CV presents as a technical skill, for the two guards.
  const technical = new Set(
    [
      ...asStringArray(skills.programming_languages),
      ...asStringArray(skills.frameworks),
      ...asStringArray(skills.libraries_and_tools),
      ...knownSkills
    ]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
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
    sources: records.map((record) => ({ ...record }))
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

/* ---------------------------------------------------------------- the steps */

/** The corpus the `read` stage produced, labelled the way the steps expect. */
const renderCorpus = (context: StepContext): string =>
  labelled('CV SOURCES', String(context.completed.sources?.text ?? ''), DEFAULT_BUDGET.source);

const extraction = (
  name: (typeof sectionNames)[number],
  system: string,
  maxOutputTokens: number,
  schema: z.ZodTypeAny,
  fallback: Readonly<Record<string, unknown>>
): Step => ({
  kind: 'extract',
  name,
  schema,
  system: `${system}\n${RULES}`,
  prompt: renderCorpus,
  maxOutputTokens,
  critical: false,
  fallback
});

const extractionSteps: readonly Step[] = [
  extraction(
    'personal',
    "Extract the person's contact details from the CV.",
    700,
    personalFields,
    { name: '', email: '', phone: '', location: '', links: [] }
  ),
  {
    kind: 'transform',
    name: 'role_description',
    // Not a model call. See `summary.ts` for the measurements: every phrasing
    // tried returned the instruction rather than the paragraph at least four
    // times in five, because quoting contiguous text is the one job here that is
    // parsing rather than generation.
    critical: false,
    run: async (context) => ({
      role_description: findSummary(String(context.completed.sources?.text ?? ''))
    })
  },
  extraction(
    'skills',
    'Extract the technical skills from the CV, sorted into the three groups.',
    1_200,
    skillFields,
    { role: '', programming_languages: [], frameworks: [], libraries_and_tools: [] }
  ),
  extraction(
    'experience',
    'List every job in the CV with its dates and what the person did.',
    // By far the widest output here: an array of objects each containing its own
    // array. Offer analysis measured truncation at exactly 900 tokens on two
    // flat string arrays, and this is a great deal more — and truncation costs a
    // whole job, not a bullet.
    6_000,
    experienceFields,
    { experience: [] }
  ),
  extraction('education', 'List the education history from the CV.', 1_500, educationFields, {
    education: []
  }),
  extraction(
    'certificates',
    'List the certificates and accreditations from the CV.',
    1_200,
    certificateFields,
    { certificates: [] }
  ),
  extraction(
    'languages',
    // Split from `skills`, and then sharpened again after the split alone proved
    // insufficient. A real CV headed its skills line `languages: Javascript,
    // HTML, CSS` and the model took all of them — so the instruction now names
    // the trap rather than only the target. `NOT_SPOKEN` catches the rest.
    `List the human languages the person speaks, with the stated level of each.
A CV often has a skills line labelled "languages" that lists programming languages such as JavaScript, HTML or Rust. That line is not what this is asking for. Ignore it.
Return only languages people speak to each other, such as English, Polish or German.`,
    600,
    languageFields,
    { languages: [] }
  )
];

/* --------------------------------------------------------------- capability */

export const extractCv: Capability<ExtractCvInput> = {
  name: 'extract_cv',
  describe:
    'Read a CV from pasted text, PDFs or screenshots and merge it into the stored CV document.',
  input: inputSchema,

  plan: (input): Plan => {
    const wanted = input.sections;
    const steps = wanted
      ? // Declared order, not the caller's. `assemble` reads `completed` by step
        // name so order cannot change the document — but it decides what runs
        // first when several sections are asked for at once, and reading a CV
        // top-down is the order a person expects a partial result to arrive in.
        extractionSteps.filter((step) => wanted.includes(step.name as (typeof wanted)[number]))
      : extractionSteps;

    return {
      capability: 'extract_cv',
      source: 'declared',
      stages: [
        /**
         * Reading the sources, as a step.
         *
         * Critical and alone in its stage: there is nothing to extract from
         * without it, and a screenshot that cannot be transcribed should be
         * discovered before seven model calls are paid for, not after.
         */
        {
          name: 'read',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'sources',
              critical: true,
              run: async (context) => {
                const call = {
                  traceId: context.traceId,
                  runId: context.runId,
                  step: context.step.name,
                  signal: context.signal
                };

                const at = new Date().toISOString();
                const parts: string[] = [];
                const records: SourceRecord[] = [];
                const skipped: { reference: string; reason: string }[] = [];

                for (const source of input.sources) {
                  const reference =
                    source.label ?? (source.kind === 'text' ? 'pasted text' : source.mime);

                  try {
                    const payload: SourceInput =
                      source.kind === 'text'
                        ? { kind: 'text', text: source.text }
                        : {
                            kind: 'bytes',
                            bytes: new Uint8Array(Buffer.from(source.base64, 'base64')),
                            mime: source.mime
                          };

                    const read = await context.effects.sources.read(payload, call);
                    parts.push(read.text);
                    // `via` rather than the input kind: a screenshot read by a
                    // vision model is an `ocr` record, and knowing that a field
                    // came from a reading rather than a copy is the whole point
                    // of keeping provenance.
                    records.push({ kind: read.via, reference, imported_at: at });
                  } catch (error) {
                    // One unreadable source among several is not a failed
                    // import. The step fails only when nothing at all could be
                    // read, which is checked once, below.
                    skipped.push({ reference, reason: (error as Error).message });
                  }
                }

                const text = parts.join('\n\n').trim();

                if (!text) {
                  const detail = skipped
                    .map((entry) => `${entry.reference}: ${entry.reason}`)
                    .join('; ');
                  throw new RuntimeError(
                    `None of the sources could be read.${detail ? ` ${detail}` : ''}`,
                    'unreadable_source'
                  );
                }

                return { text, records, skipped };
              }
            }
          ]
        },

        {
          name: 'extract',
          // Resolves to 1 against a local provider, which is one GPU. Seven
          // concurrent calls there only contend, and a measured run starved one
          // into returning nothing at all — not slower, empty.
          concurrency: 'auto',
          steps
        },

        {
          name: 'merge',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'assemble',
              // The one step that must work: it is what turns seven independent
              // extractions into a document, and it is where an entirely failed
              // import is caught rather than saved as an empty CV.
              critical: true,
              run: async (context) => {
                const read = context.completed.sources ?? {};
                const text = String(read.text ?? '');
                const records = (read.records ?? []) as SourceRecord[];
                const skipped = (read.skipped ?? []) as { reference: string; reason: string }[];

                const extracted = assembleDocument(
                  context.completed,
                  records,
                  input.known_skills ?? []
                );

                /**
                 * Only a whole import can be judged empty.
                 *
                 * This guard exists to catch sources that were not a CV at all,
                 * and it reads a run's total emptiness as that failure. A run of
                 * one named section cannot support the inference: asking only
                 * for certificates, from a CV that has none, is a correct answer
                 * that looks identical.
                 */
                if (!input.sections && isEmpty(extracted)) {
                  throw new Error(
                    'Nothing could be extracted from the sources. They may not be a CV, or the model may have returned nothing usable.'
                  );
                }

                if (!input.persist) {
                  const preview = mergeDocument(emptyDocument(), extracted);
                  return {
                    document: preview.document,
                    merge: preview.report,
                    sources: records,
                    text,
                    skipped,
                    persisted: false,
                    revision: null,
                    indexed: null
                  } satisfies ExtractCvResult;
                }

                // The merge *is* the mutator. `update` runs it inside the write
                // transaction with the revision checked, so there is no window
                // between reading the document and writing it back.
                //
                // `report` is assigned from inside a mutator the store is
                // allowed to re-run. That is safe here and only here: the
                // assignment is idempotent and the last run is the one that
                // commits, so what escapes the closure always describes the
                // merge that actually landed.
                let report: MergeReport | undefined;

                const saved = context.documents.update(CV_ID, CV_KIND, (current) => {
                  const merged = mergeDocument(asCvDocument(current), extracted);
                  report = merged.report;
                  return merged.document;
                });

                if (!report) {
                  // Unreachable: `update` runs the mutator at least once before
                  // it writes. Named rather than filled in with an empty
                  // report, which would tell the caller that nothing merged on
                  // a run that did in fact write the document.
                  throw new Error('The document store wrote without running the merge.');
                }

                return {
                  document: asCvDocument(saved.body),
                  merge: report,
                  sources: records,
                  text,
                  skipped,
                  persisted: true,
                  revision: saved.revision,
                  indexed: null
                } satisfies ExtractCvResult;
              }
            }
          ]
        },

        /**
         * Making what was saved searchable.
         *
         * Its own stage because it reads the document `assemble` wrote, and not
         * critical because the CV is already saved by the time it runs: an
         * embedder that is down costs the user search over this import, not the
         * import. That asymmetry is the whole reason it is a separate step —
         * folded into `assemble` it would either take the write down with it or
         * have to swallow its own errors, and a swallowed error is one nobody
         * finds out about.
         *
         * It re-embeds every piece rather than reusing the vectors of chunks
         * whose ids did not change. The ids are content-addressed and stable,
         * so the reuse is available in principle, but `replace` takes vectors
         * for every chunk and there is no way to read the old ones back — so
         * the saving is not realised today, and a CV's prose is tens of pieces
         * rather than thousands. When it stops being cheap, the fix is a
         * `vectorsFor` on the reader, not a change here.
         */
        {
          name: 'index',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'index',
              critical: false,
              run: async (context) => {
                const merged = context.completed.assemble as ExtractCvResult | undefined;

                // A preview wrote nothing, so there is nothing to make
                // searchable. `chunks.document_id` references `documents(id)`
                // with foreign keys on, so the write would in fact be refused —
                // but refused as a degraded step on a run that did exactly what
                // was asked of it, which is a worse answer than not trying.
                if (!merged?.persisted) return { indexed: null };

                const pieces = cvPieces(merged.document);
                const chunks = chunkPieces(pieces);

                // Cleared rather than left alone: a CV whose prose is gone is
                // not a CV whose old prose is still findable.
                if (chunks.length === 0) {
                  context.index.clear(CV_ID);
                  return { indexed: 0 };
                }

                const embedded = await embedChunks(chunks, context.effects.ai, {
                  traceId: context.traceId,
                  runId: context.runId,
                  step: context.step.name,
                  signal: context.signal
                });

                if (!embedded) return { indexed: 0 };

                return {
                  indexed: context.index.replace(CV_ID, embedded.fingerprint, embedded.chunks)
                };
              }
            }
          ]
        }
      ]
    };
  },

  /**
   * `assemble` produced the result shape; `index` fills in the one field it
   * could not know. Merged by name rather than by merging every outcome,
   * because a degraded `index` contributes no value at all and the spread would
   * then be over `undefined` — which is the case that matters, since a degraded
   * index is the reason `indexed` is nullable.
   */
  aggregate: (outcomes) => {
    const assembled = outcomes.find((outcome) => outcome.step === 'assemble')?.value;
    if (!assembled) return {};

    const indexed = outcomes.find((outcome) => outcome.step === 'index')?.value;
    return { ...assembled, ...(indexed ?? {}) };
  }
};
