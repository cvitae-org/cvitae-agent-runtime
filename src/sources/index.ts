/**
 * Turns whatever the user pointed at into one text corpus.
 *
 * Every source is reduced to text before any extraction happens, which is the
 * decision that keeps the seven extraction steps from each needing to know
 * about PDFs and images. It also means a mixed import — a PDF CV, a screenshot
 * of a LinkedIn profile, and a pasted paragraph — is a single extraction over
 * the union rather than three runs that then have to be reconciled.
 *
 * Sources are labelled in the corpus. A model reading "=== SOURCE: linkedin
 * profile (screenshot) ===" is measurably less likely to merge two employers
 * across a boundary than one reading a wall of concatenated text, and it costs
 * a line per source to say it.
 */

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { LanguageModel } from 'ai';
import { readPdfBytes } from './pdf.js';
import { mediaTypeFor, readImageBytes, scannedPdfRefusal } from './image.js';
import { SourceError } from './types.js';
import type { ReadOutcome, SourceInput, SourceRecord } from './types.js';
import type { AiLogger } from '../ai/logging.js';

export type { SourceInput, SourceRecord, ReadOutcome } from './types.js';
export { SourceError } from './types.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.text', '.json']);

/**
 * Total corpus ceiling.
 *
 * Seven extraction steps each read the whole corpus, so every character is paid
 * for seven times. More to the point, a small local model's adherence to a
 * schema degrades well before its context window fills — the failure is not a
 * truncation error but a quietly worse extraction, which is harder to notice.
 * Two CVs' worth is enough for any real import.
 */
const MAX_CORPUS_CHARACTERS = 24_000;

const label = (input: SourceInput): string => {
  switch (input.kind) {
    case 'text':
      return input.label ?? 'pasted text';
    case 'file':
      return basename(input.path);
    case 'upload':
      return basename(input.filename);
  }
};

/**
 * A decoded upload may not exceed this.
 *
 * The corpus ceiling below cannot stand in for it: that is applied to extracted
 * *text*, long after a 200MB attachment has been base64-decoded into memory and
 * handed to a PDF parser. This bounds the input rather than the output, and 12MB
 * is far above any CV while being well under what would trouble the process.
 */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Decodes an upload, rejecting what is not actually base64.
 *
 * `Buffer.from(value, 'base64')` never throws — it discards anything outside the
 * alphabet and returns whatever is left. So a caller that posted raw text, or a
 * JSON string that lost its encoding somewhere, gets silent garbage that reaches
 * the PDF parser as a corrupt-file error naming the wrong cause. Checking the
 * alphabet first turns that into a sentence about the request.
 *
 * The `data:` prefix is accepted because `FileReader.readAsDataURL` is the
 * obvious way for a browser to produce this and it includes one.
 */
const decodeUpload = (content: string, reference: string): Buffer => {
  const payload = content.replace(/^data:[^;,]*;base64,/, '').trim();

  if (!payload || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(payload)) {
    throw new SourceError(`${reference} is not valid base64.`);
  }

  const bytes = Buffer.from(payload, 'base64');

  if (!bytes.length) {
    throw new SourceError(`${reference} decoded to nothing.`);
  }

  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new SourceError(
      `${reference} is ${Math.round(bytes.length / 1024 / 1024)}MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit for one upload.`
    );
  }

  return bytes;
};

/**
 * A source that is bytes plus a name, whichever end it arrived from.
 *
 * `file` and `upload` differ only in where the buffer comes from, so they are
 * normalised to this and read once below. Written as a lazy `load` rather than a
 * buffer so the text branch still reads a `.md` as UTF-8 directly instead of
 * decoding it twice.
 */
type Binary = {
  reference: string;
  extension: string;
  load: () => Promise<Buffer>;
};

const readBinary = async (
  { reference, extension, load }: Binary,
  model: LanguageModel | undefined,
  signal: AbortSignal | undefined,
  ai: SourceAiContext | undefined
): Promise<{ kind: string; text: string }> => {
  if (TEXT_EXTENSIONS.has(extension)) {
    return { kind: 'file', text: (await load()).toString('utf8').trim() };
  }

  if (extension === '.pdf') {
    const outcome = await readPdfBytes(await load(), reference);

    if (outcome.status === 'ok') {
      return { kind: 'pdf', text: outcome.text };
    }

    throw new SourceError(scannedPdfRefusal(reference));
  }

  const mediaType = mediaTypeFor(reference);

  if (mediaType) {
    if (!model) {
      throw new SourceError(
        `${reference} is an image and needs a vision-capable model to read. Pass one, or transcribe it yourself.`
      );
    }

    return {
      kind: 'image',
      text: await readImageBytes({
        bytes: await load(),
        mediaType,
        reference,
        model,
        signal,
        ...ai
      })
    };
  }

  throw new SourceError(
    `${reference} is not a format this runtime reads. Supported: .txt, .md, .pdf, .png, .jpg, .jpeg, .webp.`
  );
};

const readOne = async (
  input: SourceInput,
  model: LanguageModel | undefined,
  signal: AbortSignal | undefined,
  ai: SourceAiContext | undefined
): Promise<{ kind: string; text: string }> => {
  if (input.kind === 'text') {
    return { kind: 'text', text: input.content.trim() };
  }

  if (input.kind === 'upload') {
    const reference = basename(input.filename);

    return readBinary(
      {
        reference,
        extension: extname(input.filename).toLowerCase(),
        // Decoded inside `load` so an unreadable payload is reported by the
        // branch that knows what it was trying to read.
        load: async () => decodeUpload(input.content, reference)
      },
      model,
      signal,
      ai
    );
  }

  return readBinary(
    {
      reference: input.path,
      extension: extname(input.path).toLowerCase(),
      load: async () => {
        try {
          return await readFile(input.path);
        } catch (error) {
          throw new SourceError(
            `Could not read ${input.path}: ${(error as Error).message}`
          );
        }
      }
    },
    model,
    signal,
    ai
  );
};

type SourceAiContext = {
  aiLogger?: AiLogger;
  traceId?: string;
  providerId?: string;
  modelId?: string;
  capability?: string;
};

export const readSources = async ({
  inputs,
  model,
  signal,
  ai
}: {
  inputs: SourceInput[];
  /** Needed only for images. Absent is fine when there are none. */
  model?: LanguageModel;
  signal?: AbortSignal;
  /** Optional identity for image-transcription log correlation. */
  ai?: SourceAiContext;
}): Promise<ReadOutcome> => {
  const records: SourceRecord[] = [];
  const skipped: { reference: string; reason: string }[] = [];
  const blocks: string[] = [];

  const imported_at = new Date().toISOString();

  // Sequential rather than parallel. The image path runs a model, and on a
  // local server two vision calls at once contend for the one GPU — the same
  // reason the orchestrator drops to concurrency 1 there.
  for (const input of inputs) {
    const reference = label(input);

    try {
      const { kind, text } = await readOne(input, model, signal, ai);

      if (!text) {
        skipped.push({ reference, reason: 'Contained no text.' });
        continue;
      }

      records.push({ kind, reference, imported_at, characters: text.length });
      blocks.push(`=== SOURCE: ${reference} ===\n${text}`);
    } catch (error) {
      skipped.push({
        reference,
        reason:
          error instanceof SourceError
            ? error.message
            : `Could not be read: ${(error as Error).message}`
      });
    }
  }

  let text = blocks.join('\n\n');

  if (text.length > MAX_CORPUS_CHARACTERS) {
    // Truncated at the end rather than sampled from the middle: CVs put the
    // most recent and most relevant experience first, so the tail is the part
    // that can be lost most safely.
    text = `${text.slice(0, MAX_CORPUS_CHARACTERS)}\n\n[Truncated: the sources exceed what one extraction pass reads.]`;
  }

  return { text, records, skipped };
};
