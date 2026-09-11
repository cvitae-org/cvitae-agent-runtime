/**
 * The wire: newline-delimited JSON, one object per line.
 *
 * Chosen over anything framed or binary for a reason that is about debugging
 * rather than performance. A protocol you can read by piping the child's stdout
 * into a file, and drive by typing a line into its stdin, is one whose failures
 * can be reproduced without the app that normally speaks it. Nothing here is
 * hot enough for the encoding to matter — the expensive thing in this process
 * takes seconds and lives on someone else's GPU.
 *
 * **stdout carries frames and nothing else.** A `console.log` anywhere in the
 * tree lands in the middle of one and desynchronises the stream, which is why
 * the runtime's own logger writes to stderr and why the default `AiLog` sink is
 * a table rather than a stream. That rule is what makes the transport
 * inspectable in the first place.
 *
 * Every frame is tagged. The alternative — a reply is anything with an `id`, a
 * push is anything without one — reads fine until the first frame that wants
 * both, and then the discriminator has to be added anyway, to a protocol that
 * already has clients.
 */

import { createRequire } from 'node:module';
import type { RunEvent } from '../../contracts/index.js';

/**
 * Bumped when a frame changes shape in a way an older client would misread.
 *
 * Checked during the handshake and nowhere else. A version negotiated per
 * message is a version nobody checks; a version checked once, before anything
 * else is sent, is a mismatch that fails loudly at startup rather than as an
 * inexplicable missing field twenty minutes in.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Read from `package.json` rather than restated here, because a version
 * constant beside the code it describes is a version that is wrong after the
 * next release and right in the one place nobody looks.
 */
export const RUNTIME_VERSION = String(
  (createRequire(import.meta.url)('../../../package.json') as { version?: unknown }).version
    ?? '0.0.0'
);

/** A single attachment. Ten megabytes is a scanned CV with room to spare. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Everything in one request. Enough for a handful of files, not for a library. */
export const MAX_ACTION_BYTES = 25 * 1024 * 1024;

export type Request = {
  readonly id: string;
  readonly channel: string;
  readonly payload?: unknown;
};

/**
 * Everything that can appear on stdout.
 *
 * `reply` answers a request and carries its id back. The other two are
 * unsolicited: nobody asked for them, they arrive while a run is going, and a
 * client that ignores them entirely still works — it just watches a spinner
 * instead of a transcript.
 */
export type Frame =
  | { readonly kind: 'reply'; readonly id: string; readonly ok: true; readonly data: unknown }
  | {
      readonly kind: 'reply';
      readonly id: string;
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    }
  | { readonly kind: 'event'; readonly runId: string; readonly event: RunEvent }
  /**
   * A fragment of prose, as it is written.
   *
   * `step` is not decoration. A stage can run two generating steps at once, and
   * their fragments interleave on this one stream; without the name a client
   * would concatenate two answers into one piece of nonsense.
   *
   * `seq` is per run and gapless, like an event's, and exists so a client can
   * notice it missed one. Noticing is all it can do — a delta is not stored
   * anywhere and cannot be re-requested. The recovery is to stop trusting the
   * assembled text and take the canonical answer from `run.await`, which is
   * what a client should be doing at the end regardless.
   */
  | {
      readonly kind: 'delta';
      readonly runId: string;
      readonly seq: number;
      readonly step: string;
      readonly text: string;
    };

export const failed = (id: string, code: string, message: string): Frame => ({
  kind: 'reply',
  id,
  ok: false,
  error: { code, message }
});

/**
 * Parses one line into a request, or throws saying what was wrong with it.
 *
 * Deliberately strict about `id`: a request without one produces a reply
 * nobody can match, which a client experiences as a call that never returns.
 * Refusing it loudly at the door costs one round trip and saves a timeout.
 */
export const parseRequest = (line: string): Request => {
  const value: unknown = JSON.parse(line);

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A request must be a JSON object.');
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string' || record.id.trim() === '') {
    throw new Error('A request needs a non-empty string id.');
  }

  if (typeof record.channel !== 'string' || record.channel.trim() === '') {
    throw new Error('A request needs a non-empty string channel.');
  }

  return {
    id: record.id,
    channel: record.channel,
    // Distinguished from `payload: undefined`, so a channel whose schema has
    // all-optional fields sees the same thing either way.
    ...(Object.hasOwn(record, 'payload') ? { payload: record.payload } : {})
  };
};

/** How many bytes a base64 string decodes to, without decoding it. */
const decodedBytes = (base64: string): number => {
  const compact = base64.replace(/\s/g, '');

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error('An attachment contains invalid base64 data.');
  }

  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
};

/**
 * A ceiling on what one request may carry, checked before anything decodes it.
 *
 * Measured rather than decoded, so a request that is too large is refused
 * without ever being materialised — the point of a limit is to not pay for what
 * it rejects. The capability's own schema validates shape; this only decides
 * whether the process is willing to hold it at all.
 */
export const validateUploadBudget = (channel: string, payload: unknown): void => {
  if ((channel !== 'run.start' && channel !== 'run.context.start' && channel !== 'run.offer.start') || !payload || typeof payload !== 'object') return;

  const input = (payload as { input?: unknown }).input;
  if (!input || typeof input !== 'object') return;

  const sources = (input as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return;

  let total = 0;

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    const base64 = (source as { base64?: unknown }).base64;
    const text = (source as { text?: unknown }).text;
    const bytes = typeof base64 === 'string'
      ? decodedBytes(base64)
      : typeof text === 'string'
        ? Buffer.byteLength(text, 'utf8')
        : 0;

    if (bytes > MAX_FILE_BYTES) {
      throw new Error('An attachment exceeds the 10 MB file limit.');
    }

    total += bytes;
  }

  if (total > MAX_ACTION_BYTES) {
    throw new Error('Attachments exceed the 25 MB request limit.');
  }
};
