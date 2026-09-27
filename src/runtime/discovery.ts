import { randomUUID } from 'node:crypto';
import type { CatalogueItem, CatalogueQuery, DiscoveryBoardId, DiscoveryBoardState, DiscoveryBudget, DiscoveryCatalogue, DiscoveryEffectiveFilter, DiscoveryEvent, DiscoveryMatchMode, DiscoveryPoll, DiscoveryRequestUsage, DiscoverySearchPolicy, DiscoverySource, DiscoverySourceMode } from '../contracts/discovery.js';
import { defaultDiscoveryBudget } from '../contracts/discovery.js';
import { OperationError } from '../contracts/operation-error.js';
import { discoveryMatchingPolicyVersion, qualifyDiscoveryItem } from './discovery-policy.js';

type Session = {
  searchId?: string; id: string; keyword: string; pageSize: number; events: DiscoveryEvent[];
  boards: Map<DiscoveryBoardId, DiscoveryBoardState>; controllers: Map<DiscoveryBoardId, AbortController>;
  touchedAt: number; cancelled: boolean; halted: boolean; collectAll: boolean; matchMode: DiscoveryMatchMode; sourceMode: DiscoverySourceMode; collection: boolean; policy: DiscoverySearchPolicy; budget: DiscoveryBudget;
  requests: number; pages: Map<DiscoveryBoardId, number>; candidateIds: Set<string>; acceptedIds: Set<string>;
  initialCompleted: Set<DiscoveryBoardId>; requested: Set<DiscoveryBoardId>; deadline?: ReturnType<typeof setTimeout>;
};

const validateFilters = (boards: readonly DiscoveryBoardId[], workMode?: string): void => {
  if (workMode !== undefined && workMode !== 'any') throw new OperationError('unsupported_filter', `Work-mode filtering is unsupported by the selected discovery adapters: ${boards.join(', ')}.`);
};

const terminal = (state: DiscoveryBoardState): boolean => ['exhausted', 'error', 'cancelled'].includes(state.status);

const runtimeEffectiveFilters = (session: Session): DiscoveryEffectiveFilter[] => [
  { id: 'matchMode', support: 'local', stage: 'runtime', requested: session.matchMode, applied: true,
    detail: 'Applied by the runtime to captured source evidence.' },
  { id: 'activity', support: 'local', stage: 'runtime', requested: session.policy.activity, applied: true,
    detail: 'Applied by the runtime; unknown activity remains explicit.' },
  { id: 'maxPublishedAgeDays', support: 'local', stage: 'runtime', requested: session.policy.maxPublishedAgeDays,
    applied: session.policy.maxPublishedAgeDays !== null,
    detail: session.policy.maxPublishedAgeDays === null ? 'No publication-age limit was requested.' : 'Applied by the runtime when a published date is available.' }
];
const pendingFilterReport = (session: Session) => ({
  effective: [
    { id: 'keyword' as const, support: 'unknown' as const, stage: 'source' as const,
      requested: session.keyword, applied: false,
      detail: 'No successful source page has confirmed keyword application yet.' },
    ...runtimeEffectiveFilters(session)
  ],
  unsupported: []
});

/** Deterministic search orchestration; no AI and no personal-CV dependency. */
export const createDiscoveryService = (catalogue: DiscoveryCatalogue, source: DiscoverySource, now = Date.now, saved?: { suppressed?(searchId: string, offerId: string): boolean; create(id: string, phrase: string, boards: string[], semantics?: { sourceMode: DiscoverySourceMode; matchMode: DiscoveryMatchMode; matchingPolicyVersion: string; unknownPolicy?: 'separate'; activity?: 'exclude_explicitly_inactive' | 'any'; maxPublishedAgeDays?: number | null; budget?: DiscoveryBudget }): unknown; add(id: string, items: readonly CatalogueItem[]): unknown; get(id: string): { phrase: string; boards: DiscoveryBoardId[]; sourceMode?: DiscoverySourceMode; matchMode?: DiscoveryMatchMode; matchingPolicyVersion?: string; unknownPolicy?: 'separate'; activity?: 'exclude_explicitly_inactive' | 'any'; maxPublishedAgeDays?: number | null; budget?: DiscoveryBudget }; reserveRequest?(id: string, kind: 'search' | 'detail'): boolean; refundRequest?(id: string, kind: 'search' | 'detail'): void; requestUsage?(id: string): DiscoveryRequestUsage; refetch?(id: string, reset: boolean): unknown }) => {
  const sessions = new Map<string, Session>();
  let closed = false;
  const emit = (session: Session, event: Omit<DiscoveryEvent, 'seq'>): void => {
    session.events.push({ ...event, seq: session.events.length + 1 });
  };
  const finishTimerIfDone = (session: Session): void => {
    if ([...session.boards.values()].every(terminal)) {
      if (session.deadline) clearTimeout(session.deadline);
      session.deadline = undefined;
    }
  };
  const stop = (session: Session, reason: NonNullable<DiscoveryBoardState['stopReason']>, completion: 'bounded' | 'unknown' = 'bounded'): void => {
    if (session.halted || session.cancelled) return;
    session.halted = true;
    for (const controller of session.controllers.values()) controller.abort();
    for (const [board, previous] of session.boards) {
      if (terminal(previous)) continue;
      const state: DiscoveryBoardState = { ...previous, status: 'exhausted', completion, stopReason: reason };
      session.boards.set(board, state);
      emit(session, { kind: 'board', board, state });
    }
    finishTimerIfDone(session);
  };
  const cancel = (session: Session): void => {
    if (session.cancelled) return;
    session.cancelled = true;
    if (session.deadline) clearTimeout(session.deadline);
    for (const controller of session.controllers.values()) controller.abort();
    for (const [board, state] of session.boards) session.boards.set(board, { ...state, status: 'cancelled', completion: 'bounded', stopReason: 'cancelled' });
    emit(session, { kind: 'cancelled' });
  };
  const allInitialComplete = (session: Session): boolean => session.initialCompleted.size === session.boards.size;
  const targetReached = (session: Session): boolean => session.budget.targetAcceptedTotal !== null && session.acceptedIds.size >= session.budget.targetAcceptedTotal;
  const initialCandidateAllowance = (session: Session, board: DiscoveryBoardId): number => {
    const boards = [...session.boards.keys()], index = boards.indexOf(board), base = Math.floor(session.budget.maxCandidatesTotal / boards.length);
    return base + (index < session.budget.maxCandidatesTotal % boards.length ? 1 : 0);
  };
  const reserveSearchRequest = (session: Session): boolean => {
    if (session.searchId && saved?.reserveRequest) {
      if (!saved.reserveRequest(session.searchId, 'search')) return false;
      session.requests++;
      return true;
    }
    if (session.requests >= session.budget.maxRequestsTotal) return false;
    session.requests++;
    return true;
  };
  const prune = (): void => {
    for (const [id, session] of sessions) {
      if (now() - session.touchedAt >= 30 * 60 * 1000) { cancel(session); sessions.delete(id); }
    }
  };
  const get = (id: string): Session => {
    prune();
    const session = sessions.get(id);
    if (!session) throw new OperationError('search_expired', 'Search session expired or the runtime restarted. Start a new search.');
    session.touchedAt = now();
    return session;
  };
  const fetchBoard = async (session: Session, board: DiscoveryBoardId): Promise<void> => {
    const previous = session.boards.get(board)!;
    if (session.cancelled || session.halted || closed || session.controllers.has(board) || terminal(previous)) return;
    if (!reserveSearchRequest(session)) { stop(session, 'request_budget'); return; }
    const eventLimit = Math.min(20_000, session.budget.maxRequestsTotal * 2 + session.boards.size * 2 + 1);
    if (session.events.length >= eventLimit) {
      const state: DiscoveryBoardState = { ...previous, status: 'error', completion: 'bounded', stopReason: 'session_limit', error: { status: 'invalid_query', detail: 'Search session limit reached. Start a new search.' } };
      session.boards.set(board, state); session.initialCompleted.add(board); emit(session, { kind: 'board', board, state }); return;
    }
    let reserved = 1;
    const requested = Math.max(1, Math.min(10, source.requestCost?.(board, previous.nextCursor ?? undefined) ?? 1));
    // Reserve synchronously before dispatch, so concurrent searches/details
    // cannot spend the worker's allowance. Uncertain aborts retain the reserve.
    while (reserved < requested && reserveSearchRequest(session)) reserved++;
    const controller = new AbortController();
    session.controllers.set(board, controller);
    const loading: DiscoveryBoardState = { ...previous, status: 'loading', error: undefined };
    session.boards.set(board, loading); emit(session, { kind: 'board', board, state: loading });
    try {
      const result = await source.search({ board, keyword: session.keyword, pageSize: session.pageSize, ...(previous.nextCursor ? { cursor: previous.nextCursor } : {}), ...(requested > 1 ? { requestLimit: reserved } : {}) }, controller.signal);
      const used = result.status === 'ok' ? result.data.requestCount : result.requestCount;
      if (used !== undefined && Number.isInteger(used) && used >= 0 && used <= reserved && !session.cancelled && !session.halted) {
        for (let i = used; i < reserved; i++) {
          if (session.searchId && saved?.refundRequest) saved.refundRequest(session.searchId, 'search');
          session.requests--;
        }
      }
      if (closed || session.cancelled || session.halted || controller.signal.aborted) return;
      session.pages.set(board, (session.pages.get(board) ?? 0) + 1);
      if (result.status !== 'ok') {
        const blocked = ['blocked', 'disallowed'].includes(result.status);
        const state: DiscoveryBoardState = { ...previous, status: 'error', completion: 'unknown', stopReason: blocked ? 'blocked' : 'unknown_completeness', error: result };
        session.boards.set(board, state); emit(session, { kind: 'board', board, state }); return;
      }
      if (result.data.board !== board || result.data.items.length > session.pageSize || result.data.items.some((item) => item.board !== board)) throw new Error('Invalid source batch.');
      const cursorDidNotAdvance = result.data.hasMore && (!result.data.nextCursor || result.data.nextCursor === previous.nextCursor);
      const candidates = catalogue.ingest(result.data, now()).filter(item => !session.searchId || !saved?.suppressed?.(session.searchId,item.offer.id));
      const uniqueCandidates = candidates.filter((item) => !session.candidateIds.has(item.offer.id));
      const allowance = !session.initialCompleted.has(board)
        ? initialCandidateAllowance(session, board)
        : Math.max(0, session.budget.maxCandidatesTotal - session.candidateIds.size);
      const selected = uniqueCandidates.slice(0, allowance);
      for (const item of selected) session.candidateIds.add(item.offer.id);
      const evaluated = session.collection ? selected : selected.flatMap((item) => {
        const result = qualifyDiscoveryItem(item, session.keyword, session.matchMode, 'live', session.policy, now());
        return result ? [result] : [];
      });
      const items = evaluated.filter((item) => item.qualification?.decision !== 'unknown');
      const reviewItems = evaluated.filter((item) => item.qualification?.decision === 'unknown');
      for (const item of items) session.acceptedIds.add(item.offer.id);
      const membership = session.searchId ? saved?.add(session.searchId, evaluated) as {added?:number;reviewAdded?:number}|undefined : undefined;
      let state: DiscoveryBoardState = {
        board, status: result.data.hasMore ? 'ready' : 'exhausted',
        ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {}),
        coverage: result.data.coverage, limitations: result.data.limitations,
        filterReport: { effective: [...result.data.effectiveFilters, ...runtimeEffectiveFilters(session)], unsupported: result.data.unsupportedFilters },
        candidates: (previous.candidates ?? 0) + selected.length,
        accepted: (previous.accepted ?? 0) + items.length,
        unknown: (previous.unknown ?? 0) + reviewItems.length,
        ...(!result.data.hasMore ? result.data.sourceExhausted === false
          ? { completion: 'bounded' as const, stopReason: 'page_budget' as const }
          : { completion: 'exhausted' as const, stopReason: 'exhausted' as const } : {})
      };
      if (result.data.hasMore && cursorDidNotAdvance) state = { ...state, status: 'exhausted', completion: 'bounded', stopReason: 'repeated_cursor' };
      // A partly suppressed page is not evidence that the source is repeating
      // itself. Keep advancing its cursor without charging excluded listings
      // to the candidate/accepted targets; request, page and time limits remain.
      else if (result.data.hasMore && uniqueCandidates.length === 0 && candidates.length === result.data.items.length) state = { ...state, status: 'exhausted', completion: 'bounded', stopReason: 'no_new_identities' };
      else if (result.data.hasMore && selected.length < uniqueCandidates.length) state = { ...state, status: 'exhausted', completion: 'bounded', stopReason: 'candidate_budget' };
      else if (result.data.hasMore && (session.pages.get(board) ?? 0) >= session.budget.maxPagesPerSource) state = { ...state, status: 'exhausted', completion: 'bounded', stopReason: 'page_budget' };
      session.boards.set(board, state);
      emit(session, { kind: 'batch', board, items, reviewItems, state, ...(membership?.added===undefined?{}:{added:membership.added}) });
    } catch {
      if (!closed && !session.cancelled && !session.halted) {
        const state: DiscoveryBoardState = { ...previous, status: 'error', completion: 'unknown', stopReason: 'failed', error: { status: 'error', detail: 'This board batch could not be loaded or stored.' } };
        session.boards.set(board, state); emit(session, { kind: 'board', board, state });
      }
    } finally {
      session.controllers.delete(board);
      session.initialCompleted.add(board);
      pump(session);
    }
  };
  const pump = (session: Session): void => {
    if (closed || session.cancelled || session.halted) return;
    if (allInitialComplete(session)) {
      if (targetReached(session)) { stop(session, 'target_reached'); return; }
      if (session.candidateIds.size >= session.budget.maxCandidatesTotal) { stop(session, 'candidate_budget'); return; }
    }
    while (session.controllers.size < session.budget.maxConcurrentRequests) {
      const available = session.searchId && saved?.requestUsage
        ? saved.requestUsage(session.searchId).remaining > 0
        : session.requests < session.budget.maxRequestsTotal;
      if (!available) {
        // An in-flight worker may refund part of its reservation. Wait for its
        // finally/pump instead of aborting it as if the allowance were spent.
        if (session.controllers.size > 0) break;
        stop(session, 'request_budget'); return;
      }
      const initial = [...session.boards.keys()].find((board) => !session.initialCompleted.has(board) && !session.controllers.has(board) && !terminal(session.boards.get(board)!));
      const continuation = allInitialComplete(session) ? [...session.boards.keys()].find((board) => !session.controllers.has(board) && !terminal(session.boards.get(board)!) && (session.collectAll || session.requested.has(board))) : undefined;
      const board = initial ?? continuation;
      if (!board) break;
      if ((session.pages.get(board) ?? 0) >= session.budget.maxPagesPerSource) {
        const previous = session.boards.get(board)!;
        const state: DiscoveryBoardState = { ...previous, status: 'exhausted', completion: 'bounded', stopReason: 'page_budget' };
        session.boards.set(board, state); session.requested.delete(board); emit(session, { kind: 'board', board, state }); continue;
      }
      session.requested.delete(board);
      void fetchBoard(session, board);
    }
    finishTimerIfDone(session);
  };
  return {
    boards: () => source.boards(AbortSignal.timeout(90_000)),
    browserSearch: (board: string, keyword: string) => {
      if (!source.browserSearch) throw new OperationError('unsupported_source', 'Browser search is not available for this source.');
      return source.browserSearch(board, keyword, AbortSignal.timeout(15_000));
    },
    validateFilters,
    validateBoards: (boards: readonly DiscoveryBoardId[]) => { for (const board of boards) source.validateBoard?.(board); },
    cached: (query: CatalogueQuery & { searchId?: string; unknownPolicy?: 'separate'; activity?: 'exclude_explicitly_inactive' | 'any'; maxPublishedAgeDays?: number | null }) => {
      if (query.searchId && saved) {
        const search = saved.get(query.searchId);
        if (search.phrase !== query.keyword || JSON.stringify(search.boards) !== JSON.stringify(query.boards)) throw new OperationError('search_conflict', 'Query does not belong to this search.');
        if ((search.matchMode ?? 'anywhere') !== (query.matchMode ?? 'anywhere') || search.sourceMode === 'live') {
          throw new OperationError('search_conflict', 'Cached results do not belong to this search policy.');
        }
        if ((search.activity ?? 'exclude_explicitly_inactive') !== (query.activity ?? 'exclude_explicitly_inactive') ||
          (search.maxPublishedAgeDays ?? null) !== (query.maxPublishedAgeDays ?? null)) {
          throw new OperationError('search_conflict', 'Cached freshness policy does not belong to this search.');
        }
      }
      const matchMode = query.matchMode ?? 'anywhere';
      const policy: DiscoverySearchPolicy = { unknownPolicy: query.unknownPolicy ?? 'separate', activity: query.activity ?? 'exclude_explicitly_inactive', maxPublishedAgeDays: query.maxPublishedAgeDays ?? null };
      const page = catalogue.search({ ...query, matchMode });
      const evaluated = page.items.flatMap((item) => {
        if (query.searchId && saved?.suppressed?.(query.searchId,item.offer.id)) return [];
        const result = qualifyDiscoveryItem(item, query.keyword, matchMode, 'cache', policy, now());
        return result ? [result] : [];
      });
      const items = evaluated.filter((item) => item.qualification?.decision !== 'unknown');
      const reviewItems = evaluated.filter((item) => item.qualification?.decision === 'unknown');
      if (query.searchId) saved?.add(query.searchId,evaluated);
      return { ...page, items, reviewItems };
    },
    cancelSearch(id: string): void { for (const session of sessions.values()) if (session.searchId === id) cancel(session); },
    start(query: { keyword: string; boards: DiscoveryBoardId[]; pageSize: number; replaceSessionId?: string; searchId?: string; collection?: boolean; sourceMode?: DiscoverySourceMode; matchMode?: DiscoveryMatchMode; unknownPolicy?: 'separate'; activity?: 'exclude_explicitly_inactive' | 'any'; maxPublishedAgeDays?: number | null; workMode?: 'any' | 'remote' | 'hybrid' | 'onsite'; budget?: DiscoveryBudget; refetch?: 'append' | 'reset' }): { id: string; searchId?: string } {
      if (closed) throw new OperationError('search_closed', 'Discovery service is closed.');
      prune();
      if (query.replaceSessionId) {
        const previous = sessions.get(query.replaceSessionId);
        if (previous) { cancel(previous); sessions.delete(previous.id); }
      }
      if (sessions.size >= 20) {
        for (const [id, old] of sessions) {
          if (old.cancelled || [...old.boards.values()].every(terminal)) sessions.delete(id);
          if (sessions.size < 20) break;
        }
      }
      if (sessions.size >= 20) throw new OperationError('search_capacity', 'Too many search sessions. Cancel an old search before starting another.');
      if (query.refetch) {
        if (!query.searchId || !saved?.refetch || query.collection) throw new OperationError('search_conflict', 'Refetch requires a saved search.');
        const owner = saved.get(query.searchId);
        // The persisted query is authoritative, including budgets and filters.
        query = { ...query, keyword: owner.phrase, boards: owner.boards,
          matchMode: owner.matchMode, activity: owner.activity,
          maxPublishedAgeDays: owner.maxPublishedAgeDays, budget: owner.budget,
          sourceMode: 'live' };
      }
      const boards = [...new Set(query.boards)];
      if (query.sourceMode !== 'cache' || query.collection || query.refetch) {
        for (const board of boards) source.validateBoard?.(board);
      }
      validateFilters(boards, query.workMode);
      const budget: DiscoveryBudget = { ...defaultDiscoveryBudget, ...query.budget };
      if (budget.maxRequestsTotal < boards.length || budget.maxCandidatesTotal < boards.length) throw new OperationError('invalid_query', 'Request and candidate budgets must allow at least one opportunity per selected board.');
      const sourceMode: DiscoverySourceMode = query.collection ? 'live' : query.sourceMode ?? 'live';
      const matchMode: DiscoveryMatchMode = query.matchMode ?? 'anywhere';
      const policy: DiscoverySearchPolicy = { unknownPolicy: query.unknownPolicy ?? 'separate', activity: query.activity ?? 'exclude_explicitly_inactive', maxPublishedAgeDays: query.maxPublishedAgeDays ?? null };
      if (query.collection) {
        if (!query.searchId || !saved) throw new OperationError('search_conflict','Collection requires an existing saved search.');
        const owner=saved.get(query.searchId);
        if (!boards.length || boards.some(board=>!owner.boards.includes(board))) throw new OperationError('search_conflict','Collection source is outside the saved search.');
      } else if (query.refetch && query.searchId) {
        for (const session of sessions.values()) if (session.searchId === query.searchId) cancel(session);
        saved!.refetch!(query.searchId, query.refetch === 'reset');
      } else if (query.searchId) saved?.create(query.searchId, query.keyword, boards, { sourceMode, matchMode, matchingPolicyVersion: discoveryMatchingPolicyVersion, ...policy, budget });
      const cachedRaw = query.collection || sourceMode === 'live' ? {items:[],nextOffset:null} : catalogue.search({ ...query, boards, matchMode, limit: query.pageSize, offset: 0 });
      const cachedEvaluated = cachedRaw.items.flatMap((item) => {
        if (query.searchId && saved?.suppressed?.(query.searchId,item.offer.id)) return [];
        const result = qualifyDiscoveryItem(item, query.keyword, matchMode, 'cache', policy, now());
        return result ? [result] : [];
      });
      const cached = { ...cachedRaw, items: cachedEvaluated.filter((item) => item.qualification?.decision !== 'unknown'), reviewItems: cachedEvaluated.filter((item) => item.qualification?.decision === 'unknown') };
      const cachedAcceptedIds = new Set(cached.items.map((item) => item.offer.id));
      if (query.searchId) {
        saved?.add(query.searchId,cachedEvaluated);
        // A saved interactive search owns its complete cached match set. The
        // page size is a transport/UI concern, not a membership ceiling.
        // Collection requests stay independently bounded by their caller.
        if (!query.collection && saved) {
          let offset = cached.nextOffset;
          while (offset !== null) {
            const rawPage = catalogue.search({ ...query, boards, matchMode, limit: 100, offset });
            const evaluated = rawPage.items.flatMap((item) => {
              if (query.searchId && saved?.suppressed?.(query.searchId,item.offer.id)) return [];
        const result = qualifyDiscoveryItem(item, query.keyword, matchMode, 'cache', policy, now());
              return result ? [result] : [];
            });
            const page = { ...rawPage, items: evaluated };
            saved.add(query.searchId, evaluated);
            for (const item of evaluated) if (item.qualification?.decision !== 'unknown') cachedAcceptedIds.add(item.offer.id);
            if (page.nextOffset !== null && page.nextOffset <= offset) throw new Error('Cached pagination did not advance.');
            offset = page.nextOffset;
          }
        }
      }
      const session: Session = { ...(query.searchId ? { searchId: query.searchId } : {}), id: randomUUID(), keyword: query.keyword, pageSize: query.pageSize,
        events: [], boards: new Map(boards.map((board) => [board, { board, status: 'ready' }])), controllers: new Map(), touchedAt: now(), cancelled: false, halted: false,
        collectAll: !!query.searchId && !query.collection && sourceMode !== 'cache', matchMode, sourceMode, collection: query.collection === true, policy, budget,
        requests: 0, pages: new Map(), candidateIds: new Set(), acceptedIds: cachedAcceptedIds, initialCompleted: new Set(), requested: new Set() };
      for (const board of boards) session.boards.set(board, { board, status: 'ready', filterReport: pendingFilterReport(session) });
      sessions.set(session.id, session);
      emit(session, { kind: 'cached', items: cached.items, reviewItems: cached.reviewItems, cacheNextOffset: session.collectAll ? null : cached.nextOffset });
      if (sourceMode === 'cache') {
        for (const board of boards) session.boards.set(board, { board, status: 'exhausted', completion: 'bounded', stopReason: 'cache_only',
          filterReport: { effective: [
            { id: 'keyword', support: 'local', stage: 'runtime', requested: session.keyword, applied: true, detail: 'Applied to the local catalogue.' },
            ...runtimeEffectiveFilters(session)
          ], unsupported: [] } });
      } else {
        session.deadline = setTimeout(() => stop(session, 'deadline'), budget.deadlineMs);
        pump(session);
      }
      return { id: session.id, ...(session.searchId ? { searchId: session.searchId } : {}) };
    },
    poll(id: string, after = 0): DiscoveryPoll {
      const session = get(id);
      if (after > session.events.length) throw new OperationError('invalid_cursor', 'Event cursor is ahead of this search.');
      const events = session.events.slice(after, after + 100);
      const cursor = events.at(-1)?.seq ?? after;
      return { id, events, after: cursor, hasMoreEvents: cursor < session.events.length,
        boards: [...session.boards.values()], cancelled: session.cancelled };
    },
    next(id: string, board?: DiscoveryBoardId): void {
      const session = get(id);
      if (board && !session.boards.has(board)) throw new OperationError('invalid_query', 'Board is not part of this search.');
      for (const candidate of board ? [board] : session.boards.keys()) {
        const state = session.boards.get(candidate)!;
        const retryable = state.error && ['error', 'unavailable'].includes(state.error.status);
        if (retryable) session.boards.set(candidate, { ...state, status: 'ready', completion: undefined, stopReason: undefined, error: undefined });
        if (state.status === 'ready' || retryable) session.requested.add(candidate);
      }
      pump(session);
    },
    cancel(id: string): void { cancel(get(id)); },
    close(): void { closed = true; for (const session of sessions.values()) cancel(session); sessions.clear(); }
  };
};
