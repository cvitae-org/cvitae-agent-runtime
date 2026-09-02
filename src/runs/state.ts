/**
 * The legal shapes of a run's life.
 *
 * Written out as a table rather than left implicit in the code that performs
 * the transitions, because the interesting question is not "what does this
 * function do next" but "can a run that is already finished be marked finished
 * again". A resume that races a cancellation, an adapter that retries a
 * checkpoint, a crash recovery that re-reads a run someone else already
 * settled — each of those arrives as a transition request, and the table is
 * what answers it in one place.
 *
 * Terminal states have no outgoing edges at all. That is the property worth
 * having: once a caller has been told a run succeeded, nothing can quietly
 * reopen it.
 */

import { RuntimeError } from '../contracts/index.js';
import type { RunStatus } from '../contracts/index.js';

const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['running', 'cancelled', 'failed'],
  /** `suspended` is reached from here and only from here: a step asked. */
  running: ['suspended', 'succeeded', 'failed', 'cancelled'],
  /** A suspended run resumes into `running`, or is abandoned. */
  suspended: ['running', 'cancelled', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: []
};

export const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'succeeded',
  'failed',
  'cancelled'
]);

export const isTerminal = (status: RunStatus): boolean => TERMINAL.has(status);

export const canTransition = (from: RunStatus, to: RunStatus): boolean =>
  (TRANSITIONS[from] ?? []).includes(to);

/**
 * Throws rather than returning false, because every caller of this is about to
 * write and none of them has a sensible way to continue without doing so.
 */
export const assertTransition = (runId: string, from: RunStatus, to: RunStatus): void => {
  if (canTransition(from, to)) return;

  throw new RuntimeError(
    isTerminal(from)
      ? `Run ${runId} already ended as "${from}"; it cannot become "${to}".`
      : `Run ${runId} cannot move from "${from}" to "${to}".`,
    'invalid_transition'
  );
};
