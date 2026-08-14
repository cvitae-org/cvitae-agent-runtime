/**
 * Runs tasks with at most `limit` in flight.
 *
 * Lifted from cvitae's offer analysis, where the comment earned itself:
 * concurrency has to match what is on the other end. A hosted API absorbs five
 * calls at once; a single local GPU serialises them anyway, and firing five
 * together just starves each one until requests drop — measured there as a
 * 4m39s run where one agent returned nothing at all.
 *
 * `Promise.allSettled` would be the obvious substitute and is the wrong one: it
 * starts everything immediately, which is exactly the failure above.
 */
export const runPooled = async <T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<PromiseSettledResult<T>[]> => {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      const task = tasks[index];
      if (!task) continue;

      try {
        results[index] = { status: 'fulfilled', value: await task() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker)
  );

  return results;
};
