# Independent integration discovery — v2

The runtime now contains a provider-neutral connection client in
`src/effects/integration-providers.ts`, with its complete contract vendored under
`vendor/integration-protocol`. It builds without a provider checkout. The client
does not know a particular provider identity, host, job board or market.

The runtime now uses these connections for automatic discovery and browser
listing capture when `INTEGRATION_PROVIDERS_JSON` is configured (or the host
injects `integrationProviders`). An explicit empty array disables live provider
sources. Leaving both provider seed variables unset also configures no live sources.
Studio supplies a public product preset through `INTEGRATION_PROVIDERS_DEFAULTS_JSON`.
When no settings row or explicit `INTEGRATION_PROVIDERS_JSON` exists, the runtime
validates and persists that preset once. Saved settings (including an empty list),
disabled connections and explicit environment configuration always take precedence.
The standalone runtime has no built-in provider identity or signing key.

Studio now manages these connections through Settings → Job providers. Use a
rebuilt runtime/Studio bundle; this does not update an already installed app.

## Inspect connections

Set `INTEGRATION_PROVIDERS_JSON` to a JSON array of connection records conforming
to `vendor/integration-protocol/schemas/connections.schema.json`. Set
`INTEGRATION_PROVIDERS_CACHE_DIR` to an absolute, user-private directory. Run:

```sh
pnpm exec tsx scripts/integration-providers-inspect.ts
```

Each record supplies an opaque local `id`, expected `providerId`, display `name`,
HTTPS `resolveUrl`, `authentication` (`none` or `bearer`), explicitly trusted
`publicKeys`, `scope` (`categories` and `markets` arrays), `enabled` and `priority`.
For bearer authentication, `credentialRef` names an environment variable holding
the token. No credential value belongs in the JSON configuration. Empty scope
arrays mean unrestricted dimensions. `[]` configures no providers.

The inspector downloads signed integration metadata and reports provider status,
release identity and source labels. It does not collect jobs or send searches,
CVs, cookies or saved offers. It deliberately does not automatically trust keys
advertised by a descriptor. Obtain and verify the identity and signing key before
putting them in the connection configuration.

## Isolation and lifecycle

Each connection has separate credentials, signature verification, a durable
verified-envelope cache, sequence checks and refresh state. Trust/endpoint/scope
changes use a different cache. A verified unexpired release can serve during an
outage; an expired release retains the sequence baseline but cannot authorize
collection. The client refreshes after restart and coalesces concurrent requests.

Sources retain their original signed IDs alongside stable local keys derived from
connection ID plus source ID. Source ordering follows configured priority, then
local connection ID. A selected source search binds execution to that provider.
For free browser captures, the uniquely lowest priority wins; equal priorities
require an explicit source selection. A different provider must use a new local
connection ID; IDs are persistent identities, not editable display names.

Studio's `integrations.*` management channels persist public connection settings
in SQLite (migration 36). Saved settings take precedence over environment seeds,
including an explicitly empty list after removing all connections. Tokens remain
in the system Keychain and a runtime memory map. Opening settings or restarting
never reads Keychain; Refresh / unlock or enabling an authenticated connection
unlocks only that connection's credential.

Descriptor inspection accepts an HTTPS descriptor URL or neutral descriptor JSON.
It displays identity, endpoint, capabilities, scope and SHA-256 Ed25519 key
fingerprints. Saving requires explicit trust and an unexpired inspection. The
review is bound to immutable inspected data. Endpoint or signing-key changes
require a new review and forget the previous credential; another provider identity
requires a new connection. Names, scope and priority can be configured separately.

Disable/removal/configuration changes abort in-flight provider and collector
requests and invalidate browser authorizations from the old connection generation.
Removal disables first, deletes the Keychain item, then removes durable settings
and connection caches. A Keychain failure leaves the connection disabled for
retry. Signed metadata retained for historical offers is descriptive and cannot
start collection. No saved offer or acquisition record is deleted.

Source icons are fetched only from verified source metadata, without credentials,
cookies or referrers. HTTPS redirects are rejected. PNG/WebP byte length, SHA-256,
MIME and bounded raster dimensions are checked before caching and rendering;
unavailable or invalid assets use a generic icon. Attribution remains provider
metadata. Source pickers show the provider name when integrations overlap.

## Execution and saved history

The scraper advertises `recipeBinding: provider-source-v1`. The runtime disables
v2 automatic collection against older collectors. Requests carry the unmodified
provider recipe plus a binding containing local connection ID and provider-local
source ID. The collector checks the derived source key, separates cursors/refusal
state by that key and binds extracted rows to it. No provider credential is sent
to the collector or job board.

Continuations retain their original recipe and release. New searches see updates;
expiry, withdrawal, disable and removal stop further collection. Browser captures
are validated against the original recipe before storage assigns the local key.
Already captured previews remain available for review and explicit import after
provider withdrawal; no further page acquisition is permitted.

Migration 35 adds immutable recipe/provenance definitions and per-offer acquisition
records. The latter retain the provider, local connection, original source ID,
source key, release, recipe revision/hash, engine/version and first/latest sighting.
Repeated sightings with identical provenance are coalesced. Up to 1,000 recent
provenance definitions accompany catalogue results; older definitions remain in
SQLite. No credentials or full browser pages are stored in these tables.

Canonical offer IDs, original board labels, notes and application history are
preserved. Provider-local IDs never deduplicate across providers; canonical URLs
still do. Cache membership and saved-result source filtering use the acquisition
source key. Historical rows have no provider provenance until a real new
acquisition occurs; the migration does not invent bindings for them.

DOM/detail/sitemap recipes use the shared generic engines; see
[generic-provider-engines.md](generic-provider-engines.md). Board-specific desktop
code removal and Studio provider management are implemented locally. Production
activation, provider-directory search and expanded maintenance remain later gates.

## Verification

```sh
pnpm exec tsx --test scripts/integration-providers.test.ts scripts/integration-discovery.test.ts scripts/integration-history.test.ts scripts/integration-browser.test.ts scripts/integration-management.test.ts
node --test vendor/integration-protocol/conformance.test.mjs
```

Tests use independent synthetic providers with overlapping source and key IDs.
They exercise credentials, priority, isolated outages/expiry, restart/downgrade,
impersonation/tamper/scope rejection, cache binding, disable/remove races,
coalescing and caller mutation. No provider network service is needed.
