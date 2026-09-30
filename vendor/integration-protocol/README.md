# Job integration provider protocol v2

An independent provider implements this contract to distribute source metadata
and declarative recipes. Clients execute recipes locally. This package contains
no board catalogue, provider identity, API credentials or job collection service.

The package is currently a local, versioned artifact, not published to a package
registry. Consumers may vendor the complete package and use their own Zod 4
dependency. A desktop build must not require this provider repository. The schemas
under `schemas/` support non-JavaScript implementations; semantic validation in
the module remains mandatory, since JSON Schema cannot encode every invariant.

## Connection and trust

A descriptor contains `protocol: job-integrations`, `schemaVersion: 2`, a stable
`providerId`, display name, website, resolve endpoint, authentication mode,
capabilities, scope vocabulary and Ed25519 public keys. Descriptors advertise
capabilities and keys; they do not establish trust. A user-configured connection
pins expected provider identity, endpoint and independently approved keys.

`connectionSchema` describes local connection settings: `id`, `providerId`,
`name`, `resolveUrl`, `authentication`, optional `credentialRef`, `publicKeys`,
`scope`, `enabled` and `priority`. IDs are local opaque names, never provider
names. A credential reference names a locally resolved secret; its value is
neither part of the descriptor nor the connection document.

Supported authentication modes are `none` and `bearer`. No provider-specific
authentication code or callback is needed. Other authentication protocols require
a future generic capability. Normal requests use HTTPS and do not follow redirects.

## Resolve

POST to the configured resolve endpoint with JSON matching `resolveSchema`:

```json
{
  "protocol": "job-integrations",
  "schemaVersion": 2,
  "client": { "id": "example_desktop", "version": "1.0" },
  "capabilities": ["http-json-v1", "embedded-json-v1", "external-link"],
  "scope": { "categories": ["science"], "markets": ["CA", "NZ"] },
  "knownRevision": null
}
```

Empty categories or markets means no restriction in that dimension. Both
dimensions otherwise filter the catalogue; values are provider-defined strings.
The response echoes the exact requested scope, including when there are no
matching sources. v2 returns a full snapshot; `knownRevision` is advisory.

The response envelope contains `algorithm`, `keyId`, `payloadBase64` and
`signatureBase64`. Verify Ed25519 over the exact decoded payload bytes, then
validate the snapshot and its binding to the configured provider and scope.
Persist a verified envelope before activating it. Reject decreasing release
sequences and a changed revision at the same sequence. Every source recipe must
match its source identity, revision and declared hosts.

Sources carry routes, labels, market/category membership, presentation metadata,
health, limitations and negotiated recipes. v2 has no `installed-adapter` mode.
An implementation without a portable recipe can expose a normal website link.
Unknown data fields, executable code and unbounded expressions are not supported.
New engine primitives require an engine/protocol update, not arbitrary downloads.

## Identity and isolation

Each connection has its own trust configuration, credential resolution, cache,
release sequence and revocations. `sourceKey(connectionId, sourceId)` produces a
stable local key for routing and preferences. The original signed source ID and
recipe remain unchanged and must be preserved as provenance. A provider-local
source ID is not a globally unique job-board identity or a canonical offer ID.

`cacheKey(connection)` binds cached envelopes to connection identity, expected
provider identity, endpoint, scope and trusted keys. Changing those settings does
not reuse another connection's authorization cache. An outage may use a verified,
compatible, unexpired cached release; expired releases are descriptive history
only. One provider's outage or high sequence number cannot invalidate another.

## Limits and conformance

Snapshots contain at most 128 sources and 1,000 revocations, last at most 14 days,
and advertise refresh intervals from five minutes to one day. This protocol
does not prescribe maintenance schedules or require provider admin endpoints.
The portable engines are `http-json-v1`, `embedded-json-v1`, `dom-listing-v1`,
`dom-detail-v1` and `sitemap-v1`. Listing recipes use `recipe`, browser listings
use `browserRecipe`, and optional `detailRecipe` supplies one-offer extraction
for HTTP and browser execution. DOM listings used by both transports must have
identical definitions. CSS selectors and taxonomy maps are bounded data. Required
identity, search acknowledgement and pagination checks prevent stale/ambiguous
pages from becoming successful captures. Sitemap results carry provisional slug
titles and explicitly bounded coverage. No engine executes downloaded code.

Run `npm test` in this package to exercise the included synthetic conformance
fixtures: unfamiliar identities/scopes, strict schemas, exact-byte signatures,
explicit trust and isolation. No provider API, credential or sibling checkout is
needed. `scripts/test-provider-protocol.mjs` in the developing repository separately
tests the reference provider's v1/v2 coexistence. Generated declarations ship with
this artifact; consuming applications do not need the provider checkout.
