# Studio integration: grounding record and selection

A chat run that belongs to a conversation writes down what reached the model
while it works. Studio reads that record back to show what an answer was based
on. That is the first half of this file, the record. The second half is the
selection: what a person leaves out of a conversation, and what the runtime then
keeps from the model, history included. Prompts and answers are worded as before. With nothing
excluded a payload is the same as before, and nothing in a request has to change.

Related: `studio-context-protocol.md` for CV contexts, conversations and runs.

## Startup and compatibility

Call `protocol.get` with `{}` and look for the feature `grounding-record`. A
runtime without it answers `runs.grounding` with `unknown_channel`. Hide the
"based on" list in that case. Do not guess a record from the transcript.

The feature `grounding-selection` says the selection channels below are there.
A runtime without it answers `selection.get` and `selection.update` with
`unknown_channel`. Hide the exclude toggles in that case: a toggle the runtime
cannot honour is worse than none.

The feature `grounding-history` says the runtime keeps the conversation itself
and holds back an earlier answer that an exclusion reaches (see "The
conversation the runtime keeps"). Without it, keep sending `history` and
`summary` as before, and know that they stay outside the guarantee. With it,
stop sending them.

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
  both with origin `client`. When the runtime kept the conversation itself, the
  entries are the runtime's instead (see "The conversation the runtime keeps").
  A posting that comes with the request is
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
  outside the guarantee. The runtime keeps its own when the app sends none.

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

# Selection: leaving pieces out of a conversation

A person can exclude a piece of what a conversation may read. Excluded means
unreachable: the model gets it through nothing the conversation runs, and no
answer, summary or retrieval result carries its text. The runtime does this at
the ports a run reads through, so no tool has to remember to.

## selection.get

`selection.get {conversationId}` returns the selection of one conversation:

```json
{
  "revision": 3,
  "exclusions": [
    { "ref": "cv:9d5e0c1a-5b0e-4d56-9a3a-3f0f6f2f7c11/experience/acme~senior-engineer", "state": "live" },
    { "ref": "cv:9d5e0c1a-5b0e-4d56-9a3a-3f0f6f2f7c11/overview/personal", "state": "gone" }
  ]
}
```

- A conversation nobody has excluded anything from answers `revision: 0` and no
  exclusions. `not_found` means there is no such conversation.
- `exclusions` are in the order they were added.
- `state` is `live` when the piece is in the document now and `gone` when
  nothing carries that address any more. A `gone` exclusion still holds: it
  excludes whatever is given that address later. Show it, and say it no longer
  covers anything. The usual cause is a renamed entry: an item's key comes from
  what it says (`company~title`), so a renamed item is a new item and is no
  longer excluded. The runtime does not follow the rename. Warn the person
  instead, and let them clear the old exclusion and exclude the new item.
- The selection is not a field of `conversations.get`. Read it when a
  conversation is opened and after every change.

## selection.update

`selection.update {conversationId, expectedRevision, exclude, clear}` changes it.
`exclude` and `clear` are lists of at most 50 refs each, both optional, and
anything else in the payload is `invalid_input`.

- `expectedRevision` is the revision the caller last read. It is how two
  windows avoid overwriting each other. Selections carry no version of the
  document: a ref names a piece, not a revision of it, so leave off `@version`
  and `#digest`.
- On success the answer is the new selection, as `selection.get` returns it.
  The revision goes up by one when something changed. A change that changes
  nothing (excluding what is excluded, clearing what is not) is accepted and
  leaves the revision alone.
- `exclude` is applied after `clear`. A ref in both ends up excluded.
- When `expectedRevision` is not the current revision nothing is written and the
  answer is `selection_conflict` with the current `revision` and `exclusions` in
  its details. Reload from them and offer the change again.
- A conversation excludes at most 100 refs. More is `selection_limit`.
- An exclusion is kept until it is cleared, across restarts. It binds every run
  of the conversation that starts afterwards, a run that is suspended for an
  approval and resumed later, and the reads a run still has to make after it was
  excluded mid-run.

### What a conversation may exclude

The runtime accepts only what something stands behind. Anything else is
`invalid_selection`, with a message to show. Clearing is not held to this: what
was allowed once can always be removed.

- A conversation about a CV (`cv:<context id>/...`), the pieces of its own CV
  only: the whole CV (`cv:<id>`), a section (`experience`, `education`,
  `certificates`, `languages`, `overview`), an overview item
  (`overview/personal`, `overview/role_description`, `overview/skills`) or one
  entry of a list section (`experience/acme~senior-engineer`).
- A discovery conversation, whole saved offers: `offers:<offer id>`.
- A conversation about one offer excludes nothing yet.
- The preferences well is Studio's, and the runtime reads none of it.

Other codes: `invalid_ref` for a ref that does not parse, `unknown_well` for a
well that does not exist, `not_found` for a conversation that does not exist.

## What the runtime keeps from the model

For a conversation about a CV, every run of it reads the CV through walls:

- `read_cv` returns the CV without the excluded pieces. An excluded list entry is
  removed from its section. An excluded overview item (name and contact details,
  the role description, the skills) is left out of the answer, and not blanked,
  so the model is not told the CV has no name.
- `search_profile` returns no passage from an excluded piece. A passage that
  cannot be placed in the stored CV (its entry was edited since it was indexed,
  or it belongs to no piece) is dropped as well while anything of the CV is
  excluded: whether it came from an excluded piece is then not known, and not
  knowing is not a reason to hand it over. With nothing of the CV excluded, an
  exclusion that names nothing the CV holds (a `gone` one) changes no payload.
- The record names pieces by the key they have in the stored CV, so an entry in
  `runs.grounding` never names the wrong item because an earlier one was cut.
  An excluded piece is never in a record: it did not reach the model.
- `edit_cv` works on what is left and puts the excluded pieces back. The
  proposal a person is asked to approve keeps every excluded piece as it was
  stored, so approving never deletes one. An edit aimed at something excluded
  entirely (the overview item, a list section with nothing left, the whole CV)
  is refused as `target_excluded` before any model call.
- `translate_cv` the same way: excluded pieces are left untranslated and
  returned as stored.
- A CV whose stored body cannot be read as a CV, while the conversation excludes
  something of it, fails the run with `walled_unreadable`: what is left cannot
  be told from what is not, and the runtime does not guess.

What a wall never does: block the document an edit is written against. It
decides what a model may be shown. The stored CV is the stored one.

Things the walls do not cover yet:

- Runs of a conversation about one offer, which read a captured snapshot.
- History and summary the app sends in the request. They stay outside the
  guarantee, listed with origin `client` in the record. Send none and the
  runtime keeps them (next section).
- Discovery conversations: exclusions of saved offers are stored and returned,
  but the discovery chat does not honour them yet.

## The conversation the runtime keeps

An answer written before a piece was excluded may still carry it. If the app
hands that answer back as history, the excluded piece is in front of the model
again. So when the app sends no history and no summary with a message, the
runtime reads the conversation it stores (the messages appended with
`conversations.append`, and the note stored with `conversations.summarise`) and
gives the model the part that no exclusion reaches.

It applies to `ask_profile`. An input with a non-empty `history` or a non-blank
`summary` is used as sent, as before, with origin `client`. An explicit empty
`history` or blank `summary` counts as not sent.

- What the model is given: the settled exchanges after the summary, newest that
  fit, each an answer and the question it answered. The same limits as for a
  host (12 turns, 6,000 characters). The first exchange that does not fit ends
  it, so history never has a hole in the middle. The note stored with
  `conversations.summarise`, when it is not held back. An unanswered question
  and the run's own are not given.
- What is held back: an exchange whose answer was built from something the
  conversation excludes now, or on an earlier answer that was, however far back.
  Only what a run was given counts. What it merely read does not. The summary is
  held back while any answer it was made from is. It cannot be cut into parts,
  so the conversation goes without it until it is summarised again over answers
  that are not. Lifting the exclusion brings both back.
- An answer whose run cannot say what it was given (no record, a record that is
  not closed, a capability that keeps none, a run that no longer exists, an
  answer with no run) is held back as long as the conversation excludes anything
  at all. With nothing excluded, history is what the conversation holds.
- An answer is named by the run that wrote it (`run~<run id>`) or, with no run,
  by the message (`msg~<message id>`). Send `runId` with `conversations.append`
  for an answer a run wrote, so it can be traced.
- The record lists each exchange given as `conversation:<id>/history/<key>`,
  origin `server`, and the note as `conversation:<id>/summary`, origin `server`,
  with `version` the number of the last message it was made from. These are
  what the model was given, so they belong in the "based on" list.
- It is read when a run starts or resumes. An exclusion made while a step runs
  reaches what the tools return at once, and the history on the next run or the
  next resume.
- The stored run input is what the app sent. The history the runtime put in is
  not stored with it.

## Suggested exclude toggles

1. Check `grounding-selection` in `protocol.get`.
2. `selection.get` when a conversation is opened. Keep `revision`.
3. A toggle per section and per entry sends `selection.update` with
   `expectedRevision` set to the kept revision. Replace the kept selection with
   the answer.
4. On `selection_conflict` replace the kept selection with the details of the
   error and show the person what changed before they try again.
5. Show a `gone` exclusion as "no longer matches anything" next to a way to
   clear it.
6. An `edit_cv` proposal for a CV with exclusions keeps them. Show the proposal
   as the runtime sent it.
7. With `grounding-history`, append every message to the conversation (answers
   with their `runId`) and stop sending `history` and `summary`. Summarise with
   `conversations.summarise` as before. Say plainly that an earlier answer is
   left out of the conversation when an exclusion reaches it, and that it comes
   back when the exclusion is cleared.
