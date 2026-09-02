/**
 * Checking where an application is about to be sent.
 *
 * The address in a "Where it goes" field comes from whatever the posting
 * printed. That is fine when the posting is real, and it is the whole attack
 * when it is not: listings that exist to collect CVs are a common fraud, and
 * the CV is the payload. This capability gathers what other sources say the
 * address should be, and hands back an ordered list with the evidence attached.
 *
 * Four sources, in the order they are hard to forge:
 *
 *   1. the employer's own site — reached by following a link from the domain
 *      the board itself published, so forging it means controlling that site
 *   2. the posting — whatever it says, which is the thing being checked
 *   3. the same role on another board — agreement between two boards that do
 *      not share an author is worth more than either alone
 *   4. the open web — a search engine asked where this employer publishes jobs,
 *      followed by reading the pages it points at. This is what turns "checked
 *      1 source" into an answer when the board published a name and nothing
 *      else, which is the common case rather than the edge one.
 *
 * The fourth tier is also the one that answers the question a person actually
 * has when no address exists anywhere: *then how do I apply?* Careers pages and
 * applicant-tracking links are collected as `apply_routes` and offered as
 * links, because a form you can open beats an empty list.
 *
 * **Almost no model call.** Pages here are written by strangers and the output
 * lands in a `To:` field beside the user's CV, so nothing on them is allowed to
 * decide anything: they are scanned for `@` by a regex and weighed on facts a
 * page cannot assert about itself. An instruction injected into a careers page
 * has nothing here to instruct. The search engine is held to the same rule —
 * its results are *pointers*, so a title or a snippet can move a page up the
 * fetch queue and can never name a recipient. The one optional model step is
 * asked for a *domain*, never for an address, which is the same rule stated for
 * the one component that could otherwise break it.
 *
 * Every step but the first is non-critical. A verification that reached only
 * the posting is worth less than one that reached everything and is worth much
 * more than an error — the user is standing in front of a Send button either
 * way.
 */

import { z } from 'zod';
import {
  RuntimeError,
  type Capability,
  type CompanySite,
  type EffectCall,
  type Plan,
  type SearchHit,
  type SiteOutcome,
  type StepContext
} from '../../contracts/index.js';
import { findApplicationEmails } from '../apply/text.js';
import {
  checkRecipient,
  rankRecipients,
  registrableDomain,
  type AnchorTrust,
  type GatheredSource
} from './ranking.js';
import {
  collectApplyRoutes,
  domainCandidates,
  hostKind,
  pagesToOpen,
  routeKind,
  slug,
  type ApplyRoute
} from './routes.js';

/** Boards the companion scraper will crawl. LinkedIn and Indeed refuse, by their terms. */
const BOARDS = ['justjoin', 'nofluffjobs', 'pracuj'] as const;

/**
 * A cap on rows scanned per board, not a cap the board honours.
 *
 * Measured: `justjoin` returns its whole result set — 188 rows for "react" —
 * whatever `limit` says, because that argument bounds offers fetched rather
 * than rows listed. Scanning them is free; this exists so a board that one day
 * returns ten thousand does not turn a verification into a sort.
 */
const ROWS_PER_BOARD = 200;

/**
 * How many matching offers to actually open.
 *
 * Each is a real fetch against a real board, throttled per host. Two is enough
 * to answer the question this tier exists for — does another board's copy of
 * this posting name the same address — and small enough to stay inside a
 * request the user is waiting on.
 */
const OFFERS_TO_OPEN = 2;

/**
 * Pages from the web tier to actually open.
 *
 * Three is the whole budget, and it is spent on the pages `pagesToOpen` ranks
 * highest — a snippet that already showed an address, then an apply link, then
 * a careers page. Every one is a request someone is waiting on.
 */
const WEB_PAGES_TO_OPEN = 3;

/**
 * How long the web tier may spend reading those pages.
 *
 * A ceiling on the tier rather than on each page. The company read alone can
 * want a third of the whole verification, so a slow site must cost this tier
 * its remaining pages rather than cost the run its board sweep.
 */
const WEB_PAGE_BUDGET_MS = 12_000;

/** The host, for labelling a link. Empty when the URL will not parse. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export const inputSchema = z
  .object({
    offerText: z.string().optional(),
    url: z.string().optional(),
    /** Company name from `analyze_offer`, used to match rows on other boards. */
    company: z.string().default(''),
    /** The employer's site, when the caller already has it from the board. */
    company_url: z.string().optional(),
    /** The position, used as the board search keyword. */
    position: z.string().default(''),
    /**
     * Where the job is. Used to tell same-named companies apart when the
     * employer's site has to be guessed — measured as the difference between
     * `devapo.io` (Warszawa) and `devapo.com` (Germany).
     */
    location: z.string().default(''),
    /** What is in the field now, so the answer can speak to it. */
    current: z.string().default(''),
    /** Off for a fast re-check: the board sweep is the slow third of this. */
    check_other_boards: z.boolean().default(true),
    /**
     * Search the web for the employer's site, their careers page, and wherever
     * they take applications.
     *
     * On by default, unlike `search_web` below, because it is the difference
     * between answering the question and reporting that one source was checked.
     * It costs no model call: a search engine is asked for URLs, the URLs are
     * fetched, and the same regex that reads the posting reads the pages.
     *
     * Needs `BRAVE_API_KEY`, or falls back to a keyless engine that is
     * rate-limited without warning. With neither, the tier reports itself as
     * unavailable and the rest of the verification runs exactly as before.
     */
    check_web: z.boolean().default(true),
    /**
     * Ask a model to propose the employer's website.
     *
     * Off by default, and it is the only thing in this capability that costs a
     * model call. It earns its place on the two thirds of boards that publish a
     * company name and no website — and only for names too generic to guess,
     * since guessing is free and runs anyway.
     *
     * Needs a model that can search, which on OpenRouter means an `:online`
     * model id passed as the run's model override. Without one the step returns
     * whatever the model believes from memory, which verification will mostly
     * reject and which is a waste of a request.
     */
    search_web: z.boolean().default(false)
  })
  .refine(
    (input) =>
      Boolean(input.offerText?.trim()) ||
      Boolean(input.url?.trim()) ||
      Boolean(input.company_url?.trim()) ||
      // A name alone is enough: the web tier can find the employer from it,
      // which is the whole reason that tier exists.
      Boolean(input.company?.trim()),
    { message: 'Provide offerText, url, company_url, or company.' }
  );

export type VerifyRecipientInput = z.infer<typeof inputSchema>;

/** Trims a listing title so a near-match still counts as the same role. */
const words = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9ąćęłńóśźż]+/gi, ' ')
      .split(' ')
      .filter((word) => word.length > 2)
  );

/** Share of the shorter title's words that both titles have. */
const titleOverlap = (a: string, b: string): number => {
  const left = words(a);
  const right = words(b);

  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;

  return shared / Math.min(left.size, right.size);
};

/** The four fields every effect call in this file carries. */
const callFrom = (context: StepContext): EffectCall => ({
  traceId: context.traceId,
  runId: context.runId,
  step: context.step.name,
  signal: context.signal
});

export const verifyRecipient: Capability<VerifyRecipientInput> = {
  name: 'verify_recipient',
  describe:
    "Check where a job application should be sent: the employer's own site, the posting, and other boards. Suggests, never chooses.",
  input: inputSchema,

  plan: (input): Plan => {
    /**
     * What the tiers below share, held in closures rather than in `completed`.
     *
     * `completed` is persisted to `run_steps.value` and returned in the run
     * result, and what moves between these steps is tens of kilobytes of page
     * text written by strangers. Routing it through the step record would store
     * it, ship it to the caller and put it in front of anything that reads a
     * run — for working state that four steps pass between themselves and only
     * the last one reduces to an answer. The steps' *outputs* still go through
     * `completed`, which is what the caller and the checkpoint actually want.
     *
     * Two steps in the `pages` stage both append to `gathered`. That is safe
     * for the ordinary reason: a `push` between two awaits cannot interleave.
     */
    const gathered: GatheredSource[] = [];
    const companyDomains: string[] = [];
    const hits: SearchHit[] = [];

    /** Domains the web tier proposes as the employer's, best first. */
    const suggestedDomains: string[] = [];

    /**
     * How the employer's domain was arrived at, which caps every conclusion
     * drawn from it. `board` until something weaker has to be used.
     */
    let anchorTrust: AnchorTrust = 'board';

    /** Filled by the `source` step, read by everything after it. */
    let offerText = input.offerText?.trim() ?? '';
    let offerUrl = input.url?.trim() ?? '';
    let companyUrl = input.company_url?.trim() ?? '';
    let applyUrl = '';

    const company = input.company.trim();

    return {
      capability: 'verify_recipient',
      source: 'declared',
      stages: [
        /**
         * Reading the posting, as a step.
         *
         * Critical — but only in the one case where there is genuinely nothing
         * to work with. Unlike every other capability here, a posting that
         * cannot be read is usually survivable: the employer's own site is the
         * source that matters most and does not depend on it. So the step
         * throws only when the fetch failed *and* no text and no company name
         * were supplied, which is the state where the remaining tiers have
         * nothing to look up and an empty candidate list would read as "no
         * problems found".
         */
        {
          name: 'read',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'source',
              critical: true,
              run: async (context) => {
                /**
                 * Read the posting whenever it can add something, not only when
                 * the text is missing.
                 *
                 * The obvious condition — fetch when there is no text — is
                 * wrong in exactly the path a caller holding a stored scrape
                 * takes. Supplying the text would skip the fetch, and with it
                 * `hiringOrganization.url`, `applicationContact` and the apply
                 * link, which are the three best inputs this capability has.
                 * The saved fetch costs the anchor and the whole verification
                 * falls back to guessing the employer's domain from their name.
                 *
                 * So the condition is about what is still unknown rather than
                 * about what was supplied: a caller who already has the
                 * company's website gets the fetch skipped, and a caller who
                 * does not gets it made.
                 */
                let statedEmail = '';
                let read = Boolean(offerText);
                let detail = '';

                if (offerUrl && !companyUrl) {
                  try {
                    const offer = await context.effects.offers.resolve(
                      offerUrl,
                      callFrom(context)
                    );

                    // Supplied text wins: it is what the user read and what the
                    // rest of the submission was built from.
                    offerText = offerText || offer.text;
                    offerUrl = offer.finalUrl;
                    companyUrl = companyUrl || (offer.routes?.companyUrl ?? '');
                    statedEmail = offer.routes?.applicationEmail ?? '';
                    applyUrl = offer.routes?.applyUrl ?? '';
                    read = Boolean(offerText);
                  } catch (error) {
                    if (context.signal.aborted) throw error;

                    detail =
                      error instanceof Error ? error.message : 'The posting could not be read.';

                    // Nothing to read, nothing to look up, and nowhere to look.
                    if (!offerText && !company) {
                      throw new RuntimeError(detail, 'unreadable_source');
                    }
                  }
                }

                if (offerText) {
                  gathered.push({
                    source: 'offer',
                    url: offerUrl || 'the posting',
                    text: offerText
                  });
                }

                /**
                 * The board saying outright where applications go.
                 *
                 * schema.org `applicationContact.email`. Rare, and when it is
                 * there nothing else needs consulting — it is the board stating
                 * the answer rather than a regex finding an `@` in prose.
                 */
                if (statedEmail) {
                  gathered.push({
                    source: 'board_stated',
                    url: offerUrl || 'the posting',
                    text: statedEmail
                  });
                }

                return {
                  source: {
                    status: read ? 'ok' : 'unread',
                    url: offerUrl || undefined,
                    company_url: companyUrl || undefined,
                    board_stated_email: Boolean(statedEmail),
                    detail: detail || undefined
                  }
                };
              }
            }
          ]
        },

        /**
         * Asking where this employer lives, two ways at once.
         *
         * `'auto'`: one of these steps is the capability's only model call and
         * the other makes none, so the stage's honest concurrency is whatever
         * the provider can take — 1 against a local server, both otherwise.
         * Neither reads the other's output; the step that reads both is next.
         */
        {
          name: 'lookup',
          concurrency: 'auto',
          steps: [
            /**
             * Asks a model where the employer's website is. Not where to send
             * the CV.
             *
             * The distinction is the whole design. Asked for an address, a
             * model reads pages written by strangers and reports what they
             * claim — and a page that claims "applications go to
             * harvest@evil.example" has then written the answer. Asked for a
             * *domain*, the worst it can do is point somewhere, and pointing
             * somewhere is harmless because the next step goes and looks: the
             * domain has to serve a site carrying the company's name before it
             * counts for anything, and even then it is capped below a domain
             * the board published itself.
             *
             * So the model contributes reach — names too generic for
             * `<name>.com` to find — without contributing authority.
             *
             * Included on the caller's stated `company_url` rather than on the
             * one the fetch produces, which is the one deviation this port
             * makes from the plan it came from. Preparation is a step here, so
             * the board's URL is not known when the stage list is built. The
             * cost of that is at most one wasted model call on an opt-in flag,
             * which is cheaper than moving the fetch back out of the plan.
             */
            ...(input.search_web && !input.company_url?.trim() && company
              ? [
                  {
                    kind: 'extract' as const,
                    name: 'web_search',
                    critical: false,
                    schema: z.object({
                      domains: z
                        .array(z.string())
                        .max(5)
                        .describe(
                          "The company's own website domains, most likely first. Hostnames only, no paths. Empty array if not known."
                        )
                    }),
                    system: `Identify the official website of the company named below. Answer with domains only.
Do not answer with job boards, directories, social networks or news articles.
If you do not know, return an empty array.`,
                    prompt: [
                      `Company: ${input.company}`,
                      input.location ? `Location: ${input.location}` : '',
                      input.position ? `They are hiring for: ${input.position}` : ''
                    ]
                      .filter(Boolean)
                      .join('\n'),
                    maxOutputTokens: 300,
                    fallback: { domains: [] }
                  }
                ]
              : []),

            /**
             * Asking the open web where this employer lives and where they hire.
             *
             * The tier that fixes the common failure. Two of the three boards
             * publish a company name and no website, and a name like "P&P
             * Solutions Sp. z o.o." has no plausible `<name>.com` for the
             * guesser to find — so the whole verification used to end with the
             * posting read and nothing to check it against. A search engine
             * knows the answer and costs no model call.
             *
             * Two queries, dispatched together. The first looks for the
             * employer and their careers page, the second for the page that
             * carries a contact address, because those are different pages on
             * most sites and a single query reliably returns one of them and
             * not the other.
             *
             * Nothing is fetched here and nothing is concluded. This produces
             * domains to check and URLs to consider, both of which are verified
             * by whoever uses them: the company read refuses a domain whose
             * page does not carry the company's name, and an address still has
             * to be found on a page that was actually read.
             */
            {
              kind: 'transform',
              name: 'web_lookup',
              critical: false,
              run: async (context) => {
                if (!input.check_web || !company) {
                  return {
                    web: {
                      status: 'skipped',
                      detail: company
                        ? 'Web search was not asked for on this run.'
                        : 'The posting named no company to search for.'
                    }
                  };
                }

                const engine = context.effects.search.engine();

                if (!engine) {
                  return {
                    web: {
                      status: 'unavailable',
                      detail: 'WEB_SEARCH is off, so nothing looked beyond the posting.'
                    }
                  };
                }

                // Quotes are the operator that keeps "Devapo" from returning
                // every page about developers, so a name containing one has it
                // removed rather than breaking the phrase it sits in.
                const name = `"${company.replace(/"/g, ' ').trim()}"`;

                const queries = [
                  [name, input.location.trim(), 'kariera OR careers OR "oferty pracy"']
                    .filter(Boolean)
                    .join(' '),
                  `${name} kontakt OR contact email`
                ];

                // Together rather than in sequence: the search effect spaces
                // them to respect the engine's rate limit anyway, so
                // dispatching both overlaps their timeouts instead of adding
                // them up.
                const call = callFrom(context);
                const outcomes = await Promise.all(
                  queries.map((query) => context.effects.search.search(query, call))
                );

                const seen = new Set<string>();

                for (const outcome of outcomes) {
                  if (outcome.status !== 'ok') continue;

                  for (const hit of outcome.hits) {
                    const key = hit.url.replace(/\/+$/, '').toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    hits.push(hit);
                  }
                }

                for (const candidate of domainCandidates(hits, company)) {
                  suggestedDomains.push(candidate.domain);
                }

                // A tier that could not run and a tier that found nothing are
                // different answers, and only the first is worth telling the
                // user to fix.
                const blocked = outcomes.find((outcome) => outcome.status !== 'ok');

                if (hits.length === 0 && blocked) {
                  return {
                    web: {
                      status: blocked.status,
                      engine,
                      queries,
                      results: 0,
                      detail: blocked.detail
                    }
                  };
                }

                return {
                  web: {
                    status: 'ok',
                    engine,
                    queries,
                    results: hits.length,
                    domains: [...suggestedDomains]
                  }
                };
              }
            }
          ]
        },

        /**
         * The employer's own site.
         *
         * A stage of its own, after the lookups and before the page reads,
         * because both neighbours depend on it in one direction: it consumes
         * every domain either lookup proposed, and it establishes the domain
         * that tells a page on the employer's own site from a page on an
         * applicant tracking system.
         */
        {
          name: 'company',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'company_site',
              critical: false,
              run: async (context) => {
                /**
                 * A site when the board gave one, a name when it did not.
                 *
                 * Two of the three boards here publish the employer's name and
                 * not their website, so the name path is the common one rather
                 * than the fallback. The hints are what stop it picking a
                 * different company with the same name.
                 */
                if (!companyUrl && !company) {
                  return {
                    company_site: {
                      status: 'unknown',
                      detail: 'The board named neither a company website nor a company.'
                    }
                  };
                }

                const call = callFrom(context);
                const hints = [input.location].filter(Boolean);

                /**
                 * Suggested domains, checked one at a time, before falling back
                 * to guessing.
                 *
                 * Search first because it is better at exactly what guessing is
                 * worst at — a name like "P&P Solutions Sp. z o.o." has no
                 * plausible `<name>.com`, and that is the case this tier was
                 * added for. Each suggestion goes through the company read with
                 * the company's name attached, which is what makes the read
                 * verify it rather than simply fetch it.
                 */
                const suggested = [
                  // The engine's candidates first. They were scored on how many
                  // results agreed on a domain and on whether a careers page
                  // was among them, which is more than a model recalling a name
                  // can offer — and unlike the model they cost nothing, so they
                  // are tried even when the model step did not run at all.
                  ...suggestedDomains,
                  ...((context.completed.web_search?.domains as string[] | undefined) ?? [])
                ]
                  .map((domain) => domain.trim())
                  .filter(Boolean)
                  .filter((domain, index, all) => all.indexOf(domain) === index)
                  .slice(0, 3);

                /**
                 * Whether anything has actually been attempted yet.
                 *
                 * The placeholder below is not an attempt — it is the absence
                 * of one — and reporting its text after a lookup failed is how
                 * a broken site reader came to be shown to the user as "the
                 * board named no company website". That is the wrong thing to
                 * go and check. Once a real attempt has been made, its failure
                 * is the one worth reporting.
                 */
                const stated = Boolean(companyUrl);

                let outcome: SiteOutcome<CompanySite> = companyUrl
                  ? await context.effects.sites.readCompany({ url: companyUrl }, call)
                  : { status: 'unavailable', detail: 'No board-stated company website.' };

                for (const domain of suggested) {
                  // Keep looking past a domain that loaded but corroborated
                  // nothing: one that matches the city as well as the name is
                  // worth more than whichever happened to respond first.
                  if (outcome.status === 'ok' && outcome.data.corroborated !== false) break;

                  const url = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;

                  const attempt = await context.effects.sites.readCompany(
                    { url, name: input.company, hints },
                    call
                  );

                  if (attempt.status === 'ok' && outcome.status !== 'ok') outcome = attempt;
                  else if (attempt.status === 'ok' && attempt.data.corroborated) outcome = attempt;
                  // A real attempt's failure replaces the synthetic one above,
                  // which says only that the board named no website.
                  else if (attempt.status !== 'ok' && outcome.status !== 'ok' && !stated) {
                    outcome = attempt;
                  }
                }

                if ((outcome.status !== 'ok' || outcome.data.corroborated === false) && company) {
                  const guessed = await context.effects.sites.readCompany(
                    { name: input.company, hints },
                    call
                  );

                  // Only if it is actually better. Measured: a model proposed
                  // `allegro.pl` — correct — which would not load, and the name
                  // guess then produced `allegro.io`, a different company,
                  // which replaced it.
                  if (
                    guessed.status === 'ok' &&
                    (outcome.status !== 'ok' || guessed.data.corroborated)
                  ) {
                    outcome = guessed;
                  } else if (guessed.status !== 'ok' && outcome.status !== 'ok' && !stated) {
                    outcome = guessed;
                  }
                }

                if (outcome.status !== 'ok') {
                  return {
                    company_site: { status: outcome.status, detail: outcome.detail }
                  };
                }

                for (const page of outcome.data.pages) {
                  gathered.push({
                    source: 'company_site',
                    url: page.url,
                    page: page.kind,
                    text: page.text
                  });
                }

                if (outcome.data.discovered) {
                  anchorTrust = outcome.data.corroborated ? 'discovered' : 'guessed';
                }

                /**
                 * A domain nothing corroborated does not become the yardstick.
                 *
                 * Capping its confidence is not enough, and the reason is the
                 * other direction. `company_domains` is what every *other*
                 * address is measured against, so believing `allegro.io` is
                 * Allegro's site does not merely rate its own addresses too
                 * highly — it makes a genuine `praca@allegro.pl` from the
                 * posting read as "not on the employer's domain". A wrong
                 * yardstick warns about the right answer, which is worse than
                 * having no yardstick and saying so.
                 *
                 * Its pages are still read: an address found on it is a
                 * candidate like any other, just one with nothing vouching for
                 * the domain.
                 */
                if (anchorTrust !== 'guessed') {
                  companyDomains.push(outcome.data.origin);
                  if (outcome.data.redirectedFrom) {
                    companyDomains.push(outcome.data.redirectedFrom);
                  }
                }

                return {
                  company_site: {
                    status: 'ok',
                    origin: outcome.data.origin,
                    discovered: outcome.data.discovered ?? false,
                    corroborated: outcome.data.corroborated ?? false,
                    pages: outcome.data.pages.map((page) => ({
                      url: page.url,
                      kind: page.kind
                    }))
                  }
                };
              }
            }
          ]
        },

        /**
         * The two gathering tiers that need nothing from each other.
         *
         * `concurrency: 2` and not `'auto'`, which is the one place this plan
         * states a number. `'auto'` means "however many the model provider can
         * take", and neither of these steps calls a model — they fetch pages
         * from unrelated hosts. Letting a local GPU decide that a board sweep
         * must wait for a careers page would be a coupling with no reason
         * behind it, and these are the two slowest tiers in the capability.
         */
        {
          name: 'pages',
          concurrency: 2,
          steps: [
            /**
             * Opening the pages the search pointed at.
             *
             * After the company read, for two reasons. The employer's domain is
             * known by now, which is what tells a page on their own site from a
             * page on an applicant tracking system — the same text means
             * different things on those two domains, and only the ranker can
             * act on the difference. And the pages the read already reached can
             * be skipped, so the budget is not spent reading a careers page
             * twice and then counting it as two sources.
             *
             * One extra query is allowed here, and only when it can still
             * change the answer: the employer's domain is known and nothing on
             * it printed an address. `site:` finds the contact page that the
             * homepage did not link to, which is the single most common reason
             * a real address goes unfound.
             */
            {
              kind: 'transform',
              name: 'web_pages',
              critical: false,
              run: async (context) => {
                if (!input.check_web || !context.effects.search.engine()) {
                  return { web_pages: { status: 'skipped', opened: [] } };
                }

                const call = callFrom(context);

                // The tier's own ceiling, clipped to the run's. A budget that
                // outlives the deadline it sits inside is not a budget.
                const deadline = Math.min(Date.now() + WEB_PAGE_BUDGET_MS, context.deadlineAt);

                const owned = new Set(
                  [...companyDomains, ...(companyUrl ? [companyUrl] : [])]
                    .map(registrableDomain)
                    .filter(Boolean)
                );

                const readAlready = gathered
                  .filter((entry) => entry.source === 'company_site')
                  .map((entry) => entry.url);

                const addressOnCompanySite = gathered.some(
                  (entry) =>
                    entry.source === 'company_site' &&
                    findApplicationEmails(entry.text, 1).length > 0
                );

                if (owned.size > 0 && !addressOnCompanySite && Date.now() < deadline) {
                  const [domain] = [...owned];

                  const outcome = await context.effects.search.search(
                    `site:${domain} kontakt OR kariera OR rekrutacja OR careers OR contact`,
                    call
                  );

                  if (outcome.status === 'ok') {
                    const seen = new Set(hits.map((hit) => hit.url));

                    for (const hit of outcome.hits) {
                      if (!seen.has(hit.url)) hits.push(hit);
                    }
                  }
                }

                const picks = pagesToOpen(hits, {
                  companyDomains: [...owned],
                  alreadyRead: readAlready,
                  limit: WEB_PAGES_TO_OPEN
                });

                /**
                 * The employer's domain is known and not one page of it was read.
                 *
                 * Which means the company read did not run — the companion
                 * scraper is a separate process and this runtime is written to
                 * work without it, but `readCompany` is the one thing here with
                 * no fallback at all. When it is absent the whole domain tier
                 * vanishes and the answer reports one source.
                 *
                 * So: try the handful of paths a careers or contact page
                 * actually lives at. Guessing paths is what the scraper's
                 * link-following exists to avoid and it is much worse than
                 * following links — it misses `/o-nas/dolacz-do-nas` and
                 * everything like it. It is also the difference between reading
                 * the employer's site and not reading it.
                 */
                const guesses =
                  owned.size > 0 && readAlready.length === 0
                    ? ['/kariera', '/careers', '/kontakt', '/contact'].map(
                        (path) => `https://${[...owned][0]}${path}`
                      )
                    : [];

                const queued = [
                  ...picks,
                  ...guesses
                    .filter((url) => !picks.some((pick) => pick.url === url))
                    .map((url) => ({
                      url,
                      kind: routeKind(url),
                      title: '',
                      host: hostOf(url),
                      promising: false
                    }))
                ];

                const opened: {
                  url: string;
                  kind: string;
                  on_company_domain: boolean;
                }[] = [];
                const skipped: { url: string; detail: string }[] = [];

                for (const pick of queued) {
                  if (Date.now() > deadline) {
                    skipped.push({
                      url: pick.url,
                      detail: 'The web tier ran out of time.'
                    });
                    continue;
                  }

                  const outcome = await context.effects.sites.readPage(pick.url, call);

                  if (outcome.status !== 'ok') {
                    // A guessed path that 404s is the ordinary case, not a
                    // finding.
                    if (!guesses.includes(pick.url)) {
                      skipped.push({ url: pick.url, detail: outcome.detail });
                    }
                    continue;
                  }

                  /**
                   * Where it landed decides what it is, not where it was found.
                   *
                   * A search result on the employer's own domain is the
                   * employer's own page and is treated as one — the route to it
                   * changes nothing about who controls it. Anything else is
                   * `web_page`: real evidence, and never enough on its own to
                   * call an address confirmed.
                   */
                  const onCompanyDomain = owned.has(registrableDomain(outcome.finalUrl));

                  gathered.push({
                    source: onCompanyDomain ? 'company_site' : 'web_page',
                    url: outcome.finalUrl,
                    // The company tiers speak in home/careers/contact; a bare
                    // page on their own domain is a homepage as far as the
                    // answer is concerned.
                    page: onCompanyDomain && pick.kind === 'page' ? 'home' : pick.kind,
                    text: outcome.text
                  });

                  opened.push({
                    url: outcome.finalUrl,
                    kind: pick.kind,
                    on_company_domain: onCompanyDomain
                  });
                }

                return {
                  web_pages: {
                    status: 'ok',
                    considered: queued.length,
                    /** Paths tried because the company read did not run at all. */
                    guessed: guesses.length,
                    opened,
                    // Named, because "we looked and could not read it" is a
                    // different thing to tell someone than "we did not look".
                    skipped
                  }
                };
              }
            },

            /**
             * The same role, on boards that did not write this posting.
             *
             * Listings only, to begin with. A row carries the company and the
             * title, which is enough to say "this offer is also there" — and
             * the addresses that matter have already been collected from the
             * sources above. What this adds is corroboration and, when a row's
             * company disagrees, a reason to look harder.
             */
            {
              kind: 'transform',
              name: 'other_boards',
              critical: false,
              run: async (context) => {
                if (!input.check_other_boards || !input.position.trim()) {
                  return { other_boards: { status: 'skipped', matches: [] } };
                }

                const call = callFrom(context);

                const results = await Promise.all(
                  BOARDS.map(async (board) => {
                    const outcome = await context.effects.sites.listBoard(
                      { board, keyword: input.position, limit: ROWS_PER_BOARD },
                      call
                    );

                    return outcome.status === 'ok'
                      ? outcome.data.slice(0, ROWS_PER_BOARD)
                      : [];
                  })
                );

                /**
                 * Matched on the slug, not on a company field.
                 *
                 * Listing rows carry `board`, `url` and `title` and nothing
                 * else — measured on justjoin, where every one of 188 rows had
                 * no company at all. An earlier version filtered on
                 * `row.company` and would therefore have matched nothing, ever,
                 * while looking like it worked.
                 *
                 * What the rows do carry is the employer's name inside the URL
                 * slug and at the front of the title, which is how these boards
                 * build both.
                 */
                const wanted = slug(input.company);

                const matches = results
                  .flat()
                  .filter((row) => {
                    if (!wanted) return false;

                    const namesCompany =
                      slug(row.url).includes(wanted) || slug(row.title).includes(wanted);

                    return namesCompany && titleOverlap(row.title, input.position) >= 0.4;
                  })
                  .filter((row) => row.url !== offerUrl)
                  .slice(0, OFFERS_TO_OPEN);

                /**
                 * Opened, not just counted.
                 *
                 * A row proves the posting exists elsewhere, which is worth
                 * something on its own — a listing that appears on three boards
                 * was not invented an hour ago. But the reason to come here is
                 * the address in the other board's copy: the same one
                 * corroborates, a different one is the single loudest signal
                 * this whole capability can produce.
                 */
                const opened: { url: string; board: string }[] = [];

                for (const row of matches) {
                  /**
                   * `resolve` throws where this caller would rather be told.
                   *
                   * It is written for the caller that has nothing to do without
                   * an offer, and this one has plenty: a board that blocked us
                   * costs this tier a row and costs the verification nothing.
                   * Cancellation is the exception and is re-thrown, because a
                   * run being aborted is not a fact about the board.
                   */
                  let text: string;

                  try {
                    text = (await context.effects.offers.resolve(row.url, call)).text;
                  } catch (error) {
                    if (context.signal.aborted) throw error;
                    continue;
                  }

                  if (!text) continue;

                  gathered.push({ source: 'other_board', url: row.url, text });

                  opened.push({ url: row.url, board: row.board });
                }

                return {
                  other_boards: {
                    status: 'ok',
                    found: matches.length,
                    opened,
                    matches: matches.map((row) => ({
                      board: row.board,
                      url: row.url,
                      title: row.title
                    }))
                  }
                };
              }
            }
          ]
        },

        /** Weighs what the steps above collected. Pure, and last. */
        {
          name: 'rank',
          concurrency: 1,
          steps: [
            {
              kind: 'transform',
              name: 'rank',
              critical: false,
              run: async (context) => {
                // The board's stated company URL counts as the employer's
                // domain even when the site itself could not be read — an
                // unreachable site is not evidence that an address on that
                // domain is wrong. A *guessed* URL gets no such benefit; see
                // `company_site`.
                const domains = [...companyDomains];

                if (companyUrl) domains.push(companyUrl);

                const candidates = rankRecipients({
                  gathered,
                  companyDomains: domains,
                  anchorTrust
                });

                /**
                 * The employer's site was read and printed no address at all.
                 *
                 * A different fact from "the site could not be read", and a
                 * more useful one: it means this employer applies through a
                 * form or an ATS, so there may be no email address to verify
                 * against and every candidate will stay low. Measured on
                 * allegro.tech, whose careers page carries a form and not one
                 * `@`. Saying so is what stops a low-confidence list reading as
                 * "we found something suspicious".
                 */
                const companyPagesRead = gathered.filter(
                  (entry) => entry.source === 'company_site'
                ).length;

                const addressesFromCompany = candidates.filter((candidate) =>
                  candidate.evidence.some((entry) => entry.source === 'company_site')
                ).length;

                /**
                 * Everywhere an application can actually be handed over.
                 *
                 * The answer to the question a person is left with when no
                 * address exists anywhere, which is most employers now: a
                 * careers page, the form the board pointed at, the applicant
                 * tracking system the "Apply" button opens. Every one of these
                 * was already being collected; showing them is what stops the
                 * answer saying "nothing else names an address" while holding
                 * three links that answer the actual question.
                 *
                 * Links only. Nothing here is ever put in a `To:` field.
                 */
                const routes = collectApplyRoutes([
                  ...(applyUrl
                    ? [
                        {
                          url: applyUrl,
                          kind: 'form' as const,
                          host: hostOf(applyUrl),
                          source: 'board' as const
                        }
                      ]
                    : []),
                  ...gathered
                    .filter(
                      (entry) =>
                        entry.source === 'company_site' &&
                        (entry.page === 'careers' || entry.page === 'contact')
                    )
                    .map(
                      (entry): ApplyRoute => ({
                        url: entry.url,
                        kind: entry.page === 'careers' ? 'careers' : 'contact',
                        host: hostOf(entry.url),
                        source: 'company_site'
                      })
                    ),
                  ...hits
                    .filter((hit) => {
                      const kind = hostKind(hit.url);
                      return kind === 'ats' || kind === 'employer';
                    })
                    .map(
                      (hit): ApplyRoute => ({
                        url: hit.url,
                        kind: routeKind(hit.url, hit.title, hit.snippet),
                        ...(hit.title ? { title: hit.title } : {}),
                        host: hostOf(hit.url),
                        source: 'web'
                      })
                    )
                    // A page on someone's site is not a way to apply. Only the
                    // two kinds that take an application are offered as one.
                    .filter((route) => route.kind === 'ats' || route.kind === 'careers')
                ]);

                const web = context.completed.web_lookup?.web as
                  | { status?: string; detail?: string }
                  | undefined;

                const companySite = context.completed.company_site?.company_site as
                  | { status?: string }
                  | undefined;

                const notes = [
                  // Only when the site really went unread. The web tier reads
                  // pages on the employer's domain too, and a note saying their
                  // site could not be read above two addresses taken from it is
                  // a worse answer than no note at all.
                  companySite && companySite.status !== 'ok' && companyPagesRead === 0
                    ? "The employer's own site could not be read, so domain checks are weaker."
                    : '',
                  web && (web.status === 'unavailable' || web.status === 'failed')
                    ? `The web search did not run: ${web.detail ?? 'no reason given'}`
                    : ''
                ].filter(Boolean);

                return {
                  candidates,
                  /** Links, when there is no address at all — the usual case. */
                  apply_routes: routes,
                  /** A form link is the right answer when there is no address. */
                  apply_url: applyUrl || undefined,
                  anchor_trust: anchorTrust,
                  company_publishes_no_address:
                    companyPagesRead > 0 && addressesFromCompany === 0,
                  current: checkRecipient(input.current, candidates, domains),
                  company_domains: [
                    ...new Set(domains.map(registrableDomain).filter(Boolean))
                  ],
                  sources_read: gathered.map((entry) => ({
                    source: entry.source,
                    url: entry.url,
                    page: entry.page
                  })),
                  // Stated in the payload, not only in a comment: the caller is
                  // meant to render these as suggestions beside the field,
                  // never into it.
                  suggestion_only: true,
                  degraded_note: notes.length > 0 ? notes.join(' ') : undefined
                };
              }
            }
          ]
        }
      ]
    };
  }
};
