/**
 * What a message may ask of the pieces a model is given, and how much of them.
 *
 * Three things a host can say with a message, beside the question:
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

/** The reaches a message may ask for. */
export const REACHES = ['free', 'selected'] as const;
export type Reach = (typeof REACHES)[number];

/** The modes of `auto`. */
export const AUTOS = ['off', 'suggest', 'on'] as const;
export type Auto = (typeof AUTOS)[number];

const onceSchema = z
  .array(z.string().min(1).max(1_024))
  .max(MAX_ONCE, `At most ${MAX_ONCE} pieces may be attached to one message.`)
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
  .transform((refs) => [...new Set(refs.map((ref) => refKey(parseRef(ref))))])
  .default([]);

/**
 * The `grounding` field of a capability's input. Absent is a message that asks
 * for none of this, and is run exactly as it was before the field existed.
 */
export const groundingSchema = z
  .object({
    once: onceSchema,
    reach: z.enum(REACHES).default('free'),
    auto: z.enum(AUTOS).default('off')
  })
  .optional();

export type GroundingInput = NonNullable<z.infer<typeof groundingSchema>>;
