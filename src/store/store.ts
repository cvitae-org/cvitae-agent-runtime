/**
 * Everything the runtime can read or write, behind one object.
 *
 * Tools receive this through the run context. The model never does — it sees
 * only what a tool chooses to return, which is what makes "user data stays
 * local" a property of the wiring rather than a rule someone has to follow.
 *
 * The split between the two halves is authored versus derived. `cv.json` is the
 * source of truth and the only thing whose loss matters; the LanceDB tables are
 * rebuildable from it and from stored offer text, so `reindex()` is always a
 * legitimate repair and never a migration.
 */

import { Collection, fuse, type SearchHit } from './lance.js';
import { CvDocumentStore, type CvDocument } from './cvDocument.js';
import {
  OfferRecordStore,
  dispositions,
  processingStates,
  type OfferRecord,
  type OfferSighting
} from './offerRecord.js';
import { chunkDocument, chunkKinds, type Chunk, type ChunkKind } from '../retrieval/chunk.js';
import { fingerprint } from '../core/fingerprint.js';
import type { Embedder } from '../retrieval/embed.js';

export type ChunkRow = Chunk & { vector: number[] };

/**
 * The queryable projection of an offer. Derived, and rebuildable.
 *
 * Not the record — that lives in `offers.jsonl`. This is only what gets
 * filtered, ranked or displayed, which is why `analysis` and `score_detail` are
 * absent: both are blobs nobody queries, and carrying them here would make
 * every extraction-schema change a table change for no gain.
 *
 * Three encodings are worth explaining, because all three look like mistakes:
 *
 *   `skills` is a joined string rather than a list, so that it participates in
 *   the full-text index. An Arrow list column is filterable but not searchable,
 *   and "does this offer mention Postgres" is the question actually being asked.
 *
 *   `salary_min`/`salary_max` use 0 for unstated where the record uses `null`,
 *   and `fit`/`completeness` use -1 for unrated. LanceDB infers the Arrow schema
 *   from the first batch written, so a first round in which nothing states a
 *   salary would infer a Null-typed column and reject every later number with a
 *   cast error. The sentinels keep the column numeric from the first write.
 *
 *   Nothing is lost by that, because the sentinel is never the thing consulted:
 *   an unstated salary has `salary_currency = ''`, and a salary floor is always
 *   asked within a currency — `salary_min >= 15000 AND salary_currency = 'PLN'`
 *   excludes the unstated rows without ever comparing against the 0. Likewise
 *   `eligibility = 'unrated'` is the real signal, not the -1.
 */
export type OfferRow = {
  id: string;
  url: string;
  board: string;
  title: string;
  company: string;
  location: string;
  work_mode: string;
  seniority: string;
  contract_type: string;
  /** As the posting stated it. For display; the numerics are for predicates. */
  salary: string;
  salary_min: number;
  salary_max: number;
  salary_currency: string;
  salary_period: string;
  skills: string;
  /** The offer as read. Copied from the record so BM25 has something to index. */
  text: string;
  processing: string;
  disposition: string;
  eligibility: string;
  fit: number;
  completeness: number;
  first_seen_at: string;
  last_seen_at: string;
  /**
   * Fingerprint of `text`, so a rebuild re-embeds only postings that changed.
   *
   * The chunk table gets this for free — its ids *are* content fingerprints —
   * but an offer is keyed by its URL and its text changes when the posting is
   * edited, so the two have to be tracked separately. Doubles as the marker for
   * a table written by an older build: a row without it predates this schema.
   */
  text_fp: string;
  vector: number[];
};

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** The record, flattened to the columns worth querying. */
const project = (record: OfferRecord): Omit<OfferRow, 'vector'> => ({
  id: record.id,
  url: record.url,
  board: record.board,
  title: record.title,
  company: record.company,
  location: record.location,
  work_mode: record.work_mode,
  seniority: record.seniority,
  contract_type: record.contract_type,
  salary: record.salary,
  salary_min: record.salary_min ?? 0,
  salary_max: record.salary_max ?? 0,
  salary_currency: record.salary_currency,
  salary_period: record.salary_period,
  skills: record.skills.join(', '),
  text: record.text,
  processing: record.processing,
  disposition: record.disposition,
  eligibility: record.eligibility,
  fit: record.fit ?? -1,
  completeness: record.completeness ?? -1,
  first_seen_at: record.first_seen_at,
  last_seen_at: record.last_seen_at,
  text_fp: fingerprint(record.text)
});

/** What gets embedded for an offer. Bounded, because postings run long. */
const embeddable = (record: OfferRecord): string =>
  `${record.title} at ${record.company}. ${record.text}`.slice(0, 4000);

export class Store {
  /** Authored: the CV. */
  readonly documents: CvDocumentStore;
  /** Authored: the postings seen, and what the user decided about each. */
  readonly offerRecords: OfferRecordStore;
  /** Derived: embeddings of the CV's retrievable parts. */
  readonly chunks: Collection<ChunkRow>;
  /** Derived: the queryable projection of `offerRecords`. */
  readonly offers: Collection<OfferRow>;

  constructor(private readonly embedder: Embedder) {
    this.documents = new CvDocumentStore();
    this.offerRecords = new OfferRecordStore();
    this.chunks = new Collection<ChunkRow>('chunks', 'id', ['text']);
    this.offers = new Collection<OfferRow>('offers', 'id', ['text']);
  }

  /**
   * Rebuilds the chunk index from the document.
   *
   * Only chunks whose id is absent get embedded — ids are content-derived, so
   * an unchanged bullet keeps its row and costs nothing. Rows that no longer
   * correspond to anything in the document are deleted, which is what keeps a
   * deleted bullet from being retrieved and cited months later.
   */
  async reindex(document?: CvDocument): Promise<{
    embedded: number;
    removed: number;
    total: number;
  }> {
    const source = document ?? (await this.documents.read());
    const wanted = chunkDocument(source);

    const existing = await this.chunks.all(10_000);

    // A row written by an older chunker carries a `kind` this build no longer
    // uses, and nothing else would ever fix it: ids are content-derived, so an
    // unchanged bullet is never re-upserted and keeps whatever metadata it was
    // first written with. That stale value is invisible until something filters
    // on `kind` and silently matches nothing. Treating the whole table as
    // unknown rebuilds it, which the index is allowed to cost — every byte of
    // it is derived, and this is exactly the case `reindex` exists to repair.
    const vocabulary = new Set<string>(chunkKinds);
    const outdated = existing.some((row) => !vocabulary.has(row.kind));

    const known = outdated ? new Set<string>() : new Set(existing.map((row) => row.id));

    const missing = wanted.filter((chunk) => !known.has(chunk.id));

    if (missing.length > 0) {
      const vectors = await this.embedder.many(missing.map((chunk) => chunk.text));

      await this.chunks.upsert(
        missing.map((chunk, index) => ({ ...chunk, vector: vectors[index] ?? [] }))
      );
    }

    const keep = new Set(wanted.map((chunk) => chunk.id));
    const stale = existing.filter((row) => !keep.has(row.id));

    if (stale.length > 0) {
      await this.chunks.delete(
        `id IN (${stale.map((row) => quote(row.id)).join(', ')})`
      );
    }

    return { embedded: missing.length, removed: stale.length, total: wanted.length };
  }

  /**
   * Finds the parts of the CV most relevant to a piece of text — in practice, a
   * job offer. Hybrid, because the two halves fail differently: the keyword arm
   * catches an exact technology the offer names, and the vector arm catches the
   * bullet that describes the same work in different words.
   *
   * `kinds` narrows what is eligible. Omitted, the whole CV is searchable, which
   * is what an open-ended question wants. A caller that has already stated the
   * skill list and the job titles in its own prompt passes the subset that adds
   * something — see `DRAFTING_KINDS` in `retrieval/chunk.ts`.
   */
  async searchProfile(
    query: string,
    limit = 8,
    kinds?: ChunkKind[]
  ): Promise<SearchHit<ChunkRow>[]> {
    if (await this.chunks.count() === 0) return [];

    // A hard predicate rather than post-filtering the hits, for the same reason
    // `searchOffers` splits `where` from `query`: filtering afterwards asks for
    // `limit` rows and then throws some away, so a caller that wanted eight
    // bullets gets three because five job titles outranked them.
    const where =
      kinds && kinds.length > 0
        ? `kind IN (${kinds.map(quote).join(', ')})`
        : undefined;

    const vector = await this.embedder.one(query);

    const [semantic, lexical] = await Promise.all([
      this.chunks.searchByVector(vector, limit * 2, where),
      this.chunks.searchByText(query, limit * 2, where)
    ]);

    return fuse([semantic, lexical], 'id', limit);
  }

  /**
   * Records offers a round saw, then indexes them.
   *
   * The ordering is the crash story, and it is the reason the split was worth
   * making: the authored file is written first, so a failure between the two
   * steps leaves the records intact and the index stale — and a stale index is
   * repaired by `reindexOffers()`, which is allowed to cost whatever it costs.
   * The reverse order would lose postings.
   *
   * Embedding an offer buys near-duplicate detection — the same posting across
   * three boards — and "more like this one". It is explicitly not how offers
   * are *found*: that is filters and keywords, below.
   */
  async saveOffers(sightings: OfferSighting[]): Promise<{
    added: number;
    updated: number;
    embedded: number;
  }> {
    if (sightings.length === 0) return { added: 0, updated: 0, embedded: 0 };

    const { added, updated, records } = await this.offerRecords.sight(sightings);
    const embedded = await this.indexOffers(records);

    return { added, updated, embedded };
  }

  /**
   * Writes rows for these records, embedding only the ones whose text changed.
   *
   * A round that re-sees forty offers to bump `last_seen_at` should cost zero
   * embeddings, so the existing `text_fp` is consulted first. A row whose text
   * is unchanged keeps the vector it already has rather than paying for an
   * identical one — the same economy the chunk table gets from content-derived
   * ids.
   */
  private async indexOffers(records: OfferRecord[]): Promise<number> {
    if (records.length === 0) return 0;

    const existing = await this.offers.all(10_000);

    // `Array.from` rather than the value as returned: LanceDB hands back Arrow
    // typed arrays, and one written straight back through `mergeInsert` is a
    // different thing from the `number[]` the column was inferred as. Copying
    // here is cheap and keeps the round trip lossless.
    const known = new Map(
      existing.map((row) => [
        row.id,
        { fp: row.text_fp, vector: Array.from(row.vector ?? []) as number[] }
      ])
    );

    const byId = new Map(records.map((record) => [record.id, record]));
    const rows = records.map(project);

    // Every touched row is rewritten, because `last_seen_at` changed on all of
    // them — but only the ones whose text actually moved are re-embedded.
    const stale = rows.filter((row) => known.get(row.id)?.fp !== row.text_fp);

    const fresh =
      stale.length > 0
        ? await this.embedder.many(
            stale.map((row) => embeddable(byId.get(row.id) as OfferRecord))
          )
        : [];

    const embedded = new Map(stale.map((row, index) => [row.id, fresh[index] ?? []]));

    await this.offers.upsert(
      rows.map((row) => ({
        ...row,
        vector: embedded.get(row.id) ?? known.get(row.id)?.vector ?? []
      }))
    );

    return stale.length;
  }

  /**
   * Rebuilds the offer index from `offers.jsonl`.
   *
   * The counterpart to `reindex()` for chunks, and legitimate for the same
   * reason: every column here is a projection of an authored record, so this is
   * a repair rather than a migration. It is also the upgrade path — a table
   * written by an older build is detected and rebuilt rather than left to
   * silently mismatch a predicate.
   */
  async reindexOffers(): Promise<{
    embedded: number;
    removed: number;
    total: number;
  }> {
    const records = await this.offerRecords.all();
    const existing = await this.offers.all(10_000);

    // Two kinds of drift, both invisible until a query returns the wrong thing.
    // A row with no `text_fp` predates this schema entirely; a row carrying a
    // state this build no longer knows was written by a different vocabulary.
    // Either way the safe read is that nothing in the table can be trusted to
    // still mean what it says, and rebuilding is what the index is for.
    const states = new Set<string>(processingStates);
    const decisions = new Set<string>(dispositions);

    const outdated = existing.some(
      (row) =>
        typeof row.text_fp !== 'string' ||
        !states.has(row.processing) ||
        !decisions.has(row.disposition)
    );

    if (outdated && existing.length > 0) {
      await this.offers.delete(`id IN (${existing.map((row) => quote(row.id)).join(', ')})`);
    }

    const embedded = await this.indexOffers(records);

    // Rows for records that are gone. Deleting an offer from `offers.jsonl` by
    // hand is a supported way to forget one, and it has to reach the index or
    // the offer keeps coming back in search results.
    const keep = new Set(records.map((record) => record.id));
    const orphans = outdated ? [] : existing.filter((row) => !keep.has(row.id));

    if (orphans.length > 0) {
      await this.offers.delete(`id IN (${orphans.map((row) => quote(row.id)).join(', ')})`);
    }

    return { embedded, removed: orphans.length, total: records.length };
  }

  /**
   * Finds offers.
   *
   * The signature encodes the conclusion that structured predicates come first:
   * `where` is a hard filter applied by LanceDB before ranking, and `query` only
   * orders what survives it. Ranking a mid-level onsite role highly because it
   * reads like a senior remote one is not a fuzzy match, it is a wrong answer,
   * and a filter is the only thing that reliably prevents it.
   *
   * With no `query`, this is a filtered list in insertion order — which is the
   * right result for "show me every remote React offer over 20k" and needs no
   * model at all.
   */
  async searchOffers({
    query,
    where,
    limit = 20,
    semantic = true
  }: {
    query?: string;
    where?: string;
    limit?: number;
    semantic?: boolean;
  }): Promise<SearchHit<OfferRow>[]> {
    if (await this.offers.count() === 0) return [];

    if (!query) {
      const rows = await (where
        ? this.offers.filter(where, limit)
        : this.offers.all(limit));

      return rows.map((row, index) => ({ row, rank: index + 1, score: 0 }));
    }

    const lexical = await this.offers.searchByText(query, limit * 2, where);

    if (!semantic) return lexical.slice(0, limit);

    const vector = await this.embedder.one(query);
    const dense = await this.offers.searchByVector(vector, limit * 2, where);

    return fuse([lexical, dense], 'id', limit);
  }
}
