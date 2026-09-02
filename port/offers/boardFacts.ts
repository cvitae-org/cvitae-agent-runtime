/**
 * Board-stated facts, laid over the model's reading of the same offer.
 *
 * The analysis agents copy values out of prose; the scraper reads fields the
 * board published as data. Where both have an opinion the board is right, and a
 * small model mis-copying a salary it could have been handed is an avoidable
 * error.
 *
 * What is deliberately *not* taken from the board:
 *
 *   contract_type — the board's schema.org `employmentType` is a different axis
 *     from cvitae's. It answers FULL_TIME/CONTRACTOR/PART_TIME, where the record
 *     wants the Polish form of employment: B2B, UoP, zlecenie. Overriding turned
 *     a correct "B2B" into "CONTRACTOR" and a correct "umowa o pracę" into
 *     "FULL_TIME", so the model keeps this one. (pracuj.pl happens to emit the
 *     real contract form here, but justjoin and nofluffjobs emit the enum, and
 *     the field cannot tell you which it got.)
 *
 *   posted_at — the board states it and it is genuinely useful, but JobRecord
 *     has no field for it. Adding one is a change to the stored shape and the
 *     table, not to this wiring.
 */

import { workModes } from '../capabilities/analyzeOffer.js';

/**
 * The keys this may write. Named here rather than imported from cvitae's
 * `OfferAnalysis`, which is a UI type and not something the runtime should
 * depend on — the analysis schemas in `capabilities/analyzeOffer.ts` are the
 * definition, and these are the subset a board can speak to.
 */
type StatedKey =
  | 'company'
  | 'position'
  | 'salary'
  | 'seniority'
  | 'start_date'
  | 'location'
  | 'work_mode'
  | 'required_skills';

type WorkMode = (typeof workModes)[number];

/**
 * The subset that matters here, so this works on both a live scrape and the
 * facts stored on an imported row. `BoardOffer` satisfies it structurally.
 */
export type StatedFacts = {
  company?: string;
  title?: string;
  location?: string;
  work_mode?: string;
  salary?: string;
  seniority?: string;
  start_date?: string;
  required_skills?: string[];
};

/** The strings the analysis uses for "the offer did not say". */
const isAbsent = (value: unknown): boolean =>
  typeof value !== 'string' ||
  value.trim().length === 0 ||
  value === 'Not stated' ||
  value === 'Unknown';

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const isWorkMode = (value: unknown): value is WorkMode =>
  typeof value === 'string' && (workModes as readonly string[]).includes(value);

/**
 * Merges two skill lists without duplicating case variants.
 *
 * Neither source is a superset: a board's tag list is canonical but short
 * (nofluffjobs lists ten technologies), while the model reads requirements
 * written in prose that never became tags. Both are "what the offer asks for",
 * so both go in, board first because those are the offer's own words.
 */
const mergeSkills = (
  fromBoard: string[] | undefined,
  fromModel: unknown
): string[] | undefined => {
  const board = (fromBoard ?? []).map((skill) => skill.trim()).filter(Boolean);
  const model = Array.isArray(fromModel)
    ? fromModel.filter((skill): skill is string => typeof skill === 'string')
    : [];

  if (!board.length) return undefined;

  const seen = new Set<string>();
  const merged: string[] = [];

  for (const skill of [...board, ...model]) {
    const key = skill.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(skill.trim());
  }

  return merged;
};

export type BoardFactsResult = {
  analysis: Record<string, unknown>;
  /** Fields the board supplied, for the source note. */
  applied: string[];
};

/**
 * Applies what the board stated to what the model inferred.
 *
 * Two policies, because the fields differ in how much the board can be trusted
 * over a reader:
 *
 *   Replace — the board states these as data and is simply more accurate:
 *     company, position, salary, work_mode, seniority.
 *
 *   Fill only — the board's version is coarser, so it is used only where the
 *     model found nothing: location. A remote posting reports its location as
 *     "Remote", which is true but would overwrite a city the model correctly
 *     read out of the text, and work_mode already carries the remote part.
 */
export const applyBoardFacts = (
  analysis: Record<string, unknown>,
  offer: StatedFacts
): BoardFactsResult => {
  const merged = { ...analysis };
  const applied: string[] = [];

  const replace = (key: StatedKey, value: string | undefined) => {
    const next = clean(value);
    if (!next || merged[key] === next) return;
    merged[key] = next;
    applied.push(key);
  };

  const fill = (key: StatedKey, value: string | undefined) => {
    const next = clean(value);
    if (!next || !isAbsent(merged[key])) return;
    merged[key] = next;
    applied.push(key);
  };

  replace('company', offer.company);
  replace('position', offer.title);
  replace('salary', offer.salary);
  replace('seniority', offer.seniority);
  replace('start_date', offer.start_date);
  fill('location', offer.location);

  // Guarded rather than assigned: work_mode is an enum the UI switches on, and
  // an unrecognised string would render as a broken badge.
  if (isWorkMode(offer.work_mode) && merged.work_mode !== offer.work_mode) {
    merged.work_mode = offer.work_mode;
    applied.push('work_mode');
  }

  const skills = mergeSkills(offer.required_skills, merged.required_skills);
  if (skills) {
    merged.required_skills = skills;
    applied.push('required_skills');
  }

  return { analysis: merged, applied };
};
