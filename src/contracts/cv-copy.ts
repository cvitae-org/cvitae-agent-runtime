import type { CvContext, CvLanguage } from './cv-context.js';
import type { DocumentRecord } from './document-store.js';
export type CopyCvContext = {
  readonly id: string;
  readonly language: CvLanguage;
  readonly sourceContextId: string;
  readonly expectedSourceRevision: number;
};
export type CvCopyReceipt = {
  readonly context: CvContext;
  readonly record: DocumentRecord;
  readonly provenance: { readonly sourceContextId: string; readonly sourceRevision: number; readonly copiedAt: number };
};
export interface CvCopyStore {
  copy(request: CopyCvContext): CvCopyReceipt;
  get(contextId: string): CvCopyReceipt | undefined;
}
