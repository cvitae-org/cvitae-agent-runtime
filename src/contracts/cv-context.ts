import { OperationError } from './operation-error.js';

/** Context identity is stable; language is assigned separately from content. */
export const cvLanguages = ['pl', 'en'] as const;
export type CvLanguage = (typeof cvLanguages)[number];
export const LEGACY_CV_CONTEXT_ID = 'cv';

export type CvContext = {
  readonly includePhoto: boolean;
  /** Advances on clear; stale runs may no longer commit. */
  readonly generation: number;
  /** Also the document-store ID. An empty context may have no document yet. */
  readonly id: string;
  /** Null is reserved for the preserved legacy context awaiting assignment. */
  readonly language: CvLanguage | null;
  /** Metadata revision; independent of the document's content revision. */
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export class CvContextError extends OperationError {
  constructor(
    readonly code: 'context_not_found' | 'context_conflict' | 'language_in_use' |
      'language_assignment_required' | 'invalid_input',
    message: string,
    readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(code, message);
    this.name = 'CvContextError';
  }
}

export interface CvContextStore {
  list(): readonly CvContext[];
  get(id: string): CvContext | undefined;
  /**
   * Creates an empty context. The caller supplies a UUID stable across retries.
   * Replaying the same ID/language returns it without resetting its content.
   * Assign the legacy context before creating another version.
   */
  create(id: string, language: CvLanguage): CvContext;
  /**
   * One-time legacy language assignment, guarded by its metadata revision.
   * Repeating the same assignment is safe; changing an assigned language is
   * deliberately unsupported. Content and document revision do not change.
   */
  assignLanguage(id: string, language: CvLanguage, expectedRevision: number): CvContext;
}
