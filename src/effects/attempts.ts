/**
 * Making an outward call answerable after a crash.
 *
 * The mechanism is an ordering, not a table. `begin` writes a row and commits
 * it; only then is the call made; only afterwards is the row settled. So the
 * three states on disk mean three different things, and the middle one is the
 * whole point:
 *
 *   no row         the call was never started.
 *   row, unsettled the call **may have happened and we cannot tell.**
 *   row, settled   we know how it ended.
 *
 * The middle state is not a retry signal. It is precisely the case where
 * retrying might send a second email, and the distance between "it failed" and
 * "we do not know" is the distance between recovering automatically and asking
 * a person. `guard` refuses to proceed on an unsettled row, and that refusal is
 * the feature.
 *
 * Which is why an error does **not** settle the row by default. A local
 * exception says the call threw here; it does not say the request never reached
 * the other end, and a timeout says the opposite. An effect that genuinely
 * knows better — a mail service answering `not_allowed` has plainly sent
 * nothing — declares it with `didNotHappen`, and only then is a failure
 * recorded as one.
 *
 * Nothing in this file retries. Retries belong to the effect that knows what is
 * retryable, and an unsettled attempt is by definition the one thing that is
 * not.
 */

import { createHash } from 'node:crypto';
import { RuntimeError } from '../contracts/index.js';
import type { AttemptLog, EffectCall } from '../contracts/index.js';

/**
 * A deterministic id for an attempt.
 *
 * Derived from the key rather than drawn at random, so a step re-running after
 * a resume computes the same id for the same call. It then collides with its
 * own earlier row — which is what `begin` looks for — instead of quietly
 * opening a second attempt at the same piece of work.
 */
export const attemptId = (idempotencyKey: string): string =>
  createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);

/**
 * Builds an idempotency key from the parts that identify one piece of work.
 *
 * Joined with a separator that cannot appear in a component, so
 * `['a', 'b:c']` and `['a:b', 'c']` are different keys. Getting that wrong is
 * how two unrelated calls come to share a row.
 */
export const idempotencyKeyFor = (parts: readonly string[]): string =>
  parts.map((part) => encodeURIComponent(part)).join(':');

export type GuardedRequest = {
  /** What is being called, e.g. `mail.send`. Recorded, and used in messages. */
  readonly effect: string;
  readonly idempotencyKey: string;
  /**
   * A summary of the request, and deliberately only a summary — a recipient
   * and a subject, never a body and never a credential. The attempt table is
   * for answering "did this happen", not for holding what was sent.
   */
  readonly request: Readonly<Record<string, unknown>>;
  /**
   * Whether this error proves the call never took place.
   *
   * Defaults to "nothing does", which is the conservative reading and the
   * correct one for a transport error: the socket closing here says nothing
   * about what the other end already did.
   */
  readonly didNotHappen?: (error: unknown) => boolean;
};

/**
 * Runs one outward call under an attempt record.
 *
 * The result type is constrained to a record because the guard stores the whole
 * result, not a summary of it — that is what lets a repeat of the same key be
 * answered from disk rather than by calling again. A guard that could not
 * replay would only be a log.
 */
export type Guard = <T extends Readonly<Record<string, unknown>>>(
  spec: GuardedRequest,
  call: EffectCall,
  perform: () => Promise<T>
) => Promise<T>;

export const createGuard = (log: AttemptLog, now: () => number = Date.now): Guard =>
  async <T extends Readonly<Record<string, unknown>>>(
    spec: GuardedRequest,
    call: EffectCall,
    perform: () => Promise<T>
  ): Promise<T> => {
    const id = attemptId(spec.idempotencyKey);

    const begun = log.begin({
      id,
      ...(call.runId ? { runId: call.runId } : {}),
      ...(call.step ? { step: call.step } : {}),
      effect: spec.effect,
      idempotencyKey: spec.idempotencyKey,
      request: spec.request,
      startedAt: now()
    });

    if (begun.existing) {
      if (begun.settledAt === undefined) {
        throw new RuntimeError(
          `${spec.effect} was already started for this request and never finished, so it `
            + 'may or may not have happened. Someone has to check before it is tried again.',
          'unsettled_attempt'
        );
      }

      // Settled, and the answer is on disk. Returning it is the point of
      // recording the result rather than a summary of it: the caller gets what
      // the first call returned, and the other end is not asked twice.
      if (begun.outcome === 'ok') return (begun.response ?? {}) as T;

      // A settled failure is a definite answer — the effect said so — so the
      // key stays spent. Nothing here reuses it, and nothing should: a fresh
      // run builds a fresh key, which is where a legitimate second try comes
      // from.
      throw new RuntimeError(
        `${spec.effect} was already attempted for this request and failed.`,
        'step_failed'
      );
    }

    let value: T;

    try {
      value = await perform();
    } catch (error) {
      if (spec.didNotHappen?.(error)) log.settle(id, 'failed', errorSummary(error));

      // Otherwise the row stays open on purpose. See the note at the top.
      throw error;
    }

    log.settle(id, 'ok', value);

    return value;
  };

/** A code and a short message. Never the underlying error's own text. */
const errorSummary = (error: unknown): Readonly<Record<string, unknown>> =>
  error instanceof RuntimeError
    ? { code: error.code, message: error.message }
    : { code: 'error' };
