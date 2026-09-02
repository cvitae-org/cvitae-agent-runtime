/**
 * A transcript that outlives the window it was typed into.
 *
 * The shape follows the client's own model rather than generalising past it.
 * Chat there is keyed by a sealed subject — the profile, or one offer — so a
 * conversation is identified by what it is *about*, and the store's front door
 * is `open`, which returns the one for a subject and creates it if this is the
 * first question. A `create` that sometimes does not create would be the same
 * function with a name that lies about half its outcomes.
 *
 * Two roles and no others. A run's timeline, a failure notice and a streaming
 * caret are all renderings of state that lives elsewhere — in `events`, in the
 * run's row — and a copy of a rendering is a copy that can disagree with what
 * it renders. `runId` is the link back, carried on both halves of an exchange
 * so a reloaded transcript can find the steps and the outcome of a run whose
 * result it does not repeat.
 */

export type ConversationSubjectKind = 'profile' | 'offer';

/**
 * What a conversation is about.
 *
 * The profile's id is the empty string. Not `undefined`: the uniqueness
 * constraint that makes one subject mean one conversation does not apply to
 * NULLs in SQLite, so the one conversation guaranteed to exist would be the one
 * the constraint did not cover.
 */
export type ConversationSubject = {
  readonly kind: ConversationSubjectKind;
  readonly id: string;
};

export type Conversation = {
  readonly id: string;
  readonly subject: ConversationSubject;
  /** Absent until something names it. A client shows its own placeholder. */
  readonly title?: string | undefined;
  readonly createdAt: number;
  /** Bumped by an append, so a list ordered by it is ordered by activity. */
  readonly updatedAt: number;
  readonly messageCount: number;
};

export type MessageRole = 'user' | 'assistant';

export type Message = {
  readonly id: string;
  readonly conversationId: string;
  /** Per conversation, gapless, assigned on write. */
  readonly seq: number;
  readonly role: MessageRole;
  readonly text: string;
  /** The run this message belongs to, when it came from one. */
  readonly runId?: string | undefined;
  readonly createdAt: number;
};

export type NewMessage = {
  readonly role: MessageRole;
  readonly text: string;
  readonly runId?: string | undefined;
  /**
   * The client's id for a message it has already drawn.
   *
   * Supplied so an optimistically rendered message can be recognised as the row
   * it became. Generated here when absent, because a caller with nothing to
   * reconcile should not have to invent one.
   */
  readonly id?: string | undefined;
};

export interface ConversationStore {
  /** Most recently active first. */
  list(): readonly Conversation[];
  /** The conversation about this subject, created on first use. */
  open(subject: ConversationSubject): Conversation;
  read(id: string): { readonly conversation: Conversation; readonly messages: readonly Message[] } | undefined;
  /** Appends and bumps the conversation's `updatedAt`, in one transaction. */
  append(conversationId: string, message: NewMessage): Message;
  /** `undefined` when there is no such conversation. Blank clears the title. */
  rename(id: string, title: string): Conversation | undefined;
  /** Whether there was one. Its messages go with it. */
  delete(id: string): boolean;
}
