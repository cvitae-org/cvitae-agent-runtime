/**
 * Which parts of a CV are worth searching for.
 *
 * `retrieval/chunk.ts` knows how a piece becomes a chunk and refuses to know
 * which parts of a document are pieces, because that is domain judgment and
 * domain judgment lives here. This file is the other half of that split, and it
 * is short on purpose: most of a CV is not retrievable content.
 *
 * What is indexed is the prose — the experience bullets and the role
 * description. What is not indexed is everything a caller looks *up* rather
 * than searches for: a name, an email, a date range, a certificate issuer, a
 * language level. Those are read straight off the document by the caller that
 * wants them, and putting them in the index would only give every query a set
 * of short, high-scoring, uninformative neighbours to compete with.
 *
 * The skills list is the interesting exclusion. It reads like content and it is
 * the thing people search for most, but a skills entry is one or two words —
 * below `MIN_LENGTH`, and below it for the right reason: "TypeScript" as a
 * chunk retrieves every bullet-free CV that lists TypeScript and distinguishes
 * nothing. A query about TypeScript work should find the bullet describing the
 * work, which the bullets already provide.
 */

import type { Piece } from '../../retrieval/chunk.js';
import type { CvDocument } from './document.js';

/**
 * Where a bullet was written, prepended to the embedded text.
 *
 * A bullet almost never names its own employer — it says "rebuilt the checkout
 * flow", not "rebuilt the checkout flow at Acme" — so without this, "React work
 * at an e-commerce company" has nothing to match on. Metadata filtering cannot
 * substitute: the words have to be in the vector.
 */
const where = (entry: CvDocument['experience'][number]): string =>
  [entry.title, entry.company].filter(Boolean).join(' at ');

/**
 * The document's retrievable pieces, in document order.
 *
 * `position` is a single running counter across both kinds rather than one per
 * kind, because it is what orders a result list for a reader and a reader reads
 * the CV top to bottom. Two pieces sharing a position would be arbitrary.
 */
export const cvPieces = (document: CvDocument): Piece[] => {
  const pieces: Piece[] = [];
  let position = 0;

  if (document.role_description.trim()) {
    pieces.push({
      kind: 'summary',
      text: document.role_description,
      position,
      meta: { section: 'role_description' }
    });
    position += 1;
  }

  for (const [index, entry] of document.experience.entries()) {
    const context = where(entry);

    for (const highlight of entry.highlights) {
      pieces.push({
        kind: 'highlight',
        text: highlight,
        ...(context ? { context } : {}),
        position,
        // Enough to render a hit as "at Acme, 2021–2023" without reading the
        // document back, and enough to filter to one employer. Not a copy of
        // the entry: the document is the record, this is a label.
        meta: {
          section: 'experience',
          entry: index,
          company: entry.company,
          title: entry.title
        }
      });
      position += 1;
    }
  }

  return pieces;
};
