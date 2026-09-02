/**
 * The job boards this runtime knows by name.
 *
 * Before this the same knowledge was written out in three places — a domain
 * regex in `capabilities/applyRoutes.ts`, a tuple of scraper identifiers in
 * `capabilities/verifyRecipient.ts`, and a ranking regex in `round.ts` — and
 * they had already drifted: `theprotocol.it` was a board for apply-routing and
 * not for ranking, `solid.jobs` for neither.
 *
 * Two of those now read from here. `applyRoutes.ts` deliberately does not, and
 * that is not an oversight: it asks a different question — "is this URL a board
 * rather than the employer's own site" — and wants the broadest possible net,
 * including TLD families (`glassdoor.*`, `stepstone.*`) that this list does not
 * enumerate. Narrowing it to these entries would make `glassdoor.de` read as an
 * employer's own domain, which is exactly the mistake that check exists to
 * prevent. A board may be worth recognising there and not worth searching here.
 *
 * What a board entry is *for*:
 *
 *   1. Scoping a search. `site:justjoin.it react` returns postings; the same
 *      words unqualified return conference talks, blog posts and somebody's
 *      GitHub. This is the reason the list exists.
 *   2. Ranking what a search returned, when the query was not scoped.
 *   3. Attributing an offer to its board, from the URL alone.
 *   4. Knowing what must not be fetched. LinkedIn and Indeed refuse crawlers in
 *      their terms, and a round that does not know this rediscovers them every
 *      time and spends a fetch learning it again.
 *
 * ## Why a hand-written list and not a heuristic
 *
 * "Does this page look like a job posting" is a classifier, and a wrong answer
 * costs a fetch against a site that did not invite one. The set of boards worth
 * searching for Polish software work is about a dozen and changes a few times a
 * year, so a list is both more accurate than a heuristic and cheaper to fix
 * when it is wrong: one line, and the reason it changed sits next to it.
 *
 * ## What this is not
 *
 * Not a crawl list, and not permission. `fetchable: false` is recorded here
 * because the terms say so, and `resolve.ts` still checks robots.txt on every
 * fetch regardless of what this file claims. A board being listed means the
 * runtime can name it, not that it may read it.
 */

export type BoardFetchability =
  /** Ordinary: fetch it, subject to robots.txt like anything else. */
  | 'ok'
  /** The site's terms refuse automated access. Search may name it; nothing reads it. */
  | 'refused';

export type Board = {
  /** Host, lowercased, without `www.`. Matched as a domain or a subdomain of one. */
  domain: string;
  name: string;
  /**
   * cvitae-scrapper's own identifier, where it has an adapter.
   *
   * Present means the board can be searched directly through `/scrape/search`,
   * which needs no search engine and no key at all. Absent means a scoped web
   * query is the only way in.
   */
  scraperId?: string;
  fetchable: BoardFetchability;
  /** ISO-3166-1 alpha-2, lowercased. Used to skip boards outside the market searched. */
  markets: string[];
  /**
   * Whether this board is worth *searching* for software work, as opposed to
   * merely being recognised when it turns up. A general-jobs site carries
   * developer postings and drowns them in everything else, so scoping a query
   * to one spends a query to find what the tech boards already returned.
   */
  search: boolean;
};

/**
 * Ordered by how much of Polish software hiring actually passes through them,
 * because a round searches a prefix of this list rather than all of it.
 */
export const boards: Board[] = [
  {
    domain: 'justjoin.it',
    name: 'Just Join IT',
    scraperId: 'justjoin',
    fetchable: 'ok',
    markets: ['pl'],
    search: true
  },
  {
    domain: 'nofluffjobs.com',
    name: 'No Fluff Jobs',
    scraperId: 'nofluffjobs',
    fetchable: 'ok',
    markets: ['pl', 'cz', 'sk', 'hu'],
    search: true
  },
  {
    domain: 'theprotocol.it',
    name: 'theProtocol.it',
    fetchable: 'ok',
    markets: ['pl'],
    search: true
  },
  {
    domain: 'bulldogjob.pl',
    name: 'Bulldogjob',
    fetchable: 'ok',
    markets: ['pl'],
    search: true
  },
  {
    domain: 'rocketjobs.pl',
    name: 'RocketJobs',
    fetchable: 'ok',
    markets: ['pl'],
    search: true
  },
  {
    domain: 'solid.jobs',
    name: 'SolidJobs',
    fetchable: 'ok',
    markets: ['pl'],
    search: true
  },
  {
    // General, but large enough that skipping it loses real postings — and the
    // one board measured to publish the actual Polish contract form rather than
    // schema.org's employmentType enum. See `boardFacts.ts`.
    domain: 'pracuj.pl',
    name: 'Pracuj.pl',
    scraperId: 'pracuj',
    fetchable: 'ok',
    markets: ['pl'],
    search: true
  },

  /* Recognised, not searched. General-jobs sites: a developer posting is in
     there somewhere, under everything else. */
  { domain: 'praca.pl', name: 'Praca.pl', fetchable: 'ok', markets: ['pl'], search: false },
  { domain: 'jobs.pl', name: 'Jobs.pl', fetchable: 'ok', markets: ['pl'], search: false },
  { domain: 'aplikuj.pl', name: 'Aplikuj.pl', fetchable: 'ok', markets: ['pl'], search: false },
  { domain: 'infopraca.pl', name: 'Infopraca', fetchable: 'ok', markets: ['pl'], search: false },
  { domain: 'goldenline.pl', name: 'GoldenLine', fetchable: 'ok', markets: ['pl'], search: false },
  { domain: 'olx.pl', name: 'OLX Praca', fetchable: 'ok', markets: ['pl'], search: false },
  { domain: 'stepstone.pl', name: 'StepStone', fetchable: 'ok', markets: ['pl', 'de'], search: false },
  { domain: 'xing.com', name: 'XING', fetchable: 'ok', markets: ['de', 'at', 'ch'], search: false },

  /* Recognised so that nothing tries to read them. Both refuse automated
     access in their terms; cvitae-scrapper will not crawl either. */
  { domain: 'linkedin.com', name: 'LinkedIn', fetchable: 'refused', markets: ['pl'], search: false },
  { domain: 'indeed.com', name: 'Indeed', fetchable: 'refused', markets: ['pl'], search: false },
  { domain: 'glassdoor.com', name: 'Glassdoor', fetchable: 'refused', markets: ['pl'], search: false },
  { domain: 'monster.pl', name: 'Monster', fetchable: 'refused', markets: ['pl'], search: false }
];

const withoutWww = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/** The host of a URL, or `''` when it does not have one. */
export const hostOf = (url: string): string => {
  try {
    return withoutWww(new URL(url).hostname);
  } catch {
    return '';
  }
};

/**
 * The board a URL belongs to, if any.
 *
 * Matches a subdomain onto its parent, because boards use them for markets
 * (`nl.indeed.com`) and for regions, and those are the same board.
 */
export const boardFor = (url: string): Board | undefined => {
  const host = hostOf(url);
  if (!host) return undefined;

  return boards.find(
    (board) => host === board.domain || host.endsWith(`.${board.domain}`)
  );
};

/** Whether anything may read this URL, as far as the list knows. */
export const isFetchable = (url: string): boolean =>
  boardFor(url)?.fetchable !== 'refused';

/**
 * The boards worth scoping a search to, most productive first.
 *
 * `market` filters rather than sorts: a Polish search that returns German
 * postings has spent a query, and the country parameter on the search engine
 * only biases results, it does not restrict them.
 */
export const searchableBoards = (market = 'pl'): Board[] =>
  boards.filter((board) => board.search && board.markets.includes(market.toLowerCase()));

/** Boards cvitae-scrapper can search directly, needing no engine and no key. */
export const scrapableBoards = (market = 'pl'): Board[] =>
  searchableBoards(market).filter((board) => board.scraperId !== undefined);
