/**
 * Somewhere for a conversation to remember what fell off the end of it.
 *
 * The client sends the last few turns with each question, which is what makes a
 * follow-up a follow-up. What it cannot do is send all of them: a transcript
 * grows without limit and a context window does not, so past a handful of
 * exchanges the oldest turns stop being sent — and the model is back to
 * answering as if the conversation had just started, only later and less
 * obviously.
 *
 * So the turns that fall out are folded into a note, and the note is sent in
 * front of the ones that remain. Two columns:
 *
 *   `summary` is the note. Prose with headings, written by a model and read by
 *   one, and deliberately *not* structured into columns of its own — "what they
 *   rejected and why" is a sentence, and a schema over it would be a schema
 *   over the parts of a sentence.
 *
 *   `summarised_through` is how far it reaches: the `seq` of the last message
 *   folded in. Because `seq` is gapless and starts at 1, that number is also
 *   the count of messages folded in, which is what lets a client maintain it
 *   from an ordered read without ever handling a `seq` — the two readings are
 *   the same number and cannot drift apart.
 *
 * `0` rather than NULL for a conversation nothing has folded yet, because every
 * arithmetic use of this column is a comparison against a message's `seq`, and
 * NULL compares false to all of them.
 *
 * What is deliberately not here: a history of notes. The note is a rolling
 * state, and the turns behind it are still in `messages` — the version of the
 * note as it stood eight turns ago is derivable from those and is not worth a
 * row apiece. And no `summarised_at`: the marker says what it covers, which is
 * the question anybody asks, and when it was written is the run's own row.
 */

export const conversationNote0008 = /* sql */ `

ALTER TABLE conversations ADD COLUMN summary TEXT;

ALTER TABLE conversations ADD COLUMN summarised_through INTEGER NOT NULL DEFAULT 0;
`;
