/**
 * The plan's "done" list, end to end: each check through a real runtime over a
 * file, by the channels Studio uses, with only the model faked, at the network.
 *
 * Each of these is also tested piece by piece where it is built (the file named
 * beside it). What those cannot show is that the pieces are joined: that the
 * host's channels reach the store the run reads, and that what the run reads is
 * what leaves for the model. So every test here starts and reads runs only by
 * `dispatch`, and asserts on the requests as they left.
 *
 *   pins follow a CV edit           grounding-pins, grounding-assembly
 *   an exclusion holds through      grounding-walls, grounding-history
 *   tools, retrieval, history and
 *   earlier answers
 *   an edit proposal applies        grounding-edits, cvDiff
 *   exactly its changes
 *   every run, however it ends,     grounding-record, grounding-recorder
 *   leaves a closed record
 *
 * The other four checks already have a test of this kind: ten offers compared
 * with citations (grounding-offers), preview equals send and `plan_conflict`
 * (grounding-preview), hosted payloads carry no canary (masking-settings), a raw
 * import without consent is refused (egress-consent).
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 *   assembly reads the stored CV once and keeps it (assembly.ts)    1
 *   the documents port hands a tool the CV unwalled (walls.ts)      1
 *   a search hands every passage, walled or not (walls.ts)          1
 *   history is given every exchange, withheld or not (history.ts)   1
 *   an accept applies none of the changes (cv-lifecycle.ts)         1
 *   a failed run's record is left open (grounding-record.ts)        1
 *   a cancelled run's record is closed as failed                    1
 *   a run the process lost is closed as failed                      1
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { GroundingRecord, RecordEntry } from '../src/contracts/index.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import { scratch } from './support/db.js';

/* ------------------------------------------------------------------ the CV */

const ACME_OLD = 'Rewrote the billing pipeline. CANARY-ACME-OLD-3101';
const ACME_NEW = 'Moved billing to events. CANARY-ACME-NEW-3102';
const GLOBEX = 'Built the design system. CANARY-GLOBEX-3103';

const BODY = {
  personal: { full_name: 'Ada Lovelace' },
  experience: [
    { company: 'Acme', title: 'Senior Engineer', started: '2021', finished: null, highlights: [ACME_OLD] },
    { company: 'Globex', title: 'Engineer', started: '2018', finished: '2021', highlights: [GLOBEX] }
  ],
  languages: [
    { name: 'English', level: 'C1' },
    { name: 'Polish', level: 'native' }
  ]
};

/* ---------------------------------------------------------------- the model */

/** A request the runtime made of the model, as it left. */
type Sent = {
  readonly stream?: boolean;
  readonly tools?: { function: { name: string } }[];
  readonly response_format?: unknown;
  readonly messages: { role: string; content?: unknown; tool_calls?: unknown }[];
};

/** What the fake model answers: words, one tool call, or nothing until the request is aborted. */
type Reply = { text: string } | { tool: string; args: Record<string, unknown> } | { status: number } | 'hang';

const usage = { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A reply, whole or streamed as it was asked for. */
const respond = (reply: Exclude<Reply, 'hang'>, stream: boolean): Response => {
  if ('status' in reply) return json({ error: { message: 'down' } }, reply.status);

  const call = 'tool' in reply
    ? { id: `call-${reply.tool}`, type: 'function', function: { name: reply.tool, arguments: JSON.stringify(reply.args) } }
    : undefined;
  const text = 'text' in reply ? reply.text : null;
  const finish = call ? 'tool_calls' : 'stop';

  if (!stream) {
    const message = call ? { role: 'assistant', content: null, tool_calls: [call] } : { role: 'assistant', content: text };
    return json({ id: 'cmpl', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message, finish_reason: finish }], usage });
  }

  const chunk = (delta: Record<string, unknown>, done: string | null = null): string =>
    `data: ${JSON.stringify({ id: 'cmpl', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: done }] })}\n\n`;
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, ...call }] } : { role: 'assistant', content: text };
  const body = chunk(delta) + chunk({}, finish) + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

/* ------------------------------------------------------------- the runtime */

type Answer<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

const data = <T>(answer: unknown): T => {
  const it = answer as Answer<T>;
  assert.equal(it.ok, true, it.ok ? '' : `${it.error.code}: ${it.error.message}`);
  return (it as { data: T }).data;
};

/**
 * A real runtime over a file, a CV with nothing indexed, a conversation about
 * it, and a network that answers each request with `answer` and keeps it.
 */
const runtime = (path?: string) => {
  const s = path ? undefined : scratch();
  const file = path ?? s!.path;
  const sent: Sent[] = [];
  let answer: (request: Sent, at: number) => Reply = () => ({ text: 'An answer.' });
  const real = globalThis.fetch;

  globalThis.fetch = (async (_: unknown, init?: { body?: unknown; signal?: AbortSignal }): Promise<Response> => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Sent;
    sent.push(body);
    const reply = answer(body, sent.length - 1);
    if (reply !== 'hang') return respond(reply, body.stream === true);
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
    });
  }) as typeof globalThis.fetch;

  const harness = createHarness({
    databasePath: file,
    logger: silentLogger,
    // The network above is the model, whatever this machine happens to run.
    env: { LOCAL_BASE_URL: 'http://127.0.0.1:9' },
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });
  const dispatch = createDispatch(harness);

  return {
    file,
    sent,
    harness,
    dispatch,
    answering: (next: (request: Sent, at: number) => Reply) => {
      answer = next;
    },
    close: () => {
      globalThis.fetch = real;
      harness.close();
    },
    dispose: () => {
      globalThis.fetch = real;
      harness.close();
      s?.dispose();
    }
  };
};

type World = ReturnType<typeof runtime>;

/** A CV saved over the host's channel, and a conversation about it. */
const withCv = async (w: World) => {
  const { context } = data<{ context: { id: string } }>(
    await w.dispatch('profile.contexts.create', { protocolVersion: 2, id: randomUUID(), language: 'en' })
  );
  data(await w.dispatch('profile.context.update', { contextId: context.id, expectedRevision: 0, document: BODY }));
  const { conversation: chat } = data<{ conversation: { id: string } }>(
    await w.dispatch('conversations.create', { subject: { kind: 'profile', id: context.id } })
  );
  return { contextId: context.id, chatId: chat.id, ref: (path: string) => `cv:${context.id}/${path}` };
};

/** The CV as the host reads it back: its body and the revision to write over. */
const stored = async (w: World, contextId: string) =>
  data<{ record: { body: Record<string, unknown>; revision: number } }>(await w.dispatch('profile.context.get', { contextId })).record;

/** One message, as Studio sends it: the run started, awaited, and its record read. */
const ask = async (w: World, cv: Awaited<ReturnType<typeof withCv>>, question: string, input: Record<string, unknown> = {}) => {
  const { runId } = data<{ runId: string }>(
    await w.dispatch('run.context.start', {
      contextId: cv.contextId,
      conversationId: cv.chatId,
      capability: 'ask_profile',
      input: { question, ...input }
    })
  );
  const result = await w.dispatch('run.await', { runId });
  const { record } = data<{ record: GroundingRecord }>(await w.dispatch('runs.grounding', { runId }));
  return { runId, result, record };
};

/** Everything a request carried, as one string to look for words in. */
const wire = (requests: readonly Sent[]): string => JSON.stringify(requests);

const via = (record: GroundingRecord, channel: string): RecordEntry[] => record.entries.filter((entry) => entry.via === channel);

/* ---------------------------------------------------------- pins follow edits */

test('in a real runtime a pinned entry is sent as it is now: an edit to the CV shows in the next message, and the pin stays', async () => {
  const w = runtime();
  try {
    const cv = await withCv(w);
    const acme = cv.ref('experience/acme~senior-engineer');
    data(await w.dispatch('selection.update', { conversationId: cv.chatId, expectedRevision: 0, pin: [acme] }));

    const first = await ask(w, cv, 'What did I do at Acme?');
    assert.ok(wire(w.sent).includes(ACME_OLD), 'the pin is sent');

    // The person edits the entry; the pin is by its address, not a copy.
    const { revision } = await stored(w, cv.contextId);
    const edited = { ...BODY, experience: [{ ...BODY.experience[0]!, highlights: [ACME_NEW] }, BODY.experience[1]!] };
    data(await w.dispatch('profile.context.update', { contextId: cv.contextId, expectedRevision: revision, document: edited }));

    const before = w.sent.length;
    const second = await ask(w, cv, 'And now?');
    const now = wire(w.sent.slice(before));
    assert.ok(now.includes(ACME_NEW), 'the next message shows the edit');
    assert.equal(now.includes(ACME_OLD), false, 'and not what it was');

    const [one] = via(first.record, 'ground:pin');
    const [two] = via(second.record, 'ground:pin');
    assert.equal(one?.ref, acme);
    assert.equal(two?.ref, acme, 'the pin is where it was');
    assert.notEqual(one?.version, two?.version, 'each record names the revision of its own time');
    assert.notEqual(one?.digest, two?.digest);
  } finally {
    w.dispose();
  }
});

/* ------------------------------------------------------- exclusions hold */

test('in a real runtime an exclusion holds through a tool, a search, the history and an earlier answer', async () => {
  const w = runtime();
  try {
    const cv = await withCv(w);
    const globex = cv.ref('experience/globex~engineer');

    // Something indexed, so the search is offered: Globex's passage among them.
    const { revision } = await stored(w, cv.contextId);
    w.harness.chunks.keepText(
      cv.contextId,
      [
        { id: 'c0', kind: 'highlight', text: ACME_OLD, position: 0 },
        { id: 'c1', kind: 'highlight', text: GLOBEX, position: 1 }
      ],
      { expectedRevision: revision }
    );

    /** The model chooses both tools, calls `tool` with `args`, then answers `text`. */
    const script = (tool: string, args: Record<string, unknown>, text: string) =>
      (request: Sent): Reply => {
        if (request.tools === undefined) return { text: JSON.stringify({ tools: ['search_profile', 'read_cv'] }) };
        const answered = request.messages.some((message) => message.role === 'tool');
        return answered ? { text } : { tool, args };
      };

    // An earlier answer, made before the exclusion, that read Globex.
    w.answering(script('read_cv', { section: 'experience' }, 'You built the design system at Globex.'));
    data(await w.dispatch('conversations.append', { conversationId: cv.chatId, message: { role: 'user', text: 'What did I do at Globex?' } }));
    const earlier = await ask(w, cv, 'What did I do at Globex?');
    data(await w.dispatch('conversations.append', {
      conversationId: cv.chatId,
      message: { role: 'assistant', text: 'You built the design system at Globex.', runId: earlier.runId }
    }));
    assert.ok(wire(w.sent).includes(GLOBEX), 'before the exclusion the tool hands Globex over');

    data(await w.dispatch('selection.update', { conversationId: cv.chatId, expectedRevision: 0, exclude: [globex] }));

    // A tool.
    let before = w.sent.length;
    w.answering(script('read_cv', { section: 'experience' }, 'You worked at Acme.'));
    data(await w.dispatch('conversations.append', { conversationId: cv.chatId, message: { role: 'user', text: 'Where did I work?' } }));
    const read = await ask(w, cv, 'Where did I work?');
    const afterRead = wire(w.sent.slice(before));
    assert.ok(afterRead.includes(ACME_OLD), 'the tool still reads what is not excluded');
    assert.equal(afterRead.includes(GLOBEX), false, 'a tool does not hand over the excluded entry');
    assert.equal(afterRead.includes('design system'), false, 'nor does the history carry the answer built on it');
    data(await w.dispatch('conversations.append', {
      conversationId: cv.chatId,
      message: { role: 'assistant', text: 'You worked at Acme.', runId: read.runId }
    }));

    // A search.
    before = w.sent.length;
    w.answering(script('search_profile', { query: 'design system' }, 'Nothing about that.'));
    await ask(w, cv, 'Did I build a design system?');
    const afterSearch = w.sent.slice(before);
    assert.equal(wire(afterSearch).includes(GLOBEX), false, 'a search does not hand over the excluded passage');
    assert.equal(wire(afterSearch).includes('Globex'), false, 'nor its employer, through any part of the request');
    assert.ok(wire(afterSearch).includes('You worked at Acme.'), 'the history still carries what the exclusion does not reach');
  } finally {
    w.dispose();
  }
});

/* ------------------------------------------------------------ edits apply */

test('in a real runtime an edit proposal applies exactly its changes, to the CV as it is when accepted', async () => {
  const w = runtime();
  try {
    const cv = await withCv(w);
    const before = await stored(w, cv.contextId);
    // The model returns the section with German added and English left as it was.
    w.answering(() => ({
      text: JSON.stringify({
        languages: [
          { name: 'English', level: 'C1' },
          { name: 'Polish', level: 'native' },
          { name: 'German', level: 'B1' }
        ]
      })
    }));

    const { runId } = data<{ runId: string }>(
      await w.dispatch('run.context.start', {
        contextId: cv.contextId,
        conversationId: cv.chatId,
        capability: 'edit_cv',
        input: { instruction: 'Add German at B1.', target: cv.ref('languages') }
      })
    );
    data(await w.dispatch('run.await', { runId }));

    const { proposals } = data<{ proposals: { id: string; target?: string; changes?: unknown[] }[] }>(
      await w.dispatch('profile.proposals.list', { contextId: cv.contextId })
    );
    const [proposal] = proposals;
    assert.equal(proposal?.target, cv.ref('languages'));
    assert.ok((proposal?.changes?.length ?? 0) > 0, 'the proposal says what it changes');

    data(await w.dispatch('profile.proposals.accept', { contextId: cv.contextId, proposalId: proposal!.id }));
    const after = await stored(w, cv.contextId);
    assert.equal(after.revision, before.revision + 1, 'one write');

    assert.deepEqual(
      (after.body.languages as { name: string; level: string }[]).map((each) => `${each.name} ${each.level}`),
      ['English C1', 'Polish native', 'German B1']
    );
    const untouched = (document: Record<string, unknown>) => JSON.stringify({ ...document, languages: undefined });
    assert.equal(untouched(after.body), untouched(before.body), 'and nothing outside the section moved');
  } finally {
    w.dispose();
  }
});

/* ----------------------------------------------------------- every record */

test('in a real runtime every run leaves a closed record, whether it succeeds, fails or is cancelled, and one cut off by the process is interrupted', async () => {
  const w = runtime();
  let reopened: World | undefined;
  try {
    const cv = await withCv(w);

    const succeeded = await ask(w, cv, 'Hello?');
    assert.deepEqual([succeeded.record.state, succeeded.record.outcome], ['closed', 'succeeded']);

    w.answering(() => ({ status: 400 }));
    const failed = await ask(w, cv, 'Hello again?');
    assert.deepEqual([failed.record.state, failed.record.outcome], ['closed', 'failed']);

    w.answering(() => 'hang');
    const { runId } = data<{ runId: string }>(
      await w.dispatch('run.context.start', {
        contextId: cv.contextId,
        conversationId: cv.chatId,
        capability: 'ask_profile',
        input: { question: 'Still there?' }
      })
    );
    while (w.sent.length < 3) await new Promise((resolve) => setTimeout(resolve, 5));
    data(await w.dispatch('run.cancel', { runId }));
    await w.dispatch('run.await', { runId });
    const cancelled = data<{ record: GroundingRecord }>(await w.dispatch('runs.grounding', { runId })).record;
    assert.deepEqual([cancelled.state, cancelled.outcome], ['closed', 'cancelled']);

    // A run the process never finished: the next process to open the file says so.
    const cut = data<{ runId: string }>(
      await w.dispatch('run.context.start', {
        contextId: cv.contextId,
        conversationId: cv.chatId,
        capability: 'ask_profile',
        input: { question: 'Are you there?' }
      })
    ).runId;
    while (w.sent.length < 4) await new Promise((resolve) => setTimeout(resolve, 5));
    w.close();

    // The next process opens the file and, as the stdio host does when it starts, settles what the last one left.
    reopened = runtime(w.file);
    reopened.harness.recoverInterrupted();
    const after = data<{ record: GroundingRecord }>(await reopened.dispatch('runs.grounding', { runId: cut })).record;
    assert.equal(after.state, 'interrupted');
    assert.equal(after.outcome, undefined);
  } finally {
    reopened?.dispose();
    w.dispose();
  }
});
