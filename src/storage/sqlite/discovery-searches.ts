import { discoveryVisibility } from './discovery-visibility.js';
import { createOpportunityStore } from './opportunities.js';
import { groupOpportunities } from './opportunity-projection.js';
import { discoveryFilter } from './discovery-filter.js';
import { discoveryEvidenceSchema, discoveryFiltersSchema } from '../../contracts/discovery-search.js';
import type { CatalogueItem, DiscoveryBudget, DiscoveryRequestUsage } from '../../contracts/discovery.js';
import { createHash } from 'node:crypto';
import { OperationError } from '../../contracts/operation-error.js';
import { discoveryImportSchema, discoverySearchBatchSchema, discoveryImportBatchSchema, discoveryImportIdentitySchema,
  discoverySearchPageSchema, type DiscoveryImportReceipt, type DiscoveryEvidence } from '../../contracts/discovery-search.js';
import type { Enrichment } from '../../contracts/enrichment.js';
import type { OfferRecord, OfferStore } from '../../contracts/offer.js';
import type { Db } from './open.js';

type Row = { id: string; import_key: string; manifest: string; status: 'importing' | 'ready';
  received: number; row_count: number; revision: number; filter_revision: number; current_filters: string | null };
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const receipt = (r: Row): DiscoveryImportReceipt => ({ id: r.id, importKey: r.import_key,
  nextOffset: r.received, rowCount: r.row_count, status: r.status, revision: r.revision });
const conflict = (message: string): never => { throw new OperationError('search_conflict', message); };

/** Imports never write over an existing canonical offer or touch private notes.
 * Historical public evidence is content-addressed and belongs to the membership,
 * so a later enrichment cannot rewrite the saved result that was imported.
 */
export const createDiscoverySearchStore = (db: Db, offers: OfferStore, now = Date.now) => {
  const visibility = discoveryVisibility(db);
  const opportunities=createOpportunityStore(db,now);
  // Upgrade fixtures intentionally construct this store before later migrations.
  // Normal runtime startup always migrates first.
  const hasRequestLedger = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='discovery_search_request_usage'").get();
  const get = (id: string): Row => {
    const row = db.prepare('SELECT * FROM discovery_searches WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new OperationError('search_not_found', 'Saved search does not exist.');
    return row;
  };
  const checked = (id: string, key: string): Row => {
    const row = get(id);
    if (row.import_key !== key) conflict('This search belongs to a different import.');
    return row;
  };
  const requestUsage = (row: Row): DiscoveryRequestUsage => {
    const usage = hasRequestLedger ? db.prepare('SELECT search_requests AS search,detail_requests AS details FROM discovery_search_request_usage WHERE search_id=?').get(row.id) as { search: number; details: number } | undefined : undefined;
    const manifest = discoveryImportSchema.parse(JSON.parse(row.manifest));
    const search = usage?.search ?? 0, details = usage?.details ?? 0, total = search + details, limit = manifest.budget.maxRequestsTotal;
    return { search, details, total, limit, remaining: Math.max(0, limit - total), exhausted: total >= limit };
  };
  const summary = (row: Row) => ({ ...discoveryImportSchema.parse(JSON.parse(row.manifest)), ...receipt(row), requestUsage: requestUsage(row),
    filters: discoveryFiltersSchema.parse(row.current_filters ? JSON.parse(row.current_filters) : JSON.parse(row.manifest).filters), filterRevision: row.filter_revision,
    count: (db.prepare(`SELECT count(*) AS n FROM discovery_search_members m WHERE search_id=? AND ${visibility.sql('m.offer_id','m.search_id')}`).get(row.id) as { n: number }).n,
    reviewCount: (db.prepare(`SELECT count(*) AS n FROM discovery_search_review_members m WHERE search_id=? AND ${visibility.sql('m.offer_id','m.search_id')}`).get(row.id) as { n: number }).n });
  return {
    createBatch: db.transaction((raw: unknown) => {
      const input = discoverySearchBatchSchema.parse(raw);
      return { items: input.children.map(({ id, ...boardThread }) => {
        const manifest = discoveryImportSchema.parse({
          id, importKey: 'native', phrase: input.phrase, boards: [boardThread.boardId],
          boardThread, filters: {}, rowCount: 0, sourceMode: boardThread.mode === 'browser' ? 'cache' : 'live',
          matchMode: input.matchMode, activity: input.activity, maxPublishedAgeDays: input.maxPublishedAgeDays,
          budget: input.budget, matchingPolicyVersion: 'discovery-match-v2'
        });
        if (db.prepare('SELECT 1 FROM discovery_search_tombstones WHERE id=?').get(id)) conflict('Search was deleted.');
        const previous = db.prepare('SELECT * FROM discovery_searches WHERE id=?').get(id) as Row | undefined;
        if (previous) {
          if (JSON.stringify(discoveryImportSchema.parse(JSON.parse(previous.manifest))) !== JSON.stringify(manifest)) conflict('Search ID belongs to another query.');
          return summary(previous);
        }
        db.prepare("INSERT INTO discovery_searches(id,import_key,manifest,status,row_count,revision,created_at,updated_at) VALUES(?,?,?,'ready',0,1,?,?)")
          .run(id, 'native', JSON.stringify(manifest), now(), now());
        if (hasRequestLedger) db.prepare('INSERT INTO discovery_search_request_usage(search_id,updated_at) VALUES(?,?)').run(id, now());
        return summary(get(id));
      }) };
    }).immediate,
    create: db.transaction((id: string, phrase: string, boards: string[], semantics?: { kind?: 'search' | 'browser_import'; sourceMode: 'live' | 'cache' | 'hybrid'; matchMode: 'title' | 'anywhere'; matchingPolicyVersion: string; unknownPolicy?: 'separate'; activity?: 'exclude_explicitly_inactive' | 'any'; maxPublishedAgeDays?: number | null; budget?: DiscoveryBudget }) => {
      const input = discoveryImportSchema.parse({ id, importKey: 'native', phrase, boards, filters: {}, rowCount: 0, ...semantics });
      if (db.prepare('SELECT 1 FROM discovery_search_tombstones WHERE id=?').get(id)) conflict('Search was deleted.');
      const previous = db.prepare('SELECT * FROM discovery_searches WHERE id=?').get(id) as Row | undefined;
      if (previous) {
        const manifest = discoveryImportSchema.parse(JSON.parse(previous.manifest));
        if (manifest.phrase !== input.phrase || JSON.stringify(manifest.boards) !== JSON.stringify(input.boards) ||
          manifest.sourceMode !== input.sourceMode || manifest.matchMode !== input.matchMode ||
          manifest.unknownPolicy !== input.unknownPolicy || manifest.activity !== input.activity || manifest.maxPublishedAgeDays !== input.maxPublishedAgeDays ||
          JSON.stringify(manifest.budget) !== JSON.stringify(input.budget) ||
          manifest.matchingPolicyVersion !== input.matchingPolicyVersion) conflict('Search ID belongs to another query.');
        return summary(previous);
      }
      db.prepare(`INSERT INTO discovery_searches(id,import_key,manifest,status,row_count,revision,created_at,updated_at)
        VALUES(?,?,?,'ready',0,1,?,?)`).run(id,'native',JSON.stringify(input),now(),now());
      if (hasRequestLedger) db.prepare('INSERT INTO discovery_search_request_usage(search_id,updated_at) VALUES(?,?)').run(id,now());
      return summary(get(id));
    }).immediate,
    refetch: db.transaction((id: string, reset: boolean) => {
      const row = get(id);
      if (row.status !== 'ready') conflict('Search is not ready.');
      const manifest = discoveryImportSchema.parse(JSON.parse(row.manifest));
      if (manifest.kind === 'browser_import' || manifest.boardThread?.mode === 'browser') throw new OperationError('browser_capture_required', 'Use the browser extension to add or refresh these jobs.');
      if (reset) {
        db.prepare('DELETE FROM discovery_search_members WHERE search_id=?').run(id);
        db.prepare('DELETE FROM discovery_search_review_members WHERE search_id=?').run(id);
      }
      // Each explicit fetch gets a fresh request budget. Keep immutable evidence
      // and chat history; other searches and canonical offers are unaffected.
      if (hasRequestLedger) db.prepare('UPDATE discovery_search_request_usage SET search_requests=0,detail_requests=0,updated_at=? WHERE search_id=?').run(now(),id);
      db.prepare('UPDATE discovery_searches SET manifest=?,revision=revision+1,updated_at=? WHERE id=?')
        .run(JSON.stringify({...manifest,sourceMode:'live'}),now(),id);
      return summary(get(id));
    }).immediate,
    reserveRequest: db.transaction((id: string, kind: 'search' | 'detail') => {
      const row = get(id);
      if (row.status !== 'ready') conflict('Search is not ready.');
      if (!hasRequestLedger) return true;
      const usage = requestUsage(row);
      if (usage.exhausted) return false;
      const column = kind === 'search' ? 'search_requests' : 'detail_requests';
      db.prepare(`UPDATE discovery_search_request_usage SET ${column}=${column}+1,updated_at=? WHERE search_id=?`).run(now(),id);
      return true;
    }).immediate,
    refundRequest: db.transaction((id: string, kind: 'search' | 'detail') => {
      get(id);
      if (!hasRequestLedger) return;
      const column = kind === 'search' ? 'search_requests' : 'detail_requests';
      db.prepare(`UPDATE discovery_search_request_usage SET ${column}=max(0,${column}-1),updated_at=? WHERE search_id=?`).run(now(),id);
    }).immediate,
    requestUsage: (id: string) => requestUsage(get(id)),
    add: db.transaction((id: string, items: readonly CatalogueItem[]) => {
      const row = get(id); if (row.status !== 'ready') conflict('Search is not ready.');
      let ordinal = (db.prepare('SELECT coalesce(max(ordinal),-1)+1 AS n FROM discovery_search_members WHERE search_id=?').get(id) as { n: number }).n;
      let reviewOrdinal = (db.prepare('SELECT coalesce(max(ordinal),-1)+1 AS n FROM discovery_search_review_members WHERE search_id=?').get(id) as { n: number }).n;
      let changed = false; let added = 0; let reviewAdded = 0;
      for (const raw of items) {
        if (visibility.suppressed(id,raw.offer.id)) continue;
        const item = discoveryEvidenceSchema.parse(raw), value = JSON.stringify(item), evidenceId = digest(value);
        const review = item.qualification?.decision === 'unknown';
        const table = review ? 'discovery_search_review_members' : 'discovery_search_members';
        const other = review ? 'discovery_search_members' : 'discovery_search_review_members';
        const prior = db.prepare(`SELECT evidence_id FROM ${table} WHERE search_id=? AND offer_id=?`).get(id,item.offer.id) as { evidence_id: string } | undefined;
        if (prior?.evidence_id === evidenceId) continue;
        if (!prior) {
          if (review) reviewAdded++;
          else added++;
        }
        db.prepare('INSERT OR IGNORE INTO discovery_offer_evidence(id,offer_id,value) VALUES(?,?,?)').run(evidenceId,item.offer.id,value);
        db.prepare(`DELETE FROM ${other} WHERE search_id=? AND offer_id=?`).run(id,item.offer.id);
        const nextOrdinal = review ? reviewOrdinal++ : ordinal++;
        db.prepare(`INSERT INTO ${table}(search_id,offer_id,ordinal,evidence_id) VALUES(?,?,?,?)
          ON CONFLICT(search_id,offer_id) DO UPDATE SET evidence_id=excluded.evidence_id`).run(id,item.offer.id,nextOrdinal,evidenceId);
        changed = true;
      }
      if (changed) db.prepare('UPDATE discovery_searches SET revision=revision+1,updated_at=? WHERE id=?').run(now(),id);
      return {...summary(get(id)), added, reviewAdded};
    }).immediate,
    filters: db.transaction((id: string, raw: unknown, revision: number) => {
      const row = get(id), filters = discoveryFiltersSchema.parse(raw), value = JSON.stringify(filters);
      if (JSON.stringify(summary(row).filters) === value) return summary(row);
      if (row.filter_revision !== revision) conflict('Search filters changed. Reload this search.');
      db.prepare('UPDATE discovery_searches SET current_filters=?,filter_revision=filter_revision+1,updated_at=? WHERE id=?').run(value,now(),id);
      return summary(get(id));
    }).immediate,
    refreshOffer: db.transaction((offer: OfferRecord, enrichment: Enrichment) => {
      const refreshedAt = now();
      const published = offer.stated?.posted_at?.trim();
      const validThrough = offer.stated?.valid_through?.trim();
      const validTimestamp = validThrough ? Date.parse(validThrough) : Number.NaN;
      if (published && Number.isFinite(Date.parse(published))) {
        db.prepare(`UPDATE discovery_sources SET publication_date=?,publication_precision=? WHERE offer_id=?`)
          .run(published, /^\d{4}-\d{2}-\d{2}$/.test(published) ? 'date' : 'instant', offer.id);
      }
      if (Number.isFinite(validTimestamp)) {
        const inactive = validTimestamp < refreshedAt;
        db.prepare(`UPDATE discovery_sources SET activity=?,activity_reason=?,activity_checked_at=? WHERE offer_id=?`)
          .run(inactive ? 'inactive' : 'active', inactive ? 'The board-published validity date has passed.' : 'The board-published validity date has not passed.', refreshedAt, offer.id);
      }
      const members = db.prepare(`SELECT m.search_id,e.value FROM discovery_search_members m JOIN discovery_offer_evidence e ON e.id=m.evidence_id WHERE m.offer_id=?`).all(offer.id) as { search_id: string; value: string }[];
      const reviewMembers = db.prepare(`SELECT m.search_id,e.value FROM discovery_search_review_members m JOIN discovery_offer_evidence e ON e.id=m.evidence_id WHERE m.offer_id=?`).all(offer.id) as { search_id: string; value: string }[];
      const insert = db.prepare('INSERT OR IGNORE INTO discovery_offer_evidence(id,offer_id,value) VALUES(?,?,?)');
      for (const member of [...members, ...reviewMembers]) {
        const manifest = discoveryImportSchema.parse(JSON.parse(get(member.search_id).manifest));
        const tooOld = manifest.maxPublishedAgeDays !== null && published && Number.isFinite(Date.parse(published))
          ? Date.parse(published) < refreshedAt - manifest.maxPublishedAgeDays * 86_400_000 : false;
        const explicitlyInactive = Number.isFinite(validTimestamp) && validTimestamp < refreshedAt && manifest.activity !== 'any';
        const table = members.includes(member) ? 'discovery_search_members' : 'discovery_search_review_members';
        if (tooOld || explicitlyInactive) {
          db.prepare(`DELETE FROM ${table} WHERE search_id=? AND offer_id=?`).run(member.search_id,offer.id);
          db.prepare('UPDATE discovery_searches SET revision=revision+1,updated_at=? WHERE id=?').run(refreshedAt,member.search_id);
          continue;
        }
        const previous = discoveryEvidenceSchema.parse(JSON.parse(member.value));
        const freshness = previous.freshness ? { ...previous.freshness,
          ...(published && Number.isFinite(Date.parse(published)) ? { publication: { value: published, precision: /^\d{4}-\d{2}-\d{2}$/.test(published) ? 'date' as const : 'instant' as const } } : {}),
          ...(enrichment.detailsFetchedAt ? { detailsFetchedAt: enrichment.detailsFetchedAt } : {}),
          ...(Number.isFinite(validTimestamp) ? { activity: { status: validTimestamp < refreshedAt ? 'inactive' as const : 'active' as const,
            reason: validTimestamp < refreshedAt ? 'The board-published validity date has passed.' : 'The board-published validity date has not passed.', checkedAt: refreshedAt } } : {})
        } : undefined;
        const value=JSON.stringify(discoveryEvidenceSchema.parse({...previous,offer,enrichment,...(freshness ? { freshness } : {})}));
        if (value === member.value) continue;
        const evidenceId=digest(value); insert.run(evidenceId,offer.id,value);
        db.prepare(`UPDATE ${table} SET evidence_id=? WHERE search_id=? AND offer_id=?`).run(evidenceId,member.search_id,offer.id);
        db.prepare('UPDATE discovery_searches SET revision=revision+1,updated_at=? WHERE id=?').run(now(),member.search_id);
      }
    }).immediate,
    get: (id: string) => summary(get(id)),
    suppressed: visibility.suppressed,
    manage: db.transaction((id: string, offerIds: string[], action: 'hide' | 'delete' | 'blacklist' | 'restore' | 'unblacklist') => {
      get(id);
      for (const offerId of offerIds) {
        if (!offers.get(offerId)) throw new OperationError('offer_missing','Offer is unavailable.');
        if (action === 'blacklist') db.prepare('INSERT OR IGNORE INTO discovery_blacklist VALUES(?,?)').run(offerId,now());
        else if (action === 'unblacklist') db.prepare('DELETE FROM discovery_blacklist WHERE offer_id=?').run(offerId);
        else if (action === 'restore') db.prepare('DELETE FROM discovery_offer_visibility WHERE search_id=? AND offer_id=? AND action=\'hide\'').run(id,offerId);
        else {
          db.prepare('INSERT INTO discovery_offer_visibility VALUES(?,?,?,?) ON CONFLICT(search_id,offer_id) DO UPDATE SET action=excluded.action,created_at=excluded.created_at').run(id,offerId,action,now());
          if (action === 'delete') for (const table of ['discovery_search_members','discovery_search_review_members']) db.prepare(`DELETE FROM ${table} WHERE search_id=? AND offer_id=?`).run(id,offerId);
        }
      }
      db.prepare('UPDATE discovery_searches SET revision=revision+1,updated_at=?').run(now());
      return { updated: true };
    }).immediate,
    managed(id: string) {
      get(id);
      return { items: db.prepare(`SELECT v.offer_id AS offerId,v.action,o.position AS title,o.url FROM discovery_offer_visibility v JOIN offers o ON o.id=v.offer_id WHERE v.search_id=?
        UNION ALL SELECT b.offer_id,'blacklist',o.position,o.url FROM discovery_blacklist b JOIN offers o ON o.id=b.offer_id ORDER BY title,offerId`).all(id) };
    },
    begin: db.transaction((raw: unknown): DiscoveryImportReceipt => {
      const input = discoveryImportSchema.parse(raw);
      if (db.prepare('SELECT id FROM discovery_search_tombstones WHERE id=?').get(input.id)) {
        throw new OperationError('search_deleted', 'This search was deleted.');
      }
      const manifest = JSON.stringify(input);
      const existing = db.prepare('SELECT * FROM discovery_searches WHERE id=?').get(input.id) as Row | undefined;
      if (existing) {
        if (existing.import_key !== input.importKey || existing.manifest !== manifest) conflict('Saved search import changed. Keep the original recovery copy.');
        return receipt(existing);
      }
      const at = now();
      db.prepare(`INSERT INTO discovery_searches(id, import_key, manifest, status, row_count, created_at, updated_at)
        VALUES (?, ?, ?, 'importing', ?, ?, ?)`).run(input.id, input.importKey, manifest, input.rowCount, at, at);
      if (hasRequestLedger) db.prepare('INSERT INTO discovery_search_request_usage(search_id,updated_at) VALUES(?,?)').run(input.id,at);
      return receipt(get(input.id));
    }).immediate,
    append: db.transaction((raw: unknown): DiscoveryImportReceipt => {
      const input = discoveryImportBatchSchema.parse(raw);
      const row = checked(input.id, input.importKey);
      const hash = digest(JSON.stringify(input.items));
      const replay = db.prepare('SELECT digest FROM discovery_import_batches WHERE search_id=? AND offset=?')
        .get(input.id, input.offset) as { digest: string } | undefined;
      if (replay) {
        if (replay.digest !== hash) conflict('A retried import batch has different evidence.');
        return receipt(row);
      }
      if (row.status !== 'importing' || input.offset !== row.received || row.received + input.items.length > row.row_count) {
        conflict('Import batch does not match the next expected offset.');
      }
      for (const [index, item] of input.items.entries()) {
        const offer = item.offer;
        if (visibility.suppressed(input.id,offer.id)) continue;
        if (!offers.get(offer.id)) {
          const sameUrl = offer.url ? offers.byUrl(offer.url) : undefined;
          if (sameUrl && sameUrl.id !== offer.id) conflict('Legacy offer identity conflicts with the catalogue.');
          offers.sight([offer], offer.firstSeenAt ?? now());
        }
        if (db.prepare('SELECT 1 FROM discovery_search_members WHERE search_id=? AND offer_id=?').get(input.id, offer.id)) continue;
        const value = JSON.stringify(item);
        const evidenceId = digest(value);
        db.prepare('INSERT OR IGNORE INTO discovery_offer_evidence(id, offer_id, value) VALUES (?, ?, ?)')
          .run(evidenceId, offer.id, value);
        // First occurrence defines ordering and historical evidence on duplicate IDs.
        db.prepare(`INSERT INTO discovery_search_members(search_id, offer_id, ordinal, evidence_id) VALUES (?, ?, ?, ?)
          ON CONFLICT(search_id, offer_id) DO NOTHING`).run(input.id, offer.id, input.offset + index, evidenceId);
      }
      db.prepare('INSERT INTO discovery_import_batches(search_id, offset, digest) VALUES (?, ?, ?)').run(input.id, input.offset, hash);
      db.prepare('UPDATE discovery_searches SET received=received+?, updated_at=? WHERE id=?').run(input.items.length, now(), input.id);
      return receipt(get(input.id));
    }).immediate,
    finish: db.transaction((raw: unknown): DiscoveryImportReceipt => {
      const { id, importKey } = discoveryImportIdentitySchema.parse(raw);
      const row = checked(id, importKey);
      if (row.received !== row.row_count) conflict('The saved search import is incomplete.');
      if (row.status !== 'ready') db.prepare("UPDATE discovery_searches SET status='ready', revision=1, updated_at=? WHERE id=?").run(now(), id);
      return receipt(get(id));
    }).immediate,
    list(limit = 30, offset = 0) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
        throw new OperationError('invalid_query', 'Invalid saved search page.');
      }
      const rows = db.prepare("SELECT * FROM discovery_searches WHERE status='ready' ORDER BY updated_at DESC, id LIMIT ? OFFSET ?")
        .all(limit + 1, offset) as Row[];
      return { items: rows.slice(0, limit).map((row) => summary(row)),
        nextOffset: rows.length > limit ? offset + limit : null };
    },
    offer(id: string, offerId: string, group: 'accepted' | 'review' = 'accepted') {
      if (visibility.suppressed(id,offerId)) throw new OperationError('offer_missing','This offer is hidden or removed from Discover.');
      const search=get(id); if(search.status!=='ready') conflict('Search is not ready.');
      const table = group === 'review' ? 'discovery_search_review_members' : 'discovery_search_members';
      const row=db.prepare(`SELECT e.value,m.ordinal FROM ${table} m JOIN discovery_offer_evidence e ON e.id=m.evidence_id WHERE m.search_id=? AND m.offer_id=?`).get(id,offerId) as { value: string; ordinal: number } | undefined;
      if(!row) throw new OperationError('offer_missing','This offer is not available in this saved search.');
      return { item:JSON.parse(row.value) as DiscoveryEvidence,ordinal:row.ordinal };
    },
    read(raw: unknown) {
      const { id, limit, offset, filtered, group, pageRevision, presentation } = discoverySearchPageSchema.parse(raw);
      opportunities.sync();
      const row = get(id);
      if (row.status !== 'ready') throw new OperationError('search_importing', 'This saved search is still being imported.');
      const currentPageRevision = `${row.revision}:${filtered ? row.filter_revision : 0}${presentation==='opportunities'?':'+opportunities.revision():''}`;
      if (pageRevision !== undefined && pageRevision !== currentPageRevision) {
        throw new OperationError('search_results_changed', 'Saved search results changed. Refresh from the first page.');
      }
      const filter = discoveryFilter(filtered ? summary(row).filters : discoveryFiltersSchema.parse({}));
      filter.sql = `(${filter.sql}) AND ${visibility.sql('m.offer_id','m.search_id')}`;
      const table = group === 'review' ? 'discovery_search_review_members' : 'discovery_search_members';
      if(presentation==='opportunities'){
        const selected=db.prepare(`SELECT e.value FROM ${table} m JOIN discovery_offer_evidence e ON e.id=m.evidence_id WHERE m.search_id=? AND ${filter.sql} ORDER BY m.ordinal`).all(id,...filter.args) as {value:string}[];
        const items=selected.map(r=>JSON.parse(r.value) as DiscoveryEvidence);
        const identities=new Map(opportunities.resolve(items.map(i=>i.offer.id)).identities.map(i=>[i.id,i.opportunityId??undefined]));
        const grouped=groupOpportunities(items,id=>identities.get(id),opportunities.revision());
        const page=grouped.slice(offset,offset+limit).map(item=>({...item,opportunity:{...item.opportunity,sources:item.opportunity.sources.map(source=>({...source,note:db.prepare('SELECT text,revision,updated_at AS updatedAt FROM offer_notes WHERE offer_id=?').get(source.offer.id)}))}}));
        const total=(db.prepare(`SELECT count(DISTINCT coalesce(om.opportunity_id,m.offer_id)) AS n FROM ${table} m LEFT JOIN opportunity_members om ON om.offer_id=m.offer_id WHERE m.search_id=? AND ${visibility.sql('m.offer_id','m.search_id')}`).get(id) as {n:number}).n;
        const reviewOpportunityCount=(db.prepare(`SELECT count(DISTINCT om.opportunity_id) AS n FROM discovery_search_review_members m JOIN opportunity_members om ON om.offer_id=m.offer_id WHERE m.search_id=? AND ${visibility.sql('m.offer_id','m.search_id')}`).get(id) as {n:number}).n;
        return {search:summary(row),group,pageRevision:currentPageRevision,count:grouped.length,total,listingCount:items.length,reviewOpportunityCount,identityRevision:opportunities.revision(),items:page,nextOffset:offset+page.length<grouped.length?offset+page.length:null};
      }
      const members = db.prepare(`SELECT e.value FROM ${table} m
        JOIN discovery_offer_evidence e ON e.id=m.evidence_id
        WHERE m.search_id=? AND ${filter.sql} ORDER BY m.ordinal LIMIT ? OFFSET ?`).all(id, ...filter.args, limit + 1, offset) as { value: string }[];
      const count = db.prepare(`SELECT count(*) AS count FROM ${table} m JOIN discovery_offer_evidence e ON e.id=m.evidence_id WHERE m.search_id=? AND ${filter.sql}`).get(id,...filter.args) as { count: number };
      const total = (db.prepare(`SELECT count(*) AS n FROM ${table} m WHERE search_id=? AND ${visibility.sql('m.offer_id','m.search_id')}`).get(id) as { n: number }).n;
      return { search: summary(row), group, pageRevision: currentPageRevision, count: count.count, total,
        items: members.slice(0, limit).map((member) => {
          const item = JSON.parse(member.value) as DiscoveryEvidence;
          const note = db.prepare('SELECT text,revision,updated_at AS updatedAt FROM offer_notes WHERE offer_id=?').get(item.offer.id);
          const enrichment = db.prepare('SELECT value FROM offer_enrichments WHERE offer_id=?').get(item.offer.id) as { value: string } | undefined;
          return { ...item, ...(note ? { note } : {}), ...(enrichment ? { enrichment: JSON.parse(enrichment.value) } : {}) };
        }),
        nextOffset: members.length > limit ? offset + limit : null };
    },
    delete: db.transaction((id: string): boolean => {
      if (!id || id.length > 200) throw new OperationError('invalid_query', 'Invalid search ID.');
      db.prepare('INSERT OR IGNORE INTO discovery_search_tombstones(id, deleted_at) VALUES (?, ?)').run(id, now());
      db.prepare('DELETE FROM runs WHERE id IN (SELECT run_id FROM discovery_chat_turns WHERE search_id=?)').run(id);
      const deleted = db.prepare('DELETE FROM discovery_searches WHERE id=?').run(id).changes > 0;
      db.prepare(`DELETE FROM discovery_offer_evidence WHERE NOT EXISTS
        (SELECT 1 FROM discovery_search_members m WHERE m.evidence_id=discovery_offer_evidence.id) AND NOT EXISTS
        (SELECT 1 FROM discovery_search_review_members r WHERE r.evidence_id=discovery_offer_evidence.id) AND NOT EXISTS (SELECT 1 FROM discovery_turn_members t WHERE t.evidence_id=discovery_offer_evidence.id) AND NOT EXISTS (SELECT 1 FROM offer_query_members q WHERE q.evidence_id=discovery_offer_evidence.id)`).run();
      return deleted;
    }).immediate
  };
};
