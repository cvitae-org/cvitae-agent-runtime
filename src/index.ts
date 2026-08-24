/**
 * The runtime's public surface.
 *
 * cvitae imports this and calls `run`. It does not know which provider is
 * configured, whether a capability is a declared pipeline or a tool loop, or
 * where the data sits — which is the point of the split. Swapping OpenRouter
 * for a local model, or adding a capability, is a change here and nowhere else.
 *
 * `createRuntime` resolves models lazily. Constructing it must not require a
 * provider to be configured or Ollama to be running, because the process may
 * only want to read the CV document — and failing at construction would make
 * storage unavailable whenever generation happened to be misconfigured.
 *
 * That now holds for running as well as for constructing. A run resolves a
 * model when a step reaches for one, so a capability that reaches for none
 * needs no credential — `verify_recipient` is entirely fetches and comparisons
 * unless its web tier is asked for, and it used to refuse over a key it was
 * never going to spend. What has not changed is what a *missing* model means:
 * see the `AiConfigError` branch in the orchestrator.
 */

import type { LanguageModel } from 'ai';

import { Store } from './store/store.js';
import { createEmbedder, type Embedder } from './retrieval/embed.js';
import { ToolRegistry } from './tools/registry.js';
import { defaultTools } from './tools/index.js';
import { defaultCapabilities } from './capabilities/index.js';
import { route, validateInput, routeWithModel, type CapabilityMap } from './core/router.js';
import { plan as buildPlan } from './core/planner.js';
import { executePlan } from './core/orchestrator.js';
import {
  executeBatch,
  resolveBatchConcurrency,
  type BatchItem,
  type BatchSummary
} from './core/batch.js';
import { mergeOutcomes } from './core/aggregator.js';
import {
  describeModel,
  resolveModel,
  resolveEmbeddingModel,
  type ModelOverride
} from './providers/resolve.js';
import type { RunContext, RunResult } from './core/types.js';
import { RuntimeError } from './core/types.js';
import {
  createAiLogger,
  withAiTrace,
  type AiLogger
} from './ai/logging.js';

export type RuntimeOptions = {
  capabilities?: CapabilityMap;
  tools?: typeof defaultTools;
  /** Per-process model settings; a call may override them again. */
  model?: ModelOverride;
  embedding?: ModelOverride;
  /** Primarily for alternate sinks and tests. Defaults to metadata JSONL. */
  aiLogger?: AiLogger;
};

export type RunOptions = {
  model?: ModelOverride;
  signal?: AbortSignal;
};

export type BatchOptions = RunOptions & {
  /** How many inputs run at once. Defaults by provider — see `resolveBatchConcurrency`. */
  concurrency?: number;
  /** Bounds one input, not the batch. A batch has no honest total. */
  timeoutMs?: number;
};

export class Runtime {
  private readonly capabilities: CapabilityMap;
  private readonly tools: ToolRegistry;
  private embedderPromise: Promise<Embedder> | null = null;
  private storePromise: Promise<Store> | null = null;
  private readonly aiLogger: AiLogger;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.capabilities = options.capabilities ?? defaultCapabilities;
    this.tools = new ToolRegistry(options.tools ?? defaultTools);
    this.aiLogger = options.aiLogger ?? createAiLogger();
  }

  private async embedder(): Promise<Embedder> {
    if (!this.embedderPromise) {
      this.embedderPromise = (async () => {
        const resolved = await resolveEmbeddingModel(this.options.embedding);
        return createEmbedder({ ...resolved, aiLogger: this.aiLogger });
      })();

      this.embedderPromise.catch(() => {
        this.embedderPromise = null;
      });
    }

    return this.embedderPromise;
  }

  /**
   * The store, which needs an embedder to index and search.
   *
   * Exposed so a caller can import a CV or run a search without going through a
   * capability — cvitae's own UI reads the document directly, and routing that
   * through a model would be absurd.
   */
  async store(): Promise<Store> {
    if (!this.storePromise) {
      this.storePromise = (async () => new Store(await this.embedder()))();

      this.storePromise.catch(() => {
        this.storePromise = null;
      });
    }

    return this.storePromise;
  }

  listCapabilities(): { name: string; describe: string }[] {
    return Object.values(this.capabilities).map((capability) => ({
      name: capability.name,
      describe: capability.describe
    }));
  }

  listTools(): { name: string; describe: string }[] {
    return this.tools.describe();
  }

  private async context(
    capability: string | undefined,
    input: Record<string, unknown>,
    options: RunOptions,
    traceId = crypto.randomUUID()
  ): Promise<RunContext> {
    const override = { ...this.options.model, ...options.model };

    // The names are free; the model is not. Naming the provider needs no
    // credential, so a plan is built and its transforms run whether or not this
    // process holds a key — and a run that never reaches a model step never
    // asks for one. See `describeModel`.
    const { providerId, modelId } = describeModel(override);
    const store = await this.store();

    let modelPromise: Promise<LanguageModel> | null = null;
    const model = () => {
      if (!modelPromise) {
        modelPromise = resolveModel(override).then((resolved) => resolved.model);
        // A failed resolve must not be remembered as the answer for the rest of
        // the run; the next step should ask again and fail on its own terms.
        modelPromise.catch(() => {
          modelPromise = null;
        });
      }
      return modelPromise;
    };

    return {
      model,
      providerId,
      modelId,
      traceId,
      aiLogger: this.aiLogger,
      capability,
      store,
      tools: this.tools,
      input,
      completed: {},
      signal: options.signal
    };
  }

  /** Runs a named capability. The ordinary entry point. */
  async run(
    capabilityName: string,
    input: unknown,
    options: RunOptions = {}
  ): Promise<RunResult> {
    const capability = route(this.capabilities, capabilityName);
    const validated = validateInput(capability, input);
    return this.runCapability(capability, validated, options);
  }

  private async runCapability(
    capability: ReturnType<typeof route>,
    validated: Record<string, unknown>,
    options: RunOptions,
    traceId = crypto.randomUUID()
  ): Promise<RunResult> {
    const context = await this.context(
      capability.name,
      validated as Record<string, unknown>,
      options,
      traceId
    );

    return withAiTrace(traceId, async () => {
      const plan = await buildPlan(capability, validated, context);
      return executePlan(plan, context, capability.aggregate ?? mergeOutcomes);
    });
  }

  /**
   * Runs one capability over many inputs, emitting each result as it finishes.
   *
   * Separate from `run` rather than a variant of it, because the two differ in
   * what a failure means. `run` throws; this one reports per input and carries
   * on, since nineteen analysed offers and one error is a good outcome and
   * discarding the nineteen for the sake of the one is not.
   *
   * Nothing is buffered. The caller is expected to persist each item as it
   * arrives, which is what lets an interrupted batch keep everything it had
   * already finished — and is why there is no job store here.
   */
  async runBatch<T = Record<string, unknown>>(
    capabilityName: string,
    inputs: unknown[],
    options: BatchOptions = {},
    onItem: (item: BatchItem<T>) => void | Promise<void>
  ): Promise<BatchSummary> {
    // Checked once, up front. A wrong capability name is a programming error,
    // and discovering it twenty times over is neither faster nor clearer.
    route(this.capabilities, capabilityName);

    // Named once to learn the provider, because how many inputs may run at once
    // depends on it and has to be known before the first one starts. Naming it
    // rather than building it: the batch would otherwise demand a credential
    // before deciding a concurrency, which is not something a batch of
    // transforms has any use for.
    const { providerId } = describeModel({
      ...this.options.model,
      ...options.model
    });

    return executeBatch<T>({
      inputs,
      concurrency: resolveBatchConcurrency(providerId, options.concurrency),
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      onItem,
      run: async (input, _index, itemSignal) => {
        // The composed signal, not the caller's: it carries this input's own
        // deadline as well as the batch-wide cancellation.
        const result = await this.run(capabilityName, input, {
          model: options.model,
          signal: itemSignal
        });

        return {
          data: result.data as T,
          degraded: result.degraded,
          elapsedMs: result.elapsedMs
        };
      }
    });
  }

  /**
   * Runs whatever capability a free-text request seems to want.
   *
   * Costs an extra model round trip, so it is separate from `run` rather than a
   * fallback inside it: a caller that knows the capability should never pay for
   * this, and every caller inside cvitae knows.
   */
  async runFromText(request: string, options: RunOptions = {}): Promise<RunResult> {
    const traceId = crypto.randomUUID();
    const context = await this.context(undefined, { request }, options, traceId);
    const choice = await withAiTrace(traceId, () =>
      routeWithModel(this.capabilities, request, context)
    );

    if (!choice) {
      throw new RuntimeError(
        `Could not tell which capability "${request.slice(0, 60)}" wants. Available: ${Object.keys(this.capabilities).join(', ')}.`,
        'unknown_capability'
      );
    }

    const validated = validateInput(choice.capability, { question: request });
    return this.runCapability(
      choice.capability,
      validated as Record<string, unknown>,
      options,
      traceId
    );
  }
}

export const createRuntime = (options: RuntimeOptions = {}): Runtime =>
  new Runtime(options);

export { RuntimeError } from './core/types.js';
export type {
  Capability,
  Plan,
  Step,
  RunContext,
  RunResult,
  StepOutcome
} from './core/types.js';
export type { BatchItem, BatchSummary } from './core/batch.js';
export { defineTool, ToolRegistry } from './tools/registry.js';
export type { ToolDefinition } from './tools/registry.js';
export { Store } from './store/store.js';
export type { OfferRow, ChunkRow } from './store/store.js';
export { cvDocumentSchema, emptyDocument } from './store/cvDocument.js';
export type { CvDocument, ExperienceEntry } from './store/cvDocument.js';
export { mergeDocument } from './store/merge.js';
export type { MergeReport } from './store/merge.js';
export { readSources, SourceError } from './sources/index.js';
export {
  fetchOffer,
  scrapeOffer,
  resolveOffer,
  applyBoardFacts,
  isScraperEnabled
} from './offers/index.js';
export type {
  BoardOffer,
  ResolvedOffer,
  StatedFacts
} from './offers/index.js';
export type { SourceInput, SourceRecord, ReadOutcome } from './sources/index.js';
export type { ExtractCvInput, ExtractCvResult } from './capabilities/extractCv.js';
export type {
  TranslateCvInput,
  TranslateCvResult,
  TranslatableCv,
  TranslationSection
} from './capabilities/translateCv.js';
export { runtimeHome, documentPath, lancePath } from './store/paths.js';
export { providers, providerIds, AiConfigError } from './providers/resolve.js';
export type { ProviderId } from './providers/resolve.js';
export { createAiLogger, JsonlAiLogger, NoopAiLogger } from './ai/logging.js';
export type { AiLogEvent, AiLogger, AiLogMode } from './ai/logging.js';
