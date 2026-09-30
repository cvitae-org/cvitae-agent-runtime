/**
 * The entry point a desktop app spawns.
 *
 * Everything interesting is in `host.ts`, which takes its streams as arguments
 * and can therefore be driven over a pair of in-memory pipes. This file is the
 * three lines that are genuinely about being a process: load `.env`, hand over
 * the real stdio, and keep the runtime's own logging off the stream the
 * protocol is using.
 *
 * There is no signal handling here, deliberately. A parent that wants this
 * process to stop sends `bridge.shutdown` and gets an answer once the work has
 * been cancelled and drained; if the parent dies instead, stdin closes and the
 * host takes the same path unasked. A SIGINT handler would add a third way to
 * end, with no way for the parent to know which one happened.
 */

import '../../env.js';
import {createBrowserBridge,defaultBridgeDirectory} from '../browser/bridge.js';
import { createHost } from './host.js';
import { startupRefusal } from './refusals.js';
import { aiLine, createHarness } from '../../runtime/create.js';
import type { AiLogEntry, AiLogger } from '../../contracts/index.js';

/**
 * Metadata on stderr, so a developer watching the child can see what it is
 * paying for, and why a call failed. Sizes, tokens, timings and an outcome with
 * its code — never a prompt and never a completion, which is the same rule the
 * `ai_calls` table follows and the reason this one is safe to leave on. It is
 * an echo of the table, not a replacement: the table is the record a person
 * can be shown, and what a usage bill is checked against.
 */
const stderrLogger: AiLogger = {
  record(entry: AiLogEntry): void {
    process.stderr.write(`[ai] ${aiLine(entry)}\n`);
  }
};

/**
 * Ninety days of `ai_calls`. A row is a few hundred bytes, so this is room for a
 * quarter's usage to be checked against a bill, and not a log that grows
 * without end.
 */
const AI_CALLS_KEPT_MS = 90 * 24 * 60 * 60 * 1000;

try {
  const host = createHost({
    open: (deltas) => {
      const harness=createHarness({echo:stderrLogger,aiCallsKeptMs:AI_CALLS_KEPT_MS,deltas,indexRecovery:true});
      const bridge=createBrowserBridge(defaultBridgeDirectory(),(session,method,payload)=>harness.browser.dispatch(session,method,payload),session=>harness.browser.disconnect(session),{extensionPath:process.env.CVITAE_BROWSER_EXTENSION_PATH});
      harness.browser.attach(bridge);return harness;
    },
    input: process.stdin,
    output: process.stdout
  });

  // `exitCode` rather than `process.exit`, so Node flushes what is still queued
  // on stdout. The last thing written is usually the reply to `bridge.shutdown`,
  // and a parent that never sees it cannot tell a clean stop from a crash.
  void host.closed.then(() => {
    process.exitCode = 0;
  });
} catch (error) {
  // A refusal a restart cannot fix (a database from a newer build, no room for
  // the backup an upgrade needs) ends with a status of its own, so the parent
  // stops instead of retrying. Anything else is a crash and stays one.
  const refusal = startupRefusal(error);
  if (!refusal) throw error;
  process.stderr.write(`cvitae-runtime: ${refusal.code}: ${refusal.message}\n`, () => {
    process.exit(refusal.status);
  });
}
