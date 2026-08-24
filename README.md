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

## Translating the other CV language

`translate_cv` accepts the browser's document for one locale and returns the
selected sections in the other locale without persisting either document:

```ts
await runtime.run('translate_cv', {
  document: englishDocument,
  source_language: 'en',
  target_language: 'pl',
  sections: ['experience']
});
```

It preserves record order, list lengths, facts, numbers, links and technical
skill names. cvitae calls it one section at a time, then applies the result with
its source-aware gap merge so existing wording in the target language is never
overwritten or duplicated by a different valid translation.

## Drafting an application

```ts
await runtime.run('draft_application', {
  offerText,                       // or url, or an offer from analyze_offer
  offer: { position, company, required_skills, how_to_apply },
  candidate,                       // omitted, it reads cv.json
  language: 'pl',
  tone: 'formal',
  max_words: 170
});
```

Returns `subject`, `body`, `to_suggestion`, `warnings`, `used_highlights` and
`confirmation_required: true`. **It sends nothing**, and it cannot: it does not
import `mail/`, and the address it returns is a suggestion for a person to
confirm.

The pipeline is one model call and two transforms, which is the design rather
than an economy. Three of the four things a covering email needs are already
known — who the candidate is, what the position is called, and where
applications go — and only the prose connecting them is genuinely absent from
the input. That is the same line `findSummary` draws: **generate what is not
there, parse what is.**

So the recipient is a regex over the offer text, not a model output. The cost of
a hallucinated address is not a clumsy sentence, it is an application nobody
received, noticed weeks later or never. The subject is a template for the
opposite reason: an application subject is the most conventional string in
professional correspondence, and every part of it is already in hand, so a model
call would buy variation in the one place variation is a liability.

### The body is not an extraction, and that was measured

It was written first as an `extract` step returning `{ body: string }` — one
field, one schema, the same machinery as everything else. It failed on every
model:

```
gemma3:4b    generateObject   0/3   empty, empty, empty        0.5s
gemma3:4b    generateText     3/3   129, 129, 129 words        2.7s
gemma4:12b   generateObject   0/3   length, length, length    24.7s
gemma4:12b   generateText     0/3   empty, empty, empty       22.1s
```

Six prompt variants were tried against `gemma3:4b` first — instruction only,
rules only, no system prompt, a shorter field description, the instruction moved
into the user turn — and all six returned `{ }`. The wording was not the
variable. Asking a small model to wrap 130 words of prose in a JSON string is:
it has to hold the letter *and* the escaping, and it drops one of them.
`gemma4:12b` drops the other, running to the token ceiling without ever closing
the object — the same empty-completion pathology this README already records for
that model elsewhere.

That produced a third step kind. `generate` is one `generateText` call, no
schema, and the rule it leaves behind is worth stating plainly: **`extract` is
for values carved out of text, `generate` is for text.** A schema earns its
place when the output has parts.

Verified end to end on `gemma3:4b` against an isolated store: 148 words in 6.0s
in English, 139 words in 4.6s in Polish, no degraded steps and no warnings, with
the correct figures carried through from the CV bullets. Three consecutive runs
returned the same 148 words, which is `temperature: 0` doing what it does for
extraction. `gemma4:12b` fails the step outright and says so — it names the
model rather than the schema, because the schema is not the variable.

Two guards run after the model, both deterministic. Bracketed placeholders are
the most common defect in small-model letter writing; the ones whose value is
already known (`[Your Name]`, `[Company Name]`) are substituted, and the rest are
reported rather than deleted — an empty gap reads as a typo, `[Requisition ID]`
reads as what it is. And a body that opens by addressing the operator rather
than the reader is flagged, which is `findSummary`'s failure in its other form.

### Sending it

The path ends at a draft. cvitae generates the email with its own
`/api/jobs/apply-email`, renders the tailored CV through `generateAtsPdf` — the
react-pdf export with a real text layer, not the html2canvas raster — and posts
both to `POST /mail/draft` here. What lands is a Gmail draft with the CV
attached, waiting for a person to read it and press Send.

That last click is the review step, and it is the reason there is no send route:
the body was written by a small model reading text a stranger posted to a job
board, and the difference between a bad draft and a bad send is who else sees it.

`mail/` is a client for [cvitae-mail](../cvitae-mail), a sibling service that
holds the Gmail credential so this process does not. It runs as its own process
for the same reason cvitae-scrapper does, with a sharper motive: an API key can
be rotated after a leak and the cost is a bill, while a mailbox token is read
access to everything the user was ever sent plus the ability to write as them.

```ts
import { createDraft } from './mail/index.js';

const outcome = await createDraft({
  to: [confirmedByTheUser],
  subject: draft.subject,
  text: draft.body,
  attachments: [{ filename: 'cv.pdf', content_type: 'application/pdf', content_base64 }]
});
```

Absent by default in the same way: nothing listening, `MAIL_URL=` empty, or no
mailbox connected all answer without failing the caller.

**None of it is registered as a tool, and that is the design rather than an
omission.** `tools/index.ts` states the invariant — no tool fetches a URL the
model names, so a confused or injected model returns something unhelpful rather
than exfiltrating the CV. A draft function is exactly the primitive that
excludes: arbitrary recipient, arbitrary body, and the body can be the CV. It is
not hypothetical, because this runtime puts scraped offer text — written by
whoever posted the offer — into model context. Drafting is called from a route
or a `transform`, with a recipient a human confirmed.

That is also why `analyze_offer`'s `how_to_apply` address belongs in cvitae's UI
as something the user clicks. A model that read the offer chose it.

## Two execution modes

Every capability declares which one it is, and the answer should be `pipeline`
more often than not.

**`pipeline`** — a declared sequence of narrow calls, run by the orchestrator
with pooling, one retry on malformed JSON, and per-step degradation. No tool
calling, so it works on models that cannot do it. This is where extraction
lives. A step is `extract` (schema'd, `generateObject`), `generate` (prose,
`generateText`) or `transform` (no model at all); the choice between the first
two is measured rather than stylistic — see the drafting section above.

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
  mail/              cvitae-mail client — drafting, deliberately not a tool
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
| `ai-logs/` | metadata-only daily AI communication logs | model calls are unaffected |

`cv.json` is a plain file because it is small, singular and edited: it diffs, it
can be corrected by hand when an extraction gets a date wrong, and backing it up
is copying one file. Writes go through a temp file and a rename, so a crash
mid-write leaves the old document rather than half of one.

The LanceDB side is derived by definition, which makes `reindex()` always a
legitimate repair and never a migration.

AI communication is recorded as one JSON object per line in daily UTC files.
Each event carries a run `traceId`, call ID, provider/model, operation, purpose,
latency, status, token usage, finish reason, and content hashes/lengths. Tool
loops also record offered/called tool names and hashed argument/result shapes.
Raw prompts, model responses, tool values, image bytes, exception messages and
embedding vectors are not written. Logging is best-effort: a filesystem failure
warns once and does not fail the model call. Daily files are not deleted or
rotated automatically.

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
| `AI_LOG_MODE`                                   | `metadata`                    | `metadata` or `off`; never stores content |
| `AI_LOG_DIR`                                    | `<CVITAE_HOME>/ai-logs`       | daily `ai-YYYY-MM-DD.jsonl` files         |
| `SCRAPER_URL`                                   | `http://127.0.0.1:8787`       | cvitae-scrapper; empty disables it        |
| `BRAVE_API_KEY`                                 | unset                         | the web tier of `verify_recipient`; keyless fallback without it |
| `WEB_SEARCH`                                    | `auto`                        | `auto`, `brave`, `duckduckgo`, `off`      |
| `WEB_SEARCH_COUNTRY`                            | `pl`                          | which market to search                    |
| `WEB_SEARCH_TIMEOUT_MS`                         | `10000`                       | one query; the page reads have their own 12s ceiling |
| `MAIL_URL`                                      | `http://127.0.0.1:8789`       | cvitae-mail; empty disables it            |
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
anything but this machine. The one exception is `RUNTIME_MODE=hosted`, which
serves a smaller thing on purpose; see [Hosting it](#hosting-it).

| Method | Path         | Does                                          |
| ------ | ------------ | --------------------------------------------- |
| GET    | `/health`    | capabilities and tools currently registered    |
| GET    | `/state`     | what is indexed — check this when search is empty |
| POST   | `/run/:name` | run a capability; body is the envelope below   |
| POST   | `/run-batch/:name` | run it over many inputs; streams SSE      |
| POST   | `/document`  | replace the CV document and reindex            |
| POST   | `/reindex`   | rebuild the chunk index from `cv.json`         |
| GET    | `/mail/status` | is a mailbox connected, and to which address |
| POST   | `/mail/draft`  | put a message in the user's Drafts folder    |

There is no `POST /mail/send`, and its absence is the policy rather than an
omission — see the note in `server/index.ts`. cvitae-mail can send, behind its
own `MAIL_ALLOW_SEND` flag; nothing here routes it. Two switches, so neither can
be flipped by accident.

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

`model` may carry a credential, and normally does not. The server's own key
stays in this process's environment, which is most of the point of moving it out
of cvitae. `model.apiKey` covers the case that arrangement missed: a user who
has a key of their own and enters it in cvitae's Settings. When present it is
spent for that one call and kept nowhere — the model cache is keyed by provider,
model and base URL, so a caller's key deliberately bypasses it rather than being
stored where the next caller would find it.

Sending a key here is safe in the deployment this service is built for and only
that one: the listener is loopback with no authentication, so a caller that can
post to it can already spend the server's key, and supplying its own asks for
less. Over anything but loopback or TLS it would be a secret in cleartext, which
is why cvitae decides whether to send it from the URL it is about to post to and
refuses rather than leaking. Point `RUNTIME_URL` at a remote runtime over plain
HTTP and the key is not sent — and cvitae refuses the request rather than letting
it be answered on the server's credential.

The provider name is checked against the enum and `baseURL` goes through the
loopback guard, as before.

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

## Hosting it

There are two deployments, and they are not the same service.

The one everything above describes runs on your own machine. It holds the API
keys and the CV, it binds to loopback, and those two facts are one decision: a
caller that can reach the socket can already read `cv.json` and spend the
server's credential, so nothing a request asks for is a new grant.

The second is `RUNTIME_MODE=hosted` — a public deployment that holds no
credential and stores nothing. It exists so cvitae works for someone who is not
willing to run a second process, and it is defensible for exactly one reason:
**it cannot spend money.** Every run must carry its own `model.apiKey`, and a
run without one is refused rather than answered on the operator's. Whoever finds
the URL gets the compute, not the wallet.

`src/server/policy.ts` is where that is enforced, and is the file to read before
changing any of it. The refusals are all boundary checks, placed so that the
fallbacks underneath them are never reached rather than trusted to be harmless:

| Refused in hosted mode | Because |
| --- | --- |
| a run with no `model.apiKey` | `credentialFor` would read the environment |
| a key with no `model.providerId` | `resolveModel` would fall back to a default, and post an OpenRouter key to OpenAI |
| `providerId: "local"` | the server's `localhost` is not the user's, and the error would name a machine they have never heard of |
| `kind: "file"` sources | the path reaches `readFile`, and the text comes back to the caller |
| `ask_profile`, `draft_application` | they read the chunk index, which does not exist here |
| `/state`, `/document`, `/reindex`, `/mail/*` | same, plus a Gmail token that belongs to one person |
| a body over ~5.5MB | Netlify buffers 6MB and refuses the rest with an empty 502 |
| a batch over 8 inputs | the platform stops a function at 60s |

Nothing about the local deployment changes. `RUNTIME_MODE` defaults to `local`,
and the test suite asserts that every one of those requests still succeeds there.

### Deploying to Netlify

`netlify.toml` is committed and sets `RUNTIME_MODE=hosted` at build time, so a
deploy of this repository is hosted-mode by construction rather than one
forgotten setting away from serving the local surface to the internet.

```bash
pnpm dlx netlify-cli deploy --build --prod
```

Three functions are mapped — `/health`, `/run/:name` and `/run-batch/:name` —
and they are three lines each. Everything they do is in `src/server/netlify.ts`,
which is compiled and typechecked with the rest of the project; the files under
`netlify/functions/` exist only to give it a path.

Then point cvitae at it and nothing else has to change:

```bash
RUNTIME_URL=https://your-site.netlify.app
```

cvitae's client already decides whether it may forward the user's key by looking
at the URL it is about to post to — loopback or TLS, and it refuses rather than
leaking. An `https://` Netlify address qualifies, so a key entered in Settings
starts reaching the runtime the moment the variable is set.

**Set no provider key in Netlify's environment.** Nothing could spend one — a
request that omits its own key is refused before `credentialFor` runs — but a
credential sitting in a public deployment is one relaxed check away from being
spent, and the process says so at startup if it finds one.

### What it costs

- **60 seconds per request**, which is the platform's ceiling and not ours.
  cvitae already budgets for it and sends the remainder as `timeoutMs`. This is
  also why `local` is refused rather than merely broken: an offer measured at
  143s on gemma4:12b was never going to fit.
- **About 4MB per import**, from Netlify's 6MB buffered request limit and the
  third that base64 adds. The local runtime takes 12MB per file.
- **No retrieval, no stored offers, no mailbox.** The browser is authoritative
  for the CV — cvitae keeps it in IndexedDB and the runtime's `cv.json` was
  always a copy — so there is nothing here to preserve. The features that need
  the index need the local runtime.
- **The web tier is off by default.** Without a Brave key `verify_recipient`
  falls back to reading DuckDuckGo's HTML endpoint, which from a datacentre
  address is answered with a challenge more often than with results.
  `WEB_SEARCH=off` reports "the search did not run" honestly rather than
  pretending the web held nothing; set `BRAVE_API_KEY` and remove the line to
  turn the tier back on.
- **The scraper is absent**, so the boards that render client-side cannot be
  read at all. That is the largest functional gap between the two deployments,
  and the remedy is a scraper of your own on a public host in `SCRAPER_URL`.
- **Function minutes are still spendable** by anyone who finds the URL. Set
  `RUNTIME_TOKEN` and the caller must present it; it is off by default because
  the money is already safe without it.

There is no CORS handling, deliberately. cvitae's Next.js routes call this
server-to-server, so no browser ever issues a preflight against it, and adding
permissive headers would invite the one topology that puts the user's key on the
public internet with no server in between.

## Status

`extract_cv`, `analyze_offer` and `draft_application` are declared pipelines
that run against a local model today; `ask_profile` demonstrates the tool loop.
Extraction is verified against the real cvitae CV: 7 of 7 jobs with 25 bullets,
correct dates, correct summary and spoken languages, on `gemma3:4b` in about 30
seconds.

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

## Checking where an application goes

```ts
await runtime.run('verify_recipient', {
  offerText, company: 'Acme', company_url, position, current: whatIsInTheField
});
```

Returns ranked `candidates`, `apply_routes` for when there is no address at all,
a `current` check on the address already entered, the `company_domains` it
compared against, and `suggestion_only: true`.

The address in a posting is whatever the posting says, and listings that exist
to collect CVs are a common fraud — a CV is a complete identity package. So this
gathers what other sources say, in the order they are hard to forge: the
employer's own site (reached by following a link from the domain the board
itself published in its schema.org markup), then the posting, then the same role
on other boards, then the open web — a search engine asked where this employer
publishes jobs, followed by reading the pages it points at.

**Not one model call, and that is the security property rather than a
preference.** The pages being read are written by strangers and the output lands
in a `To:` field beside the user's CV, so nothing on them is allowed to decide
anything — they are scanned for `@` by a regex with no opinions and weighed on
facts a page cannot assert about itself: is the address on the employer's own
domain, was it on the employer's own site, did two independent sources name it.
An instruction injected into a careers page has nothing here to instruct. It is
also free, fast and reproducible, which is a pleasant way for the safe choice to
turn out.

It suggests and never chooses. Ranking is an order with the evidence attached;
`checkRecipient` warns and never blocks, because a recruitment agency mailing
from its own domain is legitimate and a check that refused it would be switched
off within a week.

### The employer's domain is the whole anchor

Every conclusion this capability draws is "is this address on the employer's
domain", so where that domain comes from decides what the answer is worth.
Measured across the three boards: **only JustJoin publishes
`hiringOrganization.url`.** nofluffjobs and pracuj give the company's name and
nothing else, so two thirds of the time the anchor has to be recovered.

Recovering it is guess-and-check — try `<name>.com`, `.pl`, `.io`, `.eu`, keep a
site whose own text carries the name. That is not enough on its own, and there
is a measurement behind that sentence rather than a worry:

```
"Devapo"                      → devapo.com   a German firm
"Devapo" + hint "Warszawa"    → devapo.io    the employer JustJoin advertised
```

Both pages contain "devapo", so a name check passes on both and picks the wrong
one — and picking wrong is expensive, because the wrong domain then becomes the
yardstick every address is measured against. What separates them is that
`devapo.io` says Warszawa and Poland while `devapo.com` says Germany, Austria
and the Netherlands. So the city from the posting is passed as a hint, and a
match on the name alone is returned *marked* rather than trusted.

That marking is `anchor_trust`, and it caps everything downstream:

| Anchor | How | Ceiling |
| --- | --- | --- |
| `board` | `hiringOrganization.url` from the posting's structured data | `high` |
| `discovered` | guessed from the name, corroborated by the city | `medium` |
| `guessed` | matched the name and nothing else | `low` |

A conclusion is never stronger than the domain it was reached through. A "strong
match" badge on a domain that may belong to a different company with the same
name is worse than no badge at all.

### The open web, when the board named a company and nothing else

`check_web` is **on by default** and costs no model call. It is the difference
between answering the question and reporting that one source was checked:

```
before   posting read → domain guessed from the name → guess fails
         → "Nothing else names an address for this employer. Checked 1 source"

after    posting read → engine asked where this employer hires
         → domain from the results, checked the same way a guess is
         → careers and contact pages read → addresses, or links to apply
```

Two queries go out together — one for the employer and their careers page, one
for the page that carries a contact address, because on most sites those are
different pages and a single query returns one of them and not the other. A
third, `site:<domain>`, runs only when the employer's domain is known and
nothing on it printed an address; that is the most common reason a real address
goes unfound.

**A result is a pointer, never an answer.** A title and a snippet are written by
whoever wrote the page and ordered by an engine with its own incentives, so
nothing from the engine can name a recipient. A snippet containing an `@` moves
its page to the front of the fetch queue and contributes nothing else — the
address still has to be found on a page that was actually read, by the same
regex that reads the posting.

What ranks above the employer is filtered rather than trusted:

| Host | Domain candidate | Opened | Shown as a way to apply |
| --- | --- | --- | --- |
| the employer's own site | yes | yes | careers and contact pages |
| an ATS (`jobs.lever.co`, `…recruitee.com`) | **no** — it belongs to the ATS | yes | yes |
| a board (`justjoin`, `linkedin`) | no | no — another tier sweeps those | no |
| a directory or aggregator (`aleo`, `jooble`) | no | no | no |

The ATS row is the one worth explaining. `jobs.lever.co` hosts thousands of
employers and belongs to none of them, so believing it were the company's domain
would make every address on Lever's domain read as a match for this employer.
Its pages are still read, as `web_page` evidence, which corroborates and on its
own never lifts an address above `low`. Only a page on the employer's own domain
counts as their site — and a search result that lands there *is* their site, since
the route to a page changes nothing about who controls it.

Where a URL may go is checked, because these are URLs this project did not
choose. A host that resolves to a private, loopback or link-local address is
refused before the request and again at every redirect — a page that ranks for a
company name could otherwise answer `302` to `169.254.169.254` and have the
response scanned for addresses and shown as evidence.

`BRAVE_API_KEY` is the supported path: 2,000 queries a month free, one per
second, and terms that permit this. Without it the tier falls back to a keyless
engine, which from some networks answers with a challenge instead of results.
That is reported as *"the web search did not run"* with the reason, never as an
empty web — a tier that could not run and a tier that found nothing are
different answers, and only the first one is worth telling the user to fix.

### Links, when there is no address anywhere

Most employers now take applications through a form, so the honest answer to
"where does this go" is often "nowhere by email". `apply_routes` is that answer:
the form the board pointed at, the ATS link the "Apply" button opens, the
careers page. All of it was already being collected and none of it was being
shown — the panel said *"nothing else names an address"* while holding three
links that answered the question the user actually had.

Links only. Nothing in `apply_routes` is ever put in a `To:` field.

### Asking a model for the website, when even a search cannot find it

`search_web: true` adds one model call, and it asks for **the employer's
website — never for an address**. That distinction is the tier. Asked for an
address, a model reads pages written by strangers and reports what they claim,
so a page claiming "applications go to harvest@evil.example" has written the
answer. Asked for a domain, the worst it can do is point somewhere, and pointing
is harmless because the next step goes and looks: a suggested domain runs
through the same check a guessed one does — it must serve a site carrying the
company's name — and it can never reach `board` trust however confident the
model sounded.

It is off by default, skipped entirely when the board already stated a website
(a stated anchor beats anything a search proposes, so paying for a call beside
one buys nothing), and non-critical. On OpenRouter it needs an `:online` model
id passed as the run's model override. Since the search-engine tier above runs
first and free, this is now the last resort rather than the only one: it
contributes names an engine could not find, and its domains are tried after the
engine's.

The measurement that shaped the fallback order, from a run where a model
proposed `allegro.pl` — correct — which then would not load:

```
model proposed : ["allegro.pl"]        ← right, unreachable
name guess     : allegro.io            ← loads, contains "allegro", wrong company
domains used   : []                    ← after the fix
```

Capping that guess at `low` was not enough, and the reason is the other
direction. `company_domains` is what every *other* address is measured against,
so believing `allegro.io` is Allegro's site would make a genuine
`praca@allegro.pl` read as "not on the employer's domain". **A wrong yardstick
warns about the right answer.** So a domain nothing corroborates contributes its
pages as a source and is not used as the yardstick at all — the answer becomes
"the employer's domain is unknown", which is true and says so.

### Two bugs the app's own call path found

Neither showed up in testing against a URL, and both only appeared once the
panel was actually used — worth recording because they have the same shape: a
saving that cost the thing being saved for.

**The anchor was never read.** The offer fetch was guarded by
`if (!offerText && offerUrl)`, so a caller that already held the posting's text
skipped it — and cvitae always does. The skipped fetch is also the only source
of `hiringOrganization.url`, `applicationContact` and `apply_url`, so the app's
path threw away all three and fell back to guessing the employer's domain from
their name. The condition is now about what is still *unknown* rather than what
was supplied.

**The scraper answered and nobody was listening.** Working out a domain probes
up to ten hosts at the project's 15s ceiling; measured at 31s, against a 30s
client timeout sized for one offer fetch. An identical `curl` returned 200 while
the capability's own request never completed. Probing now uses a 6s per-host
timeout — a homepage that has not answered in six seconds is not a candidate
worth waiting for when nine others are in flight — and reading a company site
gets its own 60s budget rather than borrowing the one-page one.

The exception is `applicationContact` — schema.org's field for the address
applications go to. That is the board stating the answer rather than a regex
finding an `@` in prose, so it ranks `high` whatever the anchor is worth. It is
rare in the wild and it was being dropped on the floor, along with `apply_url`,
which is the right answer for an employer who takes no email at all.

Two further findings worth keeping. A board naming `allegro.tech` made `kontakt@allegro.pl`
read as a mismatch, so any domain the employer's own site prints now counts as
theirs — companies hold a national domain, an international one and an
engineering-brand one, and warning about two of the three trains the user to
ignore the warning that matters. And `justjoin` listing rows carry no company
field at all — 188 rows, none of them — so matching is on the URL slug and the
title, which is how those boards build both; an earlier version filtered on
`row.company` and would have matched nothing while looking like it worked.

`draft_application` is verified end to end on `gemma3:4b` against an isolated
store — 148 words in 6.0s, no degraded steps, no warnings, and the same output
on three consecutive runs. Its deterministic half has 22 tests in
`scripts/draftApplication.test.ts`, covering recipient parsing, placeholder
filling, the draft review and the shape of the plan. What is *not* covered is
the body itself: there is no assertion that a generated letter is any good, and
there cannot usefully be one at this level. Read a few.

`pnpm smoke` was red before this work and is green after, but not because of it:
`capabilities are listed` asserted `length === 3` and `translate_cv` had already
made it four, so the check had gone stale silently and failed with a message
that named nothing. It now compares the set of names.

Nothing here is wired into cvitae yet. `src/libs/jobs/analyzeOffer.ts` there is
still the code that runs in production.
