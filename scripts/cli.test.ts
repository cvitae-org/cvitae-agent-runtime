/**
 * The command line's one piece of logic.
 *
 * Most of the rest of `adapters/cli` is a call into the runtime and does not
 * want a test. `field` is the exception among the formatters, because it once
 * printed `[object Object]` for every nested field a result carried — which is
 * a formatting bug that reached a reader as a missing answer. `parseArgs` earns
 * its tests too, because it decides which flags
 * become a capability's input — and a mistake there is not a parse error, it is
 * `--json` arriving at zod as an unknown field, or `--db` being handed to a
 * capability as though it were part of the offer.
 *
 * Confirmed by breaking things. Dropping `json` from `RESERVED` puts it in the
 * capability's input. Consuming the next token unconditionally makes `--json`
 * swallow the command that follows it. Treating a lone trailing `--flag` as
 * needing a value makes it `undefined` instead of `true`.
 *
 * `sourcesFrom` joined it for the same reason and one more: it is the only
 * place in the tree that opens a file, and what it hands the harness is bytes
 * the harness could not have chosen. Mutations run on that half too, applied,
 * counted and reverted:
 *
 *   `repeated` keeps only the last match  2  a flag given more than once … /
 *                                            a text file arrives as text …
 *   a text file is sent as bytes          1  a text file arrives as text …
 *   the extension check is dropped        1  an unknown extension says …
 *
 * The last one found a real defect rather than confirming a test. `sourcesFrom`
 * read the file before deciding whether it could read the type at all, so an
 * unsupported file that also did not exist reported the wrong one of its two
 * problems — and a 20MB video was loaded into memory on its way to being
 * refused. The check moved above the read.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  capabilityInput,
  field,
  parseArgs,
  repeated,
  sourcesFrom
} from '../src/adapters/cli/main.js';

test('positionals and --key value pairs come apart', () => {
  const args = parseArgs(['run', 'analyze_offer', '--url', 'https://example.test']);

  assert.deepEqual(args.positional, ['run', 'analyze_offer']);
  assert.deepEqual(args.flags, { url: 'https://example.test' });
});

test('a flag with nothing after it, or another flag after it, is true', () => {
  // `--json --db path` is the common shape, and a parser that swallows the next
  // token regardless turns `--db` into the value of `--json` and loses both.
  assert.deepEqual(parseArgs(['runs', 'list', '--json', '--db', 'x.db']).flags, {
    json: true,
    db: 'x.db'
  });

  assert.deepEqual(parseArgs(['run', 'noop', '--json']).flags, { json: true });
});

test('a value containing spaces and newlines survives intact', () => {
  // The offer text arrives this way, and it is the whole posting.
  const posting = 'Senior Engineer\n\nWarszawa — hybrid\nSalary: 20 000 PLN';
  const args = parseArgs(['run', 'analyze_offer', '--offerText', posting]);

  assert.equal(args.flags.offerText, posting);
});

test('the runtime\'s own flags never reach the capability', () => {
  const args = parseArgs([
    'run',
    'analyze_offer',
    '--url',
    'https://example.test',
    '--json',
    '--db',
    '/tmp/x.db',
    '--limit',
    '5'
  ]);

  // A capability validates its input with a zod schema that knows nothing about
  // where the process keeps its database.
  assert.deepEqual(capabilityInput(args.flags), { url: 'https://example.test' });
});

/* ----------------------------------------------------------------- sources */

test('a flag given more than once keeps every value, in order', () => {
  const argv = ['run', 'extract_cv', '--file', 'a.pdf', '--json', '--file', 'b.png'];

  assert.deepEqual(repeated(argv, 'file'), ['a.pdf', 'b.png']);
  // `parseArgs` keeps one, which is why the second pass exists rather than a
  // union-typed flag value every other call site would have to narrow.
  assert.equal(parseArgs(argv).flags.file, 'b.png');
});

test('a trailing --file with no path is not a source', () => {
  assert.deepEqual(repeated(['run', 'extract_cv', '--file'], 'file'), []);
  assert.deepEqual(repeated(['run', 'x', '--file', '--json'], 'file'), []);
});

test('the two boolean words become booleans, and nothing else does', () => {
  const args = parseArgs([
    'run', 'extract_cv',
    '--persist', 'false',
    '--known_skills', 'true',
    '--text', 'falsely advertised'
  ]);

  // Without this a bare `--persist` is the only spelling a shell has, and it
  // means the value the schema already defaults to.
  assert.deepEqual(capabilityInput(args.flags), { persist: false, known_skills: true });

  // Exactly the two words. A value that merely contains one is a string.
  assert.equal(capabilityInput(parseArgs(['run', 'x', '--q', 'false alarm']).flags).q, 'false alarm');
});

test('a JSON flag value becomes the object it describes', () => {
  // Without this a capability with a required object field is unreachable from
  // a shell: there is no arrangement of `--key value` pairs that expresses two
  // arrays, and `generate_evidence_summary` takes exactly that.
  const args = parseArgs([
    'run', 'generate_evidence_summary',
    '--offer', '{"required_skills":["TypeScript"],"responsibilities":[]}'
  ]);

  assert.deepEqual(capabilityInput(args.flags), {
    offer: { required_skills: ['TypeScript'], responsibilities: [] }
  });
});

test('text that only looks like JSON stays text', () => {
  // Confined to the two opening characters, and still only when it parses. A
  // silently mangled argument is worse than an unconverted one.
  assert.equal(capabilityInput(parseArgs(['run', 'x', '--q', '{not json']).flags).q, '{not json');
  assert.equal(capabilityInput(parseArgs(['run', 'x', '--q', 'a [b] c']).flags).q, 'a [b] c');
});

test('a numeric flag arrives as a number, and only when it round-trips', () => {
  // Without this a numeric field is unreachable from a shell entirely: the
  // schema declares `z.number()` and rejects the string outright, so
  // `--max_words 300` fails with a type error rather than doing anything.
  assert.deepEqual(
    capabilityInput(parseArgs(['run', 'draft_application', '--max_words', '300']).flags),
    { max_words: 300 }
  );

  // Only text that survives the round trip unchanged. Everything here reads as
  // a number to `Number` and means something else to a person — a version, a
  // padded id, a phone number — so each stays the string it was typed as.
  for (const value of ['1e3', '0x10', ' 7', '007', '', '1.0', '+7']) {
    assert.equal(
      capabilityInput(parseArgs(['run', 'x', '--v', value]).flags).v,
      value,
      `"${value}" was reinterpreted as a number`
    );
  }
});

test('--file and --text never reach the capability as scalars', () => {
  const args = parseArgs(['run', 'extract_cv', '--file', 'cv.pdf', '--text', 'hello']);

  // They become one `sources` array instead, which `runCommand` adds.
  assert.deepEqual(capabilityInput(args.flags), {});
});

test('a text file arrives as text and a binary one as base64 bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cvitae-cli-'));

  try {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    await writeFile(join(dir, 'cv.txt'), 'Ada Lovelace\nBackend engineer.');
    await writeFile(join(dir, 'shot.png'), png);

    const sources = await sourcesFrom([
      'run', 'extract_cv',
      '--text', 'pasted by hand',
      '--file', join(dir, 'cv.txt'),
      '--file', join(dir, 'shot.png')
    ]);

    assert.deepEqual(sources.map((source) => source.kind), ['text', 'text', 'bytes']);
    assert.equal(sources[0]?.text, 'pasted by hand');

    // Decoded here rather than shipped as bytes: both work, and the smaller run
    // row is worth having when the content is already a string.
    assert.match(String(sources[1]?.text), /^Ada Lovelace/);
    assert.equal(sources[1]?.label, 'cv.txt');

    assert.equal(sources[2]?.mime, 'image/png');
    assert.deepEqual(
      [...Buffer.from(String(sources[2]?.base64), 'base64')],
      [...png],
      'the bytes did not survive the trip through base64'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unknown extension says what is supported instead', async () => {
  await assert.rejects(
    () => sourcesFrom(['run', 'extract_cv', '--file', '/tmp/cv.docx']),
    /\.docx.*Supported:.*\.pdf/s
  );
});

// --- the printed field -----------------------------------------------------

test('a nested field is printed as JSON, not as [object Object]', () => {
  const printed = field('document', { personal: { name: 'Ada Lovelace' } });

  assert.equal(printed, 'document: {"personal":{"name":"Ada Lovelace"}}');
});

test('objects inside a list are printed too', () => {
  const printed = field('used_passages', [{ text: 'Rebuilt the checkout.' }]);

  assert.equal(printed, 'used_passages:\n  - {"text":"Rebuilt the checkout."}');
});

test('a long field is cut to a line, list items included', () => {
  const long = 'x'.repeat(400);

  assert.equal(field('body', long), `body: ${'x'.repeat(157)}\u2026`);
  assert.equal(field('notes', [long]), `notes:\n  - ${'x'.repeat(157)}\u2026`);
});

test('nothing worth printing prints nothing', () => {
  assert.equal(field('a', undefined), undefined);
  assert.equal(field('b', null), undefined);
  assert.equal(field('c', ''), undefined);
  assert.equal(field('d', []), undefined);
});
