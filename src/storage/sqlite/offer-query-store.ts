import { discoveryVisibility } from './discovery-visibility.js';
import { createOpportunityStore } from './opportunities.js';
import { groupOpportunities } from './opportunity-projection.js';
import { factRows } from './offer-facts.js';
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import type { Db } from './open.js';
import type { DiscoveryEvidence } from '../../contracts/discovery-search.js';
import type { ProjectedOffer, QueryScope, QueryStart, QueryExecution, QueryResult, QueryTiming } from '../../contracts/offer-query.js';
import { queryLimits, querySaveSchema } from '../../contracts/offer-query.js';
import { OperationError } from '../../contracts/operation-error.js';
import { projectOffer, hash } from './offer-query-projection.js';
import { translateFilters } from './offer-query-filters.js';
type Snapshot = {
    id: string;
    owner_id: string;
    scope: string;
    source_key: string;
    fingerprint: string | null;
    bytes: number;
    created_at: number;
};
type ExecutionRow = {
    id: string;
    owner_id: string;
    request: string;
    request_hash: string;
    state: QueryExecution['state'];
    snapshot_id: string | null;
    result: string | null;
    error: string | null;
    timing: string | null;
    created_at: number;
    row_count: number;
    expires_at: number;
    bytes: number;
};
const error = (code: string, message: string): never => { throw new OperationError(code, message); };
const canonicalRequest = (r: QueryStart) => JSON.stringify({ ...r, params: [...r.params].sort((a, b) => a.name.localeCompare(b.name)) });
export function createOfferQueryStore(db: Db, now = Date.now) {
    const visibility = discoveryVisibility(db);
    const opportunities=createOpportunityStore(db,now);
    const owner = (id: string) => { if (!db.prepare("SELECT 1 FROM discovery_searches WHERE id=? AND status='ready'").get(id))
        error('query_not_found', 'The saved search is unavailable.'); };
    const row = (ownerId: string, id: string): ExecutionRow => { owner(ownerId); const r = db.prepare('SELECT * FROM offer_query_executions WHERE id=? AND owner_id=?').get(id, ownerId) as ExecutionRow | undefined; if (!r)
        error('query_not_found', 'Query execution is unavailable.'); return r!; };
    const view = (r: ExecutionRow): QueryExecution => ({ executionId: r.id, ownerSearchId: r.owner_id, request: JSON.parse(r.request), state: r.state, snapshotId: r.snapshot_id, result: r.result ? JSON.parse(r.result) : null, error: r.error ? JSON.parse(r.error) : null, timing: r.timing ? JSON.parse(r.timing) : null, createdAt: r.created_at, returnedRowCount: r.row_count });
    function document(ownerId: string) {
        owner(ownerId);
        const prior = db.prepare('SELECT * FROM offer_query_documents WHERE search_id=?').get(ownerId) as {
            revision: number;
            draft: string;
            original_filters: string | null;
            applied_id: string | null;
        } | undefined;
        if (prior)
            return { revision: prior.revision, ...JSON.parse(prior.draft), originalFilters: prior.original_filters ? JSON.parse(prior.original_filters) : null, appliedExecutionId: prior.applied_id };
        const s = db.prepare('SELECT manifest,current_filters FROM discovery_searches WHERE id=?').get(ownerId) as {
            manifest: string;
            current_filters: string | null;
        };
        const filters = s.current_filters ? JSON.parse(s.current_filters) : JSON.parse(s.manifest).filters ?? {};
        const draft = { ...translateFilters(filters), scope: { kind: 'search', searchId: ownerId } };
        db.prepare('INSERT INTO offer_query_documents(search_id,draft,original_filters) VALUES(?,?,?)').run(ownerId, JSON.stringify(draft), JSON.stringify(filters));
        return { revision: 0, ...draft, originalFilters: filters, appliedExecutionId: null };
    }
    function ownedSnapshot(ownerId: string, id: string, scope?: QueryScope) { owner(ownerId); const s = db.prepare('SELECT * FROM offer_query_snapshots WHERE id=? AND owner_id=?').get(id, ownerId) as Snapshot | undefined; if (!s || !s.fingerprint)
        error('query_scope_expired', 'The query snapshot is unavailable.'); if (scope && s!.scope !== JSON.stringify(scope))
        error('query_scope_conflict', 'The snapshot belongs to another scope.'); return s!; }
    const checkScope = (ownerId: string, scope: QueryScope) => { owner(ownerId); if (scope.kind === 'search' && scope.searchId !== ownerId)
        error('query_scope_conflict', 'The search scope belongs to another owner.'); if (scope.kind === 'result') {
        const r = row(ownerId, scope.executionId);
        const result = r.result ? JSON.parse(r.result) as QueryResult : null;
        if (r.state !== 'succeeded' || result?.identityIndex === null || !result || result.truncated)
            error('query_scope_not_offers', 'Select a complete verified offer result first.');
    } };
    const sourceMembers = (ownerId: string, scope: QueryScope) => {
        checkScope(ownerId, scope);
        opportunities.sync();
        if (scope.kind === 'result')
            return db.prepare(`SELECT m.offer_id,m.evidence_id,m.metadata FROM offer_query_members m JOIN offer_query_executions x ON x.snapshot_id=m.snapshot_id JOIN offer_query_result_members r ON r.execution_id=x.id AND r.offer_id=m.offer_id WHERE x.id=? AND ${visibility.sql('m.offer_id','x.owner_id')} ORDER BY m.offer_id`).all(scope.executionId) as {
                offer_id: string;
                evidence_id: string;
                metadata: string;
            }[];
        const selection = scope.kind === 'search' ? `SELECT m.offer_id,m.evidence_id,m.ordinal AS search_rank FROM discovery_search_members m WHERE m.search_id=? AND ${visibility.sql('m.offer_id','m.search_id')}` : `SELECT offer_id,evidence_id,NULL AS search_rank FROM (SELECT m.offer_id,m.evidence_id,row_number() OVER(PARTITION BY m.offer_id ORDER BY seq.seq DESC,m.evidence_id) AS rank FROM discovery_search_members m JOIN discovery_searches s ON s.id=m.search_id AND s.status='ready' AND ${visibility.sql('m.offer_id','m.search_id')} JOIN offer_query_evidence_sequence seq ON seq.evidence_id=m.evidence_id) WHERE rank=1`;
        return db.prepare(`SELECT selected.offer_id,selected.evidence_id,json_object('disposition',o.disposition,'firstSeenAt',o.first_seen_at,'lastSeenAt',o.last_seen_at,'searchRank',selected.search_rank,'opportunityId',om.opportunity_id,'identityRevision',(SELECT revision FROM opportunity_revision WHERE id=1),'projectionVersion',2) AS metadata FROM (${selection}) selected JOIN discovery_searches owner ON owner.id=? JOIN offers o ON o.id=selected.offer_id JOIN opportunity_members om ON om.offer_id=o.id WHERE ${visibility.sql('selected.offer_id','owner.id')} ORDER BY selected.search_rank,selected.offer_id`).all(...(scope.kind === 'search' ? [ownerId] : []),ownerId) as {
            offer_id: string;
            evidence_id: string;
            metadata: string;
        }[];
    };
    async function capture(ownerId: string, scope: QueryScope, signal?: AbortSignal, frozenMembers?: { offer_id: string; evidence_id: string; metadata: string }[]) {
        const began = performance.now();
        const captured = db.transaction(() => {
            const members = (frozenMembers ?? sourceMembers(ownerId, scope)).map(m=>{
                const e=JSON.parse((db.prepare('SELECT value FROM discovery_offer_evidence WHERE id=? AND offer_id=?').get(m.evidence_id,m.offer_id) as {value:string}).value) as DiscoveryEvidence;
                const metadata=JSON.parse(m.metadata),policy=metadata.__factPolicy;
                const rows=factRows(db,m.offer_id,e.offer.text??'',policy?.modelVersion).filter(row=>!policy || (policy.allowed && row[10]===0 && policy.criteria.includes(row[11]) && row[14]===policy.modelVersion));
                return {...m,metadata:JSON.stringify({...metadata,projectionVersion:2,opportunityId:metadata.opportunityId??m.offer_id,identityRevision:metadata.identityRevision??0,__facts:rows})};
            }), scopeText = JSON.stringify(scope), sourceKey = hash(scopeText + JSON.stringify(members));
            const prior = db.prepare('SELECT * FROM offer_query_snapshots WHERE owner_id=? AND source_key=? AND fingerprint IS NOT NULL').get(ownerId, sourceKey) as Snapshot | undefined;
            if (prior)
                return prior;
            const id = randomUUID();
            db.prepare('INSERT INTO offer_query_snapshots(id,owner_id,scope,source_key,created_at) VALUES(?,?,?,?,?)').run(id, ownerId, scopeText, sourceKey, now());
            const put = db.prepare('INSERT INTO offer_query_members(snapshot_id,offer_id,evidence_id,metadata) VALUES(?,?,?,?)');
            for (const m of members)
                put.run(id, m.offer_id, m.evidence_id, m.metadata);
            return { id, owner_id: ownerId, scope: scopeText, source_key: sourceKey, fingerprint: null, bytes: 0, created_at: now() };
        })();
        if (captured.fingerprint)
            return { ...captured, captureMs: performance.now() - began, projectionMs: 0 };
        let offset = '', bytes = 0;
        const hashes: string[] = [];
        const projectedAt = performance.now();
        try {
            while (true) {
                if (signal?.aborted)
                    error('query_cancelled', 'Query cancelled.');
                if (performance.now() - began > queryLimits.captureMs)
                    error('query_timeout', 'Snapshot capture timed out.');
                const batch = db.prepare(`SELECT m.*,e.value FROM offer_query_members m JOIN discovery_offer_evidence e ON e.id=m.evidence_id WHERE m.snapshot_id=? AND m.offer_id>? ORDER BY m.offer_id LIMIT 25`).all(captured.id, offset) as {
                    offer_id: string;
                    evidence_id: string;
                    metadata: string;
                    value: string;
                }[];
                if (!batch.length)
                    break;
                for (const m of batch) {
                    const key = hash('4:' + m.evidence_id + ':' + m.metadata);
                    let cached = db.prepare('SELECT value,hash,bytes FROM offer_query_projection WHERE cache_key=?').get(key) as {
                        value: string;
                        hash: string;
                        bytes: number;
                    } | undefined;
                    if (!cached) {
                        const e = JSON.parse(m.value) as DiscoveryEvidence, metadata = JSON.parse(m.metadata);
                        const p = projectOffer(m.evidence_id, { ...e, offer: { ...e.offer, ...metadata } }, metadata);
                        p.tables.offer_extracted_facts=metadata.__facts??[];
                        if(p.tables.offer_extracted_facts!.length) p.hash=hash(p.hash+JSON.stringify(p.tables.offer_extracted_facts));
                        const value = JSON.stringify(p);
                        cached = { value, hash: p.hash, bytes: Buffer.byteLength(value) };
                        db.prepare('INSERT OR IGNORE INTO offer_query_projection VALUES(?,?,?,?,?)').run(key, m.evidence_id, value, p.hash, cached.bytes);
                    }
                    if (cached.bytes > queryLimits.frameBytes)
                        error('query_capacity_exceeded', 'A published offer exceeds the 4 MiB query-record limit.');
                    bytes += cached.bytes;
                    if (bytes > queryLimits.snapshotBytes)
                        error('query_capacity_exceeded', 'This scope exceeds the 64 MiB public dataset limit. Narrow the saved search.');
                    hashes.push(m.offer_id + ':' + cached.hash);
                    db.prepare('UPDATE offer_query_members SET projection_key=? WHERE snapshot_id=? AND offer_id=?').run(key, captured.id, m.offer_id);
                    offset = m.offer_id;
                }
                await yieldTurn();
            }
            const fingerprint = hash('2:' + JSON.stringify(hashes));
            db.prepare('UPDATE offer_query_snapshots SET fingerprint=?,bytes=? WHERE id=?').run(fingerprint, bytes, captured.id);
            return { ...captured, fingerprint, bytes, captureMs: performance.now() - began, projectionMs: performance.now() - projectedAt };
        }
        catch (e) {
            db.prepare('DELETE FROM offer_query_snapshots WHERE id=?').run(captured.id);
            throw e;
        }
    }
    async function* batches(snapshotId: string) { let offset = ''; while (true) {
        const rows = db.prepare('SELECT m.offer_id,m.evidence_id,m.metadata,e.value AS evidence,p.value FROM offer_query_members m JOIN offer_query_projection p ON p.cache_key=m.projection_key JOIN discovery_offer_evidence e ON e.id=m.evidence_id WHERE m.snapshot_id=? AND m.offer_id>? ORDER BY m.offer_id LIMIT 25').all(snapshotId, offset) as {
            offer_id: string;
            evidence_id: string;
            metadata: string;
            evidence: string;
            value: string;
        }[];
        if (!rows.length)
            return;
        offset = rows.at(-1)!.offer_id;
        let frame: ProjectedOffer[] = [], bytes = 0;
        for (const r of rows) {
            const size = Buffer.byteLength(r.value);
            if (frame.length && bytes + size > queryLimits.frameBytes) {
                yield frame;
                frame = [];
                bytes = 0;
            }
            const metadata=JSON.parse(r.metadata);
            if(metadata.projectionVersion!==2){
                // Upgrade the wire shape from immutable evidence, never current offer rows.
                const evidence=JSON.parse(r.evidence) as DiscoveryEvidence;
                const projection=projectOffer(r.evidence_id,{...evidence,offer:{...evidence.offer,...metadata}},metadata);
                projection.tables.offer_extracted_facts=metadata.__facts??[];
                frame.push(projection);
            } else frame.push(JSON.parse(r.value) as ProjectedOffer);
            bytes += size;
        }
        if (frame.length)
            yield frame;
        await yieldTurn();
    } }
    const transientBytes = () => (db.prepare(`SELECT coalesce(sum(bytes),0) AS n FROM offer_query_executions x WHERE state='succeeded' AND NOT EXISTS(SELECT 1 FROM offer_query_documents d WHERE d.applied_id=x.id) AND NOT EXISTS(SELECT 1 FROM offer_query_pins p WHERE p.execution_id=x.id AND p.pin!='client')`).get() as {n:number}).n;
    function gc(reserve = 0) {
        const at = now();
        const expire = (id: string) => { db.prepare('DELETE FROM offer_query_pages WHERE execution_id=?').run(id); db.prepare('DELETE FROM offer_query_result_members WHERE execution_id=?').run(id); db.prepare("UPDATE offer_query_executions SET state='expired',snapshot_id=NULL,result=NULL,error=NULL,bytes=0,row_count=0,expires_at=? WHERE id=?").run(at + queryLimits.tombstoneMs, id); };
        db.transaction(() => {
            db.prepare("DELETE FROM offer_query_pins WHERE pin='client' AND execution_id IN (SELECT id FROM offer_query_executions WHERE expires_at<=?)").run(at);
            const candidates = db.prepare(`SELECT id,bytes,expires_at FROM offer_query_executions x WHERE state NOT IN ('queued','capturing','running','expired') AND NOT EXISTS(SELECT 1 FROM offer_query_pins p WHERE p.execution_id=x.id) AND NOT EXISTS(SELECT 1 FROM offer_query_documents d WHERE d.applied_id=x.id) ORDER BY updated_at`).all() as {
                id: string;
                bytes: number;
                expires_at: number;
            }[];
            let total = transientBytes();
            for (const c of candidates)
                if (c.expires_at <= at || total + reserve > queryLimits.transientBytes) {
                    expire(c.id);
                    total -= c.bytes;
                }
            db.prepare("DELETE FROM offer_query_executions WHERE state='expired' AND expires_at<=?").run(at);
            db.prepare(`DELETE FROM offer_query_snapshots WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM offer_query_executions x WHERE x.snapshot_id=offer_query_snapshots.id)`).run(at - queryLimits.ttlMs);
            db.prepare('DELETE FROM offer_query_projection WHERE NOT EXISTS(SELECT 1 FROM offer_query_members m WHERE m.projection_key=offer_query_projection.cache_key)').run();
            db.prepare(`DELETE FROM discovery_offer_evidence WHERE NOT EXISTS(SELECT 1 FROM discovery_search_members m WHERE m.evidence_id=discovery_offer_evidence.id) AND NOT EXISTS(SELECT 1 FROM discovery_search_review_members r WHERE r.evidence_id=discovery_offer_evidence.id) AND NOT EXISTS(SELECT 1 FROM discovery_turn_members t WHERE t.evidence_id=discovery_offer_evidence.id) AND NOT EXISTS(SELECT 1 FROM offer_query_members q WHERE q.evidence_id=discovery_offer_evidence.id)`).run();
        })();
    }
    db.prepare("UPDATE offer_query_executions SET state='interrupted',error=?,updated_at=? WHERE state IN ('queued','capturing','running')").run(JSON.stringify({ code: 'query_interrupted', message: 'Query interrupted by runtime restart. Run it again explicitly.' }), now());
    return { capture, batches, ownedSnapshot, document, checkScope, gc,
        members(ownerId:string,snapshotId:string) {ownedSnapshot(ownerId,snapshotId);return db.prepare('SELECT offer_id,evidence_id,metadata FROM offer_query_members WHERE snapshot_id=? ORDER BY offer_id').all(snapshotId) as {offer_id:string;evidence_id:string;metadata:string}[];},
        source(evidenceId:string,offerId:string) {const row=db.prepare('SELECT value FROM discovery_offer_evidence WHERE id=? AND offer_id=?').get(evidenceId,offerId) as {value:string}|undefined;if(!row)error('query_scope_expired','Source evidence expired.');return JSON.parse(row!.value) as DiscoveryEvidence;},
        currentEvidence(ownerId:string,offerId:string) {owner(ownerId);return (db.prepare('SELECT evidence_id FROM discovery_search_members WHERE search_id=? AND offer_id=?').get(ownerId,offerId) as {evidence_id:string}|undefined)?.evidence_id;},
        prior(r: QueryStart) { owner(r.ownerSearchId); const prior = db.prepare('SELECT * FROM offer_query_executions WHERE owner_id=? AND request_id=?').get(r.ownerSearchId, r.requestId) as ExecutionRow | undefined; if (!prior)
            return null; if (prior.request_hash !== hash(canonicalRequest(r)))
            error('query_request_conflict', 'Request ID was used with different query data.'); if (prior.state === 'expired')
            error('query_scope_expired', 'The previous result expired. Run again with a new request ID.'); return view(prior); },
        get: (ownerId: string, id: string) => view(row(ownerId, id)),
        save(raw: unknown) { const r = querySaveSchema.parse(raw); checkScope(r.ownerSearchId, r.scope); const d = document(r.ownerSearchId); if (d.revision !== r.expectedDocumentRevision)
            error('query_scope_conflict', 'The query draft changed. Reload it.'); db.prepare('UPDATE offer_query_documents SET revision=revision+1,draft=? WHERE search_id=?').run(JSON.stringify({ draftSql: r.draftSql, params: r.params, scope: r.scope, presentation: r.presentation }), r.ownerSearchId); return document(r.ownerSearchId); },
        insert(r: QueryStart, validation = false) { owner(r.ownerSearchId); const serialized = canonicalRequest(r), prior = db.prepare('SELECT * FROM offer_query_executions WHERE owner_id=? AND request_id=?').get(r.ownerSearchId, r.requestId) as ExecutionRow | undefined; if (prior) {
            if (prior.request_hash !== hash(serialized))
                error('query_request_conflict', 'Request ID was used with different query data.');
            if (prior.state === 'expired')
                error('query_scope_expired', 'The previous result expired. Run again with a new request ID.');
            return { execution: view(prior), fresh: false };
        } const id = randomUUID(); db.prepare(`INSERT INTO offer_query_executions(id,owner_id,request_id,request,request_hash,state,created_at,updated_at,expires_at,validation_only) VALUES(?,?,?,?,?,'queued',?,?,?,?)`).run(id, r.ownerSearchId, r.requestId, serialized, hash(serialized), now(), now(), now() + queryLimits.ttlMs, Number(validation)); return { execution: view(row(r.ownerSearchId, id)), fresh: true }; },
        status(id: string, state: string, snapshotId?: string) { db.prepare('UPDATE offer_query_executions SET state=?,snapshot_id=coalesce(?,snapshot_id),updated_at=? WHERE id=?').run(state, snapshotId ?? null, now(), id); },
        fail(id: string, code: string, message: string) { db.prepare('UPDATE offer_query_executions SET state=?,error=?,updated_at=? WHERE id=?').run(code === 'query_cancelled' ? 'cancelled' : code === 'query_interrupted' ? 'interrupted' : 'failed', JSON.stringify({ code, message }), now(), id); },
        cached(ownerId: string, snapshotId: string, r: QueryStart) { return db.prepare(`SELECT id FROM offer_query_executions WHERE owner_id=? AND snapshot_id=? AND state='succeeded' AND validation_only=0 AND json_extract(request,'$.sql')=? AND json_extract(request,'$.params')=? ORDER BY created_at DESC LIMIT 1`).get(ownerId, snapshotId, r.sql, JSON.stringify([...r.params].sort((a, b) => a.name.localeCompare(b.name)))) as {
            id: string;
        } | undefined; },
        complete(id: string, result: QueryResult, timing: QueryTiming, apply = true) {
            db.transaction(() => {
                const r = db.prepare('SELECT * FROM offer_query_executions WHERE id=?').get(id) as ExecutionRow | undefined;
                if (!r)
                    return;
                gc(result.bytes);
                if(transientBytes()+result.bytes>queryLimits.transientBytes)error('query_capacity_exceeded','Result cache is full of retained results. Release earlier query results before retrying.');
                const insert = db.prepare('INSERT INTO offer_query_pages VALUES(?,?,?)');
                for (let i = 0; i < result.rows.length; i += 100)
                    insert.run(id, i / 100, JSON.stringify(result.rows.slice(i, i + 100)));
                if (result.identityIndex !== null && !result.truncated) {
                    const put = db.prepare('INSERT OR IGNORE INTO offer_query_result_members VALUES(?,?)');
                    for (const values of result.rows) {
                        const offer = values[result.identityIndex];
                        if (typeof offer === 'string' && db.prepare('SELECT 1 FROM offer_query_members WHERE snapshot_id=? AND offer_id=?').get(r.snapshot_id, offer))
                            put.run(id, offer);
                    }
                }
                const { rows, ...meta } = result;
                db.prepare("UPDATE offer_query_executions SET state='succeeded',result=?,timing=?,bytes=?,row_count=?,updated_at=? WHERE id=?").run(JSON.stringify(meta), JSON.stringify(timing), result.bytes, rows.length, now(), id);
                db.prepare("INSERT OR IGNORE INTO offer_query_pins VALUES(?,'client')").run(id);
                const request = JSON.parse(r.request) as QueryStart;
                if (apply && request.origin === 'editor') {
                    const previous=document(r.owner_id).appliedExecutionId;
                    if(previous){db.prepare("DELETE FROM offer_query_pins WHERE execution_id=? AND pin='client'").run(previous);db.prepare('UPDATE offer_query_executions SET expires_at=? WHERE id=?').run(now()+queryLimits.ttlMs,previous);}
                    db.prepare('UPDATE offer_query_documents SET applied_id=? WHERE search_id=?').run(id, r.owner_id);
                }
            })();
        },
        readResult(ownerId: string, id: string): QueryResult { const r = row(ownerId, id); if (r.state !== 'succeeded')
            error('query_not_ready', 'Query results are not ready.'); return { ...JSON.parse(r.result!), rows: (db.prepare('SELECT value FROM offer_query_pages WHERE execution_id=? ORDER BY page').all(id) as {
                value: string;
            }[]).flatMap(p => JSON.parse(p.value)) }; },
        opportunityPage(ownerId:string,id:string,cursor:string|undefined,limit:number){
            opportunities.sync();
            const execution=row(ownerId,id),result=this.readResult(ownerId,id);
            if(result.identityIndex===null||result.truncated)error('query_scope_not_offers','Grouping requires a complete verified listing result.');
            const members=this.members(ownerId,execution.snapshot_id!),byId=new Map(members.map(m=>[m.offer_id,m]));
            const ordered=new Map<string,{values:QueryResult['rows'][number];evidence:DiscoveryEvidence;opportunityId:string;revision:number}>();
            for(const values of result.rows){const offerId=values[result.identityIndex!] as string;const m=byId.get(offerId);if(!m)error('query_scope_not_offers','Result contains an unverified listing reference.');if(ordered.has(offerId))continue;
                const metadata=JSON.parse(m!.metadata);ordered.set(offerId,{values,evidence:this.source(m!.evidence_id,offerId),opportunityId:metadata.opportunityId??offerId,revision:metadata.identityRevision??0});}
            const revision=[...ordered.values()][0]?.revision??0;
            const groups=groupOpportunities([...ordered.values()].map(v=>v.evidence),offerId=>ordered.get(offerId)?.opportunityId,revision);
            let offset=0;if(cursor){try{const c=JSON.parse(Buffer.from(cursor,'base64url').toString());if(c.id!==id||c.kind!=='opportunities'||!Number.isInteger(c.offset)||c.offset<0||c.offset>groups.length)throw Error();offset=c.offset;}catch{error('query_invalid_params','Invalid opportunity cursor.');}}
            const items=groups.slice(offset,offset+limit),rows=items.map(item=>ordered.get(item.offer.id)!.values);
            return {...result,rows,opportunityItems:items,identityRevision:revision,identityStale:revision!==opportunities.revision(),listingCount:ordered.size,snapshotId:execution.snapshot_id,returnedRowCount:groups.length,
                references:items.map((item,index)=>({row:index,offerId:item.offer.id,evidenceId:byId.get(item.offer.id)!.evidence_id})),
                nextCursor:offset+items.length<groups.length?Buffer.from(JSON.stringify({kind:'opportunities',id,offset:offset+items.length})).toString('base64url'):null};
        },
        page(ownerId: string, id: string, cursor: string | undefined, limit: number) {
            const r = row(ownerId, id);
            if (r.state !== 'succeeded')
                error(r.state === 'expired' ? 'query_scope_expired' : 'query_not_ready', 'Query results are unavailable.');
            let offset = 0;
            if (cursor) {
                try {
                    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
                    if (decoded.id !== id || !Number.isInteger(decoded.offset) || decoded.offset < 0 || decoded.offset > r.row_count)
                        throw Error();
                    offset = decoded.offset;
                }
                catch {
                    error('query_invalid_params', 'Invalid result cursor.');
                }
            }
            const pages = db.prepare('SELECT value FROM offer_query_pages WHERE execution_id=? AND page BETWEEN ? AND ? ORDER BY page').all(id, Math.floor(offset / 100), Math.floor((offset + limit - 1) / 100)) as {
                value: string;
            }[];
            const rows = pages.flatMap(p => JSON.parse(p.value)).slice(offset % 100, offset % 100 + limit);
            const meta = JSON.parse(r.result!) as Omit<QueryResult, 'rows'>;
            const references = meta.identityIndex === null ? [] : rows.flatMap((values, i) => { const v = values[meta.identityIndex!]; const m = db.prepare('SELECT evidence_id FROM offer_query_members WHERE snapshot_id=? AND offer_id=?').get(r.snapshot_id, v) as {
                evidence_id: string;
            } | undefined; return m ? [{ row: i, offerId: v, evidenceId: m.evidence_id }] : []; });
            return { ...meta, rows, references, snapshotId: r.snapshot_id, returnedRowCount: r.row_count, nextCursor: offset + rows.length < r.row_count ? Buffer.from(JSON.stringify({ id, offset: offset + rows.length })).toString('base64url') : null };
        },
        release(ownerId: string, id: string) { row(ownerId, id); const released=db.prepare('DELETE FROM offer_query_pins WHERE execution_id=? AND pin=?').run(id, 'client').changes; if(released)db.prepare('UPDATE offer_query_executions SET expires_at=? WHERE id=?').run(now()+queryLimits.ttlMs,id); gc(); return { released: true }; },
        pin(ownerId: string, id: string, pin: string) { row(ownerId, id); db.prepare('INSERT OR IGNORE INTO offer_query_pins VALUES(?,?)').run(id, pin); },
        alive: (snapshotId: string) => !!db.prepare('SELECT 1 FROM offer_query_snapshots WHERE id=?').get(snapshotId)
    };
}
export type OfferQueryStore = ReturnType<typeof createOfferQueryStore>;
