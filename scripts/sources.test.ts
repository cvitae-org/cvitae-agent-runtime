/**
 * Which reader gets the bytes, and what happens when none of them can help.
 *
 * Almost every case here ends in `unreadable_source`, which is the point: the
 * failures a person can act on and the failures they cannot look identical from
 * the inside, and only one of them is worth showing them. A PDF exported from a
 * design tool is read perfectly and contains nothing; the useful answer is
 * "screenshot it", not a parser's byte offset.
 *
 * The empty-PDF fixture is built here rather than checked in, so what makes it
 * a text-free PDF is visible: three objects, one page, no content stream. It is
 * the design-export case exactly.
 *
 * Confirmed by breaking two of them. Dropping `{ fatal: true }` from the
 * decoder turns the mislabelled-bytes test from a refusal into a successful
 * import of replacement characters — a CV that reads as imported and contains
 * nothing. Removing the `NO TEXT` check hands back the sentinel as if it were
 * the document's text, so a photo of a wall becomes a two-word CV.
 *
 * No model is reached: the gateway is a stub that records what it was asked.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeError } from '../src/contracts/index.js';
import type { AiGateway, ImageRequest } from '../src/contracts/index.js';
import { createSourceReader } from '../src/effects/sources.js';

const call = { traceId: 'trace-1', runId: 'run-1', step: 'read', signal: new AbortController().signal };

const codeOf = (error: unknown): string =>
  error instanceof RuntimeError ? error.code : `not a RuntimeError: ${String(error)}`;

const refusal = async (run: () => Promise<unknown>): Promise<RuntimeError> => {
  const error = await run().then(() => undefined, (reason: unknown) => reason);
  assert.equal(codeOf(error), 'unreadable_source');
  return error as RuntimeError;
};

/** Records the request; answers with whatever the test wants read back. */
const stubVision = (answer: string) => {
  const seen: ImageRequest[] = [];

  const ai = {
    transcribeImage: async (request: ImageRequest) => {
      seen.push(request);
      return { text: answer, finishReason: 'stop', usage: {} };
    }
  } as unknown as AiGateway;

  return { ai, seen };
};

/** One page, no content stream — a PDF whose text layer is genuinely empty. */
const blankPdf = (): Uint8Array => {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>\nendobj\n'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }

  const startxref = pdf.length;

  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${startxref}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
};

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/* ----------------------------------------------------------------- text */

test('text arrives as text', async () => {
  const reader = createSourceReader({ ai: stubVision('').ai });
  const source = await reader.read({ kind: 'text', text: '  Jan Kowalski\n\nDeveloper  ' }, call);

  assert.deepEqual(source, { text: 'Jan Kowalski\n\nDeveloper', via: 'plain' });
});

test('an empty source is refused rather than imported as nothing', async () => {
  const reader = createSourceReader({ ai: stubVision('').ai });

  await refusal(() => reader.read({ kind: 'text', text: '   \n  ' }, call));
});

test('bytes labelled as text but not valid UTF-8 are refused, not mangled', async () => {
  const reader = createSourceReader({ ai: stubVision('').ai });

  // A lone continuation byte: valid Latin-1, invalid UTF-8. Without `fatal`
  // this decodes to U+FFFD and imports cleanly as a CV of one character.
  const error = await refusal(() =>
    reader.read({ kind: 'bytes', bytes: new Uint8Array([0x4a, 0x61, 0x6e, 0xa9]), mime: 'text/plain' }, call)
  );

  assert.match(error.message, /not valid UTF-8/);
});

test('a UTF-8 text file decodes, charset parameter and all', async () => {
  const reader = createSourceReader({ ai: stubVision('').ai });
  const source = await reader.read(
    { kind: 'bytes', bytes: bytesOf('Zażółć gęślą jaźń'), mime: 'text/plain; charset=utf-8' },
    call
  );

  assert.deepEqual(source, { text: 'Zażółć gęślą jaźń', via: 'plain' });
});

/* ------------------------------------------------------------------ pdf */

test('a PDF with no text layer says what to do about it', async () => {
  const reader = createSourceReader({ ai: stubVision('').ai });

  const error = await refusal(() =>
    reader.read({ kind: 'bytes', bytes: blankPdf(), mime: 'application/pdf' }, call)
  );

  // The parse succeeded. Reporting it as a failure would send someone looking
  // for a broken file; the file is fine and the fix is a screenshot.
  assert.match(error.message, /no text layer/);
  assert.match(error.message, /[Ss]creenshot/);
});

test("a corrupt PDF does not pass on the parser's own message", async () => {
  const reader = createSourceReader({ ai: stubVision('').ai });

  const error = await refusal(() =>
    reader.read({ kind: 'bytes', bytes: bytesOf('%PDF-1.4\nthis is not a PDF'), mime: 'application/pdf' }, call)
  );

  assert.equal(error.message, 'That file could not be read as a PDF.');
});

/* ---------------------------------------------------------------- image */

test('an image is transcribed, and the result is marked as a reading', async () => {
  const { ai, seen } = stubVision('Jan Kowalski\nSenior Engineer');
  const reader = createSourceReader({ ai });
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  const source = await reader.read({ kind: 'bytes', bytes, mime: 'image/png' }, call);

  // `ocr`, not `plain`: downstream this is a model's reading of a picture, and
  // anything that treats it as a copy of the document is wrong about it.
  assert.deepEqual(source, { text: 'Jan Kowalski\nSenior Engineer', via: 'ocr' });

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.mediaType, 'image/png');
  assert.equal(seen[0]?.bytes, bytes);
  // The run's own signal, so a cancelled run cancels the transcription too.
  assert.equal(seen[0]?.signal, call.signal);
});

test('an image with nothing to read is refused, sentinel and all', async () => {
  const { ai } = stubVision('NO TEXT');
  const reader = createSourceReader({ ai });

  // A model without vision does not fail — it answers plausibly about an image
  // it cannot see. The sentinel is what makes that answer detectable.
  await refusal(() =>
    reader.read({ kind: 'bytes', bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' }, call)
  );
});

test('an empty transcription is refused too', async () => {
  const { ai } = stubVision('   ');
  const reader = createSourceReader({ ai });

  await refusal(() =>
    reader.read({ kind: 'bytes', bytes: new Uint8Array([1, 2, 3]), mime: 'image/webp' }, call)
  );
});

/* --------------------------------------------------------------- neither */

test('an unsupported type names what is supported instead', async () => {
  const reader = createSourceReader({ ai: stubVision('').ai });

  const error = await refusal(() =>
    reader.read({
      kind: 'bytes',
      bytes: new Uint8Array([0x50, 0x4b]),
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }, call)
  );

  assert.match(error.message, /PDF, PNG, JPEG, WebP, GIF, and plain text/);
  assert.match(error.message, /wordprocessingml/);
});

test('an unlabelled file is described as unlabelled, not as ""', async () => {
  const reader = createSourceReader({ ai: stubVision('').ai });

  const error = await refusal(() =>
    reader.read({ kind: 'bytes', bytes: new Uint8Array([1]), mime: '' }, call)
  );

  assert.match(error.message, /an unlabelled file/);
});
