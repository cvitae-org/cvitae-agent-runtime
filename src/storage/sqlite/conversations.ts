/**
 * `ConversationStore` over SQLite.
 *
 * Two things here are transactions rather than statements, and both for the
 * same reason the event log's `seq` is assigned inside one: a number read and
 * then written is only correct while nothing else can write in between.
 *
 * `open` is a select-then-insert, and the insert can lose a race with another
 * connection opening the same subject. Rather than a lock held across the
 * whole thing, the insert is `ON CONFLICT DO NOTHING` followed by a re-read —
 * so the loser of the race gets the winner's row instead of an error about a
 * constraint the caller has no way to interpret.
 *
 * `append` assigns `seq` from `max(seq) + 1` and bumps the conversation, and
 * those two writes must not be separable: a message with no bump would sit in a
 * conversation that claims it has not changed, and a bump with no message would
 * reorder a list on the strength of nothing.
 */

import { randomUUID } from 'node:crypto';
import type {
  Conversation,
  ConversationStore,
  ConversationSubject,
  ConversationSubjectKind,
  Message,
  MessageRole
} from '../../contracts/index.js';
import type { Db } from './open.js';

type ConversationRow = {
  id: string;
  subject_kind: string;
  subject_id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  message_count: number;
};

type MessageRow = {
  conversation_id: string;
  seq: number;
  id: string;
  role: string;
  text: string;
  run_id: string | null;
  created_at: number;
};

const toConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  subject: { kind: row.subject_kind as ConversationSubjectKind, id: row.subject_id },
  title: row.title ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  messageCount: row.message_count
});

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  conversationId: row.conversation_id,
  seq: row.seq,
  role: row.role as MessageRole,
  text: row.text,
  runId: row.run_id ?? undefined,
  createdAt: row.created_at
});

/**
 * The count comes from a correlated subquery rather than a join.
 *
 * A `LEFT JOIN ... GROUP BY` would work and would also mean every column of the
 * conversation being carried through a grouping for the sake of one number. The
 * subquery is a seek on the messages primary key per row, and the list is a
 * handful of rows.
 */
const SELECT = /* sql */ `
  SELECT c.*, (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
    FROM conversations c
`;

export const createConversationStore = (
  db: Db,
  now: () => number = Date.now,
  newId: () => string = randomUUID
): ConversationStore => {
  const list = db.prepare<[]>(`${SELECT} ORDER BY c.updated_at DESC`);
  const byId = db.prepare<[string]>(`${SELECT} WHERE c.id = ?`);
  const bySubject = db.prepare<[string, string]>(
    `${SELECT} WHERE c.subject_kind = ? AND c.subject_id = ?`
  );

  const insert = db.prepare<[string, string, string, number, number]>(
    `INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (subject_kind, subject_id) DO NOTHING`
  );

  const messagesOf = db.prepare<[string]>(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq'
  );

  const nextSeq = db.prepare<[string]>(
    'SELECT coalesce(max(seq), 0) + 1 AS seq FROM messages WHERE conversation_id = ?'
  );

  const insertMessage = db.prepare<
    [string, number, string, string, string, string | null, number]
  >(
    `INSERT INTO messages (conversation_id, seq, id, role, text, run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const touch = db.prepare<[number, string]>(
    'UPDATE conversations SET updated_at = ? WHERE id = ?'
  );

  const retitle = db.prepare<[string | null, string]>(
    'UPDATE conversations SET title = ? WHERE id = ?'
  );

  const remove = db.prepare<[string]>('DELETE FROM conversations WHERE id = ?');

  const openSubject = db.transaction((subject: ConversationSubject): Conversation => {
    const at = now();
    // Insert first, ignore a conflict, then read. The read is what answers, so
    // the caller that lost the race and the caller that won it are told the
    // same thing about the same row.
    insert.run(newId(), subject.kind, subject.id, at, at);
    return toConversation(bySubject.get(subject.kind, subject.id) as ConversationRow);
  }).immediate;

  const appendMessage = db.transaction(
    (
      conversationId: string,
      message: { role: MessageRole; text: string; runId?: string | undefined; id?: string | undefined }
    ): Message => {
      const at = now();
      const { seq } = nextSeq.get(conversationId) as { seq: number };
      const id = message.id ?? newId();

      insertMessage.run(
        conversationId,
        seq,
        id,
        message.role,
        message.text,
        message.runId ?? null,
        at
      );
      touch.run(at, conversationId);

      return {
        id,
        conversationId,
        seq,
        role: message.role,
        text: message.text,
        runId: message.runId,
        createdAt: at
      };
    }
  ).immediate;

  return {
    list: () => (list.all() as ConversationRow[]).map(toConversation),

    open: (subject) => openSubject(subject),

    read(id) {
      const row = byId.get(id) as ConversationRow | undefined;
      if (!row) return undefined;

      return {
        conversation: toConversation(row),
        messages: (messagesOf.all(id) as MessageRow[]).map(toMessage)
      };
    },

    append: (conversationId, message) => appendMessage(conversationId, message),

    rename(id, title) {
      // Blank clears it rather than storing "", so a conversation whose name
      // was erased falls back to the client's placeholder instead of showing
      // an empty line where a title goes.
      retitle.run(title.trim() || null, id);
      const row = byId.get(id) as ConversationRow | undefined;
      return row ? toConversation(row) : undefined;
    },

    delete: (id) => remove.run(id).changes > 0
  };
};
