import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeHome } from '../store/paths.js';

export type AiLogMode = 'off' | 'metadata';

export type AiOperation =
  | 'generateObject'
  | 'generateText'
  | 'embed'
  | 'embedMany';

export type AiPurpose =
  | 'extract'
  | 'generate'
  | 'tool_loop'
  | 'planner'
  | 'router'
  | 'image_transcription'
  | 'embedding';

export type AiPayloadSummary = {
  kind: 'text' | 'messages' | 'object' | 'embedding_texts' | 'embedding' | 'embeddings';
  chars?: number;
  items?: number;
  bytes?: number;
  dimensions?: number;
  mediaType?: string;
  shape?: string;
  sha256?: string;
};

export type AiToolInteraction = {
  callId: string;
  name: string;
  status: 'called' | 'ok' | 'error';
  input: AiPayloadSummary;
  output?: AiPayloadSummary;
  error?: { name: string };
};

export type AiToolsSummary = {
  offered?: string[];
  called?: string[];
  interactions?: AiToolInteraction[];
};

export type AiLogEvent = {
  version: 1;
  traceId: string;
  callId: string;
  timestamp: string;
  operation: AiOperation;
  purpose: AiPurpose;
  providerId: string;
  modelId: string;
  capability?: string;
  step?: string;
  status: 'ok' | 'error' | 'aborted';
  durationMs: number;
  steps?: number;
  finishReason?: string;
  usage?: unknown;
  input: AiPayloadSummary;
  output?: AiPayloadSummary;
  tools?: AiToolsSummary;
  error?: {
    name: string;
    code?: string;
    messageChars: number;
    messageSha256: string;
  };
};

export interface AiLogger {
  log(event: AiLogEvent): Promise<void>;
}

const traceStorage = new AsyncLocalStorage<string>();

export const withAiTrace = <T>(traceId: string, call: () => T): T =>
  traceStorage.run(traceId, call);

export const currentAiTraceId = (): string | undefined => traceStorage.getStore();

export class NoopAiLogger implements AiLogger {
  async log(): Promise<void> {}
}

export class JsonlAiLogger implements AiLogger {
  private tail: Promise<void> = Promise.resolve();

  constructor(readonly directory: string) {}

  log(event: AiLogEvent): Promise<void> {
    this.tail = this.tail
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const day = event.timestamp.slice(0, 10);
        await appendFile(
          join(this.directory, `ai-${day}.jsonl`),
          `${JSON.stringify(event)}\n`,
          'utf8'
        );
      });

    return this.tail;
  }
}

export const createAiLogger = ({
  mode,
  directory
}: {
  mode?: AiLogMode;
  directory?: string;
} = {}): AiLogger => {
  const configured = mode ?? (process.env.AI_LOG_MODE?.trim() || 'metadata');

  if (configured === 'off') return new NoopAiLogger();

  if (configured !== 'metadata') {
    console.warn(`Unknown AI_LOG_MODE "${configured}"; using metadata logging.`);
  }

  const logDirectory =
    directory ?? (process.env.AI_LOG_DIR?.trim() || join(runtimeHome(), 'ai-logs'));

  return new JsonlAiLogger(logDirectory);
};

const stableValue = (value: unknown, seen: WeakSet<object>): unknown => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }

  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return value.toString();

  if (value instanceof Uint8Array) {
    return `[bytes:${value.byteLength}:${sha256(value)}]`;
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry, seen));
  }

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = stableValue(record[key], seen);
  }
  return sorted;
};

export const stableStringify = (value: unknown): string =>
  JSON.stringify(stableValue(value, new WeakSet<object>()));

export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

const jsonSummary = (value: unknown): AiPayloadSummary => {
  const serialised = stableStringify(value);
  const shape = Array.isArray(value)
    ? `array:${value.length}`
    : value !== null && typeof value === 'object'
      ? `object:${Object.keys(value).length}`
      : typeof value;

  return {
    kind: 'object',
    chars: serialised.length,
    shape,
    sha256: sha256(serialised)
  };
};

export const summarizeText = (
  kind: 'text' | 'messages',
  ...parts: string[]
): AiPayloadSummary => {
  const value = parts.join('\u0000');
  return { kind, chars: parts.reduce((sum, part) => sum + part.length, 0), sha256: sha256(value) };
};

export const summarizeObject = (value: unknown): AiPayloadSummary => jsonSummary(value);

export const summarizeImage = ({
  prompt,
  bytes,
  mediaType
}: {
  prompt: string;
  bytes: Uint8Array;
  mediaType: string;
}): AiPayloadSummary => {
  const hash = createHash('sha256');
  hash.update(prompt);
  hash.update('\u0000');
  hash.update(bytes);

  return {
    kind: 'messages',
    chars: prompt.length,
    bytes: bytes.byteLength,
    mediaType,
    sha256: hash.digest('hex')
  };
};

export const summarizeEmbeddingInput = (values: string[]): AiPayloadSummary => ({
  kind: 'embedding_texts',
  chars: values.reduce((sum, value) => sum + value.length, 0),
  items: values.length,
  sha256: sha256(stableStringify(values))
});

export const summarizeEmbeddingOutput = (vectors: number[][]): AiPayloadSummary => ({
  kind: vectors.length === 1 ? 'embedding' : 'embeddings',
  items: vectors.length,
  dimensions: vectors[0]?.length ?? 0
});

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;

const errorName = (value: unknown): string =>
  value instanceof Error ? value.name : typeof value === 'string' ? 'Error' : 'UnknownError';

export const summarizeToolInteractions = (result: unknown): AiToolsSummary => {
  const resultRecord = recordOf(result);
  const steps = Array.isArray(resultRecord?.steps) ? resultRecord.steps : [];
  const interactions = new Map<string, AiToolInteraction>();

  for (const step of steps) {
    const stepRecord = recordOf(step);
    const toolCalls = Array.isArray(stepRecord?.toolCalls) ? stepRecord.toolCalls : [];
    const toolResults = Array.isArray(stepRecord?.toolResults) ? stepRecord.toolResults : [];
    const content = Array.isArray(stepRecord?.content)
      ? stepRecord.content.filter((part) => recordOf(part)?.type === 'tool-error')
      : [];

    for (const part of [...toolCalls, ...toolResults, ...content]) {
      const partRecord = recordOf(part);
      if (!partRecord) continue;
      const type = partRecord?.type;
      const toolCallId = partRecord?.toolCallId;
      const toolName = partRecord?.toolName;
      if (typeof toolCallId !== 'string' || typeof toolName !== 'string') continue;

      if (type === 'tool-call') {
        interactions.set(toolCallId, {
          callId: toolCallId,
          name: toolName,
          status: 'called',
          input: jsonSummary(partRecord.input)
        });
      } else if (type === 'tool-result') {
        const previous = interactions.get(toolCallId);
        interactions.set(toolCallId, {
          callId: toolCallId,
          name: toolName,
          status: 'ok',
          input: previous?.input ?? jsonSummary(partRecord.input),
          output: jsonSummary(partRecord.output)
        });
      } else if (type === 'tool-error') {
        const previous = interactions.get(toolCallId);
        interactions.set(toolCallId, {
          callId: toolCallId,
          name: toolName,
          status: 'error',
          input: previous?.input ?? jsonSummary(partRecord.input),
          error: { name: errorName(partRecord.error) }
        });
      }
    }
  }

  const list = [...interactions.values()];
  return {
    called: list.map((interaction) => interaction.name),
    interactions: list
  };
};

let warnedAboutLogging = false;

const safelyLog = async (logger: AiLogger, event: AiLogEvent): Promise<void> => {
  try {
    await logger.log(event);
  } catch (error) {
    if (warnedAboutLogging) return;
    warnedAboutLogging = true;
    console.warn('AI metadata logging failed; continuing without this log entry.', error);
  }
};

const describeError = (error: unknown): AiLogEvent['error'] => {
  const record = recordOf(error);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown AI call error';
  const code = record?.code;

  return {
    name: errorName(error),
    messageChars: message.length,
    messageSha256: sha256(message),
    ...(typeof code === 'string' ? { code } : {})
  };
};

export type LoggedAiCall<T> = {
  logger: AiLogger;
  traceId?: string;
  operation: AiOperation;
  purpose: AiPurpose;
  providerId: string;
  modelId: string;
  capability?: string;
  step?: string;
  signal?: AbortSignal;
  input: AiPayloadSummary;
  tools?: AiToolsSummary;
  call: () => Promise<T>;
  summarizeResult?: (result: T) => {
    output?: AiPayloadSummary;
    finishReason?: string;
    usage?: unknown;
    steps?: number;
    tools?: AiToolsSummary;
  };
};

export const withAiLogging = async <T>({
  logger,
  traceId = currentAiTraceId() ?? randomUUID(),
  operation,
  purpose,
  providerId,
  modelId,
  capability,
  step,
  signal,
  input,
  tools,
  call,
  summarizeResult
}: LoggedAiCall<T>): Promise<T> => {
  const startedAt = Date.now();
  const callId = randomUUID();
  const timestamp = new Date().toISOString();

  try {
    const result = await call();
    let summary: ReturnType<NonNullable<LoggedAiCall<T>['summarizeResult']>> = {};

    try {
      summary = summarizeResult?.(result) ?? {};
    } catch {
      // Summarisation is observability only and cannot invalidate a provider result.
    }

    await safelyLog(logger, {
      version: 1,
      traceId,
      callId,
      timestamp,
      operation,
      purpose,
      providerId,
      modelId,
      capability,
      step,
      status: 'ok',
      durationMs: Date.now() - startedAt,
      input,
      tools: summary.tools ?? tools,
      ...summary
    });

    return result;
  } catch (error) {
    await safelyLog(logger, {
      version: 1,
      traceId,
      callId,
      timestamp,
      operation,
      purpose,
      providerId,
      modelId,
      capability,
      step,
      status: signal?.aborted ? 'aborted' : 'error',
      durationMs: Date.now() - startedAt,
      input,
      tools,
      error: describeError(error)
    });

    throw error;
  }
};
