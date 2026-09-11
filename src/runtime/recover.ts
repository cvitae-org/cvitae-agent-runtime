/**
 * Settles runs whose owning process disappeared.
 *
 * Recovery is deliberately a write, not a retry. Once a process dies during an
 * effect, the only truthful statement is that the run was interrupted; replaying
 * it could repeat work whose outcome never made it back to SQLite.
 */

import type { NewEvent, RunRecord, RunStore, StepPatch } from '../contracts/index.js';
import * as emit from '../events/emit.js';

const MESSAGE = 'The process ended while this run was active. Nothing was retried.';

export const recoverInterruptedRuns = (
  runs: RunStore,
  clock: (() => number) | undefined = undefined
): readonly RunRecord[] => {
  const now = clock ?? Date.now;
  const recovered: RunRecord[] = [];

  for (const stale of runs.interrupted()) {
    // Re-read immediately before the transaction. Another host may have settled
    // the run after `interrupted()` returned; terminal state always wins.
    const status = runs.get(stale.id)?.status;
    if (status !== 'running' && status !== 'queued') continue;

    const at = now();
    const patches: StepPatch[] = [];
    const events: NewEvent[] = [];

    for (const step of runs.steps(stale.id)) {
      if (step.status === 'running') {
        patches.push({ name: step.name, status: 'stopped', endedAt: at });
        events.push(
          emit.stepStopped(step, Math.max(0, at - (step.startedAt ?? at)), at)
        );
      } else if (step.status === 'pending') {
        patches.push({ name: step.name, status: 'skipped', endedAt: at });
        events.push(emit.stepSkipped(step, at));
      }
    }

    runs.checkpoint(
      {
        runId: stale.id,
        run: {
          status: 'failed',
          errorCode: 'process_interrupted',
          errorMessage: MESSAGE,
          endedAt: at
        },
        steps: patches
      },
      [...events, emit.runFailed({ code: 'process_interrupted', message: MESSAGE }, at)]
    );

    const record = runs.get(stale.id);
    if (record) recovered.push(record);
  }

  return recovered;
};
