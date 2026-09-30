import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { queryRuntimeSupported } from '../src/storage/sqlite/offer-query-process.js';
test('real stdio query schema/context/start/page/cancel and restart', { skip: !queryRuntimeSupported(), timeout: 20000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'query-stdio-'));
    const entry = process.env.QUERY_STDIO_ENTRY ?? fileURLToPath(new URL('../dist/adapters/stdio/main.js', import.meta.url));
    assert.ok(existsSync(entry), 'Build runtime before stdio integration');
    let seq = 0;
    const boot = () => {
        const child = spawn(process.execPath, [entry], { cwd: dir, env: { PATH: '/usr/bin:/bin', CVITAE_DB: join(dir, 'db'), ENV_FILE: join(dir, 'no-env-file') }, stdio: ['pipe', 'pipe', 'pipe'] });
        const pending = new Map<string, {
            resolve: (v: Record<string, unknown>) => void;
            reject: (e: Error) => void;
        }>();
        let buffer = '';
        child.stdout.on('data', bytes => { buffer += String(bytes); while (buffer.includes('\n')) {
            const index = buffer.indexOf('\n'), line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            const frame = JSON.parse(line) as {
                id: string;
                ok: boolean;
                data: Record<string, unknown>;
                error: unknown;
            };
            const p = pending.get(frame.id);
            if (p) {
                pending.delete(frame.id);
                if (frame.ok)
                    p.resolve(frame.data);
                else
                    p.reject(Error(JSON.stringify(frame.error)));
            }
        } });
        child.on('exit', () => { for (const p of pending.values())
            p.reject(Error('Host exited')); });
        return { async call(channel: string, payload: unknown = {}) { const id = String(++seq); const result = new Promise<Record<string, unknown>>((resolve, reject) => pending.set(id, { resolve, reject })); child.stdin.write(JSON.stringify({ id, channel, payload }) + '\n'); return result; }, async close() { const closed = new Promise(resolve => child.once('close', resolve)); child.stdin.end(); await closed; }, child };
    };
    let host = boot();
    try {
        assert.equal((await host.call('offers.query.schema')).schemaVersion, 1);
        assert.equal(((await host.call('bridge.hello')).offerQuery as {
            supported: boolean;
        }).supported, true);
        const identity = { id: 's', importKey: 'i' };
        await host.call('discovery.searches.import.begin', { ...identity, phrase: 'React', boards: ['vacancies'], filters: {}, rowCount: 50 });
        await host.call('discovery.searches.import.append', { ...identity, offset: 0, items: Array.from({ length: 50 }, (_, i) => ({ offer: { id: `s-${i}`, text: 'Published React', stated: { title: 'React' } } })) });
        await host.call('discovery.searches.import.finish', identity);
        const scope = { kind: 'search', searchId: 's' }, ctx = await host.call('offers.query.context', { ownerSearchId: 's', scope });
        const base = { ownerSearchId: 's', scope, schemaVersion: 1, expectedScopeRevision: ctx.scopeRevision, snapshotId: ctx.snapshotId };
        const first = await host.call('offers.query.start', { ...base, requestId: 'query-1', sql: 'SELECT o.offer_id FROM offers o ORDER BY o.offer_id' });
        let info;
        do {
            await delay(5);
            info = await host.call('offers.query.get', { ownerSearchId: 's', executionId: first.executionId });
        } while (['queued', 'capturing', 'running'].includes(String(info.state)));
        assert.equal(info.state, 'succeeded', JSON.stringify(info));
        assert.equal(((await host.call('offers.query.page', { ownerSearchId: 's', executionId: first.executionId, limit: 10 })).rows as unknown[]).length, 10);
        const expensive = await host.call('offers.query.start', { ...base, requestId: 'query-2', sql: 'SELECT sum(length(a.offer_id)+length(b.offer_id)+length(c.offer_id)+length(d.offer_id)) FROM offers a,offers b,offers c,offers d' });
        do {
            await delay(5);
            info = await host.call('offers.query.get', { ownerSearchId: 's', executionId: expensive.executionId });
        } while (info.state === 'queued' || info.state === 'capturing');
        assert.equal(info.state, 'running');
        assert.equal((await host.call('offers.query.cancel', { ownerSearchId: 's', executionId: expensive.executionId })).state, 'cancelled');
        await host.close();
        host = boot();
        assert.equal(((await host.call('offers.query.page', { ownerSearchId: 's', executionId: first.executionId, limit: 10 })).rows as unknown[]).length, 10);
    }
    finally {
        await host.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
