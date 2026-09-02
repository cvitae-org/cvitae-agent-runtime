/**
 * Folding an extracted document into the one already stored.
 *
 * Every source is partial. A certificate PDF has no employment history, a
 * profile screenshot has no phone number, and a CV export has both but perhaps
 * an older job title. So an import is a merge, not a write, and the policy is
 * the conservative one throughout: **an import may add, and may fill a blank,
 * but may never overwrite something already there.**
 *
 * That asymmetry is deliberate and it is not the obvious choice. "Newest wins"
 * is what a sync usually does, and it is wrong here, because the two sides are
 * not equally trustworthy: what is stored has survived the user looking at it,
 * while what arrives has just been guessed at by a small model from a
 * screenshot. Losing a correct hand-edited job title to a hallucinated one is
 * the single worst thing an importer can do, and it is silent when it happens.
 *
 * The cost is real and worth stating: correcting a value means editing the
 * document, because a re-import will not do it.
 *
 * Every function here is pure, and that is a requirement rather than a style
 * preference. `DocumentStore.update` takes a mutator and may re-run it when a
 * concurrent writer wins the revision check, so a merge that mutated its
 * `existing` argument, appended to a captured array or read a clock would
 * produce a different document the second time through.
 */

import type { CvDocument, ExperienceEntry } from './document.js';

/** Case- and whitespace-insensitive identity for matching two entries. */
const key = (...parts: (string | undefined | null)[]): string =>
  parts.map((part) => (part ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');

const isBlank = (value: string | undefined | null): boolean => !value || value.trim().length === 0;

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
 * a genuine promotion and those are two entries, not one. Highlights union — a
 * second source describing the same job usually phrases its bullets differently,
 * and both phrasings are legitimate material for a tailored CV.
 */
const mergeExperienceEntry = (existing: ExperienceEntry, incoming: ExperienceEntry): void => {
  existing.highlights = unionStrings(existing.highlights, incoming.highlights);
  existing.skills = unionStrings(existing.skills, incoming.skills);

  fill(existing, incoming, 'started');

  // The three-state end date earning its keep. `null` is an assertion that the
  // role is ongoing, so an import may not close it; `''` is an admission that
  // no source has said, so a source that does say may fill it.
  if (existing.finished === '' && typeof incoming.finished === 'string' && incoming.finished) {
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

    for (const field of ['programming_languages', 'frameworks', 'libraries_and_tools'] as const) {
      const before = document.skills[field].length;
      document.skills[field] = unionStrings(document.skills[field], incoming.skills[field] ?? []);
      added.skills += document.skills[field].length - before;
    }
  }

  for (const entry of incoming.experience ?? []) {
    const match = document.experience.find(
      (candidate) => key(candidate.company, candidate.title) === key(entry.company, entry.title)
    );

    if (match) {
      const before = match.highlights.length;
      mergeExperienceEntry(match, entry);
      added.highlights += match.highlights.length - before;
    } else {
      // Cloned rather than pushed by reference. A mutator that may run twice
      // must not leave the second run's document sharing entries with the
      // first's, and nothing downstream should be able to reach back into
      // `incoming` by editing the merged result.
      document.experience.push(structuredClone(entry));
      added.experience++;
      added.highlights += entry.highlights.length;
    }
  }

  for (const entry of incoming.education ?? []) {
    const exists = document.education.some(
      (candidate) =>
        key(candidate.university, candidate.degree) === key(entry.university, entry.degree)
    );
    if (!exists) {
      document.education.push(structuredClone(entry));
      added.education++;
    }
  }

  for (const entry of incoming.certificates ?? []) {
    const exists = document.certificates.some(
      (candidate) => key(candidate.name, candidate.issuer) === key(entry.name, entry.issuer)
    );
    if (!exists) {
      document.certificates.push(structuredClone(entry));
      added.certificates++;
    }
  }

  for (const entry of incoming.languages ?? []) {
    const exists = document.languages.some((candidate) => key(candidate.name) === key(entry.name));
    if (!exists) {
      document.languages.push(structuredClone(entry));
      added.languages++;
    }
  }

  // Provenance is append-only: the record of where something came from stays
  // true even after a later import supersedes what it produced.
  document.sources = [...document.sources, ...(incoming.sources ?? [])];

  return { document, report: { filled, added } };
};
