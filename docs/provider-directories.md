# Provider directory discovery

Directory discovery is separate from provider connections and the v2 recipe
protocol. No directory or provider is preconfigured. Direct descriptor URL/JSON
inspection remains available without discovery.

The neutral `vendor/integration-protocol/directory.mjs` contract describes a
public `job-provider-directory` schemaVersion 1 catalogue. Each entry carries an
operator-scoped ID, provider identity, description, website, descriptor URL,
provider protocol version, scope and capabilities, including required engines.
It contains no signing keys, recipes, credentials or offers. Catalogue entries
are untrusted discovery metadata; only a fresh descriptor inspection followed by
explicit user trust can create a provider connection.

## Desktop IPC

These strict channels are private desktop management operations, not AI tools or
recipe operations:

| Channel | Payload | Effect |
| --- | --- | --- |
| `directories.list` | `{}` | Read settings and cached status without networking |
| `directories.save` | `{id?, name, url, enabled}` | Persist configuration; invalidate old requests/results |
| `directories.remove` | `{id}` | Remove configuration and results; retain providers/history |
| `directories.search` | `{query?, scope?, capabilities?, refresh?}` | Fetch public catalogues and filter locally |
| `directories.inspect` | `{id, entryId}` | Fetch and identity-check the current descriptor; return an M6 inspection ticket |

SQLite migration 37 stores only directory configurations. Catalogues and their
status remain in memory. Results are keyed by local directory ID plus entry ID;
overlap across independent operators is preserved. No trust or credential state
is copied from directory metadata. Inspection requires matching provider ID and
required capabilities; signing fingerprints come from the actual descriptor.

## Bounds and lifecycle

- At most eight directories, 128 entries per catalogue and 500,000 response bytes.
- Anonymous public HTTPS GET, no body, redirects, cookies or authorization;
  query/filter values never leave the runtime. Descriptor inspection is also
  anonymous and uses the existing bounded M6 fetch.
- Three concurrent directory workers, eight-second request timeout, five-minute
  refresh interval. Explicit refresh bypasses the interval.
- Catalogue validity is at most seven days; future generation beyond five
  minutes and expired metadata are rejected. Failed refresh can reuse only
  unexpired cached metadata, labelled `cached`; independent directories continue.
- Disable, edit, remove and shutdown abort pending requests. Generation checks
  also discard late responses from transports that ignore cancellation.
- Unsupported provider versions or required capabilities block inspection;
  unsupported optional capabilities yield `partial`. Compatibility is a local
  contract check, not a claim about live service availability.

Run `node --import tsx --test scripts/integration-directories.test.ts` with the
project's Node 24.14+ runtime. Tests use temporary SQLite databases and synthetic
transports and cover privacy, explicit trust, restart, overlap, expiry, malformed
and oversized responses, identity substitution, independent outages and races.
