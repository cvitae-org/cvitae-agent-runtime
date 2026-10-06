/**
 * What a person may exclude from a conversation or pin to it, and what each of
 * them says now.
 *
 * The store keeps whatever refs it is given. This is the half that decides which
 * refs a conversation may exclude, and it decides by the one question that
 * matters: does something stand behind the wall? An exclusion the runtime cannot
 * enforce is worse than a refusal. The person sees a toggle switched off and the
 * model still reads the piece, so a ref is accepted only where a reader of that
 * piece is behind a wall.
 *
 * A pin is held to the same kind of rule: it is accepted where the runtime puts
 * the piece in front of the model (`capabilities/cv/assembly.ts`), which is a
 * section or an entry of the CV of a profile conversation, and nowhere else yet.
 * An exclusion beats a pin, and a pin an exclusion covers is reported `blocked`.
 *
 *   a profile conversation    the pieces of its own CV: the whole CV, a section,
 *                             an overview item, a list entry
 *   a discovery conversation  a whole saved offer, by its id
 *   an offer conversation     nothing yet: its posting and its CV are a captured
 *                             snapshot, and no reader of it is behind a wall
 *
 * Nothing names the preferences well: Studio owns them, and the runtime reads
 * none.
 *
 * Clearing is not held to the same rule. An exclusion that was allowed once and
 * names something no reader honours now must still be removable.
 */

import { OperationError } from '../contracts/index.js';
import type {
  ConversationStore,
  PieceRef,
  Selection,
  SelectionChange,
  SelectionStore
} from '../contracts/index.js';
import { CV_ID } from '../capabilities/cv/document.js';
import { CV_WELL, LIST_SECTIONS, OVERVIEW, OVERVIEW_ITEMS } from '../capabilities/cv/well.js';
import { OFFERS_WELL } from '../capabilities/offers/well.js';
import { isWalled, parseRef, refKey } from '../grounding/index.js';
import type { WellRegistry } from '../grounding/index.js';

/**
 * `live` when the piece is there now, `gone` when nothing carries that address
 * any more. A gone exclusion still holds, and excludes whatever is given that
 * address later; it is reported so that a host can tell a person their exclusion
 * no longer covers what they meant (a renamed entry has a new key). A gone pin
 * sends nothing until something carries that address again.
 */
export type SelectionState = 'live' | 'gone';

/** A pin is `blocked` while an exclusion covers it, whatever else is true of it. */
export type PinState = SelectionState | 'blocked';

export type SelectionView = {
  readonly revision: number;
  readonly exclusions: readonly { readonly ref: string; readonly state: SelectionState }[];
  readonly pins: readonly { readonly ref: string; readonly state: PinState }[];
};

export type SelectionRequest = {
  readonly expectedRevision: number;
  readonly exclude?: readonly string[];
  readonly clear?: readonly string[];
  readonly pin?: readonly string[];
  readonly unpin?: readonly string[];
};

export type SelectionService = {
  /** `undefined` when there is no such conversation. */
  get(conversationId: string): SelectionView | undefined;
  /**
   * `undefined` when there is no such conversation. `applied` is false when
   * `expectedRevision` was not the current one, and the view is then what is
   * current, for the caller to reload.
   */
  update(
    conversationId: string,
    request: SelectionRequest
  ): { readonly applied: boolean; readonly view: SelectionView } | undefined;
};

export type SelectionDeps = {
  readonly store: SelectionStore;
  readonly conversations: Pick<ConversationStore, 'read'>;
  readonly wells: WellRegistry;
  /** Whether the piece a ref names is there now. */
  readonly holds: (ref: PieceRef) => boolean;
};

const refuse = (message: string): never => {
  throw new OperationError('invalid_selection', message);
};

const isOverviewItem = (item: string): boolean => (OVERVIEW_ITEMS as readonly string[]).includes(item);
const isListSection = (section: string): boolean => (LIST_SECTIONS as readonly string[]).includes(section);

/** A CV ref a profile conversation about this CV may exclude, or why not. */
const checkCv = (ref: PieceRef, contextId: string): void => {
  if (ref.scope !== contextId) refuse('A conversation can exclude pieces of its own CV only.');
  const [section, item] = ref.path;
  if (section === undefined) return;
  if (section === OVERVIEW) {
    if (item !== undefined && !isOverviewItem(item)) {
      refuse(`The overview has no item ${JSON.stringify(item)}. Its items are ${OVERVIEW_ITEMS.join(', ')}.`);
    }
    return;
  }
  if (!isListSection(section)) {
    refuse(`A CV has no section ${JSON.stringify(section)}. Its sections are ${[OVERVIEW, ...LIST_SECTIONS].join(', ')}.`);
  }
};

export const createSelectionService = (deps: SelectionDeps): SelectionService => {
  const view = (selection: Selection): SelectionView => {
    const walls = selection.exclude.map((ref) => parseRef(ref));
    const state = (ref: string): SelectionState => (deps.holds(parseRef(ref)) ? 'live' : 'gone');

    return {
      revision: selection.revision,
      exclusions: selection.exclude.map((ref) => ({ ref, state: state(ref) })),
      pins: selection.pin.map((ref) => ({
        ref,
        state: isWalled(walls, parseRef(ref)) ? 'blocked' : state(ref)
      }))
    };
  };

  /** The refs as stored form, each checked for the conversation it is sent to. */
  const excluded = (refs: readonly string[], kind: string, subjectId: string): string[] =>
    refs.map((text) => {
      const ref = parseRef(text);
      if (ref.version !== undefined || ref.digest !== undefined) {
        refuse('A selection names a piece and not a version of it: leave off the @version and the #digest.');
      }
      deps.wells.check(ref);

      if (kind === 'profile') {
        if (ref.well !== CV_WELL) refuse('A profile conversation can exclude pieces of its CV only.');
        checkCv(ref, subjectId || CV_ID);
      } else if (kind === 'discovery') {
        if (ref.well !== OFFERS_WELL || ref.path.length > 0) {
          refuse('A discovery conversation can exclude whole saved offers only, as offers:<id>.');
        }
      } else {
        refuse('Nothing in an offer conversation can be excluded yet.');
      }

      return refKey(ref);
    });

  /** The refs as stored form, each checked for being something this conversation may pin. */
  const pinned = (refs: readonly string[], kind: string, subjectId: string): string[] =>
    refs.map((text) => {
      const ref = parseRef(text);
      if (ref.version !== undefined || ref.digest !== undefined) {
        refuse('A selection names a piece and not a version of it: leave off the @version and the #digest.');
      }
      deps.wells.check(ref);

      if (kind !== 'profile') refuse('Only a profile conversation can pin pieces so far.');
      if (ref.well !== CV_WELL) refuse('A profile conversation can pin pieces of its CV only.');
      checkCv(ref, subjectId || CV_ID);
      if (ref.path.length === 0) refuse('A pin names a section or an entry of the CV, not the whole of it.');

      return refKey(ref);
    });

  return {
    get: (conversationId) =>
      deps.conversations.read(conversationId) === undefined ? undefined : view(deps.store.read(conversationId)),

    update: (conversationId, request) => {
      const found = deps.conversations.read(conversationId);
      if (found === undefined) return undefined;
      const { kind, id } = found.conversation.subject;

      const change: SelectionChange = {
        expectedRevision: request.expectedRevision,
        exclude: excluded(request.exclude ?? [], kind, id),
        clear: (request.clear ?? []).map((text) => refKey(parseRef(text))),
        pin: pinned(request.pin ?? [], kind, id),
        unpin: (request.unpin ?? []).map((text) => refKey(parseRef(text)))
      };

      const result = deps.store.change(conversationId, change);
      // What the change answered with, so the view is of the revision it was
      // checked or applied against and not of whatever a second read finds.
      return { applied: result.applied, view: view(result.selection) };
    }
  };
};
