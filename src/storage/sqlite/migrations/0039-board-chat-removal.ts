/**
 * The board keeps no conversation.
 *
 * The board is where an application is worked on step by step, each step with
 * its inputs, its result and its retry, so a question about an offer belongs to
 * a pipeline step and not to a chat beside it. The board chat was served and
 * never shown, and its messages had no other reader. Its index goes with it.
 */
export const boardChatRemoval0039 = /* sql */ `
DROP TABLE board_chat_messages;
`;
