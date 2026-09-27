import { planBulldogjobSearch } from '@cvitae/job-pages';
import type { DiscoveryBrowserPlan } from '../contracts/discovery.js';
import { OperationError } from '../contracts/operation-error.js';
import type { ProviderSnapshot } from './discovery-provider.js';
import type { DiscoveryRegistration } from './discovery-registry.js';

type Source = ProviderSnapshot['sources'][number];
type Route = { listing: string; parameter?: string; planner?: 'bulldogjob' };

// Compatibility planners are installed code. A provider can select one only
// with its audited route; arbitrary adapter IDs never become executable code.
export function browserRoute(source: Source): Route | undefined {
  if (!source.modes.includes('external-link')) return undefined;
  const recipe = source.browserRecipe;
  if (recipe) return { listing: `https://${recipe.hosts[0]}${recipe.listing.path}`, parameter: recipe.listing.keywordParameter };
  const routes = source.routes;
  if (!routes) return undefined;
  if (routes.search.kind === 'query' && routes.search.parameter) return { listing: routes.listing, parameter: routes.search.parameter };
  if (routes.search.kind === 'browse') return { listing: routes.listing };
  if (source.adapterId === 'bulldogjob-html' && routes.listing === 'https://bulldogjob.pl/companies/jobs') return { listing: routes.listing, planner: 'bulldogjob' };
  return undefined;
}

export function browserPlan(source: { id: string; hosts: readonly string[] }, route: Route | undefined, keyword: string): DiscoveryBrowserPlan {
  if (!route || keyword.length > 300) throw new OperationError('unsupported_source', 'Browser search is unavailable for this source.');
  const query = keyword.trim();
  const url = new URL(route.listing);
  if (route.parameter) url.searchParams.set(route.parameter, query);
  const plan = route.planner === 'bulldogjob' ? planBulldogjobSearch(query) : {
    version: 1 as const, query, url: url.href, filters: [],
    unmappedTerms: !route.parameter && query ? [query] : [], needsReview: !route.parameter && !!query,
  };
  const target = new URL(plan.url);
  if (target.protocol !== 'https:' || target.username || target.password || target.port || target.hash || !source.hosts.includes(target.hostname)) {
    throw new OperationError('invalid_response', 'Invalid browser search destination.');
  }
  return { ...plan, board: source.id };
}

export function browserDescriptor(source: Source | DiscoveryRegistration, route: Route | undefined) {
  try {
    browserPlan(source, route, '');
    return { enabled: true, hosts: [...source.hosts] };
  } catch { return { enabled: false, hosts: [] }; }
}
