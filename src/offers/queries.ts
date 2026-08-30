/**
 * Turning a CV and a set of preferences into things to type into a search box.
 *
 * Deterministic, and deliberately so. A model asked for "good search queries"
 * produces a different list every run, which makes a standing search
 * unrepeatable: two rounds cannot tell whether they are covering new ground or
 * re-asking yesterday's question in different words. A fixed list derived from
 * fixed inputs can be *sliced* — round one takes the first few, round two the
 * next — and that slicing is the third dedupe, the one that stops a round from
 * spending its search budget on queries a previous round already ran.
 *
 * It also keeps the model out of a place it has no advantage. The useful
 * queries are the user's own role titles and the technologies they asked for;
 * knowing which those are is a lookup, not a judgement.
 *
 * ## What goes into a query
 *
 * A role in quotes, one technology, and the market qualifiers the preferences
 * state. The quoting matters: unquoted, `senior frontend developer react`
 * matches any page with those five words on it, which on a job board is most of
 * them. Quoted, it matches postings for that role.
 *
 * One technology per query rather than all of them, because a search engine
 * ANDs its terms — a query naming six technologies finds the postings that list
 * all six, which is a much smaller and stranger set than the one wanted.
 *
 * ## Why the preferences come before the CV
 *
 * The technologies the user asked for lead, and the ones merely on their CV
 * follow. The CV says what they have done; `preferences.json` says what they
 * want to do next, and a search built from the CV alone finds more of the job
 * they are trying to leave.
 */

import type { CvDocument } from '../store/cvDocument.js';
import type { Preferences } from '../store/preferences.js';

/**
 * Market qualifiers, per preference value.
 *
 * Bilingual because the boards are: a Polish posting says `praca zdalna` and an
 * English-language one on the same board says `remote`, and a query carrying
 * only one of them finds only half the market. Both go in the same query rather
 * than into two queries, since a search engine treats them as alternatives
 * often enough and two queries would double the cost of a round.
 */
const WORK_MODE_TERMS: Record<string, string> = {
  remote: 'remote praca zdalna',
  hybrid: 'hybrid praca hybrydowa',
  onsite: 'stacjonarna'
};

const CONTRACT_TERMS: Record<string, string> = {
  b2b: 'B2B',
  uop: '"umowa o pracę"',
  zlecenie: '"umowa zlecenie"',
  dzielo: '"umowa o dzieło"'
};

const clean = (value: string): string => value.trim().replace(/\s+/g, ' ');

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const key = clean(value).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean(value));
  }

  return out;
};

/**
 * Role titles worth searching for, most recent first.
 *
 * `skills.role` leads because it is the one the user wrote about themselves;
 * the experience titles follow in reverse chronological order, because a title
 * from eight years ago describes a job they are not applying for.
 */
const roles = (cv: CvDocument): string[] =>
  unique([
    cv.skills.role,
    ...[...cv.experience]
      .sort((left, right) => (right.started ?? '').localeCompare(left.started ?? ''))
      .map((entry) => entry.title)
  ]).slice(0, 3);

const technologies = (cv: CvDocument, preferences: Preferences): string[] =>
  unique([
    ...preferences.skills.require,
    ...cv.skills.frameworks,
    ...cv.skills.programming_languages
  ]).slice(0, 6);

/** The qualifiers every query carries, from whatever the preferences state. */
const qualifiers = (preferences: Preferences): string => {
  const parts: string[] = [];

  for (const mode of preferences.work_mode.accept) {
    const term = WORK_MODE_TERMS[mode];
    if (term) parts.push(term);
  }

  // Only when the user named exactly one, because two contract forms in one
  // query ANDs them and finds the postings that offer both — a real but tiny
  // slice of the market, and not the one being asked for.
  if (preferences.contract_type.accept.length === 1) {
    const term = CONTRACT_TERMS[preferences.contract_type.accept[0] as string];
    if (term) parts.push(term);
  }

  return parts.join(' ');
};

/**
 * The ordered list of queries this CV and these preferences imply.
 *
 * Ordered by how specific each is, so that a round taking the first slice gets
 * the queries most likely to return the job actually wanted. Stable for stable
 * inputs, which is what lets `round` treat the round number as the only state
 * it needs to avoid repeating itself.
 */
export const buildQueries = (cv: CvDocument, preferences: Preferences): string[] => {
  const roleList = roles(cv);
  const techList = technologies(cv, preferences);
  const suffix = qualifiers(preferences);

  const queries: string[] = [];

  // Role × technology first: the most specific thing that can be asked, and the
  // pairing that finds a posting for this role that uses this stack.
  for (const role of roleList) {
    for (const technology of techList) {
      queries.push(clean(`"${role}" ${technology} ${suffix} oferty pracy`));
    }
  }

  // Then the role alone, which catches postings whose stack is described in
  // prose the board never turned into a tag.
  for (const role of roleList) {
    queries.push(clean(`"${role}" ${suffix} oferty pracy`));
  }

  // Then technology alone, for the case the role titles are wrong — a career
  // change, or a market that names the job differently.
  for (const technology of techList) {
    queries.push(clean(`${technology} developer ${suffix} oferty pracy`));
  }

  return unique(queries);
};

/**
 * The queries one round should run.
 *
 * Wraps rather than stops, so a long-running standing search cycles back to the
 * most specific queries instead of running out and going quiet. Re-asking a
 * query is not waste: the market changes underneath it, and the URL dedupe
 * makes a repeated answer free.
 */
export const queriesForRound = (all: string[], round: number, size: number): string[] => {
  if (all.length === 0 || size <= 0) return [];

  const start = (Math.max(round, 1) - 1) * size;

  return Array.from({ length: Math.min(size, all.length) }, (_, index) => {
    return all[(start + index) % all.length] as string;
  });
};
