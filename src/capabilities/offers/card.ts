/**
 * An offer as a message that compares offers shows it: a card.
 *
 * Made from what the offer was stored with and by no model, so the same offer
 * always gives the same card and a record can say which card a model was shown.
 * It is short on purpose. A comparison of twenty-five offers is twenty-five cards
 * and the parts of the CV that match them, and a card that carried a whole posting
 * would leave no room for the CV.
 *
 * The card is in English whatever language the posting is in: its labels are the
 * runtime's and its values are the offer's own.
 */

import { CARD_LIMIT } from '../../context/ground.js';
import type { OfferRecord } from '../../contracts/index.js';
import { digest } from '../../grounding/index.js';

/** The shortest start of a posting worth putting on a card. */
const POSTING_FLOOR = 60;

const FIELD_LIMIT = 80;

const flat = (value: string | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

const clipped = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;

/** A word's end at or before `limit`, so a card does not stop in the middle of a word. */
const wordsTo = (value: string, limit: number): string => {
  if (value.length <= limit) return value;
  const cut = value.slice(0, Math.max(0, limit - 1));
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

/** The part of an offer a card is made of, and so what a record's digest is of. */
export const cardSource = (offer: OfferRecord): Record<string, unknown> => ({
  id: offer.id,
  position: offer.position ?? null,
  company: offer.company ?? null,
  location: offer.location ?? null,
  workMode: offer.workMode ?? null,
  seniority: offer.seniority ?? null,
  contractType: offer.contractType ?? null,
  salary: offer.salary ?? null,
  skills: offer.skills ?? [],
  text: offer.text
});

/** What the model reads of one offer, with no number: a number is put in front when the message is composed. */
export const cardText = (offer: OfferRecord): string => {
  const position = clipped(flat(offer.position), FIELD_LIMIT);
  const company = clipped(flat(offer.company), FIELD_LIMIT);
  const head = `Offer: ${[position, company].filter((part) => part !== '').join(' at ') || 'untitled'}`;

  const where = [offer.location, offer.workMode].map(flat).filter((part) => part !== '').join(', ');
  const level = [offer.seniority, offer.contractType].map(flat).filter((part) => part !== '').join(', ');
  const salary = flat(offer.salary);

  const lines = [
    head,
    where === '' ? '' : `Where: ${clipped(where, FIELD_LIMIT)}`,
    level === '' ? '' : `Level: ${clipped(level, FIELD_LIMIT)}`,
    salary === '' ? '' : `Salary: ${clipped(salary, FIELD_LIMIT)}`
  ].filter((line) => line !== '');

  const room = (): number => CARD_LIMIT - lines.join('\n').length - 1;

  // Skills while they fit, and never half of one.
  const skills = (offer.skills ?? []).map(flat).filter((skill) => skill !== '');
  if (skills.length > 0) {
    const kept: string[] = [];
    for (const skill of skills) {
      if (`Skills: ${[...kept, skill].join(', ')}`.length > room()) break;
      kept.push(skill);
    }
    if (kept.length > 0) lines.push(`Skills: ${kept.join(', ')}`);
  }

  // What is left goes to the start of the posting, when there is enough to say anything.
  const posting = flat(offer.text);
  const left = room() - 'Posting: '.length;
  if (posting !== '' && left >= POSTING_FLOOR) lines.push(`Posting: ${wordsTo(posting, left)}`);

  return lines.join('\n');
};

/** The digest of what a card was made from, and the digest of the card itself. */
export const cardDigests = (offer: OfferRecord): { readonly digest: string; readonly shown: string } => ({
  digest: digest(cardSource(offer)),
  shown: digest(cardText(offer))
});
