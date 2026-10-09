/**
 * Saying what a message is made of before it is sent, and sending exactly that.
 *
 * A preview prepares a message the way a run does and stops where a model would
 * first be asked. `fast` is advisory (sizes, the limit, whether a run would be
 * refused) and `full` is everything a run does before generation, and answers
 * with a digest of the plan. A message sent with that digest is checked against
 * what it is made of now, and a change in between is a `plan_conflict`, before
 * any run exists.
 *
 * The questions, in order:
 *
 *   untouched    a preview calls no model, writes no run, step, event or record, and
 *                a run after it is the run it would have been
 *   fast         it says how big the message is by part, what limit it lives under,
 *                and refuses with the words a run would be refused with
 *   full         it is what a run records before generation, and its digest is the
 *                digest of that record
 *   the digest   it is the same for the same plan whatever the order, it moves with
 *                whatever the model is given and nothing else
 *   a preview    refuses what a run refuses and fails on what a run fails on
 *   approved     a plan that is still true starts a run, one that is not starts none,
 *                and a run that already exists is not a conflict
 *   the wire     the channels, their payloads, and the flag that announces them
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 115 were applied. The number is how many
 * tests failed.
 *
 * the digest:
 *   what a run read through a port is part of the plan          6
 *   what a tool handed over is part of the plan                 1
 *   everything is prepared                                      6
 *   nothing is prepared                                         14
 *   the channel is read from the end of the via                 6
 *   the digest does not filter what was prepared                5
 *   the digest depends on the order recorded                    2
 *   entries of one ref are ordered by ref alone                 1
 *   entries of one ref are not ordered by their digest          1
 *   entries of one ref are not ordered by status                1
 *   the order is by digest first                                1
 *   the ref is not in it                                        1
 *   the digest of a piece is not in it                          4
 *   what of a piece was shown is not in it                      1
 *   whether it was sent is not in it                            1
 *   who vouches for it is not in it                             1
 *   the version is in it                                        2
 *   how a piece came is in it                                   1
 *   a plan of nothing has no digest                             6
 *
 * untouched:
 *   a preview writes to the runtime's own record                12
 *   a preview's context is a run's                              3
 *   a preview's context is not marked in the run context        3
 *   a preview asks which tools to offer                         2
 *   a preview has a run's identity                              2
 *   a preview keeps what it records                             24
 *
 * fast:
 *   fast prepares like full                                     4
 *   fast gives no sizes                                         4
 *   fast gives no total                                         2
 *   fast total is the largest part                              2
 *   fast says no limit when there is one                        2
 *   fast says a limit of nothing when there is none             1
 *   fast names nothing it would go without                      1
 *   fast measures the question as the message                   2
 *   a message of no pieces is measured for them                 3
 *   the history is not a part                                   2
 *   the pieces are measured without what the message attaches   1
 *   the pieces are measured without the pins                    4
 *
 * full:
 *   full has no digest                                          15
 *   full has the digest of nothing                              9
 *   full says what was read as well                             4
 *   full says nothing of what it is made of                     6
 *   full runs no step that prepares                             16
 *   full forgets what an earlier step made                      14
 *   full says nothing of what a model step sends                13
 *   full says what a generation that sends nothing would send   1
 *   full says nothing of a generation that would call a model   3
 *   full says what was grounded by the wrong name               3
 *   full says what was blocked by the wrong name                1
 *   full says what is gone by the wrong name                    1
 *   full says nothing of what was suggested                     1
 *   full says nothing of a search that failed                   1
 *   full forgets what was grounded                              5
 *   full keeps only the first thing grounded                    0 (equivalent: one step grounds a message, so there is no second)
 *   a step that falls back is not named                         1
 *   what a run goes without is forgotten when full              1
 *
 * refusals:
 *   a defect is a verdict                                       2
 *   everything is a defect                                      6
 *   a refusal loses its words                                   4
 *   a refusal loses its code                                    6
 *   a message that cannot be made is not refused                3
 *   a size that cannot be measured is not refused               1
 *   a refused message says nothing of its size                  3
 *   a refusal is not in the answer                              5
 *   a refused message is still made                             3
 *   a step that cannot go on is a gap                           1
 *   a step that can go on is a refusal                          1
 *   a preview is of a message with no conversation              2
 *   a preview takes any input                                   24
 *   a preview takes any capability                              1
 *   a preview is made without the conversation's scope          2
 *
 * what a run records:
 *   a run does not say what fields it sends                     6
 *   a run does not say what an earlier step assembled           8
 *   a step that sends nothing assembled is not a failure        1
 *   a step that sends what nothing assembled sends it           9
 *   a tool loop does not say what it sends                      3
 *
 * approved:
 *   a run that exists is checked as a new one                   1
 *   a plan that moved is sent                                   3
 *   a plan that is the same is a conflict                       4
 *   a message that would be refused is a conflict               1
 *   a refusal loses its words                                   1
 *   a refusal loses its code                                    1
 *   a conflict is another code                                  3
 *   a conflict does not say what the plan is now                2
 *   a conflict does not say to preview again                    1
 *   the check is of a fast preview                              3
 *   the check is of no conversation                             4
 *   the check is of no capability's input                       5
 *   a plan that holds is not started                            1
 *   a start is a start without its scope                        5
 *   an approved plan is ignored                                 4
 *   every start is checked                                      2
 *   a message of an offer ignores the approved plan             1
 *   a message in a context ignores the approved plan            3
 *   a run that exists is looked for by id alone                 1
 *   a run's record has no digest                                1
 *   a run's record has the digest of nothing                    1
 *
 * the wire:
 *   the channel does not announce the preview                   1
 *   the channel announces the preview twice                     1
 *   the preview channel is always fast                          5
 *   the preview channel is always full                          2
 *   a refusal is a failure of the channel                       2
 *   a preview takes any mode                                    1
 *   a preview takes more than a message                         1
 *   a preview needs no conversation                             0 (equivalent: the runtime refuses it with the same code)
 *   a preview needs no context                                  1
 *   a preview takes an empty capability                         1
 *   an approved plan is any string                              1
 *   an approved plan is any hex                                 1
 *   an approved plan may be in capitals                         1
 *   an approved plan may be longer                              1
 *   an approved plan may be shorter                             1
 *   an approved plan may say more                               1
 *
 * the executor (run against grounding-record.test.ts, where a run's record is tested):
 *   an extraction does not say what it sends                    1
 *   a generation does not say what it sends                     1
 *   a generation says what it sends before it answers by itself 1
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { CV_KIND } from '../src/capabilities/cv/document.js';
import { digest } from '../src/grounding/digest.js';
import { isPrepared, planDigestOf } from '../src/grounding/plan.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import { beginRun } from '../src/runtime/run.js';
import { previewRun } from '../src/runtime/preview.js';
import type { Preview, PreviewMode } from '../src/runtime/preview.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { OperationError } from '../src/contracts/index.js';
import type { CapabilityMap, ChunkHit, RecordEntry } from '../src/contracts/index.js';
import { scratch } from './support/db.js';
import { ACME, ACME_TEXT, CHAT, CHAT_RUN, CONTEXT, GLOBEX, ROLE, acmeOf, chat, cv, job, refusal } from './support/chat.js';
import type { Chat } from './support/chat.js';

const QUESTION = 'What did I do with billing?';

/** A turn of this many characters, said by one side. */
const turn = (role: 'user' | 'assistant', size: number) => ({ role, text: 'h'.repeat(size) });

/** Two jobs, so that a piece can be sent while another is not. */
const TWO = (): ReturnType<typeof cv> =>
  cv([job('Acme', 'Senior Engineer', 'Rewrote the billing pipeline.'), job('Globex', 'Engineer', 'Built the search service.')]);

const preview = (c: Chat, mode: PreviewMode, input: Record<string, unknown> = {}): Promise<Preview> =>
  previewRun(c.deps, { capability: 'ask_profile', input: { question: QUESTION, ...input }, ...CHAT_RUN, mode });

const count = (c: Chat, table: string): number =>
  (c.s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/** Everything a preview must not write. */
const WRITTEN = ['runs', 'run_steps', 'events', 'grounding_record', 'grounding_entry'] as const;
const written = (c: Chat): number[] => WRITTEN.map((table) => count(c, table));

const edit = (c: Chat, change: (body: Record<string, unknown>) => Record<string, unknown>): void => {
  c.s.deps.documents.update(CONTEXT, CV_KIND, (body) => change(body as Record<string, unknown>) as never);
};

const full = async (c: Chat, input: Record<string, unknown> = {}): Promise<string> => {
  const made = await preview(c, 'full', input);
  assert.equal(made.refusal, undefined, 'the preview was refused');
  assert.ok(made.planDigest);
  return made.planDigest;
};

/* ---------------------------------------------------------------- untouched */

test('a preview calls no model, searches nothing unless it is full and asked to, and writes no run, step, event or record', async () => {
  const c = chat({ body: TWO(), search: async () => [] });
  try {
    c.pin(ACME);
    const before = written(c);

    const fast = await preview(c, 'fast', { grounding: { auto: 'on' } });
    assert.equal(fast.mode, 'fast');
    assert.equal(c.searches.count, 0, 'a fast preview prepares nothing, so it searches nothing');

    const whole = await preview(c, 'full', { grounding: { auto: 'on' } });
    assert.equal(whole.mode, 'full');
    assert.equal(c.searches.count, 1, 'a full one does what a run does before the model, which is the search');

    assert.deepEqual(c.requests, [], 'no model was asked, for the answer or to choose tools');
    assert.deepEqual(written(c), before, 'nothing was written anywhere a run writes');
  } finally {
    c.dispose();
  }
});

test('a run after a preview is the run it would have been: the model is sent what it would be sent without one', async () => {
  const input = { grounding: { once: [GLOBEX] } };
  const a = chat({ body: TWO() });
  const b = chat({ body: TWO() });
  try {
    a.pin(ACME);
    b.pin(ACME);

    await preview(a, 'fast', input);
    await preview(a, 'full', input);
    await a.turn(QUESTION, input);
    await b.turn(QUESTION, input);

    assert.deepEqual(a.requests, b.requests, 'byte for byte the same requests');
    assert.deepEqual(a.entries({ runId: 'r1', settled: Promise.resolve() as never }), b.entries({ runId: 'r1', settled: Promise.resolve() as never }));
  } finally {
    a.dispose();
    b.dispose();
  }
});

test('the context of a preview says so, and the context of a run does not', async () => {
  const seen: (boolean | undefined)[] = [];
  const probe: CapabilityMap = {
    probe: {
      name: 'probe',
      describe: 'Says whether its run is a preview.',
      input: z.object({}).passthrough(),
      needs: (_input, context) => {
        seen.push(context.preview);
        return [];
      },
      plan: () => ({ capability: 'probe', source: 'declared', stages: [] })
    }
  };
  const c = chat();
  try {
    const deps = { ...c.deps, capabilities: probe };
    await previewRun(deps, { capability: 'probe', input: {}, ...CHAT_RUN, mode: 'fast' });
    await beginRun(deps, { capability: 'probe', input: {}, ...CHAT_RUN, runId: 'probe-run' }).settled.catch(() => undefined);
    await previewRun(deps, { capability: 'probe', input: {}, ...CHAT_RUN, mode: 'full' });

    assert.deepEqual(seen, [true, undefined, true], 'both modes are previews, and the run in between is not');
  } finally {
    c.dispose();
  }
});

/* --------------------------------------------------------------------- fast */

test('fast says how big the message is by part and what limit it lives under', async () => {
  const c = chat({ body: TWO() });
  try {
    const bare = await preview(c, 'fast');
    assert.deepEqual(bare.size, { parts: { history: 0, summary: 0, posting: 0, picks: 0 }, total: 0 });
    assert.equal(bare.limit, null, 'no limit is set');
    assert.deepEqual(bare.degraded, []);
    assert.equal(bare.refusal, undefined);

    c.pin(ACME);
    c.limitStore.set(CHAT, 5_000);
    const sized = await preview(c, 'fast', {
      history: [turn('user', 100), turn('assistant', 200)],
      summary: 'a'.repeat(50),
      offerText: 'p'.repeat(70)
    });
    assert.deepEqual(sized.size, {
      parts: { history: 300, summary: 50, posting: 70, picks: ACME_TEXT.length },
      total: 300 + 50 + 70 + ACME_TEXT.length
    });
    assert.equal(sized.limit, 5_000);

    c.limitStore.set(undefined, 9_000);
    c.limitStore.set(CHAT, undefined);
    assert.equal((await preview(c, 'fast')).limit, 9_000, 'the one that binds, as a run would be held to it');

    const attached = await preview(c, 'fast', { grounding: { once: [GLOBEX] } });
    assert.equal(
      attached.size.parts.picks,
      ACME_TEXT.length + 'Experience, Engineer at Globex:\n2021 - present\n- Built the search service.'.length + 2,
      'what a message attaches is counted with what is pinned, and the two are told apart by a blank line'
    );
  } finally {
    c.dispose();
  }
});

test('fast has no digest, no entries and no grounding, and does not prepare anything', async () => {
  const c = chat({ body: TWO() });
  try {
    c.pin(ACME);
    const made = await preview(c, 'fast', { grounding: { once: [GLOBEX] } });

    assert.equal(made.planDigest, undefined);
    assert.equal(made.entries, undefined);
    assert.equal(made.grounding, undefined);
    assert.deepEqual(Object.keys(made).sort(), ['degraded', 'limit', 'mode', 'size']);
  } finally {
    c.dispose();
  }
});

test('a piece left out of the conversation is named under degraded, as a run would name it', async () => {
  const c = chat({ body: TWO() });
  try {
    c.pin(ACME);
    c.exclude(ACME);

    const made = await preview(c, 'fast');
    const run = await c.turn(QUESTION);
    const { data } = await run.settled;

    assert.deepEqual(made.degraded, ['pins']);
    assert.deepEqual(made.degraded, (await run.settled).degraded, 'the same names');
    void data;
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------ refusals */

test('a message a run would refuse is refused with the same code and words, in both modes, and no run is made', async () => {
  const cases: { name: string; code: string; build: (c: Chat) => Record<string, unknown> }[] = [
    {
      name: 'the pieces are over their own budget',
      code: 'grounding_budget',
      build: (c) => {
        c.pin(ACME);
        return {};
      }
    },
    {
      name: 'the message is over the conversation limit',
      code: 'context_limit',
      build: (c) => {
        c.limitStore.set(CHAT, 2_000);
        return { history: [turn('user', 1_500), turn('assistant', 600)] };
      }
    },
    {
      name: 'a piece is attached that is not this conversation\'s own',
      code: 'invalid_selection',
      build: () => ({ grounding: { once: ['cv:somebody-else/experience/acme~senior-engineer'] } })
    },
    {
      name: 'nothing is selected and the model has no tools',
      code: 'needs_unmet',
      build: () => ({ grounding: { reach: 'selected' } })
    }
  ];

  for (const { name, code, build } of cases) {
    const c = chat({ body: cv([acmeOf(12_001)]) });
    try {
      const input = build(c);
      const before = written(c);

      for (const mode of ['fast', 'full'] as const) {
        const made = await preview(c, mode, input);
        assert.equal(made.refusal?.code, code, `${name}, ${mode}`);
        assert.equal(made.planDigest, undefined, `${name}, ${mode}: a refused message has no plan to approve`);
        assert.equal(made.entries, undefined);
      }
      assert.deepEqual(written(c), before, `${name}: the preview made no run`);

      const run = await refusal(c.begin({ question: QUESTION, ...input }));
      assert.equal(run.code, code, name);
      assert.equal((await preview(c, 'fast', input)).refusal?.message, run.message, `${name}: the same words`);
      assert.deepEqual(c.requests, [], name);
    } finally {
      c.dispose();
    }
  }
});

test('a refused preview still says how big the message is', async () => {
  const c = chat({ body: TWO() });
  try {
    c.limitStore.set(CHAT, 2_000);
    c.pin(ACME);
    const made = await preview(c, 'fast', { history: [turn('user', 2_000)] });

    assert.equal(made.refusal?.code, 'context_limit');
    assert.deepEqual(made.size, { parts: { history: 2_000, summary: 0, posting: 0, picks: ACME_TEXT.length }, total: 2_000 + ACME_TEXT.length });
    assert.match(made.refusal?.message ?? '', /2,083 characters/);
  } finally {
    c.dispose();
  }
});

test('a preview fails as a run does on what is not a message: a capability that is not there, input that is not valid, no conversation', async () => {
  const c = chat();
  try {
    await assert.rejects(
      previewRun(c.deps, { capability: 'nothing_like_it', input: {}, ...CHAT_RUN, mode: 'fast' }),
      (error: { code?: string }) => error.code === 'unknown_capability'
    );
    await assert.rejects(
      previewRun(c.deps, { capability: 'ask_profile', input: { question: '' }, ...CHAT_RUN, mode: 'fast' }),
      (error: { code?: string }) => error.code === 'invalid_input'
    );
    await assert.rejects(
      previewRun(c.deps, { capability: 'ask_profile', input: { question: QUESTION }, contextId: CONTEXT, mode: 'full' }),
      (error: { code?: string; message?: string }) => error.code === 'invalid_input' && /conversation/.test(error.message ?? '')
    );
    assert.deepEqual(c.requests, []);
  } finally {
    c.dispose();
  }
});

/* --------------------------------------------------------------------- full */

test('full says what the message is made of: the entries, and what was done with the pieces asked for', async () => {
  const c = chat({ body: TWO() });
  try {
    c.pin(ACME);
    c.exclude(GLOBEX);
    const made = await preview(c, 'full', { grounding: { once: [GLOBEX, ROLE] } });

    assert.equal(made.refusal, undefined);
    assert.match(made.planDigest ?? '', /^[0-9a-f]{16}$/);
    assert.deepEqual(made.grounding, { included: [ACME, ROLE], blocked: [GLOBEX], gone: [], suggested: [] });

    const byRef = Object.fromEntries((made.entries ?? []).map((entry) => [entry.ref, entry.status]));
    assert.deepEqual(byRef, { [ACME]: 'included', [ROLE]: 'included', [GLOBEX]: 'blocked' });
    assert.ok((made.entries ?? []).every(isPrepared), 'what a model would be given, and not what was read to find out');
  } finally {
    c.dispose();
  }
});

test('the digest of a full preview is the digest of the record of the run it was for', async () => {
  const c = chat({ body: TWO(), search: async () => [] });
  try {
    c.pin(ACME);
    await c.turn('An earlier question.');
    const input = { grounding: { once: [ROLE] }, offerText: 'A pasted posting.', history: [] };

    const made = await preview(c, 'full', input);
    const run = await c.turn(QUESTION, input);
    const record = c.entries(run);

    assert.equal(made.planDigest, planDigestOf(record), 'one function over the same entries');
    assert.deepEqual(
      [...(made.entries ?? [])].sort((a, b) => a.ref.localeCompare(b.ref)),
      record.filter(isPrepared).sort((a, b) => a.ref.localeCompare(b.ref)),
      'and the entries are the ones the run recorded before it asked'
    );
    assert.ok(record.some((entry) => entry.via === 'port:documents'), 'the run also read the CV to measure it, which is not the plan');
    assert.ok((made.entries ?? []).some((entry) => entry.ref.startsWith(`conversation:${CHAT}/history/`)), 'the earlier exchange is in it');
    assert.ok((made.entries ?? []).some((entry) => entry.ref === `conversation:${CHAT}/attached`), 'and so is the posting that was pasted');
  } finally {
    c.dispose();
  }
});

test('a bare message has a plan of its own digest and no grounding, and a run of it records the same', async () => {
  const c = chat();
  try {
    const made = await preview(c, 'full');
    const run = await c.turn(QUESTION);

    assert.equal(made.grounding, undefined, 'it asked for no pieces');
    assert.deepEqual(made.entries, []);
    assert.equal(made.planDigest, planDigestOf([]));
    assert.equal(made.planDigest, planDigestOf(c.entries(run)));
  } finally {
    c.dispose();
  }
});

/** What a search of the index finds: one piece, Acme's, as the limits tests have it. */
const finds = (revision: number): ChunkHit[] => [
  {
    id: 'c0',
    documentId: CONTEXT,
    kind: 'highlight',
    text: 'Rewrote the billing pipeline.',
    position: 0,
    meta: { section: 'experience', entry: 0, company: 'Acme', title: 'Senior Engineer' },
    score: 1,
    sourceRevision: revision,
    found: ['lexical']
  }
];

test('auto adds what a run would add, and the digest has it: a full preview searches as a run does', async () => {
  const c = chat({ body: TWO(), search: async (revision) => finds(revision) });
  try {
    const none = await full(c);
    const asked = await preview(c, 'full', { grounding: { auto: 'on' } });

    assert.equal(c.searches.count, 1, 'it searched, once');
    assert.deepEqual(asked.grounding?.included, [ACME], 'and what it found is part of the message');
    assert.deepEqual(asked.grounding?.suggested, []);
    assert.equal(asked.entries?.find((each) => each.ref === ACME)?.via, 'ground:auto');
    assert.notEqual(asked.planDigest, none, 'so the plan is not the plan of a message that asked for none');

    const run = await c.turn(QUESTION, { grounding: { auto: 'on' } });
    assert.equal(asked.planDigest, planDigestOf(c.entries(run)), 'and it is the plan the run records');
  } finally {
    c.dispose();
  }
});

test('auto that only suggests adds nothing to the plan and names what it would suggest', async () => {
  const c = chat({ body: TWO(), search: async (revision) => finds(revision) });
  try {
    const none = await full(c);
    const asked = await preview(c, 'full', { grounding: { auto: 'suggest' } });

    assert.deepEqual(asked.grounding?.suggested, [ACME]);
    assert.deepEqual(asked.grounding?.included, []);
    assert.equal(asked.planDigest, none, 'a suggestion is not sent, so it is not approved');
  } finally {
    c.dispose();
  }
});

test('a search that does not answer is said, as a run says it, and the message goes without', async () => {
  const c = chat({
    body: TWO(),
    search: async () => {
      throw new Error('the index is not there');
    }
  });
  try {
    const asked = await preview(c, 'full', { grounding: { auto: 'on' } });

    assert.equal(asked.refusal, undefined, 'it is not a refusal');
    assert.equal(asked.grounding?.auto, 'failed');
    assert.deepEqual(asked.grounding?.included, []);
    assert.ok(asked.planDigest);

    const run = await c.turn(QUESTION, { grounding: { auto: 'on' } });
    assert.equal(asked.planDigest, planDigestOf(c.entries(run)));
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------- digest */

const entry = (over: Partial<RecordEntry> = {}): RecordEntry => ({
  ref: 'cv:c/experience/a',
  version: '3',
  digest: 'aaaaaaaaaaaaaaaa',
  status: 'included',
  origin: 'server',
  via: 'ground:pin',
  ...over
});

test('the digest is of sixteen hex characters and the same for the same plan, whatever order it was recorded in', () => {
  const a = entry({ ref: 'cv:c/experience/a' });
  const b = entry({ ref: 'cv:c/experience/b', digest: 'bbbbbbbbbbbbbbbb' });
  const c = entry({ ref: 'cv:c/skills/x', digest: 'cccccccccccccccc', status: 'blocked' });

  assert.match(planDigestOf([a, b, c]), /^[0-9a-f]{16}$/);
  assert.equal(planDigestOf([a, b, c]), planDigestOf([c, b, a]));
  assert.equal(planDigestOf([a, b, c]), planDigestOf([b, c, a]));
  assert.equal(planDigestOf([]), digest([]), 'and a plan of nothing has one');
  assert.notEqual(planDigestOf([a]), planDigestOf([]));

  // One piece may be in a plan twice: sent, and held back. Neither order is the plan's.
  const sent = entry({ status: 'included' });
  const held = entry({ status: 'blocked' });
  const changed = entry({ digest: 'dddddddddddddddd' });
  assert.equal(planDigestOf([sent, held]), planDigestOf([held, sent]), 'the same ref, told apart by whether it was sent');
  assert.equal(planDigestOf([sent, changed]), planDigestOf([changed, sent]), 'the same ref, told apart by what it said');
  assert.equal(planDigestOf([sent, held, changed]), planDigestOf([changed, held, sent]));
  assert.equal(planDigestOf([held, sent, changed]), planDigestOf([sent, changed, held]));
});

test('what moves the digest is what the model is given: a ref, its digest, what of it was shown, whether it was sent, who vouches', () => {
  const base = planDigestOf([entry()]);

  assert.notEqual(planDigestOf([entry({ ref: 'cv:c/experience/other' })]), base, 'which piece');
  assert.notEqual(planDigestOf([entry({ digest: 'dddddddddddddddd' })]), base, 'what it says');
  assert.notEqual(planDigestOf([entry({ shown: 'eeeeeeeeeeeeeeee' })]), base, 'what of it the model saw');
  assert.notEqual(planDigestOf([entry({ status: 'blocked' })]), base, 'held back');
  assert.notEqual(planDigestOf([entry({ origin: 'client' })]), base, 'who vouches for it');
  assert.notEqual(planDigestOf([entry(), entry({ ref: 'cv:c/experience/b' })]), base, 'one more');
  assert.notEqual(
    planDigestOf([entry({ shown: 'eeeeeeeeeeeeeeee' })]),
    planDigestOf([entry({ shown: 'ffffffffffffffff' })]),
    'and a different cut of it'
  );
});

test('what does not move it: the version, how the piece came, and what the run read once it was going', () => {
  const base = planDigestOf([entry()]);

  assert.equal(planDigestOf([entry({ version: '99' })]), base, 'a revision of the CV that did not touch the piece');
  assert.equal(planDigestOf([entry({ via: 'ground:once' })]), base, 'attached and not pinned');
  assert.equal(planDigestOf([entry({ via: 'ground:auto' })]), base, 'or added');
  assert.equal(planDigestOf([entry(), entry({ ref: 'cv:c', via: 'port:documents', status: 'read' })]), base, 'a document read through a port');
  assert.equal(planDigestOf([entry(), entry({ ref: 'cv:c/x', via: 'port:retrieval', status: 'read' })]), base, 'a search through a port');
  assert.equal(planDigestOf([entry(), entry({ ref: 'cv:c/y', via: 'tool:read_cv' })]), base, 'what a tool handed over');
  assert.equal(isPrepared(entry({ via: 'input' })), true, 'what the host or the conversation supplied is the plan');
});

test('a plan moves with the CV where it is sent and with nothing where it is not, and with the conversation as it grows', async () => {
  const c = chat({ body: TWO() });
  try {
    c.pin(ACME);
    const base = await full(c);

    assert.equal(await full(c), base, 'asked twice');
    assert.equal(await full(c, { question: 'A different question altogether.' }), base, 'the question is not material');

    edit(c, (body) => ({ ...body, role_description: 'Something else entirely.' }));
    assert.equal(await full(c), base, 'an edit to a part that is not sent, which moves the revision');

    edit(c, (body) => ({
      ...body,
      experience: [job('Acme', 'Senior Engineer', 'Rewrote the invoicing pipeline.'), ...(body.experience as unknown[]).slice(1)]
    }));
    const edited = await full(c);
    assert.notEqual(edited, base, 'an edit to the piece that is');

    await c.turn('An earlier question.');
    assert.notEqual(await full(c), edited, 'an exchange more in the history');
  } finally {
    c.dispose();
  }
});

test('what the person chose moves it: a pin, an attachment, an exclusion, a posting, and not the order they were chosen in', async () => {
  const a = chat({ body: TWO() });
  const b = chat({ body: TWO() });
  try {
    const base = await full(a);

    a.pin(ACME);
    const pinned = await full(a);
    assert.notEqual(pinned, base, 'a pin');

    const attached = await full(a, { grounding: { once: [ROLE] } });
    assert.notEqual(attached, pinned, 'an attachment');

    assert.equal(await full(a, { grounding: { once: [ACME] } }), pinned, 'attaching what is pinned adds nothing');

    a.exclude(ACME);
    const blocked = await full(a);
    assert.notEqual(blocked, pinned, 'a pin that is held back is a different plan');
    assert.notEqual(blocked, base, 'from a message with no pin');

    assert.notEqual(await full(a, { offerText: 'A posting.' }), blocked, 'a posting');
    assert.notEqual(await full(a, { offerText: 'Another posting.' }), await full(a, { offerText: 'A posting.' }), 'and which');

    b.pin(ACME, ROLE);
    const one = await full(b);
    const c = chat({ body: TWO() });
    try {
      c.pin(ROLE, ACME);
      assert.equal(await full(c), one, 'the order they were pinned in');
    } finally {
      c.dispose();
    }
  } finally {
    a.dispose();
    b.dispose();
  }
});

/* ---------------------------------------------------- what a preview is made of */

/** A capability of one preparing step and one generating step, as a test says. */
const staged = (
  prepare: () => Promise<Record<string, unknown>>,
  answer: { readonly directText?: () => string | undefined; readonly groundedFrom?: string },
  critical = true
): CapabilityMap => ({
  probe: {
    name: 'probe',
    describe: 'A step that prepares and a step that would call a model.',
    input: z.object({ summary: z.string().optional() }).passthrough(),
    plan: () => ({
      capability: 'probe',
      source: 'declared',
      stages: [
        { name: 'prepare', concurrency: 1, steps: [{ kind: 'transform', name: 'prepare', critical, run: prepare }] },
        {
          name: 'answer',
          concurrency: 1,
          steps: [
            {
              kind: 'generate',
              name: 'answer',
              critical: true,
              system: 's',
              prompt: 'p',
              maxOutputTokens: 10,
              key: 'answer',
              sends: [{ field: 'summary' }],
              ...answer
            }
          ]
        }
      ]
    })
  }
});

const probed = (c: Chat, capabilities: CapabilityMap): Promise<Preview> =>
  previewRun({ ...c.deps, capabilities }, { capability: 'probe', input: { summary: 'what was said before' }, ...CHAT_RUN, mode: 'full' });

test('a step that would call a model says what it would send and is not run, and one that prepares is', async () => {
  const order: string[] = [];
  const c = chat();
  try {
    const made = await probed(c, staged(async () => { order.push('prepared'); return {}; }, {}));

    assert.deepEqual(order, ['prepared']);
    assert.deepEqual((made.entries ?? []).map((each) => each.ref), [`conversation:${CHAT}/summary`]);
    assert.equal(made.entries?.[0]?.origin, 'client', 'the host sent it, and the preview says so');
    assert.deepEqual(c.requests, []);
  } finally {
    c.dispose();
  }
});

test('a generation a run answers by itself sends nothing, and the preview says nothing of it', async () => {
  const c = chat();
  try {
    const made = await probed(c, staged(async () => ({}), { directText: () => 'the answer, without a model' }));
    assert.deepEqual(made.entries, [], 'nothing would be sent, so nothing is said');

    const asking = await probed(c, staged(async () => ({}), { directText: () => undefined }));
    assert.deepEqual((asking.entries ?? []).map((each) => each.ref), [`conversation:${CHAT}/summary`], 'a generation that would ask a model is sent what it says');
  } finally {
    c.dispose();
  }
});

test('a step that prepares and cannot is a refusal when the run cannot go on without it, a gap when it can, and a defect when it is neither', async () => {
  const c = chat();
  try {
    const cannot = async (): Promise<Record<string, unknown>> => {
      throw new OperationError('invalid_selection', 'Nothing to prepare from.');
    };

    const refused = await probed(c, staged(cannot, {}));
    assert.deepEqual(refused.refusal, { code: 'invalid_selection', message: 'Nothing to prepare from.' });
    assert.equal(refused.planDigest, undefined, 'a message that would be refused has no plan to approve');
    assert.equal(refused.entries, undefined);

    const gap = await probed(c, staged(cannot, {}, false));
    assert.equal(gap.refusal, undefined);
    assert.deepEqual(gap.degraded, ['prepare'], 'what the run would go without is named');
    assert.ok(gap.planDigest);

    // An error that is not one a run would fail with by name is a defect, and is not turned into a verdict.
    const defect = async (): Promise<Record<string, unknown>> => {
      throw new Error('A defect in the step.');
    };
    await assert.rejects(probed(c, staged(defect, {})), /A defect in the step/);
  } finally {
    c.dispose();
  }
});

test('a step that says it sends what no step assembled is a defect of the capability, and is not turned into a verdict', async () => {
  const c = chat();
  try {
    await assert.rejects(probed(c, staged(async () => ({}), { groundedFrom: 'prepare' })), /assembled nothing/);
  } finally {
    c.dispose();
  }
});

test('a message that cannot be measured is refused with the reason, and says it in both modes', async () => {
  const c = chat();
  try {
    const unmeasurable: CapabilityMap = {
      probe: {
        name: 'probe',
        describe: 'A message whose size cannot be told.',
        input: z.object({}).passthrough(),
        measure: () => {
          throw new OperationError('context_limit', 'Too big to count.');
        },
        plan: () => ({ capability: 'probe', source: 'declared', stages: [] })
      }
    };
    for (const mode of ['fast', 'full'] as const) {
      const made = await previewRun({ ...c.deps, capabilities: unmeasurable }, { capability: 'probe', input: {}, ...CHAT_RUN, mode });
      assert.deepEqual(made.refusal, { code: 'context_limit', message: 'Too big to count.' }, mode);
      assert.equal(made.planDigest, undefined, mode);
    }
  } finally {
    c.dispose();
  }
});

test('a preview on a runtime that keeps no records works, and the one it keeps is not written to', async () => {
  const c = chat({ body: TWO() });
  try {
    c.pin(ACME);
    const { grounding, ...bare } = c.deps;
    void grounding;

    const made = await previewRun(bare, { capability: 'ask_profile', input: { question: QUESTION }, ...CHAT_RUN, mode: 'full' });
    assert.deepEqual(made.entries?.map((each) => each.ref), [ACME]);
    assert.equal(made.planDigest, planDigestOf(made.entries ?? []));
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------ the wire */

const world = (capabilities?: CapabilityMap) => {
  const s = scratch();
  const context = createCvContextStore(s.db).create(randomUUID(), 'en');
  const harness = createHarness({
    databasePath: s.path,
    ...(capabilities === undefined ? {} : { capabilities }),
    logger: silentLogger,
    // No model is reachable, whatever this machine happens to run: a run that is
    // started here is one that is made, and is stopped before it is answered.
    env: { LOCAL_BASE_URL: 'http://127.0.0.1:9' },
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });
  harness.profile.replaceContext(context.id, cv(TWO().experience) as never, 0);
  const profile = harness.conversations.create({ kind: 'profile', id: context.id });
  const dispatch = createDispatch(harness);
  const pieces = (name: string) => `cv:${context.id}/${name}`;

  return {
    harness,
    dispatch,
    context,
    profile,
    acme: pieces('experience/acme~senior-engineer'),
    globex: pieces('experience/globex~engineer'),
    /** The request of a message in the conversation, as a window sends it. */
    message: (over: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => ({
      contextId: context.id,
      conversationId: profile.id,
      capability: 'ask_profile',
      input: { question: QUESTION, ...input },
      ...over
    }),
    rows: (table: string): number =>
      (s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
    dispose: () => {
      harness.close();
      s.dispose();
    }
  };
};

const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const refused = (response: Response): { code: string; message: string; details?: Record<string, unknown> } => {
  assert.ok(!response.ok, 'expected a refusal');
  return response.error as { code: string; message: string; details?: Record<string, unknown> };
};

test('the channel previews a message in both modes, and a window can send back what it answered', async () => {
  const w = world();
  try {
    const { selection } = w.harness;
    selection.update(w.profile.id, { expectedRevision: 0, pin: [w.acme] });

    const fast = data<Preview>(await w.dispatch('run.preview', { ...w.message(), mode: 'fast' }));
    assert.equal(fast.mode, 'fast');
    assert.equal(fast.size.parts.picks, ACME_TEXT.length);
    assert.equal('planDigest' in fast, false);

    const whole = data<Preview>(await w.dispatch('run.preview', { ...w.message(), mode: 'full' }));
    assert.equal(whole.mode, 'full');
    assert.match(whole.planDigest ?? '', /^[0-9a-f]{16}$/);
    assert.deepEqual(whole.grounding?.included, [w.acme]);

    assert.deepEqual(JSON.parse(JSON.stringify(whole)), whole, 'plain data');
    assert.equal(w.rows('runs'), 0, 'and no run was made for either');
  } finally {
    w.dispose();
  }
});

test('a payload that is not a message and a mode is refused at the door', async () => {
  const w = world();
  try {
    const good = { ...w.message(), mode: 'fast' };
    assert.equal(data<Preview>(await w.dispatch('run.preview', good)).mode, 'fast');

    for (const [name, payload] of [
      ['no mode', w.message()],
      ['a mode that is not one', { ...good, mode: 'quick' }],
      ['an empty mode', { ...good, mode: '' }],
      ['more than a message', { ...good, extra: 1 }],
      ['no context', { ...good, contextId: undefined }],
      ['no conversation', { ...good, conversationId: undefined }],
      ['no capability', { ...good, capability: undefined }],
      ['an empty capability', { ...good, capability: '' }],
      ['an empty context', { ...good, contextId: '' }],
      ['an empty conversation', { ...good, conversationId: '' }],
      ['an approved plan, which is for sending', { ...good, approved: { planDigest: '0123456789abcdef' } }]
    ] as [string, Record<string, unknown>][]) {
      assert.equal(refused(await w.dispatch('run.preview', payload)).code, 'invalid_input', name);
    }
  } finally {
    w.dispose();
  }
});

test('the channel refuses a message that would be refused, as an answer and not as a failure', async () => {
  const w = world();
  try {
    w.harness.limits.set(w.profile.id, 2_000);
    const made = data<Preview>(
      await w.dispatch('run.preview', { ...w.message({}, { history: [turn('user', 1_500), turn('assistant', 600)] }), mode: 'full' })
    );

    assert.equal(made.refusal?.code, 'context_limit');
    assert.equal(made.planDigest, undefined);
    assert.equal(made.limit, 2_000);
    assert.equal(w.rows('runs'), 0);
  } finally {
    w.dispose();
  }
});

test('the runtime announces the preview, once, and what it stands on is still announced', async () => {
  const w = world();
  try {
    const { features } = data<{ features: string[] }>(await w.dispatch('protocol.get', {}));

    assert.equal(features.filter((feature) => feature === 'grounding-preview').length, 1);
    assert.ok(features.includes('grounding-budget'));
    assert.ok(features.includes('grounding-assembly'));
  } finally {
    w.dispose();
  }
});

/* ----------------------------------------------------------------- approved */

type World = ReturnType<typeof world>;

/**
 * Without tools, so that a run that is started does not first ask a model which to
 * offer. It is a message about the pieces that were pinned, and so needs one.
 */
const SELECTED = { grounding: { reach: 'selected' } } as const;

/** Stops a run that was started, and waits until it has stopped. */
const abandoned = async (w: World, runId: string): Promise<void> => {
  await w.dispatch('run.cancel', { runId });
  await w.dispatch('run.await', { runId });
};

/** Waits until the run has said what it sends, which it does before it asks a model, and then stops it. */
const recorded = async (w: World, runId: string, ref: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!w.harness.groundingRecords.read(runId)?.entries.some((entry) => entry.ref === ref)) {
    assert.ok(Date.now() < deadline, `the run never recorded ${ref}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await abandoned(w, runId);
};

test('a message sent with the plan that is still true starts a run, and the plan the run records is that plan', async () => {
  const w = world();
  try {
    w.harness.selection.update(w.profile.id, { expectedRevision: 0, pin: [w.acme] });
    const { planDigest } = data<Preview>(await w.dispatch('run.preview', { ...w.message({}, SELECTED), mode: 'full' }));
    assert.ok(planDigest);

    const started = data<{ runId: string }>(
      await w.dispatch('run.context.start', { ...w.message({}, SELECTED), approved: { planDigest } })
    );
    assert.equal(w.rows('runs'), 1);
    await recorded(w, started.runId, w.acme);

    const { record, planDigest: ofRun } = data<{ record: { entries: RecordEntry[] }; planDigest: string }>(
      await w.dispatch('runs.grounding', { runId: started.runId })
    );
    assert.equal(ofRun, planDigest, 'preview equals send');
    assert.equal(ofRun, planDigestOf(record.entries));
  } finally {
    w.dispose();
  }
});

test('a message sent with a plan that has changed starts no run, and says which refusal it is', async () => {
  const w = world();
  try {
    w.harness.selection.update(w.profile.id, { expectedRevision: 0, pin: [w.acme] });
    const { planDigest } = data<Preview>(await w.dispatch('run.preview', { ...w.message({}, SELECTED), mode: 'full' }));

    // The pinned piece is edited between the preview and the send.
    const stored = w.harness.documents.read(w.context.id);
    assert.ok(stored);
    w.harness.profile.replaceContext(
      w.context.id,
      { ...(stored.body as Record<string, unknown>), experience: [job('Acme', 'Senior Engineer', 'Rewrote the invoicing pipeline.'), job('Globex', 'Engineer', 'Built the search service.')] } as never,
      stored.revision
    );

    const before = [w.rows('runs'), w.rows('run_steps'), w.rows('events'), w.rows('grounding_record')];
    const error = refused(await w.dispatch('run.context.start', { ...w.message({}, SELECTED), approved: { planDigest } }));
    assert.equal(error.code, 'plan_conflict');
    assert.match(error.message, /preview/i);
    assert.deepEqual([w.rows('runs'), w.rows('run_steps'), w.rows('events'), w.rows('grounding_record')], before, 'nothing was made');

    // The same message previewed again is the plan that is true now, and goes.
    const again = data<Preview>(await w.dispatch('run.preview', { ...w.message({}, SELECTED), mode: 'full' }));
    assert.notEqual(again.planDigest, planDigest);
    assert.deepEqual(error.details, { planDigest: again.planDigest }, 'the conflict says what the plan is now, so a window can show it');
    const started = data<{ runId: string }>(
      await w.dispatch('run.context.start', { ...w.message({}, SELECTED), approved: { planDigest: again.planDigest } })
    );
    await abandoned(w, started.runId);
  } finally {
    w.dispose();
  }
});

test('a plan that is unlike the one approved in any way starts no run: another pin, an exclusion, a posting, a limit that now refuses', async () => {
  const w = world();
  try {
    const { planDigest } = data<Preview>(await w.dispatch('run.preview', { ...w.message(), mode: 'full' }));

    w.harness.selection.update(w.profile.id, { expectedRevision: 0, pin: [w.acme] });
    assert.equal(refused(await w.dispatch('run.context.start', { ...w.message(), approved: { planDigest } })).code, 'plan_conflict', 'a pin');

    assert.equal(
      refused(await w.dispatch('run.context.start', { ...w.message({}, { offerText: 'A posting.' }), approved: { planDigest } })).code,
      'plan_conflict',
      'a posting'
    );

    w.harness.limits.set(w.profile.id, 2_000);
    const refusing = w.message({}, { history: [turn('user', 1_500), turn('assistant', 600)] });
    const error = refused(await w.dispatch('run.context.start', { ...refusing, approved: { planDigest } }));
    assert.equal(error.code, 'context_limit', 'a message that a run would refuse says so, and is not a conflict');
    const would = data<Preview>(await w.dispatch('run.preview', { ...refusing, mode: 'full' }));
    assert.equal(error.message, would.refusal?.message, 'in the words the preview used');
    assert.equal(w.rows('runs'), 0);
  } finally {
    w.dispose();
  }
});

test('a run that already exists is returned and not checked, so a retry after a lost answer is not a conflict', async () => {
  const w = world();
  try {
    w.harness.selection.update(w.profile.id, { expectedRevision: 0, pin: [w.acme] });
    const first = data<{ runId: string }>(await w.dispatch('run.context.start', w.message({ runId: 'r-once' }, SELECTED)));
    await abandoned(w, first.runId);

    // What it is made of has moved on since, which is what a retry after a lost answer finds.
    w.harness.selection.update(w.profile.id, { expectedRevision: 1, pin: [w.globex] });
    const again = data<{ runId: string; recovered?: boolean }>(
      await w.dispatch('run.context.start', { ...w.message({ runId: 'r-once' }, SELECTED), approved: { planDigest: '0123456789abcdef' } })
    );

    assert.equal(again.runId, 'r-once');
    assert.equal(again.recovered, true);
    assert.equal(w.rows('runs'), 1);
  } finally {
    w.dispose();
  }
});

test('a message sent with no approved plan is started as it always was, and one with a plan that is not a digest is refused at the door', async () => {
  const w = world();
  try {
    w.harness.selection.update(w.profile.id, { expectedRevision: 0, pin: [w.acme] });
    const started = data<{ runId: string }>(await w.dispatch('run.context.start', w.message({}, SELECTED)));
    await abandoned(w, started.runId);
    assert.equal(w.rows('runs'), 1);

    for (const [name, approved] of [
      ['not a digest', { planDigest: 'plan' }],
      ['too short', { planDigest: '0123456789abcde' }],
      ['too long', { planDigest: '0123456789abcdef0' }],
      ['not hex', { planDigest: '0123456789abcdeg' }],
      ['capitals', { planDigest: '0123456789ABCDEF' }],
      ['empty', {}],
      ['more than a digest', { planDigest: '0123456789abcdef', extra: 1 }],
      ['a number', { planDigest: 123 }],
      ['null', null]
    ] as [string, unknown][]) {
      assert.equal(refused(await w.dispatch('run.context.start', { ...w.message({}, SELECTED), approved })).code, 'invalid_input', name);
    }
    assert.equal(w.rows('runs'), 1, 'none of them made a run');
  } finally {
    w.dispose();
  }
});

test('the plan of a run that has no conversation to be previewed in is not approvable, and says so', async () => {
  const w = world();
  try {
    const error = refused(
      await w.dispatch('run.context.start', {
        contextId: w.context.id,
        capability: 'ask_profile',
        input: { question: QUESTION },
        approved: { planDigest: '0123456789abcdef' }
      })
    );
    assert.equal(error.code, 'invalid_input');
    assert.match(error.message, /conversation/);
    assert.equal(w.rows('runs'), 0);
  } finally {
    w.dispose();
  }
});

test('a message about a saved offer is held to the plan that was approved as well', async () => {
  const s = scratch();
  const h = createHarness({
    databasePath: s.path,
    logger: silentLogger,
    env: { LOCAL_BASE_URL: 'http://127.0.0.1:9' },
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });
  try {
    const pl = h.cvContexts.create(randomUUID(), 'pl');
    h.profile.replaceContext(pl.id, cv(TWO().experience) as never, 0);
    h.offers.save({ id: 'offer', text: 'Original posting', url: 'https://example.com/job', firstSeenAt: 1, lastSeenAt: 1, processing: 'fetched', disposition: 'active' });
    const snapshot = h.offerSnapshots.capture({
      id: randomUUID(),
      offerId: 'offer',
      contextId: pl.id,
      expectedRevision: 1,
      expectedContextRevision: 1,
      expectedPhotoRevision: 0
    });
    const dispatch = createDispatch(h);
    const where = { contextId: pl.id, conversationId: snapshot.conversationId, offerSnapshotId: snapshot.id };
    const message = { capability: 'ask_profile', input: { question: QUESTION }, ...where };
    const runs = (): number => (s.db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n;

    const before = data<Preview>(await dispatch('run.preview', { ...message, mode: 'full' }));
    assert.ok(before.planDigest);

    // The conversation grows between the preview and the send.
    h.conversations.append(snapshot.conversationId, { role: 'user', text: 'An earlier question.' });
    h.conversations.append(snapshot.conversationId, { role: 'assistant', text: 'An earlier answer.' });

    const error = refused(await dispatch('run.offer.start', { protocolVersion: 2, runId: 'offer-run', ...message, approved: { planDigest: before.planDigest } }));
    assert.equal(error.code, 'plan_conflict');
    assert.equal(runs(), 0, 'no run was made');

    const after = data<Preview>(await dispatch('run.preview', { ...message, mode: 'full' }));
    assert.notEqual(after.planDigest, before.planDigest);
    assert.deepEqual(error.details, { planDigest: after.planDigest });
  } finally {
    h.close();
    s.dispose();
  }
});

test('a preview of a conversation that is not this context\'s is refused as a run of it is', async () => {
  const w = world();
  try {
    const other = w.harness.cvContexts.create(randomUUID(), 'pl');
    const message = w.message({ contextId: other.id });

    const previewed = refused(await w.dispatch('run.preview', { ...message, mode: 'full' }));
    const started = refused(await w.dispatch('run.context.start', message));

    assert.equal(previewed.code, 'context_conflict');
    assert.equal(previewed.code, started.code);
    assert.equal(previewed.message, started.message);
    assert.equal(w.rows('runs'), 0);
  } finally {
    w.dispose();
  }
});
