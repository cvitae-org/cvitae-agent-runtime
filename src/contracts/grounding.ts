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
 * Later steps add values (`compact`, `omitted`, `blocked`). A reader that meets
 * a status it does not know must treat the entry as one that did not reach the
 * model.
 */
export const ENTRY_STATUSES = ['included', 'read'] as const;
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
