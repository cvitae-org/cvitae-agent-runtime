/**
 * Runs tasks with at most `limit` in flight, and stops starting new ones the
 * moment the signal fires.
 *
 * The concurrency limit has to match what is on the other end. A hosted API
 * absorbs five calls at once; a single local GPU serialises them anyway, and
 * firing five together starves each one until requests drop — measured in the
 * previous runtime as a 4m39s run where one of five agents returned nothing at
 * all. Not slower: empty.
 *
 * `Promise.allSettled` would be the obvious substitute and is the wrong one on
 * both counts: it starts everything immediately, which is the failure above,
 * and it has no way to stop. The signal check between tasks is what makes a
 * critical failure cancel the work that has not started yet, rather than paying
 * for every remaining call and discarding the results.
 */

export type PooledTask<T> = (signal: AbortSignal) => Promise<T>;

export type PooledResult<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly reason: unknown }
  | { readonly status: 'skipped' };

export const runPooled = async <T>(
  tasks: readonly PooledTask<T>[],
  limit: number,
  signal: AbortSignal
): Promise<PooledResult<T>[]> => {
  const results: PooledResult<T>[] = new Array<PooledResult<T>>(tasks.length).fill({
    status: 'skipped'
  });

  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      // Checked before claiming the slot rather than after, so an abort during
      // the previous task leaves the next one genuinely unstarted.
      if (signal.aborted) return;

      const index = cursor++;
      const task = tasks[index];
      if (!task) continue;

      try {
        results[index] = { status: 'fulfilled', value: await task(signal) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  const workers = Math.max(1, Math.min(limit, tasks.length));
  await Promise.all(Array.from({ length: workers }, worker));

  return results;
};
