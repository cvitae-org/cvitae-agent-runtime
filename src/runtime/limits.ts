/**
 * What a person has set as the most the material of a message may come to, and
 * what it says now.
 *
 * The store keeps and checks the amount. This is the half a host asks: the
 * numbers it needs to draw a setting (where the floor and the ceiling are, what
 * each part is held to without one) next to what is set, and the one limit a
 * conversation lives under, so that a window does not work that out for itself
 * and disagree with the runtime.
 */

import type { ConversationStore, LimitStore } from '../contracts/index.js';
import { BASELINE, CONTEXT_CEILING, CONTEXT_FLOOR } from '../context/limits.js';

export type LimitView = {
  /** What each part of a message is held to before anything is set. */
  readonly baseline: typeof BASELINE;
  readonly floor: number;
  readonly ceiling: number;
  /** The setting for everything, or `null` when there is none. */
  readonly global: number | null;
  /** The conversation's own, or `null` when it has none or none was asked about. */
  readonly conversation: number | null;
  /** What binds: the conversation's own, else the global one, else `null` for no limit beyond the baseline. */
  readonly effective: number | null;
};

export type LimitService = {
  /** `undefined` when a conversation was named and there is no such one. */
  get(conversationId?: string): LimitView | undefined;
  /**
   * Sets a limit, or removes it with `null`. Throws `invalid_limit` outside the
   * floor and the ceiling. `undefined` when a conversation was named and there is
   * no such one. The view returned is what is now set.
   */
  set(conversationId: string | undefined, context: number | null): LimitView | undefined;
};

export type LimitDeps = {
  readonly store: LimitStore;
  readonly conversations: Pick<ConversationStore, 'read'>;
};

export const createLimitService = (deps: LimitDeps): LimitService => {
  const view = (conversationId: string | undefined): LimitView => {
    const { global, conversation } = deps.store.read(conversationId);
    return {
      baseline: BASELINE,
      floor: CONTEXT_FLOOR,
      ceiling: CONTEXT_CEILING,
      global: global ?? null,
      conversation: conversation ?? null,
      effective: conversation ?? global ?? null
    };
  };
  const missing = (conversationId: string | undefined): boolean =>
    conversationId !== undefined && deps.conversations.read(conversationId) === undefined;

  return {
    get: (conversationId) => (missing(conversationId) ? undefined : view(conversationId)),

    set: (conversationId, context) => {
      if (missing(conversationId)) return undefined;
      deps.store.set(conversationId, context ?? undefined);
      return view(conversationId);
    }
  };
};
