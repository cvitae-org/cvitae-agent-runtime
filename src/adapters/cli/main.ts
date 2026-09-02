/**
 * The command line: a host, and nothing more.
 *
 * Everything here is argument parsing, formatting and process exit codes. It
 * makes no decision about how a run works, and it is the only file in the tree
 * that writes to stdout for a person to read. That is the whole reason a host
 * is cheap to add: `adapters/ipc` and any HTTP host later do this same job in
 * their own vocabulary, over the same `Harness`.
 *
 * Two behaviours are worth naming because they are not incidental.
 *
 * The signal is wired to SIGINT, so Ctrl-C cancels the run rather than killing
 * the process mid-write. The run reaches a terminal `cancelled` state with the
 * event to match, and the database is left consistent — which is the whole
 * point of the non-optional `AbortSignal` on `RunContext`.
 *
 * A suspended run exits 0, not 1. It has not failed; it is waiting for a
 * person, and a script that treats "needs approval" as an error will retry work
 * that was never wrong.
 */

import '../../env.js';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { all } from '../../events/tail.js';
import { RuntimeError, isRunSuspension } from '../../contracts/index.js';
import { createHarness, silentLogger, type Harness } from '../../runtime/create.js';
import type { RunRecord, RunResult } from '../../contracts/index.js';

const USAGE = `cvitae-runtime

  run <capability> [--key value ...]   Run a capability and print its result.
      [--file path] [--text string]    Sources, repeatable. See below.
  runs list [--status s] [--limit n]   Recent runs, newest first.
  runs show <id> [--events]            One run, its steps, and optionally its events.
  approve <id> [--deny] [--note text]  Answer the question a suspended run is waiting on.
  capabilities                         What this runtime can do.

Options:
  --json        Machine-readable output.
  --db <path>   Database file. Defaults to $CVITAE_DB.

--file and --text may each be given more than once. They become the run's
"sources" list, in the order they appear. The file is read here; the harness
never opens one.
`;

/* ----------------------------------------------------------------- parsing */

type Args = {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
};

/**
 * `--key value` and `--flag`, with no schema.
 *
 * Deliberately dumb: a capability's own input schema is the thing that decides
 * what is valid, and duplicating any of it here would give two answers to one
 * question. A misspelled key reaches zod and comes back with the field name.
 */
export const parseArgs = (argv: readonly string[]): Args => {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;

    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return { positional, flags };
};

/**
 * Everything but the reserved flags, as the capability's input.
 *
 * `file` and `text` are reserved because they are not scalar input: they are
 * repeatable, and they become one `sources` array rather than two fields. See
 * `sourcesFrom`.
 */
const RESERVED = new Set([
  'json', 'db', 'events', 'status', 'limit', 'deny', 'note', 'file', 'text'
]);

/**
 * Everything a shell can only hand over as text, given back its type.
 *
 * `--flag` is `true`; so are `--flag true` and `--flag false`, as booleans. A
 * bare `--persist` can only ever mean the value a capability already defaults
 * to, so a boolean field that defaults to on has no way to be turned off from a
 * shell without this.
 *
 * Numbers for the same reason and with a sharper edge: an input schema
 * declaring `z.number()` rejects `"6"` outright, so a numeric field is simply
 * unreachable from a command line without this conversion — and the two the
 * tree has, a turn ceiling and a word ceiling, are both fields whose whole
 * purpose is to be changed per call.
 *
 * JSON for a third reason, narrower than either. A shell has no syntax for a
 * nested object or a list, so a capability with a required object field is
 * simply not invocable from here — `generate_evidence_summary` takes the offer
 * analysis, which is two arrays and two strings, and there is no arrangement of
 * `--key value` pairs that expresses it. The convention is deliberately
 * confined to text that opens with `{` or `[`: a value that looks like JSON and
 * parses as JSON becomes it, and everything else, including a value that only
 * looks like it, stays the string it was.
 *
 * All three conversions stay literal for the same reason. Exactly the two
 * words; a number only when the text round-trips through `Number` unchanged,
 * which rejects `"1e3"`, `"0x10"`, `" 7"`, `"007"` and the empty string rather
 * than quietly reinterpreting any of them; and JSON only from the two opening
 * characters that cannot begin an ordinary flag value. That literalness is what
 * keeps this a parsing convention rather than knowledge of a capability, which
 * is what keeps it in a host.
 *
 * The cost, stated because it is real: a capability wanting the *string*
 * "false", "300" or "[draft]" cannot be given it from the command line. No
 * input schema in the tree has such a field, and one that did would be better
 * off typed.
 */
const typed = (value: string | boolean): unknown => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;

  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      // Not JSON after all. A capability field holding prose that opens with a
      // bracket is stranger than a typo in a JSON argument, but only one of the
      // two is silently unrecoverable, so the string is what comes back.
      return value;
    }
  }

  const asNumber = Number(value);
  return String(asNumber) === value ? asNumber : value;
};

export const capabilityInput = (flags: Args['flags']): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(flags)
      .filter(([key]) => !RESERVED.has(key))
      .map(([key, value]) => [key, typed(value)])
  );

/* ----------------------------------------------------------------- sources */

/**
 * Every `--key value` pair for one key, in the order given.
 *
 * `parseArgs` keeps one value per flag, which is right for `--url` and wrong
 * for a list — an import is routinely a CV export plus a screenshot of a
 * profile, and collapsing those to the last one would silently drop the first.
 * A second pass over the same argv is cheaper than giving every flag a
 * union-typed value that every other call site then has to narrow.
 */
export const repeated = (argv: readonly string[], key: string): string[] => {
  const found: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== `--${key}`) continue;

    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) continue;

    found.push(next);
    index += 1;
  }

  return found;
};

/** What a file's extension says it is, for the reader that has to decode it. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json'
};

/**
 * Turns `--text` and `--file` into the `sources` list a capability expects.
 *
 * This is the one place in the tree that opens a file, and it is deliberate: a
 * capability input carrying a path would put filesystem access behind a field
 * that an IPC or HTTP caller also fills, and a path from a caller is a path an
 * attacker-shaped payload can supply. The adapter reads; the harness receives
 * bytes it cannot have chosen.
 *
 * Bytes travel as base64 because the run's input is stored as JSON, and a
 * `Uint8Array` does not survive that round trip — a resumed run would find its
 * sources gone. The cost is a third again on the row, paid so that a run can be
 * inspected and replayed after the process that started it is gone.
 *
 * A text-typed file is decoded here rather than sent as bytes. Both work, and
 * the smaller row is worth having when the content is already a string.
 */
export const sourcesFrom = async (argv: readonly string[]): Promise<Record<string, unknown>[]> => {
  const sources: Record<string, unknown>[] = [];

  for (const text of repeated(argv, 'text')) {
    sources.push({ kind: 'text', label: 'pasted text', text });
  }

  for (const path of repeated(argv, 'file')) {
    // Checked before the read, not after. A rejected type should cost nothing,
    // and reading first means a 20MB video is loaded into memory on its way to
    // being refused — and that an unsupported *and* missing file reports the
    // wrong one of its two problems.
    const mime = MIME_TYPES[extname(path).toLowerCase()];

    if (!mime) {
      throw new RuntimeError(
        `There is no reader for "${extname(path) || basename(path)}". `
          + `Supported: ${Object.keys(MIME_TYPES).join(', ')}.`,
        'unreadable_source'
      );
    }

    const bytes = await readFile(path);

    sources.push(
      mime.startsWith('text/') || mime === 'application/json'
        ? { kind: 'text', label: basename(path), text: bytes.toString('utf8') }
        : { kind: 'bytes', label: basename(path), mime, base64: bytes.toString('base64') }
    );
  }

  return sources;
};

/* --------------------------------------------------------------- rendering */

const ago = (at: number | undefined, now: number): string => {
  if (at === undefined) return '—';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
};

const line = (record: RunRecord, now: number): string =>
  [
    // The whole id, not a prefix. A listing that prints something the next
    // command rejects is worse than a wide line.
    record.id,
    record.status.padEnd(9),
    record.capability.padEnd(16),
    ago(record.createdAt, now).padStart(8),
    record.degraded.length > 0 ? `degraded: ${record.degraded.join(',')}` : ''
  ]
    .join('  ')
    .trimEnd();

/**
 * One field, for a person.
 *
 * Long strings are cut and empty ones are dropped. The offer text is in the
 * result because a later step may need it, not because anyone wants the posting
 * they just pasted read back to them — and `--json` still carries every byte,
 * so nothing is lost, only spared.
 */
const scalar = (value: unknown): string =>
  // `String({})` is `[object Object]`, which is worse than useless: it tells a
  // reader a field exists and hides what is in it. Several results carry nested
  // objects — `extract_cv` returns the whole document — so this is the common
  // case rather than an edge one. JSON, then cut like any other long string.
  typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);

const cut = (text: string, limit = 160): string => {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= limit ? single : `${single.slice(0, limit - 3)}…`;
};

export const field = (key: string, value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;

  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return `${key}:${value.map((item) => `\n  - ${cut(scalar(item))}`).join('')}`;
  }

  return `${key}: ${cut(scalar(value))}`;
};

const printResult = (result: RunResult, json: boolean): void => {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`run ${result.runId}  ${result.capability}  ${result.elapsedMs}ms`);

  if (result.degraded.length > 0) {
    // Named rather than counted: "3 steps degraded" tells a reader something
    // is missing without telling them what, which is the half that matters.
    console.log(`degraded: ${result.degraded.join(', ')}`);
  }

  console.log('');
  for (const [key, value] of Object.entries(result.data)) {
    const rendered = field(key, value);
    if (rendered) console.log(rendered);
  }
};

/* ---------------------------------------------------------------- commands */

const runCommand = async (harness: Harness, args: Args, argv: readonly string[]): Promise<number> => {
  const capability = args.positional[1];

  if (!capability) {
    console.error('Which capability? Try: cvitae-runtime capabilities');
    return 2;
  }

  // Added only when asked for, so a capability whose schema has no `sources`
  // field is not handed an empty array to reject.
  const sources = await sourcesFrom(argv);
  const input = {
    ...capabilityInput(args.flags),
    ...(sources.length > 0 ? { sources } : {})
  };

  // Ctrl-C cancels the run rather than killing the process, so the run reaches
  // a terminal state and its last checkpoint is not a lie.
  const controller = new AbortController();
  const onInterrupt = (): void => {
    console.error('\nCancelling…');
    controller.abort(new RuntimeError('The run was cancelled.', 'aborted'));
  };
  process.on('SIGINT', onInterrupt);

  try {
    const result = await harness.run({ capability, input, signal: controller.signal });

    printResult(result, args.flags.json === true);
    return 0;
  } catch (error) {
    if (isRunSuspension(error)) {
      // The suspension carries an id, not a question. Asking the store for the
      // question keeps one copy of it: the row a person answers is the row a
      // person reads, even if the process that asked is long gone.
      const waiting = harness.approvals
        .pending(error.runId)
        .find((request) => request.id === error.approvalId);

      console.log(`Run ${error.runId} is waiting on step "${error.step}".`);
      if (waiting) console.log(`\n${waiting.question}`);
      console.log(`\nAnswer it with: cvitae-runtime approve ${error.runId}`);
      // Not a failure. See the note at the top.
      return 0;
    }

    throw error;
  } finally {
    process.off('SIGINT', onInterrupt);
  }
};

const listCommand = (harness: Harness, args: Args): number => {
  const status = typeof args.flags.status === 'string' ? args.flags.status : undefined;
  const limit = Number(args.flags.limit ?? 20);

  const runs = harness.runs.list({
    limit: Number.isFinite(limit) ? limit : 20,
    ...(status ? { status: status as RunRecord['status'] } : {})
  });

  if (args.flags.json === true) {
    console.log(JSON.stringify(runs, null, 2));
    return 0;
  }

  if (runs.length === 0) {
    console.log('No runs yet.');
    return 0;
  }

  const now = Date.now();
  for (const record of runs) console.log(line(record, now));
  return 0;
};

/**
 * A run by id, or by an unambiguous prefix of one.
 *
 * Prefixes because a UUID is not something anyone retypes, and because git
 * taught everyone that the first few characters are enough. An ambiguous prefix
 * is refused rather than guessed: picking the newest match would work until the
 * day it silently picked the wrong run.
 */
const resolve = (harness: Harness, id: string): RunRecord | string => {
  const exact = harness.runs.get(id);
  if (exact) return exact;

  const matches = harness.runs.list({ limit: 500 }).filter((run) => run.id.startsWith(id));

  if (matches.length === 1) return matches[0] as RunRecord;
  if (matches.length === 0) return `No such run: ${id}`;
  return `"${id}" matches ${matches.length} runs. Use more of the id.`;
};

const showCommand = (harness: Harness, args: Args): number => {
  const id = args.positional[2];

  if (!id) {
    console.error('Which run?');
    return 2;
  }

  const record = resolve(harness, id);

  if (typeof record === 'string') {
    console.error(record);
    return 1;
  }

  const steps = harness.runs.steps(record.id);
  // `all` rather than one `since` call: a run with more events than a page
  // holds would otherwise print a timeline that stops without saying so.
  const events = args.flags.events === true ? all(harness.events, record.id) : [];

  if (args.flags.json === true) {
    console.log(JSON.stringify({ run: record, steps, events }, null, 2));
    return 0;
  }

  console.log(`${record.id}  ${record.status}  ${record.capability}`);
  if (record.errorMessage) console.log(`error: [${record.errorCode}] ${record.errorMessage}`);
  console.log('');

  for (const step of steps) {
    console.log(
      `  ${String(step.ordinal).padStart(2)}  ${step.status.padEnd(9)}  ${step.name}`
        + (step.reason ? `  (${step.reason})` : '')
    );
  }

  if (events.length > 0) {
    console.log('');
    for (const event of events) {
      console.log(`  ${String(event.seq).padStart(3)}  ${event.type}${event.step ? `  ${event.step}` : ''}`);
    }
  }

  return 0;
};

const approveCommand = async (harness: Harness, args: Args): Promise<number> => {
  const id = args.positional[1];

  if (!id) {
    console.error('Which run?');
    return 2;
  }

  const record = resolve(harness, id);

  if (typeof record === 'string') {
    console.error(record);
    return 1;
  }

  const [waiting] = harness.approvals.pending(record.id);

  if (!waiting) {
    console.error(`Run ${record.id} is "${record.status}", not waiting for an approval.`);
    return 1;
  }

  const granted = args.flags.deny !== true;
  const note = typeof args.flags.note === 'string' ? args.flags.note : undefined;

  harness.approvals.decide(waiting.id, {
    status: granted ? 'granted' : 'denied',
    decision: note === undefined ? {} : { note },
    decidedAt: Date.now()
  });

  console.log(`${granted ? 'Granted' : 'Denied'}: ${waiting.question}`);

  if (!granted) {
    // Resuming a denied run is still the right move: the step asked, it has
    // an answer, and what it does with a refusal is its own decision.
    console.log('Resuming so the step can act on the refusal…');
  }

  const result = await harness.resume({ runId: record.id });
  printResult(result, args.flags.json === true);
  return 0;
};

/* ------------------------------------------------------------------- entry */

export const main = async (argv: readonly string[]): Promise<number> => {
  const args = parseArgs(argv);
  const command = args.positional[0];

  if (!command || command === 'help' || args.flags.help === true) {
    console.log(USAGE);
    return command ? 0 : 2;
  }

  const harness = createHarness({
    ...(typeof args.flags.db === 'string' ? { databasePath: args.flags.db } : {}),
    // A log line per model call would interleave with the result on stdout.
    ...(args.flags.json === true ? { logger: silentLogger } : {})
  });

  try {
    if (command === 'run') return await runCommand(harness, args, argv);
    if (command === 'approve') return await approveCommand(harness, args);

    if (command === 'runs') {
      const sub = args.positional[1];
      if (sub === 'list' || sub === undefined) return listCommand(harness, args);
      if (sub === 'show') return showCommand(harness, args);
      console.error(`Unknown: runs ${sub}`);
      return 2;
    }

    if (command === 'capabilities') {
      for (const capability of Object.values(harness.capabilities)) {
        console.log(`${capability.name.padEnd(20)} ${capability.describe}`);
      }
      return 0;
    }

    console.error(`Unknown command: ${command}\n`);
    console.log(USAGE);
    return 2;
  } catch (error) {
    // The message only. A stack tells a user nothing they can act on, and a
    // `RuntimeError` message is written to be read by one.
    if (error instanceof RuntimeError) {
      console.error(`[${error.code}] ${error.message}`);
      return 1;
    }

    console.error(String((error as Error)?.message ?? error));
    return 1;
  } finally {
    harness.close();
  }
};

/**
 * Run only when invoked directly, so a test can import `main` and `parseArgs`
 * without the process trying to run a command.
 *
 * `pathToFileURL` rather than a string compare: `process.argv[1]` is a path and
 * `import.meta.url` is a URL, and on this platform the difference is spaces and
 * accents in a home directory being percent-encoded in one and not the other.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let finished = false;

  main(process.argv.slice(2)).then(
    (code) => {
      finished = true;
      process.exitCode = code;
    },
    (error: unknown) => {
      finished = true;
      console.error(String((error as Error)?.message ?? error));
      process.exitCode = 1;
    }
  );

  /**
   * Says so when the command stops without finishing.
   *
   * Node ends a process the moment nothing is left to do, and a promise that
   * will never settle counts as nothing. So a deadlock inside a run exits 0
   * with no output — the shell reports success for a run still sitting at
   * `running` in the database. That is not hypothetical: a tool loop waiting on
   * a slot it already held did exactly this, and the silence is what made it
   * take a database query to find.
   *
   * The gateway no longer deadlocks, but the property worth keeping is that
   * this host can never again report success for a command that did not
   * finish. `runs show` is named because the run's own events are the record of
   * how far it got.
   */
  process.on('beforeExit', () => {
    if (finished) return;

    console.error(
      'The command stopped before the run finished, with nothing left to wait for.\n'
        + 'The run is still open in the database — see: cvitae-runtime runs show <id>'
    );
    process.exitCode = 1;
  });
}
