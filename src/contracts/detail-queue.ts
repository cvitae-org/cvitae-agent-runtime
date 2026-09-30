export type DetailJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
/**
 * `stopReason` says why a job ended short of success: `request_budget` when its
 * search had no requests left for it, or the code of the error a failed read
 * threw (`unreadable_source`, `misconfigured`, …), and `unknown` when that error
 * carried none. It is a code to count failures by; the sentence a person reads
 * stays on the offer's enrichment.
 */
export type DetailJob = { offerId: string; searchId?: string; status: DetailJobStatus; revision: number; stopReason?: string };
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
