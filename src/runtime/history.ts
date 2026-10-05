/**
 * The conversation a run continues, kept by the runtime and not sent by the host.
 *
 * A host that sends `history` and `summary` with a message has decided what a
 * model sees of the conversation, and the runtime cannot say where any of it came
 * from: it may carry a piece the person has since excluded. A host that sends
 * neither leaves it to the runtime, which reads the conversation it stores, and
 * can then say what each turn was built from and leave out the ones that were
 * built from something now excluded.
 *
 * It applies to a run of a capability that is `recorded` and takes `history` and
 * `summary`, whose input carries neither. Everything else is what it was: the
 * host's history is used as sent, with the origin `client` it always had.
 *
 * What the model is given:
 *
 *   history   the settled exchanges after the summary, newest that fit, each an
 *             answer and the question it answered. Not an unanswered question, and
 *             not the run's own. Within the limits a host is held to (12 turns and
 *             6,000 characters)
 *   summary   the note the host stored with `conversations.summarise`
 *
 * What is held back, by the taint rule (`grounding/taint.ts`):
 *
 *   an exchange   whose answer was built from something that is excluded now, or
 *                 on an answer that was, however far back
 *   the summary   when any answer it was made from is withheld. It carries the
 *                 sense of those answers and cannot be cut into parts, so the
 *                 conversation goes without it until the host summarises again
 *
 * An answer is a unit, named by the run that wrote it (`run~<id>`) or, for one
 * with no run, by the message (`msg~<id>`). A record entry names the earlier
 * answers a run was given by those keys, which is how the rule follows the chain.
 *
 * Read when a run starts or resumes, and not again while it goes: the history
 * is one input of one step. An exclusion made while that step runs reaches what
 * the tools return at once, and the history on the next run or the next resume.
 */

import { HISTORY_BUDGET, HISTORY_TURNS } from '../context/conversation.js';
import type {
  CapabilityMap,
  ConversationRecords,
  ConversationStore,
  Message,
  PieceRef,
  RecordEntry,
  SuppliedHistory
} from '../contracts/index.js';
import { createTaint, digest, parseRef } from '../grounding/index.js';
import type { Source } from '../grounding/index.js';
import { CONVERSATION_WELL, historyRef } from './grounding.js';

export const RUN_KEY = 'run~';
export const MESSAGE_KEY = 'msg~';

export type HistoryDeps = {
  readonly conversations: Pick<ConversationStore, 'read'>;
  readonly records: ConversationRecords;
  /** What the conversation excludes now. */
  readonly walls: (conversationId: string) => readonly PieceRef[];
  readonly capabilities: CapabilityMap;
};

export type HistoryRequest = {
  readonly capability: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly input: Readonly<Record<string, unknown>>;
};

export type HistorySupplier = {
  /**
   * The input with the conversation put in, and what was put in. `undefined`
   * when the run keeps nothing of its own: the capability does not take the
   * conversation, the host sent one, or there is none to give.
   */
  supply(request: HistoryRequest): { readonly input: Readonly<Record<string, unknown>>; readonly supplied: SuppliedHistory } | undefined;
};

/** One answer, with the question it answered when it directly follows one. */
type Answer = {
  readonly key: string;
  readonly runId: string | undefined;
  readonly seq: number;
  readonly user: Message | undefined;
  readonly assistant: Message;
};

const answersOf = (messages: readonly Message[]): Answer[] =>
  messages.flatMap((message, at) => {
    if (message.role !== 'assistant') return [];
    const before = messages[at - 1];
    // A question is the answer's when it sits right before it and does not belong
    // to another run. A host that stores the question before the run exists gives
    // it no run, and that is still its answer's question.
    const user =
      before?.role === 'user' && (before.runId === undefined || before.runId === message.runId) ? before : undefined;

    return [
      {
        key: message.runId === undefined ? `${MESSAGE_KEY}${message.id}` : `${RUN_KEY}${message.runId}`,
        runId: message.runId,
        seq: message.seq,
        user,
        assistant: message
      }
    ];
  });

const unknown: Source = { known: false };

const settled = (text: string): boolean => text.trim() !== '';

export const createHistory = (deps: HistoryDeps): HistorySupplier => ({
  supply: ({ capability, conversationId, runId, input }) => {
    if (deps.capabilities[capability]?.recorded !== true) return undefined;

    // The host's own, when it sent any. A summary of blanks is no summary.
    const { history, summary } = input;
    if (!Array.isArray(history) || history.length > 0) return undefined;
    if (typeof summary !== 'string' || settled(summary)) return undefined;

    const found = deps.conversations.read(conversationId);
    if (found === undefined) return undefined;

    const answers = answersOf(found.messages);
    const folded = found.conversation.summarisedThrough;
    const walls = deps.walls(conversationId);

    const byRun = new Map(deps.records.byConversation(conversationId).map((each) => [each.record.runId, each]));
    const source = (key: string): Source => {
      if (!key.startsWith(RUN_KEY)) return unknown;
      const each = byRun.get(key.slice(RUN_KEY.length));
      if (each === undefined || each.record.state !== 'closed') return unknown;
      if (each.capability === undefined || deps.capabilities[each.capability]?.recorded !== true) return unknown;
      return { known: true, entries: each.record.entries };
    };

    /** The answers an entry of a record carried into the run it belongs to. */
    const carried = (entry: RecordEntry): string[] => {
      const ref = parseRef(entry.ref);
      if (ref.well !== CONVERSATION_WELL || ref.scope !== conversationId) return [];
      const [section, item] = ref.path;

      if (section === 'history' && item !== undefined) return [item];
      if (section === 'summary') {
        // Made from every message up to the version it names. One that names no
        // version is taken to be made from them all: not knowing is not a reason
        // to hand it over.
        const named = /^\d+$/.test(entry.version ?? '');
        const through = Number(entry.version);
        return answers.filter((each) => !named || each.seq <= through).map((each) => each.key);
      }
      return [];
    };

    const withheld = createTaint({ walls, source, carried });

    const note = found.conversation.summary ?? '';
    const noteShown = settled(note) && !answers.some((each) => each.seq <= folded && withheld(each.key));

    const fits = (each: Answer): boolean => {
      try {
        historyRef(conversationId, each.key);
        return true;
      } catch {
        // An address the record cannot hold is an answer the record cannot name.
        return false;
      }
    };

    const candidates = answers.filter(
      (each): each is Answer & { user: Message } =>
        each.user !== undefined &&
        each.user.seq > folded &&
        each.runId !== runId &&
        settled(each.user.text) &&
        settled(each.assistant.text) &&
        fits(each) &&
        !withheld(each.key)
    );

    // Newest first, so that what does not fit is what is oldest. The first that
    // does not fit ends it: a hole in the middle of a conversation reads as a
    // conversation, and an older exchange left in behind it is no longer the one
    // the newer turns follow.
    const chosen: (typeof candidates)[number][] = [];
    let turns = 0;
    let characters = 0;
    for (const each of [...candidates].reverse()) {
      const size = each.user.text.length + each.assistant.text.length;
      if (turns + 2 > HISTORY_TURNS || characters + size > HISTORY_BUDGET) break;
      chosen.unshift(each);
      turns += 2;
      characters += size;
    }

    if (chosen.length === 0 && !noteShown) return undefined;

    const exchanges = chosen.map((each) => [
      { role: 'user' as const, text: each.user.text },
      { role: 'assistant' as const, text: each.assistant.text }
    ]);

    return {
      input: { ...input, history: exchanges.flat(), ...(noteShown ? { summary: note } : {}) },
      supplied: {
        exchanges: chosen.map((each, at) => ({ key: each.key, digest: digest(exchanges[at]) })),
        ...(noteShown ? { summary: { through: folded, digest: digest(note) } } : {})
      }
    };
  }
});
