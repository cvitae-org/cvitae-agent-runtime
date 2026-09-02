/**
 * Re-running the score over offers already on file, with no model involved.
 *
 * A score is a function of three things: the posting, the preferences, and the
 * rules in `criteria.ts`. Only the first is a property of the offer. The other
 * two change — the user edits their preferences, or a rule is fixed — and every
 * score written before the change is then a stale answer to a question nobody
 * is asking any more.
 *
 * The record has carried `scorerVersion`, `prefsFingerprint` and `cvFingerprint`
 * since the beginning, with a comment saying they exist so a stale score is
 * recognisable as stale. Nothing read them. So the fields were an intention
 * rather than a mechanism, and a preferences edit left every existing offer
 * scored against preferences the user no longer holds — silently, which is the
 * bad kind. This reads them.
 *
 * ## Why this is not part of a round
 *
 * A round costs fetches and model calls, and it only rescores what it happened
 * to rate. Rescoring costs neither: the text is on file, and `evaluate` is
 * ordinary code. Tying them together would mean a preferences edit could only
 * take effect by going back out to the boards, which is both slow and, on a
 * saturated store, impossible — a round that discovers nothing rates nothing.
 *
 * ## What it will not touch
 *
 * `disposition`, for the same reason a round will not: it is the user's column.
 * A dismissed offer is rescored, because the numbers should be right whatever
 * the user decided, but the decision itself is left exactly where it was.
 *
 * And `unverified` is carried through rather than recomputed. It records what
 * the *extraction* claimed and could not support, which is a fact about a model
 * call that happened once; re-deriving it here without the model would either
 * invent it or erase it, and erasing it would quietly remove the audit trail
 * that says a claim was dropped.
 *
 * ## Why it reads in pages
 *
 * The predecessor loaded every offer, full posting text and all, to find the
 * stale ones. The store answers that question in SQL now, and this walks the
 * answer a page at a time so a store of any size costs one page of memory. The
 * loop terminates on ids rather than on an empty page because a rescore changes
 * what is stale as it writes: without `staleAgainst` the predicate never
 * shrinks, and a page-size cursor would hand back the same rows forever.
 */

import type { Eligibility, OfferRecord, OfferStore, RatingInputs } from '../../contracts/index.js';
import { fingerprintCv } from '../cv/document.js';
import type { CvDocument } from '../cv/document.js';
import { evaluate, SCORER_VERSION } from './criteria.js';
import { fingerprintPreferences } from './preferences.js';
import type { Preferences } from './preferences.js';
import { readScoreDetail } from './shortlist.js';

/** Rows per read. Large enough that a few hundred offers is two round trips. */
const PAGE = 200;

export type RescoreOptions = {
  readonly store: OfferStore;
  readonly cv: CvDocument;
  readonly preferences: Preferences;
  /**
   * Rescore every rated offer rather than only the stale ones.
   *
   * The default compares fingerprints and skips what would not move, which on a
   * store of a few hundred is the difference between a rewrite and a read. Pass
   * this when the rules changed in a way `SCORER_VERSION` did not capture —
   * during development, in other words.
   */
  readonly all?: boolean;
  readonly signal?: AbortSignal;
};

export type EligibilityChange = {
  readonly id: string;
  readonly position: string;
  readonly company: string;
  readonly from: Eligibility;
  readonly to: Eligibility;
  /** Why, from the criteria that differ. */
  readonly because: readonly string[];
};

export type RescoreReport = {
  /** Every offer carrying a score, whether or not it was stale. */
  readonly rated: number;
  /** Of those, the ones whose score was stale by fingerprint or version. */
  readonly stale: number;
  /** Of the stale ones, those whose numbers actually moved. */
  readonly rescored: number;
  /** The subset whose `eligibility` changed, which is the part a user sees. */
  readonly changed: readonly EligibilityChange[];
};

/**
 * `rating.detail` is stored loosely on purpose — see `shortlist.ts`, which owns
 * the one narrowing of it. Reading it a second way here is how the two readers
 * would come to disagree about what an old record says.
 */
const verdictsIn = (detail: Readonly<Record<string, unknown>>): Map<string, string> =>
  new Map(readScoreDetail(detail).criteria.map((entry) => [entry.criterion, entry.verdict]));

export const rescoreOffers = (options: RescoreOptions): RescoreReport => {
  const { store, cv, preferences, all = false, signal } = options;

  const inputs: RatingInputs = {
    scorerVersion: SCORER_VERSION,
    cvFingerprint: fingerprintCv(cv),
    prefsFingerprint: fingerprintPreferences(preferences)
  };

  const staleAgainst = all ? undefined : inputs;
  const seen = new Set<string>();
  const changed: EligibilityChange[] = [];
  let rescored = 0;

  for (;;) {
    signal?.throwIfAborted();

    const page = store.staleRatings(PAGE, staleAgainst).filter((row) => !seen.has(row.id));
    if (page.length === 0) break;

    for (const record of page) {
      signal?.throwIfAborted();
      seen.add(record.id);
      rescore(record);
    }
  }

  return { rated: store.countRated(), stale: seen.size, rescored, changed };

  function rescore(record: OfferRecord): void {
    const before = record.rating;
    const detail = before?.detail ?? {};
    const evaluation = evaluate(record, preferences);
    const wasEligible = before?.eligibility ?? 'unrated';

    if (
      evaluation.eligibility !== wasEligible ||
      evaluation.fit !== (before?.fit ?? null) ||
      evaluation.completeness !== (before?.completeness ?? null)
    ) {
      rescored++;
    }

    if (evaluation.eligibility !== wasEligible) {
      const priorVerdicts = verdictsIn(detail);

      changed.push({
        id: record.id,
        position: record.position ?? '',
        company: record.company ?? '',
        from: wasEligible,
        to: evaluation.eligibility,
        because: evaluation.detail.criteria
          .filter((criterion) => priorVerdicts.get(criterion.criterion) !== criterion.verdict)
          .map(
            (criterion) =>
              `${criterion.criterion}: ${priorVerdicts.get(criterion.criterion) ?? 'none'} → ${criterion.verdict}`
          )
      });
    }

    // The fingerprints are written even when nothing moved. That is the point
    // of storing them: a record checked against these preferences and found
    // unchanged is not stale, and re-examining it every time would make the
    // cheap path cost the same as the expensive one.
    store.rate(record.id, {
      ...inputs,
      eligibility: evaluation.eligibility,
      fit: evaluation.fit,
      completeness: evaluation.completeness,
      // `ratedAt` moves even when the verdict does not: it records when the
      // score was last known to be current, which is what the oldest-first
      // ordering pages on. Leaving it would make a rescore loop on its own
      // first page.
      ratedAt: Date.now(),
      detail: {
        ...evaluation.detail,
        // A fact about an extraction that already happened. See the header.
        unverified: detail.unverified ?? []
      }
    });
  }
};
