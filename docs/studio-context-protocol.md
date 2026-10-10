# Studio integration: CV context protocol 2

Studio speaks this protocol: one CV per language, checked writes, proposals that
survive a restart, conversations and runs. It asks `protocol.get` for
`cv-contexts`, `checked-writes` and `durable-proposals` before it shows a CV, and
refuses a runtime without them.

What a run gave the model, and what a person leaves out of a conversation or puts
into a message, is in `studio-grounding-protocol.md`.

## Startup and compatibility

The stdio framing version remains 1; the CV feature protocol below is version 2.
Call `protocol.get` with `{}`. Require `version: 2` and the features needed by
the client (`cv-contexts`, `checked-writes`, `durable-proposals`, `context-copy`,
`offer-snapshot-runs`). An older runtime returns `unknown_channel`; keep the
switch disabled and request a compatible sidecar. Do not fall back to legacy
writes. Unknown fields are rejected on IPC ownership/mutation payloads.

The new lifecycle calls and `run.offer.start` require `protocolVersion: 2`.
Missing/wrong versions fail validation (`invalid_input`) before any mutation.
Legacy profile/photo writes and unscoped runs are refused once the legacy CV
has an assigned language or any non-legacy context exists.

## Registry and initialization

- `profile.contexts.list {}` returns `{contexts}`. A missing language means an
  absent version; do not create it automatically. An existing empty context can
  have no document; treat its content revision as zero.
- `profile.contexts.assignLanguage {protocolVersion:2, contextId:"cv", language,
  expectedRevision}` assigns the migrated CV explicitly. The revision is the
  original **metadata** revision, not the content revision. Repeating the same
  assignment is safe. Assigned languages cannot be changed.
- `profile.contexts.create {protocolVersion:2, id, language}` creates an empty
  context. Generate a lowercase UUID once, persist it until the request resolves,
  and reuse it on retry. PL and EN each have at most one owner.
- `profile.contexts.copy {protocolVersion:2, id, language, sourceContextId,
  expectedSourceRevision}` creates an independent destination and returns
  `{context, record, provenance}`. The UUID is both destination and retry identity.
  Copy requires an existing source document at the original content revision.
- `profile.contexts.provenance {contextId}` returns source context/revision and
  copy time, or null for an empty-created or migrated context.

Copy preserves content, including source reference metadata, verbatim. Those
references are values in each document, not shared mutable source rows. It does
not translate text or copy conversations, proposals or search rows. The derived
index is rebuilt independently. Photo inclusion starts false. Provenance and the
original copy receipt survive later changes/clear; retry returns the original
receipt and never resets the destination. A copy UUID cannot be reused for empty
creation or a different copy request.

Unassigned legacy contexts allow checked reads, edits, imports, profile chats,
proposals, photo controls, clear and indexing. Creating a second context, copying,
and capturing offer work require explicit language assignment. Active queued,
running or suspended unbound legacy runs block the lifecycle transition: finish
or cancel them first (`run.cancel` can abandon persisted suspended runs). On desktop startup, interrupted queued/running work is
settled as `process_interrupted`; it is never automatically replayed.

## Edits, imports and reset

`profile.context.get {contextId}` returns context metadata and optional document.
`profile.context.update {contextId, expectedRevision, document, operationId?}`
replaces content. Retain the revision the editor opened. Use an operation ID for
response-loss recovery; it is optional only for compatibility with the initial
checked contract. A retry with the same ID and payload returns its original
receipt. Reusing the ID for another write is rejected. Reload after receipt
recovery because a later edit may already exist.

`document_conflict` includes `contextId`, `expectedRevision` and `actualRevision`.
Keep the unsaved draft; do not replace its base with a new revision silently.
`context_conflict`, `context_not_found`, `language_in_use`,
`language_assignment_required` and `invalid_input` are separate domain errors.
Metadata/generation conflicts must also preserve pending work and trigger reload.

Start imports with `run.context.start {runId, contextId, contextGeneration,
contextRevision, conversationId?, capability:"extract_cv", input}`. Capture the
context and generation at import start. Chain the returned content revision
between section imports. An intervening edit causes a conflict; do not regenerate
an expected revision for an already-generated result. Successful sections remain
committed if a later section fails. Cancel outstanding runs and reload on failure;
a deliberate retry is a new section operation using the current base.

`profile.context.clearContent {contextId, expectedRevision, operationId}` advances
the generation, clears content and invalidates proposals/index data atomically.
It preserves the photo asset and inclusion. Old-generation import commits fail
even if cancellation loses a race. Operation IDs make clear retries safe.

## Proposals, conversations and recovery

Use profile subjects `{kind:"profile", id:contextId}`. Legacy empty subject IDs
remain aliases for `cv`, preserving existing transcripts and summaries.

`profile.proposals.list {contextId}` restores pending work. Accept/discard with
`{contextId, proposalId}` on `profile.proposals.accept` / `.discard`. Acceptance
uses the persisted generation/base and a durable receipt; retries do not overwrite
later edits. An edit aimed at a section carries `target` and `changes`, and an
accept writes those changes (see `studio-grounding-protocol.md`, "Editing one
section"). Offer snapshot edit results are historical artifacts, not live CV
proposals, and cannot be accepted through this route.

Persist caller-generated `runId` before starting work. Repeating `run.start`,
`run.context.start` or `run.offer.start` with the same identity and normalized
input returns the existing run with `recovered:true` and its status. It never
executes again, including after restart or failure. Changed inputs/ownership
cannot reuse the ID. Use `run.await`, `runs.get` and events to recover results.
Library hosts can call `findRun(request)` before `begin(request)` for the same
lookup/validation. Suspended work resumes only through `run.resume`; interrupted
queued/running work fails without automatic replay. A failed import may already
have committed a section: reload before deciding what remains.

## Photos

`profile.photoAsset.get {}` reads the shared asset. `.replace {photo,
expectedRevision, operationId}` replaces it globally; null deletes it globally.
`profile.context.photo.include {contextId, includePhoto, expectedRevision,
operationId}` changes only that context's metadata. `profile.context.photo.get
{contextId}` returns effective photo and asset revision atomically. Preserve
operation IDs across retries and reload current state after receipt recovery.
Studio must capture its complete rendering input, including document/context,
photo and layout identity; runtime photo snapshots alone are not render snapshots.

## Offer work

Capture with `offers.snapshots.capture {id, offerId, contextId, expectedRevision,
expectedContextRevision, expectedPhotoRevision}`. It saves immutable document,
metadata, photo and posting inputs, and creates an independent conversation.
Capture is retry-safe; deleted conversations are not recreated by retry.

Start with `run.offer.start {protocolVersion:2, runId, offerSnapshotId, contextId,
conversationId, capability, input}`. All three ownership fields must match the
snapshot. Live context runs cannot attach to these conversations. The run and
successful result both carry `offerSnapshotId`; results additionally expose
context ID and captured content revision. Persist/export that identity with any
Studio-created artifact.

Task input may contain instructions/options but cannot replace captured CV,
candidate, posting or offer facts. The runtime injects captured facts for
`analyze_offer`, `draft_application`, `generate_evidence_summary` and
`verify_recipient`. Evidence generation still requires captured requirements;
analyze and save the posting before capture if they are absent. Draft/evidence
language defaults to the captured CV language, with explicit overrides allowed.

CV document and index writes are refused in snapshot runs. Evidence retrieval
uses deterministic lexical matching over chunks derived from the captured CV;
it never consults the current context index or requires embeddings. This trades
semantic recall for stable historical evidence. The full captured CV remains
available through document tools. Posting resolution returns the captured posting.
Recipient verification can still make its explicit fresh external corroboration
calls; their results live in the run record and are not promised reproducible.

Resuming snapshot runs reloads the same saved inputs even after live CV edits,
clear, photo changes or posting changes. Missing/mismatched conversations are
rejected. Producing a different CV version for an offer requires a new capture;
existing history is never rebound.

## Next integration checkpoint

Prove load → edit → stale conflict → switch → restore with scoped Studio state.
Then integrate import revision chaining/reset generation, durable proposal restore,
photo inclusion/deletion distinctions and offer artifacts. Complete switching and
rendering race tests before exposing the language switch as a working feature.
