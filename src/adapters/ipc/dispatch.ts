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

import { RuntimeError, isRunSuspension } from '../../contracts/index.js';
import { cvDocumentSchema } from '../../capabilities/cv/document.js';
import { all, page } from '../../events/tail.js';
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
  const handlers: { [C in Channel]: (input: PayloadOf<C>) => Promise<Response> | Response } = {
    'capabilities.list': () =>
      ok(
        Object.values(harness.capabilities).map((capability) => ({
          name: capability.name,
          describe: capability.describe
        }))
      ),

    'profile.get': () => {
      const record = harness.profile.read();

      if (!record) return ok({ present: false, record: null });

      return ok({
        present: true,
        record: { ...record, body: cvDocumentSchema.parse(record.body) }
      });
    },

    'profile.update': ({ document }) => {
      const updated = harness.profile.replace(document);

      return ok({
        present: true,
        record: {
          ...updated.record,
          body: cvDocumentSchema.parse(updated.record.body)
        },
        clearedChunks: updated.clearedChunks
      });
    },

    'run.start': ({ capability, input, runId }) => {
      const { controller, deadline } = started();

      // `begin` creates the row and returns before the work is done, so by the
      // time this answers there is a run to cancel and events to read. It still
      // throws *here* for an unknown capability or bad input, which is right:
      // neither ever became a run, and handing back an id for one would be a
      // lie a caller then has to discover by asking about it.
      return track(
        harness.begin({
          capability,
          input,
          runId: runId ?? crypto.randomUUID(),
          signal: controller.signal,
          ...deadline
        }),
        controller
      );
    },

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
      if (!active) return ok({ cancelled: false, reason: 'not running here' });

      active.controller.abort(new RuntimeError('The run was cancelled.', 'aborted'));
      return ok({ cancelled: true });
    },

    'runs.list': (filter) => ok(harness.runs.list(filter)),

    'runs.get': ({ runId }) => {
      const record = harness.runs.get(runId);

      if (!record) return failed('not_found', `No such run: ${runId}`);

      return ok({ run: record, steps: harness.runs.steps(runId) });
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
          embeddingModelId: settings.embeddingModelId ?? undefined
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

    'providers.status': async () => ok(await harness.settings.status())
  };

  const handle = async (channel: Channel, payload: unknown): Promise<Response> => {
    const parsed = payloads[channel].safeParse(payload ?? {});

    if (!parsed.success) {
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

      if (error instanceof RuntimeError) return failed(error.code, error.message);

      // Message only. An unexpected error's stack names paths on this machine,
      // and this envelope is bound for somewhere else.
      return failed('internal', String((error as Error)?.message ?? error));
    }
  };
};
