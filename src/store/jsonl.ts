/**
 * A line-delimited JSON file of many records, written whole and atomically.
 *
 * The second authored shape in the runtime. `cv.json` is one document the user
 * edits; this is a growing list the runtime accumulates, and the difference is
 * enough to want a different container: a single JSON array would have to be
 * reparsed to answer anything, and would not survive being grepped, tailed, or
 * cut into with `jq` — which is the entire reason for choosing a text format
 * over the columnar store sitting right next to it.
 *
 * ## Why a full rewrite and not an append
 *
 * Append-only is the obvious idiom for JSONL and it is the wrong one here.
 * These records are re-seen constantly — a standing search touches
 * `last_seen_at` on every offer it finds again — so an append log would grow by
 * a near-duplicate copy of every live record on every round, and reads would
 * have to scan the whole history to work out which version won. Rewriting the
 * file each time keeps its size proportional to the data rather than to the
 * number of times the runtime has looked at it.
 *
 * The write is a temp file plus a `rename`, exactly as `CvDocumentStore` does
 * it and for the same reason: `rename` is atomic within a filesystem, so a
 * crash mid-write leaves the previous file intact rather than a truncated one.
 * The cost is holding every record in memory at once, which is correct up to
 * the tens of thousands and wrong somewhere past that. At the point where it is
 * wrong, the answer is a compacting append log, not a bigger buffer.
 *
 * ## Why a bad line throws
 *
 * The same argument `CvDocumentStore.read` makes. A file that exists but does
 * not parse means something edited it wrongly, and quietly dropping the line —
 * or the file — destroys the records the user was trying to repair. The error
 * names the line number, because with one record per line that is enough to fix
 * it by hand.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import type { z } from 'zod';
import { ensureHome } from './paths.js';

export class JsonlStore<T> {
  constructor(
    private readonly path: string,
    private readonly schema: z.ZodType<T>
  ) {}

  /** Every record in the file, in file order. Empty when the file is absent. */
  async all(): Promise<T[]> {
    let raw: string;

    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const records: T[] = [];

    // Indexed rather than filtered-then-mapped so the error can name the line
    // as it appears in an editor, which is the only number that helps.
    const lines = raw.split('\n');

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]?.trim();
      if (!line) continue;

      let value: unknown;

      try {
        value = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `${this.path}:${index + 1} is not valid JSON: ${(error as Error).message}`,
          { cause: error }
        );
      }

      const parsed = this.schema.safeParse(value);

      if (!parsed.success) {
        throw new Error(
          `${this.path}:${index + 1} does not match the record schema: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`
        );
      }

      records.push(parsed.data);
    }

    return records;
  }

  /** Replaces the file with exactly these records. Returns how many were written. */
  async write(records: T[]): Promise<number> {
    await ensureHome();

    const body = records.map((record) => JSON.stringify(record)).join('\n');

    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, records.length > 0 ? `${body}\n` : '', 'utf8');
    await rename(temporary, this.path);

    return records.length;
  }
}
