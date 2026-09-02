/**
 * Which model this runtime talks to, and the one thing that must never be
 * written down.
 *
 * Two claims are load-bearing here and neither is about convenience. The first
 * is that a provider choice survives a restart, because the application has no
 * shell in front of it and an environment variable is a setting its user cannot
 * set. The second is that a credential does not: the settings table has no
 * column for one, and the test for that reads the database files off the disk
 * rather than querying them, so a key that reached a freelist page or a WAL
 * frame would still be caught.
 *
 * The harness is the real one, on a real file, and every environment these
 * tests build starts empty — nothing here inherits whatever `AI_PROVIDER` the
 * machine running it happens to have.
 *
 * Confirmed by breaking things, each mutation run and reverted:
 *
 *   `settings.write` applies before it validates — a non-loopback URL is
 *     refused, and is in force anyway, which is the shape of guard that reads
 *     as working and is not.
 *   `validateSettings` skips the loopback check — the refusal test finds the
 *     URL stored, and the process will happily fetch a stranger's host with
 *     whatever key it holds.
 *   an `api_key` column added to the settings table and written on
 *     `secrets.set` — the plausible future mistake, and the on-disk scan finds
 *     the key in the file, which is what the column-free schema exists to
 *     prevent.
 *   `apply` overlays the environment on the settings instead of the other way
 *     round — the restart test reads back the inherited provider, so a choice
 *     made in the app is silently overruled by the shell it was launched from.
 *   `apply` skips a field with nothing behind it — clearing the model leaves
 *     the old one in force, so the settings page has a field that can be typed
 *     into and never emptied.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { createHarness, silentLogger, type Harness } from '../src/runtime/create.js';
import type { CapabilityMap, Settings } from '../src/contracts/index.js';
import type { ProviderStatus } from '../src/providers/status.js';

/* ------------------------------------------------------------------- setup */

const capabilities: CapabilityMap = {};

/** A local server that answers, so a status check needs no Ollama on this machine. */
const serving = (...models: string[]): typeof globalThis.fetch =>
  ((async () =>
    new Response(JSON.stringify({ data: models.map((id) => ({ id })) }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown) as typeof globalThis.fetch;

const refusing: typeof globalThis.fetch = () => Promise.reject(new Error('connection refused'));

type Bench = {
  readonly harness: Harness;
  readonly dispatch: ReturnType<typeof createDispatch>;
  /** Closes this runtime and opens another over the same file. */
  restart(env?: Readonly<Partial<Record<string, string>>>): Bench;
  /** Every byte of every database file, for asserting what is not in them. */
  files(): string;
  dispose(): void;
};

const bench = (
  options: {
    env?: Readonly<Partial<Record<string, string>>>;
    probe?: typeof globalThis.fetch;
    on?: string;
  } = {}
): Bench => {
  const dir = options.on ?? mkdtempSync(join(tmpdir(), 'harness-settings-'));
  const harness = createHarness({
    databasePath: join(dir, 'harness.db'),
    capabilities,
    logger: silentLogger,
    env: options.env ?? {},
    probe: options.probe ?? refusing
  });

  return {
    harness,
    dispatch: createDispatch(harness),
    restart(env) {
      harness.close();
      return bench({ ...options, on: dir, ...(env ? { env } : {}) });
    },
    files() {
      // Read rather than queried, and read while the key is still set — a scan
      // taken after it was cleared would pass on a runtime that had written it
      // and then overwritten the row. A column that cannot hold a secret is the
      // claim; bytes on disk are the only check a stray `UPDATE` cannot slip past.
      return readdirSync(dir)
        .map((name) => readFileSync(join(dir, name)).toString('latin1'))
        .join('\n');
    },
    dispose: () => {
      try {
        harness.close();
      } catch {
        // Already closed by `files` or `restart`. Closing twice is not a failure.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const error = (response: Response): { code: string; message: string } => {
  assert.ok(!response.ok, `expected a failure, got ${JSON.stringify(response)}`);
  return response.error;
};

/* ------------------------------------------------------------------- tests */

test('a provider chosen in the app is still chosen after a restart', async () => {
  let it = bench();

  try {
    const stored = data<{ settings: Settings }>(
      await it.dispatch('settings.set', {
        settings: { providerId: 'openai', modelId: 'gpt-4o-mini' }
      })
    ).settings;

    assert.equal(stored.providerId, 'openai');
    assert.equal(stored.modelId, 'gpt-4o-mini');

    // A different process, over the same file, inheriting an environment that
    // says something else. The choice a person made in a settings page has to
    // win over the shell the app happened to be launched from, or the setting
    // is decorative.
    it = it.restart({ AI_PROVIDER: 'huggingface', AI_MODEL: 'ignored' });

    const status = data<ProviderStatus>(await it.dispatch('providers.status', {}));
    assert.equal(status.providerId, 'openai');
    assert.equal(status.modelId, 'gpt-4o-mini');
  } finally {
    it.dispose();
  }
});

test('clearing a setting falls back to the environment, not to an empty string', async () => {
  const it = bench({ env: { AI_PROVIDER: 'openai', AI_MODEL: 'gpt-4o' } });

  try {
    await it.dispatch('settings.set', { settings: { modelId: 'gpt-4o-mini' } });

    const cleared = data<{ settings: Settings }>(
      await it.dispatch('settings.set', { settings: { modelId: null } })
    ).settings;

    assert.equal(cleared.modelId, undefined);

    // Back to what the environment says, rather than to a model named "". The
    // second is what a settings page produces when someone empties a field, and
    // it resolves to a model nothing serves.
    const status = data<ProviderStatus>(await it.dispatch('providers.status', {}));
    assert.equal(status.modelId, 'gpt-4o');
  } finally {
    it.dispose();
  }
});

test('a cleared setting with nothing behind it returns to the default', async () => {
  const it = bench();

  try {
    await it.dispatch('settings.set', { settings: { modelId: 'something-specific' } });
    assert.equal(
      data<ProviderStatus>(await it.dispatch('providers.status', {})).modelId,
      'something-specific'
    );

    await it.dispatch('settings.set', { settings: {} });

    // Nothing in the environment to fall back to, so the fallback is the
    // provider's own default. A setting that can be typed but not untyped is a
    // setting a person has to reinstall the app to undo.
    assert.equal(
      data<ProviderStatus>(await it.dispatch('providers.status', {})).modelId,
      'gemma4:12b'
    );
  } finally {
    it.dispose();
  }
});

test('a local server URL that is not this machine is refused, and nothing is stored', async () => {
  const it = bench();

  try {
    const refused = error(
      await it.dispatch('settings.set', {
        settings: { providerId: 'local', localBaseUrl: 'http://169.254.169.254/v1' }
      })
    );

    assert.equal(refused.code, 'misconfigured');
    assert.match(refused.message, /localhost/);

    // Refused *and* not in force. A guard that rejects the request and applies
    // it anyway is the worst of both: it reads as working, and the process is
    // now pointed at a metadata endpoint with whatever key it holds.
    const stored = data<{ settings: Settings }>(await it.dispatch('settings.get', {})).settings;
    assert.equal(stored.localBaseUrl, undefined);

    const status = data<ProviderStatus>(await it.dispatch('providers.status', {}));
    assert.match(status.localBaseUrl, /localhost/);
  } finally {
    it.dispose();
  }
});

test('an unusable provider is refused before it can break the next launch', async () => {
  const it = bench();

  try {
    assert.equal(
      error(await it.dispatch('settings.set', { settings: { providerId: 'anthropic' } })).code,
      'misconfigured'
    );

    // OpenRouter serves no embeddings endpoint at all, so this is not a missing
    // key — it is a combination that cannot work, and the moment to say so is
    // now rather than part-way through indexing someone's CV.
    const refused = error(
      await it.dispatch('settings.set', { settings: { embeddingProviderId: 'openrouter' } })
    );
    assert.equal(refused.code, 'misconfigured');
    assert.match(refused.message, /embeddings/);

    assert.deepEqual(
      data<{ settings: Settings }>(await it.dispatch('settings.get', {})).settings,
      {
        providerId: undefined,
        modelId: undefined,
        localBaseUrl: undefined,
        embeddingProviderId: undefined,
        embeddingModelId: undefined
      }
    );
  } finally {
    it.dispose();
  }
});

test('a key sent over the channel is usable and is never written to disk', async () => {
  const secret = 'sk-do-not-write-me-down-8f3a91';
  const it = bench({ env: { AI_PROVIDER: 'openai' } });

  try {
    const accepted = data<{ providerId: string; configured: boolean }>(
      await it.dispatch('secrets.set', { providerId: 'openai', apiKey: secret })
    );

    // The reply names the provider and not the key. This envelope is bound for
    // somewhere else and may be logged by whatever holds it.
    assert.deepEqual(accepted, { providerId: 'openai', configured: true });
    assert.ok(!JSON.stringify(accepted).includes(secret));

    const status = data<ProviderStatus>(await it.dispatch('providers.status', {}));
    assert.equal(status.credentialConfigured, true);
    assert.ok(!JSON.stringify(status).includes(secret));

    // The claim the schema makes, checked against the bytes. Not a query — a
    // query only sees the columns someone thought to look at, and a key that
    // reached a freelist page or a WAL frame is on the disk either way.
    assert.ok(!it.files().includes(secret), 'a credential reached the database file');

    data(await it.dispatch('secrets.clear', { providerId: 'openai' }));
    assert.equal(
      data<ProviderStatus>(await it.dispatch('providers.status', {})).credentialConfigured,
      false
    );
  } finally {
    it.dispose();
  }
});

test('a provider that needs no key refuses one rather than silently keeping it', async () => {
  const it = bench();

  try {
    const refused = error(
      await it.dispatch('secrets.set', { providerId: 'local', apiKey: 'not-needed' })
    );

    // Someone typing a key into a field for a server on their own machine has
    // misunderstood something, and a form that accepts it teaches them the
    // misunderstanding.
    assert.equal(refused.code, 'misconfigured');
    assert.match(refused.message, /no credential/);
  } finally {
    it.dispose();
  }
});

test('a status names what is missing without making a model call', async () => {
  const it = bench({ probe: serving('gemma4:12b:latest') });

  try {
    await it.dispatch('settings.set', {
      settings: { providerId: 'local', embeddingProviderId: 'local' }
    });

    const status = data<ProviderStatus>(await it.dispatch('providers.status', {}));

    assert.equal(status.localReachable, true);
    assert.equal(status.credentialConfigured, true, 'a local server needs no key');
    // Pulled as `gemma4:12b:latest`, configured as `gemma4:12b`. The same model.
    assert.deepEqual(status.missingLocalModels, ['nomic-embed-text']);
    assert.deepEqual(
      status.providers.map((provider) => provider.id).sort(),
      ['huggingface', 'local', 'openai', 'openrouter']
    );

    // Every model call this runtime has ever made, which is none. A "test
    // connection" button that costs a generation is one people learn not to
    // press.
    assert.equal(it.harness.aiCalls.recent(10).length, 0);
  } finally {
    it.dispose();
  }
});

test('an unreachable local server reports nothing missing, because nothing answered', async () => {
  const it = bench();

  try {
    await it.dispatch('settings.set', { settings: { providerId: 'local' } });

    const status = data<ProviderStatus>(await it.dispatch('providers.status', {}));

    assert.equal(status.localReachable, false);
    // Not "every configured model is missing". The fix is to start the server,
    // and a list of models to pull puts the wrong instruction on the screen.
    assert.deepEqual(status.missingLocalModels, []);
  } finally {
    it.dispose();
  }
});
