import type { CvContext } from './cv-context.js';
import type { DocumentRecord } from './document-store.js';
import type { OfferRecord } from './offer.js';

/** Immutable inputs for one offer conversation; current document rows are not history. */
export type OfferSnapshot = {
  readonly id: string;
  readonly conversationId: string;
  readonly context: CvContext;
  readonly document: DocumentRecord;
  readonly offer: OfferRecord;
  readonly photo: { readonly revision: number; readonly photo: {
    readonly mime: 'image/jpeg' | 'image/png'; readonly base64: string;
    readonly width: number; readonly height: number;
  } | null };
  readonly createdAt: number;
};
export type CaptureOfferSnapshot = {
  /** Caller-generated UUID, reused for a retry. */
  readonly id: string;
  readonly offerId: string;
  readonly contextId: string;
  readonly expectedRevision: number;
  readonly expectedContextRevision: number;
  readonly expectedPhotoRevision: number;
};
export interface OfferSnapshotStore {
  capture(request: CaptureOfferSnapshot): OfferSnapshot;
  get(id: string): OfferSnapshot | undefined;
  list(offerId: string, contextId?: string): readonly OfferSnapshot[];
}
