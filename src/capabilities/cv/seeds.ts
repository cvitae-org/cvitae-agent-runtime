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
 */

import type { DocumentStore, MaskSeed } from '../../contracts/index.js';
import { CV_ID, personalSchema } from './document.js';

export const cvSeeds = (documents: Pick<DocumentStore, 'read'>): readonly MaskSeed[] => {
  const body = documents.read(CV_ID)?.body;
  const parsed = personalSchema.safeParse(body?.personal);
  if (!parsed.success) return [];

  const { name, email, phone, links } = parsed.data;

  const seeds: readonly MaskSeed[] = [
    { kind: 'name', value: name },
    { kind: 'email', value: email },
    { kind: 'phone', value: phone },
    ...Object.values(links).map((value): MaskSeed => ({ kind: 'link', value }))
  ];

  return seeds.filter((seed) => seed.value.trim() !== '');
};
