/**
 * Turning whatever a person handed us into text.
 *
 * Three routes, one result shape. Everything downstream — chunking, embedding,
 * every extraction step — is a plain text operation, and none of them needs to
 * know whether the words arrived as a paste, a PDF or a photograph. That is the
 * whole job of this module: to be the last place the difference matters.
 *
 * Two things it deliberately does not do.
 *
 * **It does not fetch URLs.** A link becomes a `text` source with the page
 * already read, by the user or by the offer reader. Adding a fetcher here would
 * quietly become a second, unguarded way out of this process, next to the one
 * that has the SSRF checks.
 *
 * **It does not rasterise PDFs.** A PDF with no text layer — a scan, or a
 * design-tool export — is read perfectly and contains nothing, and there is no
 * error to report. Rendering a page to pixels needs a PDF renderer and its
 * native canvas dependency, which is a large addition for one case a person can
 * resolve in seconds with a screenshot. So that case is reported, with the
 * instruction, rather than guessed at.
 */

import { RuntimeError } from '../contracts/index.js';
import type {
  AiGateway,
  EffectCall,
  SourceInput,
  SourceReader,
  SourceText
} from '../contracts/index.js';

/**
 * Below this, treat a PDF as having no text layer.
 *
 * A one-page CV runs to a couple of thousand characters. An export without a
 * text layer still yields a handful from embedded metadata or a stray label, so
 * the threshold has to sit above "nothing at all" rather than at it.
 */
const MIN_PDF_CHARS = 120;

/**
 * Generous, because a dense CV screenshot is a lot of text, and a transcript
 * cut off mid-sentence silently loses the last job on the page — which is the
 * most recent one, and the one that matters most.
 */
const TRANSCRIBE_MAX_TOKENS = 4_000;

/**
 * Transcribe, explicitly. Not "summarise" and not "pull out the fields".
 *
 * Asking a vision model to do the extraction as well means it decides what
 * matters before the narrow schemas downstream get a chance to, and whatever it
 * silently dropped cannot be recovered. One job per call, and the job here is
 * to turn pixels into the text that was already there.
 *
 * The `NO TEXT` sentinel exists because a model without vision does not fail —
 * it invents a plausible CV out of nothing. An explicit answer for "there is
 * nothing here" is the only way an empty image is distinguishable from a
 * confident hallucination.
 */
const TRANSCRIBE = `Transcribe all text visible in this image, in reading order.
Include headings, dates, job titles, company names, and bullet points.
Do not summarise, reword, or add anything that is not written in the image.
If the image contains no text, answer exactly: NO TEXT`;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const mimeOf = (value: string): string => value.split(';')[0]?.trim().toLowerCase() ?? '';

export type SourceReaderOptions = {
  readonly ai: AiGateway;
};

export const createSourceReader = (options: SourceReaderOptions): SourceReader => {
  const readPdf = async (bytes: Uint8Array): Promise<SourceText> => {
    // Imported at the point of use. Most runs never touch a PDF, and the parser
    // is the largest dependency in the tree.
    const { getDocumentProxy, extractText } = await import('unpdf');

    let pages: number;
    let raw: string;

    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const extracted = await extractText(pdf, { mergePages: true });
      pages = extracted.totalPages;
      // `mergePages` is typed as producing either shape depending on the flag.
      raw = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text;
    } catch {
      // The parser's own message is not passed on: it describes byte offsets in
      // a file the user cannot inspect, and says nothing they can act on.
      throw new RuntimeError('That file could not be read as a PDF.', 'unreadable_source');
    }

    const text = raw.replace(/\s+\n/g, '\n').trim();

    if (text.length < MIN_PDF_CHARS) {
      throw new RuntimeError(
        'That PDF has no text layer — it is a scan or a design export. Screenshot the '
          + 'pages and pass the images instead, or run it through OCR first.',
        'unreadable_source'
      );
    }

    return { text, pages, via: 'pdf' };
  };

  const readImage = async (
    bytes: Uint8Array,
    mime: string,
    call: EffectCall
  ): Promise<SourceText> => {
    const { text } = await options.ai.transcribeImage({
      ...call,
      bytes,
      mediaType: mime,
      instruction: TRANSCRIBE,
      maxOutputTokens: TRANSCRIBE_MAX_TOKENS
    });

    const trimmed = text.trim();

    if (!trimmed || trimmed === 'NO TEXT') {
      throw new RuntimeError('There is no readable text in that image.', 'unreadable_source');
    }

    return { text: trimmed, via: 'ocr' };
  };

  return {
    async read(input: SourceInput, call: EffectCall): Promise<SourceText> {
      if (input.kind === 'text') {
        const text = input.text.trim();

        if (!text) throw new RuntimeError('That source is empty.', 'unreadable_source');

        return { text, via: 'plain' };
      }

      const mime = mimeOf(input.mime);

      if (mime === 'application/pdf') return readPdf(input.bytes);

      if (IMAGE_TYPES.has(mime)) return readImage(input.bytes, mime, call);

      if (mime.startsWith('text/') || mime === 'application/json') {
        // `fatal` so mislabelled bytes are refused rather than decoded into a
        // page of replacement characters that reads as a successful import.
        let text: string;

        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes).trim();
        } catch {
          throw new RuntimeError(
            'That file is labelled as text but is not valid UTF-8.',
            'unreadable_source'
          );
        }

        if (!text) throw new RuntimeError('That source is empty.', 'unreadable_source');

        return { text, via: 'plain' };
      }

      throw new RuntimeError(
        `There is no reader for "${mime || 'an unlabelled file'}". Supported: PDF, `
          + 'PNG, JPEG, WebP, GIF, and plain text.',
        'unreadable_source'
      );
    },

    through: (ai: AiGateway): SourceReader => createSourceReader({ ...options, ai })
  };
};
