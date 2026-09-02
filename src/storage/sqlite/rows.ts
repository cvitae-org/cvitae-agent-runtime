/**
 * Row helpers shared by this directory. Nothing here is exported past it.
 */

export type Json = Readonly<Record<string, unknown>>;

export const packJson = (value: Json | undefined): string | null =>
  value === undefined ? null : JSON.stringify(value);

export const unpackJson = (value: string | null): Json | undefined =>
  value === null ? undefined : (JSON.parse(value) as Json);

export const unpackStrings = (value: string): string[] => JSON.parse(value) as string[];

/** SQLite has no boolean. */
export const packBool = (value: boolean): number => (value ? 1 : 0);
export const unpackBool = (value: number): boolean => value === 1;

/**
 * Folds text for search.
 *
 * FTS5's `remove_diacritics 2` handles every Polish letter that decomposes into
 * a base plus a combining mark, and leaves crossed-l alone — U+0142 is its own
 * letter and has nothing to strip. Measured: without this fold, a search for
 * "zolw" misses a document spelled with the crossed-l, and Polish typed on a
 * keyboard without the layout is exactly that search.
 *
 * Applied at both index time and query time, which is the only way a fold like
 * this stays consistent.
 */
export const foldForSearch = (text: string): string =>
  text.replaceAll('ł', 'l').replaceAll('Ł', 'L');

/** Float32Array to a BLOB and back, without copying the whole buffer. */
export const packVector = (vector: Float32Array): Buffer =>
  Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);

export const unpackVector = (blob: Buffer): Float32Array =>
  new Float32Array(
    blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)
  );
