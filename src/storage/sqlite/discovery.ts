import { discoveryVisibility } from './discovery-visibility.js';
import { publishedContract, publishedSalaries } from '../../capabilities/offers/published.js';
import { parseSalary } from '../../capabilities/offers/salary.js';
import type { CatalogueItem, DiscoveryCatalogue, DiscoveryListing, OfferStore } from '../../contracts/index.js';
import { normaliseUrl, offerId } from '../../capabilities/offers/identity.js';
import type { Db } from './open.js';
import type { Enrichment } from '../../contracts/enrichment.js';
import { createIntegrationAcquisitions } from './integration-acquisitions.js';

type SourceRow = { source_key: string; offer_id: string; listing: string; retrieved_at: string; seen_at: number;
  first_observed_at: number | null; latest_observed_at: number | null; publication_date: string | null;
  publication_precision: 'instant' | 'date' | 'unknown'; activity: 'active' | 'inactive' | 'unknown';
  activity_reason: string; activity_checked_at: number | null };
const clean = (value?: string): string | undefined => value?.trim() || undefined;
const publication = (value?: string): { value?: string; precision: SourceRow['publication_precision'] } => {
  const candidate = clean(value);
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return { precision: 'unknown' };
  return { value: candidate, precision: /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? 'date' : 'instant' };
};
const activity = (validThrough: string | undefined, observedAt: number, previous?: SourceRow) => {
  const timestamp = validThrough ? Date.parse(validThrough) : Number.NaN;
  if (!Number.isFinite(timestamp)) return previous
    ? { status: previous.activity, reason: previous.activity_reason, checkedAt: previous.activity_checked_at ?? undefined }
    : { status: 'unknown' as const, reason: 'No source activity evidence is available.' };
  return timestamp < observedAt
    ? { status: 'inactive' as const, reason: 'The board-published validity date has passed.', checkedAt: observedAt }
    : { status: 'active' as const, reason: 'The board-published validity date has not passed.', checkedAt: observedAt };
};

export const createDiscoveryCatalogue = (db: Db, offers: OfferStore): DiscoveryCatalogue => {
  const acquisitions = createIntegrationAcquisitions(db);
  const visibility = discoveryVisibility(db);
  const sourceByKey = db.prepare<[string]>('SELECT * FROM discovery_sources WHERE source_key = ?');
  const sourceByUrl = db.prepare<[string, string]>('SELECT * FROM discovery_sources WHERE board = ? AND url = ?');
  const alias = db.prepare('SELECT offer_id FROM discovery_source_aliases WHERE board=? AND url=?');
  const saveAlias = db.prepare('INSERT INTO discovery_source_aliases(board,url,offer_id) VALUES(?,?,?) ON CONFLICT(board,url) DO NOTHING');
  const sourceForOffer = db.prepare<[string]>('SELECT * FROM discovery_sources WHERE offer_id = ? ORDER BY seen_at DESC LIMIT 1');
  const insert = db.prepare(`INSERT INTO discovery_sources(source_key, offer_id, board, url, listing, retrieved_at, seen_at,
      first_observed_at,latest_observed_at,publication_date,publication_precision,activity,activity_reason,activity_checked_at)
    VALUES(:key, :id, :board, :url, :listing, :retrievedAt, :seenAt,
      :firstObservedAt,:latestObservedAt,:publicationDate,:publicationPrecision,:activity,:activityReason,:activityCheckedAt)
    ON CONFLICT(source_key) DO UPDATE SET url=excluded.url, listing=excluded.listing,
      retrieved_at=excluded.retrieved_at, seen_at=excluded.seen_at,
      first_observed_at=coalesce(discovery_sources.first_observed_at,excluded.first_observed_at),
      latest_observed_at=max(coalesce(discovery_sources.latest_observed_at,0),excluded.latest_observed_at),
      publication_date=coalesce(excluded.publication_date,discovery_sources.publication_date),
      publication_precision=CASE WHEN excluded.publication_date IS NULL THEN discovery_sources.publication_precision ELSE excluded.publication_precision END,
      activity=excluded.activity,activity_reason=excluded.activity_reason,activity_checked_at=excluded.activity_checked_at`);
  const item = (id: string, boards: string[] = []): CatalogueItem => {
    const source = (boards.length ? db.prepare(`SELECT * FROM discovery_sources WHERE offer_id=? AND board IN (${boards.map(() => '?').join(',')}) ORDER BY seen_at DESC LIMIT 1`).get(id, ...boards) : sourceForOffer.get(id)) as SourceRow | undefined;
    const provenance = acquisitions.list(id);
    const enrichment = db.prepare('SELECT value FROM offer_enrichments WHERE offer_id=?').get(id) as { value: string } | undefined;
    const note = db.prepare('SELECT text, revision, updated_at AS updatedAt FROM offer_notes WHERE offer_id=?').get(id) as CatalogueItem['note'];
    const parsedEnrichment = enrichment ? JSON.parse(enrichment.value) as Enrichment : undefined;
    return { ...(provenance.length ? { acquisitions: provenance } : {}), ...(note ? { note } : {}), offer: offers.get(id)!, ...(parsedEnrichment ? { enrichment: parsedEnrichment } : {}), ...(source ? {
      listing: JSON.parse(source.listing) as DiscoveryListing, retrievedAt: source.retrieved_at,
      freshness: {
        publication: { ...(source.publication_date ? { value: source.publication_date } : {}), precision: source.publication_precision },
        firstObservedAt: source.first_observed_at ?? source.seen_at,
        latestObservedAt: source.latest_observed_at ?? source.seen_at,
        ...(parsedEnrichment?.detailsFetchedAt ? { detailsFetchedAt: parsedEnrichment.detailsFetchedAt } : {}),
        activity: { status: source.activity, reason: source.activity_reason, ...(source.activity_checked_at ? { checkedAt: source.activity_checked_at } : {}) }
      }
    } : {}) };
  };
  return {
    ingest: db.transaction((batch, seenAt) => {
      const ids = new Set<string>();
      for (const listing of batch.items) {
        const url = normaliseUrl(listing.url);
        if (!url) continue;
        const key = JSON.stringify([batch.board, clean(listing.external_id) ?? url]);
        const source = (sourceByKey.get(key) ?? sourceByUrl.get(batch.board, url)) as SourceRow | undefined;
        const previousAlias = alias.get(batch.board, url) as { offer_id: string } | undefined;
        const existing = source ? offers.get(source.offer_id) : previousAlias ? offers.get(previousAlias.offer_id) : offers.byUrl(url) ?? offers.byUrl(listing.url) ?? offers.get(offerId(url));
        const id = existing?.id ?? offerId(url);
        if (visibility.blacklisted(id)) continue;
        ids.add(id);
        if (source && Date.parse(source.retrieved_at) > Date.parse(batch.retrievedAt)) {
          acquisitions.record(id, batch.integration, batch.board, batch.retrievedAt, seenAt); continue;
        }
        // Listing sightings can fill gaps, but must never demote a fetched/rated
        // offer, erase its body/analysis, or change the person's disposition.
        const authoritative = !!clean(listing.description) && !!listing.adapter_id;
        const detailed = existing && existing.processing !== 'candidate' && !authoritative;
        const title = listing.titleSource === 'unavailable' ? undefined : clean(listing.title);
        const ranges = publishedSalaries(listing.salary_ranges);
        const published = Object.fromEntries(Object.entries({
          contract_type: publishedContract(listing.contract_type), employment_type: listing.employment_type,
          company_type: listing.company_type, company_size: listing.company_size, engagement_length: listing.engagement_length,
          apply_url: listing.apply_url, work_mode: listing.work_mode, extractor_version: listing.adapter_version ? `${listing.adapter_id}:${listing.adapter_version}` : undefined,
          posted_at: listing.posted_at, valid_through: listing.valid_through, salary_ranges: ranges
        }).filter(([,v])=>v!==undefined));
        const stated = detailed ? {...published,...existing.stated} : {...existing?.stated,...published};
        offers.sight([{
          stated, text: clean(listing.description),
          id, url, board: existing?.board ?? batch.board,
          position: detailed ? existing.position ?? title : (listing.titleSource === 'board' ? title : existing?.position ?? title),
          company: detailed ? existing.company ?? clean(listing.company) : clean(listing.company),
          location: detailed ? existing.location ?? clean(listing.location) : clean(listing.location),
          salary: detailed ? existing.salary ?? clean(listing.salary) : clean(listing.salary),
          contractType: detailed ? existing.contractType ?? publishedContract(listing.contract_type) : publishedContract(listing.contract_type),
          salaryReading: detailed ? existing.salaryReading : ranges?.length === 1 ? ranges[0] : ranges?.length ? undefined : listing.salary ? parseSalary(listing.salary) : undefined,
          skills: listing.required_skills?.length ? [...new Set([...(existing?.skills ?? []), ...listing.required_skills])] : undefined
        }], Math.max(seenAt, existing?.lastSeenAt ?? 0));
        if (!detailed && ranges && ranges.length > 1) offers.save({ ...offers.get(id)!, salaryReading: undefined });
        if (authoritative) {
          const current = offers.get(id)!;
          offers.save({ ...current, text: listing.description!.trim() });
          {
            const prior = db.prepare('SELECT value FROM offer_enrichments WHERE offer_id=?').get(id) as { value: string } | undefined;
            const previous = prior ? JSON.parse(prior.value) as Enrichment : undefined;
            const capturedAt = Date.parse(batch.retrievedAt);
            const enrichment: Enrichment = { ...previous, offerId: id, id: previous?.id ?? `source:${id}`,
              status: previous?.status ?? 'idle', updatedAt: seenAt, detailsFetchedAt: capturedAt,
              extractorVersion: `listing:${listing.adapter_id}:${listing.adapter_version ?? '1'}`,
              details: { id: `source:${id}`, status: 'succeeded', fetchedAt: capturedAt, updatedAt: seenAt, requested: false } };
            db.prepare('INSERT INTO offer_enrichments(offer_id,value) VALUES(?,?) ON CONFLICT(offer_id) DO UPDATE SET value=excluded.value').run(id, JSON.stringify(enrichment));
          }

        }
        saveAlias.run(batch.board, url, id);
        acquisitions.record(id, batch.integration, batch.board, batch.retrievedAt, seenAt);
        const previous = source ? JSON.parse(source.listing) as DiscoveryListing : undefined;
        const merged = { ...previous, ...Object.fromEntries(Object.entries(listing).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))) };
        // Provisional labels do not replace an already observed actual title.
        if (previous?.titleSource === 'board' && listing.titleSource !== 'board') {
          merged.title = previous.title; merged.titleSource = previous.titleSource;
        }
        const publicationEvidence = publication(merged.posted_at ?? existing?.stated?.posted_at);
        const sourceActivity = activity(merged.valid_through ?? existing?.stated?.valid_through, seenAt, source);
        insert.run({ key: source?.source_key ?? key, id, board: batch.board, url, listing: JSON.stringify(merged), retrievedAt: batch.retrievedAt, seenAt,
          firstObservedAt: source?.first_observed_at ?? seenAt, latestObservedAt: Math.max(source?.latest_observed_at ?? 0, seenAt),
          publicationDate: publicationEvidence.value ?? null, publicationPrecision: publicationEvidence.precision,
          activity: sourceActivity.status, activityReason: sourceActivity.reason, activityCheckedAt: sourceActivity.checkedAt ?? null });
      }
      return [...ids].map(id => item(id, [batch.board]));
    }).immediate,
    search(query) {
      // Quoted literal terms; user input never becomes FTS operators or SQL.
      const terms = query.keyword.match(/[\p{L}\p{N}+#.]+/gu)?.filter((term) => /[\p{L}\p{N}]/u.test(term)) ?? [];
      if (!terms.length || !query.boards.length) return { items: [], hasMore: false, nextOffset: null };
      const literal = terms.map((term) => `"${term}"`).join(' AND ');
      // Generated analysis is deliberately excluded from qualification. Title
      // mode is an eligibility boundary, not merely a BM25 weight.
      const match = query.matchMode === 'title'
        ? `position : (${literal})`
        : `{position skills company location text} : (${literal})`;
      const rows = db.prepare(`SELECT o.id FROM discovery_fts JOIN offers o ON o.rowid=discovery_fts.rowid
        WHERE ${visibility.sql('o.id')} AND discovery_fts MATCH ? AND (o.board IN (${query.boards.map(() => '?').join(',')})
          OR EXISTS(SELECT 1 FROM discovery_sources s WHERE s.offer_id=o.id AND s.board IN (${query.boards.map(() => '?').join(',')})))
        ORDER BY bm25(discovery_fts, 8, 6, 3, 2, 1, 1), o.last_seen_at DESC, o.id
        LIMIT ? OFFSET ?`).all(match, ...query.boards, ...query.boards, query.limit + 1, query.offset) as { id: string }[];
      const hasMore = rows.length > query.limit;
      return { items: rows.slice(0, query.limit).map((row) => item(row.id, query.boards)), hasMore, nextOffset: hasMore ? query.offset + query.limit : null };
    }
  };
};
