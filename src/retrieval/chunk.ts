/**
 * Turns the CV document into the units that get embedded.
 *
 * Only a fraction of the document belongs here, and picking that fraction is
 * the entire job. Dates, contact details, degree names and certificate issuers
 * are looked up, not searched for — embedding them adds noise to every query
 * and answers none. What is genuinely retrievable is the prose: the individual
 * experience highlights, and the role description.
 *
 * One highlight is one chunk, deliberately. The usual sliding-window chunker
 * exists for documents with no structure, and a CV has plenty: a bullet is
 * already the unit a person wrote as a single claim, already about one thing,
 * and already the right size to hand back to a model composing a tailored
 * summary. Splitting by character count would cut across two of them and
 * retrieve half of each.
 *
 * The company and title ride along in the embedded text rather than only in
 * metadata, because "React work at an e-commerce company" should match a
 * highlight whose own wording never repeats the employer.
 */

import type { CvDocument } from '../store/cvDocument.js';

export type Chunk = {
  /** Stable across re-indexing, so an unchanged bullet keeps its row. */
  id: string;
  kind: 'highlight' | 'role_description';
  /** What gets embedded. */
  text: string;
  /** Where it came from, for citing the source of a generated claim. */
  company: string;
  title: string;
  /** Position in the source array, so ordering survives a round trip. */
  position: number;
};

/**
 * A short deterministic hash of the source text.
 *
 * Keying by index alone would reassign every id below an edit when a bullet is
 * inserted, so the whole tail re-embeds for nothing. Keying by content means
 * only what changed is recomputed — which matters against a local embedding
 * server, where a full re-index is measured in seconds rather than milliseconds.
 *
 * FNV-1a: not cryptographic, and does not need to be. A collision would reuse
 * one embedding for two identical-length strings, and the inputs are the user's
 * own CV bullets rather than anything adversarial.
 */
const fingerprint = (value: string): string => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36);
};

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Long enough to carry meaning. "Agile", "Scrum" retrieve nothing useful. */
const MIN_LENGTH = 25;

export const chunkDocument = (document: CvDocument): Chunk[] => {
  const chunks: Chunk[] = [];

  const description = clean(document.role_description);

  if (description.length >= MIN_LENGTH) {
    chunks.push({
      id: `role:${fingerprint(description)}`,
      kind: 'role_description',
      text: description,
      company: '',
      title: document.skills.role,
      position: 0
    });
  }

  document.experience.forEach((entry, entryIndex) => {
    entry.highlights.forEach((highlight, highlightIndex) => {
      const text = clean(highlight);
      if (text.length < MIN_LENGTH) return;

      // Prefixed so the employer and role are part of what is embedded, not
      // only what is filtered on.
      const embedded = `${entry.title} at ${entry.company}: ${text}`;

      chunks.push({
        id: `exp:${fingerprint(`${entry.company}|${entry.title}|${text}`)}`,
        kind: 'highlight',
        text: embedded,
        company: entry.company,
        title: entry.title,
        position: entryIndex * 1000 + highlightIndex
      });
    });
  });

  return chunks;
};
