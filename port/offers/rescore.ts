/**
 * Re-running the score over offers already on file, with no model involved.
 *
 * A score is a function of three things: the posting, the preferences, and the
 * rules in `criteria.ts`. Only the first is a property of the offer. The other
 * two change — the user edits `preferences.json`, or a rule is fixed — and
 * every score written before the change is then a stale answer to a question
 * nobody is asking any more.
 *
 * The record has carried `scorer_version`, `prefs_fingerprint` and
 * `cv_fingerprint` since the beginning, with a comment saying they exist so a
 * stale score is recognisable as stale. Nothing read them. So the fields were
 * an intention rather than a mechanism, and a preferences edit left every
 * existing offer scored against preferences the user no longer holds — silently,
 * which is the bad kind. This reads them.
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
 */

import type { Store } from '../store/store.js';
import type { OfferRecord } from '../store/offerRecord.js';
import type { CvDocument } from '../store/cvDocument.js';
import type { Preferences } from '../store/preferences.js';
import { fingerprintPreferences } from '../store/preferences.js';
import { fingerprintValue } from '../core/fingerprint.js';
import { evaluate, SCORER_VERSION } from './criteria.js';
import { readScoreDetail } from './shortlist.js';

export type RescoreOptions = {
  store: Store;
  cv: CvDocument;
  preferences: Preferences;
  /**
   * Rescore every rated offer rather than only the stale ones.
   *
   * The default compares fingerprints and skips what would not move, which on a
   * store of a few hundred is the difference between a rewrite and a read. Pass
   * this when the rules changed in a way `SCORER_VERSION` did not capture —
   * during development, in other words.
   */
  all?: boolean;
  signal?: AbortSignal;
};

export type RescoreReport = {
  /** Rated offers considered. */
  examined: number;
  /** Of those, the ones whose score was stale by fingerprint or version. */
  stale: number;
  /** Of the stale ones, those whose numbers actually moved. */
  rescored: number;
  /** The subset whose `eligibility` changed, which is the part a user sees. */
  changed: {
    id: string;
    title: string;
    company: string;
    from: OfferRecord['eligibility'];
    to: OfferRecord['eligibility'];
    /** Why, from the criteria that differ. */
    because: string[];
  }[];
};

export const rescoreOffers = async (options: RescoreOptions): Promise<RescoreReport> => {
  const { store, cv, preferences, all = false, signal } = options;

  const cvFingerprint = fingerprintValue({ ...cv, updated_at: '' });
  const prefsFingerprint = fingerprintPreferences(preferences);

  const rated = (await store.offerRecords.all()).filter(
    (record) => record.processing === 'rated'
  );

  const isStale = (record: OfferRecord): boolean =>
    all ||
    record.scorer_version !== SCORER_VERSION ||
    record.prefs_fingerprint !== prefsFingerprint ||
    record.cv_fingerprint !== cvFingerprint;

  const stale = rated.filter(isStale);

  const updates: Parameters<Store['saveOffers']>[0] = [];
  const changed: RescoreReport['changed'] = [];
  let rescored = 0;

  // `score_detail` is stored as a loose record, so the shape has to be checked
  // rather than assumed: it is written by whichever scorer version wrote the
  // record, which by definition is not this one.
  // `score_detail` is stored loosely on purpose — see `shortlist.ts`, which
  // owns the one narrowing of it. Reading it a second way here is how the two
  // readers would come to disagree about what an old record says.
  const verdictsIn = (detail: Record<string, unknown>): Map<string, string> =>
    new Map(
      readScoreDetail(detail).criteria.map((entry) => [entry.criterion, entry.verdict])
    );

  for (const record of stale) {
    signal?.throwIfAborted();

    const evaluation = evaluate(record, preferences);

    if (
      evaluation.eligibility !== record.eligibility ||
      evaluation.fit !== record.fit ||
      evaluation.completeness !== record.completeness
    ) {
      rescored++;
    }

    if (evaluation.eligibility !== record.eligibility) {
      const before = verdictsIn(record.score_detail);

      changed.push({
        id: record.id,
        title: record.title,
        company: record.company,
        from: record.eligibility,
        to: evaluation.eligibility,
        because: evaluation.detail.criteria
          .filter((criterion) => before.get(criterion.criterion) !== criterion.verdict)
          .map(
            (criterion) =>
              `${criterion.criterion}: ${before.get(criterion.criterion) ?? 'none'} → ${criterion.verdict}`
          )
      });
    }

    // The fingerprints are written even when nothing moved. That is the point
    // of storing them: a record checked against these preferences and found
    // unchanged is not stale, and re-examining it every time would make the
    // cheap path cost the same as the expensive one.
    updates.push({
      id: record.id,
      eligibility: evaluation.eligibility,
      fit: evaluation.fit,
      completeness: evaluation.completeness,
      score_detail: {
        ...evaluation.detail,
        // A fact about an extraction that already happened. See the header.
        unverified: record.score_detail.unverified ?? []
      },
      scorer_version: SCORER_VERSION,
      cv_fingerprint: cvFingerprint,
      prefs_fingerprint: prefsFingerprint
    });
  }

  if (updates.length > 0) await store.saveOffers(updates);

  return { examined: rated.length, stale: stale.length, rescored, changed };
};
