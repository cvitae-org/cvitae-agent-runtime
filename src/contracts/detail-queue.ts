export type DetailJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type DetailJob = { offerId: string; searchId?: string; status: DetailJobStatus; revision: number; stopReason?: 'request_budget' };
export interface DetailQueueStore {
  enqueue(searchId: string, ids: readonly string[]): void;
  forgetCancelledSearch?(searchId: string): void;
  forSearch?(searchId: string): DetailJob[];
  next(): DetailJob | undefined;
  set(id: string, status: DetailJobStatus, stopReason?: DetailJob['stopReason']): void;
  poll(after: number): { jobs: DetailJob[]; after: number; hasMore: boolean; queued: number; running: number; paused: boolean };
  pause(value: boolean): void;
  clearQueued(): number;
  paused(): boolean;
  recover(): void;
}
