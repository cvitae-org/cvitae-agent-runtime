/**
 * Read-only model access to the current canonical CV.
 *
 * Search is useful for finding one relevant highlight, but it is a derived
 * view and can intentionally be empty after a person edits their CV. This tool
 * reads the source document instead. It exposes one bounded section at a time:
 * no path, source reference, credential or outbound effect is reachable from
 * here, and large strings are clipped before they enter a model context.
 *
 * The overview carries the person's name and place and not how to reach them.
 * The email, the phone and the links are a section of their own, `contact`, which
 * a model reads when a question needs them, so they are not in every answer's
 * context (and in every masked prompt) because the overview was looked at.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../../contracts/index.js';
import { CV_ID, asCvDocument } from './document.js';
import { cvView, viewOf, withheldItem } from './walls.js';
import type { CvWithheld } from './walls.js';
import { CONTACT, CV_WELL, OVERVIEW_ITEMS, cvReadEntries, overviewPiece } from './well.js';

export const READ_CV_TOOL = 'read_cv';

const sections = ['overview', CONTACT, 'experience', 'education', 'certificates', 'languages'] as const;
type Section = (typeof sections)[number];

const inputSchema = z.object({
  section: z.enum(sections).default('overview'),
  offset: z.number().int().min(0).max(1_000).default(0),
  limit: z.number().int().min(1).max(10).default(5)
});

/** Leave room for the response envelope and pagination metadata. */
const CONTENT_BUDGET = 5_200;

type Budget = { remaining: number; truncated: boolean };

/**
 * Produces a JSON-shaped copy under a character budget.
 *
 * The document schema deliberately does not impose presentation limits on a
 * person's prose. A tool result does need one: it is copied into every later
 * model turn. Accounting is conservative (keys, separators and quotes all
 * count), so the returned content stays below the ceiling even for adversarial
 * strings while retaining its object/array structure.
 */
const bounded = (value: unknown, budget: Budget): unknown => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    const size = JSON.stringify(value).length;
    if (size > budget.remaining) {
      budget.truncated = true;
      return null;
    }
    budget.remaining -= size;
    return value;
  }

  if (typeof value === 'string') {
    // JSON escaping can make one source character cost six result characters
    // (`\n`, quotes, lone surrogates). Search by the encoded size rather than
    // assuming source length and wire length are interchangeable.
    let low = 0;
    let high = value.length;

    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = value.slice(0, middle);
      if (JSON.stringify(candidate).length <= budget.remaining) low = middle;
      else high = middle - 1;
    }

    // Do not return half an emoji when the budget lands between its surrogate
    // pair. It would be valid JSON, but it would not be valid profile text.
    let clipped = value.slice(0, low);
    const tail = clipped.charCodeAt(clipped.length - 1);
    if (tail >= 0xD800 && tail <= 0xDBFF) clipped = clipped.slice(0, -1);

    budget.remaining -= JSON.stringify(clipped).length;
    if (clipped.length < value.length) budget.truncated = true;
    return clipped;
  }

  if (Array.isArray(value)) {
    budget.remaining = Math.max(0, budget.remaining - 2);
    const copy: unknown[] = [];

    for (const item of value) {
      if (budget.remaining < 8) {
        budget.truncated = true;
        break;
      }
      if (copy.length > 0) budget.remaining -= 1;
      copy.push(bounded(item, budget));
    }

    if (copy.length < value.length) budget.truncated = true;
    return copy;
  }

  if (typeof value === 'object' && value !== null) {
    budget.remaining = Math.max(0, budget.remaining - 2);
    const copy: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      const keyCost = JSON.stringify(key).length + 1 + (Object.keys(copy).length > 0 ? 1 : 0);
      if (keyCost + 4 > budget.remaining) {
        budget.truncated = true;
        break;
      }
      budget.remaining -= keyCost;
      copy[key] = bounded(item, budget);
    }

    if (Object.keys(copy).length < Object.keys(value).length) budget.truncated = true;
    return copy;
  }

  return null;
};

const page = <T>(items: readonly T[], offset: number, limit: number) => ({
  offset,
  limit,
  total: items.length,
  hasMore: offset + limit < items.length,
  // Content is last so the budgeter always preserves the coordinates a model
  // needs to request the next page, even when one entry contains huge prose.
  items: items.slice(offset, offset + limit)
});

const select = (
  section: Section,
  document: ReturnType<typeof asCvDocument>,
  offset: number,
  limit: number,
  withheld: CvWithheld
): Record<string, unknown> => {
  switch (section) {
    case 'overview': {
      // An excluded item is left out, and not blanked: a model told the CV has an
      // empty name would say so to the person.
      const overview: Record<string, unknown> = { version: document.version };
      for (const item of OVERVIEW_ITEMS) {
        if (item !== CONTACT && !withheldItem(withheld, item)) overview[item] = overviewPiece(document, item);
      }
      return overview;
    }
    case CONTACT:
      return withheldItem(withheld, CONTACT) ? {} : (overviewPiece(document, CONTACT) as Record<string, unknown>);
    case 'experience':
      return page(document.experience, offset, limit);
    case 'education':
      return page(document.education, offset, limit);
    case 'certificates':
      return page(document.certificates, offset, limit);
    case 'languages':
      return page(document.languages, offset, limit);
  }
};

export const readCvTool: ToolDefinition<z.infer<typeof inputSchema>, unknown> = {
  name: READ_CV_TOOL,
  describe:
    "Read the user's current canonical CV, one structured section at a time. "
    + 'Use this for current profile facts; paginate list sections with offset and limit. '
    + 'The overview has the name and location; read the contact section only when the email, '
    + 'phone or links are needed.',
  input: inputSchema,
  execute: async ({ section, offset, limit }, context) => {
    const record = context.documents.read(CV_ID);

    if (!record) {
      return {
        present: false,
        note: 'No CV has been imported yet.'
      };
    }

    // Parse at the read boundary. A corrupt or future-version body must not be
    // presented to the model as if it were a canonical CV.
    //
    // What is read is what the document port handed over, which has the
    // excluded pieces out of it. `view` keeps where each remaining entry sat in
    // the stored document, because that is what a record names it by.
    const view = viewOf(record) ?? cvView(asCvDocument(record.body), [], '');
    const budget: Budget = { remaining: CONTENT_BUDGET, truncated: false };
    const data = bounded(select(section, view.shown, offset, limit, view.withheld), budget);

    // Said before the result is returned: a tool that cannot say what it hands
    // to the model hands nothing. The entries are made from the copy that is
    // about to be returned, so they cannot disagree with it.
    const scope = context.record?.scopes[CV_WELL];
    if (context.record !== undefined && scope !== undefined) {
      context.record.add(
        cvReadEntries(scope, record.revision, view.original, { section, offset }, data, 'tool:read_cv', view)
      );
    }

    return {
      present: true,
      revision: record.revision,
      section,
      data,
      ...(budget.truncated ? { truncated: true } : {})
    };
  }
};
