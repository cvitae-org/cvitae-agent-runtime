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

import { fingerprintValue } from '../../hash.js';

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

export const skillsSchema = z.object({
  role: z.string().default(''),
  programming_languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  libraries_and_tools: z.array(z.string()).default([])
});

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
 * The document id. One CV per harness, so it is a constant rather than a
 * parameter — a second one would need a way for a caller to say which, and no
 * capability has anything to say about a CV that is not the user's own.
 */
/**
 * The CV's contribution to a rating's inputs.
 *
 * Whole-document, including fields no criterion reads, because the question is
 * "is this the same CV" and not "would this change the score" — the second one
 * cannot be answered without running the scorer, which is what the fingerprint
 * exists to avoid. Nothing here needs excluding the way preferences exclude
 * `updated_at`: the store holds the timestamp, so the body is content only.
 */
export const fingerprintCv = (cv: CvDocument): string => fingerprintValue(cv);

export const CV_ID = 'cv';
export const CV_KIND = 'cv';

export const emptyDocument = (): CvDocument => cvDocumentSchema.parse({});

/**
 * Reads a stored body back as a CV.
 *
 * A body that does not parse throws rather than being replaced with an empty
 * document: it means something wrote a shape this schema does not know, and
 * quietly starting over would discard the CV the user is trying to recover.
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

  return parsed.data;
};
