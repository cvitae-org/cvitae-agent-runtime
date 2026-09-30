

import type { CvDocument } from '../cv/document.js';
import type { Preferences } from './preferences.js';
import { searchableBoards, type Board } from './boards.js';

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
export const buildQueries = (
  cv: CvDocument,
  preferences: Preferences,
  options: { market?: string; boards?:readonly Board[] } = {}
): string[] => {
  const roleList = roles(cv);
  const techList = technologies(cv, preferences);
  const suffix = qualifiers(preferences);

  const queries: string[] = [];

  // One per board, leading, because scoping beats phrasing. No `oferty pracy`
  // here: every page on a job board is one, and the words would only exclude
  // the postings written in English.
  const primaryRole = roleList[0];
  const primaryTech = techList[0];

  if (primaryRole || primaryTech) {
    const terms = clean(
      [primaryRole ? `"${primaryRole}"` : '', primaryTech ?? '', suffix].join(' ')
    );

    for (const board of searchableBoards(options.market, options.boards)) {
      queries.push(`site:${board.domain} ${terms}`);
    }
  }

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


const GENERIC_ROLE_WORDS = new Set([
  'developer',
  'engineer',
  'specialist',
  'programista',
  'senior',
  'mid',
  'junior',
  'lead'
]);

/**
 * The first alphanumeric run of a skill name, when it is long enough to mean
 * something on its own.
 *
 * Slug matching is a substring test, and punctuation is where it breaks:
 * `Next.js` appears in slugs as `next-js`, `nextjs` and `next`, so the only
 * spelling that matches all three is `next`. Two-character names are dropped
 * rather than guessed at — `go` matches `google`, `mongodb` and `golang`
 * indiscriminately, and a keyword that matches everything is not a filter.
 */
const slugToken = (skill: string): string => {
  const first = skill.toLowerCase().match(/[a-z0-9]+/)?.[0] ?? '';
  return first.length >= 3 ? first : '';
};


export const buildKeywords = (cv: CvDocument, preferences: Preferences): string[] => {
  // Capped after tokenising, not before, which `technologies` cannot do because
  // it also feeds `buildQueries` — an engine is happy with `React Query` as a
  // phrase, and a slug filter reduces it to `react`. Taking six raw names first
  // let near-duplicates eat the budget: a CV listing React, React Query and
  // React Native spent three of six slots on one token, and `typescript`,
  // `node` and `nestjs` were never searched at all. Measured on the real CV
  // this was written against, where five distinct tokens came out of six slots.
  const tokensOf = (names: string[]): string[] =>
    unique(names.map(slugToken).filter(Boolean));

  const frameworks = tokensOf(cv.skills.frameworks);
  const languages = tokensOf(cv.skills.programming_languages);

  // Alternated rather than concatenated, so neither category can starve the
  // other. Straight concatenation let twelve frameworks fill all six slots and
  // search none of the CV's languages — and on a Polish board the language is
  // very often the slug's last token (`…-warszawa-javascript`), which makes it
  // the better filter of the two.
  const interleaved: string[] = [];
  for (let index = 0; index < Math.max(frameworks.length, languages.length); index++) {
    if (frameworks[index]) interleaved.push(frameworks[index] as string);
    if (languages[index]) interleaved.push(languages[index] as string);
  }

  const techTokens = unique([
    ...tokensOf(preferences.skills.require),
    ...interleaved
  ]).slice(0, 6);

  const roleTokens = unique(
    roles(cv)
      .flatMap((role) => role.toLowerCase().match(/[a-z]+/g) ?? [])
      .filter((word) => word.length >= 4 && !GENERIC_ROLE_WORDS.has(word))
  );

  const keywords: string[] = [];

  // The technology alone, first and broadest. On a board this is already a
  keywords.push(...techTokens);

  // Then paired with a role word, for the case one technology is too broad.
  for (const tech of techTokens) {
    for (const role of roleTokens) keywords.push(`${tech} ${role}`);
  }

  // Then the role alone, which finds postings whose stack the slug omits.
  keywords.push(...roleTokens);

  return unique(keywords);
};
