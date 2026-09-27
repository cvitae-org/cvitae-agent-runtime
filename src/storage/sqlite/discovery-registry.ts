import type { DiscoveryBoard, DiscoverySource } from '../../contracts/discovery.js';
import type { Db } from './open.js';

/** Offline metadata is descriptive only: collection always consults the source. */
export const withDiscoveryMetadata = (db: Db, source: DiscoverySource): DiscoverySource => ({
  requestCost: (id, cursor) => source.requestCost?.(id, cursor) ?? 1,
  validateBoard: id => source.validateBoard?.(id),
  ...(source.browserSearch ? { browserSearch: (board: string, keyword: string, signal: AbortSignal) => source.browserSearch!(board, keyword, signal) } : {}),
  search: (query, signal) => source.search(query, signal),
  async boards(signal) {
    const cached = () => (db.prepare('SELECT descriptor FROM discovery_board_metadata ORDER BY rowid').all() as { descriptor: string }[])
      .map(row => ({ ...JSON.parse(row.descriptor) as DiscoveryBoard, enabled: false, visible: false, defaultSelected: false, browserSearch: { enabled: false, hosts: [] }, unavailableReason: 'Adapter unavailable; saved offers remain available.' }));
    try {
      const result = await source.boards(signal);
      db.transaction(() => {
        const save = db.prepare('INSERT INTO discovery_board_metadata VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET descriptor=excluded.descriptor, updated_at=excluded.updated_at');
        for (const board of result.boards) save.run(board.id, JSON.stringify(board), Date.now());
      })();
      return { ...result, boards: [...result.boards, ...cached().filter(board => !result.boards.some(current => current.id === board.id))] };
    } catch (error) {
      const boards = cached();
      if (!boards.length) throw error;
      return { version: 1, boards, catalogueAvailable: false, collectionUnavailableReason: error instanceof Error ? error.message : 'Source catalogue unavailable. Saved offers remain available.' };
    }
  }
});
