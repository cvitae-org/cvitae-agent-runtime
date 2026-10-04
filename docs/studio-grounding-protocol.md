# Studio integration: grounding record

A chat run that belongs to a conversation writes down what reached the model
while it works. Studio reads that record back to show what an answer was based
on. This is step 1 of the grounding plan. It only records. Prompts, payloads and
answers are the same as before, and nothing in a request has to change.

Related: `studio-context-protocol.md` for CV contexts, conversations and runs.

## Startup and compatibility

Call `protocol.get` with `{}` and look for the feature `grounding-record`. A
runtime without it answers `runs.grounding` with `unknown_channel`. Hide the
"based on" list in that case. Do not guess a record from the transcript.

## runs.grounding

`runs.grounding {runId}` returns `{record}` for one run.

- It can be called at any time. While the run is going the record is `open` and
  holds what has been recorded so far. Read it again after `run.await`.
- `not_found` has two causes, told apart by the message. "No such run" means
  the id is wrong. "Run X has no record of what it was given" means the run
  exists and has none: it has no conversation (discovery, board and enrichment
  runs), or it started before records existed.
- A payload without `runId`, or with any other field, is `invalid_input`.

## The record

```json
{
  "v": 1,
  "runId": "run-1",
  "conversationId": "chat-1",
  "state": "closed",
  "outcome": "succeeded",
  "openedAt": 1790000000000,
  "closedAt": 1790000004000,
  "entries": [
    {
      "ref": "conversation:chat-1/history",
      "digest": "3f2a9c01d47be85a",
      "status": "included",
      "origin": "client",
      "via": "input"
    },
    {
      "ref": "cv:9d5e0c1a-5b0e-4d56-9a3a-3f0f6f2f7c11/experience/Acme~Engineer",
      "version": "7",
      "digest": "b81c5e20a9d3f604",
      "status": "included",
      "origin": "server",
      "via": "tool:read_cv"
    }
  ]
}
```

The example values are made up. The shape is the contract.

- `v` is the record version. It is 1.
- `state` is one of `open`, `suspended`, `closed`, `interrupted`.
  - `open`: the run is working, or the process died and the run has not been
    recovered yet. On start the runtime settles such a run as
    `process_interrupted` and its record becomes `interrupted`. Until then treat
    an `open` record as possibly incomplete.
  - `suspended`: the run is waiting for an approval. The record continues when
    the run is resumed with `run.resume`.
  - `closed`: the run ended. `outcome` is present exactly now and is one of
    `succeeded`, `failed`, `cancelled`.
  - `interrupted`: the process died mid-run and was found gone later.
    `closedAt` is when it was found, which is later than when it died. Entries
    recorded before that stand and the record may lack what came after.
- `openedAt` and `closedAt` are milliseconds since the epoch.
- `entries` are in the order each was first recorded. An entry equal to one
  already there is not added again.

## Entries

An entry names a piece and says what happened to it. It never holds the text.

- `ref` is the address of the original: `well:scope/section/item`. The well is
  `cv`, `offers`, `preferences` or `conversation`. The scope is the CV context
  id, the offer id or the conversation id. A ref has at most two path segments
  and is at most 1024 characters. Anything outside `A-Za-z0-9._~-` is
  percent-encoded per UTF-8 byte, so decode a segment before showing it.
  The ref carries no version and no digest. They are separate fields.
- `version` is the revision of the document when the piece was read, when the
  well has one. For `cv` it is the document revision.
- `digest` identifies the original at that version: the first 16 hex characters
  of sha256 over its canonical JSON. Do not recompute it with another hash.
- `shown` is present only when what the model received is not the whole
  original, for example a posting that was cut to fit. It is the digest of the
  part that was sent. Show such an entry as "partly shown".
- `status` is `included` or `read`.
  - `included`: the piece was in a model call or in a result handed to the
    model. The record says exactly which.
  - `read`: the run read it through a port. Whether and in what form it reached
    the model is not known. Reads are recorded on top of `included` entries on
    purpose. Do not list them as "based on".
  - A status you do not know means the piece did not reach the model.
- `origin` is `server` or `client`. `client` is whatever the app sent in the
  request. The runtime did not read it from a well and does not vouch for it.
- `via` is the channel it arrived by: `input`, `tool:read_cv`,
  `tool:search_profile`, `port:documents`, `port:retrieval`.

## What is recorded

Only `ask_profile` is recorded in this step, live and on an offer snapshot.

- Sent in the request (`via: input`, `status: included`): the history
  (`conversation:<id>/history`), the summary (`conversation:<id>/summary`),
  both with origin `client`. A posting that comes with the request is
  `conversation:<id>/attached`, origin `client`. In an offer snapshot run the
  posting is the saved one, `offers:<offerId>/posting`, origin `server`.
- `read_cv`: the sections and items it returned, as `cv` entries with
  `via: tool:read_cv`.
- `search_profile`: one entry per passage it handed over, with
  `via: tool:search_profile`.
- Reads through the document and retrieval ports: `status: read`.

If a tool cannot say what it handed over, the run fails rather than go on
unrecorded.

## What is not recorded yet

- The call that picks the tools for `ask_profile` sees the last two user turns
  and the question. It never carries the CV or a posting, and a test says so,
  but it is not in the record.
- The user's question itself, and the photograph.
- Discovery chat, board and enrichment runs. They have no conversation, so they
  have no record.
- History and summary the app sends are listed with origin `client` and are
  outside the guarantee until the runtime keeps them itself.

## Things to know

- CV item keys come from what an entry says (`company~title`). Renaming an
  entry changes its ref. A record also carries the revision it read, so an old
  record stays readable. Do not use a ref as a long-lived name for an item yet.
- A runtime built without the grounding wiring still opens and closes an empty
  record for each conversation run. An empty `closed` record there means
  nothing was recorded, not that nothing was sent.
- A piece can be listed for a tool call that was cancelled before its result
  went out. The record errs on the side of listing too much.
- A write that arrives after the record has closed is dropped, and the closed
  record does not change.
- A run that sends the same piece twice lists it once.

## Suggested "based on" list

1. Fetch the record after `run.await`, and again after `run.resume`.
2. List the `included` entries, grouped by well, with `origin: client` marked
   "sent by the app" and entries with `shown` marked "partly shown".
3. Keep `read` entries out of the list. Offer them behind a details toggle.
4. For `open`, `suspended` and `interrupted` records say the list may be
   incomplete.
5. For `not_found` with "has no record", show nothing.
