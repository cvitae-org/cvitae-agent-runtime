/**
 * Grounding: the vocabulary for what a chat run was given and what it read.
 *
 * Three stored formats live in this file and the one beside it, and they are
 * the API: the address a piece of data is named by (`PieceRef` and its string
 * form, written by `grounding/ref.ts`), the digest of a piece (`grounding/digest.ts`),
 * and the shape of a record (`RECORD_VERSION` and `GroundingRecord`). A host that
 * keeps a citation or a record outside this process depends on all three, so a
 * change to any of them is a new version and not an edit.
 *
 * Nothing here knows what a well holds. A well is a registered source of data
 * with sections and items; its id, how it keys its scopes and how it derives
 * item keys are its own business, which is what lets the engine run over any
 * source that has sections and items, a helpdesk as readily as anything else.
 */

/**
 * The address of one piece of a well, optionally pinned to a version.
 *
 * A selection (an exclusion, a pin) names a piece with no version, because it
 * follows the live revision. A record or a citation names the version it saw
 * and the digest of the piece at that version.
 */
export type PieceRef = {
  /** A registered well id, such as `tickets`. */
  readonly well: string;
  /** Which instance of the well. Opaque to the engine; each well says what it names. */
  readonly scope: string;
  /** Section, then item. Empty names the whole scope. At most two. */
  readonly path: readonly string[];
  /** The well's version when it was read. Absent for a selection. */
  readonly version?: string;
  /** Digest of the piece at that version. Absent for a selection. */
  readonly digest?: string;
};

/** Bumped only when the stored shape of a record changes incompatibly. */
export const RECORD_VERSION = 1;

/**
 * What a record knows about an entry.
 *
 *   included  was in the payload of a model call, or in a result handed to the
 *             model. The record can say exactly what.
 *   read      the run read it through a port. Whether, and in what form, it
 *             reached the model is not known.
 *
 *   blocked   something asked for the piece (a pin, an attachment) and an
 *             exclusion held it back. Nothing of it was read or sent, so its
 *             digest is the digest of its address and says nothing of the piece.
 *
 * Later steps add values (`compact`, `omitted`). A reader that meets a status it
 * does not know must treat the entry as one that did not reach the model.
 */
export const ENTRY_STATUSES = ['included', 'read', 'blocked'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/**
 * Who supplied the piece. `client` is whatever the host sent in a request, which
 * the runtime cannot vouch for and never claims to have read from a well.
 */
export const ENTRY_ORIGINS = ['server', 'client'] as const;
export type EntryOrigin = (typeof ENTRY_ORIGINS)[number];

export type RecordEntry = {
  /** Canonical address of the original, with no version and no digest. */
  readonly ref: string;
  /** The well's version when the piece was read, when the well has one. */
  readonly version?: string;
  /** Digest of the original at that version. */
  readonly digest: string;
  /** Digest of what the model received, only when that is not the whole original. */
  readonly shown?: string;
  readonly status: EntryStatus;
  readonly origin: EntryOrigin;
  /** The channel it arrived by: `input`, `tool:read_cv`, `port:documents`. */
  readonly via: string;
};

/**
 *   open         the run is working, or died before it could close this record
 *   suspended    the run is waiting for an approval; the record continues when the run does
 *   closed       the run ended; `outcome` says how
 *   interrupted  the process died mid-run; entries recorded before that stand,
 *                and the record may be missing what came after
 */
export const RECORD_STATES = ['open', 'suspended', 'closed', 'interrupted'] as const;
export type RecordState = (typeof RECORD_STATES)[number];

export const RECORD_OUTCOMES = ['succeeded', 'failed', 'cancelled'] as const;
export type RecordOutcome = (typeof RECORD_OUTCOMES)[number];

export type GroundingRecord = {
  readonly v: typeof RECORD_VERSION;
  readonly runId: string;
  readonly conversationId: string;
  readonly state: RecordState;
  /** Present exactly when `state` is `closed`. */
  readonly outcome?: RecordOutcome;
  readonly openedAt: number;
  /**
   * When the run ended; present for `closed` and `interrupted`. For an
   * interrupted record that is when the process was found gone, which is later
   * than when it died.
   */
  readonly closedAt?: number;
  /** In the order each was first recorded. */
  readonly entries: readonly RecordEntry[];
};

/**
 * Where records are kept.
 *
 * A record is opened when a run that belongs to a conversation is created, and
 * settled whenever the run's status changes, inside the transaction that writes
 * that change. So nobody opens or closes a record by hand, and no way for a run
 * to end can skip the settling: the run store is where every ending is written.
 * A run that belongs to no conversation has no record.
 */
export interface RecordStore {
  /**
   * Adds entries to a run's record in the order given, leaving out any entry
   * equal to one already there, and returns how many were new.
   *
   * Only an `open` record takes entries. One that is closed, interrupted or
   * parked for an approval does not change, and a run with no record takes
   * nothing; both return 0 and throw nothing, because the caller that meets
   * them is a late write from a run that has already ended.
   */
  append(runId: string, entries: readonly RecordEntry[]): number;

  read(runId: string): GroundingRecord | undefined;
}

/**
 * A record, with the capability of the run it belongs to.
 *
 * The capability is not part of the record, which is a stored format. It is what
 * tells an answer whose record can be trusted from one whose record cannot
 * (`Capability.recorded`). Absent when the run is no longer stored.
 */
export type ConversationRecord = {
  readonly record: GroundingRecord;
  readonly capability?: string;
};

/** The records of a conversation, for deciding what its earlier answers were built from. */
export interface ConversationRecords {
  /** Every record of the conversation, oldest first. */
  byConversation(conversationId: string): readonly ConversationRecord[];
}

/**
 * What the runtime put into a run's input in place of what a host would have
 * sent as `history` and `summary`: which earlier exchanges, and which summary.
 *
 * It is what the record is written from, so a later run can tell which earlier
 * answers an answer was built on, and the taint rule can follow the chain.
 */
export type SuppliedHistory = {
  /** The exchanges given as history, oldest first, by the key of each (`runtime/history.ts`). */
  readonly exchanges: readonly { readonly key: string; readonly digest: string }[];
  /** The summary given, and the `seq` of the last message it was made from. */
  readonly summary?: { readonly through: number; readonly digest: string };
};

/**
 * What a step says it sends to a model call, by the name of a field of the run's
 * input.
 *
 * A step that builds its prompt from input the host or the runtime supplied names
 * the fields it used, and the runtime records them as the call goes out. The step
 * knows what it sent and not where it came from, so what a name addresses, and
 * who supplied it, is the runtime's to resolve.
 */
export type SentField = {
  /** The name of a field of the run's input. */
  readonly field: string;
  /**
   * What the model received of the field, when that is not all of it. Absent
   * means the whole value. It is digested and never stored.
   */
  readonly shown?: unknown;
};

/**
 * What a `ground` step hands to the step after it: the blocks it rendered, and the
 * entries that say what is in them.
 *
 * Both are made by one function, so the record cannot say a piece was sent that
 * the text does not carry. The step that sends the text names the step that made
 * it (`Sends.groundedFrom`), and the entries are recorded as that call goes out,
 * which is the moment they become true.
 */
export type Grounded = {
  /** The blocks as the model reads them, with no heading. Empty when nothing was assembled. */
  readonly text: string;
  /**
   * The same blocks one by one, in the order `entries` has them, when a step asks to
   * number them for a citation. `text` is these joined, and a step that makes no
   * blocks of its own leaves this out.
   */
  readonly blocks?: readonly string[];
  /** One `included` entry for each piece in `text`, in the order its block comes. */
  readonly entries: readonly RecordEntry[];
  /** Refs asked for and held back by an exclusion. Already recorded as `blocked`. */
  readonly blocked: readonly string[];
  /** Refs asked for that nothing carries now: a renamed entry, or a document with no such section. */
  readonly gone: readonly string[];
  /** Refs the runtime would add, when `auto` is `suggest`. Never in `text`. */
  readonly suggested: readonly string[];
  /**
   * Refs that are in `text` in a shorter form, because the pieces did not fit and
   * the message asked for them to be shortened. Each has an entry whose `shown` is
   * the digest of the shorter form. Absent when nothing was shortened.
   */
  readonly compacted?: readonly string[];
  /** `failed` when `auto` was asked for and the search it needs did not answer. */
  readonly auto?: 'failed';
};

/** The key a `ground` step's value is kept under. */
export const GROUNDED = 'grounded';

/**
 * What a running step or tool uses to say what it was given or read.
 *
 * Present on a run's context only when the run belongs to a conversation, since
 * only such a run has a record. Everything added lands in that run's record and
 * nowhere else.
 */
export interface RecordSink {
  /** The scope of each well this run is bound to, by well id. */
  readonly scopes: Readonly<Record<string, string>>;
  /** Records entries in the order given, leaving out any that are already there. */
  add(entries: readonly RecordEntry[]): void;
  /** Records what a step is about to send to a model call. */
  sent(fields: readonly SentField[]): void;
}

/* ---------------------------------------------------------------- selections */

/**
 * What a person has asked for of a conversation's data: to leave something out,
 * and to keep something in every message.
 *
 * A selection names a piece by its address with no version and no digest, so it
 * follows the live revision: an edit to an excluded section does not lift the
 * exclusion, a new item added to it is covered too, and a pinned piece is sent as
 * it reads at the next message. The refs are held in their canonical text form,
 * which is what a host sends and what a wall is made from (`grounding/walls.ts`).
 *
 * An exclusion beats a pin. A pin the walls cover stays in the selection and is
 * not sent, and the host says it is blocked.
 */
export type Selection = {
  readonly conversationId: string;
  /**
   * Moves by one with every change that changes something, and starts at 0 for
   * a conversation nobody has selected anything in. A change is made against a
   * revision and refused when it is not the current one, so two windows cannot
   * silently overwrite each other.
   */
  readonly revision: number;
  /** Canonical refs, in the order they were excluded. */
  readonly exclude: readonly string[];
  /** Canonical refs, in the order they were pinned. */
  readonly pin: readonly string[];
};

export type SelectionChange = {
  /** The revision the caller last saw. */
  readonly expectedRevision: number;
  /** Refs to exclude. One already excluded is left as it is. */
  readonly exclude: readonly string[];
  /** Refs to stop excluding. One that is not excluded is left as it is. */
  readonly clear: readonly string[];
  /** Refs to pin. One already pinned is left as it is. Absent is none. */
  readonly pin?: readonly string[];
  /** Refs to stop pinning. One that is not pinned is left as it is. Absent is none. */
  readonly unpin?: readonly string[];
};

/** The most a conversation may exclude. A person with more than this has excluded the wrong level. */
export const MAX_EXCLUSIONS = 100;

/**
 * The most a conversation may pin. What a pin sends is bounded by a budget as
 * well (`context/ground.ts`); this bounds the list a person has to keep in view.
 */
export const MAX_PINS = 20;

/**
 * What a run may not reach, asked for at the moment of reaching.
 *
 * A function and not a list, so a run that waits for a person and is resumed
 * honours what was excluded while it waited. Present on a run's context only when
 * the run belongs to a conversation and the runtime keeps selections.
 */
export interface Walls {
  pieces(): readonly PieceRef[];
}

/**
 * What a run is to carry in every message of its conversation, asked for when the
 * message is prepared and not before, so a pin made while a run waited counts when
 * it goes on. Present on the same runs as `Walls`.
 */
export interface Pins {
  pieces(): readonly PieceRef[];
}

/**
 * The most that the material of one message may come to, in characters, asked for
 * when the message is prepared. Present on every run that belongs to a
 * conversation. `context()` is `undefined` when nothing limits the run beyond what
 * each part is held to already (`context/limits.ts`).
 */
export interface Limits {
  /** The limit this run's conversation lives under now. `undefined` when there is none. */
  context(): number | undefined;
}

/**
 * Where a person's maximum-context setting is kept: one for everything, and one
 * for a conversation that has its own (`/limit`).
 *
 * The amount is in characters, between the floor and the ceiling of
 * `context/limits.ts`, and the store refuses anything outside them. Absent means
 * no setting, and a conversation with none lives under the global one.
 */
export interface LimitStore {
  /** The limit the conversation lives under: its own, else the global one. */
  effective(conversationId: string): number | undefined;

  /** What is set, each on its own. `undefined` is not set. */
  read(conversationId?: string): { readonly global?: number; readonly conversation?: number };

  /**
   * Sets a limit, or removes it with `undefined`. Without a conversation it is the
   * global one. Throws `invalid_limit` outside the floor and the ceiling, and
   * `not_found` for a conversation that does not exist.
   */
  set(conversationId: string | undefined, context: number | undefined): void;
}

export interface SelectionStore {
  /** A conversation with nothing selected reads as revision 0 and no refs. */
  read(conversationId: string): Selection;

  /**
   * Applies a change when `expectedRevision` is the current one. Otherwise
   * nothing is written, `applied` is false and `selection` is what is current.
   * A change that changes nothing does not move the revision.
   *
   * The refs are stored as given: whether a conversation may exclude or pin them
   * is the caller's to have checked. Throws `selection_limit` when the result
   * would hold more than `MAX_EXCLUSIONS` exclusions or `MAX_PINS` pins.
   */
  change(
    conversationId: string,
    change: SelectionChange
  ): { readonly applied: boolean; readonly selection: Selection };

  /** The walls a run is to honour now, read from the file each time it is asked. */
  walls(conversationId: string): readonly PieceRef[];

  /** The pieces a run is to carry now, read from the file each time it is asked. */
  pins(conversationId: string): readonly PieceRef[];
}
