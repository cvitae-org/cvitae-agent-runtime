/**
 * The tools shipped with the runtime.
 *
 * Every one of them is a read, and each returns the smallest useful shape
 * rather than whatever the port handed back. That trimming is not tidiness: a
 * tool result enters the model's context and is paid for again on every
 * subsequent turn, so returning a whole record where three fields would do is a
 * cost multiplied by the length of the loop.
 *
 * Note what is absent, and why the absences are the point. There is no tool
 * that runs a query, reads a path, fetches a URL the model names, or sends
 * anything anywhere — `ToolContext` cannot reach mail at all, and a boundary
 * rule fails the build if this directory ever imports it. Each tool answers one
 * specific question against local storage, which keeps the blast radius of a
 * confused, or prompt-injected, model at "returned something unhelpful" rather
 * than "exfiltrated the CV".
 *
 * The table is short on purpose. Two more tools are obvious and neither is here
 * yet: a CV summary would have to know the CV's schema, which is one
 * capability's domain knowledge and belongs with it rather than in the path of
 * every other; and an offer search has its port, `OfferStore.search`, but
 * `ToolContext` does not carry the offers, so `ask_profile` answers about the
 * CV alone. Both arrive with the capabilities that need them.
 */

import { z } from 'zod';
import type { ChunkHit, ToolContext } from '../contracts/index.js';
import { CV_ID } from '../capabilities/cv/document.js';
import { readCvTool } from '../capabilities/cv/tools.js';
import { storedCv } from '../capabilities/cv/walls.js';
import { CV_WELL, cvHitEntries } from '../capabilities/cv/well.js';
import { defineTool } from './registry.js';

/**
 * A ceiling on what one call can put into the context window.
 *
 * The schema's own `max` bounds the count; this bounds the size. A model asking
 * for twenty chunks of a verbose document can otherwise spend more context on
 * one tool result than on the rest of the conversation.
 */
const MAX_RESULT_CHARS = 6_000;

/**
 * Says which passages of the CV a search handed to the model.
 *
 * The passages are placed in the document as it is now, which is the revision
 * they were found at: the scoped retriever drops a passage indexed from any
 * other. A passage is part of a piece and not the whole of it, so each entry
 * carries the digest of the passage the model received as well as the digest of
 * the piece it came from.
 */
const reportPassages = (context: ToolContext, hits: readonly ChunkHit[]): void => {
  const scope = context.record?.scopes[CV_WELL];
  if (context.record === undefined || scope === undefined || hits.length === 0) return;

  // Placed in the document as it is stored, whatever of it the run may see:
  // a passage says which entry it came from by that document's positions.
  const found = context.documents.read(CV_ID);
  const cv = found === undefined ? undefined : storedCv(found);
  if (found === undefined || cv === undefined) return;

  context.record.add(
    cvHitEntries(scope, found.revision, cv, hits, { status: 'included', via: 'tool:search_profile', passage: true })
  );
};

export const searchProfileTool = defineTool({
  name: 'search_profile',
  describe:
    "Search the user's own documents for material relevant to a description of "
    + 'work. Returns matching passages with where each came from.',
  input: z.object({
    query: z
      .string()
      .min(2)
      .describe('What to look for, e.g. "React and TypeScript frontend work".'),
    limit: z.number().int().min(1).max(20).default(6)
  }),
  execute: async ({ query, limit }, context) => {
    const hits = await context.retrieval.search({ text: query, limit }, context.signal);

    if (hits.length === 0) {
      // Distinguished from "no match" on purpose: an empty index and an
      // unhelpful query call for completely different next moves, and a model
      // told only "no results" will rephrase the query forever.
      return {
        results: [],
        note: 'Nothing matched. The documents may not have been imported yet.'
      };
    }

    let budget = MAX_RESULT_CHARS;
    const results: { text: string; kind: string; meta: Record<string, unknown> }[] = [];

    for (const hit of hits) {
      if (hit.text.length > budget) break;

      budget -= hit.text.length;
      results.push({ text: hit.text, kind: hit.kind, meta: { ...hit.meta } });
    }

    // Only the passages that fit are the ones the model receives.
    reportPassages(context, hits.slice(0, results.length));

    // The score is not returned. It is a fused rank with no meaning outside
    // this one query, and a model given a number will reason about it.
    return {
      results,
      ...(results.length < hits.length ? { truncated: hits.length - results.length } : {})
    };
  }
});

export const defaultTools = [searchProfileTool, readCvTool];
