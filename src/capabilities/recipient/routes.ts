/**
 * Turning search results into somewhere to apply.
 *
 * A search hands back whatever ranked for a company's name: the employer's own
 * site, their listing on four boards, their profile on two social networks, a
 * company register, and an aggregator that copied the posting yesterday.
 * Sorting those is a judgement, so it lives here beside `ranking.ts` rather
 * than next to the fetching — the same division this runtime draws everywhere.
 * Everything in this file is pure and none of it calls a model.
 *
 * Three questions, and they have different answers:
 *
 *   Which domain is the employer's?   Not a board, not a social network, not an
 *                                     applicant tracking system — those host
 *                                     thousands of employers and belong to none
 *                                     of them. The answer feeds the company
 *                                     read, which checks the page carries the
 *                                     name before anything is believed about it.
 *
 *   Which pages are worth opening?    The employer's own, and the ATS page they
 *                                     hand applications to. Deliberately not the
 *                                     boards — a separate tier already sweeps
 *                                     those — and not the aggregators, whose
 *                                     contact details are copies of a copy.
 *
 *   Where can a person actually apply? The list shown when there is no address
 *                                     at all, which is the common case: a
 *                                     careers page and an ATS link beat
 *                                     "nothing found" by a wide margin.
 */

import { registrableDomain } from './ranking.js';
import type { SearchHit } from '../../contracts/index.js';

/** Lowercase alphanumerics only, so a slug and a company name compare equal. */
export const slug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/gi, '');

import type {IntegrationSourceInfo} from '../../contracts/effects.js';
export type HostKind = 'ats' | 'board' | 'social' | 'directory' | 'employer';

export const hostKind = (url: string, sources:readonly IntegrationSourceInfo[]=[]): HostKind => {
  const domain = registrableDomain(url);
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return domain;
    }
  })();

  const classifications=sources.flatMap(source=>[...(source.hosts??[source.domain]).map(host=>({host,kind:'board' as const})),...(source.routing??[])]);
  const matches=classifications.filter(item=>host===item.host||host.endsWith('.'+item.host)).sort((a,b)=>b.host.length-a.host.length);
  if(matches.length)return matches[0]!.kind;

  return 'employer';
};

/** Anchor text or path that means "we hire here", in the languages this reads. */
const CAREERS =
  /(career|kariera|praca|jobs?|vacanc|recruit|rekrutacj|join-?us|dolacz|dołącz|work-?with-?us|oferty-pracy|wakat)/i;

const CONTACT = /(contact|kontakt|about-?us|o-nas|impressum|kontakty)/i;

export type RouteKind = 'form' | 'ats' | 'careers' | 'contact' | 'page';

export type ApplyRoute = {
  readonly url: string;
  readonly kind: RouteKind;
  /** The page's own title, when the source had one. Never rendered as HTML. */
  readonly title?: string;
  readonly host: string;
  /** Which tier produced it, so a caller can say where it came from. */
  readonly source: 'board' | 'company_site' | 'web';
};

/**
 * What a URL is, judged on the URL and on the words around it.
 *
 * The title and snippet are a search engine's, so they are used the way a
 * snippet may be used here — to sort and to label, never to conclude. The worst
 * a mislabelled route can do is appear under the wrong heading in a list of
 * links a person clicks.
 */
export const routeKind = (url: string, title = '', snippet = '', sources:readonly IntegrationSourceInfo[]=[]): RouteKind => {
  if (hostKind(url,sources) === 'ats') return 'ats';

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
  readonly domain: string;
  /** Every URL seen on this domain, best first. Used to skip a second crawl. */
  readonly urls: readonly string[];
  readonly score: number;
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
 * checked by whoever fetches them. Nothing here decides — the company read
 * refuses a domain whose page does not carry the company's name.
 */
export const domainCandidates = (
  hits: readonly SearchHit[],
  company: string,
  limit = 4, sources:readonly IntegrationSourceInfo[]=[]
): DomainCandidate[] => {
  const wanted = slug(company);
  const byDomain = new Map<string, { domain: string; urls: string[]; score: number }>();

  hits.forEach((hit, index) => {
    if (hostKind(hit.url,sources) !== 'employer') return;

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

    const kind = routeKind(hit.url, hit.title, hit.snippet,sources);

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
  readonly url: string;
  readonly kind: RouteKind;
  readonly title: string;
  readonly host: string;
  /** The engine's snippet held an `@`. Ordering only, never evidence. */
  readonly promising: boolean;
};

const sameUrl = (a: string, b: string): boolean =>
  a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

/**
 * Which results to actually open, in the order to open them.
 *
 * The budget is small — every one of these is a request a person is waiting on
 * — so the ordering matters more than the filtering. A snippet containing an
 * `@` goes first: the engine has already shown that page holds an address, and
 * confirming it costs one fetch while finding it any other way costs several.
 * That is the whole use a snippet is put to. It moves a URL up this queue and
 * the address still has to be found on the page itself to count for anything.
 *
 * `alreadyRead` is the pages the company crawl reached. Fetching those again
 * would spend the budget re-reading text that is already gathered, and would
 * count one page as two independent sources.
 */
export const pagesToOpen = (
  hits: readonly SearchHit[],
  {
    companyDomains = [],
    alreadyRead = [],
    limit = 3, sources=[]
  }: {
    companyDomains?: readonly string[];
    alreadyRead?: readonly string[];
    limit?: number; sources?:readonly IntegrationSourceInfo[];
  } = {}
): PagePick[] => {
  const owned = new Set(companyDomains.map(registrableDomain).filter(Boolean));

  const picks = hits
    .filter((hit) => {
      const kind = hostKind(hit.url,sources);

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
      kind: routeKind(hit.url, hit.title, hit.snippet,sources),
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
        Number(b.promising) - Number(a.promising) || ROUTE_ORDER[a.kind] - ROUTE_ORDER[b.kind]
    )
    .slice(0, limit);
};

/**
 * Everywhere an application can be handed over.
 *
 * Deduplicated across tiers, because the board's stated apply URL and the top
 * search result are frequently the same ATS link, and showing it twice makes
 * the list look like it was assembled rather than chosen.
 */
export const collectApplyRoutes = (
  routes: readonly ApplyRoute[],
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

  return unique.sort((a, b) => ROUTE_ORDER[a.kind] - ROUTE_ORDER[b.kind]).slice(0, limit);
};
