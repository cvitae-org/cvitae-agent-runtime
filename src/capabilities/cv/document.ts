/**
 * The canonical CV: one document, one schema, one home.
 *
 * This is the part of the picture that is drawn as a vector store and is not
 * one. Personal details, education, certificates and languages are singleton
 * structured records — there is one `education` array per person, so "retrieve
 * the relevant education" has no meaning, and embedding it would return the
 * JSON you already had with the type checking removed. What *is* retrievable is
 * the prose inside `experience[].highlights`: many short statements, of which a
 * given offer makes a few relevant. Those are chunked and embedded, derived
 * from this shape rather than stored beside it.
 *
 * It lives in `capabilities/` because a CV's shape is domain knowledge. The
 * document *port* in `contracts/` deliberately types a body as an opaque record
 * — a `CvDocument` declared there would make every module that merely passes a
 * document around depend on the details of one capability's schema.
 *
 * Two fields the previous version carried are gone, because the store now
 * carries them: `updated_at` duplicates `DocumentRecord.updatedAt`, and there
 * is no longer a whole-file rewrite for it to timestamp. `version` stays. It is
 * not a revision counter — `DocumentRecord.revision` is that — it is which
 * *schema* the body was written against, and a body that cannot say is a body
 * nothing can safely migrate.
 */

import { z } from 'zod';

/** ISO where the source was precise, free-form where it was vague ("2019"). */
const dateish = z.string();

/**
 * An end date, with three states rather than two.
 *
 * `''` is *not stated*, `null` is *still ongoing*, a string is the date. The
 * previous version folded the first two together — both `''` and `"present"`
 * became `null` — and the collapse cost the merge policy a rule it could not
 * express: filling a blank end date and closing an open-ended role look
 * identical when both read `null`, so the code that tried to allow the first and
 * forbid the second could never fire. Three states makes that distinction real.
 */
const endish = dateish.nullable().default('');

export const personalSchema = z.object({
  name: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  location: z.string().default(''),
  links: z.record(z.string(), z.string()).default({})
});

/**
 * One row of the skills strip: a heading, and the list beside it.
 *
 * The heading is content. The three fixed arrays below decided on the author's
 * behalf what their skills are *about* — a CV with a "Blockchain" row and a
 * "Mobile" row had nowhere to put either, so both were folded into
 * `libraries_and_tools`, which grew to ninety items and printed as a paragraph.
 * A label the document carries buys rows the person whose CV it is can name,
 * add, remove and reorder.
 */
export const skillGroupSchema = z.object({
  label: z.string().default(''),
  items: z.array(z.string()).default([])
});

/**
 * The skills strip, in both shapes at once.
 *
 * `groups` is the document's own answer and the one that is edited. The three
 * arrays beside it are **derived** — every group is folded into one of them by
 * [[normaliseSkills]] on the way in and on the way out, so a reader that wants
 * "every skill this CV claims" can still concatenate the three and get all of
 * them.
 *
 * They are kept rather than dropped because the extractor answers in those
 * three buckets (`cv/extract.ts`) and every stored body carries them. Every
 * reader here concatenates the three. The one that did not — a board search
 * on languages and frameworks *and not tools*, because `sentry` and `riverpod`
 * are not how job postings are indexed — was never reached and was removed.
 *
 * The cost is stated rather than hidden: a row the author invents folds into
 * `libraries_and_tools`, whatever it names. Only the fold is lossy; `groups` is
 * not derived from it and never re-read through it.
 */
export const skillsSchema = z.object({
  role: z.string().default(''),
  groups: z.array(skillGroupSchema).default([]),
  programming_languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  libraries_and_tools: z.array(z.string()).default([])
});

export type SkillGroup = z.infer<typeof skillGroupSchema>;
export type Skills = z.infer<typeof skillsSchema>;

const legacySkillFields = [
  'programming_languages',
  'frameworks',
  'libraries_and_tools'
] as const;

type LegacySkillField = (typeof legacySkillFields)[number];

/**
 * What those three are called when they arrive without a name.
 *
 * English only, and deliberately not per-locale. A label is content now, and
 * content is not chosen by the language a client happens to be running in — a
 * Polish CV read through an English interface would otherwise acquire English
 * headings and store them.
 */
const legacySkillLabels: Readonly<Record<LegacySkillField, string>> = {
  programming_languages: 'Languages',
  frameworks: 'Frameworks',
  libraries_and_tools: 'Libraries & Tools'
};

/** Case- and whitespace-insensitive identity for a heading, as `merge.ts` does for an entry. */
export const skillGroupKey = (label: string): string =>
  label.trim().toLowerCase().replace(/\s+/g, ' ');

/** Which of the three a row folds into. Everything unrecognised is a tool. */
const legacyFieldFor = (label: string): LegacySkillField =>
  legacySkillFields.find((field) => skillGroupKey(legacySkillLabels[field]) === skillGroupKey(label)) ??
  'libraries_and_tools';

/**
 * The rows a body written before groups existed implies.
 *
 * An empty legacy array yields no row: there it means "this CV has no
 * frameworks" rather than "a row is waiting", and reviving all three as empty
 * rows would greet every migrated document with headings it never had.
 */
export const skillGroupsFromLegacy = (skills: Skills): SkillGroup[] =>
  legacySkillFields
    .filter((field) => skills[field].length > 0)
    .map((field) => ({ label: legacySkillLabels[field], items: [...skills[field]] }));

/**
 * The strip with `groups` authoritative and the three arrays rebuilt from it.
 *
 * Called on every read and every write, which is what makes the two shapes
 * incapable of disagreeing. A body with no groups is one written before they
 * existed — or one an extraction just produced, since `extract.ts` still asks
 * the model for the three sorted lists — so its rows are inferred once, here,
 * and are the document's own from then on.
 */
export const normaliseSkills = (skills: Skills): Skills => {
  const groups = skills.groups.length > 0 ? skills.groups : skillGroupsFromLegacy(skills);
  const legacy: Record<LegacySkillField, string[]> = {
    programming_languages: [],
    frameworks: [],
    libraries_and_tools: []
  };

  for (const group of groups) {
    legacy[legacyFieldFor(group.label)].push(...group.items);
  }

  return {
    role: skills.role,
    groups: groups.map((group) => ({ label: group.label, items: [...group.items] })),
    ...legacy
  };
};

export const experienceEntrySchema = z.object({
  company: z.string(),
  title: z.string(),
  started: dateish.default(''),
  finished: endish,
  /** The retrievable part: one statement per bullet, never a paragraph. */
  highlights: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([])
});

export const educationEntrySchema = z.object({
  university: z.string(),
  degree: z.string().default(''),
  started: dateish.default(''),
  finished: endish,
  thesis: z.string().default(''),
  mark: z.string().default('')
});

export const certificateSchema = z.object({
  name: z.string(),
  issuer: z.string().default(''),
  started: dateish.default(''),
  finished: endish
});

export const languageSchema = z.object({
  name: z.string(),
  level: z.string().default('')
});

export const cvDocumentSchema = z.object({
  /** Which schema this body was written against. See the note at the top. */
  version: z.literal(1).default(1),
  // `.default()` in zod 4 takes the *output* type, and these objects are only
  // ever empty on the way in — every field inside them has its own default.
  // Parsing `{}` produces the filled shape, which is what a missing section
  // should become rather than an absent key.
  personal: personalSchema.default(() => personalSchema.parse({})),
  role_description: z.string().default(''),
  skills: skillsSchema.default(() => skillsSchema.parse({})),
  experience: z.array(experienceEntrySchema).default([]),
  education: z.array(educationEntrySchema).default([]),
  certificates: z.array(certificateSchema).default([]),
  languages: z.array(languageSchema).default([]),
  /**
   * Where each part came from — an export, a PDF, a screenshot.
   *
   * Kept because an extracted CV is a *claim*, and the useful question when a
   * field looks wrong is which source produced it.
   */
  sources: z
    .array(
      z.object({
        kind: z.string(),
        reference: z.string(),
        imported_at: z.string()
      })
    )
    .default([])
});

export type CvDocument = z.infer<typeof cvDocumentSchema>;
export type ExperienceEntry = z.infer<typeof experienceEntrySchema>;

/**
 * A document whose skills strip states itself the same way twice.
 *
 * No `version` bump goes with this. The version says which schema a body was
 * written against, and a body written against version 1 still parses — `groups`
 * is a new optional field with a default, and its absence is exactly what the
 * backfill is for. Bumping would have made every stored CV unreadable to buy
 * nothing.
 */
export const normaliseCv = (document: CvDocument): CvDocument => ({
  ...document,
  skills: normaliseSkills(document.skills)
});

/**
 * The document id. One CV per harness, so it is a constant rather than a
 * parameter — a second one would need a way for a caller to say which, and no
 * capability has anything to say about a CV that is not the user's own.
 */
export const CV_ID = 'cv';
export const CV_KIND = 'cv';

export const emptyDocument = (): CvDocument => cvDocumentSchema.parse({});

/**
 * Reads a stored body back as a CV.
 *
 * A body that does not parse throws rather than being replaced with an empty
 * document: it means something wrote a shape this schema does not know, and
 * quietly starting over would discard the CV the user is trying to recover.
 *
 * Normalised on the way out, so a document stored before the skills strip had
 * named rows comes back with them. This is the single read choke point — every
 * capability that reaches the stored CV comes through here — which is why the
 * backfill lives at this line rather than in each of them.
 */
export const asCvDocument = (body: Readonly<Record<string, unknown>> | undefined): CvDocument => {
  if (!body) return emptyDocument();

  const parsed = cvDocumentSchema.safeParse(body);

  if (!parsed.success) {
    throw new Error(
      `The stored CV does not match the document schema: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }

  return normaliseCv(parsed.data);
};
