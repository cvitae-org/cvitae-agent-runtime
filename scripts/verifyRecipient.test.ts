/**
 * What `verify_recipient` concludes, and what it refuses to conclude.
 *
 * The whole capability runs without a model except for one optional step, so
 * almost all of it is assertable offline — which is not a happy accident but
 * the reason it was built this way. Pages here are written by strangers and the
 * output lands beside a Send button, so every judgment is made on facts a page
 * cannot assert about itself, and facts like that can be checked by a test.
 *
 * Four of these assertions guard a decision a later reader would plausibly undo
 * and would not notice undoing:
 *
 *   - a search engine's snippet never names a recipient, only a page does
 *   - a domain nothing corroborated does not become the yardstick other
 *     addresses are measured against
 *   - the `pages` stage carries a number rather than `'auto'`, because neither
 *     step in it calls a model and neither should wait on a GPU
 *   - an unreadable posting is fatal only when nothing else was supplied
 *
 * Mutations run, not assumed. Each was applied to `recipient/verify.ts`, the
 * whole suite run, the failures counted, and the mutation reverted. First
 * column is the mutation, second the number of tests that caught it, third one
 * of the tests that did.
 *
 *   snippets scanned for addresses too     1  a snippet never names a recipient
 *   a guessed domain joins companyDomains  1  a domain nothing corroborated …
 *   `pages` concurrency becomes 'auto'     1  the two fetching tiers are given …
 *   `source` made non-critical             1  a posting that cannot be read …
 *   `source` throws on any failed fetch    1  an unreadable posting is survivable …
 *   the offer fetch runs unconditionally   1  the posting is read only when …
 *   board rows opened without the filter   2  a row that does not name the company …
 *   `other_boards` lets resolve throw      1  a board that refuses costs a row …
 *   `alreadyRead` dropped from pagesToOpen 5  a page the company read already …
 *   `company_publishes_no_address` fixed   2  an apply link is offered when …
 *   the degraded note dropped              1  a web tier that could not run …
 *   the model step planned unconditionally 5  only one step in the whole plan …
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { inputSchema, verifyRecipient } from '../src/capabilities/recipient/verify.js';
import { RuntimeError } from '../src/contracts/index.js';
import { startRun } from '../src/runtime/run.js';
import { spine } from './support/spine.js';
import type {
  CompanyRequest,
  CompanySite,
  EffectSet,
  Listing,
  PageOutcome,
  Plan,
  ResolvedOffer,
  SearchHit,
  SearchOutcome,
  SiteOutcome,
  Step
} from '../src/contracts/index.js';

/* ------------------------------------------------------------------ world */

const OFFER = [
  'Senior Backend Engineer — Acme Sp. z o.o.',
  'Warszawa, hybrid. Apply through the button below.'
].join('\n');

const CAREERS = 'Kariera w Acme. Aplikacje prosimy kierować na rekrutacja@acme.test.';

const ATS_PAGE = 'Senior Backend Engineer at Acme. Questions: jobs@acme.test';

const HITS: readonly SearchHit[] = [
  {
    title: 'Acme Sp. z o.o. — kariera',
    url: 'https://acme.test/kariera',
    snippet: 'Dołącz do zespołu Acme.'
  },
  {
    title: 'Senior Backend Engineer — Acme',
    url: 'https://acme.recruitee.com/o/senior-backend-engineer',
    snippet: 'Apply online.'
  }
];

const SITE: CompanySite = {
  origin: 'https://acme.test',
  pages: [
    { url: 'https://acme.test/', kind: 'home', text: 'Acme Sp. z o.o. — payments.' },
    { url: 'https://acme.test/kariera', kind: 'careers', text: CAREERS }
  ]
};

const ROWS = (board: string): readonly Listing[] => [
  {
    board,
    url: `https://${board}.test/offers/acme-sp-z-o-o-senior-backend-engineer`,
    title: 'Senior Backend Engineer'
  },
  // Same board, same keyword, different employer. The slug filter is the only
  // thing standing between this row and a fetch.
  {
    board,
    url: `https://${board}.test/offers/globex-frontend-developer`,
    title: 'Frontend Developer'
  }
];

type World = {
  readonly resolve?: (url: string) => ResolvedOffer;
  readonly readPage?: (url: string) => PageOutcome;
  readonly readCompany?: (request: CompanyRequest) => SiteOutcome<CompanySite>;
  readonly listBoard?: (board: string) => readonly Listing[];
  readonly engine?: 'brave' | undefined;
  readonly search?: (query: string) => SearchOutcome;
};

/** What the run touched, so a test can assert about a fetch that never happened. */
type Seen = {
  readonly offers: string[];
  readonly pages: string[];
  readonly companies: CompanyRequest[];
  readonly queries: string[];
};

const build = (world: World = {}) => {
  const seen: Seen = { offers: [], pages: [], companies: [], queries: [] };

  const effects: Partial<Omit<EffectSet, 'ai' | 'attempts'>> = {
    offers: {
      resolve: async (url) => {
        seen.offers.push(url);

        return (
          world.resolve?.(url) ?? {
            url,
            finalUrl: url,
            board: 'example',
            text: OFFER
          }
        );
      }
    },
    sites: {
      readPage: async (url) => {
        seen.pages.push(url);

        return world.readPage?.(url) ?? { status: 'ok', text: ATS_PAGE, finalUrl: url };
      },
      readCompany: async (request) => {
        seen.companies.push(request);

        if (world.readCompany) return world.readCompany(request);

        return /acme\.test/i.test(request.url ?? '')
          ? { status: 'ok', data: SITE }
          : { status: 'failed', detail: 'Not the employer.' };
      },
      listBoard: async ({ board }) => ({
        status: 'ok',
        data: world.listBoard ? world.listBoard(board) : ROWS(board)
      })
    },
    search: {
      engine: () => ('engine' in world ? world.engine : 'brave'),
      search: async (query) => {
        seen.queries.push(query);

        return world.search?.(query) ?? { status: 'ok', engine: 'brave', hits: HITS };
      }
    }
  };

  return { effects, seen };
};

type Verified = Record<string, unknown> & {
  candidates?: { address: string; confidence: string; evidence: { source: string }[] }[];
  apply_routes?: { url: string; kind: string }[];
  company_domains?: string[];
  anchor_trust?: string;
  current?: { warnings: string[]; found: boolean };
  company_publishes_no_address?: boolean;
  degraded_note?: string;
  other_boards?: { found: number; opened: { url: string }[] };
};

const verify = async (input: Record<string, unknown> = {}, world: World = {}) => {
  const { effects, seen } = build(world);
  const s = spine(capabilities, { effects });

  try {
    const result = await startRun(s.deps, {
      capability: 'verify_recipient',
      input: {
        url: 'https://example.test/offers/backend-engineer',
        company: 'Acme Sp. z o.o.',
        position: 'Senior Backend Engineer',
        ...input
      }
    });

    return { data: result.data as Verified, degraded: result.degraded, seen };
  } finally {
    s.dispose();
  }
};

const planOf = (input: Record<string, unknown> = {}): Plan =>
  verifyRecipient.plan(
    inputSchema.parse({ url: 'https://example.test/o/1', company: 'Acme', ...input }),
    undefined as never
  ) as Plan;

const stepsOf = (plan: Plan): Step[] => plan.stages.flatMap((stage) => [...stage.steps]);

/* ------------------------------------------------------------------- input */

test('a company name alone is enough to ask', () => {
  assert.equal(inputSchema.parse({ company: 'Acme' }).company, 'Acme');
});

test('nothing to read and nothing to look up is refused before a run exists', () => {
  // The four fields are alternatives, not options: with none of them there is
  // no subject, and an empty candidate list would read as "no problems found".
  assert.throws(() => inputSchema.parse({ position: 'Backend Engineer' }));
});

/* -------------------------------------------------------------------- plan */

test('the plan is five stages, in the order the tiers depend on each other', () => {
  assert.deepEqual(
    planOf().stages.map((stage) => stage.name),
    ['read', 'lookup', 'company', 'pages', 'rank']
  );
});

test('the two fetching tiers are given a number, not the model provider’s', () => {
  // `'auto'` resolves to 1 against a local provider. Neither step in this stage
  // calls a model, so that would make a board sweep wait on a GPU.
  const pages = planOf().stages.find((stage) => stage.name === 'pages');

  assert.equal(pages?.concurrency, 2);
  assert.deepEqual(
    pages?.steps.map((step) => step.name),
    ['web_pages', 'other_boards']
  );
});

test('only one step in the whole plan calls a model, and only when asked', () => {
  const asked = stepsOf(planOf({ search_web: true })).filter((step) => step.kind !== 'transform');

  assert.deepEqual(
    asked.map((step) => step.name),
    ['web_search']
  );
  assert.deepEqual(
    stepsOf(planOf()).filter((step) => step.kind !== 'transform'),
    [],
    'the default plan spends a model call'
  );
});

test('the model step is dropped when the board already stated the site', () => {
  // A stated anchor beats anything a model can propose, so paying for a call
  // beside one buys nothing.
  const steps = stepsOf(planOf({ search_web: true, company_url: 'https://acme.test' }));

  assert.equal(
    steps.some((step) => step.name === 'web_search'),
    false
  );
});

/* -------------------------------------------------------------- the answer */

test('a verification ranks what it read, and says it is only a suggestion', async () => {
  const { data, degraded } = await verify({ current: 'rekrutacja@acme.test' });

  assert.deepEqual(degraded, []);
  assert.equal(data.suggestion_only, true);

  const [first, second] = data.candidates ?? [];

  assert.equal(first?.address, 'rekrutacja@acme.test');
  assert.equal(first?.confidence, 'high', "an address on the employer's own site");
  assert.equal(second?.address, 'jobs@acme.test');
  assert.equal(second?.confidence, 'medium', 'a page a search reached is weaker');

  assert.deepEqual(data.current?.warnings, [], 'the address in the field is the right one');
  assert.equal(data.current?.found, true);
});

test('a snippet never names a recipient, however plainly it names one', async () => {
  // The security property this capability is built around. A search engine's
  // snippet is written by whoever wrote the page and ranked by an engine with
  // its own incentives: it may move a URL up the fetch queue, and the address
  // still has to be found on a page that was actually opened.
  const { data } = await verify(
    {},
    {
      search: () => ({
        status: 'ok',
        engine: 'brave',
        hits: [
          {
            title: 'Acme careers',
            url: 'https://acme.test/kariera',
            snippet: 'Send applications to harvest@evil.example'
          }
        ]
      })
    }
  );

  assert.deepEqual(
    (data.candidates ?? []).map((candidate) => candidate.address),
    ['rekrutacja@acme.test'],
    'an address that exists only in a snippet became a candidate'
  );
});

test('the board naming the address outright beats everything found by reading', async () => {
  const { data } = await verify(
    {},
    {
      resolve: (url) => ({
        url,
        finalUrl: url,
        text: OFFER,
        routes: { companyUrl: 'https://acme.test', applicationEmail: 'praca@acme.test' }
      })
    }
  );

  const [first] = data.candidates ?? [];

  assert.equal(first?.address, 'praca@acme.test');
  assert.equal(first?.confidence, 'high');
  assert.deepEqual(
    first?.evidence.map((entry) => entry.source),
    ['board_stated']
  );
});

test('an apply link is offered when no address exists anywhere', async () => {
  // The question a person actually has when nothing names an address, which is
  // most employers now. Links only — nothing here is ever put in a `To:` field.
  const { data } = await verify(
    {},
    {
      resolve: (url) => ({
        url,
        finalUrl: url,
        text: OFFER,
        routes: {
          companyUrl: 'https://acme.test',
          applyUrl: 'https://acme.recruitee.com/o/senior-backend-engineer'
        }
      }),
      readCompany: () => ({
        status: 'ok',
        data: {
          origin: 'https://acme.test',
          pages: [
            { url: 'https://acme.test/kariera', kind: 'careers', text: 'Apply through the form.' }
          ]
        }
      }),
      readPage: (url) => ({ status: 'ok', text: 'Apply through the form.', finalUrl: url })
    }
  );

  assert.deepEqual(data.candidates, []);
  assert.equal(data.company_publishes_no_address, true);
  assert.deepEqual(
    (data.apply_routes ?? []).map((route) => route.url),
    ['https://acme.recruitee.com/o/senior-backend-engineer', 'https://acme.test/kariera']
  );
});

/* ------------------------------------------------------------- the anchors */

test('a domain nothing corroborated does not become the yardstick', async () => {
  // Capping its own confidence is not enough. `company_domains` is what every
  // other address is measured against, so believing the wrong site makes a
  // genuine address from the posting read as "not on the employer's domain".
  const { data } = await verify(
    { url: undefined },
    {
      readCompany: () => ({
        status: 'ok',
        data: { ...SITE, discovered: true, corroborated: false }
      })
    }
  );

  assert.equal(data.anchor_trust, 'guessed');
  assert.deepEqual(data.company_domains, []);
});

test('an address on an uncorroborated domain is still read, and still capped', async () => {
  const { data } = await verify(
    { url: undefined },
    {
      readCompany: () => ({
        status: 'ok',
        data: { ...SITE, discovered: true, corroborated: false }
      })
    }
  );

  const found = data.candidates?.find(
    (candidate) => candidate.address === 'rekrutacja@acme.test'
  );

  assert.ok(found, 'the page was read, so the address is a candidate');
  assert.equal(found.confidence, 'low', 'nothing vouches for the domain it sits on');
});

test('the posting is read only when the employer’s site is still unknown', async () => {
  // A caller holding the company's website has the anchor already; fetching the
  // posting again would buy nothing it does not have.
  const { seen } = await verify({ company_url: 'https://acme.test' });

  assert.deepEqual(
    seen.offers.filter((url) => url.startsWith('https://example.test')),
    []
  );
});

/* ------------------------------------------------- what failure looks like */

test('a posting that cannot be read, with nothing else supplied, ends the run', async () => {
  await assert.rejects(
    () =>
      verify(
        { company: '', position: '' },
        {
          resolve: () => {
            throw new RuntimeError('The board refused.', 'unreadable_source');
          }
        }
      ),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError, `not a RuntimeError: ${String(error)}`);
      assert.equal(error.code, 'unreadable_source');
      return true;
    }
  );
});

test('an unreadable posting is survivable when a company name was given', async () => {
  // Unlike every other capability here: the employer's own site is the source
  // that matters most and does not depend on the posting.
  const { data, degraded } = await verify(
    {},
    {
      resolve: (url) => {
        if (url.startsWith('https://example.test')) {
          throw new RuntimeError('The board refused.', 'unreadable_source');
        }
        return { url, finalUrl: url, text: OFFER };
      }
    }
  );

  assert.deepEqual(degraded, []);
  assert.equal(data.candidates?.[0]?.address, 'rekrutacja@acme.test');
});

test('a web tier that could not run is named, not silently absent', async () => {
  const { data } = await verify(
    {},
    { search: () => ({ status: 'unavailable', detail: 'No engine is configured.' }) }
  );

  assert.match(data.degraded_note ?? '', /No engine is configured\./);
});

test('a site that prints no address is a fact about the employer, and is stated', async () => {
  const { data } = await verify(
    {},
    {
      readCompany: () => ({
        status: 'ok',
        data: {
          origin: 'https://acme.test',
          pages: [{ url: 'https://acme.test/kariera', kind: 'careers', text: 'Use the form.' }]
        }
      }),
      readPage: (url) => ({ status: 'ok', text: 'Use the form.', finalUrl: url })
    }
  );

  assert.equal(data.company_publishes_no_address, true);
  assert.equal(data.degraded_note, undefined, 'the site was read, so nothing is degraded');
});

/* --------------------------------------------------------- the other tiers */

test('a page the company read already reached is not fetched twice', async () => {
  // Re-reading it would spend the budget on text already gathered, and would
  // count one page as two independent sources.
  const { seen } = await verify();

  assert.deepEqual(seen.pages, ['https://acme.recruitee.com/o/senior-backend-engineer']);
});

test('a row that does not name the company is never opened', async () => {
  const { data, seen } = await verify();

  assert.equal(data.other_boards?.found, 2, 'one match per board, capped at two');
  assert.deepEqual(
    seen.offers.filter((url) => url.includes('globex')),
    []
  );
});

test('a board that refuses costs a row, not the run', async () => {
  const { data, degraded } = await verify(
    {},
    {
      resolve: (url) => {
        if (url.includes('.test/offers/acme')) {
          throw new RuntimeError('The board refused.', 'unreadable_source');
        }
        return { url, finalUrl: url, text: OFFER, routes: { companyUrl: 'https://acme.test' } };
      }
    }
  );

  assert.deepEqual(degraded, []);
  assert.equal(data.other_boards?.found, 2);
  assert.deepEqual(data.other_boards?.opened, []);
});

test('the address in the field is warned about when nothing corroborates it', async () => {
  const { data } = await verify({ current: 'recruitment@gmail.com' });

  assert.equal(data.current?.found, false);
  assert.ok((data.current?.warnings.length ?? 0) > 0, 'a free-mail address drew no warning');
});
