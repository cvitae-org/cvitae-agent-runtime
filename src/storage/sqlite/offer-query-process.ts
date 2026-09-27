import { fork, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProjectedOffer, QueryParams, QueryResult, QueryError } from '../../contracts/offer-query.js';
import { queryLimits } from '../../contracts/offer-query.js';
export const queryRuntimeSupported = () => process.platform === 'darwin' && (process.arch === 'arm64' || process.arch === 'x64') && /^24\.(1[4-9]|[2-9]\d)\./.test(process.versions.node);
export type ProcessResult = {
    result?: QueryResult;
    error?: QueryError;
    sqlMs: number;
    materializeMs?: number;
    serializationMs?: number;
    rssKiB: number;
};
export function runQueryChild(input: {
    path: string;
    cached: boolean;
    sql: string;
    params: QueryParams;
    validate: boolean;
    batches: () => AsyncGenerator<ProjectedOffer[]>;
    onRunning: () => void;
}) {
    const compiled = new URL('./offer-query-child.js', import.meta.url), entry = existsSync(compiled) ? compiled : new URL('./offer-query-child.ts', import.meta.url);
    const execArgv = ['--max-old-space-size=64', '--max-semi-space-size=4', '--no-warnings', ...(entry.pathname.endsWith('.ts') ? ['--import', fileURLToPath(import.meta.resolve('tsx'))] : [])];
    const child = fork(fileURLToPath(entry), [], { execPath: process.execPath, execArgv, env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let reason: QueryError | undefined, outcome: ProcessResult = { sqlMs: 0, rssKiB: 0 }, timer: NodeJS.Timeout, probing = false, closed = false;
    const stop = (code: string, message: string) => { if (reason || closed)
        return; reason = { code, message }; child.kill('SIGKILL'); };
    const reset = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => stop('query_timeout', 'Query time limit exceeded.'), ms); };
    reset(queryLimits.captureMs);
    const generator = input.batches();
    const done = new Promise<ProcessResult>((resolve) => {
        child.on('error', () => stop('query_failed', 'The query process could not start.'));
        child.on('message', async (raw: unknown) => {
            if (reason || closed)
                return;
            const m = raw as {
                type: string;
                result?: QueryResult;
                error?: QueryError;
                sqlMs?: number;
                materializeMs?: number;
                serializationMs?: number;
            };
            if (m.type === 'ready') {
                try {
                    const b = await generator.next();
                    if (reason || closed)
                        return;
                    child.send(b.done ? { type: 'end' } : { type: 'batch', offers: b.value }, e => { if (e)
                        stop('query_failed', 'Dataset transfer failed.'); });
                }
                catch {
                    stop('query_capacity_exceeded', 'The scoped dataset exceeds capacity.');
                }
            }
            else if (m.type === 'running') {
                reset(queryLimits.executionMs);
                input.onRunning();
            }
            else if (m.type === 'result')
                outcome = { ...outcome, result: m.result, sqlMs: m.sqlMs ?? 0, materializeMs: m.materializeMs, serializationMs: m.serializationMs };
            else if (m.type === 'error')
                outcome = { ...outcome, error: m.error };
        });
        child.on('close', () => { closed = true; clearTimeout(timer); clearInterval(monitor); void generator.return(undefined); resolve({ ...outcome, error: reason ?? outcome.error ?? (!outcome.result ? { code: 'query_failed', message: 'The query process exited without a result.' } : undefined) }); });
    });
    const monitor = setInterval(() => { if (probing || closed)
        return; probing = true; try {
        execFile('/bin/ps', ['-o', 'rss=', '-p', String(child.pid)], { timeout: 500 }, (e, out) => { probing = false; if (closed || reason || outcome.result || outcome.error || child.exitCode !== null || child.signalCode !== null)
            return; if (e) {
            stop('query_monitor_failed', 'Query resource monitoring is unavailable.');
            return;
        } const rss = Number(out.trim()); if (!Number.isFinite(rss) || rss <= 0) {
            stop('query_monitor_failed', 'Query resource monitoring is unavailable.');
            return;
        } outcome.rssKiB = Math.max(outcome.rssKiB, rss); if (rss > queryLimits.rssKiB)
            stop('query_memory_limit', 'Query memory limit exceeded.'); });
    }
    catch {
        probing = false;
        stop('query_monitor_failed', 'Query resource monitoring is unavailable.');
    } }, 25);
    child.send({ type: 'init', path: input.path, cached: input.cached, sql: input.sql, params: input.params, validate: input.validate }, e => { if (e)
        stop('query_failed', 'The query process could not start.'); });
    return { done, cancel: () => stop('query_cancelled', 'Query cancelled.') };
}
