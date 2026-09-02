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
| ~~`sources/`~~ | ~~`effects/sources.ts`~~ | **Done.** PDF and image reading. The spine's version covers more, not less — see below. |
| ~~`store/preferences.ts`~~ | ~~`capabilities/offers/preferences.ts`~~ | **Done.** A `documents` row rather than a JSON file — it is read whole, written whole and never queried by field. `PreferencesStore` is replaced by `DocumentStore`. |
| ~~`store/offerRecord.ts`~~ | ~~`contracts/offer.ts` + `storage/sqlite/`~~ | **Done.** The vocabulary and the schema. Its `OfferRecordStore` is replaced by `OfferStore`, whose `needingRating` is a WHERE clause where this was a full scan. |
| ~~`ai/logging.ts`~~ | ~~`effects/ai.ts`~~ | **Done.** An `ai_calls` table, and the default sink. See below for the three things here that were deliberately not taken. |
| ~~`prompt/builder.ts`~~ | ~~`context/`~~ | **Done.** Superseded entirely — see below. |
| ~~`capabilities/*.ts` (flat)~~ | ~~`src/capabilities/`~~ | **Done.** All twelve had a counterpart. The spine's survived each, and one guard came back with them. |
| `scripts/*.test.ts` | `scripts/` | The tests that cover the above, rewritten against the ported shape. |

### Ported so far

`boards`, `identity`, `salary`, `criteria`, `queries` and `verify` live in
`src/capabilities/offers/`, beside `preferences.ts`.

`boardFacts.ts` came across too and should not have: `analyzeOffer.applyStated`
is the same function, down to the note about why `contract_type` is not taken
from the board, and `StatedFacts` was already in `contracts/`. It was deleted
rather than reconciled. The lesson generalises to the flat `capabilities/*.ts`
below — check the spine for the function before porting the file.
They are pure — no I/O, no storage — which is why they went first: they needed
only the vocabulary, not the engine.

`shortlist` and `rescore` followed, with the queries they used to do in memory
pushed into `OfferStore` — `staleRatings` and `countRated`.

`round` and `boardSearch` finished the directory. Everything below them was
already on the spine and better: `resolve`, `fetch`, `page` and `scraper` are
`effects/offers.ts` — one politeness map, an SSRF guard applied at every
redirect hop rather than only the first — and `webSearch` is `effects/search.ts`,
Brave and DuckDuckGo behind an instance rather than module state. They were
deleted, not ported. `offers/` is gone.

`core/fingerprint.ts` became `src/hash.ts`, and `retrieval/chunk.ts` now uses it
instead of its own identical copy of the same eight lines.

`sources/` needed one line. `MIN_PDF_CHARS` and the scanned-PDF refusal are
already on the spine word for word, and mime derivation sits better in the CLI
adapter than in a reader. Its corpus ceiling is handled better on the spine
too: this truncated to 24,000 characters at read time and threw the rest away,
where `labelled('CV SOURCES', text, DEFAULT_BUDGET.source)` trims per prompt and
keeps the document. The one real loss was the `=== SOURCE: … ===` boundary
between concatenated documents — a model reading that marker is measurably less
likely to merge two employers across the join — so `cv/extract.ts` writes it
again, and only when there is more than one source to separate.

The twelve flat `capabilities/*.ts` were reconciled by comparing what actually
carries the domain judgment — the rule strings, the thresholds, the regexes —
rather than by reading 5,000 lines of plumbing that is different by definition.
`findSummary` and `applicationText` came out with *identical* sets of string
literals and numeric constants against `cv/summary.ts` and `apply/text.ts`. The
recipient trio, `translate_cv`, `extract_cv`, `draft_application` and
`analyze_offer` differed only in schema descriptions, renamed constants
(`HIGHLIGHT_LIMIT` is `PASSAGE_LIMIT`, same value, same job) and import paths.
Both registries list the same six capabilities.

One thing was genuinely missing, and it is a guard rather than a feature, so it
came back: the previous `generate_evidence_summary` refused a claim naming a
technology the vacancy asked for that the candidate has no evidence for. It did
it with a `forbiddenTechnologies` array the *caller* had to compute and pass in,
which is why it was easy to lose — nothing on the spine ever set it. It does not
need to be passed: `analyze_offer` already produces the offer's required skills
and the fact catalogue already holds everything the CV says, so `claims.ts`
computes the difference itself and `review` refuses on it, beside the invented-
number check it is the sibling of. The requirements the CV cannot support are
marked `[not on the CV]` in the prompt so a run does not fail on a rule it was
never told.

**Recorded rather than restored** — features the previous runtime had that the
spine deliberately does not, each now written down somewhere it will be found:

- `ask_profile` answered about **saved offers** as well as the CV. The spine's
  answers about the CV only, because there is no `search_offers` tool. The
  header of `src/tools/index.ts` says that tool needs a port that does not
  exist; that is now out of date — `OfferStore.search` exists — and what is
  left is a `ToolContext` that does not carry offers.
- `read_cv_summary`. Same file, same note, still true: it would put one
  capability's knowledge of the CV schema in the path of every other.
- `tool_calls` in `ask_profile`'s result. Deliberate, and the reasoning is in
  `askProfile.ts` itself rather than here.

`ai/logging.ts` needed a table, not a logger. The spine has wrapped every model
call since `effects/ai.ts` was written and `AiLogEntry` already says what a line
carries; what it lacked was anywhere durable to put one. `storage/sqlite/ai-log.ts`
is that place, and it is now the default — `consoleLogger` is still exported but
demoted, and moved from stdout to stderr, because the host this runtime is being
built for is a child process whose stdout is the transport. A log line inside a
JSON-RPC frame is worse than no log line.

Three things here were read and deliberately not taken:

- **`withAiTrace` / `currentAiTraceId`.** An `AsyncLocalStorage` carrying the
  trace id ambiently. The spine threads it explicitly through `EffectCall`, so
  a call that is missing one does not compile rather than logging under
  whichever trace happened to be on the stack.
- **`sha256` of the prompt.** It would tell you the same prompt was sent twice
  without storing it, which is genuinely useful. It is still a payload-derived
  identifier in a table whose whole claim — asserted in `aiLog.test.ts` against
  `PRAGMA table_info` — is that no column can hold one. The claim is worth more
  than the convenience.
- **`AiLogMode` and `AI_LOG_MODE`.** Off versus metadata, read from the
  environment. The caller passes `silentLogger`; an env var is a second way to
  say the same thing and a second thing to get wrong.

**Still missing, and worth knowing:** which tools a `tool_loop` actually called.
The port summarised every interaction — name, status, sizes — and the spine logs
one row for the whole loop and a `toolSteps` count on the step value. On a small
local model that is the most useful debugging signal there is. It wants a
second table and a change to the gateway, so it is its own piece of work rather
than a rider on this one.

`prompt/builder.ts` needed nothing. `compose` is in `context/render.ts` with a
wider signature; `EXTRACTION_RULES` and `DRAFTING_RULES` are inlined at the
three capabilities that use them; `renderProfileContext`, `renderOffer`,
`renderCandidate` and `renderOfferBrief` are `numbered`/`labelled`/`fields`
calls at their call sites; and `toolSystemPrompt`'s instruction — you cannot see
this directly, use the tools, say so when they return nothing — is in
`askProfile`'s system prompt. The builder's own header argues that composition
should be explicit rather than automatic, and the spine takes that further than
the builder did: the rules live beside the work they govern.

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
