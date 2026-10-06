import type { CvContext } from './cv-context.js';
import type { DocumentBody, DocumentRecord } from './document-store.js';

export type CvProposalBase = { readonly contextId: string; readonly revision: number; readonly generation: number };

/** A JSON value: what a document is made of, and what a change carries. */
export type DocumentValue =
  | null
  | boolean
  | number
  | string
  | readonly DocumentValue[]
  | { readonly [key: string]: DocumentValue };

/**
 * One thing that is different about a proposed document: a value at a place is
 * replaced, or a key or an entry is added or removed. The places are keys and
 * indices from the root, and the changes are applied in order, each to what the
 * one before left (`capabilities/cv/diff.ts`).
 */
export type DocumentChange =
  | { readonly op: 'replace'; readonly path: readonly (string | number)[]; readonly before: DocumentValue; readonly after: DocumentValue }
  | { readonly op: 'add'; readonly path: readonly (string | number)[]; readonly after: DocumentValue }
  | { readonly op: 'remove'; readonly path: readonly (string | number)[]; readonly before: DocumentValue };

/** What a proposal says about itself besides the document it proposes. */
export type CvProposalDetails = {
  /** The ref of the section the edit was aimed at. */
  readonly target: string;
  /** What is different about the document, and everything an accept writes. */
  readonly changes: readonly DocumentChange[];
};

export type StoredCvProposal = {
  readonly id: string;
  readonly base: CvProposalBase;
  readonly document: DocumentBody;
  /**
   * The section the edit was aimed at and what it changed. Absent from a proposal
   * made before they were kept, which is accepted as the document it holds.
   */
  readonly target?: string;
  readonly changes?: readonly DocumentChange[];
  readonly status: 'pending' | 'accepted' | 'discarded' | 'invalidated';
  readonly createdAt: number;
};
export type CvClearResult = { readonly context: CvContext; readonly record: DocumentRecord };
export interface CvLifecycle {
  guard<T>(contextId: string, generation: number, write: () => T): T;
  clearContent(contextId: string, expectedRevision: number, operationId: string): CvClearResult;
  propose(runId: string, base: CvProposalBase, document: DocumentBody, details?: CvProposalDetails): StoredCvProposal;
  list(contextId: string): readonly StoredCvProposal[];
  accept(contextId: string, proposalId: string): DocumentRecord;
  discard(contextId: string, proposalId: string): StoredCvProposal;
}
