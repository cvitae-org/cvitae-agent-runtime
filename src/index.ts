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
 */

import { Store } from './store/store.js';
import { createEmbedder, type Embedder } from './retrieval/embed.js';
import { ToolRegistry } from './tools/registry.js';
import { defaultTools } from './tools/index.js';
import { defaultCapabilities } from './capabilities/index.js';
import { route, validateInput, routeWithModel, type CapabilityMap } from './core/router.js';
import { plan as buildPlan } from './core/planner.js';
import { executePlan } from './core/orchestrator.js';
import { mergeOutcomes } from './core/aggregator.js';
import { resolveModel, resolveEmbeddingModel, type ModelOverride } from './providers/resolve.js';
import type { RunContext, RunResult } from './core/types.js';
import { RuntimeError } from './core/types.js';

export type RuntimeOptions = {
  capabilities?: CapabilityMap;
  tools?: typeof defaultTools;
  /** Per-process model settings; a call may override them again. */
  model?: ModelOverride;
  embedding?: ModelOverride;
};

export type RunOptions = {
  model?: ModelOverride;
  signal?: AbortSignal;
};

export class Runtime {
  private readonly capabilities: CapabilityMap;
  private readonly tools: ToolRegistry;
  private embedderPromise: Promise<Embedder> | null = null;
  private storePromise: Promise<Store> | null = null;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.capabilities = options.capabilities ?? defaultCapabilities;
    this.tools = new ToolRegistry(options.tools ?? defaultTools);
  }

  private async embedder(): Promise<Embedder> {
    if (!this.embedderPromise) {
      this.embedderPromise = (async () => {
        const resolved = await resolveEmbeddingModel(this.options.embedding);
        return createEmbedder(resolved);
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
    input: Record<string, unknown>,
    options: RunOptions
  ): Promise<RunContext> {
    const [{ model, providerId }, store] = await Promise.all([
      resolveModel({ ...this.options.model, ...options.model }),
      this.store()
    ]);

    return {
      model,
      providerId,
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

    const context = await this.context(
      validated as Record<string, unknown>,
      options
    );

    const plan = await buildPlan(capability, validated, context);

    return executePlan(plan, context, capability.aggregate ?? mergeOutcomes);
  }

  /**
   * Runs whatever capability a free-text request seems to want.
   *
   * Costs an extra model round trip, so it is separate from `run` rather than a
   * fallback inside it: a caller that knows the capability should never pay for
   * this, and every caller inside cvitae knows.
   */
  async runFromText(request: string, options: RunOptions = {}): Promise<RunResult> {
    const context = await this.context({ request }, options);
    const choice = await routeWithModel(this.capabilities, request, context);

    if (!choice) {
      throw new RuntimeError(
        `Could not tell which capability "${request.slice(0, 60)}" wants. Available: ${Object.keys(this.capabilities).join(', ')}.`,
        'unknown_capability'
      );
    }

    return this.run(choice.capability.name, { question: request }, options);
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
export { defineTool, ToolRegistry } from './tools/registry.js';
export type { ToolDefinition } from './tools/registry.js';
export { Store } from './store/store.js';
export type { OfferRow, ChunkRow } from './store/store.js';
export { cvDocumentSchema, emptyDocument } from './store/cvDocument.js';
export type { CvDocument, ExperienceEntry } from './store/cvDocument.js';
export { mergeDocument } from './store/merge.js';
export type { MergeReport } from './store/merge.js';
export { readSources, SourceError } from './sources/index.js';
export type { SourceInput, SourceRecord, ReadOutcome } from './sources/index.js';
export type { ExtractCvInput, ExtractCvResult } from './capabilities/extractCv.js';
export { runtimeHome, documentPath, lancePath } from './store/paths.js';
export { providers, providerIds, AiConfigError } from './providers/resolve.js';
export type { ProviderId } from './providers/resolve.js';
