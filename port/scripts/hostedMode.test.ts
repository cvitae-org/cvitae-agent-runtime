/**
 * What the boundary refuses when the runtime is reachable by strangers.
 *
 * Every assertion here is about a fallback that must never be reached rather
 * than about a feature. Underneath these checks, `credentialFor` will read the
 * environment, `readSources` will open a path, and `assertLoopbackUrl` will
 * accept `localhost` — all correct on the machine this project was built for,
 * and all wrong the moment the listener is public. The tests exist because the
 * difference between the two deployments is one environment variable, and a
 * refusal that silently stopped working would look exactly like one that never
 * ran.
 *
 * The second half matters as much as the first: hosted mode is opt-in, and the
 * local deployment must be able to do every one of these things.
 *
 * Nothing here runs a capability or resolves a model. The boundary decides
 * before any of that, which is the property under test.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseBatchRequest,
  parseRunRequest,
  type RequestFacts
} from '../src/server/handlers.js';
import { credentialWarning } from '../src/server/policy.js';

const withEnv = <T>(values: Record<string, string | undefined>, run: () => T): T => {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]])
  );

  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

const hosted = <T>(run: () => T): T => withEnv({ RUNTIME_MODE: 'hosted' }, run);
const local = <T>(run: () => T): T => withEnv({ RUNTIME_MODE: undefined }, run);

/** A well-formed call: the shape everything below is a single deviation from. */
const facts = (over: Partial<RequestFacts> = {}): RequestFacts => ({
  capability: 'analyze_offer',
  body: {
    input: { offerText: 'Senior TypeScript developer, remote.' },
    model: { providerId: 'openrouter', modelId: 'x', apiKey: 'sk-caller' }
  },
  ...over
});

/** The status and reason of a refusal, or `null` when the request was allowed. */
const refusalOf = (parsed: ReturnType<typeof parseRunRequest>) => {
  if (parsed.ok) return null;
  const body = parsed.response.body as { reason?: string } | undefined;
  return { status: parsed.response.status, reason: body?.reason };
};

/* ------------------------------------------------------- credentials --- */

test('a hosted run without a key is refused rather than billed to the server', () => {
  const parsed = hosted(() =>
    parseRunRequest(
      facts({ body: { input: { offerText: 'x' }, model: { providerId: 'openrouter' } } })
    )
  );

  assert.deepEqual(refusalOf(parsed), { status: 400, reason: 'missing_client_key' });
});

test('a hosted run with no model block at all is refused the same way', () => {
  const parsed = hosted(() => parseRunRequest(facts({ body: { input: { offerText: 'x' } } })));

  assert.deepEqual(refusalOf(parsed), { status: 400, reason: 'missing_client_key' });
});

test('a key without the provider it belongs to is refused, not guessed for', () => {
  const parsed = hosted(() =>
    parseRunRequest(facts({ body: { input: { offerText: 'x' }, model: { apiKey: 'sk-caller' } } }))
  );

  assert.deepEqual(refusalOf(parsed), { status: 400, reason: 'missing_provider' });
});

test('a well-formed hosted call carrying its own key is allowed through', () => {
  const parsed = hosted(() => parseRunRequest(facts()));

  assert.equal(parsed.ok, true);
});

test('the local runtime still answers on its own credential', () => {
  const parsed = local(() => parseRunRequest(facts({ body: { input: { offerText: 'x' } } })));

  assert.equal(parsed.ok, true);
});

/* ----------------------------------------------------- local models --- */

test('a hosted run cannot be pointed at a model on the caller machine', () => {
  const parsed = hosted(() =>
    parseRunRequest(
      facts({
        body: {
          input: { offerText: 'x' },
          model: { providerId: 'local', baseURL: 'http://localhost:11434/v1' }
        }
      })
    )
  );

  assert.deepEqual(refusalOf(parsed), {
    status: 400,
    reason: 'local_provider_unreachable'
  });
});

test('the local runtime is exactly where a local model belongs', () => {
  const parsed = local(() =>
    parseRunRequest(
      facts({
        body: {
          input: { offerText: 'x' },
          model: { providerId: 'local', baseURL: 'http://localhost:11434/v1' }
        }
      })
    )
  );

  assert.equal(parsed.ok, true);
});

/* --------------------------------------------------------- capability --- */

test('a capability needing the index is refused with 501, not 404', () => {
  const parsed = hosted(() => parseRunRequest(facts({ capability: 'ask_profile' })));

  assert.deepEqual(refusalOf(parsed), { status: 501, reason: 'capability_unavailable' });
});

test('the refusal names what this deployment can run instead', () => {
  const parsed = hosted(() => parseRunRequest(facts({ capability: 'draft_application' })));

  assert.equal(parsed.ok, false);
  const body = parsed.ok ? null : (parsed.response.body as { error: string });
  assert.match(body?.error ?? '', /analyze_offer/);
});

test('every capability is available to the local runtime', () => {
  for (const capability of ['ask_profile', 'draft_application', 'extract_cv']) {
    const parsed = local(() => parseRunRequest(facts({ capability })));
    assert.equal(parsed.ok, true, capability);
  }
});

/* ------------------------------------------------------------ sources --- */

test('a hosted import cannot ask the server to read its own disk', () => {
  const parsed = hosted(() =>
    parseRunRequest(
      facts({
        capability: 'extract_cv',
        body: {
          input: { sources: [{ kind: 'file', path: '/etc/passwd' }] },
          model: { providerId: 'openrouter', apiKey: 'sk-caller' }
        }
      })
    )
  );

  assert.deepEqual(refusalOf(parsed), { status: 400, reason: 'invalid_input' });
});

test('attached bytes and pasted text are what a hosted import takes', () => {
  const parsed = hosted(() =>
    parseRunRequest(
      facts({
        capability: 'extract_cv',
        body: {
          input: {
            sources: [
              { kind: 'upload', filename: 'cv.pdf', content: 'JVBER' },
              { kind: 'text', content: 'Jan Kowalski' }
            ]
          },
          model: { providerId: 'openrouter', apiKey: 'sk-caller' }
        }
      })
    )
  );

  assert.equal(parsed.ok, true);
});

test('reading a path is legitimate on the machine that owns the file', () => {
  const parsed = local(() =>
    parseRunRequest(
      facts({
        capability: 'extract_cv',
        body: { input: { sources: [{ kind: 'file', path: '/home/me/cv.pdf' }] } }
      })
    )
  );

  assert.equal(parsed.ok, true);
});

/* -------------------------------------------------------------- size --- */

test('an oversized body is refused before the platform truncates it', () => {
  const parsed = hosted(() => parseRunRequest(facts({ contentLength: 9_000_000 })));

  assert.deepEqual(refusalOf(parsed), { status: 413, reason: 'invalid_input' });
});

test('a body inside the ceiling passes, and the local runtime has none', () => {
  assert.equal(hosted(() => parseRunRequest(facts({ contentLength: 4_000_000 }))).ok, true);
  assert.equal(local(() => parseRunRequest(facts({ contentLength: 20_000_000 }))).ok, true);
});

/* ------------------------------------------------------------- batch --- */

const batchFacts = (count: number): RequestFacts => ({
  capability: 'analyze_offer',
  body: {
    inputs: Array.from({ length: count }, (_, index) => ({ offerText: `offer ${index}` })),
    model: { providerId: 'openrouter', apiKey: 'sk-caller' }
  }
});

test('a hosted batch is capped at what can finish inside the platform ceiling', () => {
  const parsed = hosted(() => parseBatchRequest(batchFacts(20)));

  assert.equal(parsed.ok, false);
  const body = parsed.ok ? null : (parsed.response.body as { reason: string });
  assert.equal(body?.reason, 'invalid_input');
});

test('a small hosted batch runs, and the local runtime has no ceiling', () => {
  assert.equal(hosted(() => parseBatchRequest(batchFacts(5))).ok, true);
  assert.equal(local(() => parseBatchRequest(batchFacts(200))).ok, true);
});

test('a batch is subject to the same credential rules as a single run', () => {
  const parsed = hosted(() =>
    parseBatchRequest({
      capability: 'analyze_offer',
      body: { inputs: [{ offerText: 'x' }] }
    })
  );

  assert.equal(parsed.ok, false);
});

/* ------------------------------------------------------------- token --- */

test('a configured token is required, and checked before anything else', () => {
  const parsed = withEnv({ RUNTIME_MODE: 'hosted', RUNTIME_TOKEN: 'secret' }, () =>
    parseRunRequest(facts())
  );

  assert.deepEqual(refusalOf(parsed), { status: 401, reason: 'unauthorized' });
});

test('the right token gets through, with or without the Bearer prefix', () => {
  for (const authorization of ['secret', 'Bearer secret', 'bearer  secret']) {
    const parsed = withEnv({ RUNTIME_MODE: 'hosted', RUNTIME_TOKEN: 'secret' }, () =>
      parseRunRequest(facts({ authorization }))
    );

    assert.equal(parsed.ok, true, authorization);
  }
});

test('no configured token means no token is asked for', () => {
  const parsed = withEnv({ RUNTIME_MODE: 'hosted', RUNTIME_TOKEN: undefined }, () =>
    parseRunRequest(facts())
  );

  assert.equal(parsed.ok, true);
});

/* ------------------------------------------------------- the envelope --- */

test('the envelope mistake is still reported as an envelope mistake', () => {
  const parsed = hosted(() =>
    parseRunRequest(facts({ body: { offerText: 'unwrapped', model: { apiKey: 'k' } } }))
  );

  assert.equal(parsed.ok, false);
  const body = parsed.ok ? null : (parsed.response.body as { error: string });
  assert.match(body?.error ?? '', /"input"/);
});

/* ------------------------------------------------------ the operator --- */

test('a credential left in a hosted environment is named at startup', () => {
  const warning = withEnv(
    { RUNTIME_MODE: 'hosted', OPENROUTER_API_KEY: 'sk-server' },
    credentialWarning
  );

  assert.match(warning ?? '', /OPENROUTER_API_KEY/);
});

test('the local runtime holding a key is the ordinary case and says nothing', () => {
  const warning = withEnv(
    { RUNTIME_MODE: undefined, OPENROUTER_API_KEY: 'sk-server' },
    credentialWarning
  );

  assert.equal(warning, undefined);
});
