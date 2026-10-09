/**
 * Tools: the narrow, named surface a model is allowed to reach through.
 *
 * A tool is not an effect. `effects/` is the outside world with no opinion about
 * who is calling; a tool is a deliberately shaped wrapper over some of it, with
 * a schema on the way in, a bounded result on the way out, and a name a model
 * can be told about. The dependency runs one way — `tools/` imports `effects/`
 * and `effects/` never imports `tools/` — which is why `ToolHandle`, the shape
 * the gateway consumes, is declared over there and not here.
 *
 * The registry is a whitelist, not a directory. A step names the tools it needs
 * and receives handles for exactly those; there is no ambient set and no way for
 * a model to discover a tool the step did not ask for. Least privilege is the
 * default because the alternative would have to be written out by hand.
 *
 * Nothing here wraps mail, and `ToolContext` cannot reach it — `EffectSet` has
 * no `mail` member. See the note at the top of `effects.ts`.
 */

import type { z } from 'zod';
import type { EffectSet, ToolHandle } from './effects.js';
import type { Retriever } from './chunk-index.js';
import type { DocumentStore } from './document-store.js';
import type { RecordSink } from './grounding.js';

/**
 * What a tool is allowed to reach.
 *
 * Narrower than a step's context on purpose: no plan, no completed outcomes, no
 * approval gate. A tool answers one question with the handles it was given, and
 * anything that needs to know where it sits in a run is a step, not a tool.
 */
export type ToolContext = {
  readonly traceId: string;
  readonly runId: string;
  readonly step: string;
  readonly signal: AbortSignal;
  readonly effects: EffectSet;
  readonly documents: DocumentStore;
  readonly retrieval: Retriever;
  /**
   * Where a tool says what it handed to the model, when the run has a record.
   *
   * A tool knows which pieces of its result a model received and in what form,
   * which a port cannot see, so the precise entries come from here and the ports
   * only say what was read.
   */
  readonly record?: RecordSink;
};

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  readonly name: string;
  /** One line, shown to the model. This is the whole of its documentation. */
  readonly describe: string;
  readonly input: z.ZodType<TInput>;
  readonly execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
};

export interface ToolRegistry {
  names(): readonly string[];
  has(name: string): boolean;

  /**
   * Binds the named tools to a context, ready to hand to the gateway.
   *
   * Throws on a name the registry does not hold. A step asking for a tool that
   * does not exist is a bug in the capability, and failing at plan time beats
   * a model discovering the gap halfway through a loop.
   */
  handles(names: readonly string[], context: ToolContext): ToolHandle[];
}
