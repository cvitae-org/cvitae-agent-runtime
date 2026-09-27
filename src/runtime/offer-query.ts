import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { queryStartSchema, queryValidateSchema, queryLimits } from '../contracts/offer-query.js';
import type { QueryStart, QueryTiming } from '../contracts/offer-query.js';
import { OperationError } from '../contracts/operation-error.js';
import type { OfferQueryStore } from '../storage/sqlite/offer-query-store.js';
import { queryRuntimeSupported, runQueryChild } from '../storage/sqlite/offer-query-process.js';
import { querySchema } from '../storage/sqlite/offer-query-schema.js';
type Job = {
    id: string;
    request: QueryStart;
    controller: AbortController;
    path?: string;
    process?: ReturnType<typeof runQueryChild>;
    validate?: boolean;
    settle?: () => void;
};
export function createOfferQueryService(store: OfferQueryStore) {
    let closed = false, active = 0;
    const queue: Job[] = [], jobs = new Map<string, Job>();
    const directory = mkdtempSync(join(tmpdir(), 'cvitae-offer-query-'));
    const datasets = new Map<string, string>();
    type CaptureEntry = {
        promise: Promise<Awaited<ReturnType<OfferQueryStore['capture']>>>;
        controller: AbortController;
        consumers: number;
    };
    const contexts = new Map<string, CaptureEntry>();
    const capture = (ownerId: string, scope: QueryStart['scope'], signal?: AbortSignal) => {
        const key = JSON.stringify([ownerId, scope]);
        let entry = contexts.get(key);
        if (!entry) {
            if (contexts.size >= 2)
                throw new OperationError('query_capacity_exceeded', 'Snapshot capture capacity is full. Try again shortly.');
            const controller = new AbortController();
            const promise = store.capture(ownerId, scope, controller.signal).finally(() => contexts.delete(key));
            entry = { promise, controller, consumers: 0 };
            contexts.set(key, entry);
        }
        const shared = entry;
        shared.consumers++;
        return new Promise<Awaited<ReturnType<OfferQueryStore['capture']>>>((resolve, reject) => {
            let finished = false;
            const detach = () => { if (finished)
                return false; finished = true; signal?.removeEventListener('abort', abort); shared.consumers--; if (!shared.consumers)
                shared.controller.abort(); return true; };
            const abort = () => { if (detach())
                reject(new OperationError('query_cancelled', 'Query cancelled.')); };
            shared.promise.then(value => { if (detach())
                resolve(value); }, error => { if (detach())
                reject(error); });
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted)
                abort();
        });
    };
    const requireRuntime = () => { if (!queryRuntimeSupported())
        throw new OperationError('query_runtime_unsupported', 'Offer queries require macOS arm64 or x64 with Node 24.14+ (major 24).'); };
    const removeFile = (path: string) => { for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(path + suffix, { force: true }); };
    const clean = () => {
        const inUse = new Set([...jobs.values()].flatMap(job => job.path ? [job.path] : []));
        for (const [id, path] of datasets) if (!inUse.has(path) && !store.alive(id)) { removeFile(path); datasets.delete(id); }
        while (datasets.size > 4) {
            const candidate = [...datasets].find(([, path]) => !inUse.has(path));
            if (!candidate) break;
            removeFile(candidate[1]); datasets.delete(candidate[0]);
        }
        const retained = new Set([...datasets.values(), ...inUse]);
        for (const name of readdirSync(directory)) if (name.endsWith('.sqlite')) {
            const path = join(directory, name); if (!retained.has(path)) removeFile(path);
        }
    };
    async function run(job: Job) {
        const began = performance.now(), r = job.request, queuedMs = Date.now() - store.get(job.request.ownerSearchId, job.id).createdAt;
        try {
            if (job.controller.signal.aborted)
                throw new OperationError('query_cancelled', 'Query cancelled.');
            store.status(job.id, 'capturing');
            const snapshot = r.snapshotId ? { ...store.ownedSnapshot(r.ownerSearchId, r.snapshotId, r.scope), captureMs: 0, projectionMs: 0 } : await capture(r.ownerSearchId, r.scope, job.controller.signal);
            if (closed)
                return;
            if (r.expectedScopeRevision !== null && r.expectedScopeRevision !== snapshot.fingerprint)
                throw new OperationError('query_scope_conflict', 'The public query data changed. Refresh the scope before running.');
            if (r.expectedScopeRevision === null && r.scope.kind !== 'result')
                throw new OperationError('query_scope_conflict', 'Read the scope revision before running.');
            if (job.controller.signal.aborted)
                throw new OperationError('query_cancelled', 'Query cancelled.');
            store.status(job.id, 'capturing', snapshot.id);
            const timing: QueryTiming = { captureMs: snapshot.captureMs, projectionMs: snapshot.projectionMs, queueMs: queuedMs, sqlMs: 0, totalMs: 0, rssKiB: 0, datasetCacheHit: false, resultCacheHit: false };
            const cached = job.validate ? undefined : store.cached(r.ownerSearchId, snapshot.id, r);
            if (cached) {
                const result = store.readResult(r.ownerSearchId, cached.id);
                timing.resultCacheHit = true;
                timing.totalMs = performance.now() - began;
                store.complete(job.id, result, timing);
                return;
            }
            const path = datasets.get(snapshot.id) ?? join(directory, `${randomUUID()}.sqlite`);
            const valid = datasets.has(snapshot.id) && existsSync(path);
            timing.datasetCacheHit = valid;
            job.path = path;
            job.process = runQueryChild({ path, cached: valid, sql: r.sql, params: r.params, validate: !!job.validate, batches: () => store.batches(snapshot.id), onRunning: () => { if (!closed)
                    store.status(job.id, 'running'); } });
            const outcome = await job.process.done;
            if (closed)
                return;
            if (outcome.error) {
                // SQL errors do not corrupt an already-built read-only dataset.
                if (!valid) removeFile(path);
                throw new OperationError(outcome.error.code, outcome.error.message);
            }
            datasets.set(snapshot.id, path);
            timing.sqlMs = outcome.sqlMs;
            timing.materializeMs = outcome.materializeMs;
            timing.serializationMs = outcome.serializationMs;
            timing.rssKiB = outcome.rssKiB;
            timing.totalMs = performance.now() - began;
            store.complete(job.id, outcome.result!, timing, !job.validate);
        }
        catch (e) {
            if (!closed) {
                const err = e instanceof OperationError ? e : new OperationError('query_failed', 'The query could not be completed.');
                store.fail(job.id, err.code, err.message);
            }
        }
        finally {
            active--;
            jobs.delete(job.id);
            job.settle?.();
            if (closed) {
                if (active === 0)
                    rmSync(directory, { recursive: true, force: true });
            }
            else {
                store.gc();
                clean();
                pump();
            }
        }
    }
    function pump() { while (!closed && active < queryLimits.processes && queue.length) {
        const job = queue.shift()!;
        active++;
        void run(job);
    } }
    function start(raw: unknown, validate = false) {
        requireRuntime();
        if (closed)
            throw new OperationError('query_interrupted', 'Query service is closed.');
        const r = queryStartSchema.parse(raw);
        store.checkScope(r.ownerSearchId, r.scope);
        // Reject capacity before creating a durable queued record. Identical retries
        // are looked up first by the store, without starting another child.
        const prior = store.prior(r);
        if (prior)
            return { executionId: prior.executionId };
        if (jobs.size >= queryLimits.queue + queryLimits.processes)
            throw new OperationError('query_capacity_exceeded', 'Query queue is full.');
        if (r.origin === 'editor' && [...jobs.values()].some(j => j.request.ownerSearchId === r.ownerSearchId && j.request.origin === 'editor'))
            throw new OperationError('query_capacity_exceeded', 'An editor query is already running for this search.');
        const { execution } = store.insert(r, validate);
        const job: Job = { id: execution.executionId, request: r, controller: new AbortController(), validate };
        jobs.set(job.id, job);
        queue.push(job);
        queueMicrotask(pump);
        return { executionId: job.id };
    }
    return {
        schema: () => ({ ...querySchema(), supported: queryRuntimeSupported() }),
        async context(ownerSearchId: string, scope: QueryStart['scope']) { requireRuntime(); store.gc(); clean(); const s = await capture(ownerSearchId, scope); return { snapshotId: s.id, scopeRevision: s.fingerprint, schemaVersion: 1, bytes: s.bytes, captureMs: s.captureMs, projectionMs: s.projectionMs }; },
        document: store.document, save: store.save, start,
        async validate(raw: unknown, signal?: AbortSignal) { signal?.throwIfAborted(); const v = queryValidateSchema.parse(raw); const { executionId } = start({ ...v, requestId: randomUUID(), origin: 'chat' }, true); const abort=()=>{void this.cancel(v.ownerSearchId,executionId).catch(()=>undefined);}; signal?.addEventListener('abort',abort,{once:true}); await new Promise<void>(resolve => { const job = jobs.get(executionId); if (job)
            job.settle = resolve;
        else
            resolve(); }); signal?.removeEventListener('abort',abort); signal?.throwIfAborted(); const result = store.get(v.ownerSearchId, executionId); if (result.error)
            throw new OperationError(result.error.code, result.error.message); return { columns: result.result?.columns ?? [], identityIndex: result.result?.identityIndex ?? null, snapshotId: result.snapshotId }; },
        get: store.get, page: store.page, opportunities: store.opportunityPage.bind(store), release: store.release,
        async cancel(ownerSearchId: string, executionId: string) { const execution = store.get(ownerSearchId, executionId), job = jobs.get(executionId); if (!job)
            return { state: execution.state }; job.controller.abort(); if (job.process)
            job.process.cancel(); const index = queue.indexOf(job); if (index >= 0) {
            queue.splice(index, 1);
            jobs.delete(executionId);
            store.fail(executionId, 'query_cancelled', 'Query cancelled.');
            job.settle?.();
            return { state: 'cancelled' };
        } await new Promise<void>(resolve => { const prior = job.settle; job.settle = () => { prior?.(); resolve(); }; }); return { state: store.get(ownerSearchId, executionId).state }; },
        async deleteSearch(ownerSearchId: string) { for (const j of [...jobs.values()])
            if (j.request.ownerSearchId === ownerSearchId)
                await this.cancel(ownerSearchId, j.id); },
        close() { closed = true; for (const entry of contexts.values())
            entry.controller.abort(); for (const j of jobs.values()) {
            j.controller.abort();
            j.process?.cancel();
            store.fail(j.id, 'query_interrupted', 'Query interrupted by runtime shutdown.');
            j.settle?.();
        } queue.length = 0; if (!active)
            rmSync(directory, { recursive: true, force: true }); }
    };
}
