import { CvContextError } from '../contracts/index.js';
import type { RunRecord } from '../contracts/index.js';
import type { RunRequest } from './run.js';
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
};
export const requireSameRun = (record: RunRecord, request: RunRequest, input: unknown): void => {
  if (record.capability !== request.capability || record.contextId !== request.contextId ||
      record.conversationId !== request.conversationId || record.offerSnapshotId !== request.offerSnapshotId ||
      (request.contextGeneration !== undefined && request.contextGeneration !== record.contextGeneration) ||
      (request.contextRevision !== undefined && request.contextRevision !== record.contextRevision) ||
      JSON.stringify(canonical(record.input)) !== JSON.stringify(canonical(input))) {
    throw new CvContextError('context_conflict', 'Run ID belongs to another request.');
  }
};
