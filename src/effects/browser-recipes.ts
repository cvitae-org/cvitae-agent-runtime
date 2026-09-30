import type { BrowserRecipe } from '@cvitae/job-pages';
import type { IntegrationExecution } from '../contracts/integration.js';
export type RecipeTarget = { tabId:number; documentId:string; url:string };
export type BrowserRecipePin = { token:string; recipe:BrowserRecipe; validUntil:string; expiresAt:number; scope:string; tabId:number; session:string; integration?:IntegrationExecution };
