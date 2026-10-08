/**
 * What a capability needs in order to be walked once, offline.
 *
 * Tier 0 of the eval ladder: no labels, no scoring, no model, no network. The
 * question is only whether the whole path still works — router to plan to steps
 * to aggregate to a terminal run row with its events behind it. That is a low
 * bar and it is the bar that a refactor of `core/` breaks.
 *
 * The reason it lives here rather than in an `evals/` directory: this is a
 * pass/fail test that belongs in `pnpm check` on every commit, and it needs
 * neither a labelled fixture nor a judgment about quality. Scoring an answer
 * against a known-good one is a different activity with a different cadence,
 * and it can have the directory when it exists.
 *
 * A fixture here is deliberately thin. Everything derivable from the capability
 * is derived — step schemas answer themselves through `sampleOf` — so what is
 * left is only what nobody could infer: a valid input, and stubs for whatever
 * the capability reads from the outside world.
 *
 * The registry is checked for completeness by the test. Porting a capability
 * without adding a line here fails the build, which is the only mechanism that
 * keeps a smoke suite honest as the map grows.
 */

import { capabilities } from '../../src/capabilities/index.js';
import { defaultTools } from '../../src/tools/index.js';
import { createToolRegistry } from '../../src/tools/registry.js';
import { sampleOf } from './sample.js';
import type {
  AiGateway,
  EffectSet,
  ResolvedOffer,
  SourceText,
  StatedFacts,
  StatedRoutes,
  TextRequest
} from '../../src/contracts/index.js';

/* ------------------------------------------------------------------ answers */

/**
 * A gateway that answers any step from the step's own declaration.
 *
 * Worth being explicit about what this does and does not prove. It does not
 * prove a model can produce these shapes — that is tier 1's job, against a
 * recorded run. It proves that whatever comes back is carried correctly: parsed
 * against the schema, folded by the aggregator, written to a step row, and
 * present in the result. Every one of those is a place a refactor breaks
 * silently, and none of them needs a real answer to exercise.
 */
/**
 * A protocol-shaped answer for a step that declared the protocol.
 *
 * The same move `generateObject` makes with `sampleOf`, one level down. A
 * generate step normally accepts any prose, so a fixed sentence carries it — but
 * `generate_evidence_summary` declares a format in its system prompt and throws
 * out everything that does not match, which is the point of the capability and
 * would make a fixed sentence fail every time. So the stub reads the ids out of
 * the prompt the step actually built and cites two of them.
 *
 * That keeps the smoke suite testing what it says it tests. It is still not a
 * claim that a model produces this — it is a claim that a well-formed answer is
 * parsed, checked, aggregated and stored, which is exactly the path a refactor
 * breaks. A wrong answer is `claims.ts`'s business, and it has its own file.
 *
 * The sentences carry no digits on purpose: the review refuses a number its
 * cited facts do not state, and a stub tripping that check would be reporting
 * on itself rather than on the runtime.
 */
const citedSample = (request: TextRequest): string | undefined => {
  if (!request.system.includes('EVIDENCE(')) return undefined;

  const ids = [...request.prompt.matchAll(/^(\S+) \| /gmu)].map((match) => match[1] ?? '');
  const facts = ids.filter((id) => id && !id.startsWith('req:')).slice(0, 2);
  const requirement = ids.find((id) => id.startsWith('req:')) ?? 'req:0';

  if (facts.length < 2) return undefined;

  return [
    `EVIDENCE(${facts[0]}) REQUIREMENTS(${requirement}) :: Sample claim about the candidate, `
      + 'produced without a model and long enough to clear the floor.',
    `EVIDENCE(${facts[1]}) REQUIREMENTS(${requirement}) :: A second sample claim, also produced `
      + 'without a model.'
  ].join('\n');
};

export const smokeGateway = (): AiGateway => ({
  generateObject: async (request) => ({
    object: sampleOf(request.schema),
    finishReason: 'stop',
    usage: {}
  }),
  generateText: async (request) => ({
    text: citedSample(request) ?? 'Sample text, produced without a model.',
    finishReason: 'stop',
    usage: {}
  }),
  transcribeImage: async () => ({
    text: 'Sample transcription, produced without a model.',
    finishReason: 'stop',
    usage: {}
  }),
  runToolLoop: async () => ({
    text: 'Sample answer, produced without a model.',
    steps: 1,
    finishReason: 'stop',
    usage: {}
  }),
  embed: async (request) => ({
    vectors: request.values.map(() => Float32Array.from([1, 0])),
    provider: 'local',
    model: 'smoke',
    dim: 2
  }),
  describe: () => ({ providerId: 'local', modelId: 'smoke' })
});

/**
 * The registry the runtime ships, because a plan built over no tools is not the
 * plan that runs.
 *
 * Nothing in this file calls a tool — the stubbed loop returns its answer
 * without one — so what this proves is narrower than it looks and is still
 * worth proving: that every tool a capability asks for is registered under the
 * name it asked for. `handles` throws on an unknown name, and a smoke run is
 * where that surfaces rather than mid-loop against a live model.
 */
export const smokeTools = () => createToolRegistry(defaultTools);

/* ----------------------------------------------------------------- fixtures */

export type Smoke = {
  /** A call the capability's own input schema accepts. */
  readonly input: Record<string, unknown>;
  /** Only what this capability actually reads. The rest keeps throwing. */
  readonly effects?: Partial<Omit<EffectSet, 'ai' | 'attempts'>>;
  /**
   * Steps allowed to degrade on this input, each with the reason.
   *
   * Empty for a capability whose every step can be answered from a stub. A name
   * here is a claim that the gap is expected — anything else degrading fails.
   */
  readonly degrades?: Readonly<Record<string, string>>;
  /**
   * This capability's `plan()` reads the run context, so it gets a real one.
   *
   * Every other plan is built from the input alone, and the test proves that by
   * handing `plan()` an object that throws on any read. A model-planned
   * capability is the deliberate exception: it asks the registry what tools
   * exist and asks the gateway which of them are relevant, both of which are
   * built before any step runs. Declaring it here keeps the proxy's claim true
   * of everything that has not declared it.
   */
  readonly plansWithTheModel?: true;
};

/** A posting with enough in it that the extraction steps have something to read. */
const OFFER_TEXT = [
  'Senior Backend Engineer — Acme Sp. z o.o.',
  '',
  'Warszawa, hybrid (2 days on site). B2B, 18 000 – 24 000 PLN net.',
  'Stack: TypeScript, Node.js, PostgreSQL, Kubernetes.',
  'You will own the billing service and mentor two engineers.',
  'Benefits: private healthcare, Multisport, four paid conference days.'
].join('\n');

/** What a board published as data, so the overlay stage has real work to do. */
const STATED: StatedFacts = {
  company: 'Acme Sp. z o.o.',
  title: 'Senior Backend Engineer',
  location: 'Warszawa',
  work_mode: 'hybrid',
  salary: '18 000 – 24 000 PLN net B2B',
  required_skills: ['TypeScript', 'PostgreSQL']
};

/**
 * A CV with a summary paragraph, so the one step that parses rather than
 * prompts has something real to find. Everything else on this page is answered
 * from its own schema, but `role_description` reads the corpus directly — give
 * it nothing and it correctly returns an empty string, and the assertion that
 * the step ran would pass without the parser ever having worked.
 */
const CV_TEXT = [
  'Ada Lovelace',
  'ada@example.test · Warszawa',
  '',
  'Summary',
  '',
  'Backend engineer with eight years on payment systems, mostly TypeScript and',
  'PostgreSQL. Comfortable owning a service end to end, from schema to on-call.',
  '',
  'Experience',
  '',
  'Acme Sp. z o.o. — Senior Backend Engineer, 2019 – present',
  'Rewrote the billing pipeline and halved p99 latency.'
].join('\n');

/**
 * Reads a source without a PDF parser or a vision model.
 *
 * Only the `text` branch is answered, which is the branch the fixture drives.
 * A `bytes` source here would be asserting something about `unpdf` or about a
 * transcription call, and neither belongs on a rung that runs offline in
 * milliseconds — `sources.test.ts` covers the readers themselves.
 */
const sourceReader = (): Pick<EffectSet, 'sources'> => ({
  sources: {
    through() {
      return this;
    },
    read: async (input): Promise<SourceText> => {
      if (input.kind !== 'text') {
        throw new Error(`the smoke reader has no answer for ${input.mime}`);
      }
      return { text: input.text, via: 'plain' };
    }
  }
});

/**
 * A CV to translate, shaped by what the sampler can answer rather than by
 * realism, and every constraint here is one of the capability's own guards
 * pointed back at it.
 *
 * `sampleOf` returns the literal string `sample` for every string and exactly
 * one element for every array, so the source must have exactly one job, one
 * education entry, one certificate and one language, or `sameLength` correctly
 * refuses the answer. And no translated field may contain a digit: `sample` has
 * none, so `numberDrift` reports any figure in the source as lost. Hence the
 * empty `started` dates and the `null` finishes — which is not a dodge, because
 * a `null` end date takes the branch that copies rather than translates, and
 * that branch is worth walking.
 *
 * The document is passed in rather than stored first. The spine opens an empty
 * database, so the `read` step would throw its "no stored CV" error, and the
 * input branch is the one that needs no fixture outside this file.
 */
const CV_TO_TRANSLATE = {
  personal: {
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    phone: '',
    location: 'Warszawa',
    links: {}
  },
  role_description: 'Backend engineer working on payment systems.',
  skills: {
    role: 'Backend Engineer',
    programming_languages: ['TypeScript'],
    frameworks: [],
    libraries_and_tools: []
  },
  experience: [
    {
      company: 'Acme Sp. z o.o.',
      title: 'Senior Backend Engineer',
      started: '',
      finished: null,
      highlights: ['Rewrote the billing pipeline.'],
      skills: ['TypeScript']
    }
  ],
  education: [
    { university: 'Cambridge', degree: 'MSc', started: '', finished: null, thesis: '', mark: '' }
  ],
  certificates: [
    { name: 'Certified Kubernetes Administrator', issuer: 'CNCF', started: '', finished: null }
  ],
  languages: [{ name: 'Polish', level: 'native' }]
};

/**
 * A candidate handed in rather than read from the store.
 *
 * The spine opens an empty database, so the projection step would throw its
 * "no stored CV" error — and that branch has its own test. This one carries
 * real highlights because the retrieval fallback is the path this fixture
 * actually takes: the index is empty, so search returns nothing and the letter
 * is written from these bullets in CV order. Give it none and the prompt is
 * assembled from an empty section without the assertion noticing.
 */
const APPLICANT = {
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  phone: '+48 600 000 000',
  role: 'Senior Backend Engineer',
  summary: 'Backend engineer with eight years on payment systems.',
  skills: ['TypeScript', 'PostgreSQL', 'Kubernetes'],
  experience: [
    {
      company: 'Acme Sp. z o.o.',
      title: 'Senior Backend Engineer',
      highlights: [
        'Rewrote the billing pipeline and halved p99 latency.',
        'Mentored two engineers through their first on-call rotation.'
      ]
    }
  ]
};

const offerReader = (routes?: StatedRoutes): Pick<EffectSet, 'offers'> => ({
  offers: {
    resolve: async (url): Promise<ResolvedOffer> => ({
      url,
      finalUrl: url,
      board: 'example',
      text: OFFER_TEXT,
      stated: STATED,
      ...(routes ? { routes } : {})
    })
  }
});

/* ------------------------------------------------- the verification fixture */

/**
 * The employer's careers page, carrying an address.
 *
 * It has to carry one, because the interesting half of `verify_recipient` only
 * happens when there is something to rank: a page with no `@` walks the same
 * steps and produces an empty candidate list, which would pass the assertion
 * that the run finished while proving nothing about the ranking it exists for.
 */
const COMPANY_CAREERS = [
  'Kariera w Acme',
  '',
  'Rekrutujemy na stanowiska backendowe.',
  'Aplikacje prosimy kierować na rekrutacja@acme.test.'
].join('\n');

/** A page on somebody else's domain, which is what makes it weak evidence. */
const ATS_PAGE = [
  'Senior Backend Engineer at Acme Sp. z o.o.',
  'Apply through the form below. Questions: jobs@acme.test'
].join('\n');

/**
 * One result set, covering the three host kinds the router sorts by.
 *
 * The employer's own careers page (which the company read already reached, so
 * it is skipped rather than fetched twice), an applicant tracking system (which
 * is opened, and becomes an apply route), and a board (which is dropped here
 * because the cross-check tier owns boards). A fixture with one hit would walk
 * the same code and check none of that.
 */
const SEARCH_HITS = [
  {
    title: 'Acme Sp. z o.o. — kariera',
    url: 'https://acme.test/kariera',
    snippet: 'Dołącz do zespołu Acme.'
  },
  {
    title: 'Senior Backend Engineer — Acme',
    url: 'https://acme.recruitee.com/o/senior-backend-engineer',
    snippet: 'Apply online.'
  },
  {
    title: 'Acme on Vacancies',
    url: 'https://vacancies.example/offers/acme-sp-z-o-o',
    snippet: 'Board listing.'
  }
];

/**
 * The outside world a verification reads: pages, a company site, board rows and
 * a search engine.
 *
 * `readCompany` answers only for the employer's own domain and refuses
 * everything else, which is the one behaviour a stub here must not fake. The
 * capability tries the board's stated URL, then whatever the search and the
 * model proposed, and a stub that said "ok" to all of them would make the
 * ordering between those three untestable — every branch would look correct.
 *
 * `listBoard` returns a matching row and a non-matching one for the same
 * reason: the slug-and-title filter is the whole of that tier, and a fixture
 * where everything matches never runs it.
 */
const verificationWorld = (): Pick<EffectSet, 'sites' | 'search'> => ({
  sites: {
    readPage: async (url) => ({ status: 'ok', text: ATS_PAGE, finalUrl: url }),
    readCompany: async (request) => {
      const url = request.url ?? '';

      if (!/acme\.test/i.test(url)) {
        return {
          status: 'failed',
          detail: `${url || request.name || 'that name'} is not the employer's site.`
        };
      }

      return {
        status: 'ok',
        data: {
          origin: 'https://acme.test',
          pages: [
            {
              url: 'https://acme.test/',
              kind: 'home',
              text: 'Acme Sp. z o.o. — payments infrastructure.'
            },
            { url: 'https://acme.test/kariera', kind: 'careers', text: COMPANY_CAREERS }
          ]
        }
      };
    },
    listBoard: async ({ board }) => ({
      status: 'ok',
      data: [
        {
          board,
          url: `https://${board}.test/offers/acme-sp-z-o-o-senior-backend-engineer`,
          title: 'Senior Backend Engineer'
        },
        {
          board,
          url: `https://${board}.test/offers/globex-frontend-developer`,
          title: 'Frontend Developer'
        }
      ]
    })
  },
  search: {
    engine: () => 'brave',
    search: async () => ({ status: 'ok', engine: 'brave', hits: SEARCH_HITS })
  }
});

/**
 * One entry per registered capability.
 *
 * `analyze_offer` is driven through its URL branch rather than by pasting text
 * into `offerText`. Both are valid inputs; the URL branch is the one that
 * reaches an effect, writes an attempt record and produces a `stated` overlay,
 * so it exercises all three stages instead of skipping the first.
 *
 * `extract_cv` runs with `persist` on, so the walk goes all the way through
 * `DocumentStore.update` and the merge rather than stopping at a preview. That
 * is the half of the capability with a write in it, and the half a refactor of
 * the store would break.
 *
 * `translate_cv` is given its document rather than reading one, and every
 * section is translated rather than a subset — the `sections` filter changes
 * which steps are planned, and a fixture that used it would leave four of the
 * seven prompts unwalked.
 *
 * `draft_application` runs through the URL branch too, and is handed a
 * candidate rather than reading one. It is the only fixture whose result is
 * assembled by the capability's own `aggregate` instead of a merge, so what the
 * walk proves here is that the promise the capability makes unconditionally —
 * `confirmation_required` — survives the fold. The stubbed body is six words,
 * so the review step reports it as too short; that is a warning in the payload,
 * not a degradation, and the fixture expects none.
 *
 * One thing the sampled answers do that is worth knowing rather than
 * discovering: every string it produces is the same placeholder, so the
 * certificate and language guards — which reject anything the CV also lists as
 * a technical skill — reject their own sampled entries, and both arrays arrive
 * empty. Nothing is wrong; the guards are doing exactly what they are for. It
 * does mean this rung says nothing about those two filters, and the tests that
 * do are the ones written against real strings.
 */
export const smokes: Readonly<Record<string, Smoke>> = {
  detect_offer_language: { input: { text: OFFER_TEXT } },
  draft_application_fields: { input: { fields: [], facts: { 'profile.personal.name': 'Ada Lovelace' }, offer: OFFER_TEXT, company: 'Acme', page: 'Application form', language: 'en' } },
  analyze_offer: {
    input: { url: 'https://example.test/offers/backend-engineer' },
    effects: offerReader()
  },
  extract_cv: {
    input: { sources: [{ kind: 'text', label: 'cv.txt', text: CV_TEXT }], persist: true },
    effects: sourceReader()
  },
  translate_cv: {
    input: {
      source_language: 'en',
      target_language: 'pl',
      document: CV_TO_TRANSLATE
    }
  },
  ask_profile: {
    /**
     * A follow-up rather than a first question, so the walk carries a window
     * and a note through the plan and into the loop. A fixture with neither
     * would leave the only fields on this capability that grow with use
     * unwalked, and they are the ones a refactor of the prompt would break.
     */
    input: {
      question: 'And the second one?',
      history: [
        { role: 'user', text: 'What have I worked on that involved payment systems?' },
        { role: 'assistant', text: 'The billing pipeline at Acme.' }
      ],
      summary: 'GOAL: position for a backend role.'
    },
    plansWithTheModel: true
  },
  summarize_conversation: {
    input: {
      summary: '',
      turns: [
        { role: 'user', text: 'What have I worked on that involved payment systems?' },
        { role: 'assistant', text: 'The billing pipeline at Acme.' }
      ]
    }
  },
  edit_cv: {
    /**
     * No document, which walks the branch that needs no fixture: the spine
     * opens an empty database, so the read step proposes over an empty CV —
     * which is what dictating the first line of one does.
     *
     * The section is not named either, so the routing call runs. `sampleOf`
     * answers it from the enum, which is the reason that schema is an enum: a
     * bare string would sample as the placeholder, fail `isSection`, and this
     * fixture would prove only that a refusal works.
     *
     * A conversation rides along for the same reason `ask_profile`'s fixture
     * carries one: it reaches both model calls here — the routing one and the
     * revising one — and a fixture without it would leave the branch that
     * assembles it unwalked.
     */
    input: {
      instruction: 'My name is Ada Lovelace and I am in Warszawa.',
      history: [
        { role: 'user', text: 'Where does it say I live?' },
        { role: 'assistant', text: 'Your CV gives no location.' }
      ],
      summary: 'GOAL: a CV that says where they are.'
    },
    plansWithTheModel: true
  },
  generate_evidence_summary: {
    input: {
      offer: {
        position: 'Senior Backend Engineer',
        company: 'Acme Sp. z o.o.',
        required_skills: ['TypeScript', 'PostgreSQL'],
        responsibilities: ['Own the billing service']
      },
      max_chars: 200,
      document: CV_TO_TRANSLATE
    }
  },
  draft_application: {
    input: {
      url: 'https://example.test/offers/backend-engineer',
      offer: {
        position: 'Senior Backend Engineer',
        company: 'Acme Sp. z o.o.',
        required_skills: ['TypeScript', 'PostgreSQL'],
        how_to_apply: 'Send your CV to rekrutacja@acme.test.'
      },
      candidate: APPLICANT
    },
    effects: offerReader()
  },
  verify_recipient: {
    /**
     * The URL branch, with `search_web` on.
     *
     * Both are deliberate. The URL branch is the one that reads the posting and
     * picks up the board's stated company site and apply link, which are the
     * three inputs every later tier is built on — pasting text instead would
     * leave the capability guessing the employer's domain from a name and would
     * never walk the anchor it normally has. And `search_web` is off by default
     * because it is the one model call here, which makes it the one step a
     * default fixture would leave unwalked.
     */
    input: {
      url: 'https://example.test/offers/backend-engineer',
      company: 'Acme Sp. z o.o.',
      position: 'Senior Backend Engineer',
      location: 'Warszawa',
      current: 'rekrutacja@acme.test',
      search_web: true
    },
    effects: {
      ...offerReader({
        companyUrl: 'https://acme.test',
        applyUrl: 'https://acme.recruitee.com/o/senior-backend-engineer'
      }),
      ...verificationWorld()
    }
  }
};

/** Names in the map with no fixture behind them. The test's whole job. */
export const uncovered = (): string[] =>
  Object.keys(capabilities).filter((name) => !(name in smokes));
