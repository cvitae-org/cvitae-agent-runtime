/**
 * Prose arriving before the answer does.
 *
 * Streaming is the difference between a chat window that looks broken for
 * fifteen seconds and one that looks like it is thinking, and that is the whole
 * of what it buys. It buys nothing about correctness, which is why the strongest
 * claim in this file is the one about what streaming must *not* change: the
 * result is the answer, and a caller that heard no fragment at all is not
 * missing anything it cannot read afterwards.
 *
 * Two layers, and both matter for different reasons.
 *
 * The gateway tests use the SDK's mock model, because the properties under test
 * belong to the code around the stream — that an error part reaches the caller
 * as an error rather than as an empty completion, that a cancelled stream is not
 * believed, that a subscriber cannot break the call it is watching. None of
 * those are properties of a model.
 *
 * The spine tests drive a real run over a real database, because the claim there
 * is about routing: a fragment carries the step that produced it and the run it
 * belongs to, and *no fragment is ever written down*.
 *
 * Confirmed by breaking things, each mutation run and reverted:
 *
 *   `streamed` drops the `onError` capture — the provider-failure test reads a
 *     successful, empty answer, which is the exact failure shape the capture
 *     exists to prevent and the one that would be hardest to diagnose in a
 *     window that just showed nothing.
 *   `streamed` skips `signal.throwIfAborted()` — nothing fails, because this
 *     version of the SDK also rejects on abort. The check stays anyway: it is
 *     one line, and it makes "a cancelled call never returns a partial answer"
 *     a property of this file rather than of a dependency's minor version.
 *   `redact` stops recognising `RuntimeError` — the cancellation test reads
 *     `model_call_failed`, so a run the user cancelled is recorded in
 *     `ai_calls` as the provider's fault.
 *   `notify` lets the sink's exception through — the throwing-subscriber test
 *     fails the run, so one broken window would cost the answer.
 *   the executor stops passing `onDelta` — every fragment test goes quiet while
 *     every result test still passes, which is what makes the deltas worth
 *     asserting separately from the answer.
 *   deltas are checkpointed as events — the "nothing is written down" test sees
 *     the log grow with the fragments, which is the whole argument for a sink.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from 'ai';
import { createAiGateway } from '../src/effects/ai.js';
import { beginRun, startRun } from '../src/runtime/run.js';
import { RuntimeError } from '../src/contracts/index.js';
import type { Step, StepDelta } from '../src/contracts/index.js';
import { callFor, fakeResolver } from './support/models.js';
import { noop, recorder, spine, stage, stubGateway, timeline } from './support/spine.js';

/* ----------------------------------------------------------------- helpers */

/** A `generate` step, which is the simplest thing that produces prose. */
const generate = (name: string, key = 'answer'): Step => ({
  kind: 'generate',
  name,
  critical: true,
  key,
  system: 'test',
  prompt: name,
  maxOutputTokens: 256
});

const toolLoop = (name: string): Step => ({
  kind: 'tool_loop',
  name,
  critical: true,
  system: 'test',
  prompt: name,
  tools: [],
  maxSteps: 4
});

/** Collects deltas and remembers the order they arrived in. */
const sink = () => {
  const seen: (StepDelta & { runId: string })[] = [];
  return {
    seen,
    record: (delta: StepDelta & { runId: string }) => seen.push(delta),
    text: () => seen.map((delta) => delta.text).join('')
  };
};

/* ---------------------------------------------------------------- gateway */

test('the fragments a caller hears concatenate to the answer it is given', async () => {
  // Split mid-word on purpose. A consumer that reassembles by joining on
  // spaces passes a friendlier fixture and produces nonsense against a model.
  const chunks = ['Ada ', 'wrote', ' the', ' first', ' program.'];
  const fake = fakeResolver({ chunks, delayMs: 0 });
  const ai = createAiGateway({ resolver: fake.resolver, logger: recorder() });

  const heard: string[] = [];
  const result = await ai.generateText({
    ...callFor(),
    system: 's',
    prompt: 'p',
    maxOutputTokens: 64,
    onDelta: (text) => heard.push(text)
  });

  assert.deepEqual(heard, chunks);
  assert.equal(result.text, heard.join(''));
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.usage.outputTokens, 7, 'usage survives the streaming path');
});

test('a caller that asks for no fragments still gets the whole answer', async () => {
  const fake = fakeResolver({ answer: 'The whole thing, at once.', delayMs: 0 });
  const ai = createAiGateway({ resolver: fake.resolver, logger: recorder() });

  // The non-streaming path is not a degraded mode. It is what a scheduled job,
  // a CLI and every test wants, and it has to keep working unchanged — which is
  // also why a gateway that ignores `onDelta` entirely is a legal one.
  const result = await ai.generateText({
    ...callFor(),
    system: 's',
    prompt: 'p',
    maxOutputTokens: 64
  });

  assert.equal(result.text, 'The whole thing, at once.');
});

test('a provider that fails mid-stream is a failure, not an empty answer', async () => {
  const fake = fakeResolver({
    delayMs: 0,
    streamError: new APICallError({
      message: 'prompt: Ada Lovelace, born 1815, London',
      url: 'https://api.example.com/v1/chat',
      requestBodyValues: {},
      statusCode: 500
    })
  });
  const ai = createAiGateway({ resolver: fake.resolver, logger: recorder() });

  const failure = await ai
    .generateText({
      ...callFor(),
      system: 's',
      prompt: 'p',
      maxOutputTokens: 64,
      onDelta: () => undefined
    })
    .then(() => undefined, (error: unknown) => error);

  // The SDK does not put error parts on `textStream`, so the shape this is
  // guarding against is not a crash — it is a completion of `''` with
  // `finishReason: 'stop'`, indistinguishable from a model with nothing to say.
  assert.ok(failure instanceof RuntimeError, `expected a RuntimeError, got ${String(failure)}`);
  assert.equal(failure.code, 'model_call_failed');
  assert.ok(
    !failure.message.includes('Ada Lovelace'),
    'the provider error carried a prompt out through the streaming path'
  );
});

test('a stream cut short by a cancelled run is not mistaken for an answer', async () => {
  const controller = new AbortController();
  const fake = fakeResolver({ chunks: ['half an ans'], delayMs: 0 });
  const ai = createAiGateway({ resolver: fake.resolver, logger: recorder() });

  const failure = await ai
    .generateText({
      ...callFor(controller.signal),
      system: 's',
      prompt: 'p',
      maxOutputTokens: 64,
      // Aborting from inside the sink is the honest reproduction: a person
      // closes the window while the tokens are arriving.
      onDelta: () => controller.abort(new RuntimeError('The run was cancelled.', 'aborted'))
    })
    .then(() => undefined, (error: unknown) => error);

  // Two claims. It failed at all — returning the prefix would mean a cancelled
  // run produced a confident, truncated answer. And it failed *as a
  // cancellation*: the code is what the log records and what the orchestrator
  // reads, and `model_call_failed` here would blame a provider for a button the
  // user pressed.
  assert.ok(failure instanceof RuntimeError, `expected a RuntimeError, got ${String(failure)}`);
  assert.equal(failure.code, 'aborted');
});

test('a subscriber that throws does not cost the caller its answer', async () => {
  const fake = fakeResolver({ chunks: ['one ', 'two'], delayMs: 0 });
  const ai = createAiGateway({ resolver: fake.resolver, logger: recorder() });

  const result = await ai.generateText({
    ...callFor(),
    system: 's',
    prompt: 'p',
    maxOutputTokens: 64,
    onDelta: () => {
      // A closed window, a disposed controller. Ordinary, and not the model's
      // fault — and worse than ordinary if it were let through, because it
      // would arrive at the redactor and be reported as a provider failure.
      throw new Error('the window went away');
    }
  });

  assert.equal(result.text, 'one two');
});

/* ------------------------------------------------------------------ spine */

test('a fragment names the run and the step that produced it', async () => {
  const heard = sink();
  const s = spine(
    {
      answers: noop('answers', [stage('only', [generate('compose')])])
    },
    {
      deltas: heard.record,
      ai: {
        generateText: async (request) => {
          for (const text of ['Yes', ', ', 'twice.']) request.onDelta?.(text);
          return { text: 'Yes, twice.', finishReason: 'stop', usage: {} };
        }
      }
    }
  );

  try {
    const handle = beginRun(s.deps, { capability: 'answers', input: {} });
    const result = await handle.settled;

    assert.equal(heard.text(), 'Yes, twice.');
    assert.deepEqual([...new Set(heard.seen.map((delta) => delta.step))], ['compose']);
    assert.deepEqual([...new Set(heard.seen.map((delta) => delta.runId))], [handle.runId]);

    // The point of the whole arrangement: the fragments were a preview, and the
    // result is the answer. A caller that heard nothing loses nothing.
    assert.equal(result.data.answer, 'Yes, twice.');
  } finally {
    s.dispose();
  }
});

test('a tool loop streams too, because that is what a person actually watches', async () => {
  const heard = sink();
  const s = spine(
    { asks: noop('asks', [stage('only', [toolLoop('investigate')])]) },
    {
      deltas: heard.record,
      tools: { names: () => [], has: () => false, handles: () => [] },
      ai: {
        runToolLoop: async (request) => {
          for (const text of ['Looking', '... found it.']) request.onDelta?.(text);
          return { text: 'Looking... found it.', steps: 2, finishReason: 'stop', usage: {} };
        }
      }
    }
  );

  try {
    // `ask_profile` — the one answer a person sits and waits for — is a tool
    // loop. Streaming that covered only plain generation would miss the case
    // the feature exists for.
    const result = await startRun(s.deps, { capability: 'asks', input: {} });

    assert.equal(heard.text(), 'Looking... found it.');
    assert.equal(result.data.text, 'Looking... found it.');
  } finally {
    s.dispose();
  }
});

test('nothing a stream produced is written down', async () => {
  const heard = sink();
  const s = spine(
    { answers: noop('answers', [stage('only', [generate('compose')])]) },
    {
      deltas: heard.record,
      ai: {
        generateText: async (request) => {
          for (let index = 0; index < 200; index += 1) request.onDelta?.(`token-${index} `);
          return { text: 'done', finishReason: 'stop', usage: {} };
        }
      }
    }
  );

  try {
    const handle = beginRun(s.deps, { capability: 'answers', input: {} });
    await handle.settled;

    assert.equal(heard.seen.length, 200, 'the fragments did arrive');

    // And none of them are in the log. An event is written in the same
    // transaction as the state change it announces, and a token announces
    // none; two hundred rows here would bury the six that say what happened,
    // and `seq` exists so a caller can follow those six.
    assert.deepEqual(timeline(s, handle.runId), [
      'run.queued',
      'run.started',
      'run.planned',
      'step.started',
      'step.succeeded',
      'run.succeeded'
    ]);
  } finally {
    s.dispose();
  }
});

test('a run nobody is watching needs no sink and behaves identically', async () => {
  const s = spine(
    { answers: noop('answers', [stage('only', [generate('compose')])]) },
    {
      // No `deltas`. The ordinary case: a CLI, a scheduled job, a test.
      ai: stubGateway({
        generateText: async (request) => {
          // The step passes a sink regardless, because a step that had to ask
          // whether anyone was listening is a step with a branch in it.
          request.onDelta?.('into the void');
          return { text: 'still an answer', finishReason: 'stop', usage: {} };
        }
      })
    }
  );

  try {
    const result = await startRun(s.deps, { capability: 'answers', input: {} });
    assert.equal(result.data.answer, 'still an answer');
  } finally {
    s.dispose();
  }
});
