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
import { readPdf } from './pdf.js';
import { isImagePath, readImage, scannedPdfRefusal } from './image.js';
import { SourceError } from './types.js';
import type { ReadOutcome, SourceInput, SourceRecord } from './types.js';

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

const label = (input: SourceInput): string =>
  input.kind === 'text' ? (input.label ?? 'pasted text') : basename(input.path);

const readOne = async (
  input: SourceInput,
  model: LanguageModel | undefined,
  signal: AbortSignal | undefined
): Promise<{ kind: string; text: string }> => {
  if (input.kind === 'text') {
    return { kind: 'text', text: input.content.trim() };
  }

  const extension = extname(input.path).toLowerCase();

  if (TEXT_EXTENSIONS.has(extension)) {
    return { kind: 'file', text: (await readFile(input.path, 'utf8')).trim() };
  }

  if (extension === '.pdf') {
    const outcome = await readPdf(input.path);

    if (outcome.status === 'ok') {
      return { kind: 'pdf', text: outcome.text };
    }

    throw new SourceError(scannedPdfRefusal(input.path));
  }

  if (isImagePath(input.path)) {
    if (!model) {
      throw new SourceError(
        `${basename(input.path)} is an image and needs a vision-capable model to read. Pass one, or transcribe it yourself.`
      );
    }

    return { kind: 'image', text: await readImage({ path: input.path, model, signal }) };
  }

  throw new SourceError(
    `${basename(input.path)} is not a format this runtime reads. Supported: .txt, .md, .pdf, .png, .jpg, .jpeg, .webp.`
  );
};

export const readSources = async ({
  inputs,
  model,
  signal
}: {
  inputs: SourceInput[];
  /** Needed only for images. Absent is fine when there are none. */
  model?: LanguageModel;
  signal?: AbortSignal;
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
      const { kind, text } = await readOne(input, model, signal);

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
