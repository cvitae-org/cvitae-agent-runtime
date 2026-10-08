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

The feature `grounding-preview` says a message can be seen before it is sent and
sent as it was seen (see "Seeing a message before it is sent"): `run.preview`
exists, `run.context.start` and `run.offer.start` take `approved`, and
`runs.grounding` also answers `planDigest`. Without it, show no preview and send
no `approved` field.

The feature `grounding-offers` says a person can ask which of their saved offers
fit their CV best (see "Comparing saved offers with the CV"): `input.grounding`
takes `offerIds`, `preferences` and `cite`, the result of `ask_profile` may carry
`offers`, `cited` and `unresolved`, `run.preview` may answer `offers`, and a
conversation about a CV may exclude a whole saved offer. Without it, offer no
offer picker, and send none of those fields.

The feature `grounding-edits` says an edit can be aimed at one section by its ref
and says what it changed (see "Editing one section"): `edit_cv` takes
`input.target`, its result carries `target` and `changes`, a stored proposal
carries both in `profile.proposals.list`, and an accept writes those changes and
nothing else. Without it, send `section` as before and work out the difference
between the stored CV and a proposal yourself.

The feature `grounding-compaction` says a long conversation can be carried on (see
"Long conversations"): `input.grounding` takes `overflow` and `full`, the result of
`ask_profile` and `run.preview` may carry `compacted`, `conversations.compactPlan`
exists, and deleting a conversation also deletes the runs it made. Without it, send
neither field, refuse an over-long message as before, and fold nothing.

The feature `masking` says the runtime keeps a person's own contact details out of
what it sends to a model (see "Keeping a person's details from a model"):
`settings.get` and `settings.set` carry `maskMode`. Without it, show no masking
setting, and do not tell a person their details are kept from a hosted model.

The feature `masking-detectors` says the runtime also keeps from a model what has the
shape of an identifier, whoever's it is (see "Identifiers found by their shape"). It
adds no field and no setting. Without it, the runtime keeps only what the CV states, and
a person who pastes a referee's email into a question sends it.

The feature `masking-embedding` says the texts an embedding provider is given are kept
the same way (see "What an embedding provider is sent"). It adds no field and no setting.
Without it, a person who chose a hosted embedder is sending it the text of their CV, and
every question they search with, as it is.

The feature `masking-strict` says a person can also have the employers and the schools
their CV names kept from a model (see "The setting: `maskScope`"): `settings.get` and
`settings.set` carry `maskScope`. Without it, show no such choice, and do not tell a
person their employers are kept from a model.

The feature `masking-terms` says a person can name words and phrases of their own to
keep from a model (see "The person's own terms: `masking.terms`"): the runtime takes
`masking.terms.get` and `masking.terms.set`. It holds the list in memory only, so send
it **every time the runtime connects**, not only at launch, and whenever it changes,
an empty list included. Until it has been sent one, a background rebuild of the index
with a hosted embedder waits. Without the feature, show no such list.

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
- A conversation about a CV, whole saved offers too, as `offers:<offer id>`: an
  offer it leaves out is not compared (see "Comparing saved offers with the CV").
  Nothing finer: `offers:<id>/card` and `offers:<id>/posting` are
  `invalid_selection`, and so is anything else that is not a piece of the CV.
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
| Pieces named in `full` of one message | 12 | `invalid_input` |
| Characters of pieces in one message | 12,000 | `grounding_budget` |
| Offers named in one message | 100 | `invalid_input` |
| Offers compared in one message | 25 | the rest are cut and said, as `offers.left.cut` |
| Characters of preferences | 2,000 | `invalid_input` |
| Characters of a card | 500 | a card is made to fit, and is never refused |
| Characters of the offers, the preferences and the parts of the CV that match | 30,000 | the parts of the CV that do not fit are left out; the cards and the preferences are not cut |
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
posting, each as the model is shown it, and, for a message that compares offers,
the offers (see "Comparing saved offers with the CV"). If it comes to more than the effective
limit the message is **refused before any model call** as `context_limit`, and
the message says how much each part came to. Nothing is cut to fit: half of a
piece sent under the name of the whole is something the record could not say.
A message that asks for it (`grounding.overflow: "compact"`, see "Long
conversations") is first tried with some of its pieces in a shorter form that says
what it leaves out.

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

# Seeing a message before it is sent

A person who has pinned pieces, attached one and set a limit should be able to
see what the next message is made of before it goes, and to send exactly that.
A runtime that lists `grounding-preview` in `protocol.get` supports all of this.
Nothing a preview does is written down: it makes no run, no step, no event and no
record, and with nothing sent as `approved` a start is what it always was.

## run.preview

Request `{ mode, contextId, conversationId, capability, input, offerSnapshotId?,
contextRevision?, contextGeneration? }`: the fields of `run.context.start` (or
`run.offer.start`, with `offerSnapshotId`) without `runId`. A preview is of a
message in a conversation, so `conversationId` is required. It is `invalid_input`
for what a start refuses as `invalid_input`, `context_conflict` for a
conversation that is not this context's, and `unknown_capability`, all as a start
would be.

`mode` is `fast` or `full`. Neither asks the model that answers, and neither asks
it which tools to offer.

```json
{
  "mode": "full",
  "size": { "parts": { "history": 300, "summary": 50, "posting": 70, "picks": 83 }, "total": 503 },
  "limit": 20000,
  "degraded": [],
  "planDigest": "0f3a9c2d4e7b1a65",
  "entries": [ { "ref": "cv:ctx/experience/acme~senior-engineer", "status": "included", "...": "as in the record" } ],
  "grounding": { "included": ["cv:ctx/experience/acme~senior-engineer"], "blocked": [], "gone": [], "suggested": [] }
}
```

| | `fast` | `full` |
| --- | --- | --- |
| For | while the person types | when the person is about to send |
| Reads | the conversation, the CV, the selection and the limit | the same, and runs every step a run runs before it asks a model |
| `size`, `limit`, `degraded`, `refusal` | yes | yes |
| `entries`, `planDigest`, `grounding` | no | yes, unless refused |
| Searches for pieces (`auto`) | never | as a run does |

- `size.parts` is what the message is made of, in characters, as it is held to the
  limit (see "A limit on the whole message"): `history`, `summary`, `posting`
  and `picks`, and `offers` for a message that compares some (absent otherwise). A capability that is not measured answers `{}` and `0`; only
  `ask_profile` is. `limit` is the one that binds, or `null`.
- `degraded` names what a run would go without, as a run's own `degraded` does:
  a pin that a conversation excluded is `pins`.
- **A message that would be refused is an answer, not a failure.** `refusal` is
  `{ code, message }`, the code and the words a start would fail with (`context_limit`,
  `grounding_budget`, `invalid_selection`, `needs_unmet`), and there is no
  `planDigest` to approve. `size` is still said, so the person sees how far over
  they are.
- `entries` are the entries a run records before it asks a model: what the
  message was given and what was held back. Not what the model reads once it is
  running (`port:` and `tool:` entries): that cannot be known before.
- A `full` preview of a message with `auto` on or `suggest` searches, as a run
  does, and a search embeds the question. That is a call to the embedding model,
  and the only one a preview makes. A search that does not answer is
  `grounding.auto: "failed"`, as in a run, and the message goes without.
- A preview does not say which tools a run would offer: choosing them is a call
  to the model, and a preview makes none. It is not in the digest either.

## planDigest

`planDigest` is sixteen lowercase hex characters. It is of the entries that a run
records before it asks a model, as `{ ref, digest, shown, status, origin }` each
and in order of ref, so it is the same for the same plan whatever order it was
made in. It moves with what the model is given: a pin or an attachment, an
exclusion, a posting, a new turn in the conversation, an edit to a piece that is
sent. It does not move for an edit to a piece that is not sent, for the CV's
revision, or for how a piece came to be sent (pinned or attached).

`runs.grounding` answers `planDigest` beside `record`, over the same entries, so
what was previewed can be compared with what a run recorded: a preview and the
run it was for have the same digest when the plan did not change in between.

## approved

`run.context.start` and `run.offer.start` take `approved: { planDigest }`, the
digest a `full` preview of this same message answered. Without it a start is what
it always was.

1. A run that already exists for the request (the same `runId`, as for any start)
   is answered first, `recovered: true`, and is not checked. A retry after a lost
   answer must find its run, and not be told the plan moved because the run it
   began has since changed what the record says.
2. Otherwise the message is previewed in full, now.
3. If it would be refused, the start fails with that refusal's own code and words
   and not with a conflict: the person needs to know which of the two it was.
4. If the plan is not the one approved, the start fails with **`plan_conflict`**
   and `details: { planDigest }`, the digest of the plan as it stands. No run is
   made. Preview again, show the person what changed, and send with the new
   digest.
5. Otherwise the run starts.

`approved` is `invalid_input` unless it holds one digest of sixteen lowercase hex
characters, and for a message with no conversation. `run.start` does not take it.

This protects a person from what changed since they looked. It is two readings,
the check and the start, and what changes in the instant between them is not
caught. The run's own record says what it was given.

## Suggested UI

1. Check `grounding-preview` in `protocol.get`. Without it, send no `approved`.
2. Ask `fast` as the person types, and after a pin, an attachment, an exclusion
   or a change of limit. It is cheap and calls nothing. Show `size.total` against
   `limit`, and `refusal` as the reason the send is not offered.
3. Ask `full` when the person is about to send, and show `entries` (the same
   rows as the "based on" list) and `grounding.suggested`.
4. Send with `approved: { planDigest }`.
5. On `plan_conflict`, do not send. Preview again and show what changed.

# Comparing saved offers with the CV

A person who has saved some offers can ask which of them fit their CV best. A
runtime that lists `grounding-offers` in `protocol.get` supports all of this. It
changes nothing for a message that names no offers: that message, and what comes
back for it, are what they were.

Nothing here asks a model to decide anything. The runtime turns the offers into
short cards, finds the parts of the CV that mention what the offers ask for, and
puts those in front of a model that has **no tools**. Every block the model reads is
an entry of the record, so a claim in the answer can be held against the block it
came from.

## input.grounding

```json
{
  "question": "Which of these fits me best?",
  "grounding": {
    "offerIds": ["8f1c2a54-...", "3be7d9a0-..."],
    "preferences": "Remote, no on-call, B2B.",
    "cite": true
  }
}
```

- `offerIds`: the saved offers to compare, at most 100, each once (a repeat is
  dropped, and which offers are compared does not depend on the order the host
  sent them in; `left.missing` and `left.excluded` follow it). More is
  `invalid_input`. An empty list is a message that compares none.
- `preferences`: what the person wants of a job, in their words, at most 2,000
  characters. Studio keeps the person's preferences and the runtime keeps none:
  send them with the message, or leave them out. Blank is the same as absent.
- `cite`: `true` numbers every block the model is given and tells it to cite the
  numbers (see "Citations"). Default: off. It does nothing when there is nothing to
  number.
- A message that compares offers is only ever answered from what it is given.
  `reach` has no effect on it, and the model is offered no tools and is not asked
  which to offer.
- `offerIds` may come with `once` and with the pins of the conversation: those
  pieces of the CV are sent first, as they are for any message.
- `preferences` and `cite` without `offerIds` are not an error. `preferences` are
  ignored, and `cite` numbers the pieces, if there are any.

Only a conversation about a CV compares offers. A message that names offers in a
conversation about one saved offer, or in a run that has no conversation, fails as
`needs_unmet` before any model call: "offers: Offers can be compared only in a
conversation about a CV."

## Which offers are compared

Each id is one of five things, decided in this order and told apart in the result:

| | Meaning | Said as |
| --- | --- | --- |
| excluded | the conversation left the whole offer out (`offers:<id>`). It is never read | `left.excluded` |
| missing | no saved offer has that id | `left.missing` |
| on the Board | the offer is on the Board and has its own preparation. An archived entry is not on it | `left.board` |
| cut | more are left than the 25 that are compared | `left.cut` |
| compared | everything else | `compared` |

The offers compared are the ones **seen most recently** (`lastSeenAt`, then the
offer's id, so the same ids always give the same list). Nothing rates an offer yet,
and recency is the one order the store can vouch for. An offer on the Board does not
take one of the 25 places.

If nothing can be compared the message fails as `needs_unmet` before any model call,
and the message says why:

> offers: None of the 3 offers named can be compared: 1 is left out of this
> conversation, 1 not saved, 1 already on the Board.

If some are compared and some are not, the message is answered, and `degraded`
names `offers`.

## What the model is given

A model is told it has no tools and has only what follows, to put the offers in
order and say why, to name the employer or role in the CV each claim came from, and
to say plainly when what it was given does not say. Then, in this order, and each
under a label that says it is source data and not instructions:

1. the pieces of the CV the pins and attachments chose (`SELECTED CV PARTS`), as
   always;
2. `PREFERENCES — SOURCE DATA`: the preferences as the person wrote them, trimmed,
   or "None were supplied.";
3. `SAVED OFFERS TO COMPARE — SOURCE DATA`: one card per offer;
4. `PARTS OF THE CV THAT MENTION THEIR SKILLS — SOURCE DATA`: the evidence, or "None
   of the skills the offers list appears in the CV."

A card is the offer's own fields and the start of its posting, at most 500
characters, and never half a skill or half a word:

```
Offer: Backend Engineer at Initech Labs
Where: Krakow, hybrid
Level: senior, B2B
Salary: 20000 PLN
Skills: Python, Postgres
Posting: We build billing in Python for banks across Poland and need someone ...
```

Its labels are English whatever language the posting is in.

**The evidence** is the CV's own words, found without a model: the skills an offer
lists are compared, as whole words and without regard to case, with what each part
of the CV says. A skill shorter than two characters is not compared, and the personal
details are never evidence. A part counts once for each skill of each offer that it
mentions. The best eight stay, put in the order of the CV. The search index is not
used. A part a pin or an attachment already sends is not sent a second time.

**The room.** The offers, the preferences and the evidence come to at most 30,000
characters. The cards and the preferences are what was asked for and are never cut;
evidence is kept best first while it fits, and what does not fit is left out whole.
This is counted as the posting is, in the limit of the conversation: a message that
compares offers carries no posting, so the two are not both at their baseline.

## What a message gets back

```json
"offers": {
  "compared": ["8f1c2a54-..."],
  "left": { "excluded": [], "missing": ["3be7d9a0-..."], "board": [], "cut": [] },
  "preferences": "supplied"
},
"grounding": {
  "included": ["offers:8f1c2a54-.../card", "cv:ctx/overview/skills", "cv:ctx/experience/acme~senior-engineer"],
  "blocked": [],
  "gone": ["offers:3be7d9a0-..."],
  "suggested": []
},
"cited": ["offers:8f1c2a54-.../card"],
"unresolved": [9]
```

- `offers` is there when the message compared offers, and absent otherwise.
  `compared` is in the order the cards were given. `preferences` is `supplied` or
  `absent`.
- `grounding` lists what every step sent, the pieces first. An offer the
  conversation left out is `blocked` as `offers:<id>`, one that is not saved is
  `gone`.
- `cited` and `unresolved` are there only when `cite` was on and there was
  something to number.

## The record

- A card is an `included` entry `offers:<id>/card`, `origin: server`,
  `via: ground:offer`, with no version. `digest` is of what the card was made from,
  and moves if the offer changes in any way a card is made of; `shown` is of the card
  as the model read it. An offer being seen again does not move either.
- A part of the CV found as evidence is an `included` entry as a piece is, with
  `via: ground:evidence`.
- The preferences are an `included` entry `preferences:request`, `origin: client`,
  `via: input`: the host's own words, said to be so.
- An offer the conversation left out is a `blocked` entry `offers:<id>`,
  `via: ground:offer`, written when the message is assembled. It is never read.
- The record is written before the model call, as always.

## Citations

With `cite: true` every block the model is given is numbered `[1]`, `[2]`, ... in
the order the record lists them, across the sections: the number of a block is its
place among the `included` entries of the record that were sent. What is said of the
preferences being absent, or of the CV matching nothing, is the runtime's own
statement and carries no number. The model is told to write the number after a
statement that rests on a block, and no number that is not given.

The answer is then read for `[3]` and `[2, 5]`, and nothing else. `cited` is the
refs of the entries those numbers stand for, once each, in the order they first
appear. `unresolved` is the numbers that stand for no entry, `[0]` included. No
entry is guessed for one. A model can still cite wrongly: a number that does resolve
says which block the claim was attributed to, not that the block says it. The host
shows it as that, and opens the block.

## When the answer cannot be given

- `needs_unmet`: nothing can be compared, or this is not a conversation about a CV.
- `invalid_input`: more than 100 ids, an empty id, preferences over 2,000
  characters, or `cite` that is not a boolean.
- `context_limit`: the message is over the conversation's limit. The message says
  `offers` and how much they came to. Before any model call.
- A run that waited for an approval and is resumed after an offer it was given
  changed, or was left out since, fails as `grounding_stale` with the address of its
  card in the message. An offer that has gone onto the Board since is not stale: the
  person approved a comparison that had it.

## Preview

`run.preview` of a message that compares offers answers `size.parts.offers` (both
modes), and with `full` the field `offers` as above and `entries` that include the
cards, the evidence and the preferences. `planDigest` moves with the cards and the
evidence that are sent, with the preferences, and with the offers that are compared;
it does not move for an offer that was not named, for an offer seen again, for a
part of the CV that no offer mentions, or for `cite`.

## Suggested UI

1. Check `grounding-offers` in `protocol.get`. Without it, offer no picker.
2. Let the person pick saved offers, not more than 25 at a time. Show `offers.left`
   after a message as notes next to the offers it names: left out of the
   conversation, not saved, on the Board, beyond the ones compared. Do not call
   them errors.
3. Offer a place for the person's preferences, and send them with the message.
4. Send `cite: true`. Show each number in an answer as a chip that opens what it
   stands for (`cited`), and show `unresolved` numbers as not found, not as links.
5. Show a preview before sending, with `size.parts.offers` against the limit.

## Editing one section

A person changes one section of a CV by saying what to change. The runtime sends
the model that section only, takes one section back, and proposes the CV with it
replaced. Nothing is saved until the proposal is accepted. This is how a person
sees what the model did, and how an accept writes it.

### Aiming an edit: `input.target`

`edit_cv` takes the section as a ref, the same address an exclusion, a pin and a
record entry call it by:

| Section | `target` |
| --- | --- |
| personal details | `cv:<context id>/overview/personal` |
| summary | `cv:<context id>/overview/role_description` |
| skills | `cv:<context id>/overview/skills` |
| jobs | `cv:<context id>/experience` |
| education | `cv:<context id>/education` |
| certificates | `cv:<context id>/certificates` |
| spoken languages | `cv:<context id>/languages` |

A `target` names a whole section of the conversation's own CV, and nothing else.
The `<context id>` is the one of the run (`cv` for a run in no context). A version
(`@3`) or a digest (`#...`) on it is ignored: the edit is made on what is stored.

- `section` (`"experience"`, `"skills"`, ...) still works. Give both and they must
  name the same section, or the run fails as `invalid_input`.
- Give neither and the section is chosen by a model from the instruction, as before.
  That is one more model call; a `target` or a `section` skips it.
- A ref that does not parse is `invalid_ref`. A ref that parses and is not a section
  of this CV is `invalid_selection`: another well (`offers:...`), another CV, the
  whole CV, the whole overview, one entry of a list (`cv:<id>/experience/acme~dev`),
  or a name that is not a section. The message gives examples of a ref that would
  do. Entry-level edits are not offered: an edit returns a whole section.
- All of these are refused before any model is asked.

### When the section is excluded

An edit aimed at something the conversation has excluded fails as `target_excluded`
and the message says so ("The experience of this CV is excluded from the
conversation ..."). Show it as the reason, with a way to include the section again.

- When the whole section is excluded (a wall on the section, on the overview for an
  overview item, or on the whole CV) this is said before anything runs: no model
  call, and no step in the run's events.
- When a list section has only entries left that are all excluded, it is found out
  when the CV is read: the same code and message, still no model call.
- An instruction that names no section is routed first, and what it is routed to is
  checked when the CV is read.
- An exclusion elsewhere does not stop the edit. What is excluded is not sent to the
  model, and the proposal keeps it as it was stored. It is in none of the changes.

### What an edit returns

```json
{
  "document": { "...": "the whole CV with the section revised" },
  "section": "experience",
  "target": "cv:<context id>/experience",
  "changes": [
    { "op": "replace", "path": ["experience", 0, "title"], "before": "Senior Engineer", "after": "Staff Engineer" }
  ],
  "changed": true,
  "base": { "contextId": "<context id>", "revision": 7, "generation": 0 },
  "proposalId": "<run id>"
}
```

`changed` is `changes.length > 0`. When it is false there is nothing to accept and
no `proposalId`. `base` is absent when the document was sent with the request.
`target` and `changes` are new: a client that ignores them gets what it got before.

### The changes

A change is one of three things, in the vocabulary of a JSON patch plus what it
found:

| `op` | Fields | Meaning |
| --- | --- | --- |
| `replace` | `path`, `before`, `after` | the value at `path` was `before` and is `after` |
| `add` | `path`, `after` | `after` is a new key of an object, or is inserted at an index of a list |
| `remove` | `path`, `before` | the key or index held `before` and is gone |

- `path` is the keys and indices from the root of the CV, so
  `["experience", 1, "highlights", 0]` is the first highlight of the second job. The
  first place is always the section: `personal`, `role_description`, `skills`,
  `experience`, `education`, `certificates` or `languages`. For skills the three
  lists the runtime derives from the rows (`programming_languages`, `frameworks`,
  `libraries_and_tools`) appear in the changes as well.
- They are applied in order, each to what the one before left. An index is the
  index at that moment. So a person can be shown the list top to bottom and an
  insertion does not shift what the list below it says.
- Two lists are lined up before they are compared: entries that are the same in both
  stay where they are. A job with one new bullet is one `add`, and an entry moved to
  the top is a `remove` and an `add`. Past 250,000 comparisons the lists are compared
  in order instead, which is a longer list of changes with the same result.
- `before` is checked when a change is applied. A change that finds something else
  where it expected `before` does not apply.
- At most 2,000 changes, and a path of at most 12 places.
- Dates are as stored: a job that has not ended has `finished: null`.

Show a person the changes as the difference, not the whole document, and not a
sentence from the model: the changes are exactly what an accept will write.

### Proposals and accepting

`profile.proposals.list` returns `target` and `changes` with every proposal an edit
made once this feature exists. A proposal made before has neither: show it as you
did, as the document it holds.

`profile.proposals.accept` checks the revision as before (`document_conflict` if the
CV moved on since the proposal was made; the proposal stays pending). Then:

- the changes are applied to the stored CV, and what is written is the stored CV
  with exactly those changes. The result must be the document the proposal holds,
  or nothing is written;
- a change outside the section the proposal was aimed at is refused as
  `proposal_out_of_scope`, and so is a proposal whose changes cannot be read or that
  has no target. These cannot come from the runtime's own edits; they say a stored
  proposal was altered;
- changes that do not apply to the stored CV, or that do not make the document the
  proposal holds, are `context_conflict`. The message names the position of the
  change ("Change 3 does not apply: ...") and never what the CV held.

An accept that is repeated is the same accept. A discarded or invalidated proposal
cannot be accepted.

### Codes

- `invalid_ref`, `invalid_selection`: the `target`, as above.
- `invalid_input`: a `target` and a `section` that name different sections, or no
  instruction.
- `target_excluded`: the section is excluded from the conversation.
- `proposal_out_of_scope`: on an accept, a proposal that reaches outside its section
  or cannot be read.
- `context_conflict`, `document_conflict`: on an accept, as above.

### Suggested UI

1. Check `grounding-edits` in `protocol.get`. Without it, send `section` and show the
   difference as before.
2. Let the person pick the section (a row in the CV view, or a menu), then say what
   to change. Send `target` with the instruction.
3. Show the proposal from `changes`: one line per change, with `before` and `after`,
   grouped by entry (the first two places of the path after the section). An `add` or
   a `remove` of a whole entry is the entry shown as added or removed.
4. Offer Accept and Discard. On `document_conflict` say the CV changed since, and
   offer to make the edit again. Do not retry an accept that failed with
   `proposal_out_of_scope`: it is not a race.
5. Disable the edit of a section that is excluded, with the reason, and send nothing.
   `target_excluded` is still the answer if it was excluded after.

# Long conversations

A conversation gets long in two ways: a message that carries more of the CV than
fits, and turns that no longer fit the window. This is how a runtime that lists
`grounding-compaction` in `protocol.get` carries both on, without sending the model
something the person excluded and without hiding what was left out.

## A message that does not fit: `overflow` and `full`

`input.grounding` of `ask_profile` takes two more optional fields:

```json
{
  "question": "What did I do at Acme?",
  "grounding": {
    "once": ["cv:9d5e0c1a-5b0e-4d56-9a3a-3f0f6f2f7c11/experience"],
    "overflow": "compact",
    "full": ["cv:9d5e0c1a-5b0e-4d56-9a3a-3f0f6f2f7c11/experience/acme~senior-engineer"]
  }
}
```

- `overflow`: `refuse` is what a message does unless it says otherwise, and it is
  what every message did before: over the budget (`grounding_budget`) or over the
  conversation's limit (`context_limit`) it is refused before any model call. With
  `compact` the runtime first sends some of the pieces in a shorter form, and
  refuses only what that cannot make fit. Default: `refuse`.
- `full`: pieces `compact` is not to shorten, written like a pin, at most 12. A
  section names every piece in it. It is what a person says after a piece was
  shortened and should have been whole. The others are shortened instead, or the
  message is refused. A piece that is not part of the message is ignored.
- Keys it does not know are ignored, as before. `edit_cv` takes neither: an edit is
  always made against the CV as it is stored, and what it is shown is the same
  whatever a conversation's messages were sent as.

### What is shortened, and in what order

Only these pieces have a shorter form, and only when it is shorter than the whole:

| Piece | What the shorter form keeps |
| --- | --- |
| an experience entry | its heading and dates, and its first two highlights |
| an education entry | its heading, dates and mark |
| the role description | its first sentences, up to 300 characters |
| the skills | the role, and the first six of each group |

Personal details, certificates and spoken languages are already as short as a piece
gets. They are never shortened, and neither is a piece the CV holds less of than the
limits above.

- A piece that was shortened says so in its own text, as its last line: `(shortened:
  2 more highlights and its 3 skills not shown)`. The model is never given part of a
  piece as though it were all of it.
- The pieces that save most go first, the earliest of them on a tie, and only as
  many as it takes. A message that fits is sent whole, with `overflow` or without.
- Pieces the runtime added by itself (`auto: on`) are not shortened: they are added
  only while they fit.
- A piece whose parts the conversation excludes is shortened from what the model
  would be shown of it, so an excluded part is not in the shorter form either.
- When shortening is not enough the message is refused with the same code as
  without, and the message of it ends with "Shortening 2 of them was not enough."
- The shorter form is a function of the piece and nothing else. It is worked out
  when the message is sent and kept nowhere, so it cannot be out of date.

### What a message gets back

`grounding.compacted` lists, in the order they were shortened, the addresses of the
pieces that were sent in a shorter form. It is absent when nothing was, so a
message that was not shortened has the result it always had. Each of them is also
in `included`. `run.preview` of mode `full` answers it the same way.

```json
"grounding": {
  "included": ["cv:9d5e0c1a-.../experience/acme~senior-engineer"],
  "compacted": ["cv:9d5e0c1a-.../experience/acme~senior-engineer"],
  "blocked": [], "gone": [], "suggested": []
}
```

Its record entry is an `included` entry of the original, as ever: `ref` and `digest`
are the original's, and `shown` is the digest of the shorter form, so it reads as
"partly shown". The original is not lost: **Reattach** is sending the next message
with the same piece in `full`.

- A change to a part the shorter form leaves out changes the entry's `digest`, and
  so the `planDigest` of a preview, though not the text that is sent. An approval is
  of the entry, and that is the point.
- A run that waited for an approval is checked against the digest of the original,
  as any piece is.
- An answer made from a shortened piece that is excluded later is withheld from
  what follows, as any answer made from it is.

## Folding the turns that no longer fit: `conversations.compactPlan`

A conversation carries its past as a note (`conversations.summarise`) written from
the turns that fell out of the window. Which turns are for the host to choose, and
a host does not know what the runtime does: that an answer was built from a piece
since excluded, and that a note made from it carries it. `conversations.compactPlan`
answers for the runtime. It reads and writes nothing and asks no model.

Request `{ conversationId, keep? }`. `keep` is how many of the newest exchanges stay
as they are, 0 to 10, default 2. A conversation that does not exist is `not_found`.

```json
{
  "conversationId": "c1",
  "summarisedThrough": 4,
  "summary": "The person asked about Acme and ...",
  "turns": [ { "seq": 5, "role": "user", "text": "What did I do at Acme?", "omitted": 0 } ],
  "through": 6,
  "more": false,
  "kept": 2,
  "withheld": []
}
```

- `turns` are the turns to fold into the note, oldest first, as the model that
  writes it will read them. A turn of more than 1,500 characters is cut at a word
  and says so at its end (`[shortened: 312 more characters not shown]`), and
  `omitted` is how many. The turns are as many whole exchanges as the note's model
  reads: at most 40 turns and 9,000 characters. A turn is never clipped unseen at
  the end of a transcript, and an exchange is never split.
- `summary` is the note as it stands, to give the model that folds. It is empty when
  there is none, and when it is withheld (below).
- `through` is the `seq` to record the new note as made through, with
  `conversations.summarise`: the last turn of `turns`. It never goes back.
- `more` says more can be folded after these: the same again does the next.
- `kept` is the number of the newest exchanges that stay. At most `keep`, and fewer
  in a conversation that has fewer. An unanswered question stays too.
- `reason` is present only when nothing is to be folded: `nothing` (there is
  nothing older than what stays), `withheld` (the first thing to fold is an answer
  the conversation's exclusions withhold) or `summary_withheld` (the note was made
  from such an answer; writing a new one over it would lose what it holds for good).
- `withheld` lists the `seq` of every answer that is to be folded and is withheld.
  The fold stops before the first of them, so the model that writes the note is
  never given what the model that answers is not.

To fold, a host calls `conversations.compactPlan`, runs `summarize_conversation`
with `{ summary, turns: [{ role, text }] }` from the plan, and records the result
with `conversations.summarise` and the plan's `through`. The fold is one way: what
was folded is a note and not the turns, and the turns are not given back. Turns a
host folded itself, with its own `history`, are still `origin: client`.

When a message is refused as `context_limit` for its history, fold and send again,
before showing the person an error.

## What goes when a conversation goes

A selection, a conversation's pins and its limit live and die with it. So does
what its runs made:

- **The runs** the conversation made and **the record** of what each was given are
  deleted with it, once they have ended. A run that is still going stays, and so
  does a run that a CV proposal is still pointed at, which is the person's to
  accept or discard. Neither is reachable from the conversation any more, and a
  message that names a run that went (`conversations.append` with its `runId`) is
  refused as `context_conflict`, as a run of another conversation always was.
- Runs that no conversation owns (discovery, enrichment) are not touched, and runs
  an older runtime left behind are not purged.
- **A copy of a CV** (`profile.contexts.copy`) copies no selection, pin or limit: it
  starts with every piece of it in.
- **A cleared CV** (`profile.context.clearContent`) leaves the pins on it. Each now
  reads `gone`, and a person can unpin them.
- `conversations.delete` answers as before, `{ deleted }`.

## Suggested UI

1. Check `grounding-compaction` in `protocol.get`. Without it, show none of this.
2. On `context_limit`, offer "Send shortened" before "Raise the limit", and send the
   same message with `overflow: "compact"`.
3. Mark each piece of `compacted` as "shortened" in the "based on" list and next to
   the message, with a **Reattach** action: send the next message with the piece in
   `full`. Entries with `shown` are already "partly shown".
4. `/compact` in the composer: call `conversations.compactPlan`, show how many turns
   will be folded and how many stay, run `summarize_conversation`, record the note.
   Offer it again while `more`. With a `reason`, say so in plain words and fold
   nothing; for `summary_withheld` or `withheld` say what the exclusions hold back and
   offer to include the piece again.
5. Do the same by itself over the limit, and say that it did.

# Keeping a person's details from a model

A model on someone else's machine is sent the text of a question, of the CV pieces
a message is made from, and of the conversation. This is how a runtime that lists
`masking` in `protocol.get` keeps the person's own name, email, phone number and
links out of that text, and puts them back into what comes home.

Say "mask", never "anonymise". A city and a run of dates still describe a person, an
employer and a school do unless the person chose `strict` (below), and a provider that
is sent masked text is still sent personal data. What this does is narrower and exact:
the values the CV states in its personal details are not in the request, and with
`strict` neither are the companies and universities it names.

## The setting: `maskMode`

`settings.get` returns `maskMode`, and `settings.set` takes it, next to the
provider settings:

```json
{ "settings": { "providerId": "openai", "maskMode": "always" } }
```

- `hosted`: a call to a model that is not on this machine is masked, and a call to
  a local one is sent as it always was. This is what a runtime does with nothing
  stored, and `maskMode` is absent from `settings.get` then.
- `always`: every call is masked, the local ones too. For a person who wants a
  local model to be asked what a hosted one would be.
- There is no value that turns it off, and none can be added without the runtime
  itself saying so. A value the runtime does not know is refused with
  `invalid_input`; one that is in the database anyway is read as `always`.
- `settings.set` with `maskMode` left out **keeps what is stored**, and `null`
  returns it to the default. The other fields still work the other way: one left
  out is cleared. A build of Studio that does not know the field therefore cannot
  switch masking off by saving a provider.
- It is in force on the next message. It is not read at start-up and needs no restart.
- `providers.status` and `providers.test` accept the field and ignore it.

A runtime that keeps masking on by default changes what a hosted provider is
sent, and says so here: this is the one setting of the grounding protocol whose
default alters a payload that nothing the person did had altered before.

## The setting: `maskScope`

With `masking-strict`, `settings.get` returns `maskScope` too, and `settings.set` takes
it. The mode says which calls are masked; the scope says which of the person's own
values are:

```json
{ "settings": { "providerId": "openai", "maskMode": "hosted", "maskScope": "strict" } }
```

- `personal`: the name, the email, the phone number and the links of the CV's `personal`
  section. This is what a runtime does with nothing stored, and `maskScope` is absent
  from `settings.get` then.
- `strict`: those, and the `company` of every experience entry and the `university` of
  every education entry. Each is one value, called `[ORG_1]`, `[ORG_2]` and so on.
- The rules are those of `maskMode`. A scope the runtime does not know is refused with
  `invalid_input`; one that is in the database anyway is read as `strict`. `settings.set`
  with `maskScope` left out **keeps what is stored**, and `null` returns it to the
  default, so a build of Studio that does not know the field cannot switch it off by
  saving a provider. It is in force on the next message and needs no restart.
  `providers.status` and `providers.test` accept the field and ignore it.
- A run is held to the scope the person had set when it began, as to the mode: a change
  made while a run waits is in force from the next message.
- Changing the scope is not a re-index. Chunks embedded before keep their vectors (see
  "What an embedding provider is sent").

What `strict` takes, and what it leaves, said plainly:

- **A name is one value, whole.** Not a word of it by itself: "Politechnika" is not a
  school, and the first word of an employer is not the employer. A name is taken in any
  case and with or without its diacritics, with any run of white space between its words,
  and only as a whole word: `Acmeville` is not `Acme`.
- **A company is also taken without its legal form**, because that is how it is said:
  `Acme Sp. z o.o.` is also `Acme`. The forms are `sp. z o.o.`, `s.a.`, `sp. k.`,
  `sp. j.`, `inc`, `ltd`, `llc`, `gmbh`, `plc`, `corp`, `limited`, `ag` and `b.v.`, at the
  end of the name, once, and a name left with fewer than three characters is not taken
  without it. The full stop that ends the form is left outside the placeholder:
  `Acme Sp. z o.o.` is sent as `[ORG_1].`.
- **Not taken:** an employer written shorter or otherwise than the CV writes it (the CV
  says `Acme Software Sp. z o.o.` and a message says `Acme`), a form of the name that a
  Polish case ending changes, the issuer of a certificate, the thesis, the degree, the
  title and the place.
- **Common words.** An employer called `Apple` or `Orange` is taken as an employer
  wherever the word stands alone, and a message about the fruit is masked too.
- **No CV, no employers.** A run that may not read the CV (discovery) has none to keep.

## The person's own terms: `masking.terms`

With `masking-terms` a person can add what their CV does not say and they want kept
from a model all the same: a client, a project, a nickname, the town they live in. Each
is called `[TERM_1]`, `[TERM_2]` and so on, in every scope and under the same mode.

```json
{ "channel": "masking.terms.set", "payload": { "terms": ["Initrode", "Project Falcon"] } }
```

The answer, and the answer of `masking.terms.get` (payload `{}`), is the list in force
and whether one has been sent since the runtime started:

```json
{ "terms": ["Initrode", "Project Falcon"], "declared": true }
```

- **Studio keeps the list; the runtime does not.** The runtime holds it in memory and
  writes it nowhere: not in the database, not in the index, not in a log. A runtime
  that restarts has none and says `declared: false` until it is sent the list again.
  So send it on every connection, not once per launch, and again on every change.
- **The whole list each time.** `masking.terms.set` replaces what was there. `[]` says
  there are none, and that is a list sent: it is what a person who never added a term
  sends.
- **Fail closed.** Until a list has been sent, a background rebuild of the index whose
  embedder is masked (a hosted one, or any under `always`) is not started: the runtime
  cannot know what it would have to keep. The job waits as pending, is never tried and
  never fails, and the new revision of the CV cannot be searched until it is built. It
  starts within a second of the list. A rebuild with an embedder that is not masked does
  not wait. A message is not held back: it is sent by Studio, which sends the list first.
- **What is taken.** Each term as it was typed, whole, as a word of its own: in any case,
  with or without its diacritics, and with any run of white space between its words.
  Its punctuation is part of it, so `C++` is `C++` and not `C`, and `Acme Inc.` is not
  `Acme Inc`. A word of a term by itself is not the term: `Project Falcon` does not take
  `Falcon` alone, and a person who wants that adds `Falcon`. A term that is a common word
  is taken wherever it stands alone.
- **Limits.** At most 100 terms, each 3 to 300 characters once the white space around it
  is taken off, which is the white space the runtime takes off. Anything else refuses
  the whole list with `invalid_input` and leaves the one in force as it was. A term
  that is the same as one before it in another case, with other diacritics or other
  spacing is kept once, as first written.
- **In force at once.** A run asks for the list at each model call, as it reads the CV,
  so a term added while a run waits is kept from its next call. The index embedder asks
  at each call too. Changing the list is not a re-index (see "What an embedding provider
  is sent").
- **In every run.** A run that may not read the CV (discovery) still keeps the terms:
  they are not the CV's.

## What is kept, and what is not

The values come from the stored CV's `personal` section, read at every call: the
name, the email, the phone number and each link. They are taken wherever they turn
up, in a question, in a pasted posting, in an earlier answer, in a tool's result.
With `strict` they come from the experience and education sections too.

- A name is taken whole, in the other order (`Kowalska Anna`), and each word of it
  alone, and each half of a hyphenated one. A word is at least three letters.
- Case and diacritics do not matter: `ŁUKASZ` and `lukasz` are the name `Łukasz`.
- A phone number is taken however it is spaced, and without its country code when
  the CV wrote it with one.
- A link is taken with or without its scheme, `www.` and trailing slash.
- What is not taken: the location (a city is shared by too many people); a
  word that is a form of a name and not the name (a Polish case ending on a
  surname); an email or a phone the CV does not state; and anything that is not text.
  A name that is also a common word is taken as a name wherever it is written.
- A piece that a conversation excludes is still a source of values. A name that is
  left out of a message is still a name.

The model is given `[NAME_1]`, `[EMAIL_1]`, `[PHONE_1]`, `[LINK_1]`, with `strict`
`[ORG_1]`, for a person's own terms `[TERM_1]`, and, for what is found by its shape,
`[ID_1]` and `[DOB_1]` (next section). The same text
is the same placeholder in a call and a different spelling is another one, so what
a person wrote comes back as they wrote it. The numbers mean nothing outside the
call that issued them.

What comes back is put right before anything sees it: the answer, a structured
result (an extraction, a proposal, a plan), each streamed fragment of a reply, and
what a tool is asked for when the model names a placeholder. A placeholder the call
did not issue is left as it is. Fragments are held back only while the end of one
could still become a placeholder, so a streamed reply may stop for a moment at an
opening bracket.

## Identifiers found by their shape

`masking-detectors` in `protocol.get` says that, as well as what the CV states, the
runtime keeps from a model what has the shape of an identifier, **whoever's it is**:
a referee's email in a pasted CV, a recruiter's phone number in a posting, a PESEL
in the text of a scanned form. There is no setting for it and nothing to send. It
applies to every call that is masked (`maskMode`), and a call is masked now even
when the CV states nothing at all.

| Placeholder | What is taken |
| --- | --- |
| `[EMAIL_n]` | an email address |
| `[PHONE_n]` | a number written with a country code (`+48`, `0048`, `+44`, `+1`, any other with 8 to 15 digits); a Polish mobile or landline in the layouts it is written in; an American number with brackets, hyphens or dots; a British one |
| `[LINK_n]` | a profile on LinkedIn, GitHub, GitLab, Bitbucket, X, Twitter, Instagram, Facebook, Behance, Dribbble, TikTok, Medium, Stack Overflow, Telegram, GoldenLine, Pracuj, Aplikuj or OLX; a handle written after the name of a network (`twitter: @anna`) |
| `[ID_n]` | a PESEL, a NIP, an IBAN, a Polish account number |
| `[DOB_n]` | a date written after a word that says it is of birth (`born`, `date of birth`, `data urodzenia`, `ur.`), in numbers or with the month in words, in Polish or English |

Precision comes before recall, because a number taken for an identifier is a number the
model can no longer read. So each is held to more than a run of digits:

- A PESEL needs its control digit and a birth date that exists. A NIP needs its control
  digit and either its label (`NIP`, `VAT ID`) or its hyphenated layout. An IBAN and a
  Polish account number need their remainder.
- A date is taken only after a word that says it is of birth, and only when it is a day
  that was, in a year between 1900 and 2100. `3.11.1990` alone is not taken.
- A number that has the shape of a phone number and is followed by a currency or a unit
  (`123 456 789 PLN`, `600 700 800 kg`), that is the end of a longer number
  (`1 600 700 800`), or that follows a currency sign is an amount and is left alone.
- A number written with a country code is as long as its country says: `+48 600 700 800 12`
  is taken as `+48 600 700 800`.
- Versions (`3.11.2`), years, ranges of years or salaries, an order number of eleven
  digits that is no PESEL, an annotation (`@Override`), a file name (`logo@2x.png`) and a link
  to a page that is not on one of the profile hosts above (a job page, a company site) are
  left alone. A link to one of those hosts is taken whatever its path, so
  `github.com/features` is masked as if it were a person's.

What it still takes by mistake: nine digits in threes that begin like a Polish mobile and
are not an amount, and a number laid out like a Polish landline (`22 123 45 67`), a
British or an American one that is something else. The model is then given `[PHONE_1]`
for it; the answer is put right as always, so the person sees what they wrote, and only
a question that asks the model to read the number is affected.

What it does not do: a name, a street or a city; anything spelled out in words; a number
split over a line break; an identifier from a country it does not know (a number with a
country code is found, a national layout of another country is not).

Everything else in this chapter applies unchanged. The same text is the same placeholder
in a call, a different spelling is another one, what comes home is put right, a stream is
held back only while a placeholder could still be forming, and a tool's result is masked
on its way back to the model. A seed and a shape over the same text are one placeholder
and the CV's own value says what it is; where a shape is longer than a seed inside it
(`nowak@example.com` when the CV has the name Nowak) the shape is taken whole.

A text with no identifier in it and no value of the CV is sent byte for byte as it was.
A text with one is not, and this is the second change to what a hosted provider is
sent without anything the person did: a call that had no CV values to keep is now
masked as soon as its text holds an identifier.

## What an embedding provider is sent

The index of a person's CV is made of its text, and a search embeds the question that
is asked of it. Each is a call to the embedding provider, and neither happens inside a
message, so a runtime that masked only a message left them as they were. A person who
chose a hosted embedder (`EMBEDDING_PROVIDER` `openai` or `huggingface`) was sending it
their name, email and phone number in the chunks of the index, and again in every
question. With `masking-embedding` the runtime holds those calls to the rule it holds a
message to:

- **Which provider decides.** The one the embedding resolves to, which is not always the
  one that writes the answers: a person can chat with a hosted model and embed on their
  own machine, or the other way round. Under `hosted` an embedder that is not local is
  masked and a local one is sent what it always was. Under `always` both are masked.
- **What is taken.** The same as in a message: what the CV states (with `strict`, the
  employers and schools too, as the scope is set at that call), the person's own terms
  as the list is at that call, and what has the shape of an identifier. The chunks of one rebuild are one call, so a value is one placeholder in
  all of them. A text that holds nothing to keep is sent as it was, and its vector is the
  one it always was.
- **Nothing comes back to put right.** What returns is numbers. What the index stores, and
  what a search hit shows, is the person's own text: masking is about what leaves.
- **Nothing is made again.** The fingerprint of an index (provider, model, dimension,
  chunker version) does not change, so no one is made to embed their whole CV again by
  this, and nothing marks an existing index stale.
- **A run's own call is held to it too.** A CV that is read and indexed inside a run goes
  through the run's gateway, which asks the same question of the same provider. A search
  made for a message, or for a `full` preview, is masked with the person's CV values even
  when the run itself may not read the CV (discovery): the runtime reads its own CV for
  this, and it can only mask more.

What it leaves, said plainly:

- **A mixed index.** Vectors made before the runtime had this are of text as it was, and
  vectors made after are of text with placeholders in it. A question that holds the
  person's own name or email is now embedded as a placeholder and can match an older
  vector a little less well, until the index is made again (`profile.context.reindex`).
  Only a chunk or a question that holds a value of the person's is affected.
- **A change of setting is not a re-index.** Turning `always` on for a local embedder,
  `strict` on for any, or adding a term, masks what is embedded from then on and leaves
  the vectors that exist as they are. Chunks of experience and education are the ones a person who turns
  `strict` on will have in both kinds until the index is made again.
- A placeholder is a different string from the name it stands for, so a search that looks for
  a person's name in the vectors finds it less well. The keyword half of a search reads the
  stored text and is not affected.
- `transcribeImage` is not masked (below).

## What a person's own machine keeps

- The CV, the record of a message (`runs.grounding`), a preview (`run.preview`) and
  the trace of a tool hold the real values. Masking is about what leaves for a
  model, and what a person reads on their own machine is theirs.
- The list of a person's own terms is not kept at all (`masking.terms`): Studio keeps
  it, and the runtime holds it only while it runs.
- A preview is not masked: it calls no model. (Its search for pieces embeds the
  question, which is a call to the embedding provider and is masked as any other, under
  `masking-embedding`.)
- A run that may not read the CV (discovery) has no values of the person's to keep,
  so a runtime without `masking-detectors` sends its calls as they were. With it,
  such a run is still held to the shapes of identifiers (next section), because a
  saved offer can hold someone's email or phone too. It is not refused for either.
- A run whose CV cannot be read at all is refused; it is not sent as if it had no
  values. A CV with no name, email, phone or link in it masks no name, and still
  masks what has the shape of an identifier (next section).

## What is not covered

- `transcribeImage` is handed on as it is. An image is pixels, and masking it would
  change what it is for. `embed` is masked when the runtime says `masking-embedding`
  (the section above); without it, the embedding provider is the local one unless a
  person chose otherwise, and a person who did is sending it their CV text unmasked.
- A name, a street, a city, an employer and a school have no shape, and are not found
  unless the CV states them: a name in `personal`, an employer or a school only with
  `strict`, and then only as the CV writes it. What is found by shape is in the next
  section, and a runtime without `masking-detectors` finds nothing that way.
- A model that rewrites a placeholder into something else (`[Name 1]` is read; a
  translation of it is not) is not put right.
- A structured answer whose schema constrains a field to a format (an email) can be
  refused for holding a placeholder.

## Suggested UI

1. Check `masking` in `protocol.get`. Without it, show nothing of this.
2. A line in the provider settings: "Mask my name and contact details" with the two
   choices, "When the model is not on this computer" (`hosted`) and "Always"
   (`always`). Say "mask", not "anonymise". Under it, in one sentence, say what is
   masked and that the CV, the record and the preview on the person's own machine
   show the real values. With `masking-detectors`, add that an email, a phone
   number, a profile link, an ID number or a date of birth written in a message is
   masked whoever's it is. With `masking-embedding`, add that the text a hosted embedding
   provider is given is kept the same way.
3. With `masking-strict`, one more choice under it: "Also mask employers and schools"
   (`maskScope` `strict`, off is `personal`). Say that a company is found as the CV
   writes it and without its legal form, and that a shortened name is not.
4. With `masking-terms`, a list under it: "Also mask these words", where a person adds
   and removes terms. Check each is 3 to 300 characters before sending, say that a term
   is found whole and as typed, and that a word of it alone is not. Keep the list in
   Studio, and send it on every connection to the runtime and on every change, `[]`
   when it is empty.
5. Do not offer a way to turn masking off. There is none.
6. Send the settings with the others, and when the person has not touched one, send
   nothing, so as not to overwrite what another window saved.
