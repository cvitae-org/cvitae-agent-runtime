import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  JsonlAiLogger,
  sha256,
  stableStringify,
  summarizeObject,
  summarizeEmbeddingInput,
  summarizeEmbeddingOutput,
  summarizeText,
  summarizeToolInteractions,
  withAiLogging,
  type AiLogEvent,
  type AiLogger
} from '../src/ai/logging.js';

class MemoryLogger implements AiLogger {
  readonly events: AiLogEvent[] = [];

  async log(event: AiLogEvent): Promise<void> {
    this.events.push(event);
  }
}

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

test('stable hashing ignores object key order', () => {
  const first = stableStringify({ b: 2, nested: { z: true, a: 'same' }, a: 1 });
  const second = stableStringify({ a: 1, nested: { a: 'same', z: true }, b: 2 });

  assert.equal(first, second);
  assert.equal(sha256(first), sha256(second));
});

test('metadata events contain hashes but no prompt or output text', async () => {
  const logger = new MemoryLogger();
  const prompt = 'private CV text belonging to Jane Example';
  const output = { name: 'Jane Example', email: 'jane@example.test' };

  const result = await withAiLogging({
    logger,
    traceId: 'trace-1',
    operation: 'generateObject',
    purpose: 'extract',
    providerId: 'test-provider',
    modelId: 'test-model',
    input: summarizeText('text', prompt),
    call: async () => ({ object: output, finishReason: 'stop', usage: { totalTokens: 12 } }),
    summarizeResult: (generated) => ({
      output: summarizeObject(generated.object),
      finishReason: generated.finishReason,
      usage: generated.usage
    })
  });

  assert.deepEqual(result.object, output);
  assert.equal(logger.events.length, 1);
  const serialised = JSON.stringify(logger.events[0]);
  assert.equal(serialised.includes(prompt), false);
  assert.equal(serialised.includes('Jane Example'), false);
  assert.equal(serialised.includes('jane@example.test'), false);
  assert.match(logger.events[0]?.input.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(logger.events[0]?.output?.sha256 ?? '', /^[a-f0-9]{64}$/);
});

test('JSONL logger writes one valid event per line', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cvitae-ai-logs-'));
  temporaryDirectories.push(directory);
  const logger = new JsonlAiLogger(directory);
  const timestamp = '2026-08-17T12:00:00.000Z';

  const event: AiLogEvent = {
    version: 1,
    traceId: 'trace-jsonl',
    callId: 'call-jsonl',
    timestamp,
    operation: 'embed',
    purpose: 'embedding',
    providerId: 'local',
    modelId: 'nomic-embed-text',
    status: 'ok',
    durationMs: 4,
    input: summarizeText('text', 'private input')
  };

  await Promise.all([logger.log(event), logger.log({ ...event, callId: 'call-jsonl-2' })]);

  const content = await readFile(join(directory, 'ai-2026-08-17.jsonl'), 'utf8');
  const lines = content.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => JSON.parse(line).callId), [
    'call-jsonl',
    'call-jsonl-2'
  ]);
  assert.equal(content.includes('private input'), false);
});

test('logging failures do not reject successful AI calls', async () => {
  const logger: AiLogger = {
    async log() {
      throw new Error('disk unavailable');
    }
  };
  const originalWarn = console.warn;
  console.warn = () => undefined;

  try {
    const value = await withAiLogging({
      logger,
      operation: 'generateText',
      purpose: 'router',
      providerId: 'test-provider',
      modelId: 'test-model',
      input: summarizeText('text', 'request'),
      call: async () => 'provider result'
    });

    assert.equal(value, 'provider result');
  } finally {
    console.warn = originalWarn;
  }
});

test('failed calls log error metadata without the provider message', async () => {
  const logger = new MemoryLogger();
  const providerMessage = 'provider response included private model output';

  await assert.rejects(
    withAiLogging({
      logger,
      traceId: 'trace-error',
      operation: 'generateText',
      purpose: 'router',
      providerId: 'test-provider',
      modelId: 'test-model',
      input: summarizeText('text', 'private request'),
      call: async () => {
        throw new Error(providerMessage);
      }
    }),
    { message: providerMessage }
  );

  assert.equal(logger.events[0]?.status, 'error');
  assert.equal(JSON.stringify(logger.events[0]).includes(providerMessage), false);
  assert.equal(logger.events[0]?.error?.messageChars, providerMessage.length);
  assert.match(logger.events[0]?.error?.messageSha256 ?? '', /^[a-f0-9]{64}$/);
});

test('embedding summaries include counts and dimensions but no vectors', () => {
  const input = summarizeEmbeddingInput(['private first value', 'private second value']);
  const output = summarizeEmbeddingOutput([
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6]
  ]);
  const serialised = JSON.stringify({ input, output });

  assert.equal(input.items, 2);
  assert.equal(output.items, 2);
  assert.equal(output.dimensions, 3);
  assert.equal(serialised.includes('private first value'), false);
  assert.equal(serialised.includes('0.1'), false);
});

test('tool summaries retain names and shapes without arguments or results', () => {
  const summary = summarizeToolInteractions({
    steps: [
      {
        toolCalls: [
          {
            type: 'tool-call',
            toolCallId: 'tool-1',
            toolName: 'search_profile',
            input: { query: 'private profile query' }
          }
        ],
        toolResults: [
          {
            type: 'tool-result',
            toolCallId: 'tool-1',
            toolName: 'search_profile',
            input: { query: 'private profile query' },
            output: { matches: ['private profile result'] }
          }
        ],
        content: []
      }
    ]
  });

  assert.deepEqual(summary.called, ['search_profile']);
  assert.equal(summary.interactions?.[0]?.status, 'ok');
  const serialised = JSON.stringify(summary);
  assert.equal(serialised.includes('private profile query'), false);
  assert.equal(serialised.includes('private profile result'), false);
});
