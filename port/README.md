# port/

This is the old runtime, parked. It is not built, not linted, not typechecked
and not on any import path — `tsconfig.json` excludes it and `eslint.config.mjs`
ignores it.

It exists because consolidating two codebases by deleting one of them and
rebuilding from memory is how work gets quietly lost. Everything here either
moves onto the spine in `src/` or is deliberately dropped, and this directory is
empty — and gone — before the branch merges. A non-empty `port/` on `master`
means the consolidation stopped halfway.

## What has to come out

| here | goes to | why |
| --- | --- | --- |
| `offers/` (10 files left of 17) | `effects/` + `capabilities/` | What remains is the part that does I/O or holds state: `round`, `boardSearch`, `rescore`, `shortlist`, `resolve`, `fetch`, `scraper`, `page`, `webSearch`, `index`. The pure judgment is ported. |
| `sources/` | `effects/sources.ts` | PDF and image reading. The spine's version covers less. |
| ~~`store/preferences.ts`~~ | ~~`capabilities/offers/preferences.ts`~~ | **Done.** A `documents` row rather than a JSON file — it is read whole, written whole and never queried by field. `PreferencesStore` is replaced by `DocumentStore`. |
| ~~`store/offerRecord.ts`~~ | ~~`contracts/offer.ts` + `storage/sqlite/`~~ | **Done.** The vocabulary and the schema. Its `OfferRecordStore` is replaced by `OfferStore`, whose `needingRating` is a WHERE clause where this was a full scan. |
| `ai/logging.ts` | `effects/ai.ts` | Metadata-only audit log of every model call. The spine logs nothing. |
| `prompt/builder.ts` | `context/` | Compare against `context/render.ts` before porting; they overlap. |
| `capabilities/*.ts` (flat) | reconcile with `src/capabilities/` | Nine of these have a counterpart on the spine. One version survives each. |
| `scripts/*.test.ts` | `scripts/` | The tests that cover the above, rewritten against the ported shape. |

### Ported so far

`boards`, `identity`, `salary`, `criteria`, `queries`, `verify` and `boardFacts`
(now `facts.ts`) live in `src/capabilities/offers/`, beside `preferences.ts`.
They are pure — no I/O, no storage — which is why they went first: they needed
only the vocabulary, not the engine.

`core/fingerprint.ts` became `src/hash.ts`, and `retrieval/chunk.ts` now uses it
instead of its own identical copy of the same eight lines.

A ported file is deleted from here as it lands, so the files left behind now
import modules that no longer exist beside them. That is intended: nothing in
`port/` is compiled, and a second editable copy of a module already on the spine
is a trap. Read the ported version in `src/`, or `git show` the original.

## What is already decided against

- `server/`, `netlify/`, `netlify.toml`, `public/` — deleted in the commit that
  created this directory, not parked. The consolidated runtime is a stdio child
  process of the desktop app; a second front door is a second thing to keep in
  step, and a loopback port is reachable by any page on the machine.
- `store/lance.ts` — LanceDB is replaced by `storage/sqlite/chunk-index.ts`.
  One storage engine.
- `store/jsonl.ts` — replaced by SQLite. Its writes could not corrupt (temp file
  + rename) but read-modify-write was last-writer-wins.
- `offers/page.ts`'s `refuseUrl` / `isPrivateAddress` — the spine has its own in
  `effects/offers.ts`, behind the effects boundary. The two diverged; the
  spine's survives.
