import type { OfferQueryStore } from './offer-query-store.js';
import { retrieveDiscovery } from './discovery-query.js';
import type { DiscoveryQuery } from '../../contracts/discovery-query.js';
import { OperationError } from '../../contracts/operation-error.js';
import { discoveryChatRequestSchema, discoveryFiltersSchema, type DiscoveryChatRequest } from '../../contracts/discovery-search.js';
import type { DiscoveryAnswerContext, DiscoveryReference } from '../../contracts/discovery-chat.js';
import type { ConversationStore, PieceRef, RunResult } from '../../contracts/index.js';
import type { Db } from './open.js';
import { discoveryFilter } from './discovery-filter.js';
import { excludedOffers, withheldRuns } from './discovery-walls.js';

type Turn = { run_id: string; search_id: string; conversation_id: string; request: string; evidence: string; scope_count: number };
/**
 * `walls` is what a conversation excludes (`grounding-selection.ts`). Without it
 * nothing is excluded, which is what a store built before selections reads as.
 */
export const createDiscoveryChatStore = (db: Db, conversations: ConversationStore, now = Date.now, queries?: OfferQueryStore, walls: (conversationId: string) => readonly PieceRef[] = () => []) => {
 const turn = (id: string) => db.prepare('SELECT * FROM discovery_chat_turns WHERE run_id=?').get(id) as Turn | undefined;
 const requireTurn = (id: string): Turn => { const t=turn(id); if (!t) throw new OperationError('search_not_found','This Discover turn no longer exists.'); return t; };
 const message = (conversationId: string, runId: string, role: 'user'|'assistant', text: string) => {
  const seq = (db.prepare('SELECT coalesce(max(seq),0)+1 AS n FROM messages WHERE conversation_id=?').get(conversationId) as { n: number }).n;
  db.prepare('INSERT INTO messages(conversation_id,seq,id,role,text,run_id,created_at) VALUES(?,?,?,?,?,?,?)')
   .run(conversationId,seq,`${runId}:${role}`,role,text,runId,now());
  db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now(),conversationId);
 };
 return {
  owner(runId: string, searchId: string) { if (requireTurn(runId).search_id !== searchId) throw new OperationError('search_conflict','Run belongs to another search.'); },
  start: db.transaction((raw: DiscoveryChatRequest, begin: (context: DiscoveryAnswerContext) => void) => {
   const request = discoveryChatRequestSchema.parse(raw), serialized = JSON.stringify(request);
   const prior = turn(request.runId);
   if (prior) { if (prior.request !== serialized) throw new OperationError('search_conflict','Run ID belongs to another question.'); return { runId: request.runId }; }
   if (db.prepare('SELECT id FROM runs WHERE id=?').get(request.runId)) throw new OperationError('search_conflict','Run ID is already in use.');
   const conversation = conversations.open({ kind:'discovery', id:request.searchId });
   if (conversation.id !== request.conversationId) throw new OperationError('search_conflict','Conversation belongs to another search.');
   if (db.prepare(`SELECT 1 FROM discovery_chat_turns t JOIN runs r ON r.id=t.run_id WHERE t.search_id=? AND r.status IN ('queued','running','suspended')`).get(request.searchId)) throw new OperationError('search_busy','An answer is already running for this search.');
   const search = db.prepare('SELECT * FROM discovery_searches WHERE id=?').get(request.searchId) as { manifest: string; current_filters: string | null; filter_revision: number; revision: number };
   if (!request.version && request.filterRevision !== search.filter_revision) throw new OperationError(queries ? 'query_scope_expired' : 'search_conflict', 'Search filters changed. Reload before asking.');
   if(request.collection && (request.version!==2 || request.scope!=='all')) throw new OperationError('query_scope_conflict','Collection requires the whole saved search scope.');
   let queryContext: DiscoveryAnswerContext['queryContext'];
   if (request.version === 2) {
    if (!queries || !request.snapshotId || !request.scopeRevision || request.scope === 'filtered') throw new OperationError('query_scope_expired','Capture a new SQL scope and resend your question.');
    const scope = request.scope === 'results' ? {kind:'result' as const,executionId:request.executionId ?? ''} : {kind:'search' as const,searchId:request.searchId};
    queries.checkScope(request.searchId,scope);
    const snapshot=queries.ownedSnapshot(request.searchId,request.snapshotId,scope);
    if(snapshot.fingerprint!==request.scopeRevision) throw new OperationError('query_scope_conflict','The captured scope does not match this question.');
    queryContext={scope,snapshotId:snapshot.id,scopeRevision:snapshot.fingerprint!};
   } else if(request.scope==='results') throw new OperationError('query_scope_expired','Current results require a version 2 captured scope.');
   const filters = discoveryFiltersSchema.parse(request.scope === 'filtered' ? JSON.parse(search.current_filters ?? search.manifest).filters ?? JSON.parse(search.current_filters ?? '{}') : {});
   const filter = discoveryFilter(filters);
   const standing=walls(conversation.id), excluded=excludedOffers(standing);
   db.prepare('INSERT INTO discovery_chat_turns(run_id,search_id,conversation_id,request,created_at,traced) VALUES(?,?,?,?,?,1)')
    .run(request.runId,request.searchId,conversation.id,serialized,now());
   if(queryContext) db.prepare(`INSERT INTO discovery_turn_members(run_id,offer_id,evidence_id,ordinal)
    SELECT ?,offer_id,evidence_id,row_number() OVER(ORDER BY offer_id) FROM offer_query_members WHERE snapshot_id=?`).run(request.runId,queryContext.snapshotId);
   else db.prepare(`INSERT INTO discovery_turn_members(run_id,offer_id,evidence_id,ordinal)
    SELECT ?,m.offer_id,m.evidence_id,m.ordinal FROM discovery_search_members m JOIN discovery_offer_evidence e ON e.id=m.evidence_id
    WHERE m.search_id=? AND ${filter.sql}`).run(request.runId,request.searchId,...filter.args);
   // An excluded offer is not in the scope: it is not counted, not captured, and not queried.
   const cut = excluded.size ? db.prepare('DELETE FROM discovery_turn_members WHERE run_id=? AND offer_id IN (SELECT value FROM json_each(?))').run(request.runId,JSON.stringify([...excluded])).changes : 0;
   const scopeCount = (db.prepare('SELECT count(*) AS n FROM discovery_turn_members WHERE run_id=?').get(request.runId) as { n: number }).n;
   const held = withheldRuns(db, conversation.id, standing);
   const recent = (db.prepare(`SELECT m.role,substr(m.text,1,2000) AS text,m.run_id AS runId,r.result FROM messages m LEFT JOIN runs r ON r.id=m.run_id WHERE m.conversation_id=? ORDER BY m.seq DESC${standing.length ? '' : ' LIMIT 6'}`).all(conversation.id) as { role: string; text: string; runId: string | null; result: string | null }[])
    // What an exclusion reaches stays in the conversation and is not handed back to the model.
    .filter(m=>!standing.length || (m.runId !== null && !held.has(m.runId))).slice(0,6);
   const previousReferences = recent.find(m=>m.role==='assistant' && m.result)?.result;
   const evidence: DiscoveryAnswerContext['evidence'] = [];
   const history: { role: string; text: string }[]=[]; let historyBudget=8000;
   // The earlier turns this one is built on: whose messages it is given, and whose references.
   const given = new Set<string | null>(previousReferences === undefined ? [] : [recent.find(m=>m.role==='assistant' && m.result)!.runId]);
   for (const m of recent) {
    const refs: DiscoveryReference[] = m.role==='assistant' && m.result ? JSON.parse(m.result).references ?? [] : [];
    const text=m.text.replace(/\[(\d+)\]/g,(marker,n)=>{ const ref=refs.find(r=>r.marker===Number(n)); return ref ? `[${ref.label}; offer ${ref.offerId}]` : marker; }).slice(0,2000);
    if (text.length>historyBudget) break; historyBudget-=text.length; history.unshift({role:m.role,text}); given.add(m.runId);
   }
   const capturedMembers = queries && !queryContext ? db.prepare(`SELECT m.offer_id,m.evidence_id,json_object('disposition',o.disposition,'firstSeenAt',o.first_seen_at,'lastSeenAt',o.last_seen_at) AS metadata FROM discovery_turn_members m JOIN offers o ON o.id=m.offer_id WHERE m.run_id=? ORDER BY m.offer_id`).all(request.runId) as NonNullable<DiscoveryAnswerContext['capturedMembers']> : undefined;
   const context = { ...(queryContext ? {queryContext}:{}), ...(queryContext && cut ? {withheldOffers:cut}:{}), historyRuns:[...given].reverse(), ...(capturedMembers ? {capturedMembers}:{}), request,scopeCount,revision:search.revision,evidence,history,previousReferences: previousReferences ? (JSON.parse(previousReferences).references ?? []).slice(0,12) : [] };
   db.prepare('UPDATE discovery_chat_turns SET scope_count=?,evidence=? WHERE run_id=?').run(scopeCount,JSON.stringify(context),request.runId);
   begin(context); // Creates the existing runtime run within this transaction.
   message(conversation.id,request.runId,'user',request.question);
   return { runId:request.runId };
  }).immediate,
  /** The offers this conversation excludes now. */
  excluded(searchId: string) { return excludedOffers(walls(conversations.open({ kind:'discovery', id:searchId }).id)); },
  /**
   * The members of the snapshot a turn was accepted over, less what this
   * conversation excludes: the scope the model's queries run over once an
   * offer was cut out of it. Never more than the turn was accepted with, so an
   * offer that was excluded then and is not now stays out, and the turn's
   * membership still names everything its queries could read.
   */
  scope(context: DiscoveryAnswerContext) {
   const t=requireTurn(context.request.runId), snapshot=context.queryContext;
   if (!queries || !snapshot) throw new OperationError('query_scope_expired','The original scope is unavailable. Resend this question.');
   const accepted=new Set((db.prepare('SELECT offer_id FROM discovery_turn_members WHERE run_id=?').all(t.run_id) as { offer_id: string }[]).map(m=>m.offer_id));
   const excluded=excludedOffers(walls(t.conversation_id));
   return queries.members(context.request.searchId,snapshot.snapshotId).filter(m=>accepted.has(m.offer_id) && !excluded.has(m.offer_id));
  },
  recordSql(context: DiscoveryAnswerContext) {
   requireTurn(context.request.runId);
   // A turn that collected offers widened its scope: the membership names them too, so that excluding one later reaches this answer.
   if(context.collection && context.queryContext) {
    const base=(db.prepare('SELECT coalesce(max(ordinal),0) AS n FROM discovery_turn_members WHERE run_id=?').get(context.request.runId) as { n: number }).n;
    db.prepare(`INSERT OR IGNORE INTO discovery_turn_members(run_id,offer_id,evidence_id,ordinal)
     SELECT ?,m.offer_id,m.evidence_id,?+row_number() OVER(ORDER BY m.offer_id) FROM offer_query_members m WHERE m.snapshot_id=?`).run(context.request.runId,base,context.queryContext.snapshotId);
   }
   db.prepare('UPDATE discovery_chat_turns SET evidence=? WHERE run_id=?').run(JSON.stringify({...context,capturedMembers:undefined}),context.request.runId);
   if(context.sqlArtifact) queries?.pin(context.request.searchId,context.sqlArtifact.executionId,`chat:${context.request.runId}`);
   return context;
  },
  retrieve: db.transaction((context: DiscoveryAnswerContext, query: DiscoveryQuery) => {
   const t = requireTurn(context.request.runId);
   const captured = JSON.parse(t.evidence) as DiscoveryAnswerContext;
   const result = retrieveDiscovery(db, captured, query);
   db.prepare('UPDATE discovery_chat_turns SET evidence=? WHERE run_id=?').run(JSON.stringify(result), context.request.runId);
   return result;
  }).immediate,
  finish: db.transaction((runId: string, result: RunResult, commit: (result: RunResult)=>void) => {
   const t=requireTurn(runId), context=JSON.parse(t.evidence) as DiscoveryAnswerContext;
   const answer=String(result.data.answer ?? '').trim(); if (!answer || answer.length>24000) throw new OperationError('invalid_answer','The model returned no answer.');
   const references: DiscoveryReference[]=[];
   // Help is trusted application text; bracketed examples are not offer citations.
   for (const match of (context.query?.mode === 'help' ? [] : answer.matchAll(/\[(\d+)\]/g))) {
    const ref=context.evidence.find((entry)=>entry.reference.marker===Number(match[1]))?.reference;
    if (!ref) throw new OperationError('invalid_reference','The answer cited unavailable evidence. Please try again.');
    if (!references.some((r)=>r.offerId===ref.offerId)) references.push(ref);
   }
   const final={ ...result,data:{ answer,references,...(context.sqlArtifact ? {queryArtifact:context.sqlArtifact}:{}),coverage:{ scope:context.request.scope,total:context.scopeCount,examined:context.evidence.length,matched:context.matchedCount,aggregates:context.aggregates,query:context.query,limitations:context.limitations,revision:context.revision,filterRevision:context.request.filterRevision } } };
   message(t.conversation_id,runId,'assistant',answer); commit(final); return final;
  }).immediate,
  get(searchId: string, before?: number) {
   const conversation=conversations.open({kind:'discovery',id:searchId});
   const messages=db.prepare(`SELECT m.seq,m.id,m.role,m.text,m.run_id AS runId,m.created_at AS createdAt,r.result
    FROM messages m LEFT JOIN runs r ON r.id=m.run_id WHERE m.conversation_id=? AND m.seq<? ORDER BY m.seq DESC LIMIT 101`).all(conversation.id,before ?? Number.MAX_SAFE_INTEGER) as { seq:number; id:string; role:string; text:string; runId:string; createdAt:number; result:string|null }[];
   const turns=db.prepare(`SELECT r.id AS runId,r.status,r.error_code AS errorCode,r.error_message AS errorMessage,t.evidence FROM discovery_chat_turns t JOIN runs r ON r.id=t.run_id WHERE t.search_id=? ORDER BY t.created_at DESC,r.rowid DESC LIMIT 1`).all(searchId);
   const hasMore = messages.length > 100;
   const page = messages.slice(0,100);
   return { conversationId:conversation.id,nextBefore:hasMore ? page[page.length-1]!.seq : null,messages:page.reverse().map(({result,...m})=>({ ...m,...(m.role==='assistant' && result ? JSON.parse(result) : {}) })),latest:turns[0] ? (()=>{const {evidence,...latest}=turns[0] as {evidence:string};return {...latest,collection:(JSON.parse(evidence) as DiscoveryAnswerContext).collection};})() : null };
  }
 };
};
