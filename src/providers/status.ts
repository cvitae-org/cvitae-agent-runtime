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
 *
 * **A server that answers is not the same as a server that works**, and this
 * file used to report them alike: every non-2xx became "nothing is listening".
 * oMLX answers `401 API key required`, so a running server was reported as an
 * absent one and the fix on screen — start it — was the one thing that could
 * not help. The four states below each have a different fix, which is the only
 * reason there are four.
 */

import {
  credentialRequest,
  providerIds,
  providers,
  type ModelResolver,
  type ProviderId
} from './resolve.js';
import { credentialFor } from '../secrets/env.js';
import type { Environment } from './environment.js';

/** How long to wait for a local server before calling it absent. */
const PROBE_MS = 1_500;

/**
 * A provider as a settings page draws it. The label is a name rather than a
 * phrase for the same reason: it is rendered on a button, not in a sentence.
 */
export type ProviderSummary = {
  readonly id: ProviderId;
  readonly label: string;
  /**
   * Three states rather than a boolean, because a local server is the third
   * one: it takes a key if the thing behind it wants one, and works without if
   * it does not. A page that only knows "needs" and "does not need" has to
   * either warn about a key nobody needs or hide the field from someone who
   * cannot get past a 401 without it.
   */
  readonly credential: 'required' | 'optional' | 'none';
  readonly credentialConfigured: boolean;
  readonly defaultModel: string;
  readonly embeds: boolean;
};

/** What answered at the local base URL, and therefore what would fix it. */
export type LocalServerState =
  /** Answered with a model list. */
  | 'ok'
  /** Answered 401 or 403. Something is running; it wants a key. */
  | 'unauthorized'
  /** Answered, but not with a model list. Wrong port, or not OpenAI-compatible. */
  | 'refused'
  /** Nothing answered. Nothing is running. */
  | 'absent';

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
  readonly localState?: LocalServerState;
  /** What an unusable answer's status code was, when there was one. */
  readonly localStatusCode?: number;
  readonly localModels?: readonly string[];
  /** Configured local models the server does not have pulled. */
  readonly missingLocalModels: readonly string[];
  readonly providers: readonly ProviderSummary[];
};

type Probe = {
  readonly state: LocalServerState;
  readonly models: readonly string[];
  /** What it answered, when it answered something unusable. */
  readonly statusCode?: number;
};

const listLocalModels = async (
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch
): Promise<Probe> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS);

  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      signal: controller.signal,
      // Sent the way a run would send it, so this answers the question a run
      // would get rather than a slightly easier one. For a server that wants no
      // key it is the placeholder every OpenAI-compatible client sends anyway.
      headers: { authorization: `Bearer ${apiKey}` }
    });

    if (response.status === 401 || response.status === 403) {
      return { state: 'unauthorized', models: [], statusCode: response.status };
    }

    if (!response.ok) return { state: 'refused', models: [], statusCode: response.status };

    try {
      const body = (await response.json()) as { data?: { id?: unknown }[] };

      return {
        state: 'ok',
        models: (body.data ?? []).flatMap((model) =>
          typeof model.id === 'string' ? [model.id] : []
        )
      };
    } catch {
      // It answered 200 with something that is not a model list, which is a
      // server at that address speaking a different protocol — not an absent
      // one.
      return { state: 'refused', models: [], statusCode: response.status };
    }
  } catch {
    // Refused, unresolved, timed out: nothing answered, and the fix is to start
    // something.
    return { state: 'absent', models: [] };
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
    ? await listLocalModels(
        localBaseUrl,
        credentialFor(credentialRequest('local'), environment.env),
        options.fetch ?? globalThis.fetch
      )
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
      : {
          localState: probe.state,
          localModels: probe.models,
          ...(probe.statusCode === undefined ? {} : { localStatusCode: probe.statusCode })
        }),
    // Only meaningful once a model list came back. Reporting every configured
    // model as missing because the server is off — or because it wants a key —
    // would put the wrong fix in front of someone whose actual problem is one
    // of those two.
    missingLocalModels:
      probe?.state === 'ok' ? wanted.filter((model) => !isPulled(model, probe.models)) : [],
    providers: providerIds.map((id) => ({
      id,
      label: providers[id].label,
      credential: providers[id].apiKeyEnvVar === ''
        ? ('none' as const)
        : providers[id].credentialRequired
          ? ('required' as const)
          : ('optional' as const),
      credentialConfigured: credentials[id],
      defaultModel: providers[id].defaultModel,
      embeds: providers[id].embeds
    }))
  };
};

