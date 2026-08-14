/**
 * End-to-end check against a throwaway home directory.
 *
 * Not a test suite — there is no runner here yet, and pretending otherwise
 * would be worse than saying so. What it does is exercise every seam once
 * against real LanceDB and, when Ollama is reachable, a real model, so that
 * "it compiles" is not mistaken for "it works".
 *
 * Storage runs against a deterministic stub embedder rather than a real one.
 * That is deliberate: it keeps the check runnable without a 274MB model pull,
 * and the thing being verified — chunk lifecycle, upsert, filters, fusion — is
 * the runtime's own logic, not the provider's.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set before anything reads it, so the real ~/.cvitae is never touched.
const home = mkdtempSync(join(tmpdir(), 'cvitae-runtime-'));
process.env.CVITAE_HOME = home;

const { Store } = await import('../src/store/store.js');
const { chunkDocument } = await import('../src/retrieval/chunk.js');
const { cvDocumentSchema } = await import('../src/store/cvDocument.js');
const { executePlan } = await import('../src/core/orchestrator.js');
const { ToolRegistry } = await import('../src/tools/registry.js');
const { defaultTools } = await import('../src/tools/index.js');
const { canonicalise } = await import('../src/core/aggregator.js');
const { fuse } = await import('../src/store/lance.js');
const { createRuntime } = await import('../src/index.js');

import type { Embedder } from '../src/retrieval/embed.js';
import type { RunContext, Plan } from '../src/core/types.js';
import type { ExtractCvResult } from '../src/index.js';

let failures = 0;

const check = (label: string, condition: boolean, detail = '') => {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures++;
};

const section = (title: string) => console.log(`\n${title}`);

/**
 * A bag-of-words embedder. Deterministic, and similar text lands near similar
 * text, which is all the storage layer needs to be exercised honestly.
 */
const DIMENSIONS = 64;

const stubEmbedder: Embedder = {
  modelId: 'stub',
  dimensions: DIMENSIONS,
  async one(text: string) {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
      }
      const slot = hash % DIMENSIONS;
      vector[slot] = (vector[slot] ?? 0) + 1;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / magnitude);
  },
  async many(texts: string[]) {
    return Promise.all(texts.map((text) => this.one(text)));
  }
};

const sampleDocument = cvDocumentSchema.parse({
  personal: { name: 'Test Person', email: 'test@example.com' },
  role_description:
    'Over 8 years of experience building scalable web applications with React and Next.js, focused on application architecture and UX.',
  skills: {
    role: 'Frontend Developer',
    programming_languages: ['TypeScript', 'JavaScript'],
    frameworks: ['React', 'Next.js']
  },
  experience: [
    {
      company: 'Acme Commerce',
      title: 'Lead Frontend Developer',
      started: '2021-01',
      finished: null,
      highlights: [
        'Rebuilt the checkout flow in React and TypeScript, cutting abandonment by a fifth.',
        'Introduced a design system that three product teams adopted within two quarters.',
        'Migrated the storefront to Next.js server rendering, halving time to first paint.'
      ],
      skills: ['React', 'TypeScript']
    },
    {
      company: 'Medical Imaging Co',
      title: 'Frontend Developer',
      started: '2018-03',
      finished: '2020-12',
      highlights: [
        'Built a DICOM viewer in canvas that radiologists used for daily reporting.'
      ],
      skills: ['Canvas', 'JavaScript']
    }
  ],
  languages: [{ name: 'Polish', level: 'native' }]
});

section('document store');
const store = new Store(stubEmbedder);
const written = await store.documents.write(sampleDocument);
const readBack = await store.documents.read();
check('write then read round trips', readBack.personal.name === 'Test Person');
check('updated_at is stamped on write', Boolean(written.updated_at));
check('experience survives', readBack.experience.length === 2);

section('chunking');
const chunks = chunkDocument(readBack);
check('produces one chunk per usable prose string', chunks.length === 5, `got ${chunks.length}`);
check(
  'ids are content-derived, not positional',
  chunks.every((c) => c.id.includes(':')) &&
    new Set(chunks.map((c) => c.id)).size === chunks.length
);
check(
  'employer rides along in the embedded text',
  chunks.some((c) => c.text.startsWith('Lead Frontend Developer at Acme Commerce:'))
);

section('index lifecycle (LanceDB)');
const first = await store.reindex(readBack);
check('first index embeds every chunk', first.embedded === 5 && first.total === 5, JSON.stringify(first));

const second = await store.reindex(readBack);
check('re-indexing unchanged content embeds nothing', second.embedded === 0, JSON.stringify(second));

const trimmed = structuredClone(readBack);
trimmed.experience[0]!.highlights.pop();
const third = await store.reindex(trimmed);
check('a deleted bullet is removed from the index', third.removed === 1, JSON.stringify(third));
check('chunk count reflects the deletion', (await store.chunks.count()) === 4);

section('profile retrieval (hybrid)');
const hits = await store.searchProfile('React and TypeScript checkout work', 3);
check('returns hits', hits.length > 0, `${hits.length} hits`);
check(
  'the checkout bullet ranks first',
  hits[0]?.row.text.includes('checkout') === true,
  hits[0]?.row.text.slice(0, 60)
);

section('offers');
await store.saveOffers([
  {
    id: 'offer-1',
    url: 'https://example.com/1',
    board: 'test',
    title: 'Senior React Developer',
    company: "O'Brien Software",
    location: 'Warsaw',
    work_mode: 'remote',
    seniority: 'Senior',
    salary: '25000 PLN',
    contract_type: 'B2B',
    skills: 'React, TypeScript, Next.js',
    text: 'We need a senior React developer for a remote B2B engagement building storefronts.',
    analysis: '{}'
  },
  {
    id: 'offer-2',
    url: 'https://example.com/2',
    board: 'test',
    title: 'Python Backend Engineer',
    company: 'Data Corp',
    location: 'Krakow',
    work_mode: 'onsite',
    seniority: 'Mid',
    salary: '18000 PLN',
    contract_type: 'UoP',
    skills: 'Python, Django, Postgres',
    text: 'Onsite Django role working on data pipelines and Postgres.',
    analysis: '{}'
  }
]);

check('both offers stored', (await store.offers.count()) === 2);

const remote = await store.searchOffers({ where: "work_mode = 'remote'", limit: 10 });
check('hard filter selects only the remote role', remote.length === 1 && remote[0]?.row.id === 'offer-1');

const keyword = await store.searchOffers({ query: 'Django Postgres pipelines', limit: 5 });
check('keyword search finds the backend role', keyword[0]?.row.id === 'offer-2', keyword[0]?.row.title);

const quoted = await store.searchOffers({ where: `company = 'O''Brien Software'`, limit: 5 });
check('an apostrophe in a filter does not break the predicate', quoted.length === 1);

section('fusion and canonicalisation');
const fused = fuse(
  [
    [{ row: { id: 'a' }, rank: 1, score: 0 }, { row: { id: 'b' }, rank: 2, score: 0 }],
    [{ row: { id: 'b' }, rank: 1, score: 0 }, { row: { id: 'c' }, rank: 2, score: 0 }]
  ],
  'id',
  3
);
check('RRF promotes the row both lists agree on', fused[0]?.row.id === 'b', JSON.stringify(fused.map((f) => f.row.id)));

const canonical = canonicalise({ a: 'not_stated', b: 'N/A', c: 'brak', d: 'nieznane', work_mode: 'unknown' });
check(
  'absence spellings collapse to one string',
  canonical.a === 'Not stated' && canonical.b === 'Not stated' && canonical.c === 'Not stated'
);
check('unknown collapses separately', canonical.d === 'Unknown');
check('enum values are left alone', canonical.work_mode === 'unknown');

section('orchestrator');
const registry = new ToolRegistry(defaultTools);
const context = {
  model: null as never,
  providerId: 'local',
  store,
  tools: registry,
  input: {},
  completed: {}
} as unknown as RunContext;

const degradingPlan: Plan = {
  capability: 'test',
  source: 'declared',
  concurrency: 2,
  steps: [
    {
      kind: 'transform',
      name: 'good',
      critical: false,
      run: async () => ({ alpha: 1 })
    },
    {
      kind: 'transform',
      name: 'bad',
      critical: false,
      run: async () => {
        throw new Error('deliberate');
      }
    }
  ]
};

const degradedResult = await executePlan(degradingPlan, context);
check('a non-critical failure degrades rather than throwing', degradedResult.degraded.length === 1);
check('the surviving step still contributes', degradedResult.data.alpha === 1);

const criticalPlan: Plan = {
  capability: 'test',
  source: 'declared',
  concurrency: 1,
  steps: [
    {
      kind: 'transform',
      name: 'must-work',
      critical: true,
      run: async () => {
        throw new Error('deliberate');
      }
    }
  ]
};

let threw = false;
try {
  await executePlan(criticalPlan, context);
} catch {
  threw = true;
}
check('a critical failure fails the run', threw);

section('tool boundary');
const toolSet = registry.toolSet(['search_profile'], context);
check('only the requested tool is exposed', Object.keys(toolSet).length === 1);

const rejected = (await toolSet.search_profile!.execute({ limit: 999 })) as { error?: string };
check('invalid model arguments are rejected, not executed', Boolean(rejected.error), rejected.error?.slice(0, 60));

const accepted = (await toolSet.search_profile!.execute({ query: 'React checkout', limit: 2 })) as {
  results?: unknown[];
};
check('valid arguments reach the store', Array.isArray(accepted.results) && accepted.results.length > 0);

let unregistered = false;
try {
  registry.toolSet(['does_not_exist'], context);
} catch {
  unregistered = true;
}
check('an unregistered tool is a plan bug, not a silent skip', unregistered);

section('merge policy');
const { mergeDocument } = await import('../src/store/merge.js');

const held = cvDocumentSchema.parse({
  personal: { name: 'Correct Name', email: '' },
  skills: { role: 'Frontend Developer', frameworks: ['React'] },
  experience: [
    {
      company: 'Acme Commerce',
      title: 'Lead Frontend Developer',
      started: '2021-01',
      finished: null,
      highlights: ['Rebuilt the checkout flow.'],
      skills: ['React']
    }
  ]
});

const incoming = cvDocumentSchema.partial().parse({
  personal: { name: 'Halucinated Name', email: 'found@example.com', phone: '', location: '', links: {} },
  skills: { role: 'Something Else', programming_languages: ['TypeScript'], frameworks: ['react'], libraries_and_tools: [] },
  experience: [
    {
      company: 'ACME COMMERCE',
      title: 'lead frontend developer',
      started: '',
      finished: '2024-01',
      highlights: ['Rebuilt the checkout flow.', 'Mentored two developers.'],
      skills: ['TypeScript']
    },
    {
      company: 'New Employer',
      title: 'Developer',
      started: '2016-01',
      finished: '2018-01',
      highlights: ['Did a thing.'],
      skills: []
    }
  ]
});

const merged = mergeDocument(held, incoming);
check('an existing value is never overwritten', merged.document.personal.name === 'Correct Name');
check('a blank field is filled', merged.document.personal.email === 'found@example.com', merged.report.filled.join(','));
check('an existing role survives a worse guess', merged.document.skills.role === 'Frontend Developer');
check('new skills are added', merged.document.skills.programming_languages.includes('TypeScript'));
check(
  'skill casing corrected by hand is preserved',
  merged.document.skills.frameworks.length === 1 && merged.document.skills.frameworks[0] === 'React'
);
check(
  'the same job under different casing is not duplicated',
  merged.document.experience.length === 2,
  `${merged.document.experience.length} entries`
);
check(
  'a new bullet joins the matched job',
  merged.document.experience[0]?.highlights.length === 2
);
check('an ongoing role is not closed by an import', merged.document.experience[0]?.finished === null);
check('a genuinely new employer is added', merged.report.added.experience === 1);

section('summary parsing (no model)');
const { findSummary } = await import('../src/capabilities/findSummary.js');

check(
  'finds a paragraph under a SUMMARY heading',
  findSummary(
    'Jan Kowalski\nDeveloper\n\nSUMMARY\nNine years building commerce platforms in React and TypeScript, focused on performance.\n\nEXPERIENCE\nSomewhere'
  ).startsWith('Nine years building')
);

check(
  'the heading itself is not included',
  !findSummary('SUMMARY\nNine years building commerce platforms in React and TypeScript, focused on performance.').includes('SUMMARY')
);

check(
  'finds an unlabelled paragraph near the top',
  findSummary(
    'Jan Kowalski\njan@example.com\n\nNine years building commerce platforms in React and TypeScript, with a focus on performance work.\n\nEXPERIENCE\nSomewhere'
  ).startsWith('Nine years building')
);

check(
  'contact lines are not mistaken for a summary',
  !findSummary(
    'Jan Kowalski\nemail: jan@example.com | github.com/jan | linkedin.com/in/jan | +48 600 100 200 | Warsaw\n\nEXPERIENCE\nSomewhere'
  ).includes('@')
);

check(
  'a CV with no summary returns nothing rather than a guess',
  findSummary(
    'Jan Kowalski\nDeveloper\n\nEXPERIENCE\nSenior Developer, Acme — 2020 to present\n- Led a long and detailed rewrite of the checkout flow in React and TypeScript across four teams.'
  ) === '',
  JSON.stringify(
    findSummary(
      'Jan Kowalski\nDeveloper\n\nEXPERIENCE\nSenior Developer, Acme — 2020 to present\n- Led a long and detailed rewrite of the checkout flow in React and TypeScript across four teams.'
    ).slice(0, 40)
  )
);

check(
  'a Polish heading works too',
  findSummary(
    'Jan Kowalski\n\nPODSUMOWANIE\nDziewięć lat doświadczenia w budowaniu platform handlowych w React i TypeScript.\n\nDOŚWIADCZENIE'
  ).startsWith('Dziewięć lat')
);

section('source reading');
const { readSources } = await import('../src/sources/index.js');
const { writeFile } = await import('node:fs/promises');

const txtPath = join(home, 'sample.txt');
await writeFile(txtPath, 'Jane Doe\nSenior Engineer at Example Ltd', 'utf8');

const read = await readSources({
  inputs: [
    { kind: 'text', label: 'linkedin paste', content: 'Pasted profile text.' },
    { kind: 'file', path: txtPath },
    { kind: 'file', path: join(home, 'missing.docx') }
  ]
});

check('text and file sources are read', read.records.length === 2, JSON.stringify(read.records.map((r) => r.kind)));
check('sources are labelled in the corpus', read.text.includes('=== SOURCE: linkedin paste ==='));
check('an unsupported format is skipped, not fatal', read.skipped.length === 1);
check(
  'the skip reason names the supported formats',
  read.skipped[0]?.reason.includes('.pdf') === true,
  read.skipped[0]?.reason.slice(0, 60)
);

section('capability wiring');
const runtime = createRuntime();
check('capabilities are listed', runtime.listCapabilities().length === 3);
check('tools are listed', runtime.listTools().length === 3);

let badInput = '';
try {
  await runtime.run('analyze_offer', { offerText: '' });
} catch (error) {
  badInput = (error as Error).message;
}
check('empty input is rejected by the capability schema', badInput.includes('offerText'), badInput.slice(0, 70));

let unknown = '';
try {
  await runtime.run('nope', {});
} catch (error) {
  unknown = (error as Error).message;
}
check('an unknown capability names the available ones', unknown.includes('analyze_offer'));

section('live model (skipped if Ollama is not reachable)');

const OFFER = `Senior Frontend Developer (React) — Nordwind Sp. z o.o.
We are a 40-person e-commerce software house in Wroclaw building storefronts for European retailers.
Salary: 22 000 - 28 000 PLN net + VAT (B2B).
Fully remote within Poland. Start: ASAP. Long-term cooperation.
You will own the checkout experience, mentor two mid developers, and work with our design team.
Requirements: 5+ years with React, strong TypeScript, Next.js, experience with REST APIs, English B2.
Apply through the form on our careers page.`;

const reachable = await fetch('http://localhost:11434/api/tags', {
  signal: AbortSignal.timeout(2000)
})
  .then((response) => response.ok)
  .catch(() => false);

if (!reachable) {
  console.log('  skip  Ollama is not running on :11434');
} else {
  process.env.AI_PROVIDER = 'local';
  process.env.AI_MODEL = process.env.SMOKE_MODEL ?? 'gemma3:4b';

  console.log(`        analysing one offer with ${process.env.AI_MODEL}...`);

  try {
    const result = await runtime.run('analyze_offer', { offerText: OFFER, locale: 'en' });
    const data = result.data as Record<string, string>;

    check('the critical role step produced a position', Boolean(data.position), data.position);
    check('the record is canonicalised', !Object.values(data).includes('not_stated'));
    console.log(
      `        ${result.elapsedMs}ms, degraded: [${result.degraded.join(', ') || 'none'}]`
    );
    console.log(
      `        position=${JSON.stringify(data.position)} company=${JSON.stringify(data.company)} salary=${JSON.stringify(data.salary)} work_mode=${JSON.stringify(data.work_mode)}`
    );
  } catch (error) {
    check('live analysis completed', false, (error as Error).message.slice(0, 120));
  }

  const CV = `Jan Kowalski
Senior Frontend Developer
jan.kowalski@example.com | +48 600 100 200 | Warsaw, Poland
github.com/jankowalski | linkedin.com/in/jankowalski

SUMMARY
Frontend developer with 9 years of experience building commerce platforms in React
and TypeScript. Focused on performance and design systems.

EXPERIENCE
Senior Frontend Developer, Nordwind Sp. z o.o. — 2021-03 to present
- Led the rewrite of the checkout flow in React and TypeScript.
- Built a component library adopted by four product teams.
- Cut largest-contentful-paint from 4.1s to 1.6s on the storefront.

Frontend Developer, Baltic Systems — 2017-06 to 2021-02
- Built internal dashboards in Angular and later React.
- Introduced end-to-end tests with Cypress.

EDUCATION
Warsaw University of Technology — MSc Computer Science, 2012 to 2017
Thesis: distributed rendering of vector maps

CERTIFICATES
AWS Certified Developer Associate, Amazon Web Services, 2022

LANGUAGES
Polish - native
English - C1`;

  console.log('        extracting a CV (7 steps)...');

  try {
    const extraction = await runtime.run('extract_cv', {
      sources: [{ kind: 'text', label: 'cv.txt', content: CV }]
    });

    const data = extraction.data as unknown as ExtractCvResult;

    check('the CV was persisted', data.persisted === true);
    check(
      'the pre-existing name was not overwritten by the import',
      data.document.personal.name === 'Test Person',
      data.document.personal.name
    );
    check(
      'new employers were added alongside the existing ones',
      data.document.experience.length >= 3,
      `${data.document.experience.length} entries: ${data.document.experience.map((e) => e.company).join(', ')}`
    );
    check(
      'education was extracted',
      data.document.education.length >= 1,
      data.document.education[0]?.university
    );
    check(
      'spoken languages did not collect programming languages',
      data.document.languages.every((entry) => !/javascript|typescript|python/i.test(entry.name)),
      data.document.languages.map((l) => `${l.name}:${l.level}`).join(', ')
    );
    check(
      'an ongoing role was stored as open-ended',
      data.document.experience.some((entry) => entry.finished === null)
    );
    check('provenance was recorded', data.document.sources.some((s) => s.reference === 'cv.txt'));

    if (data.index_error) {
      console.log(`        saved but not indexed — ${data.index_error.slice(0, 80)}`);
      check('a missing embedding model does not lose the import', data.persisted === true);
    } else {
      check('the index was rebuilt', (data.indexed?.total ?? 0) > 0, JSON.stringify(data.indexed));
    }

    console.log(
      `        ${extraction.elapsedMs}ms, degraded: [${extraction.degraded.join(', ') || 'none'}]`
    );
  } catch (error) {
    check('live extraction completed', false, (error as Error).message.slice(0, 160));
  }
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
console.log(`scratch home: ${home}`);

process.exit(failures === 0 ? 0 : 1);
