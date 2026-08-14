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
import { chunkDocument, type Chunk } from '../retrieval/chunk.js';
import type { Embedder } from '../retrieval/embed.js';

export type ChunkRow = Chunk & { vector: number[] };

/**
 * A stored offer.
 *
 * Flat, and stringly-typed in two places on purpose. `skills` is a joined
 * string rather than a list so that it participates in the full-text index —
 * an Arrow list column is filterable but not searchable, and "does this offer
 * mention Postgres" is the question actually being asked. `analysis` is a JSON
 * blob because its shape belongs to whichever capability produced it, and
 * promoting those fields to columns would make every extraction-schema change a
 * table change.
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
  salary: string;
  contract_type: string;
  skills: string;
  /** The offer as read. Kept so a row can be re-analysed after it is taken down. */
  text: string;
  /** Structured analysis, serialised. */
  analysis: string;
  imported_at: string;
  vector: number[];
};

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export class Store {
  readonly documents: CvDocumentStore;
  readonly chunks: Collection<ChunkRow>;
  readonly offers: Collection<OfferRow>;

  constructor(private readonly embedder: Embedder) {
    this.documents = new CvDocumentStore();
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
    const known = new Set(existing.map((row) => row.id));

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
   */
  async searchProfile(query: string, limit = 8): Promise<SearchHit<ChunkRow>[]> {
    if (await this.chunks.count() === 0) return [];

    const vector = await this.embedder.one(query);

    const [semantic, lexical] = await Promise.all([
      this.chunks.searchByVector(vector, limit * 2),
      this.chunks.searchByText(query, limit * 2)
    ]);

    return fuse([semantic, lexical], 'id', limit);
  }

  /**
   * Stores offers, embedding the ones that are new.
   *
   * Embedding an offer buys near-duplicate detection — the same posting across
   * three boards — and "more like this one". It is explicitly not how offers
   * are *found*: that is filters and keywords, below.
   */
  async saveOffers(
    offers: Omit<OfferRow, 'vector' | 'imported_at'>[]
  ): Promise<number> {
    if (offers.length === 0) return 0;

    const vectors = await this.embedder.many(
      offers.map((offer) => `${offer.title} at ${offer.company}. ${offer.text}`.slice(0, 4000))
    );

    const imported_at = new Date().toISOString();

    return this.offers.upsert(
      offers.map((offer, index) => ({
        ...offer,
        vector: vectors[index] ?? [],
        imported_at
      }))
    );
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
