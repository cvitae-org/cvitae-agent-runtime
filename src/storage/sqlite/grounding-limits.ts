/**
 * `LimitStore` over SQLite.
 *
 * A limit is checked here and not in the table alone, because a refused amount
 * has to say why in words (`invalid_limit`), and the table's CHECK can only say
 * that it failed.
 */

import { OperationError } from '../../contracts/index.js';
import type { LimitStore } from '../../contracts/index.js';
import { CONTEXT_CEILING, CONTEXT_FLOOR, isLimit } from '../../context/limits.js';
import type { Db } from './open.js';

export const createLimitStore = (db: Db): LimitStore => {
  const globalOf = db.prepare('SELECT context FROM grounding_limit WHERE id = 1');
  const setGlobal = db.prepare<[number]>(
    `INSERT INTO grounding_limit (id, context) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET context = excluded.context`
  );
  const clearGlobal = db.prepare('DELETE FROM grounding_limit WHERE id = 1');

  const ownOf = db.prepare<[string]>('SELECT context FROM grounding_conversation_limit WHERE conversation_id = ?');
  const setOwn = db.prepare<[string, number]>(
    `INSERT INTO grounding_conversation_limit (conversation_id, context) VALUES (?, ?)
     ON CONFLICT (conversation_id) DO UPDATE SET context = excluded.context`
  );
  const clearOwn = db.prepare<[string]>('DELETE FROM grounding_conversation_limit WHERE conversation_id = ?');
  const exists = db.prepare<[string]>('SELECT 1 FROM conversations WHERE id = ?');

  const readGlobal = (): number | undefined => (globalOf.get() as { context: number } | undefined)?.context;
  const readOwn = (conversationId: string): number | undefined =>
    (ownOf.get(conversationId) as { context: number } | undefined)?.context;

  return {
    // Its own, and the global one only when it has none: a conversation that set
    // a limit above the global one has set it, and is not held to the lower.
    effective: (conversationId) => readOwn(conversationId) ?? readGlobal(),

    read: (conversationId) => {
      const global = readGlobal();
      const conversation = conversationId === undefined ? undefined : readOwn(conversationId);
      return {
        ...(global === undefined ? {} : { global }),
        ...(conversation === undefined ? {} : { conversation })
      };
    },

    set: (conversationId, context) => {
      if (context !== undefined && !isLimit(context)) {
        throw new OperationError(
          'invalid_limit',
          `A limit is a whole number of characters from ${CONTEXT_FLOOR} to ${CONTEXT_CEILING}.`
        );
      }

      db.transaction(() => {
        if (conversationId === undefined) {
          if (context === undefined) clearGlobal.run();
          else setGlobal.run(context);
          return;
        }
        if (exists.get(conversationId) === undefined) {
          throw new OperationError('not_found', `No such conversation: ${conversationId}`);
        }
        if (context === undefined) clearOwn.run(conversationId);
        else setOwn.run(conversationId, context);
      })();
    }
  };
};
