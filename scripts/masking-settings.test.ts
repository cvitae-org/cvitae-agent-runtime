/**
 * The setting that says what is kept from a model, and that it is in force.
 *
 * Three claims, and the last is the one that matters. The setting is stored like
 * the others and survives a restart, because the app has no shell to set it from.
 * A value this release does not know is refused when it is written and, if it got
 * into the file anyway, is read as the stricter of the two modes and not the looser.
 * And a change made in the settings page is in force on the next message: the
 * real harness, a real file, a CV in it, a probe that asks a model, and a `fetch`
 * that is the network.
 *
 *   stored      a fresh file has the column, empty; an older file is carried over
 *               with what it held; a mode survives a restart; `null` is the default
 *   written     a setting the caller did not name keeps what was stored, because a
 *               build of Studio older than this one does not name it and must not
 *               turn masking off by saving a provider
 *   refused     a mode nobody knows is not stored, at the channel and at the store;
 *               one in the file anyway masks everything
 *   in force    a message asked after a change is masked as the change says, with
 *               no restart in between
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 40 were applied: 40 fail at least one test here, and 0 cannot be told from the original.
 *
 * src/effects/mask.ts:
 *   the whole name is not taken as one                   1
 *   the shorter value is tried first                     1
 *   the matcher is case sensitive in the original too    4
 *   the number of a placeholder starts from zero         1
 *   a placeholder is not put right                       1
 *   a vault with seeds is reported empty                 4
 *   a match is replaced by the folded text               1
 *
 * src/effects/masking.ts:
 *   a call is never masked                               4
 *   a call is always masked                              3
 *   hosted masks the local provider                      5
 *   always masks only what hosted does                   2
 *   a text call keeps its prompt                         4
 *   a text answer is not put right                       1
 *
 * src/capabilities/cv/seeds.ts:
 *   the name is not a seed                               4
 *   the seeds are read from another document             4
 *
 * src/runtime/run.ts:
 *   a run is not masked                                  4
 *   the mode is not read from the settings               2
 *   the context is handed the unmasked effects           4
 *
 * src/runtime/create.ts:
 *   the setting is not read from the store               2
 *   the setting is read once, when the runtime is built  2
 *
 * src/contracts/mask.ts:
 *   an unknown stored mode is read as hosted             1
 *   an unknown stored mode is read as no masking         1
 *   nothing stored is always                             3
 *   there is a mode that masks nothing                   3
 *   any string is a mode                                 3
 *
 * src/adapters/ipc/dispatch.ts:
 *   a save that does not name the mode clears it         1
 *   a null mode keeps what was stored                    2
 *   the mode is not saved                                6
 *   the runtime does not say it masks                    1
 *
 * src/adapters/ipc/channels.ts:
 *   the channel takes any string for a mode              1
 *   the channel takes no mode                            7
 *   the channel does not take null for a mode            2
 *
 * src/providers/environment.ts:
 *   the store does not check a mode                      2
 *   the store checks the mode case-insensitively         1
 *   the store forgets the mode it validated              8
 *
 * src/storage/sqlite/settings.ts:
 *   the store does not keep the mode                     9
 *   the store does not read the mode                     10
 *   the store keeps a blank mode                         1
 *
 * src/storage/sqlite/migrations/0046-mask-mode.ts:
 *   the column has a default                             9
 *
 * src/storage/sqlite/migrate.ts:
 *   the column has no migration                          20
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response as Reply } from '../src/adapters/ipc/channels.js';
import type { CapabilityMap, Settings } from '../src/contracts/index.js';
import { createHarness, silentLogger, type Harness } from '../src/runtime/create.js';
import { open } from '../src/storage/sqlite/open.js';
import { createSettingsStore } from '../src/storage/sqlite/settings.js';
import { latestVersion, migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { cv } from './support/chat.js';
import { noop, stage, transform } from './support/spine.js';

const ada = {
  ...cv(),
  personal: { name: 'Ada Example', email: 'ada@example.com', phone: '+44 7700 900123', location: 'Krakow', links: {} }
};

/** What a probe asks its model, so a test can say what a run sent. */
const QUESTION = 'Write to Ada Example at ada@example.com.';

const capabilities: CapabilityMap = {
  probe: noop('probe', [
    stage('ask', [
      transform('ask', async (context) => {
        const { text } = await context.effects.ai.generateText({
          traceId: context.traceId,
          signal: context.signal,
          system: 'You help.',
          prompt: QUESTION,
          maxOutputTokens: 20,
          maxRetries: 0
        });
        return { text };
      })
    ])
  ])
};

type Bench = {
  readonly harness: Harness;
  readonly dispatch: ReturnType<typeof createDispatch>;
  readonly path: string;
  restart(env?: Readonly<Record<string, string>>): Bench;
  dispose(): void;
};

const bench = (options: { env?: Readonly<Record<string, string>>; on?: string; recorded?: boolean } = {}): Bench => {
  const dir = options.on ?? mkdtempSync(join(tmpdir(), 'harness-mask-'));
  const path = join(dir, 'harness.db');
  const harness = createHarness({
    databasePath: path,
    capabilities,
    // The table is the real one only for the test that reads it.
    ...(options.recorded ? {} : { logger: silentLogger }),
    env: options.env ?? {},
    probe: () => Promise.reject(new Error('connection refused'))
  });

  return {
    harness,
    dispatch: createDispatch(harness),
    path,
    restart(env) {
      harness.close();
      return bench({ on: dir, ...(options.recorded ? { recorded: true } : {}), ...(env ? { env } : options.env ? { env: options.env } : {}) });
    },
    dispose() {
      try {
        harness.close();
      } catch {
        // Closed by `restart`.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

const data = <T>(response: Reply): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const failure = (response: Reply): { code: string; message: string } => {
  assert.ok(!response.ok, `expected a failure, got ${JSON.stringify(response)}`);
  return response.error;
};

const stored = (it: Bench): string | undefined => it.harness.settings.read().maskMode;

const set = (it: Bench, settings: Record<string, unknown>) => it.dispatch('settings.set', { settings } as never);

/* ----------------------------------------------------------------------- stored */

test('a fresh file has the column, and it is empty', () => {
  const it = bench();

  try {
    const db = open(it.path);
    const columns = (db.prepare('PRAGMA table_info(settings)').all() as { name: string; notnull: number }[]).filter(
      (column) => column.name === 'mask_mode'
    );
    const row = db.prepare('SELECT mask_mode FROM settings WHERE id = 1').get() as { mask_mode: string | null };
    db.close();

    assert.equal(columns.length, 1);
    assert.equal(columns[0]!.notnull, 0, 'nullable, so that a row that was there before has nothing in it');
    assert.equal(row.mask_mode, null);
    assert.equal(stored(it), undefined, 'and nothing stored is the default, which is not a string in the file');
    assert.ok(latestVersion >= 46);
  } finally {
    it.dispose();
  }
});

test('a file from before the setting is carried over with what it held, and nothing in its place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-mask-old-'));
  const db = open(join(dir, 'harness.db'));

  try {
    migrate(db, migrations.filter((each) => each.version <= 45));
    assert.equal(
      (db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]).some((column) => column.name === 'mask_mode'),
      false,
      'before'
    );

    db.prepare("UPDATE settings SET provider_id = 'openai', model_id = 'gpt-4o-mini' WHERE id = 1").run();
    assert.equal(migrate(db), latestVersion);

    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, unknown>;
    assert.equal(row.provider_id, 'openai');
    assert.equal(row.model_id, 'gpt-4o-mini');
    assert.equal(row.mask_mode, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a mode chosen in the app is still chosen after a restart, whatever the shell says', async () => {
  let it = bench();

  try {
    const reply = data<{ settings: Settings }>(await set(it, { maskMode: 'always' }));
    assert.equal(reply.settings.maskMode, 'always');

    it = it.restart({ AI_PROVIDER: 'local', MASK_MODE: 'hosted' });
    assert.equal(stored(it), 'always');
    assert.equal(data<{ settings: Settings }>(await it.dispatch('settings.get', {})).settings.maskMode, 'always');
  } finally {
    it.dispose();
  }
});

test('the mode is not a setting of the environment, and says nothing of which model is reached', async () => {
  const it = bench({ env: { AI_PROVIDER: 'openai', AI_MODEL: 'gpt-4o' } });

  try {
    await set(it, { maskMode: 'always' });
    const status = data<{ providerId: string; modelId: string }>(await it.dispatch('providers.status', {}));
    assert.equal(status.providerId, 'openai');
    assert.equal(status.modelId, 'gpt-4o');
  } finally {
    it.dispose();
  }
});

/* ---------------------------------------------------------------------- written */

test('a mode is changed to the other, and back to the default with null', async () => {
  const it = bench();

  try {
    assert.equal(stored(it), undefined);
    assert.equal(data<{ settings: Settings }>(await set(it, { maskMode: 'hosted' })).settings.maskMode, 'hosted');
    assert.equal(data<{ settings: Settings }>(await set(it, { maskMode: 'always' })).settings.maskMode, 'always');
    assert.equal(data<{ settings: Settings }>(await set(it, { maskMode: null })).settings.maskMode, undefined);
    assert.equal(stored(it), undefined);
  } finally {
    it.dispose();
  }
});

test('a save that does not name the mode keeps it, as Studio before this one saves', async () => {
  const it = bench();

  try {
    await set(it, { maskMode: 'always' });

    const saved = data<{ settings: Settings }>(await set(it, { providerId: 'openai', modelId: 'gpt-4o-mini' })).settings;
    assert.equal(saved.providerId, 'openai');
    assert.equal(saved.maskMode, 'always', 'a provider was saved, and what is kept from it is as it was');

    const cleared = data<{ settings: Settings }>(await set(it, {})).settings;
    assert.equal(cleared.providerId, undefined, 'the other settings are as they were: not naming one clears it');
    assert.equal(cleared.maskMode, 'always');
  } finally {
    it.dispose();
  }
});

test('a mode set alongside the others is stored with them', async () => {
  const it = bench();

  try {
    const saved = data<{ settings: Settings }>(
      await set(it, { providerId: 'openai', modelId: 'gpt-4o-mini', maskMode: 'always' })
    ).settings;
    assert.deepEqual(
      { provider: saved.providerId, model: saved.modelId, mode: saved.maskMode },
      { provider: 'openai', model: 'gpt-4o-mini', mode: 'always' }
    );
  } finally {
    it.dispose();
  }
});

test('providers.status accepts the field and says nothing of it', async () => {
  const it = bench({ env: { AI_PROVIDER: 'local' } });

  try {
    const status = await it.dispatch('providers.status', { settings: { providerId: 'local', maskMode: 'always' } } as never);
    assert.ok(status.ok, JSON.stringify(status));
    assert.equal(stored(it), undefined, 'a draft is not a save');
  } finally {
    it.dispose();
  }
});

test('protocol.get says the runtime masks, once', async () => {
  const it = bench();

  try {
    const { features } = data<{ features: string[] }>(await it.dispatch('protocol.get', {}));
    assert.equal(features.filter((feature) => feature === 'masking').length, 1);
    assert.equal(new Set(features).size, features.length, 'and every other once');
  } finally {
    it.dispose();
  }
});

/* ---------------------------------------------------------------------- refused */

test('a mode nobody knows is refused at the channel, and what was stored stays', async () => {
  const it = bench();

  try {
    await set(it, { maskMode: 'always' });

    for (const bad of ['off', 'never', 'ALWAYS', '', 'hosted ', 7]) {
      const refused = failure(await set(it, { maskMode: bad }));
      assert.equal(refused.code, 'invalid_input', `${JSON.stringify(bad)}`);
      assert.equal(stored(it), 'always', 'and nothing of it reached the file');
    }
  } finally {
    it.dispose();
  }
});

test('a mode nobody knows is refused by the store too, and in force of nothing', () => {
  const it = bench();

  try {
    assert.throws(
      () => it.harness.settings.write({ maskMode: 'off' }),
      (error: unknown) => (error as { code?: string }).code === 'misconfigured' && /Unknown mask mode "off"/.test(String(error))
    );
    assert.equal(stored(it), undefined);
    assert.equal(it.harness.settings.write({ maskMode: 'always' }).maskMode, 'always');
    assert.equal(it.harness.settings.write({ maskMode: '  ' }).maskMode, undefined, 'a blank is no value, as with every setting');
  } finally {
    it.dispose();
  }
});

test('a mode is spelled as this release spells it, and nothing else is a mode', () => {
  const it = bench();

  try {
    for (const spelled of ['Hosted', 'ALWAYS', 'always,', 'off', 'none']) {
      assert.throws(
        () => it.harness.settings.write({ maskMode: spelled }),
        (error: unknown) => (error as { code?: string }).code === 'misconfigured',
        spelled
      );
    }
    assert.equal(stored(it), undefined);
    assert.equal(it.harness.settings.write({ maskMode: ' hosted ' }).maskMode, 'hosted', 'padding is not part of the word');
  } finally {
    it.dispose();
  }
});

test('the table is never given a blank, whoever writes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-mask-blank-'));
  const db = open(join(dir, 'harness.db'));

  try {
    migrate(db);
    const store = createSettingsStore(db);

    assert.equal(store.replace({ maskMode: '   ' }).maskMode, undefined);
    assert.equal((db.prepare('SELECT mask_mode FROM settings WHERE id = 1').get() as { mask_mode: unknown }).mask_mode, null);
    assert.equal(store.replace({ maskMode: ' always ' }).maskMode, 'always');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------------------- in force */

type Wire = { readonly url: string; readonly body: string };

const completion = (text: string): Response =>
  new Response(
    JSON.stringify({
      id: 'cmpl',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

/** The network, for as long as `run` takes: every request is kept and answered with a sentence. */
const onTheWire = async (run: (wire: Wire[]) => Promise<void>): Promise<void> => {
  const wire: Wire[] = [];
  const real = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }): Promise<Response> => {
    wire.push({
      url: typeof input === 'string' ? input : ((input as { url?: string }).url ?? String(input)),
      body: typeof init?.body === 'string' ? init.body : ''
    });
    return completion('Dear [NAME_1].');
  }) as typeof globalThis.fetch;

  try {
    await run(wire);
  } finally {
    globalThis.fetch = real;
  }
};

const withProfile = (it: Bench): void => {
  it.harness.profile.replace(ada as never);
};

const sends = async (it: Bench): Promise<Wire> => {
  let sent: Wire | undefined;

  await onTheWire(async (wire) => {
    await it.harness.run({ capability: 'probe', input: {} });
    sent = wire.at(-1);
  });

  assert.ok(sent, 'a model was asked');
  return sent;
};

const carries = (wire: Wire): { name: boolean; email: boolean; placeholder: boolean } => ({
  name: wire.body.includes('Ada Example'),
  email: wire.body.includes('ada@example.com'),
  placeholder: /\[(NAME|EMAIL)_\d\]/.test(wire.body)
});

const OPENROUTER = { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-not-a-real-key' };

test('a hosted model is asked nothing of the person with nothing set, and the answer is theirs', async () => {
  const it = bench({ env: OPENROUTER });

  try {
    withProfile(it);
    assert.equal(stored(it), undefined);

    const wire = await sends(it);
    assert.match(wire.url, /openrouter/);
    assert.deepEqual(carries(wire), { name: false, email: false, placeholder: true });
  } finally {
    it.dispose();
  }
});

test('a model on the machine is asked what it always was with nothing set', async () => {
  const it = bench({ env: { AI_PROVIDER: 'local' } });

  try {
    withProfile(it);
    const wire = await sends(it);
    assert.match(wire.url, /localhost:11434/);
    assert.deepEqual(carries(wire), { name: true, email: true, placeholder: false });
  } finally {
    it.dispose();
  }
});

test('a change to always is in force on the next message, with no restart, and a change back is too', async () => {
  const it = bench({ env: { AI_PROVIDER: 'local' } });

  try {
    withProfile(it);
    assert.equal((await sends(it)).body.includes('Ada Example'), true, 'before');

    await set(it, { maskMode: 'always' });
    assert.deepEqual(carries(await sends(it)), { name: false, email: false, placeholder: true }, 'after');

    await set(it, { maskMode: null });
    assert.equal((await sends(it)).body.includes('Ada Example'), true, 'and back');
  } finally {
    it.dispose();
  }
});

test('a mode that is in the file and is not one this release knows masks everything', async () => {
  const it = bench({ env: { AI_PROVIDER: 'local' } });

  try {
    withProfile(it);
    assert.equal((await sends(it)).body.includes('Ada Example'), true, 'on this machine and with nothing set, it is not masked');

    const db = open(it.path);
    db.prepare("UPDATE settings SET mask_mode = 'a-mode-from-a-later-release' WHERE id = 1").run();
    db.close();

    assert.deepEqual(carries(await sends(it)), { name: false, email: false, placeholder: true });
  } finally {
    it.dispose();
  }
});

test('a run is answered in the person’s words and not in placeholders', async () => {
  const it = bench({ env: OPENROUTER });

  try {
    withProfile(it);

    await onTheWire(async () => {
      const result = await it.harness.run({ capability: 'probe', input: {} });
      assert.deepEqual(result.data, { text: 'Dear Ada Example.' });
    });
  } finally {
    it.dispose();
  }
});

test('the record of the model calls holds none of the person’s values, under either mode', async () => {
  for (const mode of ['hosted', 'always'] as const) {
    const it = bench({ env: OPENROUTER, recorded: true });

    try {
      withProfile(it);
      await set(it, { maskMode: mode });
      await sends(it);

      const reader = open(it.path);
      try {
        const rows = reader.prepare('SELECT * FROM ai_calls').all();
        assert.ok(rows.length > 0, `${mode}: the call was recorded`);
        for (const value of ['Ada', 'Example', 'ada@example.com', '7700', '900123']) {
          assert.equal(JSON.stringify(rows).includes(value), false, `${mode}: ${value}`);
        }
      } finally {
        reader.close();
      }
    } finally {
      it.dispose();
    }
  }
});

test('the CV is not touched by a run that was masked', async () => {
  const it = bench({ env: OPENROUTER });

  try {
    withProfile(it);
    await set(it, { maskMode: 'always' });
    await sends(it);

    const { personal } = (it.harness.profile.read()?.body ?? {}) as { personal?: { name?: string; email?: string } };
    assert.equal(personal?.name, 'Ada Example');
    assert.equal(personal?.email, 'ada@example.com');
  } finally {
    it.dispose();
  }
});
