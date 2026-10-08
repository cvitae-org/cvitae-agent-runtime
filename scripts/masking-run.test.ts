/**
 * Where a run is masked, and what it is masked with.
 *
 * `masking-gateway.test.ts` holds the wrapper to its contract and
 * `masking-egress.test.ts` holds the real gateway to the bytes it sends. This file
 * holds the one thing neither can: that a run is handed the wrapper at all, with
 * the person's own CV behind it. A wrapper nothing is handed is a mask that is
 * never on, and no test of the wrapper would say so.
 *
 *   handed         a run's model is the masked one under `always`, and under
 *                  `hosted` when the provider is one that is not on the machine;
 *                  a runtime that was never told to mask hands the gateway on as
 *                  it always did; a preview is not wrapped
 *   asked          the mode is asked once for each run, so a change in settings is
 *                  in force on the next message and not the next launch
 *   seeds          what is kept is read from the stored CV even when a message
 *                  leaves its piece out; a CV that cannot be read, or has nothing
 *                  of the person's in it, has no seeds and fails nothing (what
 *                  has the shape of an identifier is still kept, `detect.ts`); a
 *                  run that may not read the CV (discovery) is not refused for that
 *   returned       what the model says is put right before it is a message, and
 *                  before it is an answer
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 67 were applied: 67 fail at least one test here, and 0 cannot be told from the original.
 *
 * src/effects/detect.ts:
 *   a British number has eleven digits after its code                             1
 *   a number is cut one digit late                                                1
 *   a NIP needs no label                                                          1
 *   every address is a file                                                       1
 *   a LinkedIn profile is not one                                                 1
 *   a LinkedIn profile may not be called in                                       1
 *   a handle needs no network before it                                           1
 *   a detector is not run when its guard fails to find                            1
 *   what a detector found is not passed on                                        1
 *   a detector with no fit finds nothing                                          1
 *   the kinds are not the detector's                                              1
 *   the email detector finds nothing                                              1
 *   the profile detector finds nothing                                            1
 *   the phone with country code detector finds nothing                            1
 *   the email detector names what it finds wrongly                                1
 *   the profile detector names what it finds wrongly                              1
 *   the phone with country code detector names what it finds wrongly              1
 *
 * src/effects/mask.ts:
 *   a vault with no seeds is empty whether or not it detects                      1
 *   a vault that does not detect is not empty when it has no seeds                1
 *   a vault with no seeds returns the text before it detects                      1
 *   a vault never detects                                                         1
 *   a vault gives the later span when two begin together                          6
 *   a vault takes a span that begins where another ends                           2
 *   a text with a shape in it is returned as it was                               8
 *   the whole name is not taken as one                                            1
 *   the shorter value is tried first                                              1
 *   the matcher is case sensitive in the original too                             6
 *   placeholders are numbered across kinds                                        2
 *   the number of a placeholder starts from zero                                  2
 *   a placeholder is not put right                                                1
 *   a vault with seeds is reported empty                                          8
 *   a match is replaced by the folded text                                        1
 *
 * src/effects/masking.ts:
 *   the gateway never detects                                                     1
 *   a call is never masked                                                        9
 *   a call is always masked                                                       2
 *   hosted masks the local provider                                               3
 *   always masks only what hosted does                                            7
 *   the seeds are asked once, at the first call                                   1
 *   a structured call keeps its prompt                                            6
 *   a text call keeps its prompt                                                  2
 *   a loop keeps its prompt                                                       6
 *   a loop answer is not put right                                                1
 *   a mode that is a word is called                                               12
 *
 * src/runtime/run.ts:
 *   the run does not ask for detectors                                            1
 *   a run is not masked                                                           11
 *   a preview is masked                                                           1
 *   a runtime with no mode is masked                                              2
 *   the mode is not read from the settings                                        8
 *   what is kept is read from what the message may see                            1
 *   a run that may not read the CV is refused                                     1
 *   a run that cannot read its CV is not masked                                   1
 *   a run is masked of nothing when its CV is unreadable for a reason of its own  1
 *   the rest of the effects are lost to the masked ones                           1
 *   the context is handed the unmasked effects                                    10
 *   the mode is read at each call, not once                                       1
 *   a run is not given detectors                                                  1
 *
 * src/capabilities/cv/seeds.ts:
 *   the location is a seed                                                        2
 *   the email is not a seed                                                       1
 *   the phone is not a seed                                                       1
 *   the name is not a seed                                                        8
 *   the links are not seeds                                                       1
 *   only the first link is a seed                                                 1
 *   the keys of the links are the seeds                                           3
 *   a blank value is a seed                                                       1
 *   a CV that does not parse is refused                                           2
 *   a CV that does not parse is read as far as it can be                          1
 *   the seeds are read from another document                                      9
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiGateway, MaskMode, RunContext } from '../src/contracts/index.js';
import { cvSeeds } from '../src/capabilities/cv/seeds.js';
import { OperationError } from '../src/contracts/index.js';
import { bindDiscoveryScope } from '../src/runtime/discovery-scope.js';
import { beginRun, buildRunContext, scopedDeps } from '../src/runtime/run.js';
import type { RuntimeDeps } from '../src/runtime/run.js';
import { CHAT, CHAT_RUN, CONTEXT, chat, cv, ref, settle } from './support/chat.js';
import type { Chat, ChatOptions } from './support/chat.js';

const ada = {
  ...cv(),
  personal: {
    name: 'Ada Example',
    email: 'ada@example.com',
    phone: '+44 7700 900123',
    location: 'Krakow',
    links: { linkedin: 'https://www.linkedin.com/in/ada-example' }
  }
};

const ASKED = 'Does Ada Example (ada@example.com, +44 7700 900123) have billing experience? See linkedin.com/in/ada-example.';

const values = ['Ada Example', 'ada@example.com', '+44 7700 900123', '7700 900123', 'linkedin.com/in/ada-example'];

const rig = (over: ChatOptions = {}): Chat => chat({ body: ada, ...over });

/** The runtime as the host builds it: a mode, and a model that is where a test says it is. */
const masked = (c: Chat, mode: () => MaskMode, providerId = 'openrouter'): RuntimeDeps => ({
  ...c.deps,
  masking: { mode },
  effects: {
    ...c.deps.effects,
    ai: { ...c.deps.effects.ai, describe: () => ({ providerId, modelId: 'a-model' }) } as AiGateway
  }
});

const ask = async (deps: RuntimeDeps, question = ASKED) => {
  const run = beginRun(deps, { capability: 'ask_profile', input: { question }, ...CHAT_RUN });
  await run.settled;
  return run;
};

const leaks = (c: Chat): string[] =>
  c.requests.flatMap((request) =>
    values.filter((value) =>
      [request.system, request.prompt, ...request.history].some((text) => text.toLowerCase().includes(value.toLowerCase()))
    )
  );

const fields = (over: Record<string, unknown> = {}) => ({
  runId: 'r',
  traceId: 't',
  contextId: CONTEXT,
  conversationId: CHAT,
  capability: 'ask_profile',
  input: {},
  signal: new AbortController().signal,
  deadlineAt: 0,
  ...over
});

/** The context a run of this runtime would be handed, built the way a run builds it. */
const contextOf = (deps: RuntimeDeps, over: Record<string, unknown> = {}): RunContext =>
  buildRunContext(scopedDeps(deps, CONTEXT, CHAT), fields(over) as never);

/* ----------------------------------------------------------------------- handed */

test('under always a run asks its model nothing of the person, and is answered in their words', async () => {
  const c = rig({ answer: () => 'It is [NAME_1], at [EMAIL_1] or on [PHONE_1].' });

  try {
    const run = await ask(masked(c, () => 'always', 'local'));
    const { data } = await settle(run);

    assert.ok(c.requests.length >= 2, 'the plan and the answer were both asked for');
    assert.deepEqual(leaks(c), []);
    assert.ok(c.requests.some((request) => /\[NAME_\d\]/.test(request.prompt)), 'what was sent says who in placeholders');
    assert.match(JSON.stringify(data), /Ada Example/, 'the answer says who, as the person knows them');
    assert.match(JSON.stringify(data), /ada@example\.com/);
    assert.doesNotMatch(JSON.stringify(data), /\[(NAME|EMAIL|PHONE)_\d\]/);
  } finally {
    c.dispose();
  }
});

test('under hosted a run to a provider that is not on the machine is masked', async () => {
  const c = rig();

  try {
    await ask(masked(c, () => 'hosted', 'openai'));
    assert.deepEqual(leaks(c), []);
    assert.ok(c.requests.some((request) => /\[NAME_\d\]/.test(request.prompt)));
  } finally {
    c.dispose();
  }
});

test('under hosted a run to a model on the machine is asked exactly what it was before', async () => {
  const c = rig();
  const before = rig();

  try {
    await ask(masked(c, () => 'hosted', 'local'));
    await ask(before.deps);

    assert.ok(c.requests.some((request) => request.prompt.includes('Ada Example')));
    assert.equal(c.requests.some((request) => /\[(NAME|EMAIL|PHONE|LINK)_\d\]/.test(request.prompt)), false);
    assert.deepEqual(c.requests, before.requests, 'byte for byte, request for request');
  } finally {
    c.dispose();
    before.dispose();
  }
});

test('a runtime that was never told to mask hands its model on as it always did, whoever the provider is', async () => {
  const c = rig();

  try {
    const deps: RuntimeDeps = {
      ...c.deps,
      effects: { ...c.deps.effects, ai: { ...c.deps.effects.ai, describe: () => ({ providerId: 'openai', modelId: 'm' }) } as AiGateway }
    };
    assert.equal(deps.masking, undefined);

    await ask(deps);
    assert.ok(c.requests.some((request) => request.prompt.includes('Ada Example')));
    assert.equal(contextOf(deps).effects.ai, deps.effects.ai, 'the very object, not a wrapper of it');
  } finally {
    c.dispose();
  }
});

test('a context is handed the masked model, and a preview the one it was', () => {
  const c = rig();

  try {
    const deps = masked(c, () => 'always');

    assert.notEqual(contextOf(deps).effects.ai, deps.effects.ai);
    assert.equal(contextOf(deps, { preview: true }).effects.ai, deps.effects.ai, 'a preview asks no model');
    assert.equal(contextOf(deps, { preview: true }).effects, deps.effects);
    assert.equal(contextOf(deps).effects.offers, deps.effects.offers, 'and everything else of the effects is as it was');
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------------ asked */

test('the mode is asked for each run, and not before it', async () => {
  const c = rig();
  const asked: string[] = [];
  let mode: MaskMode = 'hosted';

  try {
    const deps = masked(
      c,
      () => {
        asked.push(mode);
        return mode;
      },
      'openrouter'
    );

    assert.equal(asked.length, 0, 'not when the runtime is built');

    await ask(deps);
    assert.equal(asked.length, 1, 'once for a run, not once for each call it makes');
    assert.ok(c.requests.length >= 2);

    mode = 'always';
    await ask(deps);
    assert.deepEqual(asked, ['hosted', 'always']);
  } finally {
    c.dispose();
  }
});

test('a change of mode between two messages is in force on the second', async () => {
  const c = rig();
  let mode: MaskMode = 'hosted';

  try {
    // On this machine, so the first message is not masked and the second is.
    const deps = masked(c, () => mode, 'local');

    await ask(deps);
    const first = c.requests.length;
    assert.ok(c.requests.some((request) => request.prompt.includes('Ada Example')));
    assert.equal(leaks(c).length > 0, true);

    mode = 'always';
    await ask(deps);
    assert.deepEqual(leaks({ requests: c.requests.slice(first) } as Chat), []);
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------------ seeds */

test('what is kept is read from the stored CV and not from what a message is allowed to see', async () => {
  const c = rig();

  try {
    c.exclude(ref('overview/personal'));
    assert.ok(c.selections.walls(CHAT).length > 0, 'the piece is left out of what the model reads');

    await ask(masked(c, () => 'always', 'local'));
    assert.deepEqual(leaks(c), [], 'and a name that is left out of a message is still a name');
  } finally {
    c.dispose();
  }
});

test('what is kept is what the CV says now, at each call and not when the run began', async () => {
  const c = rig();

  try {
    const deps = masked(c, () => 'always', 'local');
    const context = contextOf(deps);

    await context.effects.ai.generateText({ traceId: 't', signal: new AbortController().signal, system: 's', prompt: 'Ada Example', maxOutputTokens: 10 });
    assert.doesNotMatch(c.requests.at(-1)!.prompt, /Ada Example/);

    c.s.deps.documents.update(CONTEXT, 'cv', (body) => ({
      ...(body as Record<string, unknown>),
      personal: { ...ada.personal, name: 'Grace Hopper' }
    }) as never);

    await context.effects.ai.generateText({ traceId: 't', signal: new AbortController().signal, system: 's', prompt: 'Grace Hopper and Ada Example', maxOutputTokens: 10 });
    assert.doesNotMatch(c.requests.at(-1)!.prompt, /Grace|Hopper/);
    assert.match(c.requests.at(-1)!.prompt, /Ada Example/, 'the name that is no longer on the CV is a name like any other');
  } finally {
    c.dispose();
  }
});

test('a CV with nothing of the person in it keeps no name from the model, and still keeps what has the shape of an identifier', async () => {
  const c = rig({ body: { ...cv(), personal: { name: '', email: '', phone: '', location: 'Krakow', links: {} } } });

  try {
    const deps = masked(c, () => 'always', 'local');
    await ask(deps);

    assert.ok(c.requests.some((request) => request.prompt.includes('Ada Example')), 'there is no name to keep, and a name has no shape');
    for (const shaped of ['ada@example.com', '+44 7700 900123', 'linkedin.com/in/ada-example']) {
      assert.equal(c.requests.some((request) => request.prompt.includes(shaped)), false, `${shaped} is an identifier by its shape`);
    }
    assert.ok(c.requests.every((request) => /\[EMAIL_1\]/.test(request.prompt) && /\[PHONE_1\]/.test(request.prompt) && /\[LINK_1\]/.test(request.prompt)));
  } finally {
    c.dispose();
  }
});

test('a CV that cannot be read masks nothing and fails nothing', async () => {
  const c = rig();

  try {
    const deps = masked(c, () => 'always', 'local');
    const unreadable: RuntimeDeps = {
      ...deps,
      scopeCv: (...scope) => ({
        ...deps.scopeCv!(...scope),
        documents: {
          read: () => ({ body: { personal: 7 }, revision: 1, updatedAt: 1 }) as never,
          update: deps.documents.update
        }
      })
    };

    const run = await ask(unreadable);
    assert.equal((await run.settled) !== undefined, true, 'the run settled and was not refused');
    assert.ok(c.requests.some((request) => request.prompt.includes('Ada Example')));
  } finally {
    c.dispose();
  }
});

test('what a CV gives to keep is its name, email, phone and every link, in that order, and nothing else', () => {
  const seeds = cvSeeds({
    read: () =>
      ({
        body: {
          personal: {
            name: 'Ada Example',
            email: 'ada@example.com',
            phone: '+44 7700 900123',
            location: 'Krakow',
            links: { linkedin: 'https://www.linkedin.com/in/ada-example', github: 'https://github.com/ada-example' }
          }
        }
      }) as never
  });

  assert.deepEqual(seeds, [
    { kind: 'name', value: 'Ada Example' },
    { kind: 'email', value: 'ada@example.com' },
    { kind: 'phone', value: '+44 7700 900123' },
    { kind: 'link', value: 'https://www.linkedin.com/in/ada-example' },
    { kind: 'link', value: 'https://github.com/ada-example' }
  ]);
});

test('a value the CV leaves blank is not something to keep', () => {
  const seeds = cvSeeds({
    read: () =>
      ({
        body: { personal: { name: 'Ada Example', email: '', phone: '   ', location: '', links: { site: '', github: ' ' } } }
      }) as never
  });

  assert.deepEqual(seeds, [{ kind: 'name', value: 'Ada Example' }]);
});

test('a personal section that does not read is no seeds, and not a failure', () => {
  const read = (personal: unknown) => cvSeeds({ read: () => ({ body: { personal } }) as never });

  assert.deepEqual(read({ name: 'Ada Example', email: 42 }), []);
  assert.deepEqual(read({ name: 'Ada Example', links: ['x'] }), []);
  assert.deepEqual(read(undefined), []);
  assert.deepEqual(cvSeeds({ read: () => undefined }), []);
});

test('a place is told to the model, and every link of the CV is kept from it', async () => {
  const c = rig({
    body: {
      ...ada,
      personal: { ...ada.personal, links: { linkedin: 'https://www.linkedin.com/in/ada-example', github: 'https://github.com/ada-example' } }
    }
  });

  try {
    await ask(
      masked(c, () => 'always', 'local'),
      'Is Ada Example in Krakow? Her GitHub profile is github.com/ada-example, her LinkedIn is linkedin.com/in/ada-example.'
    );

    const prompts = c.requests.map((request) => request.prompt).join('\n');
    assert.match(prompts, /Krakow/, 'a city is shared by too many people to be a person');
    assert.match(prompts, /GitHub profile/, 'the name of a site is not a link');
    assert.match(prompts, /LinkedIn is/);
    assert.doesNotMatch(prompts, /ada-example/i, 'both links were kept, and not only the first');
    assert.equal((prompts.match(/\[LINK_\d\]/g) ?? []).length >= 2, true);
  } finally {
    c.dispose();
  }
});

test('a CV that cannot be read for a reason of its own is a failure and not a pass-through', async () => {
  const c = rig();

  try {
    const deps = masked(c, () => 'always', 'local');
    const failing: RuntimeDeps = {
      ...deps,
      scopeCv: (...scope) => ({
        ...deps.scopeCv!(...scope),
        documents: {
          read: () => {
            throw new OperationError('invalid_input', 'the store is unreadable');
          },
          update: deps.documents.update
        }
      })
    };

    const requested = c.requests.length;
    const run = beginRun(failing, { capability: 'ask_profile', input: { question: ASKED }, ...CHAT_RUN });
    await run.settled.catch(() => undefined);

    // A mask that is skipped because its seeds could not be had is a model that is
    // sent the person's name. Fail closed: no model was asked anything at all.
    assert.deepEqual(c.requests.slice(requested), [], 'a run whose CV could not be read asked no model');
  } finally {
    c.dispose();
  }
});

test('discovery, which may not read the CV, is masked of nothing and is not refused for it', async () => {
  const c = rig();

  try {
    const deps = bindDiscoveryScope(masked(c, () => 'always', 'openrouter'));
    const context = buildRunContext(deps, fields({ contextId: undefined, conversationId: undefined }) as never);

    assert.throws(() => deps.documents.read('cv'), (error: unknown) => error instanceof OperationError && error.code === 'search_scope');

    const result = await context.effects.ai.generateText({
      traceId: 't',
      signal: new AbortController().signal,
      system: 's',
      prompt: 'Which offers pay best in Krakow?',
      maxOutputTokens: 10
    });

    assert.equal(result.text, 'x');
    assert.equal(c.requests.at(-1)!.prompt, 'Which offers pay best in Krakow?', 'and the question is as it was asked');
  } finally {
    c.dispose();
  }
});

test('a snapshot of an offer is masked with the CV it was captured with', async () => {
  const c = rig();

  try {
    const base = masked(c, () => 'always', 'openrouter');
    const snapshot: RuntimeDeps = {
      ...base,
      scopeOffer: () => ({ ...c.deps.scopeCv!(CONTEXT, CHAT), effects: base.effects })
    };

    const context = buildRunContext(
      scopedDeps(snapshot, undefined, CHAT, undefined, undefined, 'a-snapshot'),
      fields({ offerSnapshotId: 'a-snapshot' }) as never
    );
    await context.effects.ai.generateText({ traceId: 't', signal: new AbortController().signal, system: 's', prompt: 'Ada Example', maxOutputTokens: 10 });

    assert.doesNotMatch(c.requests.at(-1)!.prompt, /Ada Example/);
  } finally {
    c.dispose();
  }
});
