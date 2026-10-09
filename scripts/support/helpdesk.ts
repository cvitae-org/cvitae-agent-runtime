/**
 * A helpdesk, to run the grounding engine over something that is not what the
 * engine was written for.
 *
 * Two wells, each with a scope, sections and items, and each keying its own
 * pieces: tickets by queue, status and number; articles by space, category and
 * slug. A few keys are awkward on purpose (a slash in a category, Polish letters
 * in a slug), because that is where an address format breaks.
 *
 * `readSection` is what a port will do in a later step, written out here with
 * the engine's own parts: leave out whatever a wall covers, record the rest.
 */

import type { PieceRef } from '../../src/contracts/index.js';
import { contains, createWellRegistry, digest, formatRef, isWalled, parseRef, wallsWithin } from '../../src/grounding/index.js';
import type { RecordBook } from '../../src/grounding/index.js';

export const helpdeskWells = createWellRegistry([
  { id: 'tickets', describe: 'Support tickets, by queue and status' },
  { id: 'kb', describe: 'Knowledge-base articles, by space and category' }
]);

export type Ticket = { number: string; status: 'open' | 'closed'; subject: string; body: string };
export type Article = { slug: string; category: string; title: string; text: string };

export const queue = {
  id: 'support',
  revision: 12,
  tickets: [
    { number: 'T-1042', status: 'open', subject: 'Cannot reset password', body: 'The reset mail never arrives.' },
    { number: 'T-1043', status: 'open', subject: 'Invoice shows the wrong VAT', body: 'Charged 23% instead of 8%.' },
    { number: 'T-0987', status: 'closed', subject: 'Export is slow', body: 'Fixed by the March release.' },
    { number: 'T-0990', status: 'closed', subject: 'Zażółć gęślą jaźń', body: 'Unicode in the subject line.' }
  ] as Ticket[]
};

export const space = {
  id: 'main',
  revision: 3,
  articles: [
    { slug: 'reset-password', category: 'account', title: 'Resetting a password', text: 'Use the link on the sign-in page.' },
    { slug: 'vat-rates', category: 'billing', title: 'VAT rates', text: 'Standard 23%, reduced 8%.' },
    { slug: 'refund-policy', category: 'internal', title: 'Refund policy', text: 'Refunds above 500 need a manager.' },
    { slug: 'escalation', category: 'internal', title: 'Escalation', text: 'Page the on-call lead after two hours.' },
    { slug: 'zażółć-hasło', category: 'how/to', title: 'Zmiana hasła', text: 'Kliknij link na stronie logowania.' }
  ] as Article[]
};

/** What a well hands the engine for one address: the address, and the content it digests. */
export type Piece = { readonly ref: PieceRef; readonly content: unknown };

export const ticketPieces = (source: { id: string; revision: number; tickets: Ticket[] } = queue): Piece[] =>
  source.tickets.map((ticket) => ({
    ref: {
      well: 'tickets',
      scope: source.id,
      version: String(source.revision),
      path: [ticket.status, ticket.number],
      digest: digest(ticket)
    },
    content: ticket
  }));

export const articlePieces = (source: { id: string; revision: number; articles: Article[] } = space): Piece[] =>
  source.articles.map((article) => ({
    ref: {
      well: 'kb',
      scope: source.id,
      version: String(source.revision),
      path: [article.category, article.slug],
      digest: digest(article)
    },
    content: article
  }));

/**
 * Reads a section, or a whole scope, past the walls.
 *
 * Returns the pieces under `section` that no wall covers, and records each one
 * as included. A walled section returns nothing and records nothing.
 */
export const readSection = (
  pieces: readonly Piece[],
  section: PieceRef,
  walls: readonly PieceRef[],
  book: RecordBook,
  via = 'tool:read_section'
): Piece[] => {
  if (isWalled(walls, section)) return [];
  const inner = wallsWithin(walls, section);
  const kept = pieces.filter((piece) => contains(section, piece.ref) && !inner.some((wall) => contains(wall, piece.ref)));

  for (const piece of kept) {
    book.add({
      ref: formatRef({ well: piece.ref.well, scope: piece.ref.scope, path: piece.ref.path }),
      ...(piece.ref.version === undefined ? {} : { version: piece.ref.version }),
      digest: piece.ref.digest as string,
      status: 'included',
      origin: 'server',
      via
    });
  }
  return kept;
};

/** A ref from its text, for readable tables in the tests. */
export const ref = (text: string): PieceRef => parseRef(text);
