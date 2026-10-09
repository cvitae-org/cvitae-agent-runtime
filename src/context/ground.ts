/**
 * What a message may ask of the pieces a model is given, and how much of them.
 *
 * Things a host can say with a message, beside the question:
 *
 *   once   pieces to send with this message only. A pin is the same wish kept for
 *          the whole conversation, and lives in the conversation's selection
 *          (`runtime/selection.ts`); once lives here and nowhere else, so the next
 *          message starts without it.
 *   reach  `free` leaves the model its tools, which is what a message without any
 *          of this does. `selected` takes them away: the model answers from the
 *          pieces that were selected and from nothing else.
 *   auto   whether the runtime adds pieces of its own choosing. `off` adds none.
 *          `suggest` names the pieces it would add and sends none of them. `on`
 *          sends them. It stays `off` unless asked, until it has been measured
 *          against tools alone.
 *   offerIds  saved offers to compare against the CV, which turns the question into
 *          "which of these fit best" (`capabilities/cv/fit.ts`). The model has no
 *          tools for such a message: it is given the offers as cards and the parts
 *          of the CV that match them, and nothing else.
 *   preferences  what the person wants of a job, as the host holds it (Studio owns
 *          them; the runtime keeps nothing). Sent with the offers, or said to be
 *          absent.
 *   cite   numbers the blocks the model is given, tells it to cite them, and reads
 *          the answer for the numbers it cited.
 *   overflow  what to do when the pieces do not fit. `refuse`, which is what a
 *          message does unless it says otherwise, fails the message and says by
 *          how much. `compact` sends some of the pieces in a shorter form first,
 *          as many as it takes and the largest saving first, and refuses only
 *          what that cannot make fit (`capabilities/cv/compact.ts`).
 *   full   pieces `compact` is not to shorten, a section being every piece in it.
 *          What a person says when a piece that was shortened should have been
 *          sent whole; the others are shortened instead, or the message is refused.
 *
 * The limits are the same kind of number the history's are (`conversation.ts`): a
 * ceiling in characters, declared by the one contributor it bounds, and refused
 * rather than trimmed. A pin that does not fit is a pin the person has to look at.
 * Cutting it to fit would send half of a piece under the name of the whole, and
 * the record could not say so.
 */

import { z } from 'zod';
import { isRef, parseRef, refKey } from '../grounding/index.js';

/**
 * What the pieces chosen for a message may come to, in characters, all of them
 * together: the pinned ones, the attached ones and the ones the runtime adds.
 *
 * Sized against what it competes with, as `HISTORY_BUDGET` is. A `read_cv` result
 * may be 5,200 characters and a loop may read six times, so this is roughly two
 * tool reads. It is the point where choosing pieces by hand stops being cheaper
 * than letting the model look for them.
 */
export const PICKS_BUDGET = 12_000;

/**
 * How much of a captured posting a model is shown, in characters. What a record
 * says it was shown of the posting when it was longer.
 */
export const POSTING_LIMIT = 40_000;

/** How many pieces one message may attach. A pin has its own limit (`MAX_PINS`). */
export const MAX_ONCE = 12;

/** How many offers a message may name. More than are compared, so the rest can be counted as cut. */
export const MAX_OFFER_IDS = 100;

/** How many offers one answer compares. The rest are cut, most recently seen first kept. */
export const COMPARE_LIMIT = 25;

/**
 * What the offers of a message may come to, in characters: the cards, the parts of
 * the CV that match them and the preferences. It takes the posting's place, since a
 * message that compares offers carries no posting. Over it the message is refused
 * and nothing is cut to fit.
 */
export const OFFERS_BUDGET = 30_000;

/** How much of an offer its card holds, in characters. */
export const CARD_LIMIT = 500;

/** How many parts of the CV the offers of a message share between them. */
export const MAX_EVIDENCE = 8;

/** The most the preferences a host sends may come to, in characters. */
export const PREFERENCES_LIMIT = 2_000;

/** The reaches a message may ask for. */
export const REACHES = ['free', 'selected'] as const;
export type Reach = (typeof REACHES)[number];

/** The modes of `auto`. */
export const AUTOS = ['off', 'suggest', 'on'] as const;
export type Auto = (typeof AUTOS)[number];

/** What a message that does not fit is to do. */
export const OVERFLOWS = ['refuse', 'compact'] as const;
export type Overflow = (typeof OVERFLOWS)[number];

const refsSchema = (limit: number, message: string) => z
  .array(z.string().min(1).max(1_024))
  .max(limit, message)
  .refine((refs) => refs.every((ref) => isRef(ref)), 'Each piece is named by its address, such as cv:<id>/experience/<key>.')
  // A piece is named and not a version of it, as in a selection: the text sent is
  // the piece as the document holds it now, and an address that said otherwise
  // would be promising a copy that is not made.
  .refine(
    (refs) => refs.every((ref) => !isRef(ref) || (parseRef(ref).version === undefined && parseRef(ref).digest === undefined)),
    'A piece is named and not a version of it: leave off the @version and the #digest.'
  )
  // Held in canonical form and once each, so the input a run is stored with is
  // the same whichever way the host spelled the address or however often it did.
  .transform((refs) => [...new Set(refs.map((ref) => refKey(parseRef(ref))))]);

const onceSchema = refsSchema(MAX_ONCE, `At most ${MAX_ONCE} pieces may be attached to one message.`).default([]);

// A piece that was sent whole is one the person named, so it is held to what an
// attachment is: the same count, the same spelling.
const fullSchema = refsSchema(MAX_ONCE, `At most ${MAX_ONCE} pieces may be sent whole.`);

const offerIdsSchema = z
  .array(z.string().min(1).max(200))
  .max(MAX_OFFER_IDS, `At most ${MAX_OFFER_IDS} offers may be named in one message.`)
  // Once each and in the order the host named them, whatever it sent.
  .transform((ids) => [...new Set(ids)]);

/**
 * The `grounding` field of a capability's input. Absent is a message that asks
 * for none of this, and is run exactly as it was before the field existed.
 */
export const groundingSchema = z
  .object({
    once: onceSchema,
    reach: z.enum(REACHES).default('free'),
    auto: z.enum(AUTOS).default('off'),
    // None of these has a default, so a message that does not use them is
    // stored and planned with the fields it always had.
    offerIds: offerIdsSchema.optional(),
    preferences: z.string().max(PREFERENCES_LIMIT, `Preferences come to at most ${PREFERENCES_LIMIT} characters.`).optional(),
    cite: z.boolean().optional(),
    overflow: z.enum(OVERFLOWS).optional(),
    full: fullSchema.optional()
  })
  .optional();

export type GroundingInput = NonNullable<z.infer<typeof groundingSchema>>;
