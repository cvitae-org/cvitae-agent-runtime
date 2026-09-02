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
