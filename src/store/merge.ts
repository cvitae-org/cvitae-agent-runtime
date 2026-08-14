/**
 * Folding an extracted document into the one already on disk.
 *
 * Every source is partial. A certificate PDF has no employment history, a
 * LinkedIn screenshot has no phone number, and a CV export has both but perhaps
 * an older job title. So an import is a merge, not a write, and the policy is
 * the conservative one throughout: **an import may add, and may fill a blank,
 * but may never overwrite something already there.**
 *
 * That asymmetry is deliberate and it is not the obvious choice. "Newest wins"
 * is what a sync usually does, and it is wrong here, because the two sides are
 * not equally trustworthy: what is on disk has survived the user looking at it,
 * while what arrives has just been guessed at by a small model from a
 * screenshot. Losing a correct hand-edited job title to a hallucinated one is
 * the single worst thing an importer can do, and it is silent when it happens.
 *
 * The cost of the policy is real and worth stating: correcting a value means
 * editing `cv.json`, because a re-import will not do it. Deleting the file and
 * re-importing is the reset.
 */

import type {
  CvDocument,
  ExperienceEntry
} from './cvDocument.js';

/** Case- and whitespace-insensitive identity for matching two entries. */
const key = (...parts: (string | undefined | null)[]): string =>
  parts
    .map((part) => (part ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');

const isBlank = (value: string | undefined | null): boolean =>
  !value || value.trim().length === 0;

/** Fills `target[field]` from `incoming` only when the target has nothing. */
const fill = <T extends Record<string, unknown>>(
  target: T,
  incoming: Partial<T>,
  field: keyof T
): boolean => {
  const next = incoming[field];

  if (typeof next !== 'string' || isBlank(next)) return false;
  if (!isBlank(target[field] as string | undefined)) return false;

  target[field] = next.trim() as T[keyof T];
  return true;
};

/**
 * Union of two string lists, preserving the existing order and casing.
 *
 * Existing entries win on casing because the user may have corrected "react" to
 * "React", and an import should not undo that.
 */
const unionStrings = (existing: string[], incoming: string[]): string[] => {
  const seen = new Set(existing.map((value) => value.trim().toLowerCase()));
  const merged = [...existing];

  for (const value of incoming) {
    const trimmed = value.trim();
    const lookup = trimmed.toLowerCase();
    if (!trimmed || seen.has(lookup)) continue;
    seen.add(lookup);
    merged.push(trimmed);
  }

  return merged;
};

/**
 * Merges one experience entry into a matching existing one.
 *
 * Matched on company plus title, because the same company can appear twice for
 * a genuine promotion and those are two entries, not one. Highlights union —
 * a second source describing the same job usually phrases its bullets
 * differently, and both phrasings are legitimate material for a tailored CV.
 */
const mergeExperienceEntry = (
  existing: ExperienceEntry,
  incoming: ExperienceEntry
): void => {
  existing.highlights = unionStrings(existing.highlights, incoming.highlights);
  existing.skills = unionStrings(existing.skills, incoming.skills);

  fill(existing, incoming, 'started');

  // `finished: null` means "still there", which is information, so it is only
  // filled when the existing entry has no opinion at all. An import must not
  // close an open-ended role.
  if (existing.finished === undefined && incoming.finished !== undefined) {
    existing.finished = incoming.finished;
  }
};

export type MergeReport = {
  filled: string[];
  added: {
    experience: number;
    education: number;
    certificates: number;
    languages: number;
    highlights: number;
    skills: number;
  };
};

export const mergeDocument = (
  existing: CvDocument,
  incoming: Partial<CvDocument>
): { document: CvDocument; report: MergeReport } => {
  const document = structuredClone(existing);

  const filled: string[] = [];
  const added: MergeReport['added'] = {
    experience: 0,
    education: 0,
    certificates: 0,
    languages: 0,
    highlights: 0,
    skills: 0
  };

  if (incoming.personal) {
    for (const field of ['name', 'email', 'phone', 'location'] as const) {
      if (fill(document.personal, incoming.personal, field)) {
        filled.push(`personal.${field}`);
      }
    }

    for (const [name, url] of Object.entries(incoming.personal.links ?? {})) {
      if (!document.personal.links[name] && url.trim()) {
        document.personal.links[name] = url.trim();
        filled.push(`personal.links.${name}`);
      }
    }
  }

  if (fill(document, incoming, 'role_description')) filled.push('role_description');

  if (incoming.skills) {
    if (fill(document.skills, incoming.skills, 'role')) filled.push('skills.role');

    for (const field of [
      'programming_languages',
      'frameworks',
      'libraries_and_tools'
    ] as const) {
      const before = document.skills[field].length;
      document.skills[field] = unionStrings(
        document.skills[field],
        incoming.skills[field] ?? []
      );
      added.skills += document.skills[field].length - before;
    }
  }

  for (const entry of incoming.experience ?? []) {
    const match = document.experience.find(
      (candidate) =>
        key(candidate.company, candidate.title) === key(entry.company, entry.title)
    );

    if (match) {
      const before = match.highlights.length;
      mergeExperienceEntry(match, entry);
      added.highlights += match.highlights.length - before;
    } else {
      document.experience.push(entry);
      added.experience++;
      added.highlights += entry.highlights.length;
    }
  }

  for (const entry of incoming.education ?? []) {
    const exists = document.education.some(
      (candidate) =>
        key(candidate.university, candidate.degree) ===
        key(entry.university, entry.degree)
    );
    if (!exists) {
      document.education.push(entry);
      added.education++;
    }
  }

  for (const entry of incoming.certificates ?? []) {
    const exists = document.certificates.some(
      (candidate) => key(candidate.name, candidate.issuer) === key(entry.name, entry.issuer)
    );
    if (!exists) {
      document.certificates.push(entry);
      added.certificates++;
    }
  }

  for (const entry of incoming.languages ?? []) {
    const exists = document.languages.some(
      (candidate) => key(candidate.name) === key(entry.name)
    );
    if (!exists) {
      document.languages.push(entry);
      added.languages++;
    }
  }

  // Provenance is append-only: the record of where something came from stays
  // true even after a later import supersedes nothing.
  document.sources = [...document.sources, ...(incoming.sources ?? [])];

  return { document, report: { filled, added } };
};
