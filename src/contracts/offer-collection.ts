import type { DiscoveryBoardId, DiscoveryBoardState } from './discovery.js';

export const collectionLimits = { boards: 3, batchesPerBoard: 2, pageSize: 10, offers: 60, retriesPerBoard: 1, deadlineMs: 45000, detailDeadlineMs: 20000 } as const;
export type CollectionCoverage = {
 keyword: string; status: 'searching' | 'fetching' | 'complete';
 sources: { board: DiscoveryBoardId; attempts: number; batches: number; received: number; state: DiscoveryBoardState }[];
 received: number; added: number; detailsCompleted: number; detailsUnavailable: number;
 partial: boolean; limitations: string[];
};
