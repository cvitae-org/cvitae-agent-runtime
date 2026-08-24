/**
 * The mailbox client.
 *
 * Deliberately not re-exported from `src/index.ts`: `createRuntime` is the
 * surface cvitae imports, and putting a draft function on it invites calling one
 * from wherever a capability result is handled. Reaching for this should mean
 * importing `mail/` on purpose.
 */

export {
  createDraft,
  isMailEnabled,
  mailHealth,
  searchMail,
  sendMail,
  type DraftCreated,
  type MailAttachment,
  type MailHeaderSummary,
  type MailHealth,
  type MailOutcome,
  type MessageSent,
  type OutgoingMessage
} from './client.js';
