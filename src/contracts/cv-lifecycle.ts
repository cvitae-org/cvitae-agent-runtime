import type { CvContext } from './cv-context.js';
import type { DocumentBody, DocumentRecord } from './document-store.js';

export type CvProposalBase = { readonly contextId: string; readonly revision: number; readonly generation: number };
export type StoredCvProposal = {
  readonly id: string;
  readonly base: CvProposalBase;
  readonly document: DocumentBody;
  readonly status: 'pending' | 'accepted' | 'discarded' | 'invalidated';
  readonly createdAt: number;
};
export type CvClearResult = { readonly context: CvContext; readonly record: DocumentRecord };
export interface CvLifecycle {
  guard<T>(contextId: string, generation: number, write: () => T): T;
  clearContent(contextId: string, expectedRevision: number, operationId: string): CvClearResult;
  propose(runId: string, base: CvProposalBase, document: DocumentBody): StoredCvProposal;
  list(contextId: string): readonly StoredCvProposal[];
  accept(contextId: string, proposalId: string): DocumentRecord;
  discard(contextId: string, proposalId: string): StoredCvProposal;
}
