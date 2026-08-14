/**
 * Reading a CV that only exists as pixels.
 *
 * A screenshot of a LinkedIn profile, a photographed certificate, or a PDF
 * exported without a text layer. The model transcribes it and the transcript
 * joins the corpus, so every extraction step downstream stays a plain text
 * operation and none of them need to know an image was involved.
 *
 * Transcribe, explicitly — not "summarise" and not "extract the fields". Asking
 * a vision model to do the extraction as well means it decides what matters
 * before the narrow schemas get a chance to, and the parts it silently drops
 * cannot be recovered. One job per call, and the job here is to turn pixels
 * into the text that was already there.
 *
 * This is the one place the runtime needs a model with vision. `gemma4:12b`
 * has it; `gemma3:4b` does not, and the failure is reported rather than
 * guessed at, because a model without vision does not error — it hallucinates
 * a plausible CV from nothing.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { LanguageModel } from 'ai';
import { SourceError } from './types.js';

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

export const isImagePath = (path: string): boolean =>
  extname(path).toLowerCase() in MEDIA_TYPES;

export const mediaTypeFor = (path: string): string | undefined =>
  MEDIA_TYPES[extname(path).toLowerCase()];

const TRANSCRIBE = `Transcribe all text visible in this image, in reading order.
Include headings, dates, job titles, company names, and bullet points.
Do not summarise, reword, or add anything that is not written in the image.
If the image contains no text, answer exactly: NO TEXT`;

/**
 * Generous, because a dense CV screenshot is a lot of text and a transcript cut
 * off mid-sentence silently loses the last job on the page — the most recent
 * one, and the one that matters most.
 */
const MAX_OUTPUT_TOKENS = 4_000;

export const readImage = async ({
  path,
  model,
  signal
}: {
  path: string;
  model: LanguageModel;
  signal?: AbortSignal;
}): Promise<string> => {
  const mediaType = mediaTypeFor(path);

  if (!mediaType) {
    throw new SourceError(`${path} is not an image this runtime can read.`);
  }

  let bytes: Buffer;

  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new SourceError(`Could not read ${path}: ${(error as Error).message}`);
  }

  const { generateText } = await import('ai');

  const { text } = await generateText({
    model,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: signal,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: TRANSCRIBE },
          { type: 'image', image: new Uint8Array(bytes), mediaType }
        ]
      }
    ]
  });

  const trimmed = text.trim();

  if (!trimmed || trimmed === 'NO TEXT') {
    throw new SourceError(`No readable text in ${path}.`);
  }

  return trimmed;
};

/**
 * Transcribes a PDF that has no text layer.
 *
 * Not implemented, and failing loudly rather than quietly returning nothing.
 * Rasterising a PDF page needs a renderer — the canvas dependency deliberately
 * avoided in `pdf.ts` — so the honest answer today is to tell the user to
 * screenshot the page, which takes them a few seconds and costs this project
 * nothing.
 */
export const scannedPdfRefusal = (path: string): string =>
  `${path} has no text layer — it is a scan or a design export. Screenshot the pages and pass the images instead, or run it through OCR first.`;
