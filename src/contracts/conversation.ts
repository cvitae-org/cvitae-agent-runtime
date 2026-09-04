/**
 * A transcript that outlives the window it was typed into.
 *
 * The shape follows the client's own model rather than generalising past it.
 * Chat there is keyed by a sealed subject — the profile, or one offer — so a
 * conversation is *about* something, and there can be several about the same
 * thing: rewriting a summary and working out what to say about a two-year gap
 * are different conversations even though both are about one CV.
 *
 * Two front doors, and the difference between them is the whole of the model.
 * [open] resumes — the most recently active conversation about a subject, or a
 * first one when there are none — and is what a window restores to. [create]
 * always creates, and is the New chat button. Neither is the other's default
 * argument: a `create` that sometimes returns something it did not create is a
 * name that lies about half its outcomes, and an `open` that always started a
 * fresh page would lose the transcript every time the app was launched.
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
 * The profile's id is the empty string rather than `undefined`, so that a
 * subject is always a pair and the index over it never has to reason about
 * NULLs — which in SQLite compare unequal to each other and would put every
 * profile conversation in a bucket of its own.
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
  /** Most recently active first; every subject's when given none. */
  list(subject?: ConversationSubject): readonly Conversation[];
  /**
   * The most recently active conversation about this subject, or a new one when
   * there are none. Resuming, not starting.
   */
  open(subject: ConversationSubject): Conversation;
  /** A further conversation about this subject, always a new one. */
  create(subject: ConversationSubject): Conversation;
  read(id: string): { readonly conversation: Conversation; readonly messages: readonly Message[] } | undefined;
  /** Appends and bumps the conversation's `updatedAt`, in one transaction. */
  append(conversationId: string, message: NewMessage): Message;
  /** `undefined` when there is no such conversation. Blank clears the title. */
  rename(id: string, title: string): Conversation | undefined;
  /** Whether there was one. Its messages go with it. */
  delete(id: string): boolean;
}
