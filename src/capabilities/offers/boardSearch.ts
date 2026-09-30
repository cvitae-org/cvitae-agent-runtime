import type { Listing, SearchHit, SiteReader } from '../../contracts/index.js';
import { type Board } from './boards.js';
import type { DiscoveryOutcome, DiscoverySource } from './round.js';

export type BoardSearchOptions = {

  readonly boards?: readonly Board[];

  readonly rowsPerBoard?: number;
};

const toHit = (row: Listing): SearchHit => ({
  url: row.url,
  // Slug-derived on boards that list from a sitemap, and replaced by the real
  // one the moment the offer is read. Good enough to rank a fetch queue, which
  // is all a hit is ever used for.
  title: row.title,
  // Listing rows carry no summary. Company where the board gives one — measured
  // by some sources — and nothing where it does not.
  snippet: row.company ?? ''
});


export const boardSearch = (reader: SiteReader, options: BoardSearchOptions = {}): DiscoverySource => {
  const { boards, rowsPerBoard = 200 } = options;

  return async (keyword, { call }): Promise<DiscoveryOutcome> => {
    const searchable = (boards ?? await reader.integrationSources?.(call) ?? []).filter((board) => board.scraperId);

    if (searchable.length === 0) {
      return { status: 'unavailable', detail: 'No board in the registry can be searched directly.' };
    }

    const hits: SearchHit[] = [];
    const failures: string[] = [];
    let unavailable = 0;

    for (const board of searchable) {
      call.signal.throwIfAborted();

      const outcome = await reader.listBoard(
        { board: board.scraperId as string, keyword, limit: rowsPerBoard },
        call
      );

      if (outcome.status === 'ok') {
        hits.push(...outcome.data.map(toHit));
        continue;
      }

      // `unavailable` is the scraper not answering at all, which is one fact
      // about the process rather than one fact per board — counted so it can be
      // reported as itself rather than as four boards that happened to fail.
      if (outcome.status === 'unavailable') unavailable++;

      failures.push(`${board.name}: ${outcome.detail}`);
    }

    if (unavailable === searchable.length) {
      return {
        status: 'unavailable',
        detail:
          'The companion scraper is not answering, so no board could be searched. ' +
          `Start it, or configure web search and use the open web instead. (${failures[0] ?? ''})`
      };
    }

    // A board answering "nothing matched" is an answer. Only every board
    // failing is a failure, and then the detail names each one.
    if (hits.length === 0 && failures.length === searchable.length) {
      return { status: 'failed', detail: failures.join('; ') };
    }

    return { status: 'ok', hits };
  };
};
