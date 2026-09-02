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
 * The dispatcher owns one piece of state: the `AbortController` for each run it
 * started. That is what makes `run.cancel` possible at all, since a signal does
 * not serialise. It is per-dispatcher rather than module-level, so two of them
 * in one process — a test and a shell, or two windows — cannot cancel each
 * other's work.
 */

import { RuntimeError, isRunSuspension } from '../../contracts/index.js';
import { cvDocumentSchema } from '../../capabilities/cv/document.js';
import { all, page } from '../../events/tail.js';
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

export const createDispatch = (harness: Harness, options: DispatchOptions = {}): Dispatch => {
  const now = options.now ?? Date.now;

  /**
   * In-flight runs, by id. Entries are removed in a `finally`, so a run that
   * throws does not leave a controller behind — the map is as long as the
   * number of runs actually executing, not the number ever started.
   */
  const inFlight = new Map<string, AbortController>();

  const start = async (
    runId: string,
    execute: (signal: AbortSignal) => Promise<unknown>
  ): Promise<Response> => {
    const controller = new AbortController();
    inFlight.set(runId, controller);

    try {
      return ok(await execute(controller.signal));
    } finally {
      inFlight.delete(runId);
    }
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
      // The id has to exist before the run does, so `run.cancel` and
      // `runs.events` have something to name while it is still going.
      const id = runId ?? crypto.randomUUID();

      return start(id, (signal) =>
        harness.run({
          capability,
          input,
          runId: id,
          signal,
          ...(options.deadlineMs ? { deadlineAt: now() + options.deadlineMs } : {})
        })
      );
    },

    'run.resume': ({ runId }) =>
      start(runId, (signal) =>
        harness.resume({
          runId,
          signal,
          ...(options.deadlineMs ? { deadlineAt: now() + options.deadlineMs } : {})
        })
      ),

    'run.cancel': ({ runId }) => {
      const controller = inFlight.get(runId);

      // Not an error, and not silently true either. A run this dispatcher did
      // not start is not its to cancel, and a caller that is told so can go and
      // look at the run rather than believing it stopped.
      if (!controller) return ok({ cancelled: false, reason: 'not running here' });

      controller.abort(new RuntimeError('The run was cancelled.', 'aborted'));
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
    }
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
