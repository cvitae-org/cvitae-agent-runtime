/**
 * The canonical CV document: schema, and a store for exactly one of them.
 *
 * This is the part of the diagram drawn as a vector DB that is not one. Personal
 * details, education, certificates and languages are singleton structured
 * records — there is one `education` array per user, so "retrieve the relevant
 * education" has no meaning. Embedding them would return the JSON you already
 * had, minus the type checking. They are a document, and they live in a file.
 *
 * What *is* retrievable is the prose inside `experience[].highlights`: many
 * short statements, of which a given job offer makes a few relevant. Those get
 * chunked and embedded into LanceDB by the retrieval layer, derived from this
 * file rather than stored alongside it.
 *
 * A plain JSON file rather than a table, for reasons that outlast the schema:
 * it diffs, it can be opened and corrected by hand when an extraction run gets
 * a date wrong, and backing it up is copying one file. A columnar store would
 * rewrite fragments on every edit of a 5KB record for no gain.
 */

import { z } from 'zod';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { documentPath, ensureHome } from './paths.js';

/** ISO date, or a free-form string when the source was vague ("2019", "now"). */
const dateish = z.string();

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
  finished: dateish.nullable().default(null),
  /** The retrievable part: one statement per bullet, not a paragraph. */
  highlights: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([])
});

export const educationEntrySchema = z.object({
  university: z.string(),
  degree: z.string().default(''),
  started: dateish.default(''),
  finished: dateish.nullable().default(null),
  thesis: z.string().default(''),
  mark: z.string().default('')
});

export const certificateSchema = z.object({
  name: z.string(),
  issuer: z.string().default(''),
  started: dateish.default(''),
  finished: dateish.nullable().default(null)
});

export const languageSchema = z.object({
  name: z.string(),
  level: z.string().default('')
});

export const cvDocumentSchema = z.object({
  /** Bumped when a field changes meaning, so a stale file is recognisable. */
  version: z.literal(1).default(1),
  updated_at: z.string().default(() => new Date().toISOString()),
  // `.default()` in zod 4 takes the *output* type, and these objects are only
  // empty on the way in — every field inside them has its own default. Parsing
  // `{}` through the schema produces that filled shape, which is what a missing
  // section should become.
  personal: personalSchema.default(() => personalSchema.parse({})),
  /** The prose summary, from the diagram's role-description artefact. */
  role_description: z.string().default(''),
  skills: skillsSchema.default(() => skillsSchema.parse({})),
  experience: z.array(experienceEntrySchema).default([]),
  education: z.array(educationEntrySchema).default([]),
  certificates: z.array(certificateSchema).default([]),
  languages: z.array(languageSchema).default([]),
  /**
   * Where each part came from — a LinkedIn export, a PDF, a pasted page.
   * Kept because an extracted CV is a claim, and the useful question when a
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

export const emptyDocument = (): CvDocument => cvDocumentSchema.parse({});

export class CvDocumentStore {
  constructor(private readonly path: string = documentPath()) {}

  /**
   * Reads the document, or an empty one on first run.
   *
   * A file that exists but does not parse is a different situation and throws:
   * it means a hand edit broke the shape, and silently replacing it with an
   * empty document would delete the CV the user was trying to fix.
   */
  async read(): Promise<CvDocument> {
    let raw: string;

    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyDocument();
      }
      throw error;
    }

    const parsed = cvDocumentSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      throw new Error(
        `${this.path} does not match the CV document schema: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`
      );
    }

    return parsed.data;
  }

  /**
   * Writes via a temporary file and a rename.
   *
   * `rename` is atomic within a filesystem, so a crash or a concurrent read
   * during the write sees either the old document or the new one. Writing in
   * place would leave a truncated file, and the truncated file is the user's
   * whole CV.
   */
  async write(document: CvDocument): Promise<CvDocument> {
    await ensureHome();

    const next = cvDocumentSchema.parse({
      ...document,
      updated_at: new Date().toISOString()
    });

    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temporary, this.path);

    return next;
  }
}
