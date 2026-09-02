/**
 * Sequence numbers, under real contention.
 *
 * Four processes append to the same run at once. The assertion is not that the
 * writes succeed — it is that the numbers come out 1..N with no gap and no
 * repeat, which is only true if the read of `max(seq)` and the insert that uses
 * it happen under the same write lock.
 *
 * Confirmed by hoisting that read out of the transaction: four processes then
 * agree on the same next number and the loser dies on
 * `SQLITE_CONSTRAINT_PRIMARYKEY`. Loud, but only because the primary key is
 * `(run_id, seq)` — without it the two would simply have collided in silence.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createEventLog } from '../src/storage/sqlite/event-log.js';
import { createRunStore } from '../src/storage/sqlite/run-store.js';
import { scratch, seedRun } from './support/db.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

test('seq is gapless and unique across four writing processes', async () => {
  const s = scratch();
  const events = createEventLog(s.db);

  try {
    seedRun(s.db, 'busy');

    const writers = 4;
    const each = 25;

    await Promise.all(
      Array.from({ length: writers }, () =>
        run(process.execPath, [
          '--import',
          'tsx',
          join(here, 'support/worker.ts'),
          'events',
          s.path,
          'busy',
          String(each)
        ])
      )
    );

    const all = events.since('busy', 0, 10_000);
    assert.equal(all.length, writers * each);

    const seqs = all.map((e) => e.seq);
    assert.deepEqual(
      seqs,
      Array.from({ length: writers * each }, (_, i) => i + 1),
      'sequence numbers must be 1..N in order, with no gaps or duplicates'
    );

    // All four processes really did write, so the interleaving was real.
    const pids = new Set(all.map((e) => e.data.pid));
    assert.equal(pids.size, writers);
  } finally {
    s.dispose();
  }
});

test('since() resumes from a cursor without replaying or skipping', () => {
  const s = scratch();
  const events = createEventLog(s.db);
  const runs = createRunStore(s.db);

  try {
    seedRun(s.db, 'tail');
    assert.equal(events.latest('tail'), 0);

    for (let i = 0; i < 10; i += 1) {
      runs.checkpoint({ runId: 'tail' }, [{ at: Date.now(), type: 'step.started', data: { i } }]);
    }

    // A caller following progress holds the last seq it saw and asks for what
    // came after. Pages must abut exactly: an overlap replays work to the user,
    // a gap loses it.
    const first = events.since('tail', 0, 4);
    assert.deepEqual(first.map((e) => e.seq), [1, 2, 3, 4]);

    const next = events.since('tail', 4, 4);
    assert.deepEqual(next.map((e) => e.seq), [5, 6, 7, 8]);

    const rest = events.since('tail', 8, 100);
    assert.deepEqual(rest.map((e) => e.seq), [9, 10]);

    assert.equal(events.latest('tail'), 10);
    assert.deepEqual(events.since('tail', 10, 100), []);
  } finally {
    s.dispose();
  }
});
