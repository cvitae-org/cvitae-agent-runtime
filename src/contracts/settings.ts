/**
 * What the user chose about models, and what is deliberately not here.
 *
 * Provider choice is product state, not deployment state. It survives a
 * restart, it is edited from a settings page, and a person expects the thing
 * they picked last week to still be picked — which makes it a row in the same
 * database as everything else the product remembers, rather than an environment
 * variable a desktop app has no way to set.
 *
 * **There is no field for a credential, and the table has no column for one.**
 * That is the enforcement, in the same way `ai_calls` having no `prompt` column
 * is the enforcement there: a key cannot be persisted by accident because there
 * is nowhere for it to go. Keys live in the OS keychain on the host's side and
 * reach this process over `secrets.set`, which writes into a mutable
 * environment held in memory and nowhere else.
 *
 * Every field is optional, and absent means *not configured* rather than
 * empty — the environment's value applies, then the provider's default. That is
 * what makes clearing a field in the settings page do the useful thing: it
 * returns to the default rather than pinning an empty string.
 */

export type Settings = {
  readonly providerId?: string | undefined;
  readonly modelId?: string | undefined;
  /** Loopback only, checked before it is stored. */
  readonly localBaseUrl?: string | undefined;
  readonly embeddingProviderId?: string | undefined;
  readonly embeddingModelId?: string | undefined;
};

export interface SettingsStore {
  read(): Settings;
  /**
   * Replaces every field, rather than merging into what is there.
   *
   * A merge cannot express "clear this", and the caller is a settings form that
   * knows all five values — so the shape that cannot be half-applied is the one
   * that matches how it is actually used. A partial write here would silently
   * keep an old provider beside a new model, which is a configuration nobody
   * chose and nobody can see.
   */
  replace(next: Settings): Settings;
}
