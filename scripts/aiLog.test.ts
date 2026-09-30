/**
 * What the model-call log is allowed to remember, and what it must not.
 *
 * The privacy property is the reason this file exists and the reason it is
 * blunt about it: the table has no column that can hold a prompt, a completion,
 * a tool argument or a provider's error message. That is not a convention
 * someone has to keep — it is asserted here against `PRAGMA table_info`, so a
 * migration that adds a `prompt` column fails a test rather than quietly
 * shipping a second copy of the user's CV inside the application's database.
 *
 * The rest is about the two things a log gets read for. Token counts have to
 * come back absent when the provider reported none, because a run's total is
 * either a total or a guess and zero would silently make it the second. And a
 * failed write has to stay inside the logger: the run it is describing is worth
 * more than the line about it.
 *
 * Mutations run, not assumed:
 *
 *   absent tokens read back as 0          1  a provider that reports no tokens…
 *   `record` rethrowing instead of warning 1  a log that cannot write…
 *   `forRun` ordered by `at DESC`          1  a run's calls come back oldest…
 *   `prune` using `<=` instead of `<`      1  pruning keeps the boundary…
 *   `echo` replacing the table             1  the desktop host keeps…
 *   no prune when the runtime opens        1  the desktop host keeps…
 *   `aiLine` without the error code        2  a failed line names…, the desktop host…
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiLog } from '../src/storage/sqlite/ai-log.js';
import { aiLine, createHarness, silentLogger } from '../src/runtime/create.js';
import { CV_ID, CV_KIND, cvDocumentSchema } from '../src/capabilities/cv/document.js';
import type { AiLogEntry } from '../src/contracts/index.js';
import { scratch } from './support/db.js';

const entry = (over: Partial<AiLogEntry> = {}): AiLogEntry => ({
  at: 1_000,
  traceId: 'trace-1',
  runId: 'run-1',
  step: 'extract',
  operation: 'object',
  providerId: 'ollama',
  modelId: 'gemma4:12b',
  promptChars: 4_200,
  completionChars: 380,
  usage: { inputTokens: 1_100, outputTokens: 96, totalTokens: 1_196 },
  latencyMs: 8_430,
  finishReason: 'stop',
  outcome: 'ok',
  ...over
});

test('a call goes in and comes back whole', () => {
  const s = scratch();

  try {
    const log = createAiLog(s.db);
    log.record(entry());

    const [call] = log.forRun('run-1');
    assert.ok(call);

    const { id, ...rest } = call;
    assert.ok(Number.isInteger(id));
    assert.deepEqual(rest, entry());
  } finally {
    s.dispose();
  }
});

test('a provider that reports no tokens is not a provider that reported zero', () => {
  const s = scratch();

  try {
    const log = createAiLog(s.db);
    log.record(entry({ usage: {} }));

    const [call] = log.forRun('run-1');
    // Absent, not 0. A sum across a run is a total or it is a guess, and the
    // difference is only visible if the missing value stays missing.
    assert.deepEqual(call?.usage, {});
    assert.equal(call?.usage.outputTokens, undefined);
  } finally {
    s.dispose();
  }
});

test('a failure is logged with its code and nothing of the message', () => {
  const s = scratch();

  try {
    const log = createAiLog(s.db);
    log.record(entry({ outcome: 'failed', errorCode: 'model_unavailable', completionChars: 0 }));

    const [call] = log.forRun('run-1');
    assert.equal(call?.outcome, 'failed');
    assert.equal(call?.errorCode, 'model_unavailable');
    assert.equal(call?.finishReason, 'stop');
  } finally {
    s.dispose();
  }
});

test('the row cannot hold a prompt, a completion or an error message', () => {
  const s = scratch();

  try {
    const columns = (s.db.prepare('SELECT name FROM pragma_table_info(?)').all('ai_calls') as {
      name: string;
    }[]).map((row) => row.name);

    // Stated as an exact set rather than a list of things to avoid. A column
    // added by a later migration shows up here as a failure and has to be
    // argued for, which is the point — "no payloads" is easy to agree with and
    // easy to erode one convenient field at a time.
    assert.deepEqual(new Set(columns), new Set([
      'id', 'at', 'trace_id', 'run_id', 'step', 'operation',
      'provider_id', 'model_id', 'prompt_chars', 'input_bytes',
      'completion_chars', 'input_tokens', 'output_tokens', 'total_tokens',
      'latency_ms', 'finish_reason', 'outcome', 'error_code'
    ]));
  } finally {
    s.dispose();
  }
});

test("a run's calls come back oldest first, and only that run's", () => {
  const s = scratch();

  try {
    const log = createAiLog(s.db);
    log.record(entry({ at: 3_000, step: 'third' }));
    log.record(entry({ at: 1_000, step: 'first' }));
    log.record(entry({ at: 2_000, step: 'second' }));
    log.record(entry({ at: 2_500, runId: 'run-2', step: 'elsewhere' }));

    assert.deepEqual(
      log.forRun('run-1').map((call) => call.step),
      ['first', 'second', 'third']
    );
  } finally {
    s.dispose();
  }
});

test('a call made outside a run is still logged, and belongs to no run', () => {
  const s = scratch();

  try {
    const log = createAiLog(s.db);
    // Retrieval embeds under its own trace with no run around it. That call
    // costs the same as any other and has to be countable.
    log.record(entry({ traceId: 'retrieval', operation: 'embed', ...{ runId: undefined } }));

    assert.deepEqual(log.forRun('run-1'), []);

    const [call] = log.recent();
    assert.equal(call?.runId, undefined);
    assert.equal(call?.traceId, 'retrieval');
  } finally {
    s.dispose();
  }
});

test('recent is newest first and stops where it is told to', () => {
  const s = scratch();

  try {
    const log = createAiLog(s.db);
    for (const at of [1_000, 2_000, 3_000]) log.record(entry({ at }));

    assert.deepEqual(log.recent().map((call) => call.at), [3_000, 2_000, 1_000]);
    assert.deepEqual(log.recent(2).map((call) => call.at), [3_000, 2_000]);
  } finally {
    s.dispose();
  }
});

test('pruning keeps the boundary and reports what it dropped', () => {
  const s = scratch();

  try {
    const log = createAiLog(s.db);
    for (const at of [1_000, 2_000, 3_000]) log.record(entry({ at }));

    // `before 2_000` means older than 2_000. The call logged exactly at the
    // cut is inside the retention window, not on the wrong side of it.
    assert.equal(log.prune(2_000), 1);
    assert.deepEqual(log.recent().map((call) => call.at), [3_000, 2_000]);
    assert.equal(log.prune(2_000), 0);
  } finally {
    s.dispose();
  }
});

test('a log that cannot write does not take the run down with it', () => {
  const s = scratch();
  const log = createAiLog(s.db);
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (message: string) => void warnings.push(message);

  try {
    s.db.close();

    // The gateway calls this from inside the try that wraps a model call. A
    // throw here would surface as the call itself having failed, which is a
    // lie about the one thing the log exists to report accurately.
    assert.doesNotThrow(() => log.record(entry()));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /not logged/);
  } finally {
    console.warn = warn;
    s.dispose();
  }
});

test('a failed line names its code, and an ok line its tokens', () => {
  assert.equal(
    aiLine(entry()),
    'object ollama/gemma4:12b step=extract in=4200c out=380c out=96t 8430ms finish=stop ok'
  );
  assert.match(
    aiLine(entry({ outcome: 'failed', errorCode: 'credential_rejected', usage: {}, completionChars: 0 })),
    / failed=credential_rejected$/
  );
});

test('the desktop host keeps each call in the table as well as echoing it, and prunes by age', async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_000 * DAY;
  const dir = mkdtempSync(join(tmpdir(), 'ai-calls-host-'));
  const databasePath = join(dir, 'runtime.db');
  const quiet = { env: {}, probe: () => Promise.reject(new Error('no local server in these tests')) };

  // Two calls from an earlier session: one older than the host keeps, one not.
  const earlier = createHarness({ ...quiet, databasePath, logger: silentLogger });
  earlier.aiCalls.record(entry({ at: now - 91 * DAY, runId: 'expired' }));
  earlier.aiCalls.record(entry({ at: now - DAY, runId: 'kept' }));
  earlier.close();

  const echoed: AiLogEntry[] = [];
  // The shape `adapters/stdio/main.ts` opens with. A hosted embedder with no
  // key is a real call that fails the same way every time, and dials nothing.
  const harness = createHarness({
    ...quiet,
    env: { EMBEDDING_PROVIDER: 'openai' },
    databasePath,
    echo: { record: (call) => void echoed.push(call) },
    aiCallsKeptMs: 90 * DAY,
    now: () => now,
    indexRecovery: true
  });

  try {
    assert.deepEqual(harness.aiCalls.recent().map((call) => call.runId), ['kept']);

    harness.documents.update(CV_ID, CV_KIND, () => cvDocumentSchema.parse({
      role_description: 'An engineer building resilient TypeScript services for customers.'
    }));
    for (let i = 0; i < 100 && echoed.length === 0; i++) await new Promise((done) => setTimeout(done, 50));

    const [call] = echoed;
    assert.ok(call, 'the rebuild made a call');
    assert.equal(call.operation, 'embed');
    assert.equal(call.outcome, 'failed');
    assert.equal(call.errorCode, 'misconfigured');
    assert.match(aiLine(call), / failed=misconfigured$/);

    const [stored] = harness.aiCalls.recent(1);
    assert.ok(stored, 'the table has the call the echo saw');
    const { id, ...row } = stored;
    assert.ok(Number.isInteger(id));
    assert.deepEqual(row, call);
  } finally {
    harness.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
