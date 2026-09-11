import { CvContextError } from '../../contracts/index.js';
import type { Db } from './open.js';

/** Called inside the transaction that inserts the run or message. */
export const requireConversationContext = (db: Db, conversationId: string, contextId: string): void => {
  const conversation = db.prepare('SELECT subject_kind, subject_id FROM conversations WHERE id = ?')
    .get(conversationId) as { subject_kind: string; subject_id: string } | undefined;
  if (!conversation || conversation.subject_kind !== 'profile' || (conversation.subject_id || 'cv') !== contextId) {
    throw new CvContextError('context_conflict', 'Conversation does not belong to this CV context.');
  }
};
