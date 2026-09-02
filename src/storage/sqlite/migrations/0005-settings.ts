/**
 * Somewhere for the provider choice to live between launches.
 *
 * Until now every model setting came from the environment, which works for a
 * server someone deploys and not at all for an application someone installs:
 * there is no shell in front of a double-clicked app, so `AI_PROVIDER` is a
 * setting the user cannot set. The choice belongs in the database that already
 * holds everything else the product remembers.
 *
 * One row, enforced by the primary key check rather than by convention. A
 * settings table that can hold two rows eventually holds two rows, and then
 * every read needs an ordering and a tie-break — for a value with exactly one
 * correct answer.
 *
 * Named columns rather than a key/value pair table. The durable schema is the
 * product's schema: five settings that the code names individually should be
 * five columns a query can read, not five rows whose keys are strings nothing
 * checks. Adding a sixth is a migration, which is the correct amount of
 * friction for adding something the whole application has to understand.
 *
 * **No column holds a credential.** Not omitted for now — omitted structurally,
 * the same way `ai_calls` has no column for a prompt. A key that cannot be
 * written cannot leak from here into a backup, a support bundle or a copy of
 * the file someone mails themselves. The keychain on the host's side is the
 * store of record, and `secrets.set` carries it into memory for the life of the
 * process.
 *
 * Every column is nullable and NULL means *not configured*, which is distinct
 * from the empty string. Clearing the model field in a settings page should
 * fall back to the provider's default, not pin the model to "".
 */

export const settings0005 = /* sql */ `

CREATE TABLE settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  provider_id           TEXT,
  model_id              TEXT,
  local_base_url        TEXT,
  embedding_provider_id TEXT,
  embedding_model_id    TEXT,
  updated_at            INTEGER NOT NULL
);

-- The row exists from the first launch, so a read is never a special case and
-- a write is never an upsert. Nothing is configured yet; that is what the NULLs
-- say, and it is the honest starting state rather than a guess at a default.
INSERT INTO settings (id, updated_at) VALUES (1, 0);
`;
