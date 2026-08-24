/**
 * Resolves the models the runtime talks to.
 *
 * Ported from cvitae's `libs/ai/providers.ts` and kept deliberately close to
 * it, so one `.env` can serve both while the runtime is being adopted. Two
 * things are added here.
 *
 * The first is embeddings, which need their own provider rather than
 * inheriting the generation one: OpenRouter serves no embedding endpoint at
 * all, so the common setup — generate on a hosted free tier, embed locally
 * through Ollama — is not expressible with a single provider setting.
 *
 * The second is that credentials are resolved here, and by default live in this
 * process and nowhere else. cvitae currently holds them because it makes the
 * model calls; once it delegates to the runtime, the browser and the Next.js
 * server both stop being places a key can leak from.
 *
 * "By default", because a caller may send its own key with a call — see
 * `credentialFor`. That is not a hole in the arrangement above but the case it
 * did not cover: a user who supplies their own credential in cvitae's Settings
 * rather than relying on the server's. Such a key is used for the one call and
 * kept nowhere, which is what the cache bypass in `resolveModel` enforces.
 */

import type { EmbeddingModel, LanguageModel } from 'ai';

import type * as OpenAi from '@ai-sdk/openai';
import type * as OpenAiCompatible from '@ai-sdk/openai-compatible';

type OpenAIImport = typeof OpenAi;
type OpenAICompatibleImport = typeof OpenAiCompatible;

export const providerIds = [
  'openrouter',
  'huggingface',
  'openai',
  'local'
] as const;
export type ProviderId = (typeof providerIds)[number];

type ProviderDefinition = {
  label: string;
  /** Omitted for OpenAI proper, which uses the native provider package. */
  baseURL?: string;
  /** Empty for providers that need no credential, i.e. a local server. */
  apiKeyEnvVar: string;
  defaultModel: string;
  /**
   * Whether the default model honours `response_format: json_schema`.
   * `generateObject` falls back to plain JSON mode when this is false, which is
   * looser and occasionally returns malformed objects.
   */
  supportsStructuredOutputs: boolean;
  /**
   * Whether the provider serves an embeddings endpoint at all. OpenRouter does
   * not, which is the whole reason embeddings resolve separately.
   */
  embeds: boolean;
  defaultEmbeddingModel?: string;
};

export const providers = {
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    defaultModel: 'google/gemma-4-26b-a4b-it:free',
    supportsStructuredOutputs: true,
    embeds: false
  },
  huggingface: {
    label: 'Hugging Face',
    baseURL: 'https://router.huggingface.co/v1',
    apiKeyEnvVar: 'HF_TOKEN',
    defaultModel: 'speakleash/Bielik-11B-v3.0-Instruct',
    supportsStructuredOutputs: true,
    embeds: true,
    defaultEmbeddingModel: 'BAAI/bge-m3'
  },
  openai: {
    label: 'OpenAI',
    baseURL: undefined,
    apiKeyEnvVar: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    supportsStructuredOutputs: true,
    embeds: true,
    defaultEmbeddingModel: 'text-embedding-3-small'
  },
  local: {
    label: 'Local server',
    // Ollama's OpenAI-compatible endpoint. LM Studio uses :1234/v1, llama.cpp
    // and vLLM :8080/v1 — all overridable.
    baseURL: 'http://localhost:11434/v1',
    // Local servers accept any bearer token, so there is no secret to manage.
    apiKeyEnvVar: '',
    defaultModel: 'gemma4:12b',
    supportsStructuredOutputs: true,
    embeds: true,
    // 768 dimensions, 274MB, and the one most likely to already be pulled.
    defaultEmbeddingModel: 'nomic-embed-text'
  }
} satisfies Record<ProviderId, ProviderDefinition>;

export const defaultProviderId: ProviderId = 'openrouter';

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' && (providerIds as readonly string[]).includes(value);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The base URL can arrive from a caller, so the runtime would otherwise fetch
 * whatever it is handed — an SSRF hole, and a worse one for a process holding
 * API keys. Restricting it to loopback covers every local runner (Ollama, LM
 * Studio, llama.cpp, vLLM) while making the setting inert anywhere else.
 */
export const assertLoopbackUrl = (value: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new AiConfigError(`"${value}" is not a valid URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiConfigError('The local server URL must be http or https.');
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new AiConfigError(
      `The local server URL must point at localhost, not "${url.hostname}".`
    );
  }

  return url.toString().replace(/\/$/, '');
};

let openaiModulePromise: Promise<OpenAIImport> | null = null;
const loadOpenAIModule = async (): Promise<OpenAIImport> => {
  if (!openaiModulePromise) openaiModulePromise = import('@ai-sdk/openai');
  return openaiModulePromise;
};

let compatibleModulePromise: Promise<OpenAICompatibleImport> | null = null;
const loadCompatibleModule = async (): Promise<OpenAICompatibleImport> => {
  if (!compatibleModulePromise) {
    compatibleModulePromise = import('@ai-sdk/openai-compatible');
  }
  return compatibleModulePromise;
};

/**
 * The key this call should spend.
 *
 * A key sent with the request wins over the environment, and that ordering is
 * the whole feature: cvitae lets a user enter their own credential in Settings,
 * and until this existed there was nowhere to put it. The request had only
 * `providerId`, `modelId` and `baseURL`, so a delegated run answered on the
 * server's key or — once cvitae started refusing rather than substituting —
 * did not run at all.
 *
 * Trusting a caller with this is not a new grant. Anything that can reach this
 * process can already spend the server's credential, so arriving with your own
 * is strictly less privileged; and the key only ever travels to the provider
 * pinned by `providerId`, whose endpoint is fixed here and, for `local`, is put
 * through the loopback guard. There is nowhere else for it to go.
 */
const credentialFor = (providerId: ProviderId, supplied?: string): string => {
  const provider = providers[providerId];

  const fromRequest = supplied?.trim();

  if (fromRequest) return fromRequest;

  if (provider.apiKeyEnvVar === '') return 'local';

  const key = process.env[provider.apiKeyEnvVar]?.trim();

  if (!key) {
    throw new AiConfigError(
      `Missing ${provider.apiKeyEnvVar}. It is required when the provider is "${providerId}" (${provider.label}), unless the caller sends its own key with the request.`
    );
  }

  return key;
};

const localBaseUrl = (override?: string): string | undefined => {
  const configured = override?.trim() || process.env.LOCAL_BASE_URL?.trim();
  return configured ? assertLoopbackUrl(configured) : undefined;
};

export type ModelOverride = {
  providerId?: string;
  modelId?: string;
  baseURL?: string;
  /**
   * The caller's own credential, spent for this call and forgotten after it.
   *
   * Optional, and normally absent: the environment is still where a key lives
   * for a runtime serving one person. This is for the case where the caller
   * holds a key the environment does not — cvitae's Settings page — and it is
   * deliberately not merged into any process-wide default, so it can never
   * outlive the request that carried it. See `credentialFor` and the cache
   * bypass in `resolveModel`.
   */
  apiKey?: string;
};

export type ResolvedModel = {
  providerId: ProviderId;
  modelId: string;
  model: LanguageModel;
};

const modelCache = new Map<string, Promise<LanguageModel>>();

const buildModel = async (
  providerId: ProviderId,
  modelId: string,
  baseURL: string | undefined,
  suppliedKey: string | undefined
): Promise<LanguageModel> => {
  const provider = providers[providerId];
  const apiKey = credentialFor(providerId, suppliedKey);

  if (!provider.baseURL) {
    const { createOpenAI } = await loadOpenAIModule();
    return createOpenAI({ apiKey })(modelId);
  }

  const { createOpenAICompatible } = await loadCompatibleModule();

  return createOpenAICompatible({
    name: providerId,
    baseURL: baseURL ?? provider.baseURL,
    apiKey,
    supportsStructuredOutputs: provider.supportsStructuredOutputs
  })(modelId);
};

export const resolveModel = async (
  override: ModelOverride = {}
): Promise<ResolvedModel> => {
  const configured = override.providerId?.trim() || process.env.AI_PROVIDER?.trim();

  let providerId: ProviderId = defaultProviderId;

  if (configured) {
    if (!isProviderId(configured)) {
      throw new AiConfigError(
        `Unknown AI_PROVIDER "${configured}". Supported values: ${providerIds.join(', ')}.`
      );
    }
    providerId = configured;
  }

  const modelId =
    override.modelId?.trim() ||
    process.env.AI_MODEL?.trim() ||
    providers[providerId].defaultModel;

  // Only the local provider may be repointed; the hosted ones have fixed
  // endpoints and accepting a URL for them would be an open proxy.
  const baseURL = providerId === 'local' ? localBaseUrl(override.baseURL) : undefined;

  const suppliedKey = override.apiKey?.trim();

  // A caller's key never enters the cache, and the cache is never read for one.
  //
  // The cache is keyed by provider, model and base URL — not by credential —
  // so storing a client-built model under that key would hand the next caller
  // a client whose Authorization header is somebody else's key. That is the
  // exact substitution cvitae started refusing delegation to avoid, rebuilt one
  // layer down and harder to see. Adding the key to the cache key would fix the
  // collision and leave every key the process has ever been sent held in a
  // module-level map for the life of the process, which is worse.
  //
  // Skipping it costs nothing worth measuring: the provider modules above are
  // cached separately, and what remains is constructing a client object. No
  // request is made here.
  if (suppliedKey) {
    return {
      providerId,
      modelId,
      model: await buildModel(providerId, modelId, baseURL, suppliedKey)
    };
  }

  const cacheKey = `${providerId}:${modelId}:${baseURL ?? ''}`;
  let cached = modelCache.get(cacheKey);

  if (!cached) {
    cached = buildModel(providerId, modelId, baseURL, undefined);
    modelCache.set(cacheKey, cached);
    // A failed build (a missing key) must not be cached, or the process keeps
    // serving the rejection after the environment is fixed.
    cached.catch(() => modelCache.delete(cacheKey));
  }

  return { providerId, modelId, model: await cached };
};

export type ResolvedEmbeddingModel = {
  providerId: ProviderId;
  modelId: string;
  model: EmbeddingModel<string>;
};

const embeddingCache = new Map<string, Promise<EmbeddingModel<string>>>();

const buildEmbeddingModel = async (
  providerId: ProviderId,
  modelId: string,
  baseURL: string | undefined,
  suppliedKey: string | undefined
): Promise<EmbeddingModel<string>> => {
  const provider = providers[providerId];
  const apiKey = credentialFor(providerId, suppliedKey);

  if (!provider.baseURL) {
    const { createOpenAI } = await loadOpenAIModule();
    return createOpenAI({ apiKey }).textEmbeddingModel(modelId);
  }

  const { createOpenAICompatible } = await loadCompatibleModule();

  return createOpenAICompatible({
    name: providerId,
    baseURL: baseURL ?? provider.baseURL,
    apiKey
  }).textEmbeddingModel(modelId);
};

/**
 * Resolves the embedding model, defaulting to the local runner.
 *
 * The default is `local` regardless of `AI_PROVIDER` because embedding is the
 * step most worth keeping on the machine: it runs over the user's CV, it is
 * cheap on CPU, and sending it out is the one place this design would leak the
 * data it exists to keep local.
 */
export const resolveEmbeddingModel = async (
  override: ModelOverride = {}
): Promise<ResolvedEmbeddingModel> => {
  const configured =
    override.providerId?.trim() || process.env.EMBEDDING_PROVIDER?.trim() || 'local';

  if (!isProviderId(configured)) {
    throw new AiConfigError(
      `Unknown EMBEDDING_PROVIDER "${configured}". Supported values: ${providerIds.join(', ')}.`
    );
  }

  const provider = providers[configured];

  if (!provider.embeds) {
    throw new AiConfigError(
      `${provider.label} serves no embeddings endpoint. Set EMBEDDING_PROVIDER to one that does — "local" needs no credential.`
    );
  }

  const modelId =
    override.modelId?.trim() ||
    process.env.EMBEDDING_MODEL?.trim() ||
    provider.defaultEmbeddingModel ||
    '';

  if (!modelId) {
    throw new AiConfigError(
      `No embedding model configured for ${provider.label}. Set EMBEDDING_MODEL.`
    );
  }

  const baseURL = configured === 'local' ? localBaseUrl(override.baseURL) : undefined;

  const suppliedKey = override.apiKey?.trim();

  // Same rule as `resolveModel`, for the same reason. Reached less often —
  // embeddings resolve once per runtime rather than per run, and default to a
  // local server that needs no credential — but the collision it prevents does
  // not care how rare it is.
  if (suppliedKey) {
    return {
      providerId: configured,
      modelId,
      model: await buildEmbeddingModel(configured, modelId, baseURL, suppliedKey)
    };
  }

  const cacheKey = `${configured}:${modelId}:${baseURL ?? ''}`;
  let cached = embeddingCache.get(cacheKey);

  if (!cached) {
    cached = buildEmbeddingModel(configured, modelId, baseURL, undefined);
    embeddingCache.set(cacheKey, cached);
    cached.catch(() => embeddingCache.delete(cacheKey));
  }

  return { providerId: configured, modelId, model: await cached };
};
