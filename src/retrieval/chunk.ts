/**
 * Turns the CV document into the units that get embedded.
 *
 * Picking what belongs here is the whole job, and the answer used to be "the
 * prose only" — experience highlights and the role description, on the argument
 * that everything else is looked up rather than searched for. That argument was
 * half right. It is true of a *field*: nobody retrieves a phone number, and
 * "the relevant education" is meaningless when there is one education array.
 * It is not true of the *claim* the field carries. An offer that demands an AWS
 * certification, a degree in the subject, or German at B2 is asking a question
 * the CV can answer, and until this file emitted those kinds `search_profile`
 * could only reply with bullets that happened to mention the word.
 *
 * So every kind is embedded now, but not every kind the same way:
 *
 *   - **Authored prose** — the summary, and one chunk per experience highlight.
 *     A bullet is already the unit a person wrote as a single claim, already
 *     about one thing, and already the right size to hand to a model composing
 *     a tailored summary. Splitting by character count would cut across two of
 *     them and retrieve half of each. These are gated on length, because a
 *     three-word bullet is the user writing something useless.
 *
 *   - **Synthesised records** — skills, education, certificates, languages,
 *     job titles. These are assembled into one labelled sentence per record
 *     ("Certificate: AWS Solutions Architect, issued by Amazon Web Services"),
 *     which is what makes them self-describing when they come back out: the
 *     retrieved text says what it is without any consumer having to know. They
 *     are gated on their source values being non-blank rather than on length,
 *     since the label inflates the character count and would defeat the floor.
 *
 * Skills and languages are grouped rather than emitted one per value, and that
 * is the load-bearing decision in the widening. A bare "React" is six characters
 * of context that matches half the corpus; eight of them would flood the top-k
 * of every query and crowd out the bullets that carry actual evidence. Grouped,
 * the keyword arm still gets its exact-token hit on "React" while the vector arm
 * gets a coherent sentence to place.
 *
 * The kind vocabulary is deliberately the one in
 * `capabilities/generateEvidenceSummary.ts` — `candidateFactKinds`. That schema
 * describes the same eight things for the evidence-CV contract, and having the
 * index speak a different dialect of it would mean translating between two
 * hand-maintained lists at the one point where ids have to line up.
 */

import type { CvDocument } from '../store/cvDocument.js';
import { fingerprint } from '../core/fingerprint.js';

/** Kept identical to `candidateFactKinds`. Changing one wants the other. */
export const chunkKinds = [
  'role',
  'summary',
  'skill',
  'experience-title',
  'experience-bullet',
  'education',
  'certificate',
  'language'
] as const;

export type ChunkKind = (typeof chunkKinds)[number];

/**
 * What `draft_application` retrieves, and the reason the subset exists.
 *
 * `prompt/builder.ts`'s `renderCandidate` already states the name, the current
 * role, the skill list and the recent job titles directly in the prompt. Left
 * unfiltered, retrieval would spend slots from a budget of eight hits — and
 * characters from `renderProfileContext`'s cap — handing a small model back
 * text it was already given two blocks earlier, while pushing out the bullets
 * that are the only thing in the index it has not already seen. These four
 * kinds are the ones the CANDIDATE block does not cover.
 *
 * `search_profile` and `ask_profile` are deliberately not filtered: an
 * open-ended question about the CV should be able to reach all of it.
 */
export const DRAFTING_KINDS: ChunkKind[] = [
  'experience-bullet',
  'education',
  'certificate',
  'language'
];

export type Chunk = {
  /** Stable across re-indexing, so an unchanged bullet keeps its row. */
  id: string;
  kind: ChunkKind;
  /** What gets embedded. Self-describing for the synthesised kinds. */
  text: string;
  /**
   * Where it came from, for citing the source of a generated claim.
   *
   * Only the experience kinds have a company and a job title; the rest leave
   * both blank rather than borrowing the columns for an issuer or a university,
   * which would make `search_profile` report a certificate authority as an
   * employer. The synthesised text names its own source instead.
   */
  company: string;
  title: string;
  /** Position in the document, so ordering survives a round trip. */
  position: number;
};

/*
 * Ids are keyed by content, via `core/fingerprint.ts`.
 *
 * Keying by index alone would reassign every id below an edit when a bullet is
 * inserted, so the whole tail re-embeds for nothing. Keying by content means
 * only what changed is recomputed — which matters against a local embedding
 * server, where a full re-index is measured in seconds rather than milliseconds.
 */

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Long enough to carry meaning. "Agile", "Scrum" retrieve nothing useful.
 *
 * Applied to authored prose only — see the note at the top of the file on why
 * the synthesised kinds are gated on their source values instead.
 */
const MIN_LENGTH = 25;

/**
 * Where each kind sits in the document order `position` reconstructs.
 *
 * Bands rather than one running counter, so that adding a kind does not shift
 * every position below it. Experience is the only band with structure inside
 * it: a job's title sits immediately before its own bullets, which is the order
 * a reader would put them in. That leaves room for 999 bullets per job and 899
 * jobs before the next band, which is not a limit anyone reaches.
 */
const ROLE_BAND = 0;
const SUMMARY_BAND = 1;
const SKILL_BAND = 10;
const EXPERIENCE_BAND = 1_000;
const EDUCATION_BAND = 900_000;
const CERTIFICATE_BAND = 920_000;
const LANGUAGE_BAND = 940_000;

/**
 * A date range in words, or nothing when the document has no dates.
 *
 * `finished: null` means the role or course is current, which is a fact worth
 * embedding — "present" is a token an offer's "currently working as" can match.
 * Spelled "to" rather than punctuated with a dash because the string is fed to
 * BM25 as well as to an embedder, and a dash is a token that means nothing.
 */
const period = (started: string, finished: string | null): string => {
  const from = clean(started);
  const to = finished === null ? 'present' : clean(finished);

  if (!from) return to && to !== 'present' ? ` (until ${to})` : '';
  if (!to) return ` (from ${from})`;

  return ` (${from} to ${to})`;
};

/** The skill arrays, with the label that goes in front of each in the text. */
const SKILL_GROUPS = [
  ['programming_languages', 'Programming languages'],
  ['frameworks', 'Frameworks'],
  ['libraries_and_tools', 'Libraries and tools']
] as const;

export const chunkDocument = (document: CvDocument): Chunk[] => {
  const chunks: Chunk[] = [];

  const role = clean(document.skills.role);

  if (role) {
    chunks.push({
      id: `role:${fingerprint(role)}`,
      kind: 'role',
      text: `Current role: ${role}`,
      company: '',
      title: role,
      position: ROLE_BAND
    });
  }

  const description = clean(document.role_description);

  if (description.length >= MIN_LENGTH) {
    chunks.push({
      id: `summary:${fingerprint(description)}`,
      kind: 'summary',
      text: description,
      company: '',
      title: role,
      position: SUMMARY_BAND
    });
  }

  SKILL_GROUPS.forEach(([field, label], groupIndex) => {
    const values = document.skills[field].map(clean).filter(Boolean);
    if (values.length === 0) return;

    const joined = values.join(', ');

    chunks.push({
      id: `skill:${fingerprint(`${field}|${joined}`)}`,
      kind: 'skill',
      text: `${label}: ${joined}`,
      company: '',
      title: '',
      position: SKILL_BAND + groupIndex
    });
  });

  document.experience.forEach((entry, entryIndex) => {
    const company = clean(entry.company);
    const title = clean(entry.title);
    const base = EXPERIENCE_BAND + entryIndex * 1_000;

    if (company || title) {
      // The held position as its own claim. An offer for a "Senior Frontend
      // Developer" should be able to match the fact that the user has been one,
      // which no individual bullet necessarily says.
      const held = title && company ? `${title} at ${company}` : title || company;

      chunks.push({
        id: `title:${fingerprint(`${company}|${title}`)}`,
        kind: 'experience-title',
        text: `${held}${period(entry.started, entry.finished)}`,
        company,
        title,
        position: base
      });
    }

    entry.highlights.forEach((highlight, highlightIndex) => {
      const text = clean(highlight);
      if (text.length < MIN_LENGTH) return;

      // Prefixed so the employer and role are part of what is embedded, not
      // only what is filtered on.
      const embedded = `${title} at ${company}: ${text}`;

      chunks.push({
        id: `exp:${fingerprint(`${company}|${title}|${text}`)}`,
        kind: 'experience-bullet',
        text: embedded,
        company,
        title,
        position: base + 1 + highlightIndex
      });
    });
  });

  document.education.forEach((entry, index) => {
    const university = clean(entry.university);
    const degree = clean(entry.degree);
    if (!university && !degree) return;

    const studied = degree && university ? `${degree}, ${university}` : degree || university;
    const thesis = clean(entry.thesis);

    chunks.push({
      id: `edu:${fingerprint(`${university}|${degree}`)}`,
      kind: 'education',
      // The thesis is the one genuinely retrievable part of an education entry:
      // it is a sentence about a subject, where the rest is a proper noun.
      text: `${studied}${period(entry.started, entry.finished)}${thesis ? `. Thesis: ${thesis}` : ''}`,
      company: '',
      title: '',
      position: EDUCATION_BAND + index
    });
  });

  document.certificates.forEach((entry, index) => {
    const name = clean(entry.name);
    if (!name) return;

    const issuer = clean(entry.issuer);

    chunks.push({
      id: `cert:${fingerprint(`${name}|${issuer}`)}`,
      kind: 'certificate',
      text: `Certificate: ${name}${issuer ? `, issued by ${issuer}` : ''}${period(entry.started, entry.finished)}`,
      company: '',
      title: '',
      position: CERTIFICATE_BAND + index
    });
  });

  const languages = document.languages
    .map((entry) => {
      const name = clean(entry.name);
      if (!name) return '';
      const level = clean(entry.level);
      return level ? `${name} (${level})` : name;
    })
    .filter(Boolean);

  if (languages.length > 0) {
    const joined = languages.join(', ');

    chunks.push({
      id: `lang:${fingerprint(joined)}`,
      kind: 'language',
      text: `Languages: ${joined}`,
      company: '',
      title: '',
      position: LANGUAGE_BAND
    });
  }

  return chunks;
};
