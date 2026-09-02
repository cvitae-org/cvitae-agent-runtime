/**
 * Running one capability over many inputs.
 *
 * A batch is deliberately *not* a `Plan`. The obvious implementation — flatten
 * twenty offers into one plan of a hundred steps — breaks on the aggregator,
 * which shallow-merges outcomes into a single object: offer two's `company`
 * would overwrite offer one's, and there would be no honest place to put twenty
 * separate `degraded` lists. A batch is M plans, and it belongs above the
 * orchestrator rather than inside it.
 *
 * Results are handed back one at a time as they finish, not collected and
 * returned at the end. That is the whole design, and it is what makes a batch
 * safe to interrupt: the caller writes each offer to storage as it arrives, so
 * a connection dropped at offer twelve of twenty keeps the first eleven. There
 * is no job to resume because there is no state to lose — the offers that did
 * not run are simply still unanalysed, and running the batch again picks them
 * up. This is why the runtime needs no job store to survive a page reload.
 *
 * Emission order is completion order, not input order, which is why every item
 * carries its `index`.
 */

import { runPooled } from './pool.js';
import { RuntimeError } from './types.js';

/** One finished input. Failures are reported, never thrown. */
export type BatchItem<T = Record<string, unknown>> =
  | {
      index: number;
      status: 'ok';
      data: T;
      /** Non-critical steps that degraded within this one input. */
      degraded: string[];
      elapsedMs: number;
    }
  | {
      index: number;
      status: 'failed';
      reason: string;
      error: string;
    };

export type BatchSummary = {
  completed: number;
  failed: number;
  elapsedMs: number;
  /** True when the run was cut short; the untouched inputs simply did not run. */
  aborted: boolean;
};

/**
 * How many inputs to have in flight.
 *
 * This multiplies with step concurrency rather than replacing it — one offer is
 * already five parallel calls on a hosted provider — so the numbers stay small
 * on purpose. Two inputs is ten requests in the air, which is enough to overlap
 * the latency without turning a daily request quota into a thirty-second
 * spending spree.
 *
 * Local is 1 and should stay 1. A single GPU serialises the work whatever is
 * asked of it, and cvitae measured what firing everything at once actually does
 * there: a 4m39s run where one agent returned nothing at all. The value of a
 * batch against a local model is that it is unattended, not that it is faster.
 */
export const resolveBatchConcurrency = (
  providerId: string,
  requested?: number
): number => {
  if (requested !== undefined) return Math.max(1, Math.floor(requested));
  return providerId === 'local' ? 1 : 2;
};

const describe = (reason: unknown): string =>
  String(
    (reason as { message?: string } | null)?.message ?? reason ?? 'unknown error'
  ).slice(0, 300);

const reasonOf = (error: unknown): string =>
  error instanceof RuntimeError ? error.code : 'error';

/**
 * Runs `capability` over every input, emitting each result as it completes.
 *
 * `run` is the single-input entry point — normally `Runtime.run` — which keeps
 * this ignorant of planning, providers and storage. It only decides how many
 * run at once and what a failure means.
 *
 * One input failing never stops the batch. That is the difference between a
 * batch and a transaction: nineteen analysed offers and one error is a good
 * outcome, and discarding the nineteen because of the one is not.
 */
export const executeBatch = async <T = Record<string, unknown>>({
  inputs,
  run,
  concurrency,
  signal,
  timeoutMs,
  onItem
}: {
  inputs: unknown[];
  run: (
    input: unknown,
    index: number,
    signal: AbortSignal | undefined
  ) => Promise<{ data: T; degraded: string[]; elapsedMs: number }>;
  concurrency: number;
  signal?: AbortSignal;
  /** Bounds one input. Its clock starts when that input starts. */
  timeoutMs?: number;
  onItem: (item: BatchItem<T>) => void | Promise<void>;
}): Promise<BatchSummary> => {
  const startedAt = Date.now();
  let completed = 0;
  let failed = 0;

  const tasks = inputs.map((input, index) => async () => {
    // Checked per input rather than only at the top, so an abort stops the
    // queue rather than merely the item that was running when it fired.
    if (signal?.aborted) return;

    // Built here, inside the task, rather than once for the batch. With a
    // concurrency of one and twenty inputs the last one starts several minutes
    // in, and a timer started at the top would have expired long before it ever
    // ran — failing the tail of every long batch for taking too long over work
    // it had not begun.
    const deadline = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
    const itemSignal =
      deadline && signal
        ? AbortSignal.any([signal, deadline])
        : (deadline ?? signal);

    try {
      const result = await run(input, index, itemSignal);
      completed += 1;
      await onItem({
        index,
        status: 'ok',
        data: result.data,
        degraded: result.degraded,
        elapsedMs: result.elapsedMs
      });
    } catch (error) {
      // An abort of the *batch* is not this input failing — it is the batch
      // ending — and reporting it per input would put twenty spurious failures
      // in front of the user for one cancellation. An input's own deadline is
      // a real failure of that input, and is reported as one.
      if (signal?.aborted) return;

      failed += 1;
      await onItem({
        index,
        status: 'failed',
        // The orchestrator reports any abort as `aborted`, which here would be
        // indistinguishable from a cancellation the user asked for. Only the
        // deadline can have fired, so it is named.
        reason: deadline?.aborted ? 'timeout' : reasonOf(error),
        error: deadline?.aborted
          ? `The input exceeded its ${Math.round(timeoutMs! / 1000)}s budget.`
          : describe(error)
      });
    }
  });

  await runPooled(tasks, concurrency);

  return {
    completed,
    failed,
    elapsedMs: Date.now() - startedAt,
    aborted: Boolean(signal?.aborted)
  };
};
