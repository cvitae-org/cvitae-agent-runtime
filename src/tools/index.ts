/**
 * The tools shipped with the runtime.
 *
 * Every one of them is a read unless its name says otherwise, and each returns
 * the smallest useful shape rather than whatever the store handed back. That
 * trimming is not tidiness: a tool result goes into the model's context and is
 * paid for on every subsequent turn, so returning a whole offer record where a
 * title and a salary would do is a cost multiplied by the length of the loop.
 *
 * Note what is absent. There is no tool that runs a query, reads a path, or
 * fetches a URL the model names. Each one answers a specific question against
 * local storage, which is what keeps the blast radius of a confused — or
 * prompt-injected — model to "returned something unhelpful" rather than
 * "exfiltrated the CV".
 */

import { z } from 'zod';
import { defineTool } from './registry.js';

export const searchProfileTool = defineTool({
  name: 'search_profile',
  describe:
    "Search the user's CV for experience relevant to a description of work. Returns matching bullet points with the company and role they came from.",
  schema: z.object({
    query: z
      .string()
      .describe('What to look for, e.g. "React and TypeScript frontend work".'),
    limit: z.number().int().min(1).max(20).default(6)
  }),
  execute: async ({ query, limit }, context) => {
    const hits = await context.store.searchProfile(query, limit);

    if (hits.length === 0) {
      return {
        results: [],
        note: 'Nothing indexed yet. The CV may not have been imported, or the index may need rebuilding.'
      };
    }

    return {
      results: hits.map((hit) => ({
        text: hit.row.text,
        company: hit.row.company,
        title: hit.row.title
      }))
    };
  }
});

export const readCvSummaryTool = defineTool({
  name: 'read_cv_summary',
  describe:
    "Read the factual summary of the user's CV: name, current role, skills, and the list of employers with dates. Does not include experience bullet points — use search_profile for those.",
  schema: z.object({}),
  execute: async (_args, context) => {
    const document = await context.store.documents.read();

    return {
      name: document.personal.name,
      role: document.skills.role,
      role_description: document.role_description,
      skills: {
        languages: document.skills.programming_languages,
        frameworks: document.skills.frameworks,
        tools: document.skills.libraries_and_tools
      },
      experience: document.experience.map((entry) => ({
        company: entry.company,
        title: entry.title,
        started: entry.started,
        finished: entry.finished ?? 'present',
        highlight_count: entry.highlights.length
      })),
      education: document.education.map((entry) => ({
        university: entry.university,
        degree: entry.degree
      })),
      languages: document.languages
    };
  }
});

/**
 * Offer search, exposed with the filter separated from the query.
 *
 * The split is the point. `where` is a hard predicate the store applies before
 * ranking; `query` only orders what survives. Letting the model express
 * "remote" as part of a similarity query instead of a filter is how a search
 * for senior remote work returns a mid-level onsite role that happens to be
 * written in similar language.
 */
export const searchOffersTool = defineTool({
  name: 'search_offers',
  describe:
    'Search saved job offers. Use `where` for hard requirements (work mode, seniority, company) and `query` for what the role should be about. Either may be omitted.',
  schema: z.object({
    query: z.string().optional().describe('What the role should involve.'),
    work_mode: z
      .enum(['remote', 'hybrid', 'onsite'])
      .optional()
      .describe('A hard filter, not a preference.'),
    company: z.string().optional().describe('Exact company name.'),
    limit: z.number().int().min(1).max(50).default(10)
  }),
  execute: async ({ query, work_mode, company, limit }, context) => {
    const predicates: string[] = [];

    if (work_mode) predicates.push(`work_mode = '${work_mode}'`);
    // Escaped for the SQL string literal; a company name with an apostrophe
    // would otherwise terminate it and fail to parse.
    if (company) predicates.push(`company = '${company.replace(/'/g, "''")}'`);

    const hits = await context.store.searchOffers({
      query,
      where: predicates.length > 0 ? predicates.join(' AND ') : undefined,
      limit
    });

    return {
      count: hits.length,
      results: hits.map((hit) => ({
        title: hit.row.title,
        company: hit.row.company,
        location: hit.row.location,
        work_mode: hit.row.work_mode,
        salary: hit.row.salary,
        seniority: hit.row.seniority,
        url: hit.row.url
      }))
    };
  }
});

export const defaultTools = [
  searchProfileTool,
  readCvSummaryTool,
  searchOffersTool
];
