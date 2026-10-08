/**
 * Which saved offers fit the CV best: what a model is given to say so, and the
 * account of what it was given.
 *
 * Reading the offers is not something the model does. The ids a message names are
 * turned into a shortlist (`offers/shortlist.ts`), each offer into a card
 * (`offers/card.ts`), and the parts of the CV that mention what the offers ask for
 * are found by this file. The model gets those and nothing else, and has no tools.
 * That is the shape measured to be the cheapest that can be traced: every block it
 * read is a record entry, so a claim in the answer can be held against the block
 * it cites.
 *
 * No model decides anything here, and nothing is random, so the same message
 * against the same offers and CV gives the same blocks in the same order, and a
 * preview of it says what a run would send:
 *
 *   evidence   the CV's own words, found by comparing the skills an offer lists
 *              with what each part of the CV says, whole words only. A part counts
 *              once for every skill of every offer that it mentions. The best
 *              `MAX_EVIDENCE` stay, and fewer when the budget is short. The search
 *              index is not used: it is rebuilt after an edit and may be parked,
 *              and a comparison that was different after every edit could not be
 *              traced.
 *   budget     the cards and the preferences are what was asked for and are never
 *              cut: at their largest they come to less than the budget. Evidence
 *              takes what is left. A part the pins or attachments already send is
 *              not sent twice, and is chosen all the same, so what is measured
 *              before a plan is never less than what is sent.
 *   numbers    with `cite`, the blocks are numbered in the order they are
 *              recorded, the answer is read for the numbers it uses, and a number
 *              that stands for no block is said so (`unresolved`) and not guessed at.
 */

import { GROUNDED, OperationError } from '../../contracts/index.js';
import type {
  Grounded,
  Need,
  OfferRecord,
  RecordEntry,
  RunContext,
  StepContext,
  TransformStep
} from '../../contracts/index.js';
import { MAX_EVIDENCE, OFFERS_BUDGET, PICKS_BUDGET } from '../../context/ground.js';
import type { GroundingInput } from '../../context/ground.js';
import { labelled } from '../../context/render.js';
import { digest, isWalled, parseRef } from '../../grounding/index.js';
import { cardDigests, cardText } from '../offers/card.js';
import { shortlist, leftOut } from '../offers/shortlist.js';
import type { Left, Shortlist } from '../offers/shortlist.js';
import { OFFERS_WELL, cardRef, offerRef } from '../offers/well.js';
import { GROUND_STEP, VIA, allLeaves, blockedEntry, included, leafRef } from './assembly.js';
import type { Leaf } from './assembly.js';
import { CV_ID } from './document.js';
import { OVERVIEW } from './well.js';
import { viewOf } from './walls.js';

export const FIT_STEP = 'fit';

/** What the preferences a host sent are recorded as: the host's own words, said to be so. */
export const PREFERENCES_REF = 'preferences:request';

/** Whether a message compares offers at all. An empty list is a message that does not. */
export const isFit = (grounding: GroundingInput | undefined): boolean => (grounding?.offerIds?.length ?? 0) > 0;

/* ---------------------------------------------------------------- the pieces */

/** Skills as they are compared: one line, lower case, and nothing too short to mean anything. */
const termsOf = (offer: OfferRecord): string[] => [
  ...new Set(
    (offer.skills ?? [])
      .map((skill) => skill.replace(/\s+/g, ' ').trim().toLowerCase())
      .filter((skill) => skill.length >= 2)
  )
];

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

/** Whether `term` stands in `haystack` as a word of its own, and not inside another. */
const mentions = (haystack: string, term: string): boolean => {
  for (let at = haystack.indexOf(term); at >= 0; at = haystack.indexOf(term, at + 1)) {
    if (!isWordCharacter(haystack[at - 1]) && !isWordCharacter(haystack[at + term.length])) return true;
  }
  return false;
};

/** The size of blocks as they are sent: the blocks and the blank line between each. */
const sizeOf = (blocks: readonly string[]): number =>
  blocks.reduce((total, block, at) => total + block.length + (at === 0 ? 0 : 2), 0);

type Card = { readonly offer: OfferRecord; readonly text: string; readonly digest: string; readonly shown: string };

type Prepared = {
  readonly shortlist: Shortlist;
  /** The preferences as the host sent them, or nothing. */
  readonly preferences: string;
  readonly cards: readonly Card[];
  /** The parts of the CV chosen, in document order, before any a pin already sends is taken off. */
  readonly evidence: readonly Leaf[];
  readonly scope: string;
  readonly revision: number;
  /** What the preferences, cards and evidence come to as sent, before any part a pin sends is taken off. */
  readonly size: number;
};

/**
 * Everything the offers of a message are made of, from the message and what the
 * runtime holds, and nothing that a run alone could know.
 *
 * It is what the measurement made before a plan, the preview and the step that
 * assembles are each made of. Three readings that were three computations would
 * be three chances to disagree.
 */
const prepare = (asked: Pick<GroundingInput, 'offerIds' | 'preferences'>, context: RunContext): Prepared | undefined => {
  const scope = context.contextId;
  if (context.offers === undefined || scope === undefined) return undefined;

  const made = shortlist(asked.offerIds ?? [], context.offers, context.walls?.pieces() ?? []);
  const cards = made.compared.map((offer): Card => ({ offer, text: cardText(offer), ...cardDigests(offer) }));
  const preferences = (asked.preferences ?? '').trim();

  const found = context.documents.read(CV_ID);
  const view = found === undefined ? undefined : viewOf(found);
  const terms = made.compared.map(termsOf);

  // Scored once for each skill of each offer a part mentions. The personal details,
  // and the contact details that are part of them, say nothing about fit, and are
  // never offered as evidence.
  const scored =
    view === undefined || cards.length === 0
      ? []
      : allLeaves(view)
          .filter((leaf) => !(leaf.section === OVERVIEW && (leaf.key === 'personal' || leaf.key === 'contact')))
          .map((leaf, order) => {
            const haystack = leaf.text.toLowerCase();
            const score = terms.reduce((sum, own) => sum + own.filter((term) => mentions(haystack, term)).length, 0);
            return { leaf, order, score };
          })
          .filter((each) => each.score > 0)
          .sort((a, b) => b.score - a.score || a.order - b.order)
          .slice(0, MAX_EVIDENCE);

  // Best first and only while it fits, so the cut is by how well a part matches and
  // the cards and preferences, which were asked for, come first in the room.
  const fixed = sizeOf([...(preferences === '' ? [] : [preferences]), ...cards.map((card) => card.text)]);
  let used = fixed;
  const kept = scored.filter((each) => {
    const next = used + each.leaf.text.length + 2;
    if (next > OFFERS_BUDGET) return false;
    used = next;
    return true;
  });
  const evidence = kept.sort((a, b) => a.order - b.order).map((each) => each.leaf);

  return { shortlist: made, preferences, cards, evidence, scope, revision: found?.revision ?? 0, size: used };
};

/** What the offers of a message come to, in characters, as the model would be given them. Nothing when it compares none. */
export const fitSize = (grounding: GroundingInput | undefined, context: RunContext): number =>
  isFit(grounding) ? (prepare(grounding as GroundingInput, context)?.size ?? 0) : 0;

/* ------------------------------------------------------------------- needs */

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** The offers that are not compared, in words, each reason once. */
export const leftWords = (left: Left): string =>
  [
    left.excluded.length > 0 && `${plural(left.excluded.length, 'is', 'are')} left out of this conversation`,
    left.missing.length > 0 && `${left.missing.length} not saved`,
    left.board.length > 0 && `${left.board.length} already on the Board`,
    left.cut.length > 0 && `${left.cut.length} beyond the ones compared`
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(', ');

/**
 * What a message that compares offers needs before it can be run.
 *
 * Offers can be compared only where there is a CV to compare them with and a
 * shelf to read them from. Nothing to compare is refused and not answered, since a
 * model handed no offer would say which of them fit best from what it imagines.
 * Offers that are left out while others are compared are said, and do not stop
 * the message.
 */
export const fitNeeds = (grounding: GroundingInput | undefined, context: RunContext): Need[] => {
  if (!isFit(grounding)) return [];

  const made = prepare(grounding as GroundingInput, context);
  if (made === undefined) {
    return [{ name: 'offers', required: true, unmet: 'Offers can be compared only in a conversation about a CV.' }];
  }

  const { compared, left } = made.shortlist;
  if (compared.length === 0) {
    const asked = (grounding as GroundingInput).offerIds?.length ?? 0;
    return [
      {
        name: 'offers',
        required: true,
        unmet: `None of the ${plural(asked, 'offer', 'offers')} named can be compared: ${leftWords(left)}.`
      }
    ];
  }

  return [
    {
      name: 'offers',
      required: false,
      ...(leftOut(left) > 0 ? { unmet: `${plural(leftOut(left), 'offer', 'offers')} left out: ${leftWords(left)}.` } : {})
    }
  ];
};

/* ----------------------------------------------------------------- assembly */

/** What a fit step says besides the blocks, for the result and for the prompt. */
export type Fit = {
  /** The ids of the offers compared, most recently seen first. */
  readonly compared: readonly string[];
  readonly left: Left;
  readonly preferences: 'supplied' | 'absent';
  /** How many blocks of each kind, in the order they are recorded. */
  readonly parts: { readonly preferences: number; readonly cards: number; readonly evidence: number };
  /** Whether a part of the CV was found that mentions a skill an offer lists. */
  readonly matched: boolean;
};

export type FitMade = { readonly grounded: Grounded; readonly fit: Fit };

const assemble = (
  asked: Pick<GroundingInput, 'offerIds' | 'preferences'>,
  context: RunContext,
  taken: ReadonlySet<string>
): FitMade => {
  const made = prepare(asked, context);
  if (made === undefined) {
    throw new OperationError('needs_unmet', 'Offers can be compared only in a conversation about a CV.');
  }

  const { left, compared } = made.shortlist;

  // What an exclusion held back is said now, as the pieces' own assembly says it:
  // true whether or not a model is ever called.
  const refused = left.excluded.map((id) => blockedEntry(offerRef(id), VIA.offer));
  if (refused.length > 0) context.record?.add(refused);

  const sent = made.evidence.filter((leaf) => !taken.has(leafRef(made.scope, leaf.section, leaf.key)));

  const blocks: string[] = [];
  const entries: RecordEntry[] = [];

  if (made.preferences !== '') {
    blocks.push(made.preferences);
    entries.push({ ref: PREFERENCES_REF, digest: digest(made.preferences), status: 'included', origin: 'client', via: 'input' });
  }
  for (const card of made.cards) {
    blocks.push(card.text);
    entries.push({ ref: cardRef(card.offer.id), digest: card.digest, shown: card.shown, status: 'included', origin: 'server', via: VIA.offer });
  }
  for (const leaf of sent) {
    blocks.push(leaf.text);
    entries.push(included(made.scope, made.revision, leaf, VIA.evidence));
  }

  return {
    grounded: {
      text: blocks.join('\n\n'),
      blocks,
      entries,
      blocked: left.excluded.map(offerRef),
      gone: left.missing.map(offerRef),
      suggested: []
    },
    fit: {
      compared: compared.map((offer) => offer.id),
      left,
      preferences: made.preferences === '' ? 'absent' : 'supplied',
      parts: { preferences: made.preferences === '' ? 0 : 1, cards: made.cards.length, evidence: sent.length },
      matched: made.evidence.length > 0
    }
  };
};

/** The pieces the step before this one sent, as the refs it recorded. */
const takenBy = (context: StepContext): ReadonlySet<string> => {
  const before = context.completed[GROUND_STEP]?.[GROUNDED] as Grounded | undefined;
  return new Set((before?.entries ?? []).map((entry) => entry.ref));
};

/**
 * The step that assembles the offers. It reads the shelf and the CV now and not
 * when the plan was made, so an offer that was left out while the run waited is
 * left out at its resume.
 */
export const fitStep = (asked: Pick<GroundingInput, 'offerIds' | 'preferences'>, cite = false): TransformStep => ({
  kind: 'transform',
  name: FIT_STEP,
  critical: true,
  run: async (context: StepContext) => {
    const { grounded, fit } = assemble(asked, context, takenBy(context));
    // The flag is carried so that whoever reads the outcomes knows whether the blocks were numbered.
    return { [GROUNDED]: grounded, fit, ...(cite ? { cite: true } : {}) };
  }
});

/** What the fit step made, from the outcomes of the steps before this one. */
export const fitBy = (context: StepContext): { grounded: Grounded; fit: Fit } | undefined => {
  const value = context.completed[FIT_STEP];
  return value === undefined ? undefined : { grounded: value[GROUNDED] as Grounded, fit: value.fit as Fit };
};

/* ------------------------------------------------------------------- stale */

/**
 * The cards of an earlier assembly that no longer describe what the shelf holds,
 * as refs: an offer that has changed, is gone, or has been left out since.
 *
 * Checked as the CV's pieces are (`staleCv`), for the same reason: a run resumed
 * from the text its assembly made would send a card as it was. An offer that has
 * since gone onto the Board is not stale: the person approved a comparison that
 * had it, and the card says what it said.
 */
export const staleOffers = (
  context: Pick<RunContext, 'offers' | 'walls'>,
  entries: readonly RecordEntry[]
): string[] => {
  const walls = context.walls?.pieces() ?? [];
  const cards = entries.filter((entry) => entry.status === 'included' && entry.ref.startsWith(`${OFFERS_WELL}:`));
  if (cards.length === 0) return [];

  return cards.flatMap((entry) => {
    const ref = parseRef(entry.ref);
    const now = isWalled(walls, ref) ? undefined : context.offers?.read([ref.scope])[0];
    return now !== undefined && cardDigests(now).digest === entry.digest ? [] : [entry.ref];
  });
};

/* ------------------------------------------------------------------ prompts */

/** The blocks of what a step assembled, one by one, whichever way the step recorded them. */
export const blocksOf = (grounded: Grounded | undefined): readonly string[] =>
  grounded === undefined ? [] : (grounded.blocks ?? (grounded.text === '' ? [] : [grounded.text]));

/** The labels of the sections, plain like the others in a prompt, and said the same way every time so a measurement holds. */
export const FIT_LABELS = {
  preferences: 'PREFERENCES — SOURCE DATA',
  cards: 'SAVED OFFERS TO COMPARE — SOURCE DATA',
  evidence: 'PARTS OF THE CV THAT MENTION THEIR SKILLS — SOURCE DATA',
  absent: 'None were supplied.',
  unmatched: 'None of the skills the offers list appears in the CV.'
} as const;

/**
 * The sections of the part of a prompt that is made of what was assembled, as a
 * model reads them: the pieces chosen first, and then, for a message that compares
 * offers, the preferences, the cards and the evidence.
 *
 * Numbered, when asked, in the order the blocks are recorded, so that the number of
 * a block is its place among the entries and nothing else has to say which is
 * which. What is said about the preferences and about the CV matching nothing is the
 * runtime's own statement of a fact it can vouch for, and carries no number.
 */
export const sectionsOf = (
  parts: {
    readonly picks: Grounded | undefined;
    readonly fit: { readonly grounded: Grounded; readonly fit: Fit } | undefined;
    readonly cite: boolean;
  },
  picksLabel: string
): string[] => {
  let number = 0;
  const keyed = (blocks: readonly string[]): string =>
    blocks.map((block) => (parts.cite ? `[${(number += 1)}] ${block}` : block)).join('\n\n');

  const picks = labelled(picksLabel, keyed(blocksOf(parts.picks)), PICKS_BUDGET);
  if (parts.fit === undefined) return [picks];

  const blocks = blocksOf(parts.fit.grounded);
  const { preferences, cards, evidence } = parts.fit.fit.parts;

  return [
    picks,
    parts.fit.fit.preferences === 'supplied'
      ? labelled(FIT_LABELS.preferences, keyed(blocks.slice(0, preferences)), OFFERS_BUDGET)
      : `${FIT_LABELS.preferences}:\n${FIT_LABELS.absent}`,
    labelled(FIT_LABELS.cards, keyed(blocks.slice(preferences, preferences + cards)), OFFERS_BUDGET),
    parts.fit.fit.matched
      ? labelled(FIT_LABELS.evidence, keyed(blocks.slice(preferences + cards, preferences + cards + evidence)), OFFERS_BUDGET)
      : `${FIT_LABELS.evidence}:\n${FIT_LABELS.unmatched}`
  ];
};

/** What the model's answer cites, and what it cites that stands for nothing it was given. */
export type Cited = { readonly cited: readonly string[]; readonly unresolved: readonly number[] };

/**
 * Reads an answer for the numbers it cites: `[3]`, or `[2, 5]`, with nothing but
 * numbers inside. A number stands for the entry recorded at that place; one that
 * stands for none is listed as unresolved, and no entry is guessed for it.
 */
export const citations = (answer: string, entries: readonly RecordEntry[]): Cited => {
  const cited: string[] = [];
  const unresolved: number[] = [];

  for (const marker of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const part of (marker[1] as string).split(',')) {
      const at = Number(part);
      const entry = at >= 1 ? entries[at - 1] : undefined;
      if (entry !== undefined) {
        if (!cited.includes(entry.ref)) cited.push(entry.ref);
      } else if (!unresolved.includes(at)) {
        unresolved.push(at);
      }
    }
  }
  return { cited, unresolved };
};
