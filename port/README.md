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
| `offers/` (17 files, 4,372 lines) | `effects/` + `capabilities/` | The whole discovery round — board search, criteria, scoring, salary parsing, shortlist, rescore. The spine has none of it; `effects/offers.ts` is only fetch and text extraction. This is the largest single asset in the merge. |
| `sources/` | `effects/sources.ts` | PDF and image reading. The spine's version covers less. |
| `store/preferences.ts` | a capability + a table | The hunt criteria the user edits. |
| `ai/logging.ts` | `effects/ai.ts` | Metadata-only audit log of every model call. The spine logs nothing. |
| `prompt/builder.ts` | `context/` | Compare against `context/render.ts` before porting; they overlap. |
| `capabilities/*.ts` (flat) | reconcile with `src/capabilities/` | Nine of these have a counterpart on the spine. One version survives each. |
| `scripts/*.test.ts` | `scripts/` | The tests that cover the above, rewritten against the ported shape. |

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
