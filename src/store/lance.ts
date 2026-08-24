/**
 * The LanceDB half of storage: derived data, and everything that gets searched.
 *
 * One engine covers all three access patterns the runtime needs — vector
 * similarity, BM25 keyword, and structured predicates over columns — which is
 * the argument for it over bolting a vector index onto a relational store. Its
 * own documentation says full-text search is Python-only; that is stale, and
 * `Index.fts()` indexes and ranks correctly from Node as of 0.37.
 *
 * Tables are created on first write rather than declared up front. LanceDB
 * infers the Arrow schema from the rows, so declaring it separately would mean
 * maintaining the same shape twice and getting a confusing cast error whenever
 * the two drifted. The cost is that a query against a table nothing has been
 * written to has to answer "empty" rather than "missing", which `collection()`
 * handles once here instead of at every call site.
 */

import type * as lancedb from '@lancedb/lancedb';
import { lancePath, ensureHome } from './paths.js';
import { RuntimeError } from '../core/types.js';

export type Row = Record<string, unknown>;

type LanceModule = typeof lancedb;

let modulePromise: Promise<LanceModule> | null = null;

/**
 * Loads LanceDB on first use, and tolerates it not being installed at all.
 *
 * The import is dynamic for the same reason the provider packages in
 * `providers/resolve.ts` are: it is a Rust addon with a platform-specific
 * binary, and nothing should pay to load it until something asks it a question.
 *
 * What is new is that it may be absent. `@lancedb/lancedb` is an optional
 * dependency, so a deployment that serves only the capabilities which touch no
 * storage — the hosted one — installs without it and never ships the binary.
 * A failed import is therefore a configuration, not a crash, and is reported as
 * the thing the caller actually lost: search.
 */
const loadLance = async (): Promise<LanceModule> => {
  if (!modulePromise) {
    modulePromise = import('@lancedb/lancedb').catch((error) => {
      // Cleared so a later call retries rather than serving this rejection for
      // the life of the process — the same rule as every other cache here.
      modulePromise = null;

      throw new RuntimeError(
        `The search index is unavailable: @lancedb/lancedb is not installed in this deployment. Everything that reads or writes the CV index needs it — install it, or use a runtime that has it. (${(error as Error).message})`,
        'step_failed'
      );
    });
  }

  return modulePromise;
};

let databasePromise: Promise<lancedb.Connection> | null = null;

const database = async (): Promise<lancedb.Connection> => {
  if (!databasePromise) {
    databasePromise = (async () => {
      const lance = await loadLance();
      await ensureHome();
      return lance.connect(lancePath());
    })();

    // A failed connection must not be cached, or the process keeps serving the
    // rejection after whatever broke it (a missing directory, a stale lock) is
    // fixed.
    databasePromise.catch(() => {
      databasePromise = null;
    });
  }

  return databasePromise;
};

/** Closes the handle so a test or a CLI can reopen against a different home. */
export const resetConnection = (): void => {
  databasePromise = null;
};

export type SearchHit<T extends Row = Row> = {
  row: T;
  /** Rank within its own result list, 1-based. Used by the fusion below. */
  rank: number;
  /** LanceDB's own score: distance for vectors, BM25 for text. */
  score: number;
};

/**
 * One named table, with the three query shapes the runtime uses.
 *
 * `keyColumn` is what makes writes idempotent: re-indexing the same chunk or
 * re-importing the same offer updates the row rather than growing a duplicate,
 * which matters because both of those happen routinely.
 */
export class Collection<T extends Row = Row> {
  private indexedColumns = new Set<string>();

  constructor(
    private readonly name: string,
    private readonly keyColumn: string,
    /** Columns to build an FTS index over, the first time rows arrive. */
    private readonly textColumns: string[] = []
  ) {}

  private async table(): Promise<lancedb.Table | null> {
    const db = await database();
    const names = await db.tableNames();
    if (!names.includes(this.name)) return null;
    return db.openTable(this.name);
  }

  async count(filter?: string): Promise<number> {
    const table = await this.table();
    if (!table) return 0;
    return table.countRows(filter);
  }

  /** Inserts or updates by `keyColumn`, creating the table if it is absent. */
  async upsert(rows: T[]): Promise<number> {
    if (rows.length === 0) return 0;

    const db = await database();
    const names = await db.tableNames();

    if (!names.includes(this.name)) {
      await db.createTable(this.name, rows);
      await this.ensureTextIndex();
      return rows.length;
    }

    const table = await db.openTable(this.name);

    await table
      .mergeInsert(this.keyColumn)
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rows);

    await this.ensureTextIndex();

    return rows.length;
  }

  async delete(predicate: string): Promise<void> {
    const table = await this.table();
    if (!table) return;
    await table.delete(predicate);
  }

  /**
   * Builds the BM25 index once rows exist.
   *
   * Deliberately best-effort. An FTS index on an empty or tiny table can fail,
   * and the query path falls back to a `LIKE` scan when it is missing — a
   * missing index should degrade keyword search, not break writes.
   */
  private async ensureTextIndex(): Promise<void> {
    if (this.textColumns.length === 0) return;

    const table = await this.table();
    if (!table) return;

    for (const column of this.textColumns) {
      if (this.indexedColumns.has(column)) continue;

      try {
        const lance = await loadLance();

        await table.createIndex(column, {
          config: lance.Index.fts(),
          replace: true
        });
        this.indexedColumns.add(column);
      } catch (error) {
        console.warn(
          `Could not build the full-text index on ${this.name}.${column}; keyword search will scan instead.`,
          error
        );
      }
    }
  }

  /** Nearest neighbours by cosine distance, optionally pre-filtered. */
  async searchByVector(
    vector: number[],
    limit: number,
    filter?: string
  ): Promise<SearchHit<T>[]> {
    const table = await this.table();
    if (!table) return [];

    let query = table.query().nearestTo(vector).limit(limit);
    if (filter) query = query.where(filter);

    const rows = (await query.toArray()) as (T & { _distance?: number })[];

    return rows.map((row, index) => ({
      row,
      rank: index + 1,
      score: row._distance ?? 0
    }));
  }

  /**
   * BM25 keyword search, falling back to a substring scan when no index exists.
   *
   * The fallback is not as good and is not meant to be — it exists so that a
   * fresh install with three rows in it still answers keyword queries instead
   * of returning nothing and looking broken.
   */
  async searchByText(
    query: string,
    limit: number,
    filter?: string
  ): Promise<SearchHit<T>[]> {
    const table = await this.table();
    if (!table || this.textColumns.length === 0) return [];

    try {
      let search = table.query().nearestToText(query, this.textColumns).limit(limit);
      if (filter) search = search.where(filter);

      const rows = (await search.toArray()) as (T & { _score?: number })[];

      return rows.map((row, index) => ({
        row,
        rank: index + 1,
        score: row._score ?? 0
      }));
    } catch {
      const column = this.textColumns[0];
      if (!column) return [];

      // Escaped for the SQL string literal LanceDB parses; a quote in a search
      // term would otherwise end the literal and produce a parse error.
      const escaped = query.replace(/'/g, "''");
      const predicate = `${column} LIKE '%${escaped}%'`;

      const scan = table
        .query()
        .where(filter ? `(${filter}) AND (${predicate})` : predicate)
        .limit(limit);

      const rows = (await scan.toArray()) as T[];

      return rows.map((row, index) => ({ row, rank: index + 1, score: 0 }));
    }
  }

  /** Structured predicates only — no ranking, just the rows that qualify. */
  async filter(predicate: string, limit: number): Promise<T[]> {
    const table = await this.table();
    if (!table) return [];
    return (await table.query().where(predicate).limit(limit).toArray()) as T[];
  }

  async all(limit = 1000): Promise<T[]> {
    const table = await this.table();
    if (!table) return [];
    return (await table.query().limit(limit).toArray()) as T[];
  }
}

/**
 * Reciprocal rank fusion.
 *
 * LanceDB has a hybrid mode, but it insists on owning the embedding step — it
 * needs an embedding function registered on the table so it can embed the query
 * string itself. Accepting that would fork embedding configuration away from
 * the provider settings the rest of the runtime uses, so the query stays ours
 * and the two result lists are fused here instead.
 *
 * RRF scores by rank rather than by score, which is the property that matters:
 * a BM25 score and a cosine distance are not on the same scale and normalising
 * them is guesswork, whereas "third in one list, first in the other" is
 * comparable without knowing anything about either.
 *
 * `k` damps the top of each list. 60 is the value from the original paper and
 * behaves well enough that tuning it should come after there is something to
 * measure against.
 */
export const fuse = <T extends Row>(
  lists: SearchHit<T>[][],
  keyColumn: string,
  limit: number,
  k = 60
): SearchHit<T>[] => {
  const scores = new Map<string, { hit: SearchHit<T>; score: number }>();

  for (const list of lists) {
    for (const hit of list) {
      const key = String(hit.row[keyColumn]);
      const existing = scores.get(key);
      const contribution = 1 / (k + hit.rank);

      if (existing) {
        existing.score += contribution;
      } else {
        scores.set(key, { hit, score: contribution });
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry, index) => ({
      row: entry.hit.row,
      rank: index + 1,
      score: entry.score
    }));
};
