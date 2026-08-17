/**
 * What the extractor is allowed to be pointed at.
 *
 * Text and local files, and deliberately not URLs. The diagram shows LinkedIn
 * as a source, and the honest way to read a LinkedIn profile is the way
 * cvitae-scrapper already settled on for LinkedIn job posts: it refuses to
 * crawl, and takes text the user copied out of their own browser instead —
 * "a person reading a page they are entitled to read". Adding a fetcher here
 * would work around a decision the sibling project made on purpose, and would
 * do it for the one site most likely to ban the account.
 *
 * So a link becomes a `text` source with the URL as its label. Whoever fetched
 * it — the user, or cvitae-scrapper for a board that permits it — is upstream
 * of this module.
 */

export type SourceInput =
  | {
      kind: 'text';
      /** Where it came from, e.g. a URL or "pasted". Recorded on the document. */
      label?: string;
      content: string;
    }
  | {
      kind: 'file';
      /** Absolute path. Read once, never stored — only the text it yields is. */
      path: string;
    }
  | {
      /**
       * Bytes sent with the request, for callers that have no path to give.
       *
       * cvitae is the reason this exists. It is a browser application, and a
       * file picker there yields a `File` — bytes and a name, never a location
       * the runtime could open. `kind: 'file'` is unreachable from it, so
       * without this the only importable source from the app that owns the CV
       * would have been pasted text.
       *
       * Base64 in the JSON envelope rather than multipart, because `/run/:name`
       * takes one envelope shape for every capability and a second content type
       * for one of them would fork that. The cost is a third more bytes on a
       * loopback hop, which is not worth a special case.
       */
      kind: 'upload';
      /** Original name. Only the extension is read — it decides the format. */
      filename: string;
      /** Base64, with or without a `data:…;base64,` prefix. */
      content: string;
    };

/** What one source produced, kept so the document can say where a field came from. */
export type SourceRecord = {
  kind: string;
  reference: string;
  imported_at: string;
  /** Characters of text obtained. Zero means it was read but held nothing. */
  characters: number;
};

export type ReadOutcome = {
  /** The combined corpus the extraction steps read. */
  text: string;
  records: SourceRecord[];
  /**
   * Sources that could not be read, with the reason. Surfaced rather than
   * thrown: one unreadable file out of five should not lose the other four,
   * and the user needs to know which one to convert by hand.
   */
  skipped: { reference: string; reason: string }[];
};

export class SourceError extends Error {}
