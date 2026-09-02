/**
 * Translates one language's CV into another without changing its structure.
 *
 * The browser owns one document per locale. This capability does not persist
 * either of them: it translates the selected artefacts and hands a document
 * back to the browser, where the source-aware gap merge decides what is safe to
 * add to the language currently being edited.
 *
 * Translation is split by section for the same reason extraction is. A whole
 * CV is too much output for a small local model in one request, while seven
 * narrow calls have bounded output and let the UI name the section that failed.
 */

import { z } from 'zod';
import type { Capability, Plan, Step, TransformStep } from '../core/types.js';

const PRESENT = 'present';

export const translationSectionSchema = z.enum([
  'personal',
  'role_description',
  'skills',
  'experience',
  'education',
  'certificates',
  'languages'
]);

export type TranslationSection = z.infer<typeof translationSectionSchema>;

const personalSchema = z.object({
  name: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  location: z.string().default(''),
  links: z.record(z.string(), z.string()).default({})
});

const skillGroupSchema = z.object({
  label: z.string().default(''),
  items: z.array(z.string()).default([])
});

const browserSkillsSchema = z.object({
  role: z.string().default(''),
  groups: z.array(skillGroupSchema).default([])
});

const experienceSchema = z.object({
  company: z.string().default(''),
  title: z.string().default(''),
  started: z.string().default(''),
  finished: z.string().nullable().default(null),
  highlights: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([])
});

const educationSchema = z.object({
  university: z.string().default(''),
  degree: z.string().default(''),
  started: z.string().default(''),
  finished: z.string().nullable().default(null),
  thesis: z.string().default(''),
  mark: z.string().default('')
});

const certificateSchema = z.object({
  name: z.string().default(''),
  issuer: z.string().default(''),
  started: z.string().default(''),
  finished: z.string().nullable().default(null)
});

const languageSchema = z.object({
  name: z.string().default(''),
  level: z.string().default('')
});

/**
 * The browser document differs from the runtime's stored document only in its
 * skill groups. It is stated here because this capability is a boundary: the
 * browser sends named, user-editable groups and must receive those same groups
 * back rather than having them folded into the runtime's three fixed lists.
 */
export const translatableCvSchema = z.object({
  version: z.literal(1).default(1),
  updated_at: z.string().default(() => new Date(0).toISOString()),
  personal: personalSchema.default(() => personalSchema.parse({})),
  role_description: z.string().default(''),
  skills: browserSkillsSchema.default(() => browserSkillsSchema.parse({})),
  experience: z.array(experienceSchema).default([]),
  education: z.array(educationSchema).default([]),
  certificates: z.array(certificateSchema).default([]),
  languages: z.array(languageSchema).default([]),
  sources: z
    .array(
      z.object({
        kind: z.string().default(''),
        reference: z.string().default(''),
        imported_at: z.string().default('')
      })
    )
    .default([])
});

export type TranslatableCv = z.infer<typeof translatableCvSchema>;

const localeSchema = z.enum(['en', 'pl']);

export const translateCvInputSchema = z
  .object({
    document: translatableCvSchema,
    source_language: localeSchema,
    target_language: localeSchema,
    sections: z.array(translationSectionSchema).min(1).optional()
  })
  .refine((input) => input.source_language !== input.target_language, {
    message: 'Source and target languages must be different.',
    path: ['target_language']
  });

export type TranslateCvInput = z.infer<typeof translateCvInputSchema>;

export type TranslateCvResult = {
  document: TranslatableCv;
  translated: TranslationSection[];
  source_language: z.infer<typeof localeSchema>;
  target_language: z.infer<typeof localeSchema>;
};

const languageName = (locale: z.infer<typeof localeSchema>): string =>
  locale === 'pl' ? 'Polish' : 'English';

const rules = (input: TranslateCvInput): string => `Translate CV content from ${languageName(input.source_language)} to ${languageName(input.target_language)}.
Translate faithfully. Preserve every fact, meaning, number, list item and list order.
Do not improve, summarise, expand, omit or invent anything.
Keep personal names, email addresses, phone numbers, URLs, company and product names, technology names and acronyms unchanged unless the source is a descriptive phrase rather than a proper name.
Write every number with the same digits as the source. Never spell a digit out as a word and never turn a spelled-out number into digits — "5 osób" is "5 people", not "five people".
Use natural professional ${languageName(input.target_language)}.`;

const promptFor = (label: string, value: unknown): string =>
  `${label}:\n${JSON.stringify(value, null, 2)}`;

const translatedEndDate = z
  .string()
  .describe(`Translated end date, exactly "${PRESENT}" when the source value is null, or empty when absent.`);

const personalTranslationSchema = z.object({
  location: z.string().describe('The translated location, or empty string when the source is empty.')
});

const roleTranslationSchema = z.object({
  role_description: z.string().describe('The complete translated professional summary.')
});

const skillsTranslationSchema = (groupCount: number) =>
  z.object({
    role: z.string().describe('The translated professional role.'),
    group_labels: z
      .array(z.string())
      .length(groupCount)
      .describe('Translated group labels in exactly the source order.')
  });

const translatedExperienceEntrySchema = z.object({
  company: z.string(),
  title: z.string(),
  started: z.string(),
  finished: translatedEndDate,
  highlights: z.array(z.string())
});

const experienceTranslationSchema = (source: TranslatableCv['experience']) =>
  z
    .object({
      experience: z
        .array(translatedExperienceEntrySchema)
        .length(source.length)
        .describe('Every source job, in exactly the source order.')
    })
    .superRefine((value, context) => {
      value.experience.forEach((entry, index) => {
        const expected = source[index]?.highlights.length ?? 0;
        if (entry.highlights.length !== expected) {
          context.addIssue({
            code: 'custom',
            path: ['experience', index, 'highlights'],
            message: `Expected ${expected} translated highlights.`
          });
        }
      });
    });

const translatedEducationEntrySchema = z.object({
  university: z.string(),
  degree: z.string(),
  started: z.string(),
  finished: translatedEndDate,
  thesis: z.string(),
  mark: z.string()
});

const educationTranslationSchema = (count: number) =>
  z.object({
    education: z
      .array(translatedEducationEntrySchema)
      .length(count)
      .describe('Every source education entry, in exactly the source order.')
  });

const translatedCertificateSchema = z.object({
  name: z.string(),
  issuer: z.string(),
  started: z.string(),
  finished: translatedEndDate
});

const certificatesTranslationSchema = (count: number) =>
  z.object({
    certificates: z
      .array(translatedCertificateSchema)
      .length(count)
      .describe('Every source certificate, in exactly the source order.')
  });

const translatedLanguageSchema = z.object({
  name: z.string(),
  level: z.string()
});

const languagesTranslationSchema = (count: number) =>
  z.object({
    languages: z
      .array(translatedLanguageSchema)
      .length(count)
      .describe('Every source spoken language, in exactly the source order.')
  });

const numericTokens = (value: string): string[] => value.match(/\p{N}+/gu) ?? [];

/**
 * Which numbers a translation lost and which it invented.
 *
 * Compared as a multiset rather than a sequence, and that is the whole of the
 * change from the first version of this guard. Sequence comparison rejected
 * every bullet whose clauses moved, which between these two languages is most
 * of them: Polish fronts the time adverbial and English trails it, so
 * "W 2020 roku zwiększyłem sprzedaż o 30%" becomes "Increased sales by 30% in
 * 2020" and `2020|30` fails to equal `30|2020`. Measured over seven realistic
 * pairs, three were refused and two of those were nothing but reordering — a
 * correct translation, every figure intact, blocked for putting them in the
 * order English wants.
 *
 * What is given up is the inversion: "from Python 2 to Python 3" translated as
 * "from Python 3 to Python 2" holds the same two numbers and passes here. That
 * is a real risk and a much rarer one than clause reordering, it is the kind of
 * error a reader catches, and the translation is reviewed in a preview before
 * it is applied. Refusing every reordered bullet to catch it was the worse
 * trade — it refused work that was correct.
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
const translatedText = (source: string, output: unknown, path: string): string => {
  if (!source.trim()) return '';

  const translated = typeof output === 'string' ? output.trim() : '';
  if (!translated) throw new Error(`Translation dropped ${path}.`);

  const drift = numberDrift(source, translated);

  if (drift) {
    throw new Error(`Translation changed a number in ${path}: ${drift}.`);
  }

  return translated;
};

const endDate = (
  source: string | null,
  output: unknown,
  path: string
): string | null => {
  // `null` is meaningful: the role/course is ongoing. The model has no
  // standing to reinterpret it, so it is copied rather than generated.
  if (source === null) return null;
  return translatedText(source, output, path);
};

const emptyDocument = (): TranslatableCv => translatableCvSchema.parse({});

const extractStep = ({
  name,
  schema,
  system,
  prompt,
  maxOutputTokens
}: {
  name: TranslationSection;
  schema: z.ZodTypeAny;
  system: string;
  prompt: string;
  maxOutputTokens: number;
}): Step => ({
  kind: 'extract',
  name,
  schema,
  system,
  prompt,
  maxOutputTokens,
  // Unlike extraction, an empty answer is not a legitimate partial source.
  // The source is known to contain the section and the UI is waiting for this
  // exact translation, so failure must be reported rather than degraded away.
  critical: true
});

const translationSteps = (input: TranslateCvInput): Step[] => {
  const source = input.document;
  const shared = rules(input);

  return [
    extractStep({
      name: 'personal',
      schema: personalTranslationSchema,
      system: `${shared}\nTranslate only the location. Contact details and links are copied by the runtime and are not in the prompt.`,
      prompt: promptFor('SOURCE LOCATION', source.personal.location),
      maxOutputTokens: 200
    }),
    extractStep({
      name: 'role_description',
      schema: roleTranslationSchema,
      system: `${shared}\nReturn the complete summary as one string.`,
      prompt: promptFor('SOURCE SUMMARY', source.role_description),
      maxOutputTokens: 1_200
    }),
    extractStep({
      name: 'skills',
      schema: skillsTranslationSchema(source.skills.groups.length),
      system: `${shared}\nTranslate only the role and skill-group labels. Technology items are copied verbatim by the runtime.`,
      prompt: promptFor('SOURCE ROLE AND GROUP LABELS', {
        role: source.skills.role,
        group_labels: source.skills.groups.map((group) => group.label)
      }),
      maxOutputTokens: 700
    }),
    extractStep({
      name: 'experience',
      schema: experienceTranslationSchema(source.experience),
      system: `${shared}\nReturn every job and every highlight in exactly the source order. Translate month names in dates. Use "${PRESENT}" for a null end date. Technical skill arrays are copied separately and are not in the prompt.`,
      prompt: promptFor(
        'SOURCE EXPERIENCE',
        source.experience.map((entry) => ({
          company: entry.company,
          title: entry.title,
          started: entry.started,
          finished: entry.finished,
          highlights: entry.highlights
        }))
      ),
      maxOutputTokens: 8_000
    }),
    extractStep({
      name: 'education',
      schema: educationTranslationSchema(source.education.length),
      system: `${shared}\nReturn every education entry in exactly the source order. Translate month names in dates. Use "${PRESENT}" for a null end date.`,
      prompt: promptFor('SOURCE EDUCATION', source.education),
      maxOutputTokens: 2_000
    }),
    extractStep({
      name: 'certificates',
      schema: certificatesTranslationSchema(source.certificates.length),
      system: `${shared}\nReturn every certificate in exactly the source order. Translate month names in dates. Use "${PRESENT}" for a null end date.`,
      prompt: promptFor('SOURCE CERTIFICATES', source.certificates),
      maxOutputTokens: 1_800
    }),
    extractStep({
      name: 'languages',
      schema: languagesTranslationSchema(source.languages.length),
      system: `${shared}\nThese are human languages the person speaks. Return every entry in exactly the source order.`,
      prompt: promptFor('SOURCE SPOKEN LANGUAGES', source.languages),
      maxOutputTokens: 700
    })
  ];
};

const assembleDocument = (
  input: TranslateCvInput,
  completed: Record<string, Record<string, unknown>>
): TranslatableCv => {
  const source = input.document;
  const document = emptyDocument();

  if (completed.personal) {
    document.personal = {
      ...source.personal,
      links: { ...source.personal.links },
      location: translatedText(
        source.personal.location,
        completed.personal.location,
        'personal.location'
      )
    };
  }

  if (completed.role_description) {
    document.role_description = translatedText(
      source.role_description,
      completed.role_description.role_description,
      'role_description'
    );
  }

  if (completed.skills) {
    const labels = completed.skills.group_labels;
    if (!Array.isArray(labels) || labels.length !== source.skills.groups.length) {
      throw new Error('Translation changed the number of skill groups.');
    }

    document.skills = {
      role: translatedText(source.skills.role, completed.skills.role, 'skills.role'),
      groups: source.skills.groups.map((group, index) => ({
        label: translatedText(group.label, labels[index], `skills.groups.${index}.label`),
        items: [...group.items]
      }))
    };
  }

  if (completed.experience) {
    const translated = completed.experience.experience;
    if (!Array.isArray(translated) || translated.length !== source.experience.length) {
      throw new Error('Translation changed the number of experience entries.');
    }

    document.experience = source.experience.map((entry, index) => {
      const output = translated[index] as Record<string, unknown> | undefined;
      const highlights = output?.highlights;
      if (!Array.isArray(highlights) || highlights.length !== entry.highlights.length) {
        throw new Error(`Translation changed the number of highlights in experience.${index}.`);
      }

      return {
        company: translatedText(entry.company, output?.company, `experience.${index}.company`),
        title: translatedText(entry.title, output?.title, `experience.${index}.title`),
        started: translatedText(entry.started, output?.started, `experience.${index}.started`),
        finished: endDate(entry.finished, output?.finished, `experience.${index}.finished`),
        highlights: entry.highlights.map((highlight, highlightIndex) =>
          translatedText(
            highlight,
            highlights[highlightIndex],
            `experience.${index}.highlights.${highlightIndex}`
          )
        ),
        skills: [...entry.skills]
      };
    });
  }

  if (completed.education) {
    const translated = completed.education.education;
    if (!Array.isArray(translated) || translated.length !== source.education.length) {
      throw new Error('Translation changed the number of education entries.');
    }

    document.education = source.education.map((entry, index) => {
      const output = translated[index] as Record<string, unknown> | undefined;
      return {
        university: translatedText(entry.university, output?.university, `education.${index}.university`),
        degree: translatedText(entry.degree, output?.degree, `education.${index}.degree`),
        started: translatedText(entry.started, output?.started, `education.${index}.started`),
        finished: endDate(entry.finished, output?.finished, `education.${index}.finished`),
        thesis: translatedText(entry.thesis, output?.thesis, `education.${index}.thesis`),
        mark: translatedText(entry.mark, output?.mark, `education.${index}.mark`)
      };
    });
  }

  if (completed.certificates) {
    const translated = completed.certificates.certificates;
    if (!Array.isArray(translated) || translated.length !== source.certificates.length) {
      throw new Error('Translation changed the number of certificates.');
    }

    document.certificates = source.certificates.map((entry, index) => {
      const output = translated[index] as Record<string, unknown> | undefined;
      return {
        name: translatedText(entry.name, output?.name, `certificates.${index}.name`),
        issuer: translatedText(entry.issuer, output?.issuer, `certificates.${index}.issuer`),
        started: translatedText(entry.started, output?.started, `certificates.${index}.started`),
        finished: endDate(entry.finished, output?.finished, `certificates.${index}.finished`)
      };
    });
  }

  if (completed.languages) {
    const translated = completed.languages.languages;
    if (!Array.isArray(translated) || translated.length !== source.languages.length) {
      throw new Error('Translation changed the number of spoken languages.');
    }

    document.languages = source.languages.map((entry, index) => {
      const output = translated[index] as Record<string, unknown> | undefined;
      return {
        name: translatedText(entry.name, output?.name, `languages.${index}.name`),
        level: translatedText(entry.level, output?.level, `languages.${index}.level`)
      };
    });
  }

  return document;
};

export const translateCv: Capability<TranslateCvInput> = {
  name: 'translate_cv',
  describe:
    'Translate selected sections of one stored CV language into another while preserving facts and structure.',
  input: translateCvInputSchema,

  plan: (input): Plan => {
    const selected = input.sections ?? translationSectionSchema.options;
    const wanted = new Set(selected);
    const steps = translationSteps(input).filter((step) =>
      wanted.has(step.name as TranslationSection)
    );

    const assemble: TransformStep = {
      kind: 'transform',
      name: 'assemble',
      critical: true,
      run: async (context) => ({
        document: assembleDocument(input, context.completed),
        translated: selected,
        source_language: input.source_language,
        target_language: input.target_language
      } satisfies TranslateCvResult as unknown as Record<string, unknown>)
    };

    return {
      capability: 'translate_cv',
      source: 'declared',
      concurrency: 'auto',
      steps: [...steps, assemble]
    };
  },

  aggregate: (outcomes) =>
    outcomes.find((outcome) => outcome.step === 'assemble')?.value ?? {}
};
