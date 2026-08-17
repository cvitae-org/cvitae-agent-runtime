# cvitae-agent-runtime

The layer [cvitae](../cvitae) talks to instead of talking to a model.

It owns the provider credentials, the prompts, the tool definitions and the
local store, and exposes a small surface: `runtime.run('analyze_offer', { … })`.
cvitae does not know which provider is configured, whether a capability is a
fixed pipeline or a model driving a tool loop, or where the data sits. Swapping
OpenRouter for Ollama, or adding a capability, happens here and nowhere else.

The organising idea is the one behind a coding harness: **the model acts through
tools or it does not act.** It never receives a database handle, a file path, or
a URL to fetch. It emits tool calls, the runtime executes them against local
storage, and it observes only what a tool chose to return. "User data stays on
this machine" is therefore a property of the wiring rather than a rule someone
has to remember.

## Quick start

```bash
pnpm install
```

```bash
cp .env.example .env
```

Nothing in `.env` is required to start. Generation defaults to OpenRouter and
needs `OPENROUTER_API_KEY`; setting `AI_PROVIDER=local` uses Ollama and needs no
credential at all.

Check the wiring end to end — real LanceDB, and a real model if Ollama is up:

```bash
pnpm smoke
```

Run it as a service for cvitae to call:

```bash
pnpm dev
```

## Importing a CV

```ts
await runtime.run('extract_cv', {
  sources: [
    { kind: 'file', path: '/Users/me/cv.pdf' },
    { kind: 'file', path: '/Users/me/linkedin-screenshot.png' },
    { kind: 'text', label: 'linkedin', content: pastedProfileText },
    // For callers holding bytes rather than a path — see below.
    { kind: 'upload', filename: 'cv.pdf', content: base64OrDataUrl }
  ]
});
```

Everything is reduced to text first — `.txt`/`.md` directly, `.pdf` through `unpdf`,
images through a vision-capable model — then seven narrow extractions run over the
combined corpus and the result is **merged** into `cv.json`.

`kind: 'upload'` exists because cvitae is a browser application: a file picker
there yields a `File` — bytes and a name, never a location this process could
open — so `kind: 'file'` is unreachable from the app that owns the CV. Base64
travels in the ordinary JSON envelope rather than as multipart, because
`/run/:name` takes one envelope shape for every capability and a second content
type for one of them would fork that; the cost is a third more bytes over
loopback. A `data:…;base64,` prefix is accepted, since `readAsDataURL` produces
one. Per-file ceiling is 12MB, and the server's body limit is 32MB.

Uploads take the same reader as paths — the two differ only in where the buffer
comes from — so an uploaded PDF and the same PDF on disk cannot diverge.

One thing worth knowing before pointing this at a CV that cvitae exported: those
PDFs are rasterised by html2canvas and carry **no text layer**, so they are
refused with the scan message rather than imported. Import the original, not the
export.

### One section at a time

The seven extractions are independent passes over the same corpus, and on one
local GPU the orchestrator runs them in turn — so a whole import costs their sum
inside a single request budget. On `gemma4:12b` that exceeded four minutes and
failed the entire import for want of the last step.

`sections` narrows a run to the artefacts named, which makes each request one
model call:

```ts
const first = await runtime.run('extract_cv', {
  sources, persist: false, sections: ['skills']
});

// Reuse the corpus rather than re-reading the files. For a PDF that saves a
// parse; for a screenshot it saves a second vision call, which is the whole
// cost of reading it.
await runtime.run('extract_cv', {
  sources: [{ kind: 'text', content: first.text }],
  persist: false,
  sections: ['certificates'],
  // Certificates and spoken languages are cross-checked against extracted
  // skills. A request that did not extract skills has nothing to check
  // against, so what is already known is carried forward.
  known_skills: [...first.document.skills.frameworks /* … */]
});
```

Measured on the real CV with `gemma3:4b`: personal 6.8s, role_description 0s
(it is a parse), skills 5.7s, experience 17.6s, education 2.5s, certificates
2.6s, languages 2.8s. **The point is not that 38s beats 30s — it does not.** It
is that the longest single request is 17.6s, so a budget has to cover one step
rather than seven, and a section that fails costs that section instead of the
import.

`known_skills` matters more than it looks. Split into separate requests without
it, `certificates` returned `ICP Blockchain SDK` again — the exact hallucination
`isCertificate` was added to stop — because the guard had no skills to compare
against. Passing them back restored it: 2 entries to 1.

Merge policy, which is the part worth knowing: an import **may add and may fill a
blank, but never overwrites**. This is not the usual "newest wins", and the
asymmetry is deliberate — what is on disk has survived you looking at it, while
what has just arrived was guessed at by a small model from a screenshot. Losing a
hand-corrected job title to a hallucinated one is the worst thing an importer can
do, and it is silent. The cost: correcting a value means editing `cv.json`, because
re-importing will not do it. Delete the file to start over.

No URLs. A link becomes a `text` source with the URL as its label, because
cvitae-scrapper already settled this question for LinkedIn — it refuses to crawl
and takes text you copied from your own browser instead. Adding a fetcher here
would work around that decision for the one site most likely to ban the account.

### One step does not use the model

`role_description` is parsed, not generated. It is the only artefact that is
already the text you want — every other step restructures prose into fields, but
this one only has to copy a paragraph, and quoting is what a small model is worst
at. Measured against the real cvitae CV on `gemma3:4b`, five phrasings of the
instruction each returned the *instruction*, restated, 4–5 times out of 5:

```
"Copy the professional summary paragraph from the CV."   1/5
"Copy the summary paragraph from the CV."                1/5
"Quote the professional summary from the CV."            0/5
(no system prompt, field description only)               0/5
"Return the professional summary from the CV, word …"    1/5
```

Every failure produced something like *"Summarize the provided CV text into a
concise paragraph"* — plausible, well-formed, not in the CV. `findSummary` parses
it instead: correct on 6 runs out of 6, free, and incapable of hallucinating.

Two guards remain on the model-driven steps, both from measurement rather than
caution. Spoken languages are cross-checked against the extracted skills, because
the real CV heads its skills line `languages: Javascript, HTML, CSS` and the model
took all six as languages it speaks. And a `"present"` sentinel replaces a nullable
end date, because a small model asked for a union writes the string `"null"` into
it about as often as a real null.

## Two execution modes

Every capability declares which one it is, and the answer should be `pipeline`
more often than not.

**`pipeline`** — a declared sequence of narrow schema'd calls, run by the
orchestrator with pooling, one retry on malformed JSON, and per-step
degradation. No tool calling, so it works on models that cannot do it. This is
where extraction lives.

**`tool_loop`** — the model decides what to do next, calling registry tools
until it stops or hits its step ceiling. For work whose shape is not known in
advance: "research this company", "which of my offers suit me".

The distinction is not stylistic. `gemma3:4b` advertises `completion` only — it
cannot call tools, and it runs offer extraction several times faster than
`gemma4:12b`, which can. Building extraction as a tool loop would have cost that
outright.

Both produce a `Plan`, and the orchestrator cannot tell them apart. That is the
seam: if a generated multi-step planner ever earns its place, it slots into
`core/planner.ts` without touching anything downstream.

## Layout

```
src/
  index.ts           createRuntime() — the surface cvitae imports
  core/
    router.ts        request → capability (by name; by model only on request)
    planner.ts       capability → Plan (declared, or model-selected tools)
    orchestrator.ts  walks the Plan; concurrency, degradation, budgets
    executor.ts      runs one Step — the only module that calls a model
    aggregator.ts    merges step output, canonicalises absence spellings
  sources/           txt · pdf (unpdf) · image (vision) → one text corpus
  tools/             defineTool() + the registry that binds context, not data
  prompt/builder.ts  explicit composition — see the note below
  retrieval/         chunking and embedding
  store/             cv.json (authored) · LanceDB (derived) · RRF fusion
  providers/         model resolution, credentials, loopback enforcement
  server/            optional Fastify entry point, loopback-bound
```

## Storage

Everything lives under `~/.cvitae` (`CVITAE_HOME` moves it), split by whether it
is authored or derived:

| Path       | Holds                                  | If you delete it        |
| ---------- | -------------------------------------- | ----------------------- |
| `cv.json`  | the canonical CV document              | the CV is gone          |
| `lance/`   | chunk embeddings, saved offers          | `POST /reindex` rebuilds it |

`cv.json` is a plain file because it is small, singular and edited: it diffs, it
can be corrected by hand when an extraction gets a date wrong, and backing it up
is copying one file. Writes go through a temp file and a rename, so a crash
mid-write leaves the old document rather than half of one.

The LanceDB side is derived by definition, which makes `reindex()` always a
legitimate repair and never a migration.

### Why the CV is not "in a vector database"

Personal details, education, certificates and languages are singleton structured
records — there is one `education` array, so "retrieve the relevant education"
has no meaning. What is genuinely retrievable is the prose inside
`experience[].highlights`: many short claims, of which a given job offer makes a
few relevant. Those are chunked one-bullet-per-chunk and embedded; the rest is a
document.

### Why offers are searched, not just embedded

Offer queries are dominated by hard predicates — work mode, seniority, salary —
and exact keywords. Embeddings blur exactly those distinctions: React and React
Native sit close together, as do senior and mid. So `searchOffers` takes `where`
and `query` separately. `where` is a filter LanceDB applies **before** ranking;
`query` only orders what survives it. Vectors earn their place for near-duplicate
detection across boards and "more like this one", not for finding.

Hybrid results are fused with RRF in `store/lance.ts` rather than through
LanceDB's own hybrid mode, which requires registering an embedding function on
the table — that would fork embedding configuration away from `providers/`.

## Prompts are edited carefully

`prompt/builder.ts` composes explicitly instead of templating, because cvitae
measured the phrasing itself as load-bearing: an earlier wording of a two-line
instruction made `gemma4:12b` return an empty completion every time, with the
same schema that succeeded without it. One step in `capabilities/analyzeOffer.ts`
still carries a comment saying that appending the shared extraction rules breaks
it. Those strings are carried over verbatim and should be changed only with
something to measure against.

## Environment

| Variable                                       | Default                       | Notes                                    |
| ---------------------------------------------- | ----------------------------- | ---------------------------------------- |
| `AI_PROVIDER`                                   | `openrouter`                  | `openrouter`, `huggingface`, `openai`, `local` |
| `AI_MODEL`                                      | the provider's default        |                                          |
| `EMBEDDING_PROVIDER`                            | `local`                       | separate: OpenRouter serves no embeddings |
| `EMBEDDING_MODEL`                               | `nomic-embed-text`            | 768d, 274MB                              |
| `LOCAL_BASE_URL`                                | `http://localhost:11434/v1`   | must be loopback                         |
| `CVITAE_HOME`                                   | `~/.cvitae`                   |                                          |
| `SCRAPER_URL`                                   | `http://127.0.0.1:8787`       | cvitae-scrapper; empty disables it        |
| `PORT` / `HOST`                                 | `8788` / `127.0.0.1`          | keep on loopback                         |
| `RUN_TIMEOUT_MS`                                | `300000`                      | ceiling for one run; a request may send its own `timeoutMs` |
| `ENV_FILE`                                      | `.env`                        | read by the entry points only, never by the library |

Retrieval needs an embedding model, and neither installed Ollama model can
embed:

```bash
ollama pull nomic-embed-text
```

Extraction and the tool loop work without it; only `search_profile`,
`searchOffers` with a `query`, and `reindex` require it.

## HTTP endpoints

Only if you run it as a service. It binds to loopback and has no authentication
— it holds the API keys and the user's CV, and is not built to be reachable by
anything but this machine.

| Method | Path         | Does                                          |
| ------ | ------------ | --------------------------------------------- |
| GET    | `/health`    | capabilities and tools currently registered    |
| GET    | `/state`     | what is indexed — check this when search is empty |
| POST   | `/run/:name` | run a capability; body is the envelope below   |
| POST   | `/run-batch/:name` | run it over many inputs; streams SSE      |
| POST   | `/document`  | replace the CV document and reindex            |
| POST   | `/reindex`   | rebuild the chunk index from `cv.json`         |

### The run envelope

```jsonc
{
  "input":     { "offerText": "…" },   // the capability's own fields
  "model":     { "providerId": "local", "modelId": "gemma3:4b" },  // optional
  "timeoutMs": 55000                    // optional; default RUN_TIMEOUT_MS
}
```

`input` is nested rather than being the body itself, because zod strips unknown
keys: a flat body carrying a stray `model` beside the capability's fields would
validate cleanly with the override silently discarded, and "my model setting did
nothing" is close to undebuggable from outside. A body with no `input` is
rejected with a message saying so.

`model` never carries a credential. Those stay in this process's environment,
which is most of the point of moving them out of cvitae — the provider name is
checked against the enum and `baseURL` goes through the loopback guard.

Two things cancel a run, and they answer differently. Exceeding the budget
returns **504** with `reason: "timeout"`. A caller that hangs up gets **499** and
no body — the run is aborted rather than left to finish, because five parallel
calls against a 50-request daily quota should not keep spending it on a page that
has closed. Neither is reported as a step failure: an abort rejects every
in-flight call at once, and degrading them one by one would hand back a record
full of `"Not stated"` as though the model had read the offer and found nothing.

### Batches

```jsonc
{
  "inputs":      [ { "offerText": "…" }, { "offerText": "…" } ],
  "model":       { "providerId": "local" },  // optional
  "timeoutMs":   120000,                      // optional, bounds ONE input
  "concurrency": 2                            // optional
}
```

```
event: result
data: {"index":1,"status":"ok","data":{…},"degraded":[],"elapsedMs":28004}

event: result
data: {"index":0,"status":"failed","reason":"timeout","error":"…"}

event: done
data: {"completed":1,"failed":1,"elapsedMs":33005,"aborted":false}
```

A batch is M plans, not one plan of M×5 steps — flattening them would break the
aggregator, which shallow-merges outcomes into a single object and would have
offer two's `company` overwrite offer one's.

**Results stream because that is what makes a batch safe to interrupt.** Twenty
offers against a local model is several minutes; one JSON response means a
dropped connection loses all of it. Streaming means the caller has already
written the finished ones to storage, and only the rest need running again.
There is no job store and no resuming, because there is nothing to resume — the
work that survived is on the caller's disk and the work that did not is simply
still to do. Measured: a three-offer batch cut off after the first delivered
that first offer intact and logged `Batch cancelled after 1 of 3` at the instant
of the disconnect, rather than grinding on for the remaining two.

Emission is in completion order, not input order, which is why every item
carries its `index`. One input failing never stops the others: nineteen analysed
offers and one error is a good outcome.

`timeoutMs` bounds one input rather than the batch, and its clock starts when
that input starts — at a concurrency of one the twentieth input begins several
minutes in, and a timer started at the top would fail the tail of every long
batch for taking too long over work it had not begun. A batch has no overall
deadline: it runs until it is done or the caller leaves.

## Status

`extract_cv` and `analyze_offer` are declared pipelines that run against a local
model today; `ask_profile` demonstrates the tool loop. Extraction is verified
against the real cvitae CV: 7 of 7 jobs with 25 bullets, correct dates, correct
summary and spoken languages, on `gemma3:4b` in about 30 seconds.

Re-verified through `kind: 'upload'`, which is the path cvitae actually uses: the
same CV as a posted PDF gave 7 jobs and 25 bullets in 35.9s, and as a posted
`.txt` 7 jobs and 24 bullets in 39.7s, both with no degraded steps.

Extraction steps decode greedily — `temperature: 0`, set in `core/executor.ts`.
Nothing set one before, so the provider's default applied (0.8 on Ollama), which
is a sampling width for prose applied to steps that only copy values already in
the prompt. Five runs each of the same CV, before and after: bullets went from
`25,25,25,24,25` to `25,25,25,25,25`, and the run time stopped varying between
29.3s and 37.6s, settling at 29.7–30.0s.

Greedy decoding is not the same as correct, and it is worth being clear about
what it changed. The certificates step was returning `ICP Blockchain SDK` — a
line lifted from the skills list — beside the real certificate, on two runs in
five. At temperature 0 it did so on every run. That is an improvement only
because a reliable fault can be seen; the fix is `isCertificate`, the same
cross-check against extracted skills that spoken languages already use.

The language guard still has a hole, and there is now a deterministic
reproduction of it. `isSpokenLanguage` cross-checks against the *extracted
skills*, so a technology named only in prose escapes: a certificate described as
"Project using Rust, Vue and Typescript" puts `Vue — "Used in project"` into
spoken languages, because Vue is nowhere in the skills arrays to check against.
`NOT_SPOKEN` cannot list every framework — the original finding — and this is the
same hole from the other side. An allow-list of human languages would close both,
since they are a closed set and frameworks are not.

One thing that surprised: **the filename is part of the prompt.** Sources are
labelled into the corpus as `=== SOURCE: cv.pdf ===`, so the same bytes under a
different name are a different input. Measured — identical PDF, `cv.pdf` gives
`[English]` and `cv-textlayer.pdf` gives `[English, Vue]`, each reproducibly.
Worth knowing before reading two runs as a comparison of anything else.

Not built: the offers extractor. Its seam is `store.saveOffers`, and the shape to
copy is `extract_cv` — read sources into text, one narrow step per artefact, merge
rather than write.

The HTTP surface now carries everything cvitae sends: a per-request provider and
model, and a time budget. Until this, `/run/:name` dropped both on the floor —
`RunOptions` existed in the library and no route passed it — so delegating
research would have quietly ignored whichever model the user picked in Settings.

Nothing here is wired into cvitae yet. `src/libs/jobs/analyzeOffer.ts` there is
still the code that runs in production.
