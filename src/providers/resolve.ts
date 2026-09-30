/**
 * Which model the runtime talks to, and how a client for it is built.
 *
 * Two things here are deliberate and both were learned from the previous
 * runtime.
 *
 * **Describing is separate from resolving.** `describe` answers "what would
 * this call use" without touching a credential; `language` builds the client.
 * They were one function before, and the cost was runs refusing over keys they
 * had no use for: a plan that is transforms end to end makes no model call at
 * all, yet it answered "Missing OPENROUTER_API_KEY" — naming a provider it was
 * never going to reach — because something wanted to read two strings off a
 * resolved model.
 *
 * **Nothing here is module state.** The client caches live on the resolver
 * instance, so a second runtime in the same process is genuinely a second
 * runtime and a test can build one without inheriting whatever the last test
 * put in a module-level `Map`. The old caches were module-level and, being
 * keyed by provider and model rather than by credential, would have handed the
 * next caller a client carrying somebody else's key had a caller-supplied key
 * ever been stored in one. Here a supplied key bypasses the cache entirely.
 *
 * Embeddings resolve independently of generation, and default to the local
 * server whatever `AI_PROVIDER` says. Two reasons: OpenRouter serves no
 * embedding endpoint at all, so "generate hosted, embed locally" is not
 * expressible with one setting; and embedding runs over the whole of a user's
 * CV, which makes it the one step where sending the data out would leak exactly
 * what keeping storage local is meant to protect.
 */

import type { EmbeddingModel, LanguageModel } from 'ai';
import type * as OpenAi from '@ai-sdk/openai';
import type * as OpenAiCompatible from '@ai-sdk/openai-compatible';
import { RuntimeError } from '../contracts/index.js';
import { credentialFor, type CredentialRequest, type Env } from '../secrets/env.js';

export const providerIds = ['openrouter', 'huggingface', 'openai', 'local'] as const;
export type ProviderId = (typeof providerIds)[number];

type ProviderDefinition = {
  readonly label: string;
  /** Absent for OpenAI proper, which uses its own provider package. */
  readonly baseURL?: string;
  /** Empty for a provider with no credential at all to read. */
  readonly apiKeyEnvVar: string;
  /**
   * Whether a call fails without one.
   *
   * Separate from having a variable to read, because a local server is neither
   * of the two things this used to be able to say. Ollama and llama.cpp want no
   * key; oMLX and a vLLM started with `--api-key` require one; and which of
   * those is behind `LOCAL_BASE_URL` is not something this table can know. So
   * the local provider *accepts* a key and does not *demand* one, and the
   * settings page renders that as an optional field rather than as a warning.
   */
  readonly credentialRequired: boolean;
  readonly defaultModel: string;
  /**
   * Whether the default model honours `response_format: json_schema`. When it
   * does not, structured calls fall back to plain JSON mode, which is looser
   * and returns a malformed object often enough to matter.
   */
  readonly supportsStructuredOutputs: boolean;
  /** OpenRouter serves none, which is why embeddings resolve separately. */
  readonly embeds: boolean;
  readonly defaultEmbeddingModel?: string;
};

export const providers = {
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    credentialRequired: true,
    defaultModel: 'google/gemma-4-26b-a4b-it:free',
    supportsStructuredOutputs: true,
    embeds: false
  },
  huggingface: {
    label: 'Hugging Face',
    baseURL: 'https://router.huggingface.co/v1',
    apiKeyEnvVar: 'HF_TOKEN',
    credentialRequired: true,
    defaultModel: 'speakleash/Bielik-11B-v3.0-Instruct',
    supportsStructuredOutputs: true,
    embeds: true,
    defaultEmbeddingModel: 'BAAI/bge-m3'
  },
  openai: {
    label: 'OpenAI',
    baseURL: undefined,
    apiKeyEnvVar: 'OPENAI_API_KEY',
    credentialRequired: true,
    defaultModel: 'gpt-4o',
    supportsStructuredOutputs: true,
    embeds: true,
    defaultEmbeddingModel: 'text-embedding-3-small'
  },
  local: {
    label: 'Local server',
    // Ollama's OpenAI-compatible endpoint. LM Studio uses :1234/v1, llama.cpp
    // and vLLM :8080/v1 — all overridable through LOCAL_BASE_URL.
    baseURL: 'http://localhost:11434/v1',
    // Read only when something set it. See `credentialRequired` above: the
    // server on the other end of the base URL may want a key or may not, and
    // the one that does answers 401 to every request until it gets one.
    apiKeyEnvVar: 'LOCAL_API_KEY',
    credentialRequired: false,
    defaultModel: 'gemma4:12b',
    supportsStructuredOutputs: true,
    embeds: true,
    // 768 dimensions, 274MB, and the one most likely to be pulled already.
    defaultEmbeddingModel: 'nomic-embed-text'
  }
} satisfies Record<ProviderId, ProviderDefinition>;

/**
 * What generation uses when nothing is configured.
 *
 * `local`, so an unconfigured checkout runs. Every other provider fails on the
 * first call with a missing-credential error, which is a poor first impression
 * of a harness whose whole claim is that it runs on the machine it is on. This
 * matches `describeEmbedding`, which has always defaulted to `local` for the
 * same reason, and it matches what `.env.example` documents.
 *
 * A hosted deployment sets `AI_PROVIDER` explicitly; it is the case that knows
 * it is hosted, so it is the case that should have to say so.
 */
export const defaultProviderId: ProviderId = 'local';

/** What embedding uses when nothing is configured. See the note at the top. */
export const defaultEmbeddingProviderId: ProviderId = 'local';

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' && (providerIds as readonly string[]).includes(value);

/**
 * What reading this provider's key amounts to, stated from the table.
 *
 * Exported so the status probe can authenticate the same way a run would
 * without restating any of it — and, more to the point, without naming a
 * variable. Only `secrets/` may name one; everything else reads the name off
 * this table, which is what keeps the credential surface auditable in one file.
 */
export const credentialRequest = (
  providerId: ProviderId,
  supplied?: string
): CredentialRequest => ({
  providerId,
  label: providers[providerId].label,
  envVar: providers[providerId].apiKeyEnvVar,
  optional: !providers[providerId].credentialRequired,
  ...(supplied ? { supplied } : {})
});

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The local base URL can arrive from a caller, and a process holding API keys
 * that fetches whatever URL it is handed is an SSRF hole with credentials
 * attached. Loopback covers every local runner — Ollama, LM Studio, llama.cpp,
 * vLLM — and makes the setting inert anywhere else.
 */
export const assertLoopbackUrl = (value: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new RuntimeError(`"${value}" is not a valid URL.`, 'misconfigured');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RuntimeError('The local server URL must be http or https.', 'misconfigured');
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new RuntimeError(
      `The local server URL must point at localhost, not "${url.hostname}".`,
      'misconfigured'
    );
  }

  return url.toString().replace(/\/$/, '');
};

export type ModelOverride = {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly baseURL?: string;
  /** Spent on this call and forgotten after it. Never enters a cache. */
  readonly apiKey?: string;
};

export type ModelChoice = {
  readonly providerId: ProviderId;
  readonly modelId: string;
  /** Only ever set for `local`; hosted providers have fixed endpoints. */
  readonly baseURL: string | undefined;
};

export interface ModelResolver {
  /** What a call would use. Reads no credential and builds nothing. */
  describe(override?: ModelOverride): ModelChoice;
  describeEmbedding(override?: ModelOverride): ModelChoice;
  language(override?: ModelOverride): Promise<LanguageModel>;
  embedding(override?: ModelOverride): Promise<EmbeddingModel<string>>;
}

export const createModelResolver = (
  options: { readonly env?: Env } = {}
): ModelResolver & { clearCache(): void } => {
  const env = options.env ?? process.env;

  // Instance state, not module state — see the note at the top.
  const languageCache = new Map<string, Promise<LanguageModel>>();
  const embeddingCache = new Map<string, Promise<EmbeddingModel<string>>>();

  // The provider packages are loaded on first use and shared. Importing both up
  // front would pull in transports a runtime configured for one provider never
  // touches.
  let openai: Promise<typeof OpenAi> | undefined;
  let compatible: Promise<typeof OpenAiCompatible> | undefined;

  const loadOpenAi = (): Promise<typeof OpenAi> => (openai ??= import('@ai-sdk/openai'));
  const loadCompatible = (): Promise<typeof OpenAiCompatible> =>
    (compatible ??= import('@ai-sdk/openai-compatible'));

  const localBaseUrl = (override?: string): string | undefined => {
    const configured = override?.trim() || env.LOCAL_BASE_URL?.trim();
    return configured ? assertLoopbackUrl(configured) : undefined;
  };

  const pick = (configured: string | undefined, setting: string): ProviderId => {
    if (!configured) return defaultProviderId;
    if (!isProviderId(configured)) {
      throw new RuntimeError(
        `Unknown ${setting} "${configured}". Supported: ${providerIds.join(', ')}.`,
        'misconfigured'
      );
    }
    return configured;
  };

  const keyFor = (providerId: ProviderId, supplied: string | undefined): string =>
    credentialFor(credentialRequest(providerId, supplied), env);

  /**
   * The environment's model, if it was set for the provider in use.
   *
   * A model name means something only to the provider it was written for:
   * `nomic-embed-text` is on a local server and not at OpenAI. So an override
   * naming another provider gets that provider's default, not a model meant
   * for the one the environment names.
   */
  const modelOf = (
    providerId: ProviderId,
    variables: { provider: string; model: string; fallback: ProviderId }
  ): string | undefined =>
    (env[variables.provider]?.trim() || variables.fallback) === providerId
      ? env[variables.model]?.trim() || undefined
      : undefined;

  const describe = (override: ModelOverride = {}): ModelChoice => {
    const providerId = pick(
      override.providerId?.trim() || env.AI_PROVIDER?.trim(),
      'AI_PROVIDER'
    );

    return {
      providerId,
      modelId:
        override.modelId?.trim()
        || modelOf(providerId, {
          provider: 'AI_PROVIDER',
          model: 'AI_MODEL',
          fallback: defaultProviderId
        })
        || providers[providerId].defaultModel,
      // Only the local provider may be repointed. Accepting a URL for a hosted
      // one would make this an open proxy that spends our credential.
      baseURL: providerId === 'local' ? localBaseUrl(override.baseURL) : undefined
    };
  };

  const describeEmbedding = (override: ModelOverride = {}): ModelChoice => {
    const providerId = pick(
      override.providerId?.trim()
        || env.EMBEDDING_PROVIDER?.trim()
        || defaultEmbeddingProviderId,
      'EMBEDDING_PROVIDER'
    );
    const provider = providers[providerId];

    if (!provider.embeds) {
      throw new RuntimeError(
        `${provider.label} serves no embeddings endpoint. Set EMBEDDING_PROVIDER to one `
          + 'that does — "local" runs on this machine.',
        'misconfigured'
      );
    }

    const modelId =
      override.modelId?.trim()
      || modelOf(providerId, {
        provider: 'EMBEDDING_PROVIDER',
        model: 'EMBEDDING_MODEL',
        fallback: defaultEmbeddingProviderId
      })
      || provider.defaultEmbeddingModel;

    if (!modelId) {
      throw new RuntimeError(
        `No embedding model configured for ${provider.label}. Set EMBEDDING_MODEL.`,
        'misconfigured'
      );
    }

    return {
      providerId,
      modelId,
      baseURL: providerId === 'local' ? localBaseUrl(override.baseURL) : undefined
    };
  };

  /**
   * Builds through the cache unless the caller brought its own key.
   *
   * The cache is keyed by provider, model and base URL — not by credential — so
   * storing a caller-built client under that key would hand the next caller a
   * client whose Authorization header belongs to someone else. Adding the key
   * to the cache key would fix the collision and leave every key the process
   * has ever seen sitting in a `Map` for its lifetime, which is worse. Skipping
   * the cache costs the construction of a client object; no request is made.
   */
  const through = <T>(
    cache: Map<string, Promise<T>>,
    choice: ModelChoice,
    supplied: string | undefined,
    build: (choice: ModelChoice, apiKey: string) => Promise<T>
  ): Promise<T> => {
    if (supplied) return build(choice, keyFor(choice.providerId, supplied));

    const key = `${choice.providerId}:${choice.modelId}:${choice.baseURL ?? ''}`;
    let cached = cache.get(key);

    if (!cached) {
      cached = build(choice, keyFor(choice.providerId, undefined));
      cache.set(key, cached);
      // A failed build must not stick, or the process keeps serving the
      // rejection after the environment is fixed.
      cached.catch(() => { if (cache.get(key) === cached) cache.delete(key); });
    }

    return cached;
  };

  const buildLanguage = async (choice: ModelChoice, apiKey: string): Promise<LanguageModel> => {
    const provider = providers[choice.providerId];

    if (!provider.baseURL) {
      const { createOpenAI } = await loadOpenAi();
      return createOpenAI({ apiKey })(choice.modelId);
    }

    const { createOpenAICompatible } = await loadCompatible();

    return createOpenAICompatible({
      name: choice.providerId,
      baseURL: choice.baseURL ?? provider.baseURL,
      apiKey,
      supportsStructuredOutputs: provider.supportsStructuredOutputs
    })(choice.modelId);
  };

  const buildEmbedding = async (
    choice: ModelChoice,
    apiKey: string
  ): Promise<EmbeddingModel<string>> => {
    const provider = providers[choice.providerId];

    if (!provider.baseURL) {
      const { createOpenAI } = await loadOpenAi();
      return createOpenAI({ apiKey }).textEmbeddingModel(choice.modelId);
    }

    const { createOpenAICompatible } = await loadCompatible();

    return createOpenAICompatible({
      name: choice.providerId,
      baseURL: choice.baseURL ?? provider.baseURL,
      apiKey
    }).textEmbeddingModel(choice.modelId);
  };

  // `async` on the two builders is not decoration. Both read a setting and a
  // credential before any promise exists, and a function that returns a promise
  // must never also throw synchronously: a caller who writes `.catch(...)` —
  // which is the reasonable thing to write — would not catch it.
  return {
    clearCache() { languageCache.clear(); embeddingCache.clear(); },
    describe,
    describeEmbedding,
    async language(override = {}) {
      return through(languageCache, describe(override), override.apiKey?.trim(), buildLanguage);
    },
    async embedding(override = {}) {
      return through(
        embeddingCache,
        describeEmbedding(override),
        override.apiKey?.trim(),
        buildEmbedding
      );
    }
  };
};
