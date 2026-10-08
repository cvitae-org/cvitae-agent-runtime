/**
 * One function in, one envelope out.
 *
 * `dispatch(channel, payload)` is the whole surface. An Electron main process
 * wires it in with four lines and no knowledge of what any channel does:
 *
 *   ipcMain.handle('harness', (_event, channel, payload) =>
 *     dispatch(channel, payload));
 *
 * A websocket server, an HTTP route table and a test all do the same thing with
 * the same call, which is why this file imports no transport. Being callable
 * directly is not a testing convenience — it is the evidence that the transport
 * was never load-bearing.
 *
 * Two properties hold for every channel:
 *
 * **It never rejects.** A failure comes back as `{ ok: false, error }`. A
 * thrown error does not survive a structured clone — the prototype goes, the
 * `code` goes, and the far side gets an empty object where the reason was.
 * Returning it as a value is what lets a window distinguish "needs a
 * credential" from "the page would not load" without reading prose.
 *
 * **It validates first.** Every payload is parsed against its schema before it
 * reaches a store, a run or a decision. See the note in `channels.ts` about who
 * is actually on the other end.
 *
 * The dispatcher owns one piece of state: what it knows about each run it
 * started and has not yet seen finish — the `AbortController`, because a signal
 * does not serialise, and the promise, because a durable row cannot tell a
 * caller the *moment* a run settled. It is per-dispatcher rather than
 * module-level, so two of them in one process — a test and a shell, or two
 * windows — cannot cancel or await each other's work.
 *
 * `run.start` answers with an id and nothing else. It used to await the whole
 * run, which made the id arrive after the work was over and cost the design
 * everything underneath it: events you cannot subscribe to until the run
 * finished are a transcript, not a protocol, and an approval you can only
 * answer after the run returned is not an approval. The outcome is `run.await`,
 * a separate question asked at a different time.
 */

import { CvContextError, DocumentConflictError, RuntimeError, isRunSuspension } from '../../contracts/index.js';
import { OperationError } from '../../contracts/operation-error.js';
import { asCvDocument, normaliseCv } from '../../capabilities/cv/document.js';
import {
  asCvPhotoBody,
  asStorablePhoto,
  emptyPhotoBody,
  CV_PHOTO_ID,
  CV_PHOTO_KIND
} from '../../capabilities/cv/photo.js';
import { all, page } from '../../events/tail.js';
import { planDigestOf } from '../../grounding/index.js';
import type { RunHandle } from '../../runtime/run.js';
import type { RunRecord, RunResult } from '../../contracts/index.js';
import type { Harness } from '../../runtime/create.js';
import {
  failed,
  isChannel,
  ok,
  payloads,
  type Channel,
  type PayloadOf,
  type Response
} from './channels.js';

export type Dispatch = (channel: string, payload?: unknown) => Promise<Response>;

export type DispatchOptions = {
  /** Wall-clock ceiling handed to each run this dispatcher starts. */
  readonly deadlineMs?: number;
  readonly now?: () => number;
};

/**
 * What the dispatcher keeps for a run it started and has not seen finish.
 *
 * The controller because a signal does not cross a transport, so cancelling has
 * to happen on this side of it. The promise because a durable row records that
 * a run ended, not the moment it ended, and a caller waiting on `run.await`
 * wants the moment.
 */
type Active = {
  readonly controller: AbortController;
  readonly settled: Promise<RunResult>;
};

/**
 * How long the run took, from its row.
 *
 * Zero when either end is missing, which is honest about a run that never
 * started. Measuring from `createdAt` instead would report time spent queued as
 * time spent working.
 */
const elapsedOf = (record: RunRecord): number =>
  record.startedAt !== undefined && record.endedAt !== undefined
    ? record.endedAt - record.startedAt
    : 0;

export const createDispatch = (harness: Harness, options: DispatchOptions = {}): Dispatch => {
  const now = options.now ?? Date.now;

  /**
   * In-flight runs, by id. Entries are removed when a run settles, so the map
   * is as long as the number of runs actually executing rather than the number
   * ever started. `run.await` past that point reads the row, which is the
   * durable copy of the same answer.
   */
  const inFlight = new Map<string, Active>();

  /**
   * Files a started run and answers with its id.
   *
   * The `catch` is attached here, now, rather than left to `run.await`. A run
   * failing is an ordinary outcome, and a caller that starts one and never
   * waits for it is an ordinary caller; without a handler the pair produces a
   * process-level unhandled rejection about something that is not a defect.
   * Discarding it does not swallow anything — the original promise stays
   * rejected, so a later `run.await` still receives the error.
   */
  const track = (handle: RunHandle, controller: AbortController): Response => {
    const active: Active = { controller, settled: handle.settled };
    inFlight.set(handle.runId, active);

    void handle.settled
      .catch(() => undefined)
      .finally(() => {
        // Identity-checked: a caller that reuses an id — a mistake, but one it
        // can make — must not have its live entry evicted by the older run.
        if (inFlight.get(handle.runId) === active) inFlight.delete(handle.runId);
      });

    return ok({ runId: handle.runId });
  };

  const started = (): { controller: AbortController; deadline: { deadlineAt?: number } } => ({
    controller: new AbortController(),
    deadline: options.deadlineMs ? { deadlineAt: now() + options.deadlineMs } : {}
  });

  /**
   * A parked run, described the way the live path describes one.
   *
   * The step name comes from the `run.suspended` event, not from the approval
   * row, because `ApprovalRequest` does not carry one — it knows the question,
   * not which step stopped to ask it. The event knows both, and reading the
   * fact beats inferring it from which approval is still pending.
   */
  const parked = (runId: string): Record<string, unknown> => {
    const suspension = all(harness.events, runId).findLast(
      (event) => event.type === 'run.suspended'
    );
    const approvalId = suspension?.data.approvalId;

    return {
      suspended: true,
      runId,
      ...(suspension?.step === undefined ? {} : { step: suspension.step }),
      ...(typeof approvalId === 'string' ? { approvalId } : {})
    };
  };

  /**
   * One handler per channel, each typed against its own schema.
   *
   * A table rather than a switch because `payloads[channel]` is indexed by a
   * union, so narrowing a switch on `channel` does not narrow the parse result
   * and every case would need a cast back to the shape its own schema already
   * describes. Here the mapped type does it: a handler that reads a field its
   * schema does not declare fails to compile.
   */
  type Launch = {
    capability: string;
    input: unknown;
    runId?: string;
    offerSnapshotId?: string;
    contextId?: string;
    contextGeneration?: number;
    contextRevision?: number;
    conversationId?: string;
    approved?: { planDigest: string };
  };

  /** What a run is looked for by, and a preview is made from: everything but the way it is started. */
  const scopeOf = ({ contextId, conversationId, contextGeneration, contextRevision, offerSnapshotId }: Omit<Launch, 'capability' | 'input'>) => ({
    ...(contextId === undefined ? {} : { contextId }),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(offerSnapshotId === undefined ? {} : { offerSnapshotId }),
    ...(contextGeneration === undefined ? {} : { contextGeneration }),
    ...(contextRevision === undefined ? {} : { contextRevision })
  });

  const recovered = ({ capability, input, runId, ...rest }: Launch): Response | undefined => {
    const existing = harness.findRun({ capability, input, ...(runId === undefined ? {} : { runId }), ...scopeOf(rest) });
    return existing ? ok({ runId: existing.id, status: existing.status, recovered: true }) : undefined;
  };

  const start = ({ capability, input, runId, ...rest }: Launch): Response => {
    const { controller, deadline } = started();
    return track(harness.begin({
      capability,
      input,
      ...scopeOf(rest),
      runId: runId ?? crypto.randomUUID(),
      signal: controller.signal,
      ...deadline
    }), controller);
  };

  const launch = (request: Launch): Response => recovered(request) ?? start(request);

  /**
   * A start that names the plan the person approved.
   *
   * A run that already exists is answered first, as it is for any start: a retry
   * of a start that went through must find its run and not be told the plan has
   * moved because the run it began has since changed the record. Then the message
   * is previewed in full, now, and sent only if it is made of what was approved.
   * A message that would be refused is refused with its own reason and not with
   * a conflict, because the person needs to know which of the two it was. No run
   * is made for either.
   *
   * The check and the start are two readings: this protects a person from what
   * changed since they looked, and not from what changes in the instant between
   * the check and the start.
   */
  const approving = async (request: Launch, approved: { planDigest: string }): Promise<Response> => {
    const already = recovered(request);
    if (already) return already;

    const { capability, input, contextId, conversationId, contextGeneration, contextRevision, offerSnapshotId } = request;
    const preview = await harness.preview({
      mode: 'full',
      capability,
      input,
      ...(contextId === undefined ? {} : { contextId }),
      ...(conversationId === undefined ? {} : { conversationId }),
      ...(offerSnapshotId === undefined ? {} : { offerSnapshotId }),
      ...(contextGeneration === undefined ? {} : { contextGeneration }),
      ...(contextRevision === undefined ? {} : { contextRevision })
    });

    if (preview.refusal) return failed(preview.refusal.code, preview.refusal.message);
    if (preview.planDigest !== approved.planDigest) {
      return failed(
        'plan_conflict',
        'What this message would be made of is not what was approved. Preview it again.',
        { planDigest: preview.planDigest }
      );
    }

    return start(request);
  };

  const launching = (request: Launch): Promise<Response> | Response =>
    request.approved === undefined ? launch(request) : approving(request, request.approved);

  const handlers: { [C in Channel]: (input: PayloadOf<C>) => Promise<Response> | Response } = {
    'capabilities.list': () =>
      ok(
        Object.values(harness.capabilities).map((capability) => ({
          name: capability.name,
          describe: capability.describe
        }))
      ),

    'browser.internal.dispatch': async ({sessionId,method,payload,targetSearchId}) => ok(await harness.browser.dispatch('studio:'+sessionId,method,payload,targetSearchId)),
    'browser.status': () => ok(harness.browser.status()),
    'browser.configure': async ({enabled}) => ok(await harness.browser.configure(enabled)),
    'browser.poll': ({after}) => ok(harness.browser.store.poll(after)),
    'browser.collection': () => ok(harness.browser.store.collection()),
    'protocol.get': () => ok({ version: 2, features: ['cv-contexts', 'checked-writes', 'durable-proposals', 'context-copy', 'offer-snapshot-runs', 'board-workspaces-v1', 'board-application-agent-v1', 'browser-companion-v1', 'studio-browser-v1', 'discovery-board-threads-v1', 'provider-connection-test-v1', 'grounding-record', 'grounding-selection', 'grounding-history', 'grounding-assembly', 'grounding-budget', 'grounding-preview', 'grounding-offers', 'grounding-edits', 'grounding-compaction', 'masking', 'masking-detectors', 'masking-embedding', 'masking-strict', 'masking-terms', 'masking-counts', 'cv-contact'], languages: ['pl', 'en'] }),
    'board.application.start': request => ok(harness.applicationAgent.start(request)),
    'board.application.observe': async request => ok(await harness.applicationAgent.observe(request)),
    'board.application.report': request => ok(harness.applicationAgent.report(request)),
    'board.application.control': request => ok(harness.applicationAgent.control(request)),
    'board.entries.list': () => ok(harness.board.list()),
    'board.entries.get': ({entryId}) => ok(harness.board.requireEntry(entryId)),
    'board.entries.add': request => ok(harness.board.add(request)),
    'board.entries.importLegacy': request => ok(harness.board.importLegacy(request)),
    'board.entries.drop': request => ok(harness.board.drop(request)),
    'board.poll': ({after}) => ok(harness.board.poll(after)),
    'board.preparation.control': request => ok(harness.board.control(request)),
    'board.context.configure': request => ok(harness.board.configure(request)),
    'board.summary.update': request => ok(harness.board.updateSummary(request)),
    'board.answers.save': request => ok(harness.board.saveAnswers(request)),
    'board.notes.add': request => ok(harness.board.addNote(request)),
    'board.stage.set': request => ok(harness.board.setStage(request)),
    'board.submissions.record': request => ok(harness.board.recordSubmission(request)),
    'board.artifacts.put': request => ok(harness.board.putArtifact(request)),
    'board.artifacts.get': ({entryId,artifactId}) => ok(harness.board.artifact(entryId,artifactId)),
    'profile.contexts.create': ({ id, language }) => ok({ context: harness.cvContexts.create(id, language) }),
    'profile.contexts.assignLanguage': ({ contextId, language, expectedRevision }) => ok({ context: harness.cvContexts.assignLanguage(contextId, language, expectedRevision) }),
    'profile.contexts.copy': ({ id, language, sourceContextId, expectedSourceRevision }) => ok(harness.cvCopies.copy({ id, language, sourceContextId, expectedSourceRevision })),
    'profile.contexts.provenance': ({ contextId }) => { harness.profile.readContext(contextId); return ok(harness.cvCopies.get(contextId)?.provenance ?? null); },
    'run.offer.start': launching,
    'profile.contexts.list': () => ok({ contexts: harness.cvContexts.list() }),
    'profile.context.reindex': ({ contextId }) => {
      harness.profile.readContext(contextId);
      harness.indexRecovery.enqueue(contextId);
      return ok({ pending: harness.indexRecovery.status(contextId) ?? null, indexed: harness.indexRecovery.indexed(contextId) });
    },
    'profile.context.indexStatus': ({ contextId }) => {
      harness.profile.readContext(contextId);
      return ok({ pending: harness.indexRecovery.status(contextId) ?? null, indexed: harness.indexRecovery.indexed(contextId) });
    },
    'profile.context.clearContent': ({ contextId, expectedRevision, operationId }) =>
      ok(harness.cvLifecycle.clearContent(contextId, expectedRevision, operationId)),
    'profile.proposals.list': ({ contextId }) => ok({ proposals: harness.cvLifecycle.list(contextId) }),
    'profile.proposals.accept': ({ contextId, proposalId }) =>
      ok({ record: harness.cvLifecycle.accept(contextId, proposalId) }),
    'profile.proposals.discard': ({ contextId, proposalId }) =>
      ok({ proposal: harness.cvLifecycle.discard(contextId, proposalId) }),

    'profile.context.get': ({ contextId }) => {
      const { context, record } = harness.profile.readContext(contextId);
      return ok({
        context,
        present: record !== undefined,
        record: record ? { ...record, body: asCvDocument(record.body) } : null
      });
    },

    'profile.context.update': ({ contextId, document, expectedRevision, operationId }) => {
      const updated = harness.profile.replaceContext(contextId, normaliseCv(document), expectedRevision, operationId);
      return ok({
        context: updated.context,
        present: true,
        record: { ...updated.record, body: asCvDocument(updated.record.body) },
        clearedChunks: updated.clearedChunks
      });
    },

    'profile.get': () => {
      const record = harness.profile.read();

      if (!record) return ok({ present: false, record: null });

      // `asCvDocument` rather than a bare parse: it backfills the skills strip's
      // named rows for a body stored before they existed, so a client never has
      // to guess at what the three legacy arrays were called.
      return ok({
        present: true,
        record: { ...record, body: asCvDocument(record.body) }
      });
    },

    'profile.update': ({ document }) => {
      // Normalised before it is stored, not after it is read back. The channel's
      // schema has already accepted whatever the client sent — `groups` alone, the
      // three arrays alone, or both disagreeing — and exactly one of those is the
      // document. Deciding here means the stored body is the decided one, so a
      // reader that bypasses `profile.get` sees the same CV.
      const updated = harness.profile.replace(normaliseCv(document));

      return ok({
        present: true,
        record: {
          ...updated.record,
          body: asCvDocument(updated.record.body)
        },
        clearedChunks: updated.clearedChunks
      });
    },

    // Through `harness.documents` rather than `harness.profile`, and that is the
    // point of writing it out: `profile.replace` also clears the retrieval
    // chunks for the CV, which is right for text somebody rewrote and wrong for
    // a picture. A photograph has nothing to retrieve, so a write that dropped
    // the index would make the next `ask_profile` re-embed the whole CV to
    // answer a question the portrait had no part in.
    'offers.list': ({ limit }) => ok({ offers: harness.offers.recent(limit) }),
    'offers.get': ({ id }) => ok({ offer: harness.offers.get(id) ?? null }),
    'opportunities.resolve': ({ids}) => ok(harness.opportunities.resolve(ids)),
    'opportunities.link': ({offerId,otherOfferId}) => ok(harness.opportunities.link(offerId,otherOfferId)),
    'opportunities.separate': ({offerId}) => ok(harness.opportunities.separate(offerId)),
    'opportunities.candidates': ({offerId,term}) => ok({items:harness.opportunities.candidates(offerId,term)}),
    'offers.query.opportunities': ({ownerSearchId,executionId,cursor,limit}) => ok(harness.offerQueries.opportunities(ownerSearchId,executionId,cursor,limit)),
    'offers.query.schema': () => ok(harness.offerQueries.schema()),
    'offers.query.context': async ({ownerSearchId,scope}) => ok(await harness.offerQueries.context(ownerSearchId,scope)),
    'offers.query.document': ({ownerSearchId}) => ok(harness.offerQueries.document(ownerSearchId)),
    'offers.query.save': input => ok(harness.offerQueries.save(input)),
    'offers.query.validate': async input => ok(await harness.offerQueries.validate(input)),
    'offers.query.start': input => ok(harness.offerQueries.start(input)),
    'offers.query.get': ({ownerSearchId,executionId}) => ok(harness.offerQueries.get(ownerSearchId,executionId)),
    'offers.query.page': ({ownerSearchId,executionId,cursor,limit}) => ok(harness.offerQueries.page(ownerSearchId,executionId,cursor,limit)),
    'offers.query.cancel': async ({ownerSearchId,executionId}) => ok(await harness.offerQueries.cancel(ownerSearchId,executionId)),
    'offers.query.release': ({ownerSearchId,executionId}) => ok(harness.offerQueries.release(ownerSearchId,executionId)),
    'discovery.searches.createBatch': (input) => ok(harness.discoverySearches.createBatch(input)),
    'discovery.searches.import.begin': (input) => ok(harness.discoverySearches.begin(input)),
    'discovery.searches.import.append': (input) => ok(harness.discoverySearches.append(input)),
    'discovery.searches.import.finish': (input) => ok(harness.discoverySearches.finish(input)),
    'discovery.searches.filters': ({ id, filters, revision }) => ok(harness.discoverySearches.filters(id,filters,revision)),
    'discovery.chat.get': ({ searchId, before }) => ok(harness.discoveryChat.get(searchId,before)),
    'discovery.chat.start': (request) => ok(harness.discoveryChat.send(request)),
    'discovery.chat.cancel': ({ searchId, runId }) => { harness.discoveryChat.cancel(searchId,runId); return ok({ cancelled: true }); },
    'discovery.searches.list': ({ limit, offset }) => ok(harness.discoverySearches.list(limit, offset)),
    'discovery.searches.offer': ({ id, offerId, group }) => ok(harness.discoverySearches.offer(id,offerId,group)),
    'discovery.searches.read': (input) => ok(harness.discoverySearches.read(input)),
    'discovery.offers.manage': ({ id, offerIds, action }) => ok(harness.discoverySearches.manage(id,offerIds,action)),
    'discovery.offers.managed': ({ id }) => ok(harness.discoverySearches.managed(id)),
    'discovery.searches.delete': async ({ id }) => { await harness.offerQueries.deleteSearch(id); harness.discovery.cancelSearch(id); harness.discoveryChat.delete(id); return ok({ deleted: harness.discoverySearches.delete(id) }); },
    'discovery.browserSearch': async ({board, keyword}) => ok(await harness.discovery.browserSearch(board, keyword)),
    'discovery.boards': async () => ok(await harness.discovery.boards()),
    'offers.note.get': ({ offerId }) => ok({ note: harness.offerNotes.get(offerId) }),
    'offers.note.save': ({ offerId, text, revision }) => ok({ note: harness.offerNotes.save(offerId, text, revision) }),
    'discovery.details.auto.enqueue': ({ searchId, offerIds }) => { harness.detailQueue.enqueue(searchId,offerIds.filter(id=>!harness.discoverySearches.suppressed(searchId,id))); return ok({ queued:true }); },
    'discovery.details.auto.poll': ({ after }) => ok(harness.detailQueue.poll(after)),
    'discovery.details.auto.pause': ({ paused }) => { harness.detailQueue.pause(paused); return ok({ paused }); },
    'discovery.details.auto.stop': () => { harness.detailQueue.stop(); return ok({ paused:true }); },
    'discovery.details.auto.clear': () => { harness.detailQueue.clear(); return ok({ cleared:true }); },
    'discovery.details.start': ({ offerId, force }) => ok({ enrichment: harness.enrichment.details.start(offerId, force) }),
    'discovery.details': ({ offerId }) => ok(harness.enrichment.get(offerId)),
    'discovery.details.cancel': ({ offerId }) => { harness.enrichment.details.cancel(offerId); return ok(harness.enrichment.get(offerId)); },
    'discovery.enrich': ({ offerId, force, refreshDetails }) => ok({ enrichment: harness.enrichment.start(offerId, force, refreshDetails) }),
    'discovery.enrichment': ({ offerId }) => { const result=harness.enrichment.get(offerId); if (result.enrichment && ['succeeded','partial'].includes(result.enrichment.status)) harness.discoverySearches.refreshOffer(result.offer,result.enrichment); return ok(result); },
    'discovery.enrichment.cancel': ({ offerId }) => { harness.enrichment.cancel(offerId); return ok({ cancelled: true }); },
    'discovery.cached': (query) => ok(harness.discovery.cached(query)),
    'discovery.start': async (query) => {
      if (query.searchId) {
        try {
          if (harness.discoverySearches.get(query.searchId).boardThread?.mode === 'browser') throw new OperationError('browser_capture_required', 'Open this search in Cvitae Browser to import jobs.');
        } catch (error) { if (!(error instanceof OperationError) || error.code !== 'search_not_found') throw error; }
      }
      const boards = query.refetch && query.searchId ? harness.discoverySearches.get(query.searchId).boards : query.boards;
      harness.discovery.validateFilters(boards, query.workMode);
      // Refresh live availability before validation, and before changing saved-search state.
      // A scraper that restarted must not remain disabled by an earlier health snapshot.
      if (query.sourceMode !== 'cache' || query.refetch) {
        await harness.discovery.boards();
        harness.discovery.validateBoards(boards);
      }
      if (query.refetch && query.searchId) {
        harness.discoverySearches.get(query.searchId);
        harness.discoveryChat.delete(query.searchId);
        harness.discovery.cancelSearch(query.searchId);
        await harness.offerQueries.deleteSearch(query.searchId);
        await harness.detailQueue.cancelSearch(query.searchId);
      }
      return ok(harness.discovery.start(query));
    },
    'discovery.poll': ({ id, after }) => ok(harness.discovery.poll(id, after)),
    'discovery.next': ({ id, board }) => { harness.discovery.next(id, board); return ok({ accepted: true }); },
    'discovery.cancel': ({ id }) => { harness.discovery.cancel(id); return ok({ cancelled: true }); },
    'offers.snapshots.capture': (request) => ok(harness.offerSnapshots.capture(request)),
    'offers.snapshots.get': ({ id }) => ok(harness.offerSnapshots.get(id) ?? null),
    'offers.snapshots.list': ({ offerId, contextId }) => ok(harness.offerSnapshots.list(offerId, contextId)),
    'profile.photoAsset.get': () => ok(harness.photos.asset()),
    'profile.photoAsset.replace': ({ photo, expectedRevision, operationId }) =>
      ok(harness.photos.replace(photo, expectedRevision, operationId)),
    'profile.context.photo.get': ({ contextId }) => ok(harness.photos.snapshot(contextId)),
    'profile.context.photo.include': ({ contextId, includePhoto, expectedRevision, operationId }) =>
      ok(harness.photos.include(contextId, includePhoto, expectedRevision, operationId)),
    'profile.photo.get': () =>
      ok(asCvPhotoBody(harness.documents.read(CV_PHOTO_ID)?.body)),

    'profile.photo.set': ({ photo }) => {
      harness.profile.read(); // Reject ambiguous legacy mutations once another context exists.
      const record = harness.documents.update(CV_PHOTO_ID, CV_PHOTO_KIND, () => ({
        photo: asStorablePhoto(photo)
      }));

      return ok(asCvPhotoBody(record.body));
    },

    'profile.photo.clear': () => {
      harness.profile.read();
      const record = harness.documents.update(
        CV_PHOTO_ID,
        CV_PHOTO_KIND,
        emptyPhotoBody
      );

      return ok(asCvPhotoBody(record.body));
    },

    'run.start': launch,
    'run.context.start': launching,

    'run.preview': async (request) => ok(await harness.preview(request)),

    'run.resume': ({ runId }) => {
      const { controller, deadline } = started();

      return track(
        harness.beginResume({ runId, signal: controller.signal, ...deadline }),
        controller
      );
    },

    'run.await': async ({ runId }) => {
      const active = inFlight.get(runId);

      // The promise says *when*, and nothing else. What the run produced —
      // including how it went wrong, and the fact that it stopped to ask — is
      // already in the row by the time this resolves, so the answer is built
      // from the row on both paths. Two describers, one reading a settled
      // `RunResult` and one reading a record, is how a caller that happened to
      // be waiting and a caller that arrives an hour later end up being told
      // subtly different things about the same run.
      if (active) await active.settled.catch(() => undefined);

      const record = harness.runs.get(runId);

      if (!record) return failed('not_found', `No such run: ${runId}`);

      switch (record.status) {
        case 'succeeded':
          // `outcomes` — the value each step produced — is deliberately not
          // here. A step's value can be a whole document, so an envelope
          // carrying every one of them is the aggregated answer plus its raw
          // materials, sent twice, over a transport that has to serialise both.
          // `runs.get` serves the steps to a caller that wants them.
          return ok({
            runId: record.id,
            capability: record.capability,
            data: record.result ?? {},
            degraded: record.degraded,
            elapsedMs: elapsedOf(record)
          });

        case 'failed':
          return failed(
            record.errorCode ?? 'step_failed',
            record.errorMessage ?? 'The run failed without recording a reason.'
          );

        case 'cancelled':
          return failed('aborted', 'The run was cancelled.');

        case 'suspended':
          return ok(parked(runId));

        default:
          // Queued or running, and not by this dispatcher. A run belongs to
          // whoever picked it up; promising to wait for one this process is not
          // executing is a promise nothing here could keep, and saying so lets
          // a caller go and read the run instead of blocking on it.
          return failed(
            'not_running_here',
            `Run ${runId} is "${record.status}" but is not executing in this process.`
          );
      }
    },

    'run.cancel': ({ runId }) => {
      const active = inFlight.get(runId);

      // Not an error, and not silently true either. A run this dispatcher did
      // not start is not its to cancel, and a caller that is told so can go and
      // look at the run rather than believing it stopped.
      if (!active) {
        if (harness.cancelSuspended(runId)) return ok({ cancelled: true });
        return ok({ cancelled: false, reason: 'not running here' });
      }

      active.controller.abort(new RuntimeError('The run was cancelled.', 'aborted'));
      return ok({ cancelled: true });
    },

    'runs.list': (filter) => ok(harness.runs.list(filter)),

    'runs.get': ({ runId }) => {
      const record = harness.runs.get(runId);

      if (!record) return failed('not_found', `No such run: ${runId}`);

      return ok({ run: record, steps: harness.runs.steps(runId) });
    },

    'runs.grounding': ({ runId }) => {
      if (!harness.runs.get(runId)) return failed('not_found', `No such run: ${runId}`);

      const record = harness.groundingRecords.read(runId);

      // Two different absences. A run that has no conversation has nothing to be
      // grounded in and no record, and a caller that is told "no such run" for
      // it would go looking for a typo in the id.
      if (!record) return failed('not_found', `Run ${runId} has no record of what it was given.`);

      return ok({ record, planDigest: planDigestOf(record.entries) });
    },

    'runs.events': ({ runId, after, limit }) => {
      if (!harness.runs.get(runId)) return failed('not_found', `No such run: ${runId}`);

      // A page when the caller is following along, the whole log when it asked
      // for everything. `all` pages internally rather than trusting a single
      // `since` call to have returned the lot.
      if (after === undefined && limit === undefined) {
        const events = all(harness.events, runId);
        const last = events[events.length - 1];
        return ok({ events, cursor: last ? last.seq : 0, caughtUp: true });
      }

      return ok(page(harness.events, runId, after ?? 0, limit ?? 200));
    },

    'approvals.pending': ({ runId }) => ok(harness.approvals.pending(runId)),

    'approvals.decide': ({ approvalId, status, decision }) => {
      // Recording the answer only. Resuming is a second call, because a person
      // answering and a run continuing are two things a caller may well want to
      // separate — answer three questions, then resume once.
      harness.approvals.decide(approvalId, {
        status,
        decision: decision ?? {},
        decidedAt: now()
      });

      return ok({ approvalId, status });
    },

    'directories.list': () => ok(harness.integrationDirectories.list()),
    'directories.save': input => ok(harness.integrationDirectories.save(input)),
    'directories.remove': ({id}) => ok(harness.integrationDirectories.remove(id)),
    'directories.search': async input => ok(await harness.integrationDirectories.search(input)),
    'directories.inspect': async input => ok(await harness.integrationDirectories.inspect(input)),
    'integrations.list': () => ok(harness.integrations.list()),
    'integrations.inspect': async (input) => ok(await harness.integrations.inspect(input)),
    'integrations.save': (input) => ok(harness.integrations.save(input)),
    'integrations.configure': (input) => ok(harness.integrations.configure(input)),
    'integrations.enabled': ({id,enabled}) => ok(harness.integrations.enabled(id,enabled)),
    'integrations.secret': ({id,token}) => ok(harness.integrations.secret(id,token)),
    'integrations.refresh': async ({id}) => ok(await harness.integrations.refresh(id)),
    'integrations.remove': async ({id}) => ok(await harness.integrations.remove(id)),
    'integrations.icon': async ({sourceKey}) => ok(await harness.integrations.icon(sourceKey)),

    'settings.get': () => ok({ settings: harness.settings.read() }),

    /**
     * `null` and absent both mean "not configured", and the runtime's type says
     * `undefined`. Collapsing them here keeps one meaning of "unset" past the
     * boundary instead of two that behave the same until someone compares them.
     */
    'settings.set': ({ settings }) =>
      ok({
        settings: harness.settings.write({
          providerId: settings.providerId ?? undefined,
          modelId: settings.modelId ?? undefined,
          localBaseUrl: settings.localBaseUrl ?? undefined,
          embeddingProviderId: settings.embeddingProviderId ?? undefined,
          embeddingModelId: settings.embeddingModelId ?? undefined,
          maskMode: settings.maskMode === undefined ? harness.settings.read().maskMode : (settings.maskMode ?? undefined),
          maskScope: settings.maskScope === undefined ? harness.settings.read().maskScope : (settings.maskScope ?? undefined)
        })
      }),

    /**
     * The reply names the provider and never the key.
     *
     * Not squeamishness: this envelope is bound for somewhere else, may be
     * logged by whatever is holding it, and the caller already knows what it
     * sent. Echoing a credential adds a copy of it to somebody's transcript in
     * exchange for nothing.
     */
    'secrets.set': ({ providerId, apiKey }) => {
      harness.settings.secret(providerId, apiKey);
      return ok({ providerId, configured: true });
    },

    'secrets.clear': ({ providerId }) => {
      harness.settings.secret(providerId, undefined);
      return ok({ providerId, configured: false });
    },

    'providers.test': async ({ settings, keys }) => ok(await harness.settings.test({
      settings: {
        providerId: settings.providerId ?? undefined,
        modelId: settings.modelId ?? undefined,
        localBaseUrl: settings.localBaseUrl ?? undefined,
        embeddingProviderId: settings.embeddingProviderId ?? undefined,
        embeddingModelId: settings.embeddingModelId ?? undefined
      },
      ...(keys ? { keys } : {})
    })),

    'providers.status': async ({ settings, keys }) => ok(await harness.settings.status(
      settings ? {
        settings: {
          providerId: settings.providerId ?? undefined,
          modelId: settings.modelId ?? undefined,
          localBaseUrl: settings.localBaseUrl ?? undefined,
          embeddingProviderId: settings.embeddingProviderId ?? undefined,
          embeddingModelId: settings.embeddingModelId ?? undefined
        },
        ...(keys ? { keys } : {})
      } : undefined
    )),

    'conversations.list': ({ subject }) =>
      ok({ conversations: harness.conversations.list(subject) }),

    'conversations.open': ({ subject }) =>
      ok({ conversation: harness.conversations.open(subject) }),

    'conversations.create': ({ subject }) =>
      ok({ conversation: harness.conversations.create(subject) }),

    'conversations.get': ({ conversationId }) => {
      const found = harness.conversations.read(conversationId);

      if (!found) return failed('not_found', `No such conversation: ${conversationId}`);

      return ok(found);
    },

    'conversations.append': ({ conversationId, message }) => {
      // Both checked here rather than left to the foreign keys, which answer a
      // client appending to a conversation it has just deleted — or naming a
      // run from a database that has since been replaced — with
      // "FOREIGN KEY constraint failed" and no hint as to which one.
      if (!harness.conversations.read(conversationId)) {
        return failed('not_found', `No such conversation: ${conversationId}`);
      }

      if (message.runId !== undefined && !harness.runs.get(message.runId)) {
        return failed('not_found', `No such run: ${message.runId}`);
      }

      return ok({ message: harness.conversations.append(conversationId, message) });
    },

    'conversations.rename': ({ conversationId, title }) => {
      const renamed = harness.conversations.rename(conversationId, title);

      if (!renamed) return failed('not_found', `No such conversation: ${conversationId}`);

      return ok({ conversation: renamed });
    },

    'conversations.summarise': ({ conversationId, summary, through }) => {
      const noted = harness.conversations.summarise(conversationId, summary, through);

      if (!noted) return failed('not_found', `No such conversation: ${conversationId}`);

      return ok({ conversation: noted });
    },

    'conversations.compactPlan': ({ conversationId, keep }) => {
      const plan = harness.compaction.plan(conversationId, keep);

      if (!plan) return failed('not_found', `No such conversation: ${conversationId}`);

      return ok(plan);
    },

    'conversations.delete': ({ conversationId }) =>
      ok({ deleted: harness.conversations.delete(conversationId) }),

    'selection.get': ({ conversationId }) => {
      const view = harness.selection.get(conversationId);

      if (!view) return failed('not_found', `No such conversation: ${conversationId}`);

      return ok(view);
    },

    'selection.update': ({ conversationId, expectedRevision, exclude, clear, pin, unpin }) => {
      const result = harness.selection.update(conversationId, { expectedRevision, exclude, clear, pin, unpin });

      if (!result) return failed('not_found', `No such conversation: ${conversationId}`);

      // Nothing was written. What is current comes back with the refusal, so the
      // caller reloads from the answer and does not have to ask again.
      if (!result.applied) {
        return failed('selection_conflict', 'The selection changed since it was read. Reload it and try again.', {
          revision: result.view.revision,
          exclusions: result.view.exclusions,
          pins: result.view.pins
        });
      }

      return ok(result.view);
    },

    'limits.get': ({ conversationId }) => {
      const view = harness.limits.get(conversationId);

      if (!view) return failed('not_found', `No such conversation: ${conversationId}`);

      return ok(view);
    },

    'limits.set': ({ conversationId, context }) => {
      const view = harness.limits.set(conversationId, context);

      if (!view) return failed('not_found', `No such conversation: ${conversationId}`);

      return ok(view);
    },

    'masking.terms.get': () => ok({ terms: harness.maskTerms.read(), declared: harness.maskTerms.declared() }),

    'masking.terms.set': ({ terms }) => ok({ terms: harness.maskTerms.set(terms), declared: harness.maskTerms.declared() })
  };

  const handle = async (channel: Channel, payload: unknown): Promise<Response> => {
    const parsed = payloads[channel].safeParse(payload ?? {});

    if (!parsed.success) {
      if(channel.startsWith('offers.query.')) return failed(parsed.error.issues.some(i=>i.path[0]==='schemaVersion')?'query_schema_mismatch':'query_invalid_params','Invalid query request. Check the schema version, scope, parameters and limits.');
      return failed(
        'invalid_input',
        `Bad payload for "${channel}": ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`
      );
    }

    // The one cast in the file, and it is the dispatch itself: the table's key
    // and its value type vary together, which is a relationship an index
    // signature cannot express.
    const handler = handlers[channel] as (input: unknown) => Promise<Response> | Response;

    return handler(parsed.data);
  };

  return async (channel, payload) => {
    if (!isChannel(channel)) return failed('unknown_channel', `No such channel: "${channel}".`);

    try {
      return await handle(channel, payload);
    } catch (error) {
      // A suspended run is not a failed one. It is parked, the state is saved,
      // and a caller told this can go and read the question.
      if (isRunSuspension(error)) {
        return ok({ suspended: true, runId: error.runId, step: error.step, approvalId: error.approvalId });
      }

      if (error instanceof DocumentConflictError) {
        return failed(error.code, error.message, {
          contextId: error.documentId,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision
        });
      }
      if (error instanceof CvContextError) return failed(error.code, error.message, error.details);
      if (error instanceof RuntimeError) return failed(error.code, error.message);
      if (error instanceof OperationError) return failed(error.code, error.message);

      // Message only. An unexpected error's stack names paths on this machine,
      // and this envelope is bound for somewhere else.
      if(channel.startsWith('offers.query.')) return failed('query_failed','The query request could not be completed.');
      return failed('internal', String((error as Error)?.message ?? error));
    }
  };
};
