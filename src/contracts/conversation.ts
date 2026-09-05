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
  /**
   * What the turns that no longer fit came to, or absent while they all still
   * do. Written by whoever produced it; this store only keeps it.
   */
  readonly summary?: string | undefined;
  /**
   * How far [summary] reaches: the `seq` of the last message folded into it,
   * and `0` for a conversation nothing has folded yet.
   *
   * `seq` is gapless and starts at 1, so this is equally "how many messages
   * have been folded in" — which is why a client can maintain it from an
   * ordered read without ever handling a `seq`, and why the two readings can
   * never drift apart.
   */
  readonly summarisedThrough: number;
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
  /**
   * Records a note about the turns up to `through`, and how far it reaches.
   *
   * A write and only a write — nothing here produces a summary, the same way
   * [rename] does not invent a title. What makes one is a model call, and a
   * store that made model calls would be a store that can fail for reasons
   * nothing about storage explains.
   *
   * `through` only ever moves forward. A caller that has just summarised turns
   * 1–4 and one that raced it with 1–2 must not leave the marker at 2 with a
   * note covering four turns, because the two turns in between would then be
   * folded in twice and read as having been said twice.
   */
  summarise(id: string, summary: string, through: number): Conversation | undefined;
  /** Whether there was one. Its messages go with it. */
  delete(id: string): boolean;
}
