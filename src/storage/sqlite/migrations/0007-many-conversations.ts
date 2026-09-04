/**
 * More than one conversation about the same thing.
 *
 * [0006](./0006-conversations.ts) enforced one conversation per subject with a
 * unique index, and gave a reason: two rows for one subject would be a split
 * transcript, half of which the client had no way to navigate to. That reason
 * was about the client, not about the data, and the client has changed. It now
 * lists the conversations for a subject and lets someone pick one, so the
 * second row is reachable and the constraint is the thing standing in the way.
 *
 * The need is ordinary and predates the constraint: a person asking about their
 * CV is doing several unrelated things — rewriting a summary, working out what
 * to say about a gap, translating the whole thing — and a single unbounded
 * transcript makes each of those harder to read than it was to have. "Start
 * over" as the only way to get a clean page meant losing the last one.
 *
 * The index stays, minus the uniqueness, because the query it now serves is the
 * one the list makes: the conversations about this subject, most recent first.
 * `updated_at` is the third column so that ordering is read out of the index
 * rather than sorted after the fact.
 *
 * What is deliberately not changed: `subject_kind` still admits `profile` and
 * `offer` and nothing else. Widening a CHECK in SQLite means rebuilding the
 * table, and rebuilding this one means dropping it while `messages` holds a
 * cascading foreign key into it — the delete fires, and the migration that was
 * meant to add a word to a list takes the transcripts with it. That is worth
 * doing carefully on the day a third kind of subject exists. It is not worth
 * doing today for a value nothing writes.
 */

export const manyConversations0007 = /* sql */ `

DROP INDEX conversations_subject;

CREATE INDEX conversations_subject
    ON conversations(subject_kind, subject_id, updated_at DESC);
`;
