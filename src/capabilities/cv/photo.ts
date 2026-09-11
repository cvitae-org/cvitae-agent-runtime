/**
 * The photograph on a CV, stored beside the document rather than inside it.
 *
 * Its own record, and the separation is the design rather than filing. Three
 * things follow from it, and all three are the reason:
 *
 * **No model ever sees it.** `edit_cv` shows a section of the CV to a model and
 * takes a section back. A photograph inside `cvDocumentSchema` would be a
 * megabyte of base64 in a prompt — priced per token, useless to read, and one
 * careless `document.photo = answer.photo` away from a model rewriting a
 * picture it cannot see.
 *
 * **`profile.get` stays small.** The CV is read on every edit and written back
 * whole. A portrait in that body would ride along on each one, in both
 * directions, to move a job title.
 *
 * **An import cannot lose it.** `extract_cv` merges into the CV document. A
 * photograph that is not in the document is not something a merge can drop, so
 * the rule needs no code — there is nothing to write, which is the only kind of
 * rule that cannot rot.
 *
 * The cost, stated plainly: two records that can disagree. Clearing the CV
 * leaves a photograph behind, because "delete everything I have written" and
 * "delete my picture" are different sentences and the store cannot tell which
 * one was meant. The client asks for both when it means both.
 */

import { z } from 'zod';

export const CV_PHOTO_ID = 'cv_photo';
export const CV_PHOTO_KIND = 'cv_photo';

/**
 * What a PDF can hold and a person is likely to have.
 *
 * Deliberately short. WebP is what a browser saves a downscaled portrait as and
 * the renderer on the other side cannot decode it, so accepting one here would
 * store a photograph that only fails at export — a long way from the file
 * picker that chose it.
 */
export const photoMimes = ['image/jpeg', 'image/png'] as const;

export type PhotoMime = (typeof photoMimes)[number];

/**
 * Two megabytes, decoded.
 *
 * A portrait prints into about 22×28mm. Anything past this is a phone camera's
 * original, which costs a megabyte on every read to draw a postage stamp — the
 * client downscales before it sends, and this is the backstop for when it does
 * not.
 */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** The first bytes each format must start with. */
const magic: Record<PhotoMime, readonly number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
};

export const cvPhotoSchema = z.object({
  mime: z.enum(photoMimes),
  base64: z.string().min(1),
  /**
   * The stored pixel dimensions, so a layout can reason about the aspect ratio
   * without decoding a megabyte to find out. Recorded by whoever prepared the
   * image; nothing here re-derives them, because decoding an image to check a
   * number somebody else already computed is the expensive half of the work.
   */
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export type CvPhoto = z.infer<typeof cvPhotoSchema>;

/**
 * The stored body: a photograph, or explicitly none.
 *
 * `null` rather than an absent record, because `DocumentStore` has no delete —
 * the same shape the CV itself uses, where clearing every section is a document
 * and not a deletion. A row that says "no photograph" and a row that was never
 * written mean the same thing to a reader and neither is an error.
 */
export const cvPhotoBodySchema = z.object({
  photo: cvPhotoSchema.nullable().default(null)
});

export type CvPhotoBody = z.infer<typeof cvPhotoBodySchema>;

export const emptyPhotoBody = (): CvPhotoBody => ({ photo: null });

/**
 * Decoded size, without decoding.
 *
 * The same arithmetic `validateUploadBudget` does on an attachment, and for the
 * same reason: a caller that allocates a buffer to find out how big the buffer
 * would be has already paid the cost the limit exists to prevent.
 */
const decodedBytes = (base64: string): number => {
  const compact = base64.replace(/\s/g, '');

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error('The photograph is not valid base64 data.');
  }

  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
};

/**
 * Checks a photograph on its way in, and answers with the one to store.
 *
 * The magic-byte check is not belt and braces. `mime` arrives from the same
 * payload as the bytes, so a caller that mislabels a file — or a page that
 * constructs one — would otherwise have its label believed all the way to a
 * renderer that trusts it. Reading the first eight bytes settles it here, where
 * the answer is a refusal instead of a decode failure at export.
 */
export const asStorablePhoto = (photo: CvPhoto): CvPhoto => {
  const bytes = decodedBytes(photo.base64);

  if (bytes === 0) throw new Error('The photograph is empty.');

  if (bytes > MAX_PHOTO_BYTES) {
    throw new Error(
      `The photograph is ${Math.round(bytes / 1024)} KB, over the `
        + `${MAX_PHOTO_BYTES / 1024 / 1024} MB limit.`
    );
  }

  const expected = magic[photo.mime];
  const head = Buffer.from(photo.base64.slice(0, 24), 'base64');

  if (!expected.every((byte, at) => head[at] === byte)) {
    throw new Error(`The photograph is not a ${photo.mime} image.`);
  }

  return photo;
};

/**
 * Reads a stored body back.
 *
 * Unlike `asCvDocument` this does not throw on a shape it cannot read. A CV
 * that will not parse is a CV somebody is trying to recover and must be told
 * about; a portrait that will not parse is a picture, and refusing to draw the
 * whole profile over one is the wrong trade. It reads as "no photograph", which
 * is a state the interface already renders.
 */
export const asCvPhotoBody = (
  body: Readonly<Record<string, unknown>> | undefined
): CvPhotoBody => {
  if (!body) return emptyPhotoBody();

  const parsed = cvPhotoBodySchema.safeParse(body);

  return parsed.success ? parsed.data : emptyPhotoBody();
};
