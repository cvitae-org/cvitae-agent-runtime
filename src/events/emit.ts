/**
 * Constructors for events on their way to being written.
 *
 * Every one of these returns a value and none of them writes. That is not a
 * stylistic choice — `RunStore.checkpoint` is the only path to the `events`
 * table, and it takes the events alongside the state change they announce. A
 * module here that could append on its own would eventually record a step
 * whose state was never saved, and a caller tailing the log would be shown
 * work that did not happen.
 *
 * The `data` payloads carry counts, names, codes and durations. They do not
 * carry prompts, completions, documents or offer text: the event log is
 * something a user can be shown and something a bug report can include, and it
 * stops being either the moment it contains the CV.
 */

import type { NewEvent, RunEventType, StepRef } from '../contracts/index.js';

const event = (
  type: RunEventType,
  data: Readonly<Record<string, unknown>> = {},
  step?: string,
  at: number = Date.now()
): NewEvent => (step === undefined ? { at, type, data } : { at, type, step, data });

/* --------------------------------------------------------------------- run */

export const runQueued = (capability: string, at?: number): NewEvent =>
  event('run.queued', { capability }, undefined, at);

export const runStarted = (
  describe: { providerId: string; modelId: string } | undefined,
  at?: number
): NewEvent => event('run.started', describe ? { ...describe } : {}, undefined, at);

/**
 * Emitted once the plan is known, and carrying its shape rather than its
 * contents: a caller can render a progress bar from this, and nothing in it is
 * derived from the user's data.
 */
export const runPlanned = (
  plan: { source: string; stages: readonly { name: string; steps: number }[] },
  at?: number
): NewEvent =>
  event(
    'run.planned',
    {
      source: plan.source,
      stages: plan.stages,
      steps: plan.stages.reduce((total, stage) => total + stage.steps, 0)
    },
    undefined,
    at
  );

export const runSuspended = (step: string, approvalId: string, at?: number): NewEvent =>
  event('run.suspended', { approvalId }, step, at);

export const runResumed = (approvalId: string | undefined, at?: number): NewEvent =>
  event('run.resumed', approvalId ? { approvalId } : {}, undefined, at);

export const runSucceeded = (
  summary: { degraded: readonly string[]; elapsedMs: number },
  at?: number
): NewEvent =>
  event(
    'run.succeeded',
    { degraded: summary.degraded, degradedCount: summary.degraded.length, elapsedMs: summary.elapsedMs },
    undefined,
    at
  );

export const runFailed = (
  error: { code: string; message: string; step?: string },
  at?: number
): NewEvent => event('run.failed', { code: error.code, message: error.message }, error.step, at);

export const runCancelled = (step: string | undefined, at?: number): NewEvent =>
  event('run.cancelled', {}, step, at);

/* -------------------------------------------------------------------- step */

export const stepStarted = (step: StepRef, at?: number): NewEvent =>
  event('step.started', { kind: step.kind, ordinal: step.ordinal, critical: step.critical }, step.name, at);

export const stepSucceeded = (step: StepRef, elapsedMs: number, at?: number): NewEvent =>
  event('step.succeeded', { elapsedMs }, step.name, at);

export const stepDegraded = (
  step: StepRef,
  reason: string,
  elapsedMs: number,
  at?: number
): NewEvent => event('step.degraded', { reason, elapsedMs }, step.name, at);

export const stepFailed = (
  step: StepRef,
  reason: string,
  elapsedMs: number,
  at?: number
): NewEvent => event('step.failed', { reason, elapsedMs }, step.name, at);

/**
 * Carries no reason, because there is nothing to report about the step: what
 * stopped it belongs to the run, and the run's own terminal event says it.
 *
 * `elapsedMs` is kept — the call went out and the time was spent, which is
 * exactly what a tail showing `step.started` and then silence would hide.
 */
export const stepStopped = (step: StepRef, elapsedMs: number, at?: number): NewEvent =>
  event('step.stopped', { elapsedMs }, step.name, at);

export const stepSkipped = (step: StepRef, at?: number): NewEvent =>
  event('step.skipped', {}, step.name, at);
