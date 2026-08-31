/**
 * Getting a job offer's text, by whichever route can.
 *
 * Moved here from cvitae, where it sat beside the analysis it feeds. None of it
 * touches a model, which is why it was the last thing to move — but it belongs
 * with `analyze_offer` rather than with the caller, for the same reason the
 * prompts do: a capability that takes a URL is one the caller can use without
 * knowing that boards render client-side, that some refuse robots, or that
 * there is a separate scraper process to try first.
 *
 * `salary.ts` and `criteria.ts` are the other end of the same pipeline and
 * touch a model even less: text in, numbers out, then numbers against the
 * user's requirements. They sit here because they are about offers, and apart
 * from `capabilities/` because nothing in them may be delegated to a model —
 * see the note at the top of `criteria.ts`.
 *
 * `identity.ts`, `queries.ts`, `verify.ts` and `round.ts` close the loop: what
 * to search for, what counts as the same offer twice, which extracted facts are
 * allowed to move a score, and the round that runs all of it in order. Only
 * `round.ts` touches a model, and only through a function it is handed — which
 * is why nothing in this directory imports the runtime.
 */

export { fetchOffer, extractVisibleText, isHttpUrl } from './fetch.js';
export type { FetchOutcome } from './fetch.js';
export { scrapeOffer, isScraperEnabled } from './scraper.js';
export type { BoardOffer, ScraperOutcome } from './scraper.js';
export { resolveOffer } from './resolve.js';
export type { ResolvedOffer } from './resolve.js';
export { applyBoardFacts } from './boardFacts.js';
export type { StatedFacts, BoardFactsResult } from './boardFacts.js';
export { parseSalary } from './salary.js';
export type { ParsedSalary } from './salary.js';
export {
  evaluate,
  measureCompleteness,
  readContractTypes,
  COUNTED_FACTS,
  SCORER_VERSION
} from './criteria.js';
export type { Verdict, CriterionVerdict, ScoreDetail, Evaluation } from './criteria.js';
export {
  boards,
  boardFor,
  hostOf,
  isFetchable,
  searchableBoards,
  scrapableBoards
} from './boards.js';
export type { Board, BoardFetchability } from './boards.js';
export { normaliseUrl, offerId } from './identity.js';
export { buildQueries, queriesForRound } from './queries.js';
export { verifyFacts } from './verify.js';
export type { OfferClaims, Verification } from './verify.js';
export { runRound, runRounds } from './round.js';
export type { OfferAnalyser, RoundOptions, RoundReport } from './round.js';
