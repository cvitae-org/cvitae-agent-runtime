import { createHarness } from '../src/runtime/create.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const report: unknown[] = [];
for (const count of [1000, 10000, 50000]) {
    const dir = mkdtempSync(join(tmpdir(), 'offer-query-benchmark-'));
    const h = createHarness({ databasePath: join(dir, 'runtime.db'), env: {}, scraperUrl: '' });
    const began = performance.now();
    let heartbeats = 0;
    const pulse = setInterval(() => heartbeats++, 10);
    let captureStarted: number | undefined;
    try {
        const identity = { id: 'bench', importKey: 'synthetic' };
        h.discoverySearches.begin({ ...identity, phrase: 'React', boards: ['vacancies'], filters: {}, rowCount: count });
        const description = 'Published React, TypeScript, C++, C# and .NET role in Kraków. Build interfaces, maintain services and collaborate with a distributed engineering team. '.repeat(8);
        for (let i = 0; i < count; i += 50) {
            h.discoverySearches.append({ ...identity, offset: i, items: Array.from({ length: Math.min(50, count - i) }, (_, j) => ({ offer: { id: `offer-${String(i + j).padStart(6, '0')}`, board: 'vacancies', text: description, stated: { title: 'React Developer', company: `Company ${(i + j) % 100}`, location: 'Kraków', work_mode: 'remote', required_skills: ['React', 'C++'], salary_ranges: [{ min: 20000, max: 25000, currency: 'PLN', period: 'month', contractType: 'B2B', rawText: '20–25k PLN' }, { min: 15000, max: 18000, currency: 'PLN', period: 'month', contractType: 'UoP', rawText: '15–18k PLN' }] } } })) });
            await delay(0);
        }
        h.discoverySearches.finish(identity);
        const ingestMs = performance.now() - began;
        const scope = { kind: 'search' as const, searchId: 'bench' };
        let t = performance.now();
        captureStarted = t;
        const context = await h.offerQueries.context('bench', scope);
        const captureMs = performance.now() - t;
        const samples = [];
        for (const sql of ["SELECT o.offer_id,o.company FROM offers o WHERE o.work_mode='remote' ORDER BY o.offer_id LIMIT 100", "SELECT o.offer_id,o.company FROM offers o WHERE o.work_mode='remote' ORDER BY o.offer_id LIMIT 99", "SELECT o.offer_id,o.company FROM offers o WHERE o.work_mode='remote' ORDER BY o.offer_id LIMIT 99"]) {
            t = performance.now();
            const { executionId } = h.offerQueries.start({ ownerSearchId: 'bench', requestId: randomUUID(), sql, scope, schemaVersion: 1, expectedScopeRevision: context.scopeRevision, snapshotId: context.snapshotId });
            let execution;
            do {
                await delay(5);
                execution = h.offerQueries.get('bench', executionId);
            } while (['queued', 'capturing', 'running'].includes(execution.state));
            const beforePage = performance.now();
            const page = execution.state === 'succeeded' ? h.offerQueries.page('bench', executionId, undefined, 100) : null;
            samples.push({ wallMs: performance.now() - t, pageMs: performance.now() - beforePage, rows: page?.rows.length, state: execution.state, error: execution.error, timing: execution.timing });
        }
        report.push({ count, descriptionCharacters: description.length, ingestMs, captureMs, projectionMs: context.projectionMs, datasetBytes: context.bytes, samples, heartbeats });
    }
    catch (e) {
        report.push({ count, captureMs: captureStarted === undefined ? null : performance.now() - captureStarted, totalMs: performance.now() - began, error: { code: (e as {
                    code?: string;
                }).code, message: (e as Error).message }, heartbeats });
    }
    finally {
        clearInterval(pulse);
        h.close();
        rmSync(dir, { recursive: true, force: true });
    }
    console.log(JSON.stringify(report.at(-1)));
}
const out = { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, memoryBytes: totalmem(), at: new Date().toISOString(), results: report };
writeFileSync(process.env.QUERY_BENCHMARK_REPORT ?? '/tmp/offer-query-benchmark.json', JSON.stringify(out, null, 2) + '\n');
