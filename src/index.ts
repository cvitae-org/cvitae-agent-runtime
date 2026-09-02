/**
 * The package surface: types, and one factory.
 *
 * This file assembles nothing. Everything that has to be wired together is
 * wired in `runtime/create.ts`, which is the only composition root — see the
 * note at the top of that file for why there is exactly one.
 */

export * from './contracts/index.js';
export * from './runtime/create.js';
export * from './adapters/ipc/index.js';

/**
 * Named rather than starred, because both adapters have a `failed` helper and
 * they build different things — one an IPC envelope, one a wire frame. The
 * collision is the useful signal here: a consumer importing from this file
 * wants a host, not a second way to spell a failure.
 */
export {
  createHost,
  parseRequest,
  MAX_ACTION_BYTES,
  MAX_FILE_BYTES,
  PROTOCOL_VERSION,
  RUNTIME_VERSION,
  type Frame,
  type Host,
  type HostOptions,
  type Request
} from './adapters/stdio/index.js';
