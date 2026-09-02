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

import { extname } from 'node:path';
import type { LanguageModel } from 'ai';
import { SourceError } from './types.js';
import {
  createAiLogger,
  summarizeImage,
  summarizeText,
  withAiLogging,
  type AiLogger
} from '../ai/logging.js';

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

/** Doubles as the "is this an image" test: a name with no media type is not one. */
export const mediaTypeFor = (nameOrPath: string): string | undefined =>
  MEDIA_TYPES[extname(nameOrPath).toLowerCase()];

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

/**
 * Takes bytes rather than a path, for the reason given on `readPdfBytes`: an
 * uploaded screenshot and one on disk differ only in where the buffer came
 * from, and the prompt is the part that must not diverge between them.
 */
export const readImageBytes = async ({
  bytes,
  mediaType,
  reference,
  model,
  signal,
  aiLogger,
  traceId,
  providerId,
  modelId,
  capability
}: {
  bytes: Uint8Array;
  mediaType: string;
  reference: string;
  model: LanguageModel;
  signal?: AbortSignal;
  aiLogger?: AiLogger;
  traceId?: string;
  providerId?: string;
  modelId?: string;
  capability?: string;
}): Promise<string> => {
  const { generateText } = await import('ai');
  const inferredProvider =
    typeof model === 'string' ? 'unknown' : model.provider;
  const inferredModel = typeof model === 'string' ? model : model.modelId;

  const { text } = await withAiLogging({
    logger: aiLogger ?? createAiLogger(),
    traceId,
    operation: 'generateText',
    purpose: 'image_transcription',
    providerId: providerId ?? inferredProvider,
    modelId: modelId ?? inferredModel,
    capability,
    step: 'transcribe_image',
    signal,
    input: summarizeImage({ prompt: TRANSCRIBE, bytes, mediaType }),
    call: () =>
      generateText({
        model,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: signal,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: TRANSCRIBE },
              { type: 'image', image: bytes, mediaType }
            ]
          }
        ]
      }),
    summarizeResult: (generated) => ({
      output: summarizeText('text', generated.text),
      finishReason: generated.finishReason,
      usage: generated.totalUsage
    })
  });

  const trimmed = text.trim();

  if (!trimmed || trimmed === 'NO TEXT') {
    throw new SourceError(`No readable text in ${reference}.`);
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
