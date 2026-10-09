/**
 * What a model is not to be told about the person a CV belongs to.
 *
 * The values a CV states in its `personal` section — the name, the email, the
 * phone and the links — as seeds for the mask (`effects/mask.ts`). Taken from the
 * stored document and not from what a step happens to be sending, so a value is
 * kept from the model wherever it turns up: in a question, in a posting the
 * person pasted, in the history of the chat.
 *
 * Lenient on purpose. A document that does not parse has no readable `personal`
 * section, and a run that cannot be masked because its CV is malformed would be
 * a run that is refused for a reason that has nothing to do with it; what is
 * read is what is there.
 *
 * What is not a seed: the location. A city is shared by too many people to be
 * an identifier, and masking it would hide from a model what a posting's location
 * is compared with.
 *
 * In the strict scope the employers and the schools the CV names are seeds too
 * (`MaskScope`): the company of each experience entry and the university of each
 * education entry. Each entry is read on its own, so one that is malformed costs
 * only itself. The issuer of a certificate is not one.
 */

import { z } from 'zod';

import type { DocumentStore, MaskScope, MaskSeed } from '../../contracts/index.js';
import { CV_ID, personalSchema } from './document.js';

const personalSeeds = (personal: unknown): readonly MaskSeed[] => {
  const parsed = personalSchema.safeParse(personal);
  if (!parsed.success) return [];

  const { name, email, phone, links } = parsed.data;

  return [
    { kind: 'name', value: name },
    { kind: 'email', value: email },
    { kind: 'phone', value: phone },
    ...Object.values(links).map((value): MaskSeed => ({ kind: 'link', value }))
  ];
};

/** The value of one field of each entry of a section, for the entries that have one. */
const fieldOf = (section: unknown, field: string): readonly string[] => {
  const entry = z.object({ [field]: z.string() });

  return (Array.isArray(section) ? (section as readonly unknown[]) : []).flatMap((item) => {
    const parsed = entry.safeParse(item);
    return parsed.success ? [parsed.data[field]!] : [];
  });
};

export const cvSeeds = (
  documents: Pick<DocumentStore, 'read'>,
  scope: MaskScope = 'personal'
): readonly MaskSeed[] => {
  const body = documents.read(CV_ID)?.body;

  const seeds: readonly MaskSeed[] = [
    ...personalSeeds(body?.personal),
    ...(scope === 'strict'
      ? [...fieldOf(body?.experience, 'company'), ...fieldOf(body?.education, 'university')].map(
          (value): MaskSeed => ({ kind: 'org', value })
        )
      : [])
  ];

  return seeds.filter((seed) => seed.value.trim() !== '');
};
