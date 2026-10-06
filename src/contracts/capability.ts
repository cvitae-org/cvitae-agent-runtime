/**
 * How a unit of work declares itself.
 *
 * The load-bearing idea is that a `Plan` is **data, not control flow**. Whether
 * a capability was decomposed by hand or by a model, the orchestrator receives
 * the same list of steps and walks it the same way. That is what lets
 * procedural work — extraction that has to run on models too small to be
 * trusted with tool calling — share a runtime with open-ended work that
 * genuinely needs a model in the driving seat.
 *
 * The alternative, letting each capability implement its own control flow,
 * looks simpler for the first two and stops being simpler by the fourth: every
 * cross-cutting concern added afterwards — cancellation, checkpoints, event
 * emission, degradation — has to be written into each one by hand, and the
 * fourth is where somebody forgets.
 */

import type { z } from 'zod';
import type { ConversationTurn } from './effects.js';
import type { SentField } from './grounding.js';
import type { RunContext, StepContext, StepKind, RuntimeErrorCode } from './run.js';

type StepBase = {
  readonly name: string;
  /**
   * Whether a failure here invalidates the whole run.
   *
   * Non-critical steps degrade instead: the aggregator fills their fields from
   * `fallback` and records the name, so a partial answer reaches the caller
   * with the gap *named* rather than silently missing. Offer analysis runs five
   * steps and allows four of them to fail this way, because an analysis missing
   * its salary reading is still worth reading and an analysis missing its facts
   * is not.
   */
  readonly critical: boolean;
};

/**
 * What a step that calls a model says about the input it sends.
 *
 * Only the three kinds that reach a model have it. A `transform` runs no model,
 * and a field it reads has not reached anything.
 */
type Sends = {
  /**
   * The fields of the run's input that go into this step's model call.
   *
   * Recorded as the call goes out and not when the plan is made, because a
   * `generate` step that answers from `directText` makes no call, and a field
   * that never left the process has not been sent.
   */
  readonly sends?: readonly SentField[];

  /**
   * The name of an earlier step that made part of this call's input and says what
   * it is made of (`Grounded`). Its entries are recorded as the call goes out, for
   * the same reason `sends` is: a call that never goes out has sent nothing.
   */
  readonly groundedFrom?: string;
};

/**
 * One structured call against a narrow schema.
 *
 * No tool calling, so this runs on models that cannot do it. Narrow is the
 * operative word: a schema with four fields is answered reliably by a model
 * that returns `{}` for a schema with twenty.
 */
export type ExtractStep = StepBase & Sends & {
  readonly kind: 'extract';
  /** Only these typed failures may degrade even when this step is critical. */
  readonly fallbackOn?: readonly RuntimeErrorCode[];
  readonly schema: z.ZodTypeAny;
  readonly system: string;
  readonly prompt: string | ((context: StepContext) => string);
  readonly maxOutputTokens: number;
  /** Values used when this step degrades. Keys should cover the schema. */
  readonly fallback?: Readonly<Record<string, unknown>>;
};

/**
 * One text call, for a step whose whole output is prose.
 *
 * This kind exists because of a measurement, not a preference. Application
 * drafting was first written as an `extract` step returning `{ body: string }`,
 * which is the obvious shape — one field, one schema, the same machinery as
 * everything else. It failed completely, and the numbers are worth keeping:
 *
 *   gemma3:4b    generateObject   0/3   empty, empty, empty        0.5s
 *   gemma3:4b    generateText     3/3   129, 129, 129 words        2.7s
 *   gemma3:12b   generateObject   0/3   length, length, length    24.7s
 *   gemma3:12b   generateText     0/3   empty, empty, empty       22.1s
 *
 * Six prompt variants were tried against the 4B model first — instruction only,
 * rules only, no system prompt, a shorter field description, the instruction
 * moved into the user turn — and all six returned `{}`. The wording was not the
 * variable. Asking a small model to wrap 130 words of prose in a JSON string is:
 * it has to hold the letter *and* the escaping, and it drops one of them. The
 * 12B model drops the other, running to the token ceiling without ever closing
 * the object.
 *
 * So a schema here is not a safeguard, it is the failure. Text out returns
 * exactly what an email body is — a string — and the same 4B model that could
 * not produce it as JSON writes it identically on every run in under three
 * seconds.
 *
 * The rule this leaves behind: **`extract` is for values carved out of text,
 * `generate` is for text.** A schema earns its place when the output has parts.
 */
export type GenerateStep = StepBase & Sends & {
  readonly kind: 'generate';
  /** Use a known answer from earlier steps without another model call. */
  readonly directText?: (context: StepContext) => string | undefined;
  readonly system: string;
  readonly prompt: string | ((context: StepContext) => string);
  readonly maxOutputTokens: number;
  /** The key the text lands under, so the aggregator sees a named field. */
  readonly key: string;
  readonly fallback?: Readonly<Record<string, unknown>>;
};

export type ToolLoopStep = StepBase & Sends & {
  readonly kind: 'tool_loop';
  readonly system: string;
  readonly prompt: string | ((context: StepContext) => string);
  /**
   * The conversation this step continues, oldest first, without `prompt`.
   *
   * A plain array rather than a function of the context, because unlike
   * `prompt` it never depends on what an earlier step produced — it comes from
   * the run's input, which `plan()` already has. A capability that declares
   * none is a capability whose every run is a first turn, which is what all but
   * one of them are.
   */
  readonly history?: readonly ConversationTurn[];
  /** Registry names. The model can call nothing else. */
  readonly tools: readonly string[];
  /** Hard ceiling on model turns; nothing here ever runs unbounded. */
  readonly maxSteps: number;
};

export type TransformStep = StepBase & {
  readonly kind: 'transform';
  readonly run: (context: StepContext) => Promise<Record<string, unknown>>;
};

export type Step = ExtractStep | GenerateStep | ToolLoopStep | TransformStep;

/** Compile-time proof that the step union and the persisted column agree. */
export type StepKindOf<S extends Step> = S['kind'] extends StepKind ? S['kind'] : never;

/**
 * `'auto'` resolves to 1 against a local provider and to the step count
 * otherwise.
 *
 * A local server is one GPU: overlapping calls only contend. A 4m39s run was
 * measured where firing five at once starved one of them into returning nothing
 * at all — not slower, empty. So the honest default is a property of the
 * provider, not of the plan, and `'auto'` is how a capability says it does not
 * want to decide.
 */
export type Concurrency = number | 'auto';

/**
 * Steps run in declaration order within a stage; stages run in sequence.
 *
 * Stages exist because the previous runtime had none, and scheduling therefore
 * meant "every model step, then every transform". Preparation work could not be
 * expressed as a step at all, so source reading, fetching and vision calls
 * happened inside `plan()` — outside the timing, outside the failure policy,
 * outside the events, and invisible to the elapsed time the caller was shown.
 */
export type Stage = {
  readonly name: string;
  readonly steps: readonly Step[];
  readonly concurrency: Concurrency;
};

export type Plan = {
  readonly capability: string;
  readonly stages: readonly Stage[];
  /** Named so a caller can tell a declared plan from a generated one. */
  readonly source: 'declared' | 'llm';
};

export type StepOutcome = {
  readonly step: string;
  readonly status: 'ok' | 'degraded';
  /** Present when the step degraded, for the source note shown to the user. */
  readonly reason?: string;
  readonly value: Readonly<Record<string, unknown>>;
};

export type RunResult<T = Record<string, unknown>> = {
  readonly runId: string;
  readonly capability: string;
  readonly data: T;
  readonly degraded: readonly string[];
  readonly outcomes: readonly StepOutcome[];
  /** Wall time in ms for the whole run, including preparation stages. */
  readonly elapsedMs: number;
};

/**
 * Something a capability needs of a run, said before any model is called.
 *
 * A capability that is asked to answer from pieces nobody selected has nothing to
 * answer from, and finding that out after a model call has been paid for helps no
 * one. A required need that cannot be met fails the run before it starts; an
 * optional one is named under `degraded` once the run has finished, so the answer
 * says what it was made without.
 */
export type Need = {
  /** What is named under `degraded` when an optional need is not met. */
  readonly name: string;
  readonly required: boolean;
  /** Why it cannot be met, in plain words. Absent when it can. */
  readonly unmet?: string;
};

/**
 * A unit of work the runtime exposes.
 *
 * `plan` is where the two execution modes diverge: return a fixed list of stages
 * for procedural work, or call a model to produce one for open-ended work. The
 * orchestrator cannot tell the difference, and that is the point.
 */
export interface Capability<TInput extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string;
  /** One line, usable as a routing hint and shown by the capability listing. */
  readonly describe: string;
  readonly input: z.ZodType<TInput>;

  /**
   * Declared as a method rather than a function-typed property, deliberately.
   *
   * TypeScript checks method parameters bivariantly and property function types
   * contravariantly, and a registry of differently-typed capabilities needs the
   * former: `Capability<{ url: string }>` has to be storable in a map of
   * `Capability<Record<string, unknown>>` or every entry needs a cast. The
   * looseness is paid for at the boundary — the router validates the caller's
   * input against `input` before `plan` is ever reached, so the only value that
   * arrives here has already been proven to match `TInput`.
   */
  plan(input: TInput, context: RunContext): Plan | Promise<Plan>;

  /**
   * What this run needs, asked after the input is validated and before `plan`,
   * which may itself call a model. A method for the reason `plan` is one. It reads
   * the context but runs nothing: no model, no tool, no write.
   */
  needs?(input: TInput, context: RunContext): readonly Need[];

  /**
   * Whether the runs of this capability say, in their record, everything they
   * send to a model.
   *
   * It is what lets a later run trust the record to tell what an answer was built
   * from. An answer of a capability that is not recorded has no such account, and
   * the runtime treats where it came from as unknown. A recorded capability that
   * takes `history` and `summary` is also one whose conversation the runtime keeps
   * itself when the host sends neither (`runtime/history.ts`).
   */
  readonly recorded?: boolean;

  /**
   * Folds step outputs into the capability's result shape. Defaults to a
   * shallow merge, which is what an extraction pipeline wants.
   *
   * This is also where domain judgment about *precedence* belongs — that a
   * board's stated salary beats a model's reading of the same page is a rule
   * about this subject, and rules about a subject live in exactly one file.
   */
  aggregate?(outcomes: readonly StepOutcome[]): Record<string, unknown>;
}

/** What the router holds. See the note on `plan` for why this typechecks. */
export type CapabilityMap = Readonly<Record<string, Capability>>;
