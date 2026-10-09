/**
 * What a discovery conversation excludes, and which of its turns that reaches.
 *
 * A discovery conversation excludes whole saved offers (`offers:<id>`). A turn
 * that is accepted while one is excluded leaves it out of its scope
 * (`discovery-chat.ts`). This file is the other half: an answer written before
 * the offer was excluded may still carry it, and the history a new question is
 * given must not hand that answer back.
 *
 * A turn is withheld when
 *
 *   - its scope held an excluded offer (`discovery_turn_members`, widened by what
 *     the turn collected), or
 *   - it was given the answer of a turn that is withheld, as history or as the
 *     references of the previous answer (`historyRuns` in its stored context).
 *     The taint is followed down the chain, however many turns back.
 *
 * Which offers a turn could have drawn on is its scope, not the wording of its
 * answer: an aggregate carries every offer it was computed over without naming
 * one, so an answer is not cleared by not mentioning the offer.
 *
 * What cannot be told is withheld as long as anything at all is excluded: not
 * knowing is not a reason to hand it over.
 *
 *   - a message that belongs to no run, and a run the store has no turn for
 *     (the run was deleted, or the turn never was)
 *   - a turn made before turns were traced (`traced = 0`) that collected offers:
 *     the offers it collected were not written down
 *   - for such an older turn, what it was given as history was not written down
 *     either, so it is taken to have been given the `WINDOW` messages before its
 *     question. That errs on the side of withholding.
 */

import type { PieceRef } from '../../contracts/index.js';
import type { Db } from './open.js';

/** The messages before a question that its model is given as history. */
export const WINDOW = 6;

export const OFFERS = 'offers';

/**
 * The offers a set of walls excludes. A wall on any part of an offer excludes the
 * offer: the discovery chat reads an offer whole, and nothing in it is cut in
 * part.
 */
export const excludedOffers = (walls: readonly PieceRef[]): ReadonlySet<string> =>
  new Set(walls.filter((wall) => wall.well === OFFERS).map((wall) => wall.scope));

type Message = { readonly runId: string | null };
type Turn = { readonly runId: string; readonly traced: number; readonly collected: number; readonly given: string | null };

/**
 * The runs of a conversation whose answers are withheld, given what it excludes.
 * Empty when it excludes nothing: with nothing excluded every answer is as it
 * was.
 */
export const withheldRuns = (
  db: Db,
  conversationId: string,
  walls: readonly PieceRef[]
): ReadonlySet<string> => {
  const held = new Set<string>();
  if (walls.length === 0) return held;

  const messages = db
    .prepare('SELECT run_id AS runId FROM messages WHERE conversation_id=? ORDER BY seq')
    .all(conversationId) as Message[];

  const turns = new Map(
    (
      db
        .prepare(
          `SELECT run_id AS runId, traced,
                  json_extract(evidence,'$.collection') IS NOT NULL AS collected,
                  json_extract(evidence,'$.historyRuns') AS given
           FROM discovery_chat_turns WHERE conversation_id=?`
        )
        .all(conversationId) as Turn[]
    ).map((turn) => [turn.runId, turn])
  );

  const reached = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT m.run_id AS runId
           FROM discovery_turn_members m JOIN discovery_chat_turns t ON t.run_id=m.run_id
           WHERE t.conversation_id=? AND m.offer_id IN (SELECT value FROM json_each(?))`
        )
        .all(conversationId, JSON.stringify([...excludedOffers(walls)])) as { runId: string }[]
    ).map((row) => row.runId)
  );

  // Where each run's first message sits, for a turn that did not write down what it was given.
  const first = new Map<string, number>();
  messages.forEach((message, at) => {
    if (message.runId !== null && !first.has(message.runId)) first.set(message.runId, at);
  });

  const settled = new Map<string, boolean>();
  const visiting = new Set<string>();

  const decide = (run: string): boolean => {
    const known = settled.get(run);
    if (known !== undefined) return known;

    // A turn cannot have been given its own answer, so a record that says it was
    // has nothing to trace: withheld, and not looped on.
    if (visiting.has(run)) return true;
    visiting.add(run);

    const turn = turns.get(run);
    let result: boolean;
    if (turn === undefined || (turn.traced === 0 && turn.collected === 1) || reached.has(run)) {
      result = true;
    } else {
      // What the turn was given as history. An older turn did not say.
      const at = first.get(run);
      const given: readonly (string | null)[] =
        turn.traced === 1
          ? (JSON.parse(turn.given ?? '[]') as (string | null)[])
          : at === undefined
            ? [null]
            : messages.slice(Math.max(0, at - WINDOW), at).map((each) => each.runId);
      result = given.some((each) => each === null || decide(each));
    }

    visiting.delete(run);
    settled.set(run, result);
    return result;
  };

  // In the order the conversation was had, so that what a turn was given is
  // already worked out when it is asked about. Turns whose messages are gone follow.
  for (const message of messages) if (message.runId !== null && decide(message.runId)) held.add(message.runId);
  for (const run of turns.keys()) if (decide(run)) held.add(run);

  return held;
};
