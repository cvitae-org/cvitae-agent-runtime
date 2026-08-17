/**
 * PDF text extraction.
 *
 * `unpdf` rather than `pdf-parse`, which is more popular: pdf-parse pulls
 * `pdfjs-dist` with its optional native canvas dependency, and unpdf ships a
 * build of the same PDF.js with none. Nothing here renders a page, so the
 * renderer's dependencies are pure cost.
 *
 * The important limitation is one this cannot fix. A PDF exported from a design
 * tool, or a scan, carries no text layer — `extractText` returns almost nothing
 * and there is no error to report, because the file was read perfectly and
 * genuinely contains no text. That case is detected by measuring the result and
 * handed to the image path, which can actually read it.
 */

import { SourceError } from './types.js';

/**
 * Below this, treat the PDF as having no text layer.
 *
 * A one-page CV runs to a couple of thousand characters. A text-layer-free
 * export still yields a handful from embedded metadata or a stray label, so the
 * threshold has to sit above "nothing at all" rather than at it.
 */
const MIN_USEFUL_CHARACTERS = 120;

export type PdfOutcome =
  | { status: 'ok'; text: string; pages: number }
  /** Read fine, but there is no text in it. The image path can still try. */
  | { status: 'no_text_layer'; pages: number };

/**
 * Takes bytes rather than a path, because the two callers have different ones.
 *
 * A file on disk and a file posted by a browser differ only in where the buffer
 * came from, and `sources/index.ts` resolves that before getting here. Reading
 * the file in this module instead would mean an upload needed a second parse
 * beside this one, and the "no text layer" threshold could then drift between
 * a PDF opened locally and the same PDF uploaded.
 *
 * `reference` is what error messages name — a path for one caller, a filename
 * for the other.
 */
export const readPdfBytes = async (
  bytes: Uint8Array,
  reference: string
): Promise<PdfOutcome> => {
  const { getDocumentProxy, extractText } = await import('unpdf');

  let pages: number;
  let text: string;

  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const extracted = await extractText(pdf, { mergePages: true });
    pages = extracted.totalPages;
    // `mergePages` is typed as producing either shape depending on the flag.
    text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text;
  } catch (error) {
    throw new SourceError(
      `${reference} could not be parsed as a PDF: ${(error as Error).message}`
    );
  }

  const trimmed = text.replace(/\s+\n/g, '\n').trim();

  if (trimmed.length < MIN_USEFUL_CHARACTERS) {
    return { status: 'no_text_layer', pages };
  }

  return { status: 'ok', text: trimmed, pages };
};
