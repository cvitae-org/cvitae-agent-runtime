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
 *   the probe folds every non-2xx into "nothing answered" — a server returning
 *     401 is reported as absent, which is the bug that put "start the server"
 *     in front of somebody whose server was running.
 *   the probe sends no `Authorization` header — a local server that requires a
 *     key stays unreachable no matter what is typed into the field for it.
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

/** oMLX with no key configured: running, listening, and answering 401. */
const guarded = (expected: string, ...models: string[]): typeof globalThis.fetch =>
  ((async (_url: string, init?: { headers?: Record<string, string> }) =>
    init?.headers?.authorization === `Bearer ${expected}`
      ? new Response(JSON.stringify({ data: models.map((id) => ({ id })) }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      : new Response(JSON.stringify({ error: { message: 'API key required' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })) as unknown) as typeof globalThis.fetch;

/** Something on the port, speaking something else. */
const wrongDoor: typeof globalThis.fetch = ((async () =>
  new Response('<html>not me</html>', { status: 404 })) as unknown) as typeof globalThis.fetch;

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

test('a provider chosen in the app gets its own model, not one written for another', async () => {
  // A debug build's `.env`: everything local, with the model each wants.
  const inherited = {
    AI_PROVIDER: 'local',
    AI_MODEL: 'qwen3:8b',
    EMBEDDING_PROVIDER: 'local',
    EMBEDDING_MODEL: 'mxbai-embed-large'
  };
  let it = bench({ env: inherited });

  try {
    // What the settings page sends for a hosted provider: the provider, and
    // no model, so that the provider's own is used.
    await it.dispatch('settings.set', {
      settings: { providerId: 'openai', embeddingProviderId: 'openai' }
    });

    const hosted = data<ProviderStatus>(await it.dispatch('providers.status', {}));
    assert.equal(hosted.modelId, 'gpt-4o');
    assert.equal(hosted.embeddingModelId, 'text-embedding-3-small');

    // The field case was the next launch, which applies the stored settings
    // over the same environment.
    it = it.restart(inherited);
    const relaunched = data<ProviderStatus>(await it.dispatch('providers.status', {}));
    assert.equal(relaunched.embeddingProviderId, 'openai');
    assert.equal(relaunched.embeddingModelId, 'text-embedding-3-small');

    // Choosing the environment's own provider keeps the environment's model.
    await it.dispatch('settings.set', {
      settings: { providerId: 'local', embeddingProviderId: 'local' }
    });
    const local = data<ProviderStatus>(await it.dispatch('providers.status', {}));
    assert.equal(local.modelId, 'qwen3:8b');
    assert.equal(local.embeddingModelId, 'mxbai-embed-large');
  } finally {
    it.dispose();
  }
});

test('a hosted provider the environment already names keeps its model there', async () => {
  const it = bench({
    env: { EMBEDDING_PROVIDER: 'openai', EMBEDDING_MODEL: 'text-embedding-3-large' }
  });

  try {
    await it.dispatch('settings.set', { settings: { embeddingProviderId: 'openai' } });

    assert.equal(
      data<ProviderStatus>(await it.dispatch('providers.status', {})).embeddingModelId,
      'text-embedding-3-large'
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

test('a local server that wants a key can be given one, and it is not written down', async () => {
  // Not every local server is Ollama. oMLX answers `401 API key required` to
  // the placeholder bearer token every OpenAI-compatible client sends, so a
  // local provider that could not carry a key was a local provider that could
  // not reach that server at all.
  const it = bench({ probe: guarded('mlx-key', 'gemma4:12b') });

  try {
    await it.dispatch('settings.set', { settings: { providerId: 'local' } });
    data(await it.dispatch('secrets.set', { providerId: 'local', apiKey: 'mlx-key' }));

    const status = data<ProviderStatus>(await it.dispatch('providers.status', {}));

    assert.equal(status.localState, 'ok');
    assert.deepEqual(status.localModels, ['gemma4:12b']);

    // The same claim the hosted providers get: the key lives in this process
    // and the settings table has no column that could hold it.
    assert.ok(!it.files().includes('mlx-key'), 'the key reached the disk');
  } finally {
    it.dispose();
  }
});

test('a local server that answers 401 is running, and is not reported as absent', async () => {
  // The bug this file exists to keep fixed. Every non-2xx used to become
  // "nothing is listening", which puts "start the server" on screen in front of
  // somebody whose server is already up — the one instruction that cannot help.
  const it = bench({ probe: guarded('mlx-key') });

  try {
    await it.dispatch('settings.set', { settings: { providerId: 'local' } });

    const status = data<ProviderStatus>(await it.dispatch('providers.status', {}));

    assert.equal(status.localState, 'unauthorized');
    assert.equal(status.localStatusCode, 401);
  } finally {
    it.dispose();
  }
});

test('a server that answers something else is a wrong address, not a missing one', async () => {
  const it = bench({ probe: wrongDoor });

  try {
    await it.dispatch('settings.set', { settings: { providerId: 'local' } });

    const status = data<ProviderStatus>(await it.dispatch('providers.status', {}));

    // A port with something on it that is not an OpenAI-compatible API. The fix
    // is the base URL, and neither "start it" nor "add a key" is the fix.
    assert.equal(status.localState, 'refused');
    assert.equal(status.localStatusCode, 404);
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

    assert.equal(status.localState, 'ok');
    assert.equal(
      status.providers.find((provider) => provider.id === 'local')?.credential,
      'optional',
      'a local server takes a key without demanding one'
    );
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

    assert.equal(status.localState, 'absent');
    // Not "every configured model is missing". The fix is to start the server,
    // and a list of models to pull puts the wrong instruction on the screen.
    assert.deepEqual(status.missingLocalModels, []);
  } finally {
    it.dispose();
  }
});


test('Studio catalogue exposes exactly OpenAI, Bielik and Local with embedding defaults', async () => {
  const it = bench();
  try {
    const status = data<ProviderStatus>(await it.dispatch('providers.status', {}));
    assert.deepEqual(status.modelOptions.map(option => option.id), ['openai', 'bielik', 'local']);
    assert.deepEqual(status.modelOptions.map(option => [option.providerId, option.modelId, option.embeddingModelId]), [
      ['openai', 'gpt-4o', 'text-embedding-3-small'],
      ['huggingface', 'speakleash/Bielik-11B-v3.0-Instruct', 'BAAI/bge-m3'],
      ['local', 'gemma4:12b', 'nomic-embed-text']
    ]);
  } finally { it.dispose(); }
});

test('draft status uses its URL and key without writing settings, installing keys or making AI calls', async () => {
  let requestedUrl = '';
  let requestedKey = '';
  const probe: typeof fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedKey = new Headers(init?.headers).get('authorization') ?? '';
    return new Response(JSON.stringify({ data: [{ id: 'draft-chat' }, { id: 'draft-embed' }] }), { status: 200 });
  };
  const it = bench({ probe, env: { LOCAL_BASE_URL: 'http://localhost:11434/v1', LOCAL_API_KEY: 'active-secret' } });
  try {
    const contextId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    it.harness.cvContexts.create(contextId, 'en');
    it.harness.documents.update(contextId, 'cv', () => ({ role_description: 'Private CV content' }));
    const job = it.harness.indexRecovery.status(contextId);
    assert.ok(job);
    const filesBefore = it.files();
    const before = it.harness.settings.read();
    const draft = data<ProviderStatus>(await it.dispatch('providers.status', {
      settings: { providerId: 'local', modelId: 'draft-chat', localBaseUrl: 'http://localhost:1234/v1', embeddingProviderId: 'local', embeddingModelId: 'draft-embed' },
      keys: { local: 'draft-secret' }
    }));
    assert.equal(requestedUrl, 'http://localhost:1234/v1/models');
    assert.equal(requestedKey, 'Bearer draft-secret');
    assert.deepEqual(draft.missingLocalModels, []);
    assert.deepEqual(it.harness.settings.read(), before);
    const active = data<ProviderStatus>(await it.dispatch('providers.status', {}));
    assert.equal(active.modelId, 'gemma4:12b');
    assert.equal(requestedUrl, 'http://localhost:11434/v1/models');
    assert.equal(requestedKey, 'Bearer active-secret');
    assert.ok(!JSON.stringify(draft).includes('draft-secret'));
    assert.ok(!it.files().includes('draft-secret'));
    assert.deepEqual(it.harness.indexRecovery.status(contextId), job);
    assert.equal(it.files(), filesBefore, 'draft checks do not write settings, logs or indexing state');
    assert.equal(it.harness.aiCalls.recent(10).length, 0);
  } finally { it.dispose(); }
});

test('draft replacement resolves cleared fields from inherited defaults, not saved settings', async () => {
  const it = bench({ env: { AI_PROVIDER: 'openai', AI_MODEL: 'inherited-model', EMBEDDING_PROVIDER: 'openai' } });
  try {
    await it.dispatch('settings.set', { settings: { providerId: 'huggingface', modelId: 'saved-model' } });
    const draft = data<ProviderStatus>(await it.dispatch('providers.status', { settings: { providerId: null, modelId: null } }));
    assert.equal(draft.providerId, 'openai');
    assert.equal(draft.modelId, 'inherited-model');
    assert.equal(it.harness.settings.read().modelId, 'saved-model');
    assert.equal(error(await it.dispatch('providers.status', { keys: { local: 'orphan-key' } })).code, 'invalid_input');
    assert.equal(error(await it.dispatch('providers.status', { settings: { localBaseUrl: 'https://example.com/v1' } })).code, 'misconfigured');
  } finally { it.dispose(); }
});

test('supported model and embedding pairs survive restart over conflicting environment settings', async () => {
  const it = bench({ env: { AI_PROVIDER: 'openai', AI_MODEL: 'other-model', EMBEDDING_PROVIDER: 'local', EMBEDDING_MODEL: 'other-embed' } });
  let restarted: Bench | undefined;
  try {
    await it.dispatch('settings.set', { settings: { providerId: 'openai', modelId: 'gpt-4o', embeddingProviderId: 'openai', embeddingModelId: 'text-embedding-3-small' } });
    restarted = it.restart();
    const status = data<ProviderStatus>(await restarted.dispatch('providers.status', {}));
    assert.equal(status.modelId, 'gpt-4o');
    assert.equal(status.embeddingModelId, 'text-embedding-3-small');
  } finally { (restarted ?? it).dispose(); }
});


test('hosted status reports the inherited local address without probing hosted authentication', async () => {
  let calls = 0;
  const it = bench({
    env: { AI_PROVIDER: 'huggingface', EMBEDDING_PROVIDER: 'huggingface', LOCAL_BASE_URL: 'http://localhost:1234/v1/' },
    probe: async () => { calls++; return Response.json({ data: [] }); }
  });
  try {
    const hosted = data<ProviderStatus>(await it.dispatch('providers.status', {}));
    assert.equal(hosted.localBaseUrl, 'http://localhost:1234/v1');
    assert.equal(hosted.localState, undefined);
    assert.equal(calls, 0);
    const draft = data<ProviderStatus>(await it.dispatch('providers.status', {
      settings: { providerId: 'huggingface', embeddingProviderId: 'local' }
    }));
    assert.equal(draft.localBaseUrl, hosted.localBaseUrl);
    assert.equal(draft.localState, 'ok');
    assert.deepEqual(draft.localModels, []);
    assert.equal(calls, 1);
  } finally { it.dispose(); }
});

test('a malformed successful model-list response is refused rather than verified', async () => {
  for (const body of [null, {}, { data: 'wrong' }]) {
    const it = bench({ probe: async () => Response.json(body) });
    try {
      const status = data<ProviderStatus>(await it.dispatch('providers.status', { settings: { providerId: 'local', embeddingProviderId: 'local' } }));
      assert.equal(status.localState, 'refused');
      assert.deepEqual(status.localModels, []);
      assert.deepEqual(status.missingLocalModels, []);
    } finally { it.dispose(); }
  }
});
