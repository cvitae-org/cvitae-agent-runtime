/**
 * The shapes every other module agrees on.
 *
 * The load-bearing idea is that a `Plan` is data, not control flow. Whether a
 * capability was decomposed by hand or by a model, the orchestrator receives
 * the same list of steps and walks it the same way. That is what lets CV
 * extraction — which is procedural, and which has to run on models too small to
 * be trusted with tool calling — share a runtime with open-ended work that
 * genuinely needs a model in the driving seat.
 *
 * The alternative, letting each capability implement its own control flow,
 * looks simpler for the first two and stops being simpler by the fourth.
 */

import type { LanguageModel } from 'ai';
import type { z } from 'zod';
import type { ToolRegistry } from '../tools/registry.js';
import type { Store } from '../store/store.js';

/**
 * How a single step is carried out.
 *
 *   extract   — one `generateObject` call against a narrow schema. No tool
 *               calling, so it works on models that cannot do it. This is the
 *               mode nearly everything in cvitae uses.
 *   tool_loop — the model drives, calling registry tools until it stops. For
 *               work whose shape is not known in advance.
 *   transform — plain TypeScript, no model. Fetching, parsing, merging.
 */
export type StepKind = 'extract' | 'tool_loop' | 'transform';

type StepBase = {
  name: string;
  /**
   * Whether a failure here invalidates the whole run.
   *
   * Non-critical steps degrade instead: the aggregator fills their fields from
   * `fallback` and records the name, so a partial answer reaches the caller
   * with the gap named rather than silently missing. Ported from cvitae's offer
   * analysis, where four of five agents are allowed to fail this way.
   */
  critical: boolean;
};

export type ExtractStep = StepBase & {
  kind: 'extract';
  schema: z.ZodTypeAny;
  system: string;
  prompt: string;
  /**
   * Sized per step, not globally. cvitae measured one of its five agents
   * truncating mid-array at exactly 900 tokens while the others never came
   * close, so a single shared ceiling is either wasteful or wrong.
   */
  maxOutputTokens: number;
  /** Values used when this step degrades. Keys should cover the schema. */
  fallback?: Record<string, unknown>;
};

export type ToolLoopStep = StepBase & {
  kind: 'tool_loop';
  system: string;
  prompt: string;
  /** Names from the registry. The model can call nothing else. */
  tools: string[];
  /** Hard ceiling on model turns; the runtime never runs unbounded. */
  maxSteps: number;
  /** Optional schema for a final structured answer. */
  schema?: z.ZodTypeAny;
};

export type TransformStep = StepBase & {
  kind: 'transform';
  run: (context: RunContext) => Promise<Record<string, unknown>>;
};

export type Step = ExtractStep | ToolLoopStep | TransformStep;

/**
 * `'auto'` resolves to 1 against a local provider and to the step count
 * otherwise. A local server is one GPU: overlapping calls only contend, and
 * cvitae measured a 4m39s run where firing five at once starved one into
 * returning nothing at all.
 */
export type Concurrency = number | 'auto';

export type Plan = {
  capability: string;
  steps: Step[];
  concurrency: Concurrency;
  /** Named so a caller can tell a declared plan from a generated one. */
  source: 'declared' | 'llm';
};

/** Everything a step is allowed to reach. Nothing reads globals. */
export type RunContext = {
  /** The generation model, already resolved from provider settings. */
  model: LanguageModel;
  providerId: string;
  /** Local storage. The model never gets a handle to this — only tools do. */
  store: Store;
  tools: ToolRegistry;
  /** Whatever the capability was called with, validated against its schema. */
  input: Record<string, unknown>;
  /** Results of steps that already finished, keyed by step name. */
  completed: Record<string, Record<string, unknown>>;
  signal?: AbortSignal;
};

export type StepOutcome = {
  step: string;
  status: 'ok' | 'degraded';
  /** Present when the step degraded, for the source note. */
  reason?: string;
  value: Record<string, unknown>;
};

export type RunResult<T = Record<string, unknown>> = {
  capability: string;
  data: T;
  /** Non-critical steps that failed. Empty on a clean run. */
  degraded: string[];
  outcomes: StepOutcome[];
  /** Wall time in ms, for deciding whether a model swap was worth it. */
  elapsedMs: number;
};

/**
 * A unit of work the runtime exposes. `plan` is where the two execution modes
 * diverge: return a fixed list of steps for procedural work, or call a model to
 * produce one for open-ended work. The orchestrator cannot tell the difference.
 */
export type Capability<TInput = Record<string, unknown>> = {
  name: string;
  /** One line, shown by `listCapabilities` and usable as a routing hint. */
  describe: string;
  input: z.ZodType<TInput>;
  plan: (input: TInput, context: RunContext) => Plan | Promise<Plan>;
  /**
   * Folds step outputs into the capability's result shape. Defaults to a
   * shallow merge, which is what an extraction pipeline wants.
   */
  aggregate?: (outcomes: StepOutcome[]) => Record<string, unknown>;
};

export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unknown_capability'
      | 'invalid_input'
      | 'step_failed'
      /**
       * The source could not be read at all: a board that blocked us, one that
       * renders client-side, one robots.txt forbids. Distinct from
       * `step_failed` because nothing failed — there was simply nothing to
       * analyse, and the only way forward is for a person to supply the text.
       * cvitae turns this into its "paste it manually" prompt, so collapsing it
       * into a generic failure would cost the user the one action that works.
       */
      | 'unreadable_source'
      | 'aborted'
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}
