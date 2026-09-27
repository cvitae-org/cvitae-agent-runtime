/**
 * The runtime as a child process.
 *
 * This is the front door the repo did not have. `adapters/ipc/` is a table of
 * channels and a function that answers them, and it deliberately imports no
 * transport — but a Flutter app cannot call a TypeScript function, so until
 * something actually served that table, none of it was reachable. This is that
 * something: a read loop over stdin, `createDispatch` behind it, and stdout as
 * the one stream frames go out on.
 *
 * The interesting half is what it adds that `dispatch` cannot. A dispatcher
 * answers questions. A run, though, has things to say that nobody asked for —
 * a step started, a step degraded, a paragraph is being written right now — and
 * a client that had to ask would either poll (latency, and load in proportion
 * to how many windows are open) or find out at the end (which is not progress,
 * it is a summary). So the host pushes, and both push frames are unsolicited:
 * `event` for the durable log, `delta` for prose that is never written down.
 *
 * Events reach here by tailing, not by a hook. `page()` from `events/tail.ts`
 * takes a cursor and returns what came after it, which is the same call a
 * client uses to reconnect — so the pump has no privileged path, and a bug in
 * it cannot produce a frame a reader could not also have fetched. The poll
 * interval lives here because it is a display policy: this process is not the
 * only writer of that database, and how often to look is a property of who is
 * looking.
 *
 * Two ordering properties hold, and both are worth stating because a client
 * will rely on them:
 *
 * **A reply to `run.start` is written before any frame about that run.** The
 * run is only watched once its id has gone out, so a client can attach a
 * handler on receipt of the id without racing the first event.
 *
 * **Frames for one run arrive in `seq` order with no gaps.** The pump advances
 * a cursor and never skips, so a client that sees seq 7 after seq 5 has found
 * a bug here rather than a dropped write.
 *
 * What this file must never do is reach mail. See `no-stdio-wraps-mail`: a
 * channel served over a pipe is one step further from trusted than an IPC
 * channel, and the argument is the one from `no-tool-wraps-mail` — scraped
 * offer text lands in model context, and an outbound channel near it is an
 * exfiltration path with a plausible cover story.
 */

import { createInterface } from 'node:readline';
import { createDispatch } from '../ipc/dispatch.js';
import { page } from '../../events/tail.js';
import {
  PROTOCOL_VERSION,
  RUNTIME_VERSION,
  failed,
  parseRequest,
  validateUploadBudget,
  type Frame,
  type Request
} from './protocol.js';
import type { RunEventType, StepDelta } from '../../contracts/index.js';
import type { Harness } from '../../runtime/create.js';

/**
 * How often the pump looks for new events, while any run is going.
 *
 * Small because the writer is this same process and the read is one indexed
 * query per active run — the cost is real but tiny, and the thing being bought
 * is the difference between a UI that feels attached to the work and one that
 * feels like it is guessing. The timer exists only while something is running.
 */
const POLL_MS = 25;

/** How long `bridge.shutdown` waits for in-flight work before answering anyway. */
const DRAIN_MS = 5_000;

/**
 * The event types after which a run has nothing more to say for now.
 *
 * `run.suspended` is here with the three real endings, because a parked run is
 * as quiet as a finished one and stays that way until someone answers its
 * question. `run.resume` starts watching it again, from the cursor it left off
 * at, so nothing is replayed and nothing is missed.
 */
const QUIET: ReadonlySet<RunEventType> = new Set<RunEventType>([
  'run.succeeded',
  'run.failed',
  'run.cancelled',
  'run.suspended'
]);

export type HostOptions = {
  /**
   * Builds the runtime, given the sink its deltas should go to.
   *
   * A factory rather than a `Harness`, because the harness needs the sink and
   * the sink needs the host: taking one already built would leave the caller
   * holding a `let host` and a `host?.` to close the loop. Handing over the
   * construction closes it here, once, where the wiring is visible.
   */
  readonly open: (deltas: (delta: StepDelta & { readonly runId: string }) => void) => Harness;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  /** Where anything that is not a frame goes. Never stdout. */
  readonly log?: (line: string) => void;
  readonly pollMs?: number;
};

export type Host = {
  /** Resolves once the input has ended and everything has been drained. */
  readonly closed: Promise<void>;
};

export const createHost = (options: HostOptions): Host => {
  const log = options.log ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const pollMs = options.pollMs ?? POLL_MS;

  const write = (frame: Frame): void => {
    options.output.write(`${JSON.stringify(frame)}\n`);
  };

  /* ------------------------------------------------------------- the runtime */

  const deltaSeq = new Map<string, number>();

  const harness = options.open((delta) => {
    const seq = (deltaSeq.get(delta.runId) ?? 0) + 1;
    deltaSeq.set(delta.runId, seq);
    write({ kind: 'delta', runId: delta.runId, seq, step: delta.step, text: delta.text });
  });

  const recovered = harness.recoverInterrupted();
  if (recovered.length > 0) log(`[recovery] settled ${recovered.length} interrupted run(s)`);

  const dispatch = createDispatch(harness);

  /* ---------------------------------------------------------------- the pump */

  /**
   * Where each run's log has been read to. Kept for the life of the process
   * rather than cleared when a run goes quiet, because a suspended run that is
   * later resumed must continue rather than replay — a client that saw a
   * question twice would show it twice.
   */
  const cursors = new Map<string, number>();
  const watching = new Set<string>();
  let pump: NodeJS.Timeout | undefined;

  /** Writes everything new for one run. Answers whether it has gone quiet. */
  const drain = (runId: string): boolean => {
    let last: RunEventType | undefined;

    for (;;) {
      const next = page(harness.events, runId, cursors.get(runId) ?? 0, 200);

      for (const event of next.events) {
        write({ kind: 'event', runId, event });
        last = event.type;
      }

      cursors.set(runId, next.cursor);
      if (next.caughtUp) break;
    }

    // The *last* type, not any of them. A run that suspended and was resumed
    // inside one tick has both events in this page, and stopping on the first
    // terminal one would abandon a run that is running again.
    return last !== undefined && QUIET.has(last);
  };

  const stopPump = (): void => {
    if (!pump) return;
    clearInterval(pump);
    pump = undefined;
  };

  const tick = (): void => {
    for (const runId of [...watching]) {
      if (drain(runId)) watching.delete(runId);
    }
    if (watching.size === 0) stopPump();
  };

  const watch = (runId: string): void => {
    watching.add(runId);
    // Not unref'd. An interval that exists only while a run does is already
    // bounded, and one that lets the process exit mid-run would drop the
    // frames that say how it ended.
    pump ??= setInterval(tick, pollMs);
  };

  /* ------------------------------------------------------------- the loop */

  const pending = new Set<Promise<unknown>>();
  let closing = false;
  let closed = false;

  const hello = (): Record<string, unknown> => ({
    protocolVersion: PROTOCOL_VERSION,
    offerQuery: { schemaVersion: 1, supported: harness.offerQueries.schema().supported },
    runtimeVersion: RUNTIME_VERSION,
    capabilities: Object.values(harness.capabilities).map((capability) => ({
      name: capability.name,
      describe: capability.describe
    }))
  });

  /**
   * Stops accepting work, stops what is running, and waits — but not forever.
   *
   * Cancelling first and waiting second is the order that matters: a run told
   * to stop settles in whatever time its current effect needs, and a run not
   * told to stop would use the whole grace period and then be abandoned
   * mid-step. The timeout is there because an effect can hang, and a quit
   * button that does not quit is worse than one that gives up on a straggler.
   */
  const shutdown = async (): Promise<Record<string, unknown>> => {
    closing = true;

    const stopped = [...watching];
    await Promise.allSettled(stopped.map((runId) => dispatch('run.cancel', { runId })));

    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...pending]).finally(() => {
        if (timer) clearTimeout(timer);
      }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, DRAIN_MS);
      })
    ]);

    // The last word on every run, so a client that asked to stop still learns
    // how each one ended rather than losing the final frames to the exit.
    for (const runId of [...watching]) {
      drain(runId);
      watching.delete(runId);
    }
    stopPump();

    return { shuttingDown: true, cancelled: stopped };
  };

  const answer = async (request: Request): Promise<Frame> => {
    if (closing && request.channel !== 'bridge.shutdown') {
      return failed(request.id, 'closing', 'The runtime is shutting down.');
    }

    try {
      if (request.channel === 'bridge.hello') {
        return { kind: 'reply', id: request.id, ok: true, data: hello() };
      }

      if (request.channel === 'bridge.shutdown') {
        return { kind: 'reply', id: request.id, ok: true, data: await shutdown() };
      }

      validateUploadBudget(request.channel, request.payload);

      const response = await dispatch(request.channel, request.payload);

      return response.ok
        ? { kind: 'reply', id: request.id, ok: true, data: response.data }
        : { kind: 'reply', id: request.id, ok: false, error: response.error };
    } catch (error) {
      // `dispatch` answers rather than throws, so reaching here means the
      // envelope itself was refused — an oversized upload, or a bug in this
      // file. Either way it is a reply and not a crash: one bad request must
      // not take down a process that is running someone's work.
      return failed(request.id, 'bridge_error', String((error as Error)?.message ?? error));
    }
  };

  const closeHarness = (): void => {
    if (closed) return;
    closed = true;
    harness.close();
  };

  const reader = createInterface({ input: options.input, crlfDelay: Infinity });

  const accept = (line: string): void => {
    if (!line.trim()) return;

    let request: Request;
    try {
      request = parseRequest(line);
    } catch (error) {
      // No id to answer to, so the reply carries an empty one. A client cannot
      // match it to a call; it can log it, which is the only useful thing to do
      // with a message that was never a well-formed request.
      write(failed('', 'bad_request', String((error as Error)?.message ?? error)));
      return;
    }

    const task = answer(request).then((frame) => {
      write(frame);

      // Watched only after the reply is on the wire, which is what makes "the
      // id arrives before anything that uses it" true rather than likely.
      if (
        frame.kind === 'reply'
        && frame.ok
        && (request.channel === 'run.start' || request.channel === 'run.context.start' || request.channel === 'run.offer.start' || request.channel === 'run.resume')
      ) {
        const runId = (frame.data as { runId?: unknown }).runId;
        if (typeof runId === 'string') watch(runId);
      }

      if (request.channel === 'bridge.shutdown') {
        closeHarness();
        // Closing the reader rather than only pausing the stream, so `closed`
        // resolves. A paused input is a process that answered "shutting down"
        // and then sat there, which is the one outcome a quit button must not
        // have.
        reader.close();
        options.input.pause();
      }
    });

    // A shutdown must not wait on itself.
    if (request.channel !== 'bridge.shutdown') {
      pending.add(task);
      void task.finally(() => pending.delete(task));
    }
  };

  const finished = new Promise<void>((resolve) => {
    reader.on('close', () => {
      // The pipe closed without anyone asking. The parent died, or was killed;
      // either way there is nobody to answer, so the only thing left worth
      // doing is not leaving a run marked `running` in the database forever.
      void (closing ? Promise.resolve() : shutdown()).finally(() => {
        closeHarness();
        resolve();
      });
    });
  });

  reader.on('line', accept);

  return { closed: finished };
};
