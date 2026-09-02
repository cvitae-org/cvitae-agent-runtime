/**
 * `AiLog` over SQLite: one row per model call, metadata only.
 *
 * `record` is synchronous and unbuffered, which sounds wrong for a log and is
 * not. The thing being logged is a model call — a hundred milliseconds at best,
 * thirty seconds against a local model — and the insert beside it is measured
 * in microseconds on a connection this process already holds open. A queue
 * would buy nothing measurable and would cost the one property that makes the
 * log worth having: a call that crashed the process is still on disk.
 *
 * It also never throws. A logger that can fail a run is a worse trade than a
 * missing line, and the cases that would throw here — a closed database, a full
 * disk — are ones the run is about to discover for itself anyway.
 */

import type { AiCall, AiLog, AiLogEntry, FinishReason } from '../../contracts/index.js';
import type { Db } from './open.js';

type CallRow = {
  id: number;
  at: number;
  trace_id: string;
  run_id: string | null;
  step: string | null;
  operation: string;
  provider_id: string;
  model_id: string;
  prompt_chars: number;
  input_bytes: number | null;
  completion_chars: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number;
  finish_reason: string | null;
  outcome: string;
  error_code: string | null;
};

/**
 * Every optional field is omitted rather than set to `null` or `0`.
 *
 * Hence the spread-conditionals: `noUncheckedIndexedAccess` and
 * `exactOptionalPropertyTypes` aside, a provider that reports no token counts
 * and one that reports zero are different facts, and the difference decides
 * whether a total across a run is a total or a guess. `AiLogEntry` says so with
 * optional fields; this is the half of that claim the row has to keep.
 */
const toCall = (row: CallRow): AiCall => ({
  id: row.id,
  at: row.at,
  traceId: row.trace_id,
  ...(row.run_id === null ? {} : { runId: row.run_id }),
  ...(row.step === null ? {} : { step: row.step }),
  operation: row.operation as AiLogEntry['operation'],
  providerId: row.provider_id,
  modelId: row.model_id,
  promptChars: row.prompt_chars,
  ...(row.input_bytes === null ? {} : { inputBytes: row.input_bytes }),
  completionChars: row.completion_chars,
  usage: {
    ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
    ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
    ...(row.total_tokens === null ? {} : { totalTokens: row.total_tokens })
  },
  latencyMs: row.latency_ms,
  ...(row.finish_reason === null ? {} : { finishReason: row.finish_reason as FinishReason }),
  outcome: row.outcome as AiLogEntry['outcome'],
  ...(row.error_code === null ? {} : { errorCode: row.error_code })
});

/** What `recent` returns when a caller does not say. Enough to read, not to page. */
const RECENT = 100;

export const createAiLog = (db: Db): AiLog => {
  const insert = db.prepare(
    `INSERT INTO ai_calls
       (at, trace_id, run_id, step, operation, provider_id, model_id,
        prompt_chars, input_bytes, completion_chars,
        input_tokens, output_tokens, total_tokens,
        latency_ms, finish_reason, outcome, error_code)
     VALUES
       (:at, :traceId, :runId, :step, :operation, :providerId, :modelId,
        :promptChars, :inputBytes, :completionChars,
        :inputTokens, :outputTokens, :totalTokens,
        :latencyMs, :finishReason, :outcome, :errorCode)`
  );

  const forRun = db.prepare<[string]>(
    'SELECT * FROM ai_calls WHERE run_id = ? ORDER BY at, id'
  );

  const recent = db.prepare<[number]>(
    'SELECT * FROM ai_calls ORDER BY at DESC, id DESC LIMIT ?'
  );

  const prune = db.prepare<[number]>('DELETE FROM ai_calls WHERE at < ?');

  return {
    record(entry) {
      try {
        insert.run({
          at: entry.at,
          traceId: entry.traceId,
          runId: entry.runId ?? null,
          step: entry.step ?? null,
          operation: entry.operation,
          providerId: entry.providerId,
          modelId: entry.modelId,
          promptChars: entry.promptChars,
          inputBytes: entry.inputBytes ?? null,
          completionChars: entry.completionChars,
          inputTokens: entry.usage.inputTokens ?? null,
          outputTokens: entry.usage.outputTokens ?? null,
          totalTokens: entry.usage.totalTokens ?? null,
          latencyMs: entry.latencyMs,
          finishReason: entry.finishReason ?? null,
          outcome: entry.outcome,
          errorCode: entry.errorCode ?? null
        });
      } catch (error) {
        // The message only, and to stderr — stdout is the host's transport.
        // See the note above on why this is swallowed rather than raised.
        console.warn(
          `AI call not logged: ${String((error as Error)?.message ?? error)}`
        );
      }
    },

    forRun(runId) {
      return (forRun.all(runId) as CallRow[]).map(toCall);
    },

    recent(limit = RECENT) {
      return (recent.all(limit) as CallRow[]).map(toCall);
    },

    prune(at) {
      return prune.run(at).changes;
    }
  };
};
