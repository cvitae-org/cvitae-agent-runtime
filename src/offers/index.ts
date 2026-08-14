/**
 * Getting a job offer's text, by whichever route can.
 *
 * Moved here from cvitae, where it sat beside the analysis it feeds. None of it
 * touches a model, which is why it was the last thing to move — but it belongs
 * with `analyze_offer` rather than with the caller, for the same reason the
 * prompts do: a capability that takes a URL is one the caller can use without
 * knowing that boards render client-side, that some refuse robots, or that
 * there is a separate scraper process to try first.
 */

export { fetchOffer, extractVisibleText, isHttpUrl } from './fetch.js';
export type { FetchOutcome } from './fetch.js';
export { scrapeOffer, isScraperEnabled } from './scraper.js';
export type { BoardOffer, ScraperOutcome } from './scraper.js';
export { resolveOffer } from './resolve.js';
export type { ResolvedOffer } from './resolve.js';
export { applyBoardFacts } from './boardFacts.js';
export type { StatedFacts, BoardFactsResult } from './boardFacts.js';
