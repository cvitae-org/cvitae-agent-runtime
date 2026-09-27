import { randomUUID } from 'node:crypto';
import { recipeListingContext, type EmbeddedJsonRecipe } from '@cvitae/job-pages';
import type { DiscoveryProvider, ProviderSnapshot } from './discovery-provider.js';
import { OperationError } from '../contracts/operation-error.js';
export type RecipeTarget = { tabId:number; documentId:string; url:string };
export type BrowserRecipePin = { token:string; recipe:EmbeddedJsonRecipe; validUntil:string; expiresAt:number; scope:string; tabId:number; session:string };
export function createBrowserRecipes(provider?:DiscoveryProvider, now=Date.now) {
  let snapshot:ProviderSnapshot|undefined;
  const pins = new Map<string,BrowserRecipePin>();
  const fail = (message:string):never => { throw new OperationError('browser_recipe_unavailable',message); };
  const assertCurrent = (pin:BrowserRecipePin) => {
    if (pin.expiresAt <= now() || Date.parse(pin.validUntil) <= now() || !snapshot || Date.parse(snapshot.validUntil) <= now()) fail('The browser recipe expired. Start a new preview or collection.');
    const source = snapshot!.sources.find(source => source.id === pin.recipe.sourceId);
    if (!source?.browserRecipe || source.health.status === 'drift' || snapshot!.revokedRecipes.some(entry => entry.sourceId === pin.recipe.sourceId && entry.revision === pin.recipe.revision)) fail('The provider withdrew this browser recipe. Collected previews remain available.');
  };
  const refresh = async () => { if (provider) snapshot = await provider.resolve(AbortSignal.timeout(15000)); };
  return {
    enabled:!!provider, refresh,
    async prepare(session:string,target:RecipeTarget) {
      await refresh();
      for (const [token,pin] of pins) if (pin.expiresAt <= now()) pins.delete(token);
      const url = new URL(target.url), source = snapshot?.sources.find(source => source.browserRecipe?.hosts.includes(url.hostname));
      if (!source?.browserRecipe) return {recipe:null,recipeToken:null};
      const recipe = source.browserRecipe, context = recipeListingContext(recipe,target.url);
      if (!context) {
        if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname.startsWith(recipe.offer.pathPrefix)) return {recipe:null,recipeToken:null};
        return fail('Open a supported results page for this source.');
      }
      if (pins.size >= 100) fail('Close an earlier browser collection before starting another.');
      const pin:BrowserRecipePin = {token:randomUUID(),recipe,validUntil:snapshot!.validUntil,expiresAt:Math.min(now()+30*60000,Date.parse(snapshot!.validUntil)),scope:context.scope,tabId:target.tabId,session};
      assertCurrent(pin); pins.set(pin.token,pin);
      return {recipe,recipeToken:pin.token,validUntil:pin.validUntil};
    },
    require(session:string,token:string|undefined,target?:RecipeTarget):BrowserRecipePin|undefined {
      if (!token) {
        if (target && snapshot?.sources.some(source => source.browserRecipe?.hosts.includes(new URL(target.url).hostname))) fail('Resolve the provider recipe before collecting this listing.');
        return;
      }
      const pin = pins.get(token);
      if (!pin || pin.session !== session) return fail('This browser recipe belongs to an expired or different session.');
      assertCurrent(pin);
      if (target && (target.tabId !== pin.tabId || recipeListingContext(pin.recipe,target.url)?.scope !== pin.scope)) fail('The page left the pinned recipe search.');
      return pin;
    },
    release(token:string) { pins.delete(token); },
    disconnect(session:string) { for (const [token,pin] of pins) if (pin.session===session) pins.delete(token); },
    close() { pins.clear(); },
  };
}
