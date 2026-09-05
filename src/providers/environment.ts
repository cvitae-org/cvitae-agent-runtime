/**
 * The configuration a running process is actually using, and the one copy of it
 * that can change while it runs.
 *
 * `createModelResolver` reads its settings off an `Env`, which until now was
 * always `process.env` — fine for a server started from a shell, useless for an
 * application someone double-clicks. This is the same interface backed by a
 * record this process owns, seeded from the environment it inherited and then
 * overlaid with what the user chose.
 *
 * Overlaid in that order, not the other way round: a person who picked a
 * provider in a settings page yesterday should still be using it today, and the
 * inherited environment is what applies to the fields they left alone. Clearing
 * a field restores the inherited value rather than pinning an empty string,
 * which is why the seed is kept rather than merged away.
 *
 * **A credential written here is written nowhere else.** The record is a copy,
 * so a key set through `secret` never lands in `process.env` — not visible to a
 * child process, not in a crash dump of the environment, not in anything that
 * prints it. It lives for as long as this process does and no longer, and the
 * settings table has no column that could keep it.
 *
 * Nothing above `effects/` may see this module's contents, which is the same
 * rule that keeps `secrets/` where it is: a resolver receives the record, and a
 * step receives a gateway.
 */

import { RuntimeError, type Settings } from '../contracts/index.js';
import { hasCredential, type Env } from '../secrets/env.js';
import { assertLoopbackUrl, isProviderId, providerIds, providers } from './resolve.js';
import type { ProviderId } from './resolve.js';

/**
 * Which variable each setting stands in for.
 *
 * Stated once, here, because the alternative is five `if` branches that each
 * have to remember both halves of a pair. The resolver reads these names and
 * nothing else, so a setting not in this table is a setting with no effect.
 */
const VARIABLES = {
  providerId: 'AI_PROVIDER',
  modelId: 'AI_MODEL',
  localBaseUrl: 'LOCAL_BASE_URL',
  embeddingProviderId: 'EMBEDDING_PROVIDER',
  embeddingModelId: 'EMBEDDING_MODEL'
} as const satisfies Record<keyof Settings, string>;

const knownProvider = (value: string, setting: string): ProviderId => {
  if (!isProviderId(value)) {
    throw new RuntimeError(
      `Unknown ${setting} "${value}". Supported: ${providerIds.join(', ')}.`,
      'misconfigured'
    );
  }
  return value;
};

/**
 * Refuses a setting that cannot work, before it is stored.
 *
 * Checked on the way in rather than at the point of use, because a bad value
 * that reaches the table breaks every launch afterwards — including the launch
 * of the settings page that would let someone fix it. The cost of being strict
 * here is one error message; the cost of being lax is an application that has
 * to be repaired with a SQL client.
 */
export const validateSettings = (settings: Settings): Settings => {
  const blank = (value: string | undefined): string | undefined => value?.trim() || undefined;

  const providerId = blank(settings.providerId);
  const embeddingProviderId = blank(settings.embeddingProviderId);
  const localBaseUrl = blank(settings.localBaseUrl);

  if (providerId) knownProvider(providerId, 'provider');

  if (embeddingProviderId) {
    const provider = providers[knownProvider(embeddingProviderId, 'embedding provider')];

    // Caught here rather than on the first indexing call, which is the worst
    // possible time to discover it: a CV import that gets most of the way
    // through and then fails on a setting chosen days earlier.
    if (!provider.embeds) {
      throw new RuntimeError(
        `${provider.label} serves no embeddings endpoint. Choose one that does — `
          + '"local" runs on this machine.',
        'misconfigured'
      );
    }
  }

  return {
    providerId,
    modelId: blank(settings.modelId),
    // Normalised as well as checked, so what is stored is what will be used.
    localBaseUrl: localBaseUrl ? assertLoopbackUrl(localBaseUrl) : undefined,
    embeddingProviderId,
    embeddingModelId: blank(settings.embeddingModelId)
  };
};

export type Environment = {
  /** Hand this to `createModelResolver`. It changes underneath it, on purpose. */
  readonly env: Env;
  /** Replaces every setting. Fields left unset fall back to the inherited environment. */
  apply(settings: Settings): void;
  /** Holds a credential for the life of the process. Never persisted. */
  secret(providerId: string, apiKey: string | undefined): void;
  /** Whether each provider has a key available, without reading one. */
  credentials(): Readonly<Record<ProviderId, boolean>>;
};

export const createEnvironment = (base: Env = process.env): Environment => {
  // Two copies: one that changes and one to fall back to. Sharing them would
  // make "clear this setting" indistinguishable from "this was never set",
  // and the first should restore the deployment's value.
  const inherited: Env = { ...base };
  const env: Record<string, string | undefined> = { ...base };

  const put = (variable: string, value: string | undefined): void => {
    if (value === undefined) delete env[variable];
    else env[variable] = value;
  };

  return {
    env,

    apply(settings) {
      for (const [field, variable] of Object.entries(VARIABLES)) {
        put(variable, settings[field as keyof Settings] ?? inherited[variable]);
      }
    },

    secret(providerId, apiKey) {
      const provider = providers[knownProvider(providerId, 'provider')];

      // Not silently ignored: a form that accepts a key and drops it is worse
      // than one that refuses. This no longer catches a local server, which was
      // the case it was written for — oMLX requires a key, so a local key is a
      // real thing to store and its provider now has a variable to store it in.
      if (provider.apiKeyEnvVar === '') {
        throw new RuntimeError(
          `${provider.label} takes no credential, so there is nothing to store.`,
          'misconfigured'
        );
      }

      put(provider.apiKeyEnvVar, apiKey?.trim() || inherited[provider.apiKeyEnvVar]);
    },

    credentials: () =>
      Object.fromEntries(
        providerIds.map((id) => [id, hasCredential(providers[id].apiKeyEnvVar, env)])
      ) as Record<ProviderId, boolean>
  };
};
