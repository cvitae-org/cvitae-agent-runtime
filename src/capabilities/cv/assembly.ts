/**
 * Putting chosen pieces of the CV in front of the model, and saying which.
 *
 * Reading the CV is something a model does when it has tools. This is the other
 * way in: a person (or the runtime, when it is asked to) names pieces, and they
 * are put in the prompt whole. The two have to be told apart in the record, and
 * the one that is told here is the harder to get right, because the text and the
 * account of the text have to agree. So both come from the one function below.
 * It renders a piece into a block and makes the entry that says the block was
 * sent, in the same pass over the same piece, and nothing else writes either.
 *
 * A piece is a leaf: an overview item (`personal`, `role_description`, `skills`)
 * or one entry of a list section. A pin or an attachment may name a section, and
 * is then every leaf in it, so an entry that is left out of the conversation is
 * left out of the block and the others still go. One block and one entry for each
 * leaf, which is also how `read_cv` records what it hands over.
 *
 * What comes out of here fails closed:
 *
 *   an exclusion beats the ask   a piece the walls cover is not read at all. It
 *                                is listed as `blocked` and its text appears
 *                                nowhere. What is cut is decided by the document
 *                                port, which has the walls built in, and not by
 *                                a second check here that could disagree.
 *   too much is refused          over the budget the run fails and says by how
 *                                much. Nothing is cut to fit.
 *   a piece that is gone         is named and sends nothing. A renamed entry has a
 *                                new key (`well.ts`), and the pin on the old one
 *                                finds nothing rather than something else.
 */

import { GROUNDED, OperationError } from '../../contracts/index.js';
import type {
  Grounded,
  Need,
  PieceRef,
  RecordEntry,
  RunContext,
  StepContext,
  TransformStep
} from '../../contracts/index.js';
import { PICKS_BUDGET } from '../../context/ground.js';
import type { Auto, GroundingInput } from '../../context/ground.js';
import { overLimit, roomForPicks } from '../../context/limits.js';
import type { Material } from '../../context/limits.js';
import { digest, isWalled, parseRef, refKey } from '../../grounding/index.js';
import { CV_ID } from './document.js';
import { viewOf } from './walls.js';
import type { CvView } from './walls.js';
import { CV_WELL, LIST_SECTIONS, OVERVIEW, OVERVIEW_ITEMS, cvKeys, cvRef, placer } from './well.js';
import type { ListSection } from './well.js';

export const GROUND_STEP = 'ground';

/** How many passages `auto` looks at. It adds the pieces they came from, so at most this many. */
const AUTO_HITS = 6;

const VIA = { pin: 'ground:pin', once: 'ground:once', auto: 'ground:auto' } as const;
type Via = (typeof VIA)[keyof typeof VIA];

/* ---------------------------------------------------------------- rendering */

const lines = (...parts: (string | false | undefined)[]): string =>
  parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '').join('\n');

/**
 * When something started and ended, as the document says it. `null` is ongoing,
 * and an empty end is one nobody wrote down, such as a certificate that does not
 * expire, which is the start alone and not a question mark.
 */
const span = (started: string, finished: string | null | undefined): string => {
  if (finished === null) return `${started === '' ? '?' : started} - present`;
  if (finished === undefined || finished === '') return started;
  return `${started === '' ? '?' : started} - ${finished}`;
};

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];

/**
 * One leaf as the model reads it: a heading, then what the piece says.
 *
 * Empty when the piece says nothing, so a CV with no role description has no
 * block for it and the record has no entry. Plain lines and no markup, as the
 * rest of what a prompt carries is (`context/render.ts`), and in English whatever
 * language the CV is in: the heading is the runtime's, the body is the person's.
 */
const render = (section: string, item: unknown): string => {
  const row = (typeof item === 'object' && item !== null ? item : {}) as Row;

  switch (section) {
    case OVERVIEW + '/personal': {
      const links = Object.entries((row.links ?? {}) as Record<string, string>).map(([name, url]) => `${name}: ${url}`);
      const body = lines(text(row.name), text(row.email), text(row.phone), text(row.location), ...links);
      return body === '' ? '' : `Personal details:\n${body}`;
    }
    case OVERVIEW + '/role_description': {
      const body = typeof item === 'string' ? item.trim() : '';
      return body === '' ? '' : `Role description:\n${body}`;
    }
    case OVERVIEW + '/skills': {
      const groups = (Array.isArray(row.groups) ? row.groups : []) as { label?: string; items?: string[] }[];
      const body = lines(
        text(row.role) !== '' && `Role: ${text(row.role)}`,
        ...groups.map((group) => `${text(group.label) || 'Skills'}: ${list(group.items).join(', ')}`)
      );
      return body === '' ? '' : `Skills:\n${body}`;
    }
    case 'experience': {
      const body = lines(
        span(text(row.started), row.finished as string | null | undefined),
        ...list(row.highlights).map((highlight) => `- ${highlight}`),
        list(row.skills).length > 0 && `Skills: ${list(row.skills).join(', ')}`
      );
      const head = [text(row.title), text(row.company)].filter((part) => part !== '').join(' at ');
      return `Experience, ${head || 'entry'}:\n${body}`.trimEnd();
    }
    case 'education': {
      const body = lines(
        span(text(row.started), row.finished as string | null | undefined),
        text(row.thesis) !== '' && `Thesis: ${text(row.thesis)}`,
        text(row.mark) !== '' && `Mark: ${text(row.mark)}`
      );
      const head = [text(row.degree), text(row.university)].filter((part) => part !== '').join(', ');
      return `Education, ${head || 'entry'}:\n${body}`.trimEnd();
    }
    case 'certificates': {
      const body = lines(
        text(row.issuer) !== '' && `Issued by ${text(row.issuer)}`,
        span(text(row.started), row.finished as string | null | undefined)
      );
      return `Certificate, ${text(row.name) || 'entry'}:\n${body}`.trimEnd();
    }
    case 'languages':
      return `Language, ${text(row.name) || 'entry'}${text(row.level) === '' ? '' : `: ${text(row.level)}`}`;
    default:
      return '';
  }
};

/* ------------------------------------------------------------------- leaves */

type Leaf = {
  readonly section: string;
  readonly key: string;
  /** What the person's own words are, as stored: what the entry's digest is of. */
  readonly original: unknown;
  /** What the model reads. Never empty. */
  readonly text: string;
};

/** What a leaf is when looked up in a view. `walled` is not the same as absent. */
type Found = { readonly leaf: Leaf } | 'walled' | 'absent' | 'empty';

const isOverviewItem = (key: string): boolean => (OVERVIEW_ITEMS as readonly string[]).includes(key);
const isListSection = (section: string): section is ListSection => (LIST_SECTIONS as readonly string[]).includes(section);

/**
 * One leaf of the view the document port handed out.
 *
 * The leaf is read from `shown`, which has every excluded piece taken out, and
 * only its identity and digest come from `original`. A leaf `shown` does not have
 * is `walled` when the original did, and `absent` when it did not.
 */
const leafAt = (view: CvView, section: string, key: string): Found => {
  if (section === OVERVIEW) {
    if (!isOverviewItem(key)) return 'absent';
    if (key in view.withheld.items) return 'walled';
    const body = render(`${OVERVIEW}/${key}`, view.shown[key as (typeof OVERVIEW_ITEMS)[number]]);
    if (body === '') return 'empty';
    return { leaf: { section, key, original: view.original[key as (typeof OVERVIEW_ITEMS)[number]], text: body } };
  }

  if (!isListSection(section)) return 'absent';
  const stored = cvKeys(view.original)[section].indexOf(key);
  if (stored < 0) return 'absent';

  const at = view.keys[section].indexOf(key);
  if (at < 0) return 'walled';

  const original = view.original[section][view.rows[section][at] as number];
  return { leaf: { section, key, original, text: render(section, view.shown[section][at]) } };
};

/** Every leaf a ref names, by key and in document order, whether or not it may be shown. */
const leavesOf = (view: CvView, ref: PieceRef): { section: string; key: string }[] => {
  const [section, key] = ref.path;
  if (section === undefined) return [];

  if (section === OVERVIEW) {
    return key === undefined
      ? OVERVIEW_ITEMS.map((item) => ({ section, key: item }))
      : [{ section, key }];
  }
  if (!isListSection(section)) return [];

  const keys = cvKeys(view.original)[section];
  return key === undefined ? keys.map((each) => ({ section, key: each })) : keys.includes(key) ? [{ section, key }] : [];
};

const leafRef = (scope: string, section: string, key: string): string => cvRef(scope, section, key);

/** The entry that says a leaf's block was sent. */
const included = (scope: string, revision: number, leaf: Leaf, via: Via): RecordEntry => ({
  ref: leafRef(scope, leaf.section, leaf.key),
  version: String(revision),
  digest: digest(leaf.original),
  status: 'included',
  origin: 'server',
  via
});

/**
 * The entry that says something asked for a piece and it was held back.
 *
 * Nothing of the piece was read for it, so the digest is of the address: it keeps
 * an entry for one ref distinct from an entry for another and says nothing else.
 */
const blockedEntry = (ref: string, via: Via): RecordEntry => ({
  ref,
  digest: digest(ref),
  status: 'blocked',
  origin: 'server',
  via
});

/* ----------------------------------------------------------------- assembly */

export type Asked = {
  /** Pieces the conversation keeps in every message, in the order they were pinned. */
  readonly pins: readonly PieceRef[];
  /** Pieces this message attaches, canonical refs. */
  readonly once: readonly string[];
  readonly auto: Auto;
  /** What a search for pieces the runtime would add is made from. */
  readonly question: string;
  /**
   * What goes along with the pieces in the same message, when a limit may apply:
   * the pieces are held to what is left of the conversation's limit after these.
   */
  readonly rest?: Omit<Material, 'picks'>;
};

type Context = Pick<RunContext, 'documents' | 'retrieval' | 'walls' | 'record' | 'signal' | 'contextId' | 'limits'>;

const own = (ref: PieceRef, scope: string): PieceRef => {
  if (ref.well !== CV_WELL || ref.scope !== scope || ref.path.length === 0) {
    throw new OperationError(
      'invalid_selection',
      `Only a section or an entry of this conversation's own CV can be sent as a piece, and ${refKey(ref)} is not one.`
    );
  }
  return ref;
};

/** What a sync pass over the pins and attachments came to, before anything the runtime adds. */
type Collected = {
  readonly scope: string;
  readonly view: CvView | undefined;
  readonly revision: number;
  readonly blocks: string[];
  readonly entries: RecordEntry[];
  readonly blocked: string[];
  readonly gone: string[];
  readonly seen: Set<string>;
  /** Characters the blocks come to as sent, separators counted. */
  size: number;
};

/**
 * Renders the pins and then the attachments, each in its own order, and a leaf
 * asked for twice is sent once, by the first to ask.
 *
 * Reads and decides, and says nothing to the record: it is what both the
 * assembly and a measurement made before a plan are made of, so that what is
 * measured is the text that would be sent and not a second reckoning of it.
 * `undefined` is a message that asks for nothing of a conversation with no CV.
 */
const collect = (asked: Pick<Asked, 'pins' | 'once'>, context: Context): Collected | undefined => {
  const scope = context.contextId;
  if (scope === undefined) {
    if (asked.pins.length === 0 && asked.once.length === 0) return undefined;
    throw new OperationError('invalid_selection', 'Pieces can be sent only with a run that is about a CV.');
  }

  const walls = context.walls?.pieces() ?? [];
  const found = context.documents.read(CV_ID);
  const view = found === undefined ? undefined : viewOf(found);
  const revision = found?.revision ?? 0;

  const collected: Collected = {
    scope,
    view,
    revision,
    blocks: [],
    entries: [],
    blocked: [],
    gone: [],
    seen: new Set<string>(),
    size: 0
  };
  const { blocks, entries, blocked, gone, seen } = collected;

  const send = (leaf: Leaf, via: Via): void => {
    // The separator is counted, so the text is never longer than its budget says.
    collected.size += leaf.text.length + (blocks.length === 0 ? 0 : 2);
    blocks.push(leaf.text);
    entries.push(included(scope, revision, leaf, via));
  };

  const asks: { ref: PieceRef; via: Via }[] = [
    ...asked.pins.map((ref) => ({ ref: own(ref, scope), via: VIA.pin })),
    ...asked.once.map((ref) => ({ ref: own(parseRef(ref), scope), via: VIA.once }))
  ];

  for (const { ref, via } of asks) {
    const name = refKey(ref);

    // The wall first and by name, so an excluded piece is never looked at, and
    // so a pin on something that is also gone is reported as the exclusion it is.
    if (isWalled(walls, ref)) {
      if (!blocked.includes(name)) {
        blocked.push(name);
        entries.push(blockedEntry(name, via));
      }
      continue;
    }

    const leaves = view === undefined ? [] : leavesOf(view, ref);
    if (view === undefined || (leaves.length === 0 && ref.path.length === 2)) {
      if (!gone.includes(name)) gone.push(name);
      continue;
    }

    for (const place of leaves) {
      const at = leafRef(scope, place.section, place.key);
      if (seen.has(at)) continue;
      seen.add(at);

      const leaf = leafAt(view, place.section, place.key);
      if (leaf === 'walled') {
        if (!blocked.includes(at)) {
          blocked.push(at);
          entries.push(blockedEntry(at, via));
        }
      } else if (leaf === 'absent') {
        if (!gone.includes(at)) gone.push(at);
      } else if (typeof leaf === 'object') {
        send(leaf.leaf, via);
      }
    }
  }

  return collected;
};

/** What the pieces a message names come to, in characters, as they would be sent. */
export const measurePicks = (asked: Pick<Asked, 'pins' | 'once'>, context: Context): number =>
  collect(asked, context)?.size ?? 0;

/**
 * Why pieces that come to `size` may not be sent, or nothing when they may.
 *
 * Two limits and the order matters: the pieces' own budget first, which holds
 * whatever anyone has set, and then what is left of the conversation's limit.
 */
export const picksProblem = (
  size: number,
  rest: Asked['rest'],
  limit: number | undefined
): { readonly code: string; readonly message: string } | undefined => {
  if (size > PICKS_BUDGET) {
    return {
      code: 'grounding_budget',
      message:
        `The pieces chosen for this message come to ${size} characters, and at most ${PICKS_BUDGET} are sent. `
        + 'Unpin or detach something, or choose entries instead of whole sections.'
    };
  }
  const over = rest === undefined ? undefined : overLimit({ ...rest, picks: size }, limit);
  return over === undefined ? undefined : { code: 'context_limit', message: over };
};

/**
 * Renders what was asked for, and makes the entries that say so.
 *
 * Pins are first and then the attachments (`collect`). `auto` comes last and only
 * adds what is left of the budget, and of the conversation's limit.
 */
export const assembleCv = async (asked: Asked, context: Context): Promise<Grounded> => {
  const collected = collect(asked, context);
  if (collected === undefined) return { text: '', entries: [], blocked: [], gone: [], suggested: [] };

  const { scope, view, blocks, entries, blocked, gone, seen } = collected;
  const limit = context.limits?.context();

  const problem = picksProblem(collected.size, asked.rest, limit);
  if (problem !== undefined) throw new OperationError(problem.code, problem.message);

  // What `auto` may add up to: the pieces' own budget, less what a limit leaves
  // out of it for the rest of the message.
  const budget = asked.rest === undefined ? PICKS_BUDGET : roomForPicks(asked.rest, limit);

  const suggested: string[] = [];
  let auto: Grounded['auto'];

  if (asked.auto !== 'off' && view !== undefined && asked.question.trim() !== '') {
    try {
      const place = placer(view.original);
      const hits = await context.retrieval.search({ text: asked.question, limit: AUTO_HITS }, context.signal);

      for (const hit of hits) {
        const where = place(hit)?.place;
        if (where?.section === undefined || where.key === undefined) continue;
        const at = leafRef(scope, where.section, where.key);
        if (seen.has(at)) continue;
        seen.add(at);

        const leaf = leafAt(view, where.section, where.key);
        if (typeof leaf !== 'object') continue;

        if (asked.auto === 'suggest') {
          suggested.push(at);
        } else if (collected.size + leaf.leaf.text.length + (blocks.length === 0 ? 0 : 2) <= budget) {
          collected.size += leaf.leaf.text.length + (blocks.length === 0 ? 0 : 2);
          blocks.push(leaf.leaf.text);
          entries.push(included(scope, collected.revision, leaf.leaf, VIA.auto));
        }
      }
    } catch (error) {
      // A stopped run is stopped, and is not a search that did not answer.
      if (context.signal.aborted) throw error;
      auto = 'failed';
    }
  }

  // Said now and not when the call goes out: these are facts about the asking,
  // and true whether or not a model is ever called. What was sent is recorded by
  // the step that sends it (`Sends.groundedFrom`).
  const refused = entries.filter((entry) => entry.status === 'blocked');
  if (refused.length > 0) context.record?.add(refused);

  return {
    text: blocks.join('\n\n'),
    entries: entries.filter((entry) => entry.status === 'included'),
    blocked,
    gone,
    suggested,
    ...(auto === undefined ? {} : { auto })
  };
};

/**
 * The step that assembles. It reads the pins now and not when the plan was made,
 * so a pin made while the run waited is a pin at its resume.
 */
export const groundStep = (asked: Omit<Asked, 'pins'>): TransformStep => ({
  kind: 'transform',
  name: GROUND_STEP,
  critical: true,
  run: async (context: StepContext) => ({
    [GROUNDED]: await assembleCv({ ...asked, pins: context.pins?.pieces() ?? [] }, context)
  })
});

/* ------------------------------------------------------------------- needs */

/**
 * What a message that asks for pieces needs before it can be run.
 *
 * Read from refs alone and not from the document: this is asked before a plan is
 * made, and a plan may call a model. Whether a piece is still there is the
 * assembly's to find out, and it says so in what it returns.
 */
export const cvNeeds = (grounding: GroundingInput | undefined, context: RunContext): Need[] => {
  const once = (grounding?.once ?? []).map((ref) => parseRef(ref));
  const pins = context.pins?.pieces() ?? [];

  if (context.contextId === undefined) {
    if (once.length === 0) return [];
    throw new OperationError('invalid_selection', 'Pieces can be attached only to a run that is about a CV.');
  }
  for (const ref of once) own(ref, context.contextId);

  const walls = context.walls?.pieces() ?? [];
  const open = (refs: readonly PieceRef[]): PieceRef[] => refs.filter((ref) => !isWalled(walls, ref));
  const left = (refs: readonly PieceRef[]): number => refs.length - open(refs).length;
  const needs: Need[] = [];

  if (grounding?.reach === 'selected') {
    const none = open(pins).length + open(once).length === 0 && grounding.auto !== 'on';
    needs.push({
      name: 'selection',
      required: true,
      ...(none
        ? { unmet: 'Nothing is selected for this message, and the model has no tools to look for anything.' }
        : {})
    });
  }

  if (pins.length > 0) {
    needs.push({
      name: 'pins',
      required: false,
      ...(left(pins) > 0 ? { unmet: `${left(pins)} pinned piece(s) are left out of this conversation.` } : {})
    });
  }

  if (once.length > 0) {
    needs.push({
      name: 'once',
      required: false,
      ...(left(once) > 0 ? { unmet: `${left(once)} attached piece(s) are left out of this conversation.` } : {})
    });
  }

  return needs;
};

/**
 * What a message needs to be within its limits before a plan is made, which is
 * before any model is asked.
 *
 * Measured with the same pass the assembly is made of (`collect`), so a message
 * that passes here is not refused by the assembly for the size it was measured
 * at. A message that sends no pieces and has no limit reads nothing at all.
 *
 * `rest` is the other material of the message, which the capability knows and
 * this does not. The two codes are the ones a host words: `grounding_budget`
 * when the pieces alone are too many, `context_limit` when the message as a whole
 * is more than the conversation is limited to.
 */
export const sizeNeeds = (
  grounding: GroundingInput | undefined,
  rest: Asked['rest'],
  context: RunContext
): Need[] => {
  const pins = context.pins?.pieces() ?? [];
  const once = grounding?.once ?? [];
  const picks = pins.length + once.length === 0 ? 0 : measurePicks({ pins, once }, context);

  const problem = picksProblem(picks, rest, context.limits?.context());
  return problem === undefined
    ? []
    : [
        {
          name: problem.code === 'grounding_budget' ? 'budget' : 'limit',
          required: true,
          code: problem.code,
          unmet: problem.message
        }
      ];
};

/* ------------------------------------------------------------------- stale */

/**
 * The entries of an earlier assembly that no longer describe what the document
 * holds, as refs: a piece that has changed, is gone, or has been excluded since.
 *
 * A run that waited for a person is resumed from the text its assembly made. That
 * text is a copy, and sending it now would send the piece as it was and not as it
 * is, or one the person has since left out. The run does not go on with it.
 */
export const staleCv = (context: Pick<RunContext, 'documents' | 'walls'>, entries: readonly RecordEntry[]): string[] => {
  const walls = context.walls?.pieces() ?? [];
  const found = context.documents.read(CV_ID);
  const view = found === undefined ? undefined : viewOf(found);

  return entries.flatMap((entry) => {
    if (entry.status !== 'included') return [];
    const ref = parseRef(entry.ref);
    if (ref.well !== CV_WELL) return [];

    const [section, key] = ref.path;
    const now =
      view === undefined || section === undefined || key === undefined || isWalled(walls, ref)
        ? undefined
        : leafAt(view, section, key);

    return typeof now === 'object' && digest(now.leaf.original) === entry.digest ? [] : [entry.ref];
  });
};
