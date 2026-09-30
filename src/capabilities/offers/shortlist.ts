/**
 * What is worth looking at, and why — read off records already stored.
 *
 * This is the report half of the hunt: no model, no board, no fetch. It exists
 * as a module rather than inside a CLI command because there are two readers of
 * the same answer — the terminal and the desktop app's table — and "worth a
 * look" is not a rendering detail. If each decided which offers make the list
 * and in what order, they would disagree the first time either was edited, and
 * the disagreement would be invisible: both would look plausible, and neither
 * would be obviously wrong.
 *
 * ## Reading `rating.detail`
 *
 * `OfferRating.detail` is stored as `Record<string, unknown>` so a record
 * written by an older scorer still parses — the field is an audit trail, and a
 * schema that rejected last month's shape would throw away exactly the history
 * it exists to keep. The cost is that every reader has to narrow it, and each
 * reader used to do it differently: the rescore pass narrowed defensively while
 * the CLI cast and hoped. `readScoreDetail` is the one narrowing, and it drops
 * what it cannot recognise rather than guessing.
 *
 * ## Why the view omits `text` and `analysis`
 *
 * A shortlist of forty offers carrying full postings is several megabytes to
 * render one table, and `analysis` is the model's raw output — the unverified
 * half, kept for audit, never the basis of anything shown as fact. Neither
 * belongs in a list view. Whoever wants a posting can ask for that offer by id,
 * which is a different route and a different question.
 *
 * The rows still arrive here with their `text` attached, because `OfferStore`
 * reads whole records. That is a read this module cannot make cheaper from the
 * outside; the place to fix it is a projection on the store, and the reason to
 * fix it is memory rather than correctness.
 */

import type { Disposition, Eligibility, OfferRecord } from '../../contracts/index.js';
import { boardFor, type Board } from './boards.js';
import type { CriterionVerdict, ScoreDetail, Verdict } from './criteria.js';

const verdicts: readonly string[] = ['pass', 'fail', 'unknown'];

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const criterionOf = (value: unknown): CriterionVerdict | null => {
  if (typeof value !== 'object' || value === null) return null;

  const entry = value as Record<string, unknown>;

  if (typeof entry.criterion !== 'string') return null;
  if (typeof entry.verdict !== 'string' || !verdicts.includes(entry.verdict)) return null;

  return {
    criterion: entry.criterion,
    // `strength` was not always written, and it only decides how a verdict is
    // weighed — an entry missing it is still a usable answer, so it defaults
    // rather than disqualifying the criterion.
    strength: entry.strength === 'must' ? 'must' : 'prefer',
    verdict: entry.verdict as Verdict,
    because: typeof entry.because === 'string' ? entry.because : ''
  };
};

/** The one narrowing of a stored `rating.detail`. Unrecognised entries are dropped. */
export const readScoreDetail = (detail: Readonly<Record<string, unknown>>): ScoreDetail => ({
  scorer: typeof detail.scorer === 'string' ? detail.scorer : '',
  criteria: Array.isArray(detail.criteria)
    ? detail.criteria.map(criterionOf).filter((entry): entry is CriterionVerdict => entry !== null)
    : [],
  stated: strings(detail.stated),
  missing: strings(detail.missing)
});

/**
 * One offer as a caller outside this process sees it.
 *
 * Flat and camelCase, matching `OfferRecord`, so a field means the same thing
 * wherever it is read. Flat because the optionality on `OfferRecord` says
 * "unknown to the store" and a table cell says "" — a view that forwarded
 * `undefined` would make every reader write the same fallback.
 *
 * Timestamps are the epoch milliseconds the store holds, not formatted strings.
 * A caller that renders them has a locale; this module does not.
 */
export type OfferView = {
  id: string;
  url: string;
  board: string;
  position: string;
  company: string;
  location: string;
  workMode: string;
  seniority: string;
  contractType: string;
  salary: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: string;
  skills: string[];
  processing: string;
  disposition: Disposition;
  eligibility: Eligibility;
  fit: number | null;
  completeness: number | null;
  /** Every criterion, not only the failures: why it passed is also an answer. */
  criteria: CriterionVerdict[];
  /** Facts the posting states, of the seven `completeness` is measured over. */
  stated: string[];
  missing: string[];
  /** Claims a model made that the posting did not support. Read before applying. */
  unverified: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  ratedAt: number | null;
};

export const offerView = (record: OfferRecord, boards:readonly Board[]=[]): OfferView => {
  const rawDetail = record.rating?.detail ?? {};
  const detail = readScoreDetail(rawDetail);
  const url = record.url ?? '';
  const salary = record.salaryReading;

  return {
    id: record.id,
    url,
    // The board table's display name wins over the stored value, which is a
    // bare domain. Not cosmetic: `unreadByBoard` groups by the same name, and
    // Join IT` in another cannot be filtered on.
    board: boardFor(url,boards)?.name || (record.board ?? ''),
    position: record.position ?? '',
    company: record.company ?? '',
    location: record.location ?? '',
    workMode: record.workMode ?? '',
    seniority: record.seniority ?? '',
    contractType: record.contractType ?? '',
    salary: record.salary ?? '',
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? '',
    salaryPeriod: salary?.period ?? '',
    skills: [...(record.skills ?? [])],
    processing: record.processing,
    disposition: record.disposition,
    eligibility: record.rating?.eligibility ?? 'unrated',
    fit: record.rating?.fit ?? null,
    completeness: record.rating?.completeness ?? null,
    criteria: detail.criteria,
    stated: detail.stated,
    missing: detail.missing,
    unverified: strings(rawDetail.unverified),
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    ratedAt: record.rating?.ratedAt ?? null
  };
};

/**
 * Eligible before provisional before ruled out.
 *
 * Provisional is second rather than last because an undecided criterion is not
 * a failed one — the whole point of the third state. An offer that is silent
 * about salary sits below the ones that clear the floor and above the ones that
 * do not, which is where a human reading the list would put it.
 */
const ORDER: Record<Eligibility, number> = {
  eligible: 0,
  provisional: 1,
  ineligible: 2,
  unrated: 3
};

/** What the caller asked to see. `shortlist` is the answer to "what now". */
export type Scope = 'shortlist' | 'rated' | 'all';

export type Tally = {
  /** Every record on file, including dismissed and expired ones. */
  total: number;
  shortlisted: number;
  eligible: number;
  provisional: number;
  /** Rated, active, and off the shortlist. */
  ruledOut: number;
  /** Found on a board and never fetched: the work a round would do next. */
  unread: number;
  /**
   * Fetched but not scored — an extraction that failed, keeping its text.
   * Separate from `unread` because it owes a model call and nothing to a board,
   * which is the difference between a cheap retry and an overnight run.
   */
  unanalysed: number;
  /** Boards that blocked us, or render client-side. Not retried daily. */
  unreadable: number;
  /** Active offers the user has since dismissed, applied to, or that expired. */
  decided: number;
};

export type Shortlist = {
  offers: OfferView[];
  tally: Tally;
  /** Where the unread backlog sits, so the next round can be aimed. */
  unreadByBoard: { board: string; count: number }[];
};

const eligibilityOf = (record: OfferRecord): Eligibility => record.rating?.eligibility ?? 'unrated';

const isShortlisted = (record: OfferRecord): boolean =>
  record.processing === 'rated' &&
  record.disposition === 'active' &&
  (eligibilityOf(record) === 'eligible' || eligibilityOf(record) === 'provisional');

/**
 * Ranks the offers on file and counts what is around them.
 *
 * The tally is returned alongside rather than derived by the caller because the
 * interesting number is the one *not* in the list: a shortlist of three reads
 * very differently when two hundred offers are still unread than when none are.
 */
export const shortlist = (
  records: readonly OfferRecord[],
  options: { scope?: Scope; limit?: number;boards?:readonly Board[] } = {}
): Shortlist => {
  const { scope = 'shortlist', limit } = options;

  const active = records.filter((record) => record.disposition === 'active');
  const rated = active.filter((record) => record.processing === 'rated');
  const shortlisted = rated.filter(isShortlisted);
  const unread = active.filter((record) => record.processing !== 'rated');

  const selected = scope === 'all' ? records : scope === 'rated' ? rated : shortlisted;

  const ranked = [...selected].sort(
    (left, right) =>
      ORDER[eligibilityOf(left)] - ORDER[eligibilityOf(right)] ||
      (right.rating?.fit ?? 0) - (left.rating?.fit ?? 0) ||
      (right.rating?.completeness ?? 0) - (left.rating?.completeness ?? 0)
  );

  const byBoard = new Map<string, number>();

  // Only `candidate` is counted here. A `fetched` record is pending work too,
  // but it needs a model rather than a board, so putting it under a board's
  // name would aim the next round at a request it does not have to make.
  for (const record of unread) {
    if (record.processing !== 'candidate') continue;
    const board = boardFor(record.url ?? '',options.boards)?.name ?? 'elsewhere';
    byBoard.set(board, (byBoard.get(board) ?? 0) + 1);
  }

  return {
    offers: (limit === undefined ? ranked : ranked.slice(0, limit)).map(record=>offerView(record,options.boards)),
    tally: {
      total: records.length,
      shortlisted: shortlisted.length,
      eligible: shortlisted.filter((record) => eligibilityOf(record) === 'eligible').length,
      provisional: shortlisted.filter((record) => eligibilityOf(record) === 'provisional').length,
      ruledOut: rated.length - shortlisted.length,
      unread: unread.filter((record) => record.processing === 'candidate').length,
      unanalysed: unread.filter((record) => record.processing === 'fetched').length,
      unreadable: unread.filter((record) => record.processing === 'unreadable').length,
      decided: records.length - active.length
    },
    unreadByBoard: [...byBoard]
      .map(([board, count]) => ({ board, count }))
      .sort((left, right) => right.count - left.count)
  };
};
