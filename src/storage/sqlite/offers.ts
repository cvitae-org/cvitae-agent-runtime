/**
 * Offers, stored as canonical rows.
 *
 * Not a search index that happens to hold the only copy. In the previous
 * runtime an offer's text and its analysis existed nowhere but inside the
 * vector store, while the rebuild path regenerated CV chunks and not offers —
 * so "the index is derived and can be rebuilt at any time" was true of half the
 * data and quietly false of the rest. The FTS table beside this one is derived,
 * is populated by triggers, and can be dropped and rebuilt from these rows.
 */

import type { OfferRecord, OfferStore, StatedFacts, WorkMode } from '../../contracts/index.js';
import { isWorkMode } from '../../contracts/index.js';
import type { Db } from './open.js';
import { foldForSearch, packJson, unpackJson } from './rows.js';

type OfferRow = {
  id: string;
  url: string | null;
  final_url: string | null;
  board: string | null;
  company: string | null;
  position: string | null;
  location: string | null;
  work_mode: string | null;
  text: string;
  stated: string | null;
  analysis: string | null;
  run_id: string | null;
  imported_at: number;
};

const toOffer = (row: OfferRow): OfferRecord => ({
  id: row.id,
  url: row.url ?? undefined,
  finalUrl: row.final_url ?? undefined,
  board: row.board ?? undefined,
  company: row.company ?? undefined,
  position: row.position ?? undefined,
  location: row.location ?? undefined,
  workMode: isWorkMode(row.work_mode) ? (row.work_mode as WorkMode) : undefined,
  text: row.text,
  stated: unpackJson(row.stated) as StatedFacts | undefined,
  analysis: unpackJson(row.analysis),
  runId: row.run_id ?? undefined,
  importedAt: row.imported_at
});

export const createOfferStore = (db: Db): OfferStore => {
  const upsert = db.prepare(
    `INSERT INTO offers
       (id, url, final_url, board, company, position, location, work_mode,
        text, search_text, stated, analysis, run_id, imported_at)
     VALUES
       (:id, :url, :finalUrl, :board, :company, :position, :location, :workMode,
        :text, :searchText, :stated, :analysis, :runId, :importedAt)
     ON CONFLICT (id) DO UPDATE SET
       url = excluded.url, final_url = excluded.final_url, board = excluded.board,
       company = excluded.company, position = excluded.position,
       location = excluded.location, work_mode = excluded.work_mode,
       text = excluded.text, search_text = excluded.search_text,
       stated = excluded.stated, analysis = excluded.analysis,
       run_id = excluded.run_id`
  );

  const byId = db.prepare<[string]>('SELECT * FROM offers WHERE id = ?');
  const byUrl = db.prepare<[string]>('SELECT * FROM offers WHERE url = ?');
  const recent = db.prepare<[number]>(
    'SELECT * FROM offers ORDER BY imported_at DESC LIMIT ?'
  );

  const search = db.prepare<[string, number]>(
    `SELECT o.* FROM offers_fts
       JOIN offers o ON o.rowid = offers_fts.rowid
      WHERE offers_fts MATCH ?
      ORDER BY bm25(offers_fts)
      LIMIT ?`
  );

  return {
    get(id) {
      const row = byId.get(id) as OfferRow | undefined;
      return row ? toOffer(row) : undefined;
    },

    byUrl(url) {
      const row = byUrl.get(url) as OfferRow | undefined;
      return row ? toOffer(row) : undefined;
    },

    recent(limit) {
      return (recent.all(limit) as OfferRow[]).map(toOffer);
    },

    save(offer) {
      upsert.run({
        id: offer.id,
        url: offer.url ?? null,
        finalUrl: offer.finalUrl ?? null,
        board: offer.board ?? null,
        company: offer.company ?? null,
        position: offer.position ?? null,
        location: offer.location ?? null,
        workMode: offer.workMode ?? null,
        text: offer.text,
        searchText: foldForSearch(offer.text),
        stated: packJson(offer.stated),
        analysis: packJson(offer.analysis),
        runId: offer.runId ?? null,
        importedAt: offer.importedAt
      });
      return offer;
    },

    search(text, limit) {
      const match = foldForSearch(text)
        .split(/\s+/u)
        .map((token) => token.replace(/["]/gu, ''))
        .filter((token) => token.length > 0)
        .map((token) => `"${token}"`)
        .join(' OR ');

      if (match.length === 0) return [];
      return (search.all(match, limit) as OfferRow[]).map(toOffer);
    }
  };
};
