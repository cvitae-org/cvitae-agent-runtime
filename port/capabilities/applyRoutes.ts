/**
 * Turning search results into somewhere to apply.
 *
 * `webSearch` hands back whatever ranked for a company's name: the employer's
 * own site, their listing on four boards, their profile on two social networks,
 * a company register, and an aggregator that copied the posting yesterday.
 * Sorting those is a judgement, so it lives here beside `recipientRanking`
 * rather than next to the fetching — the same division the rest of this project
 * draws. Everything in this file is pure and none of it calls a model.
 *
 * Three questions, and they have different answers:
 *
 *   Which domain is the employer's?   Not a board, not a social network, not an
 *                                     applicant tracking system — those host
 *                                     thousands of employers and belong to none
 *                                     of them. The answer feeds `scrapeCompany`,
 *                                     which verifies it carries the name before
 *                                     anything is believed about it.
 *
 *   Which pages are worth opening?    The employer's own, and the ATS page they
 *                                     hand applications to. Deliberately not the
 *                                     boards — a separate tier already sweeps
 *                                     those — and not the aggregators, whose
 *                                     contact details are copies of a copy.
 *
 *   Where can a person actually apply? The list the panel shows when there is no
 *                                     address at all, which is the common case
 *                                     now: a careers page and an ATS link beat
 *                                     "nothing found" by a wide margin.
 */

import { registrableDomain } from './recipientRanking.js';
import type { SearchHit } from '../offers/webSearch.js';

/** Lowercase alphanumerics only, so a slug and a company name compare equal. */
export const slug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/gi, '');

/**
 * Applicant tracking systems: where an employer's "Apply" button lands.
 *
 * Worth opening and worth showing, and never mistaken for the employer's own
 * domain — `jobs.lever.co` belongs to Lever, and an address found on it is on
 * Lever's domain, not the company's. Keeping the two apart is what stops a
 * careers page hosted by a third party from attesting a domain match.
 */
const ATS =
  /(^|\.)(lever\.co|greenhouse\.io|workable\.com|recruitee\.com|teamtailor\.com|smartrecruiters\.com|breezy\.hr|jobvite\.com|ashbyhq\.com|personio\.(com|de)|bamboohr\.com|myworkdayjobs\.com|taleo\.net|successfactors\.(com|eu)|icims\.com|applytojob\.com|jazz\.co|erecruiter\.pl|traffit\.com|elevato\.net|hrlink\.pl|emplo\.com|tribe39\.com|workday\.com)$/i;

/**
 * Boards. Excluded from everything here, for two different reasons: the three
 * this project crawls are already swept by the `other_boards` tier, and the
 * ones that refuse crawling would only produce a blocked fetch.
 */
const BOARD =
  /(^|\.)(justjoin\.it|nofluffjobs\.com|pracuj\.pl|theprotocol\.it|rocketjobs\.pl|bulldogjob\.pl|solid\.jobs|jobs\.pl|aplikuj\.pl|praca\.pl|infopraca\.pl|olx\.pl|linkedin\.com|indeed\.com|glassdoor\.[a-z.]+|xing\.com|goldenline\.pl|monster\.[a-z.]+|stepstone\.[a-z.]+)$/i;

const SOCIAL =
  /(^|\.)(facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|medium\.com|github\.com|gitlab\.com|wikipedia\.org|crunchbase\.com|pinterest\.[a-z.]+|reddit\.com)$/i;

/**
 * Registers and scraped aggregators.
 *
 * These do publish company addresses, which is exactly why they are refused.
 * The address on a company register is the one filed with the registrar years
 * ago, and an aggregator's is a copy of a board's copy — both look like
 * corroboration while being neither independent nor current. A wrong address
 * that arrives wearing a second source is worse than no second source.
 */
const DIRECTORY =
  /(^|\.)(aleo\.com|panoramafirm\.pl|rejestr\.io|krs-online\.com\.pl|biznes\.gov\.pl|imsig\.pl|bizraport\.pl|gowork\.pl|jooble\.org|careerjet\.[a-z.]+|talent\.com|neuvoo\.[a-z.]+|trovit\.[a-z.]+|jobsora\.com|whatjobs\.com|jobtome\.com)$/i;

export type HostKind = 'ats' | 'board' | 'social' | 'directory' | 'employer';

export const hostKind = (url: string): HostKind => {
  const domain = registrableDomain(url);
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return domain;
    }
  })();

  if (ATS.test(domain) || ATS.test(host)) return 'ats';
  if (BOARD.test(domain)) return 'board';
  if (SOCIAL.test(domain)) return 'social';
  if (DIRECTORY.test(domain)) return 'directory';

  return 'employer';
};

/** Anchor text or path that means "we hire here", in the languages this reads. */
const CAREERS =
  /(career|kariera|praca|jobs?|vacanc|recruit|rekrutacj|join-?us|dolacz|dołącz|work-?with-?us|oferty-pracy|wakat)/i;

const CONTACT = /(contact|kontakt|about-?us|o-nas|impressum|kontakty)/i;

export type RouteKind = 'form' | 'ats' | 'careers' | 'contact' | 'page';

export type ApplyRoute = {
  url: string;
  kind: RouteKind;
  /** The page's own title, when the source had one. Never rendered as HTML. */
  title?: string;
  host: string;
  /** Which tier produced it, so the panel can say where it came from. */
  source: 'board' | 'company_site' | 'web';
};

/**
 * What a URL is, judged on the URL and on the words around it.
 *
 * The title and snippet are a search engine's, so they are used the way a
 * snippet may be used here — to sort and to label, never to conclude. The worst
 * a mislabelled route can do is appear under the wrong heading in a list of
 * links a person clicks.
 */
export const routeKind = (url: string, title = '', snippet = ''): RouteKind => {
  if (hostKind(url) === 'ats') return 'ats';

  const path = (() => {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  })();

  if (CAREERS.test(path)) return 'careers';
  if (CONTACT.test(path)) return 'contact';

  // Falls back to what the result said about itself, which is how a careers
  // page at `/o-nas/zespol` is still recognised as one.
  if (CAREERS.test(title)) return 'careers';
  if (CONTACT.test(title)) return 'contact';
  if (CAREERS.test(snippet)) return 'careers';

  return 'page';
};

/** Order to offer routes in: the ones that take an application come first. */
const ROUTE_ORDER: Record<RouteKind, number> = {
  form: 0,
  ats: 1,
  careers: 2,
  contact: 3,
  page: 4
};

export type DomainCandidate = {
  domain: string;
  /** Every URL seen on this domain, best first. Used to skip a second crawl. */
  urls: string[];
  score: number;
};

/**
 * Which domains from a result set might be the employer's own.
 *
 * Scored rather than filtered, because the top result for a company name is
 * often correct and often a board, and the difference between "appears once at
 * rank nine" and "appears three times including a careers page" is the whole
 * signal available before anything is fetched.
 *
 * The name match is the heaviest term and is deliberately loose in one
 * direction only: `upvanta.com` for "Upvanta Sp. z o.o." matches because the
 * legal form is noise, while `upvanta.io` and `upvanta.com` both survive to be
 * checked by whoever fetches them. Nothing here decides — `scrapeCompany`
 * refuses a domain whose page does not carry the company's name.
 */
export const domainCandidates = (
  hits: SearchHit[],
  company: string,
  limit = 4
): DomainCandidate[] => {
  const wanted = slug(company);
  const byDomain = new Map<string, DomainCandidate>();

  hits.forEach((hit, index) => {
    if (hostKind(hit.url) !== 'employer') return;

    const domain = registrableDomain(hit.url);

    if (!domain) return;

    const entry = byDomain.get(domain) ?? { domain, urls: [], score: 0 };

    if (entry.urls.length === 0) {
      const label = slug(domain.split('.')[0] ?? '');

      // Both directions, because a domain is often an abbreviation of the name
      // and occasionally the name is an abbreviation of the domain.
      if (wanted.length >= 3 && label.length >= 3) {
        if (label === wanted) entry.score += 6;
        else if (label.includes(wanted) || wanted.includes(label)) entry.score += 4;
      }

      // Rank, worth something and not worth much: engines rank a board above a
      // small employer's own site for the employer's own name.
      if (index === 0) entry.score += 2;
      else if (index <= 2) entry.score += 1;
    }

    if (wanted.length >= 3 && slug(hit.title).includes(wanted)) entry.score += 2;

    // Repeated appearances, capped: one domain filling the page with product
    // pages is not four times the evidence.
    if (entry.urls.length < 3) entry.score += 1;

    const kind = routeKind(hit.url, hit.title, hit.snippet);

    if (kind === 'careers') entry.score += 2;
    if (kind === 'contact') entry.score += 1;

    entry.urls.push(hit.url);
    byDomain.set(domain, entry);
  });

  return [...byDomain.values()]
    .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain))
    .slice(0, limit);
};

/** A page the web tier decided to fetch, with why it was picked. */
export type PagePick = {
  url: string;
  kind: RouteKind;
  title: string;
  host: string;
  /** The engine's snippet held an `@`. Ordering only — see `webSearch`. */
  promising: boolean;
};

const sameUrl = (a: string, b: string): boolean =>
  a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

/**
 * Which results to actually open, in the order to open them.
 *
 * The budget is small — every one of these is a request a person is waiting on —
 * so the ordering matters more than the filtering. A snippet containing an `@`
 * goes first: the engine has already shown that page holds an address, and
 * confirming it costs one fetch while finding it any other way costs several.
 *
 * `alreadyRead` is the pages the company crawl reached. Fetching those again
 * would spend the budget re-reading text that is already gathered, and would
 * count one page as two independent sources.
 */
export const pagesToOpen = (
  hits: SearchHit[],
  {
    companyDomains = [],
    alreadyRead = [],
    limit = 3
  }: { companyDomains?: string[]; alreadyRead?: string[]; limit?: number } = {}
): PagePick[] => {
  const owned = new Set(companyDomains.map(registrableDomain).filter(Boolean));

  const picks = hits
    .filter((hit) => {
      const kind = hostKind(hit.url);

      // Boards are another tier's job, and directories are copies. Social
      // profiles publish a contact address that belongs to the network's
      // profile owner and is stale as often as not.
      if (kind === 'board' || kind === 'social' || kind === 'directory') return false;

      // An employer-looking domain is only worth opening when it is plausibly
      // *this* employer: either the domain is already established as theirs, or
      // the page is about hiring. Everything else on the results page is a
      // competitor, a news article, or a company with a similar name.
      if (kind === 'employer' && owned.size > 0 && !owned.has(registrableDomain(hit.url))) {
        return false;
      }

      return true;
    })
    .filter((hit) => !alreadyRead.some((read) => sameUrl(read, hit.url)))
    .map((hit) => ({
      url: hit.url,
      kind: routeKind(hit.url, hit.title, hit.snippet),
      title: hit.title,
      host: (() => {
        try {
          return new URL(hit.url).host;
        } catch {
          return '';
        }
      })(),
      promising: hit.snippet.includes('@')
    }))
    // A bare product page on the employer's domain is not where anyone applies.
    .filter((pick) => pick.kind !== 'page' || owned.has(registrableDomain(pick.url)));

  const seen = new Set<string>();

  return picks
    .filter((pick) => {
      const key = pick.url.replace(/\/+$/, '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        Number(b.promising) - Number(a.promising) ||
        ROUTE_ORDER[a.kind] - ROUTE_ORDER[b.kind]
    )
    .slice(0, limit);
};

/**
 * The list the panel shows: everywhere an application can be handed over.
 *
 * Deduplicated across tiers, because the board's stated `apply_url` and the top
 * search result are frequently the same ATS link, and showing it twice makes
 * the list look like it was assembled rather than chosen.
 */
export const collectApplyRoutes = (
  routes: ApplyRoute[],
  limit = 6
): ApplyRoute[] => {
  const seen = new Set<string>();
  const unique: ApplyRoute[] = [];

  for (const route of routes) {
    const key = route.url.replace(/\/+$/, '').toLowerCase();

    if (!route.url || seen.has(key)) continue;

    seen.add(key);
    unique.push(route);
  }

  return unique
    .sort((a, b) => ROUTE_ORDER[a.kind] - ROUTE_ORDER[b.kind])
    .slice(0, limit);
};
