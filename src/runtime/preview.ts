/**
 * What a message would be made of, said before it is sent.
 *
 * A preview prepares a message exactly as a run does and stops where the run
 * would first ask a model. It reads the same conversation, through the same
 * walls, with the same limits, and runs the same steps up to that point; the
 * one thing it does not do is ask a model to answer or to choose tools, in
 * either mode. There is no run row, no step, no event and no stored record:
 * what it records goes to a record of its own that nobody can read afterwards.
 *
 * One call is made that a run makes too: a `full` preview of a message that
 * asked for `auto` searches for pieces, and the search embeds the question. That
 * is the embedding model and not the one that answers, and it is the price of a
 * plan that has the pieces the run would add. `fast` makes no call of any kind.
 *
 *   fast   the message's size by part, the limit it lives under, and whether a
 *          run would be refused. Advisory: it prepares nothing and calls
 *          nothing, so it is cheap enough to ask while a person types. It
 *          carries no digest.
 *   full   everything a run does before generation, including the search for
 *          pieces to add when that was asked for. It answers with the entries
 *          the message is made of and `planDigest`, which a message sent with
 *          `approved` is checked against (`plan_conflict`).
 *
 * The digest is `planDigestOf` over the entries, the same function a run's own
 * record is read with, so a preview and the run it was for agree because they
 * are one computation over one set of entries.
 */

import { buildStepContext } from '../context/build.js';
import { recordSends } from '../core/executor.js';
import { plan as makePlan } from '../core/planner.js';
import { route, validateInput } from '../core/router.js';
import { GROUNDED, CvContextError, OperationError, RECORD_VERSION } from '../contracts/index.js';
import type { Grounded, RecordEntry, RecordStore, StepRef } from '../contracts/index.js';
import { FIT_STEP } from '../capabilities/cv/fit.js';
import type { Fit } from '../capabilities/cv/fit.js';
import { isPrepared, planDigestOf } from '../grounding/plan.js';
import { defaultWells } from './grounding.js';
import { checkNeeds } from './needs.js';
import { buildRunContext, givenInput, scopedDeps } from './run.js';
import type { RunRequest, RuntimeDeps } from './run.js';

export const PREVIEW_MODES = ['fast', 'full'] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];

export type PreviewRequest = Omit<RunRequest, 'signal' | 'deadlineAt' | 'runId' | 'traceId'> & {
  readonly mode: PreviewMode;
};

/** Why a run of the message, as it stands, would be refused. */
export type Refusal = { readonly code: string; readonly message: string };

export type Preview = {
  readonly mode: PreviewMode;
  /** What the message is made of, in characters by part, and the sum. */
  readonly size: { readonly parts: Readonly<Record<string, number>>; readonly total: number };
  /** The most the material may come to, when the conversation has a limit; `null` when only the baseline applies. */
  readonly limit: number | null;
  /** Present when a run of this message would be refused, before any model call. */
  readonly refusal?: Refusal;
  /** What a run would go without: the optional needs that are not met, by name. */
  readonly degraded: readonly string[];
  /** `full` only, and only when nothing refuses the message. */
  readonly planDigest?: string;
  /** `full` only: the entries the message is made of, and the pieces held back. */
  readonly entries?: readonly RecordEntry[];
  /**
   * `full` only: which offers a message that compares offers would compare, which
   * it leaves out and why, and whether it carries preferences.
   */
  readonly offers?: Pick<Fit, 'compared' | 'left' | 'preferences'>;
  /** `full` only: what was done with the pieces asked for, when any were. Every step that assembles says its part. */
  readonly grounding?: {
    readonly included: readonly string[];
    readonly blocked: readonly string[];
    readonly gone: readonly string[];
    readonly suggested: readonly string[];
    readonly auto?: 'failed';
  };
};

/**
 * A record that keeps its entries in memory, for one preview.
 *
 * What a preview says it was given and read goes somewhere, because the code
 * that says so is the code a run uses. Here it goes to a list that dies with the
 * preview.
 */
const inMemory = (runId: string, conversationId: string, openedAt: number): RecordStore => {
  const kept: RecordEntry[] = [];
  return {
    append: (_runId, entries) => {
      kept.push(...entries);
      return entries.length;
    },
    read: () => ({ v: RECORD_VERSION, runId, conversationId, state: 'open', openedAt, entries: [...kept] })
  };
};

const refusalOf = (error: unknown): Refusal => {
  if (error instanceof OperationError) return { code: error.code, message: error.message };
  throw error;
};

const total = (parts: Readonly<Record<string, number>>): number =>
  Object.values(parts).reduce((sum, part) => sum + part, 0);

export const previewRun = async (deps: RuntimeDeps, request: PreviewRequest): Promise<Preview> => {
  const now = deps.now ?? Date.now;

  // The same refusals a run makes before it has a row, for the same reasons.
  const capability = route(deps.capabilities, request.capability);
  const input = validateInput(
    capability,
    request.offerSnapshotId ? deps.offerInput?.(request.offerSnapshotId, request.capability, request.input) : request.input
  );
  const bound = scopedDeps(
    deps,
    request.contextId,
    request.conversationId,
    request.contextGeneration,
    request.contextRevision,
    request.offerSnapshotId
  );
  const { conversationId } = request;
  if (conversationId === undefined) {
    throw new CvContextError('invalid_input', 'A preview is of a message in a conversation.');
  }

  const runId = deps.newRunId();
  const openedAt = now();
  // The runtime's own record store is not touched: this one forgets.
  const kept = inMemory(runId, conversationId, openedAt);
  const previewing: RuntimeDeps = { ...bound, grounding: { records: kept, wells: deps.grounding?.wells ?? defaultWells() } };

  const given = givenInput(previewing, capability.name, conversationId, runId, input);
  const context = buildRunContext(
    previewing,
    {
      ...(request.offerSnapshotId === undefined ? {} : { offerSnapshotId: request.offerSnapshotId }),
      ...(request.contextId === undefined ? {} : { contextId: request.contextId }),
      ...(bound.contextGeneration === undefined ? {} : { contextGeneration: bound.contextGeneration }),
      ...(bound.contextRevision === undefined ? {} : { contextRevision: bound.contextRevision }),
      conversationId,
      runId,
      traceId: runId,
      capability: capability.name,
      input: given.input,
      signal: new AbortController().signal,
      deadlineAt: openedAt + (deps.timeoutMs ?? 10 * 60 * 1000),
      preview: true
    },
    given.supplied
  );

  let refusal: Refusal | undefined;
  let degraded: string[] = [];
  try {
    degraded = checkNeeds(capability, given.input, context);
  } catch (error) {
    refusal = refusalOf(error);
  }

  // Measured after the needs, which say first when the message cannot be made at all.
  let parts: Record<string, number> = {};
  try {
    parts = { ...(capability.measure?.(given.input, context) ?? {}) };
  } catch (error) {
    refusal ??= refusalOf(error);
  }

  const base = {
    size: { parts, total: total(parts) },
    limit: context.limits?.context() ?? null,
    degraded,
    ...(refusal === undefined ? {} : { refusal })
  };

  if (request.mode === 'fast' || refusal !== undefined) return { mode: request.mode, ...base };

  // Everything before the first call to a model, and no further: a step that
  // prepares runs, and a step that would call a model says what it would send.
  const plan = await makePlan(capability, given.input, context);
  const completed: Record<string, Record<string, unknown>> = {};
  const grounded: Grounded[] = [];
  let ordinal = 0;

  for (const stage of plan.stages) {
    for (const step of stage.steps) {
      const ref: StepRef = { name: step.name, kind: step.kind, ordinal: ordinal++, critical: step.critical };
      const at = buildStepContext(context, ref, completed, context.signal);

      try {
        if (step.kind === 'transform') {
          completed[step.name] = { ...(await step.run(at)) };
          const made = completed[step.name]?.[GROUNDED] as Grounded | undefined;
          if (made !== undefined) grounded.push(made);
        } else if (step.kind !== 'generate' || step.directText?.(at) === undefined) {
          // A generation the run would answer by itself sends nothing, so it says nothing.
          recordSends(at, step);
        }
      } catch (error) {
        // A step that would have fallen back is a gap, and one that cannot is a refusal.
        if (step.kind !== 'transform' || step.critical) return { mode: 'full', ...base, refusal: refusalOf(error) };
        degraded = [...degraded, step.name];
      }
    }
  }

  const entries = kept.read(runId)?.entries.filter(isPrepared) ?? [];
  const fit = completed[FIT_STEP]?.fit as Fit | undefined;
  return {
    mode: 'full',
    ...base,
    degraded,
    planDigest: planDigestOf(entries),
    entries,
    ...(fit === undefined ? {} : { offers: { compared: fit.compared, left: fit.left, preferences: fit.preferences } }),
    ...(grounded.length === 0
      ? {}
      : {
          grounding: {
            included: grounded.flatMap((each) => each.entries.map((entry) => entry.ref)),
            blocked: grounded.flatMap((each) => each.blocked),
            gone: grounded.flatMap((each) => each.gone),
            suggested: grounded.flatMap((each) => each.suggested),
            ...(grounded.some((each) => each.auto === 'failed') ? { auto: 'failed' as const } : {})
          }
        })
  };
};
