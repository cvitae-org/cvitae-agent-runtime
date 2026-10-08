/**
 * Saying what a chat run was given and what it read.
 *
 * Three channels end up in one record, and each does the part of the job it is in
 * a position to do exactly:
 *
 *   a step         names the input fields it sends to a model call (`sends`), and
 *                  the executor reports them as the call goes out
 *   a tool         says which pieces of its result it handed to the model and in
 *                  what form, since only the tool knows
 *   a port         says what was read through it, since nothing that reads is
 *                  asked to remember to
 *
 * The first two say `included`. A port can only say `read`: it sees that a
 * document or a passage left the store, not whether or in what form it reached a
 * model. Both statuses are in the record and the difference between them is the
 * point of having two.
 *
 * The record is per run, and a run with no conversation has none, so no sink is
 * built for it and the ports are left as they are. Everything here fails closed:
 * an entry that cannot be recorded, a field no address is known for, a store that
 * will not write, all throw, and the step that was about to send fails with them.
 * A run that cannot say what it sent does not send it.
 */

import { OperationError } from '../contracts/index.js';
import type {
  DocumentStore,
  RecordEntry,
  RecordSink,
  RecordStore,
  Retriever,
  SentField,
  SuppliedHistory
} from '../contracts/index.js';
import { CV_ID } from '../capabilities/cv/document.js';
import { storedCv, viewOf } from '../capabilities/cv/walls.js';
import { CV_WELL, cvHitEntries, cvWell, cvWholeEntry } from '../capabilities/cv/well.js';
import { OFFERS_WELL, offersWell, postingRef } from '../capabilities/offers/well.js';
import { createRecordBook, createWellRegistry, digest, formatRef } from '../grounding/index.js';
import type { RecordBook, WellDef, WellRegistry } from '../grounding/index.js';

export const CONVERSATION_WELL = 'conversation';

/**
 * What a chat itself carries into a model call. `history` and `summary` are what
 * the host sends with a message; `attached` is text the host attached to it that
 * names no saved thing, such as a posting pasted into a profile conversation.
 */
export const conversationWell: WellDef = {
  id: CONVERSATION_WELL,
  describe: 'A conversation. One scope per conversation. Sections: history, summary, attached.'
};

/** Declared so a selection can name it; nothing reads from it yet (preferences stay Studio-owned). */
export const preferencesWell: WellDef = {
  id: 'preferences',
  describe: 'The person\'s preferences. Declared and empty: nothing reads from it yet.'
};

export const defaultWells = (): WellRegistry =>
  createWellRegistry([cvWell, offersWell, preferencesWell, conversationWell]);

/** What a runtime needs to keep records. Absent means no run keeps one. */
export type Grounding = {
  readonly records: RecordStore;
  readonly wells: WellRegistry;
};

/** What the recorder is told about the run, all of it known before the first step. */
export type RecorderFacts = {
  readonly runId: string;
  readonly conversationId: string;
  readonly contextId?: string;
  /** The saved offer a snapshot run is about. Absent for a live run. */
  readonly offerId?: string;
  readonly input: Readonly<Record<string, unknown>>;
  /**
   * What the runtime put in `input` as the conversation, when the host sent none
   * (`runtime/history.ts`). Those fields are the runtime's own and are recorded
   * as such: one entry for each exchange, and one for the summary.
   */
  readonly supplied?: SuppliedHistory;
};

const conversationRef = (conversationId: string, section: string): string =>
  formatRef({ well: CONVERSATION_WELL, scope: conversationId, path: [section] });

/** One earlier answer of a conversation, with the question it answered, by the key of the answer. */
export const historyRef = (conversationId: string, key: string): string =>
  formatRef({ well: CONVERSATION_WELL, scope: conversationId, path: ['history', key] });

/**
 * The entry for one input field a step sent, or none when the field was empty
 * and so sent nothing.
 *
 * What each field is, and who supplied it, is settled here and not by the step. A
 * conversation's history and summary come from the host, so they are `client`
 * and the runtime does not vouch for them, unless the runtime kept the
 * conversation itself and supplied them (`supplied`). A posting is `server` when
 * a snapshot supplied it, and `client` when the host sent it with a live run.
 */
const sentEntries = (facts: RecorderFacts, sent: SentField): RecordEntry[] => {
  const value = facts.input[sent.field];
  const shown = sent.shown === undefined ? {} : { shown: digest(sent.shown) };
  const entry = (ref: string, origin: RecordEntry['origin']): RecordEntry[] => [
    { ref, digest: digest(value), ...shown, status: 'included', origin, via: 'input' }
  ];

  switch (sent.field) {
    case 'history':
      // The runtime's own, exchange by exchange: it read them from the
      // conversation, so it can say which they were and vouches for each.
      if (facts.supplied !== undefined) {
        return facts.supplied.exchanges.map((each) => ({
          ref: historyRef(facts.conversationId, each.key),
          digest: each.digest,
          status: 'included' as const,
          origin: 'server' as const,
          via: 'input'
        }));
      }
      return Array.isArray(value) && value.length > 0
        ? entry(conversationRef(facts.conversationId, 'history'), 'client')
        : [];

    case 'summary': {
      const given = facts.supplied?.summary;
      // The version is how far the note reaches: it is made from the messages up to there.
      if (given !== undefined) {
        return [
          {
            ref: conversationRef(facts.conversationId, 'summary'),
            version: String(given.through),
            digest: given.digest,
            ...shown,
            status: 'included',
            origin: 'server',
            via: 'input'
          }
        ];
      }
      return typeof value === 'string' && value.trim() !== ''
        ? entry(conversationRef(facts.conversationId, 'summary'), 'client')
        : [];
    }

    case 'offerText':
      if (typeof value !== 'string' || value.trim() === '') return [];
      return facts.offerId === undefined
        ? entry(conversationRef(facts.conversationId, 'attached'), 'client')
        : entry(postingRef(facts.offerId), 'server');

    default:
      throw new OperationError(
        'invalid_entry',
        `A step sends the input field ${JSON.stringify(sent.field)}, and nothing says what it addresses.`
      );
  }
};

/**
 * The sink for one run.
 *
 * It holds the entries the run has recorded, loaded from the store so a run that
 * continues after a pause does not record what it already did, and writes only
 * the new ones. The store would drop a repeat anyway; keeping them out here is
 * what stops a model that reads one item five times from asking the file five
 * times.
 *
 * Loaded on first use and not when the sink is made. A sink is made while a run
 * is being started, where a failure has nowhere to be recorded; the first use is
 * inside a step, where it fails the step like any other.
 */
export const createRecorder = (grounding: Grounding, facts: RecorderFacts): RecordSink => {
  let loaded: RecordBook | undefined;
  const book = (): RecordBook =>
    (loaded ??= createRecordBook(grounding.wells, grounding.records.read(facts.runId)?.entries ?? []));

  const scopes: Record<string, string> = { [CONVERSATION_WELL]: facts.conversationId };
  if (facts.contextId !== undefined) scopes[CV_WELL] = facts.contextId;
  if (facts.offerId !== undefined) scopes[OFFERS_WELL] = facts.offerId;

  const add = (entries: readonly RecordEntry[]): void => {
    try {
      const held = book();
      const before = held.entries().length;
      for (const entry of entries) held.add(entry);
      // New entries come last, in the order they were added, which is what `entries` promises.
      const fresh = held.entries().slice(before);
      if (fresh.length > 0) grounding.records.append(facts.runId, fresh);
    } catch (error) {
      // The book may now hold entries the store never accepted. Forget it, so the
      // next use starts from what the store has: a tool that failed here and is
      // asked again by the model must record what it hands over the second time.
      loaded = undefined;
      throw error;
    }
  };

  return {
    scopes,
    add,
    sent: (fields) => add(fields.flatMap((field) => sentEntries(facts, field))),
    // Straight to the store: counts are added up there, and there is nothing to
    // hold back here, since two calls that hold the same are two calls.
    masking: (count) => {
      grounding.records.addMasking(facts.runId, count);
    }
  };
};

/**
 * The documents port, saying each CV it hands out was read.
 *
 * Only a CV is a piece of a well so far. The photograph is a document too, and
 * is not recorded until a well names it. A body that does not parse is not
 * recorded either, and the reader that asked for it fails on it as it always did.
 */
export const recordingDocuments = (documents: DocumentStore, sink: RecordSink): DocumentStore => ({
  read: (id) => {
    const found = documents.read(id);
    const scope = sink.scopes[CV_WELL];

    if (found !== undefined && scope !== undefined) {
      // The piece is named by the document as stored, and what the model may see
      // of it is the document the port handed over: when they differ, the entry
      // says so by the digest of what was left.
      const view = viewOf(found);
      if (view !== undefined) {
        sink.add([
          cvWholeEntry(scope, found.revision, view.original, {
            status: 'read',
            via: 'port:documents',
            ...(view.walled ? { shown: view.shown } : {})
          })
        ]);
      }
    }

    return found;
  },
  update: (id, kind, mutate, options) => documents.update(id, kind, mutate, options)
});

/**
 * The retrieval port, saying each passage it returns was read.
 *
 * The passages are placed in the CV through the documents port beneath this one,
 * so placing them is not itself a read.
 */
export const recordingRetrieval = (
  retrieval: Retriever,
  documents: DocumentStore,
  sink: RecordSink
): Retriever => ({
  search: async (query, signal) => {
    const hits = await retrieval.search(query, signal);
    const scope = sink.scopes[CV_WELL];

    if (hits.length > 0 && scope !== undefined) {
      const found = documents.read(CV_ID);
      const cv = found === undefined ? undefined : storedCv(found);
      if (found !== undefined && cv !== undefined) {
        sink.add(
          cvHitEntries(scope, found.revision, cv, hits, { status: 'read', via: 'port:retrieval', passage: false })
        );
      }
    }

    return hits;
  }
});
