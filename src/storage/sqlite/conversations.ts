/**
 * `ConversationStore` over SQLite.
 *
 * Two things here are transactions rather than statements, and both for the
 * same reason the event log's `seq` is assigned inside one: a number read and
 * then written is only correct while nothing else can write in between.
 *
 * `open` is a select-then-insert. Since 0007 there is no unique index to catch
 * a lost race, so the transaction is what stops two callers resuming the same
 * subject from creating two conversations and each seeing only its own. It is
 * `immediate` for that reason: a deferred transaction takes its read lock
 * first and would let both callers past the select.
 *
 * `create` is a bare insert and needs none of that. Two people pressing New
 * chat at once should get two conversations; that is the outcome, not the race.
 *
 * `append` assigns `seq` from `max(seq) + 1` and bumps the conversation, and
 * those two writes must not be separable: a message with no bump would sit in a
 * conversation that claims it has not changed, and a bump with no message would
 * reorder a list on the strength of nothing.
 */

import { CvContextError } from '../../contracts/index.js';
import { requireConversationContext } from './context-ownership.js';
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
  offer_snapshot_id?: string | null;
  id: string;
  subject_kind: string;
  subject_id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  message_count: number;
  summary: string | null;
  summarised_through: number;
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
  ...(row.offer_snapshot_id ? { offerSnapshotId: row.offer_snapshot_id } : {}),
  subject: { kind: row.subject_kind as ConversationSubjectKind, id: row.subject_id },
  title: row.title ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  messageCount: row.message_count,
  summary: row.summary ?? undefined,
  summarisedThrough: row.summarised_through
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
  SELECT c.*, (SELECT id FROM offer_snapshots s WHERE s.conversation_id = c.id) AS offer_snapshot_id, (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
    FROM conversations c
`;

export const createConversationStore = (
  db: Db,
  now: () => number = Date.now,
  newId: () => string = randomUUID
): ConversationStore => {
  const listAll = db.prepare<[]>(`${SELECT} ORDER BY c.updated_at DESC`);
  const byId = db.prepare<[string]>(`${SELECT} WHERE c.id = ?`);

  // Both orderings are the index's own: (subject_kind, subject_id,
  // updated_at DESC) answers the filter and the sort in one seek, which is why
  // 0007 kept a column it no longer needs for uniqueness.
  const listOfSubject = db.prepare<[string, string]>(
    `${SELECT} WHERE c.subject_kind = ? AND c.subject_id = ? ORDER BY c.updated_at DESC`
  );
  const latestOfSubject = db.prepare<[string, string]>(
    `${SELECT} WHERE c.subject_kind = ? AND c.subject_id = ?
      AND NOT EXISTS (SELECT 1 FROM offer_snapshots s WHERE s.conversation_id = c.id)
      ORDER BY c.updated_at DESC LIMIT 1`
  );

  const insert = db.prepare<[string, string, string, number, number]>(
    `INSERT INTO conversations (id, subject_kind, subject_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
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

  // `max(summarised_through, ?)` in the statement rather than a read followed by
  // a compare, so the marker cannot go backwards even between two writers — and
  // so the guarantee lives in the one place that does the writing.
  const note = db.prepare<[string | null, number, string]>(
    `UPDATE conversations
        SET summary = ?, summarised_through = max(summarised_through, ?)
      WHERE id = ?`
  );

  // Built from what was written rather than read back. Every field of a row
  // this new is known here, and a select would only be asking SQLite to confirm
  // the insert that just succeeded.
  const checkedSubject = (subject: ConversationSubject): ConversationSubject => {
    if (subject.kind !== 'profile' || subject.id === '') return subject;
    if (!db.prepare('SELECT id FROM cv_contexts WHERE id = ?').get(subject.id)) {
      throw new CvContextError('context_not_found', `No such CV context: ${subject.id}`);
    }
    // Keep legacy rows/clients intact. The explicit cv ID addresses their bucket.
    return subject.id === 'cv' ? { kind: 'profile', id: '' } : subject;
  };
  const start = (subject: ConversationSubject): Conversation => {
    const at = now();
    const id = newId();
    insert.run(id, subject.kind, subject.id, at, at);
    return {
      id,
      subject,
      createdAt: at,
      updatedAt: at,
      messageCount: 0,
      summarisedThrough: 0
    };
  };

  const openSubject = db.transaction((subject: ConversationSubject): Conversation => {
    const found = latestOfSubject.get(subject.kind, subject.id) as
      | ConversationRow
      | undefined;
    return found ? toConversation(found) : start(subject);
  }).immediate;

  const appendMessage = db.transaction(
    (
      conversationId: string,
      message: { role: MessageRole; text: string; runId?: string | undefined; id?: string | undefined }
    ): Message => {
      if (message.runId !== undefined) {
        const snapshot = db.prepare('SELECT id FROM offer_snapshots WHERE conversation_id = ?').get(conversationId) as { id: string } | undefined;
        const run = db.prepare('SELECT context_id, conversation_id, offer_snapshot_id FROM runs WHERE id = ?').get(message.runId) as
          { context_id: string | null; conversation_id: string | null; offer_snapshot_id: string | null } | undefined;
        if (snapshot && (!run || run.offer_snapshot_id !== snapshot.id)) {
          throw new CvContextError('context_conflict', 'Run does not belong to this snapshot.');
        }
        if (run) {
          if (run.conversation_id !== null && run.conversation_id !== conversationId) {
            throw new CvContextError('context_conflict', 'Run belongs to another conversation.');
          }
          const conversation = byId.get(conversationId) as ConversationRow | undefined;
          if (!run.offer_snapshot_id && (run.context_id !== null || conversation?.subject_kind === 'profile')) {
            requireConversationContext(db, conversationId, run.context_id ?? 'cv');
          }
        }
      }
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
    list: (subject) => {
      const checked = subject ? checkedSubject(subject) : undefined;
      return ((checked ? listOfSubject.all(checked.kind, checked.id) : listAll.all()) as ConversationRow[]).map(toConversation);
    },

    open: (subject) => openSubject(checkedSubject(subject)),

    create: db.transaction((subject: ConversationSubject) => start(checkedSubject(subject))).immediate,

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

    summarise(id, summary, through) {
      // Blank clears it, matching `rename`: a note trimmed to nothing is a
      // conversation with nothing carried, not one carrying an empty string
      // that a prompt would go on labelling and sending.
      note.run(summary.trim() || null, Math.max(0, Math.trunc(through)), id);
      const row = byId.get(id) as ConversationRow | undefined;
      return row ? toConversation(row) : undefined;
    },

    delete: (id) => remove.run(id).changes > 0
  };
};
