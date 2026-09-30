import { randomUUID } from 'node:crypto';
import { browserRecipeScope } from '@cvitae/job-pages';
import { OperationError } from '../contracts/operation-error.js';
import type { BrowserRecipePin, RecipeTarget } from './browser-recipes.js';
import type { IntegrationProviders, ScopedIntegration } from './integration-providers.js';
import { connectionEnabled, executionFor } from './integration-execution.js';

export function createIntegrationBrowserRecipes(providers: IntegrationProviders, now = Date.now) {
  let resolved: Awaited<ReturnType<IntegrationProviders['resolve']>> = { providers: [], sources: [] };
  const pins = new Map<string, BrowserRecipePin>();
  const epochs = new WeakMap<BrowserRecipePin, number | undefined>();
  const fail = (message: string): never => { throw new OperationError('browser_recipe_unavailable', message); };
  const available = (source: ScopedIntegration, revision = source.source.revision) => {
    const provider = resolved.providers.find(provider => provider.connectionId === source.reference.connectionId);
    return connectionEnabled(providers, source) && Date.parse(source.validUntil) > now() && source.source.health.status !== 'drift'
      && !provider?.snapshot?.revokedRecipes.some(recipe => recipe.sourceId === source.reference.sourceId && recipe.revision === revision);
  };
  const assertCurrent = (pin: BrowserRecipePin) => {
    const source = resolved.sources.find(source => source.key === pin.integration!.provenance.sourceKey);
    if (pin.expiresAt <= now() || Date.parse(pin.validUntil) <= now()) fail('The browser recipe expired. Start a new preview or collection.');
    if (!source || epochs.get(pin) !== providers.generation(source.reference.connectionId) || !((pin.recipe.kind === 'dom-detail-v1' || pin.recipe.kind === 'dom-detail-v2') ? source.source.detailRecipe : source.source.browserRecipe) || !available(source, pin.recipe.revision)) fail('This provider connection or recipe was withdrawn. Collected previews remain available.');
  };
  const refresh = async () => { resolved = await providers.resolve(AbortSignal.timeout(15000)); };
  return {
    enabled: true, refresh,
    async prepare(session: string, target: RecipeTarget, sourceKey?: string) {
      await refresh();
      for (const [token, pin] of pins) if (pin.expiresAt <= now()) pins.delete(token);
      const url = new URL(target.url);
      const recipeFor = (source: ScopedIntegration) => [source.source.browserRecipe, source.source.detailRecipe].find(recipe => recipe && browserRecipeScope(recipe, target.url));
      const candidates = resolved.sources.filter(source => (!sourceKey || source.key === sourceKey) && recipeFor(source)?.hosts.includes(url.hostname) && available(source));
      if (!candidates.length) {
        if (sourceKey) return fail('The selected provider does not have an available browser recipe for this page.');
        return { recipe: null, recipeToken: null };
      }
      // A bound board search chooses explicitly; a free browser uses configured
      // priority only when it has a unique winner. Equal priorities are ambiguous.
      const priority = (source: ScopedIntegration) => providers.connections().find(connection => connection.id === source.reference.connectionId)!.priority;
      candidates.sort((a, b) => priority(a) - priority(b));
      if (!sourceKey && candidates.length > 1 && priority(candidates[0]!) === priority(candidates[1]!)) return fail('Several providers cover this page. Open it from the desired source search or select a provider.');
      const source = candidates[0]!, recipe = recipeFor(source)!;
      const scope = browserRecipeScope(recipe, target.url);
      if (!scope) {
        if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname.startsWith(recipe.offer.pathPrefix)) return { recipe: null, recipeToken: null };
        return fail('Open a supported results page for this provider integration.');
      }
      if (pins.size >= 100) return fail('Close an earlier browser collection before starting another.');
      const pin: BrowserRecipePin = { token: randomUUID(), recipe: structuredClone(recipe), integration: executionFor(source, recipe.kind),
        validUntil: source.validUntil, expiresAt: Math.min(now() + 30 * 60000, Date.parse(source.validUntil)), scope: scope!, tabId: target.tabId, session };
      epochs.set(pin, providers.generation(source.reference.connectionId));
      assertCurrent(pin); pins.set(pin.token, pin);
      return { recipe: structuredClone(recipe), recipeToken: pin.token, validUntil: pin.validUntil, sourceKey: source.key, integration: source.reference };
    },
    require(session: string, token: string | undefined, target?: RecipeTarget): BrowserRecipePin {
      if (!token) return fail('Resolve a selected provider recipe before collecting this listing.');
      const pin = pins.get(token);
      if (!pin || pin.session !== session) return fail('This browser recipe belongs to an expired or different session.');
      assertCurrent(pin);
      if (target && (target.tabId !== pin.tabId || browserRecipeScope(pin.recipe, target.url) !== pin.scope)) return fail('The page left the pinned provider search.');
      return pin;
    },
    release(token: string) { pins.delete(token); },
    disconnect(session: string) { for (const [token, pin] of pins) if (pin.session === session) pins.delete(token); },
    close() { pins.clear(); },
  };
}
