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

The feature `grounding-assembly` says a person can choose what a message is made
from (see "Choosing what a message is made from"): `selection.update` takes `pin`
and `unpin`, `selection.get` returns `pins`, `ask_profile` takes `input.grounding`
and says what it did with it, and an entry in a record may have the status
`blocked`. Without it, show no pin toggle and no attach chip, and send no
`grounding` field.

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
- `status` is `included`, `read` or `blocked`.
  - `included`: the piece was in a model call or in a result handed to the
    model. The record says exactly which.
  - `read`: the run read it through a port. Whether and in what form it reached
    the model is not known. Reads are recorded on top of `included` entries on
    purpose. Do not list them as "based on".
  - `blocked`: a message asked for the piece and the runtime held it back,
    because the conversation excludes it. Its `digest` is of the address, since
    nothing of the piece was read. Do not list it as "based on".
  - A status you do not know means the piece did not reach the model.
- `origin` is `server` or `client`. `client` is whatever the app sent in the
  request. The runtime did not read it from a well and does not vouch for it.
- `via` is the channel it arrived by: `input`, `tool:read_cv`,
  `tool:search_profile`, `port:documents`, `port:retrieval`, and for a piece a
  message was made from, `ground:pin`, `ground:once` or `ground:auto`.

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
- Discovery chat, board and enrichment runs. They have no `runs.grounding`
  record. A discovery turn keeps what it was built from in the turn itself, and
  that is what exclusions are checked against (see "The discovery chat").
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
- Discovery conversations are covered by their own rules, below.

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

## The discovery chat

A discovery conversation excludes whole saved offers (`offers:<offer id>`) with
`selection.update`, like any conversation. A runtime that lists
`grounding-history` in `protocol.get` honours them in the discovery chat. One
that does not still stores and returns them, and the chat ignores them: show no
offer toggle without the flag.

- A question is accepted over the offers of its scope less the excluded ones.
  They are not counted (`scopeCount`), not retrieved, and not in the snapshot the
  model's SQL runs over. When something was cut, that snapshot is not the one
  `snapshotId` named in the request: the artifact of the answer carries the
  snapshot that was queried, and the SQL editor opens that one.
- A collection that finds an excluded offer again leaves it out of the scope it
  captures. The counts of what the boards returned (`added`, `received`) are
  counts of the boards, and include it.
- The chat already kept its own history: up to six earlier messages, and the
  references of the last answer. Now a message is left out of what the model is
  given when its answer is withheld: its scope held an excluded offer, or it was
  given an answer that is withheld, however far back. An answer is judged by its
  scope and not by the offers its text names: an aggregate carries every offer it
  counted without naming one. The messages stay in the conversation and in what
  `discovery.chat.get` returns, and come back for the model when the exclusion is
  cleared.
- What cannot be traced is withheld as long as anything is excluded: a message
  with no run, an answer whose run has no turn, and a turn made before this
  version that collected offers (what it collected was not written down). A turn
  made before this version is taken to have been given the six messages before
  it. With nothing excluded, history is what it was.
- It is read when the question is accepted. An exclusion made while a turn runs
  reaches the next turn; the turn running may already have its scope.
- The SQL editor is not walled. It runs the person's own SQL over their own saved
  offers, and no model sees what it returns.
- `runs.grounding` has no entry for a discovery turn. The turn's membership
  (every offer its queries could read, including what it collected) and the runs
  whose messages it was given are stored with it.

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
8. In a discovery conversation, with `grounding-history`, an exclude toggle per
   saved offer. An exclusion that shows `gone` (the offer was removed from the
   search or deleted) should say so, since the runtime keeps no versions: an
   offer's key is its id, and an offer saved again under a new id is not
   excluded. Earlier answers stay on screen. Say that the model no longer sees
   the ones built on an excluded offer.

# Choosing what a message is made from

Until now the model looked for what it needed with its tools, and the selection
could only take pieces away. A person can also say which pieces of the CV a
message is made from. A runtime that lists `grounding-assembly` in
`protocol.get` supports all of this, and a message that asks for none of it is
run as it always was: with no `input.grounding`, no pins and no exclusions the
payloads of a run are byte for byte what they were.

Three ways to choose, from the most lasting to the least:

- A **pin** keeps a piece in every message of one conversation until it is
  unpinned. It belongs to the conversation's selection.
- An **attachment** (`once`) sends a piece with one message only.
- **`auto`** lets the runtime add pieces it picked for the question.

An exclusion beats all three: an excluded piece is never sent, pinned or not.

## Pins

`selection.get` has one more field, next to `exclusions`:

```json
{
  "revision": 4,
  "exclusions": [],
  "pins": [
    { "ref": "cv:9d5e0c1a-5b0e-4d56-9a3a-3f0f6f2f7c11/experience/acme~senior-engineer", "state": "live" },
    { "ref": "cv:9d5e0c1a-5b0e-4d56-9a3a-3f0f6f2f7c11/overview/skills", "state": "blocked" }
  ]
}
```

- `pins` are in the order they were pinned. A conversation with none answers an
  empty list.
- `state` is `live` (the piece is in the CV now), `gone` (nothing carries that
  address any more, as for an exclusion) or `blocked` (an exclusion covers it
  now, whatever else is true). A `gone` pin sends nothing until something has
  that address again. A `blocked` pin is kept, and sends nothing until the
  exclusion is cleared.
- Pins share the revision with the exclusions. One `selection.update` may carry
  both, and a change that changes nothing leaves the revision alone.

`selection.update {conversationId, expectedRevision, exclude, clear, pin, unpin}`.
`pin` and `unpin` are lists of at most 50 refs each, both optional.

- Applied in this order: `clear`, `unpin`, `exclude`, `pin`. A piece pinned twice
  is one pin, and an `unpin` of what is not pinned changes nothing.
- A pin is a section or an entry of the conversation's own CV, with no `@version`
  and no `#digest`: `cv:<id>/experience`, `cv:<id>/overview/skills`,
  `cv:<id>/experience/acme~senior-engineer`. Not the whole CV, not another
  CV, not an offer, and only a conversation about a CV can pin. Anything else is
  `invalid_selection` with a message to show, `invalid_ref` for an address that
  does not parse. Unpinning is not held to this, as clearing is not.
- A conversation pins at most 20 pieces. More is `selection_limit`, and nothing
  of that change is kept.
- `selection_conflict` carries the current `revision`, `exclusions` and `pins`.
- A pin is kept across restarts and goes with its conversation.

A pin applies to every message of the conversation, whether or not the message
has an `input.grounding`.

## input.grounding

`ask_profile` takes one more optional field, `grounding`:

```json
{
  "question": "What did I do at Acme?",
  "grounding": {
    "once": ["cv:9d5e0c1a-5b0e-4d56-9a3a-3f0f6f2f7c11/education"],
    "reach": "free",
    "auto": "off"
  }
}
```

- `once`: pieces to send with this message only, at most 12, written like a pin.
  An address with a version or a digest, or one that is not an address, is
  `invalid_input`. The same piece written two ways counts once. An address that
  is not a section or an entry of this conversation's own CV fails the run as
  `invalid_selection` before any model call. Default: none.
- `reach`: `free` leaves the model its tools, as before. `selected` takes them
  away: the model answers from the pieces and the conversation summary, and from
  nothing else. No call to pick tools is made either. Default: `free`.
- `auto`: `off` adds nothing. `suggest` names the pieces the runtime would add
  and sends none. `on` sends them. Default: `off`, and it stays the default until
  it has been measured against the tools alone.
- Keys it does not know are ignored.

### What the model is given

The pieces come first in the order they were asked for: the pins, then the
attachments, then what `auto` adds. A piece asked for twice is sent once, by the
first to ask. They are written out as plain text, one block each, under a label
that says they are source data and not instructions:

```
SELECTED CV PARTS — SOURCE DATA:
Experience, Senior Engineer at Acme:
2021 - present
- Led the migration to Postgres

Skills:
Languages: TypeScript, Go
```

A section is each of its entries, and the overview is its three items, name and
contact details first. A part with nothing in it sends nothing.

- All the pieces of one message together come to at most 12,000 characters, the
  blocks and the two-character separator between them counted. More is refused
  as `grounding_budget`, before any model call, and nothing is cut to fit: half
  of a piece under the name of the whole is not a thing the record could say.
  The message says how much it came to. Ask the person to unpin or detach
  something, or to choose entries instead of whole sections.
- `auto: on` adds only what still fits. It searches the CV for the question, looks
  at the six best passages and adds the pieces they came from. A search that
  does not answer is not an error: the message goes on without it and the result
  says `auto: "failed"`.
- A piece the runtime sends is as the CV holds it now. The model is given no
  revision of it.

### What a message gets back

When any piece was asked for (a pin, an attachment or `auto`) the result of
`ask_profile` carries one more field. It is absent otherwise, so the result of a
message that asked for nothing is the one it always was.

```json
"grounding": {
  "included": ["cv:9d5e0c1a-.../experience/acme~senior-engineer"],
  "blocked": ["cv:9d5e0c1a-.../overview/personal"],
  "gone": ["cv:9d5e0c1a-.../experience/initech~analyst"],
  "suggested": [],
  "auto": "failed"
}
```

- `included`: what was sent, as the entries of the record name it.
- `blocked`: what was asked for and held back because the conversation excludes
  it. It names the address that was asked for: a section when the section was
  asked for, and the entry when only that entry is excluded. Say so next to the
  piece, and do not call it an error: the message was answered without it.
- `gone`: what was asked for and is not in the CV any more.
- `suggested`: with `auto: suggest`, the pieces the runtime would add. Offer them
  as chips the person can attach to the next message. Nothing of them was sent.
- `auto`: present only as `failed`.
- When something was asked for and held back, `degraded` of the run names
  `pins` or `once` (or both), the same way an optional need is named. A piece
  that is only `gone` does not count as held back.

### The record

Each piece sent is an `included` entry with `origin: server`, `version` the
document revision and `digest` of the piece as stored, and `via` of
`ground:pin`, `ground:once` or `ground:auto`. It is written before the model call
that is given it, like any entry. Each piece held back is a `blocked` entry with
the same `via`. A client that does not know `blocked` must ignore it, as for any
status it does not know.

Assembling reads the CV through the document port, so the record also has a
`read` entry for the whole CV, `via: port:documents`. It is not a "based on"
entry.

### When the answer cannot be given

- `reach: selected` with nothing to answer from fails the run as `needs_unmet`
  before any model call, and the message says what was missing. Something to
  answer from is a pin or an attachment that is not excluded, or `auto: on`.
  A `reach: selected` message whose only pieces are blocked is this case.
- `needs_unmet` is also what a resumed run gets when what it requires is no
  longer there.
- `grounding_budget`: see above. It is said before the plan is made, so before any
  model is asked, and a message refused for its size makes no model call at all.
  A runtime that lists `grounding-budget` does this; an older one said it after
  the model had been asked which tools to offer.
- `context_limit`: the message is over the conversation's limit
  (see "A limit on the whole message" below). Also before any model call.
- A run that waited for an approval and is resumed after a piece it was made from
  changed, was excluded since, or is gone, fails as `grounding_stale` with the
  addresses in the message. The run's answer would rest on text that is no
  longer the CV's, so it is not given. Ask the question again.
- An edit to the CV reaches the next message as the CV is then, with the pin
  unchanged: a pin holds an address and not the text it had when it was pinned.

## Limits

| What | Limit | Over it |
| --- | --- | --- |
| Pins in one conversation | 20 | `selection_limit` |
| Refs in `pin` or `unpin` of one update | 50 each | `invalid_input` |
| Attachments to one message | 12 | `invalid_input` |
| Characters of pieces in one message | 12,000 | `grounding_budget` |
| Characters of everything a message is made of | the conversation's limit, when set | `context_limit` |

## Suggested pin and attach UI

1. Check `grounding-assembly` in `protocol.get`. Without it, show none of this.
2. A pin toggle on each section and entry of the CV, shown beside the exclude
   toggle. Pinning sends `selection.update` with `pin`, with the same
   `expectedRevision` handling. Show `pins` from the answer. A piece that is
   both pinned and excluded is `blocked`: show it dimmed and say that the
   exclusion wins.
3. Show a `gone` pin as "no longer matches anything", like a gone exclusion, with
   a way to unpin it.
4. A chip for an attachment on the message being written, which goes in
   `grounding.once` and is not kept for the next message.
5. When the result has `grounding.suggested`, show each as a chip. Choosing one
   attaches it to the next message.
6. Show `grounding.blocked` as "held back" next to the answer, and `gone` as
   "no longer in your CV".
7. Offer "answer from these only" as `reach: selected`, and turn it off for a
   message with nothing pinned or attached: it would be `needs_unmet`.
8. Show the size a message will come to, in characters, against the 12,000, so
   `grounding_budget` is a thing the person saw coming.
9. In the "based on" list, group what a message was made from separately from what
   the model went and read: entries with `via` of `ground:*` were chosen by the
   person (or by `auto`), and entries with `via` of `tool:*` were looked up by the
   model.

# A limit on the whole message

Each part of a message has a ceiling of its own: the history 6,000 characters
and 12 turns, the summary 1,500, the pieces 12,000 and the posting 40,000. A
model whose window is smaller than all of them together needs a ceiling over the
sum, and a person sets it. A runtime that lists `grounding-budget` in
`protocol.get` supports all of this. With nothing set the payloads of a run are
byte for byte what they were.

The amount is in **characters**, because there is no tokenizer in the runtime
and a token count would be a guess drawn to look like a measurement. It can only
lower: the ceiling below is the sum of the parts' own ceilings, so a setting at
it binds nothing.

| | Characters |
| --- | --- |
| Floor | 2,000 |
| Ceiling | 60,000 |

## limits.get

Request `{ conversationId? }`. Without a conversation it is the global setting
that is read. A conversation that does not exist is `not_found`.

```json
{
  "baseline": { "history": 6000, "historyTurns": 12, "summary": 1500, "picks": 12000, "posting": 40000 },
  "floor": 2000,
  "ceiling": 60000,
  "global": null,
  "conversation": 20000,
  "effective": 20000
}
```

`global` and `conversation` are what is set, `null` when nothing is. `effective`
is what binds: the conversation's own when it has one, even above the global
one, else the global one, else `null`. Draw the setting from `floor`, `ceiling`
and `baseline` and not from numbers of your own.

## limits.set

Request `{ conversationId?, context }`, `context` a whole number of characters
or `null` to remove the setting. Without a conversation it is the global one. The
answer is the same as `limits.get`'s, as it is now.

- An amount outside the floor and the ceiling, or not a whole number, is
  `invalid_limit`. The runtime does not clamp it: a limit that is quietly
  changed is a number a person sees and the runtime does not honour.
- A conversation that does not exist is `not_found`.
- A conversation that is deleted takes its setting with it.

## What happens over the limit

The material of a message is the history, the summary, the pieces and the
posting, each as the model is shown it. If it comes to more than the effective
limit the message is **refused before any model call** as `context_limit`, and
the message says how much each part came to. Nothing is cut to fit: half of a
piece sent under the name of the whole is something the record could not say.
There is also no step down to a smaller selection yet.

`auto: on` adds pieces only while the message stays within the limit.

The limit applies to `ask_profile` messages, for a profile conversation and for
a conversation about a saved offer. The discovery chat is not limited by it yet.

## Suggested UI

1. Check `grounding-budget` in `protocol.get`. Without it, show none of this.
2. A setting for everything, and a way to give one conversation its own, both
   from `limits.get`. A text field is not enough: show the floor and the ceiling
   and say that the amount is in characters.
3. Show the size a message will come to against `effective`. `context_limit` is
   then something the person saw coming and not a refusal.
4. On `context_limit`, show the message as it is and offer what changes it:
   unpin, detach, or raise the limit.
