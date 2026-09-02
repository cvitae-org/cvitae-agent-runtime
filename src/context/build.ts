/**
 * Assembling a step's context, and freezing it before the step begins.
 *
 * The freeze is the point of the module. `completed` is accumulated by the
 * orchestrator as a stage runs, and handing a step the live object would mean
 * two steps in the same stage observe different values depending on when each
 * happens to read it — a race whose symptom is a prompt that was assembled from
 * a half-filled record, and whose reproduction depends on which model call
 * returned first. Each step gets its own snapshot instead, taken at the moment
 * it starts and immutable for as long as it runs.
 *
 * The other half is the signal. The context a step receives carries the
 * *stage's* signal, not the run's: it fires for a cancelled run, a passed
 * deadline, or a critical sibling failing. A step never has to know which, and
 * never has to combine them itself.
 */

import type { ApprovalGate, RunContext, StepContext, StepRef } from '../contracts/index.js';

export type StepValues = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * Shallow-freezes each step's values and the map holding them.
 *
 * Shallow rather than recursive, and the reason is honest rather than
 * principled: a deep freeze walks arbitrary extracted structures on every step
 * of every run, and what it would buy is protection against a capability
 * mutating a nested array it was handed. That has not happened, the shallow
 * freeze catches the shape of the mistake that has (assigning to `completed`),
 * and a recursive walk over a large document is not free.
 */
const snapshot = (completed: Readonly<Record<string, Record<string, unknown>>>): StepValues => {
  const frozen: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [name, value] of Object.entries(completed)) frozen[name] = Object.freeze({ ...value });
  return Object.freeze(frozen);
};

export const buildStepContext = (
  run: RunContext,
  step: StepRef,
  completed: Readonly<Record<string, Record<string, unknown>>>,
  signal: AbortSignal,
  /**
   * The step-scoped approval gate, when there is one.
   *
   * `ApprovalGate.request` has to know which step is asking, because that is
   * half of the key it uses to find an answer a person left behind. The gate on
   * `RunContext` is the run-level one, used while planning; the orchestrator
   * supplies a step-bound gate here.
   */
  approvals?: ApprovalGate
): StepContext =>
  Object.freeze({
    ...run,
    signal,
    approvals: approvals ?? run.approvals,
    step: Object.freeze({ ...step }),
    completed: snapshot(completed)
  });

/** The prompt a step declares, which may be a literal or a function of context. */
export const renderPrompt = (
  prompt: string | ((context: StepContext) => string),
  context: StepContext
): string => (typeof prompt === 'function' ? prompt(context) : prompt);
