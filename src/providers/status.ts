/**
 * What a settings page needs to tell someone whether this will work.
 *
 * Everything here is answerable without making a model call, which is the
 * point: "test connection" should not cost a generation, and a person who has
 * not finished configuring the app should not be billed for finding that out.
 * What it reports is the resolution the next run would perform — the same
 * `describe` the gateway uses, not a second copy of the rules — plus, for a
 * local server, whether anything is actually listening.
 *
 * The provider table is read from `resolve.ts` rather than restated. The
 * previous runtime's version of this file kept its own copy of the labels,
 * default models and credential names, and by the time it was replaced the copy
 * had drifted: a model the resolver no longer used, still reported as the
 * default. A status screen that lies is worse than no status screen.
 *
 * The one network call is to a URL `assertLoopbackUrl` has already refused
 * unless it points at this machine, so a settings field cannot turn this
 * process into a probe of somebody else's network. It goes to the
 * OpenAI-compatible `/models` path rather than Ollama's own, because that is
 * the endpoint every local runner the base URL can point at agrees on — Ollama,
 * LM Studio, llama.cpp, vLLM.
 */

import { providerIds, providers, type ModelResolver, type ProviderId } from './resolve.js';
import type { Environment } from './environment.js';

/** How long to wait for a local server before calling it absent. */
const PROBE_MS = 1_500;

export type ProviderSummary = {
  readonly id: ProviderId;
  readonly label: string;
  readonly needsCredential: boolean;
  readonly credentialConfigured: boolean;
  readonly defaultModel: string;
  readonly embeds: boolean;
};

export type ProviderStatus = {
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly credentialConfigured: boolean;
  readonly embeddingProviderId: ProviderId;
  readonly embeddingModelId: string;
  readonly embeddingCredentialConfigured: boolean;
  /** Where a local server would be looked for, whether or not one is configured. */
  readonly localBaseUrl: string;
  /** Absent when nothing in this configuration uses a local server. */
  readonly localReachable?: boolean;
  readonly localModels?: readonly string[];
  /** Configured local models the server does not have pulled. */
  readonly missingLocalModels: readonly string[];
  readonly providers: readonly ProviderSummary[];
};

type Probe = {
  readonly reachable: boolean;
  readonly models: readonly string[];
};

const listLocalModels = async (
  baseUrl: string,
  fetchImpl: typeof fetch
): Promise<Probe> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS);

  try {
    const response = await fetchImpl(`${baseUrl}/models`, { signal: controller.signal });
    if (!response.ok) return { reachable: false, models: [] };

    const body = (await response.json()) as { data?: { id?: unknown }[] };

    return {
      reachable: true,
      models: (body.data ?? []).flatMap((model) =>
        typeof model.id === 'string' ? [model.id] : []
      )
    };
  } catch {
    // Every failure is the same answer to the only question being asked: is
    // there a server there. Refused, timed out, served nonsense — all of them
    // mean the next run will not reach a model, and none of them mean anything
    // different to the person reading the screen.
    return { reachable: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
};

/** Ollama reports a model pulled as `name` under `name:latest`. */
const isPulled = (wanted: string, available: readonly string[]): boolean =>
  available.some((model) => model === wanted || model === `${wanted}:latest`);

export const providerStatus = async (
  resolver: ModelResolver,
  environment: Environment,
  options: { readonly fetch?: typeof fetch } = {}
): Promise<ProviderStatus> => {
  const generation = resolver.describe();
  const embedding = resolver.describeEmbedding();
  const credentials = environment.credentials();

  const localBaseUrl =
    generation.baseURL ?? embedding.baseURL ?? providers.local.baseURL;

  const usesLocal = generation.providerId === 'local' || embedding.providerId === 'local';
  const probe = usesLocal
    ? await listLocalModels(localBaseUrl, options.fetch ?? globalThis.fetch)
    : undefined;

  const wanted = [
    generation.providerId === 'local' ? generation.modelId : undefined,
    embedding.providerId === 'local' ? embedding.modelId : undefined
  ].filter((model): model is string => model !== undefined);

  return {
    providerId: generation.providerId,
    modelId: generation.modelId,
    credentialConfigured: credentials[generation.providerId],
    embeddingProviderId: embedding.providerId,
    embeddingModelId: embedding.modelId,
    embeddingCredentialConfigured: credentials[embedding.providerId],
    localBaseUrl,
    ...(probe === undefined
      ? {}
      : { localReachable: probe.reachable, localModels: probe.models }),
    // Only meaningful once something answered. Reporting every configured model
    // as missing because the server is off would put the wrong fix in front of
    // someone whose actual problem is that Ollama is not running.
    missingLocalModels:
      probe?.reachable === true ? wanted.filter((model) => !isPulled(model, probe.models)) : [],
    providers: providerIds.map((id) => ({
      id,
      label: providers[id].label,
      needsCredential: providers[id].apiKeyEnvVar !== '',
      credentialConfigured: credentials[id],
      defaultModel: providers[id].defaultModel,
      embeds: providers[id].embeds
    }))
  };
};

