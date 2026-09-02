/**
 * Discovery through the boards themselves, needing no search engine.
 *
 * The same shape as the open-web source and a different mechanism entirely. A
 * web search asks somebody else's index what exists; this asks the boards,
 * through the companion scraper running on the user's own machine. No key, no
 * quota, no account, and nothing about what the user is looking for leaves the
 * laptop.
 *
 * It is also more complete. An engine returns what it chose to index and ranked
 * highly; `justjoin`'s sitemap is every live offer on the board — 9,783 of them
 * when this was written — and the scraper's slug filter narrows that locally.
 *
 * ## What the keyword can and cannot do
 *
 * Matching is against the URL slug, so every term must appear somewhere in it.
 * `react` works. `senior react` works, because both words turn up in slugs like
 * `link-group-senior-fullstack-developer---net-react-warszawa-net`. A phrase
 * like `5 years experience` matches nothing, and neither does `remote` on most
 * boards — only about one slug in a hundred says it, because work mode is a
 * field on the page rather than part of its name.
 *
 * That last point decides the whole design. **Work mode, salary, contract type
 * and seniority are not filtered here**, even though the scraper reads all four
 * out of the offer's JSON-LD a moment later. Filtering on them at this stage
 * would drop every posting that did not *state* one — and a posting that is
 * silent about its contract form has not failed a contract requirement. That
 * distinction is the whole point of `criteria.ts`, which answers `unknown`
 * where a filter would answer no. So this narrows by keyword, the round reads
 * what survives, and the scorer decides — with the offers that said nothing
 * still visible, marked `provisional`.
 */

import type { Listing, SearchHit, SiteReader } from '../../contracts/index.js';
import { scrapableBoards, type Board } from './boards.js';
import type { DiscoveryOutcome, DiscoverySource } from './round.js';

export type BoardSearchOptions = {
  /** Injected so a round can be exercised against boards that do not exist. */
  readonly boards?: readonly Board[];
  /**
   * Rows scanned per board.
   *
   * A cap on what is read back, not one the board honours: `justjoin` returns
   * its whole matching set whatever this says, because the scraper's limit
   * bounds offers *fetched* rather than rows listed. Scanning is free; this
   * exists so a board that one day answers with ten thousand does not turn a
   * round into a sort.
   */
  readonly rowsPerBoard?: number;
};

const toHit = (row: Listing): SearchHit => ({
  url: row.url,
  // Slug-derived on boards that list from a sitemap, and replaced by the real
  // one the moment the offer is read. Good enough to rank a fetch queue, which
  // is all a hit is ever used for.
  title: row.title,
  // Listing rows carry no summary. Company where the board gives one — measured
  // on justjoin, none of 188 rows did — and nothing where it does not.
  snippet: row.company ?? ''
});

/**
 * Builds a discovery source over the boards the scraper can search.
 *
 * Sequential rather than parallel: the scraper throttles per host at two
 * seconds anyway, so firing them at once would only queue inside it, and one
 * board at a time keeps the failure message about the board that failed.
 *
 * Nothing here asks whether the scraper is configured. `listBoard` answers
 * `unavailable` when it is not, which is the same fact arriving through the
 * port that would have to deal with it anyway — and a capability that read the
 * environment to find out would be a capability with an opinion about how the
 * runtime is deployed.
 */
export const boardSearch = (reader: SiteReader, options: BoardSearchOptions = {}): DiscoverySource => {
  const { boards = scrapableBoards(), rowsPerBoard = 200 } = options;

  return async (keyword, { call }): Promise<DiscoveryOutcome> => {
    const searchable = boards.filter((board) => board.scraperId);

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
