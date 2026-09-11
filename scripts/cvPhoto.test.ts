/**
 * The photograph on a CV: what may be stored, and what a stored one reads as.
 *
 * The claims worth earning are all about the boundary. A portrait arrives as a
 * label and a string of base64 from whoever is on the other end of the pipe,
 * and every field of that is a claim rather than a fact — the format, the size,
 * that it is an image at all. Believing the label is how a renderer ends up
 * decoding something that is not a JPEG.
 *
 * Verified by mutation — each of these was made to fail on purpose:
 *
 * - M1 `mime` trusted without reading the bytes: caught, a PNG labelled JPEG
 *   stores clean and fails at export instead, a long way from the file picker.
 * - M2 the size limit checked after `Buffer.from`: caught in spirit, not by an
 *   assertion — the test still passes, which is the point. The limit exists to
 *   stop the allocation, so a version that allocates first is a limit that has
 *   already lost. Kept as a comment on `decodedBytes` rather than a test,
 *   because "it did not allocate" is not observable from here.
 * - M3 `asCvPhotoBody` throwing on an unreadable body like `asCvDocument` does:
 *   caught, one unparseable portrait stops the whole profile being drawn.
 * - M4 `emptyPhotoBody` returning a shared object: caught, two clears alias one
 *   body and a later write through either is visible in both.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asCvPhotoBody,
  asStorablePhoto,
  cvPhotoSchema,
  emptyPhotoBody,
  MAX_PHOTO_BYTES,
  type CvPhoto
} from '../src/capabilities/cv/photo.js';

/** A buffer that starts like the named format and is otherwise nothing. */
const imageBytes = (mime: 'image/jpeg' | 'image/png', size = 64): Buffer => {
  const head = mime === 'image/jpeg'
    ? [0xff, 0xd8, 0xff]
    : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  return Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, size - head.length))]);
};

const photo = (over: Partial<CvPhoto> = {}): CvPhoto => ({
  mime: 'image/jpeg',
  base64: imageBytes('image/jpeg').toString('base64'),
  width: 400,
  height: 500,
  ...over
});

/* ------------------------------------------------------------ what is stored */

test('a photograph whose bytes match its label is stored as it arrived', () => {
  const incoming = photo();

  assert.deepEqual(asStorablePhoto(incoming), incoming);
});

test('a PNG is a photograph too', () => {
  const png = photo({
    mime: 'image/png',
    base64: imageBytes('image/png').toString('base64')
  });

  assert.deepEqual(asStorablePhoto(png), png);
});

test('the bytes decide the format, not the label on them', () => {
  // The whole reason the magic-byte check exists. `mime` and `base64` arrive in
  // the same payload from the same caller, so believing the label is believing
  // the sender about the sender.
  const mislabelled = photo({
    mime: 'image/jpeg',
    base64: imageBytes('image/png').toString('base64')
  });

  assert.throws(
    () => asStorablePhoto(mislabelled),
    /not a image\/jpeg image/
  );
});

test('a format the renderer cannot draw is refused at the schema', () => {
  // WebP is what a browser saves a downscaled portrait as. Accepting one would
  // store a photograph that only fails when somebody exports a PDF.
  assert.equal(
    cvPhotoSchema.safeParse({ ...photo(), mime: 'image/webp' }).success,
    false
  );
});

test('a photograph over the limit is refused, and the message says how big', () => {
  const huge = photo({
    base64: imageBytes('image/jpeg', MAX_PHOTO_BYTES + 1024).toString('base64')
  });

  assert.throws(() => asStorablePhoto(huge), /over the 2 MB limit/);
});

test('a photograph exactly at the limit is allowed', () => {
  // The boundary belongs to the accepted side. A limit that refuses the value
  // it names is a limit nobody can hit deliberately.
  const exact = photo({
    base64: imageBytes('image/jpeg', MAX_PHOTO_BYTES).toString('base64')
  });

  assert.deepEqual(asStorablePhoto(exact), exact);
});

test('something that is not base64 is refused before anything decodes it', () => {
  assert.throws(
    () => asStorablePhoto(photo({ base64: 'not base64 at all!!' })),
    /not valid base64/
  );
});

test('an empty photograph is refused', () => {
  // `z.string().min(1)` stops the empty string, but "AA==" is a legal string
  // that decodes to nothing, and a zero-byte image is not a picture.
  assert.throws(() => asStorablePhoto(photo({ base64: '' })), /empty/);
});

test('dimensions have to be real', () => {
  for (const bad of [{ width: 0 }, { height: -1 }, { width: 12.5 }]) {
    assert.equal(
      cvPhotoSchema.safeParse({ ...photo(), ...bad }).success,
      false,
      `${JSON.stringify(bad)} was accepted`
    );
  }
});

/* -------------------------------------------------------------- what is read */

test('a row that was never written reads as no photograph', () => {
  assert.deepEqual(asCvPhotoBody(undefined), { photo: null });
});

test('a body that will not parse reads as no photograph rather than throwing', () => {
  // Deliberately unlike `asCvDocument`, which throws. A CV that will not parse
  // is a CV somebody is trying to recover and must be told about; a portrait
  // that will not parse is a picture, and refusing to draw the whole profile
  // over one is the wrong trade.
  assert.deepEqual(asCvPhotoBody({ photo: { mime: 'image/gif' } }), { photo: null });
  assert.deepEqual(asCvPhotoBody({ nothing: 'expected' }), { photo: null });
});

test('a stored photograph comes back whole', () => {
  const stored = photo();

  assert.deepEqual(asCvPhotoBody({ photo: stored }), { photo: stored });
});

test('each empty body is its own', () => {
  // Two clears must not alias one object: a later write through either would
  // otherwise be visible in both.
  const first = emptyPhotoBody();
  const second = emptyPhotoBody();

  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});
