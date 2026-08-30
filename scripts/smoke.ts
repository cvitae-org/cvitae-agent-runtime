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

import '../src/env.js';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set before anything reads it, so the real ~/.cvitae is never touched.
const home = mkdtempSync(join(tmpdir(), 'cvitae-runtime-'));
process.env.CVITAE_HOME = home;

const { Store } = await import('../src/store/store.js');
const { chunkDocument, chunkKinds, DRAFTING_KINDS } = await import(
  '../src/retrieval/chunk.js'
);
const { cvDocumentSchema } = await import('../src/store/cvDocument.js');
const { PreferencesStore, preferencesSchema, fingerprintPreferences } = await import(
  '../src/store/preferences.js'
);
const { offerRecordSchema } = await import('../src/store/offerRecord.js');
const { parseSalary } = await import('../src/offers/salary.js');
const { evaluate } = await import('../src/offers/criteria.js');
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
  education: [
    {
      university: 'Warsaw University of Technology',
      degree: 'MSc in Computer Science',
      started: '2013-10',
      finished: '2018-06',
      thesis: 'Real-time volumetric rendering of medical imaging data in the browser.'
    }
  ],
  certificates: [
    {
      name: 'AWS Certified Solutions Architect - Associate',
      issuer: 'Amazon Web Services',
      started: '2022-05',
      finished: null
    }
  ],
  languages: [
    { name: 'Polish', level: 'native' },
    { name: 'English', level: 'C1' }
  ]
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

// 1 role + 1 summary + 2 skill groups + 2 job titles + 4 bullets + 1 degree
// + 1 certificate + 1 grouped language line.
const CHUNK_TOTAL = 13;

check('produces a chunk per retrievable claim', chunks.length === CHUNK_TOTAL, `got ${chunks.length}`);
check(
  'ids are content-derived, not positional',
  chunks.every((c) => c.id.includes(':')) &&
    new Set(chunks.map((c) => c.id)).size === chunks.length
);
check(
  'employer rides along in the embedded text',
  chunks.some((c) => c.text.startsWith('Lead Frontend Developer at Acme Commerce:'))
);

const byKind = new Map<string, number>();
for (const chunk of chunks) byKind.set(chunk.kind, (byKind.get(chunk.kind) ?? 0) + 1);

check(
  'every kind in the vocabulary is reachable',
  chunkKinds.every((kind) => (byKind.get(kind) ?? 0) > 0),
  chunkKinds.filter((kind) => !byKind.has(kind)).join(', ') || 'all present'
);
check(
  'skills are grouped, not one chunk per token',
  byKind.get('skill') === 2 &&
    chunks.some((c) => c.text === 'Programming languages: TypeScript, JavaScript'),
  `${byKind.get('skill')} skill chunks`
);
check(
  'languages are one chunk, with levels',
  byKind.get('language') === 1 &&
    chunks.some((c) => c.text === 'Languages: Polish (native), English (C1)')
);
check(
  'a certificate names its issuer',
  chunks.some(
    (c) =>
      c.kind === 'certificate' &&
      c.text.includes('AWS Certified Solutions Architect') &&
      c.text.includes('Amazon Web Services')
  )
);
check(
  'an open-ended role carries "present" rather than a blank',
  chunks.some((c) => c.kind === 'experience-title' && c.text.includes('to present'))
);
check(
  'only the experience kinds claim a company',
  chunks.every((c) => !c.company || c.kind.startsWith('experience-'))
);
check(
  'a job title sits directly before its own bullets',
  (() => {
    const ordered = [...chunks].sort((a, b) => a.position - b.position);
    const titleAt = ordered.findIndex((c) => c.kind === 'experience-title');
    return titleAt >= 0 && ordered[titleAt + 1]?.kind === 'experience-bullet';
  })()
);

section('index lifecycle (LanceDB)');
const first = await store.reindex(readBack);
check(
  'first index embeds every chunk',
  first.embedded === CHUNK_TOTAL && first.total === CHUNK_TOTAL,
  JSON.stringify(first)
);

const second = await store.reindex(readBack);
check('re-indexing unchanged content embeds nothing', second.embedded === 0, JSON.stringify(second));

// A row written by an older chunker carries a kind this build has retired.
// `reindex` has to notice and rebuild, because ids are content-derived and the
// row would otherwise keep its stale metadata forever.
await store.chunks.upsert([
  {
    id: 'exp:legacy',
    kind: 'highlight' as never,
    text: 'A bullet indexed before the vocabulary widened.',
    company: 'Acme Commerce',
    title: 'Lead Frontend Developer',
    position: 0,
    vector: await stubEmbedder.one('A bullet indexed before the vocabulary widened.')
  }
]);

const rebuilt = await store.reindex(readBack);
check(
  'a stale kind forces a rebuild rather than sitting there',
  rebuilt.embedded === CHUNK_TOTAL && rebuilt.removed === 1,
  JSON.stringify(rebuilt)
);
check(
  'nothing outside the current vocabulary survives it',
  (await store.chunks.all(100)).every((row) =>
    (chunkKinds as readonly string[]).includes(row.kind)
  )
);

const trimmed = structuredClone(readBack);
trimmed.experience[0]!.highlights.pop();
const third = await store.reindex(trimmed);
check('a deleted bullet is removed from the index', third.removed === 1, JSON.stringify(third));
check('chunk count reflects the deletion', (await store.chunks.count()) === CHUNK_TOTAL - 1);

section('profile retrieval (hybrid)');
const hits = await store.searchProfile('checkout flow abandonment', 3);
check('returns hits', hits.length > 0, `${hits.length} hits`);
check(
  'the checkout bullet ranks first',
  hits[0]?.row.text.includes('checkout') === true,
  hits[0]?.row.text.slice(0, 60)
);

// The point of the widening: these three used to be unreachable through search.
const certificateHits = await store.searchProfile('AWS certified solutions architect', 5);
check(
  'a certificate is retrievable',
  certificateHits.some((hit) => hit.row.kind === 'certificate'),
  certificateHits.map((hit) => hit.row.kind).join(', ')
);

const degreeHits = await store.searchProfile('volumetric rendering thesis computer science', 5);
check(
  'a degree and its thesis are retrievable',
  degreeHits.some((hit) => hit.row.kind === 'education'),
  degreeHits.map((hit) => hit.row.kind).join(', ')
);

const languageHits = await store.searchProfile('native Polish speaker with English', 5);
check(
  'languages are retrievable',
  languageHits.some((hit) => hit.row.kind === 'language'),
  languageHits.map((hit) => hit.row.kind).join(', ')
);

const scoped = await store.searchProfile('React and TypeScript frontend work', 8, DRAFTING_KINDS);
check(
  'the drafting scope excludes what renderCandidate already states',
  scoped.length > 0 &&
    scoped.every((hit) => (DRAFTING_KINDS as string[]).includes(hit.row.kind)),
  scoped.map((hit) => hit.row.kind).join(', ')
);

section('offers');
const firstSave = await store.saveOffers([
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
    salary_min: 25000,
    salary_max: 25000,
    salary_currency: 'PLN',
    salary_period: 'month',
    contract_type: 'B2B',
    skills: ['React', 'TypeScript', 'Next.js'],
    text: 'We need a senior React developer for a remote B2B engagement building storefronts.',
    processing: 'fetched'
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
    // Deliberately unstated. The tri-state depends on this being distinguishable
    // from a stated zero, and every check below leans on it.
    contract_type: 'UoP',
    skills: ['Python', 'Django', 'Postgres'],
    text: 'Onsite Django role working on data pipelines and Postgres.',
    processing: 'fetched'
  }
]);

check(
  'a first sighting adds and embeds both',
  firstSave.added === 2 && firstSave.updated === 0 && firstSave.embedded === 2,
  JSON.stringify(firstSave)
);
check('both offers indexed', (await store.offers.count()) === 2);
check('both offers on file', (await store.offerRecords.all()).length === 2);

const remote = await store.searchOffers({ where: "work_mode = 'remote'", limit: 10 });
check('hard filter selects only the remote role', remote.length === 1 && remote[0]?.row.id === 'offer-1');

const keyword = await store.searchOffers({ query: 'Django Postgres pipelines', limit: 5 });
check('keyword search finds the backend role', keyword[0]?.row.id === 'offer-2', keyword[0]?.row.title);

const quoted = await store.searchOffers({ where: `company = 'O''Brien Software'`, limit: 5 });
check('an apostrophe in a filter does not break the predicate', quoted.length === 1);

section('offers: the imported_at bug');
const before = await store.offerRecords.get('offer-1');

// A re-sighting is what a standing search does every day. Under the old single
// `imported_at`, restamped across every row on every upsert, this was the exact
// moment a month-old offer started looking new again.
const reseen = await store.saveOffers([
  { id: 'offer-1', title: 'Senior React Developer', processing: 'fetched' }
]);

const after = await store.offerRecords.get('offer-1');

check(
  're-seeing an offer updates rather than adding',
  reseen.added === 0 && reseen.updated === 1,
  JSON.stringify(reseen)
);
check(
  'first_seen_at survives a re-sighting',
  !!after && after.first_seen_at === before?.first_seen_at,
  after?.first_seen_at
);
check(
  'last_seen_at advances',
  !!after && !!before && after.last_seen_at >= before.last_seen_at
);
check('unchanged text costs no embedding', reseen.embedded === 0);
check(
  'a partial sighting does not blank what it omits',
  after?.salary === '25000 PLN' && after?.company === "O'Brien Software",
  `${after?.salary} / ${after?.company}`
);

section('offers: two axes, two writers');
await store.offerRecords.update('offer-2', { disposition: 'dismissed' });

// The round writes `processing`; the user writes `disposition`. This is the
// case a single `status` column could not express — and the race it created.
await store.saveOffers([{ id: 'offer-2', processing: 'rated', eligibility: 'provisional' }]);

const dismissed = await store.offerRecords.get('offer-2');
check(
  'a round cannot overwrite the user disposition',
  dismissed?.disposition === 'dismissed',
  dismissed?.disposition
);
check(
  'the round still advances its own axis',
  dismissed?.processing === 'rated' && dismissed?.eligibility === 'provisional'
);

section('offers: unknown is not zero');
const unstated = await store.offerRecords.get('offer-2');
check('an unstated salary is null, not 0', unstated?.salary_min === null);

const floor = await store.searchOffers({
  where: "salary_min >= 20000 AND salary_currency = 'PLN'",
  limit: 10
});
check(
  'a salary floor excludes the offer that never stated one',
  floor.length === 1 && floor[0]?.row.id === 'offer-1',
  floor.map((hit) => hit.row.id).join(', ')
);

const unknownSalary = await store.searchOffers({ where: "salary_currency = ''", limit: 10 });
check(
  'and the unstated ones are still findable as unknown',
  unknownSalary.length === 1 && unknownSalary[0]?.row.id === 'offer-2'
);

section('offers: the index is derived');
const offerRebuild = await store.reindexOffers();
check(
  'a rebuild re-embeds nothing when no text changed',
  offerRebuild.embedded === 0 && offerRebuild.total === 2,
  JSON.stringify(offerRebuild)
);

// Planting a row from an older build: no `text_fp`, and a `status` vocabulary
// this build does not know. Neither is visible until a predicate silently
// matches nothing, which is what makes the drift check worth having.
await store.offers.upsert([
  {
    ...({
      id: 'offer-legacy',
      url: 'https://example.com/legacy',
      board: 'test',
      title: 'Legacy Row',
      company: 'Old Build',
      location: '',
      work_mode: '',
      seniority: '',
      contract_type: '',
      salary: '',
      salary_min: 0,
      salary_max: 0,
      salary_currency: '',
      salary_period: '',
      skills: '',
      text: 'A row written before the storage split.',
      processing: 'imported',
      disposition: 'active',
      eligibility: 'unrated',
      fit: -1,
      completeness: -1,
      first_seen_at: '2020-01-01T00:00:00.000Z',
      last_seen_at: '2020-01-01T00:00:00.000Z',
      text_fp: 'x'
    } as never),
    vector: await stubEmbedder.one('legacy')
  }
]);

const repaired = await store.reindexOffers();
check(
  'an unknown processing state rebuilds the whole table',
  repaired.embedded === 2 && repaired.total === 2,
  JSON.stringify(repaired)
);
check(
  'and the row with no authored record is gone',
  (await store.offers.count()) === 2,
  String(await store.offers.count())
);

section('offers: identity dedupe');
const twins = await store.offerRecords.findByIdentity("o'brien software", 'SENIOR REACT DEVELOPER');
check('identity lookup is case and space insensitive', twins.length === 1 && twins[0]?.id === 'offer-1');
check('a blank company matches nothing', (await store.offerRecords.findByIdentity('', 'x')).length === 0);

section('preferences');
const prefsStore = new PreferencesStore();
check('absent preferences read as empty, not as an error', (await prefsStore.read()).salary.floor === null);
check(
  'and empty preferences filter nothing',
  (await prefsStore.read()).work_mode.accept.length === 0
);

const savedPrefs = await prefsStore.write(
  preferencesSchema.parse({
    work_mode: { strength: 'must', accept: ['remote', 'hybrid'] },
    contract_type: { strength: 'prefer', accept: ['b2b', 'uop'] },
    salary: { strength: 'must', floor: 22000, currency: 'PLN', period: 'month', basis: 'any' },
    skills: { strength: 'prefer', require: ['React', 'TypeScript', 'Go'] }
  })
);
check('preferences round-trip', (await prefsStore.read()).salary.floor === 22000);
check('and are stamped', savedPrefs.updated_at !== '');

// The fingerprint is what decides which offers need rescoring, so touching the
// file without changing the ask must not invalidate every score on disk.
const touched = await prefsStore.write(savedPrefs);
check(
  'rewriting without a change keeps the fingerprint',
  fingerprintPreferences(touched) === fingerprintPreferences(savedPrefs),
  `${fingerprintPreferences(touched)} vs ${fingerprintPreferences(savedPrefs)}`
);
check(
  'changing the ask changes it',
  fingerprintPreferences(preferencesSchema.parse({ ...savedPrefs, salary: { ...savedPrefs.salary, floor: 25000 } })) !==
    fingerprintPreferences(savedPrefs)
);

// A floor with no currency is a number, not a requirement. Refused loudly
// rather than parsed into a criterion that could never fire.
let refused = false;
try {
  preferencesSchema.parse({ salary: { floor: 22000, currency: '', period: 'month' } });
} catch {
  refused = true;
}
check('a floor without a currency is refused', refused);

section('salary parsing (no model)');
for (const [line, want] of [
  ['20 000 - 25 000 PLN netto/mies.', { min: 20000, max: 25000, currency: 'PLN', period: 'month' }],
  ['20-25k PLN', { min: 20000, max: 25000, currency: 'PLN', period: '' }],
  ['1 200 - 1 600 PLN/dzien B2B', { min: 1200, max: 1600, currency: 'PLN', period: 'day' }],
  ['od 20 000 zl', { min: 20000, max: null, currency: 'PLN', period: '' }],
  ['do 25 000 zl', { min: null, max: 25000, currency: 'PLN', period: '' }],
  ['$120,000 - $150,000 per year', { min: 120000, max: 150000, currency: 'USD', period: 'year' }],
  ['Not stated', { min: null, max: null, currency: '', period: '' }]
] as const) {
  const got = parseSalary(line);
  check(
    `parses ${JSON.stringify(line)}`,
    got.min === want.min && got.max === want.max &&
      got.currency === want.currency && got.period === want.period,
    JSON.stringify(got)
  );
}
// `b2b` carries a digit and sits on most Polish salary lines. Read naively it
// becomes a two-zloty lower bound, and every floor comparison then passes.
check(
  'the 2 in B2B is not a salary',
  parseSalary('18 000 - 24 000 PLN B2B').min === 18000,
  JSON.stringify(parseSalary('18 000 - 24 000 PLN B2B'))
);
check(
  'and a bonus beside the pay is not a lower bound',
  parseSalary('20 000 PLN + 5 000 bonus').min === 20000,
  JSON.stringify(parseSalary('20 000 PLN + 5 000 bonus'))
);

section('criteria: three answers, not two');
const NOW = '2026-01-01T00:00:00.000Z';
const scored = (over: Record<string, unknown>) =>
  evaluate(
    offerRecordSchema.parse({
      id: 'scored',
      title: 'Senior Frontend Developer',
      company: 'Acme',
      location: 'Warsaw',
      work_mode: 'remote',
      seniority: 'Senior',
      contract_type: 'B2B',
      salary: '20 000 - 25 000 PLN',
      salary_min: 20000,
      salary_max: 25000,
      salary_currency: 'PLN',
      salary_period: 'month',
      skills: ['React', 'TypeScript', 'Node.js'],
      first_seen_at: NOW,
      last_seen_at: NOW,
      ...over
    }),
    savedPrefs
  );

const match = scored({});
check('an offer meeting every must is eligible', match.eligibility === 'eligible', match.eligibility);
// Five of six decided criteria pass; Go is the one the posting does not name.
check('fit counts the skill it does not name', match.fit === 0.83, String(match.fit));
check('completeness is a property of the posting', match.completeness === 1, String(match.completeness));

const wrongMode = scored({ work_mode: 'onsite' });
check('a failed must is ineligible', wrongMode.eligibility === 'ineligible', wrongMode.eligibility);

// The distinction the whole design turns on: a posting that says nothing about
// money has not failed a salary requirement.
const silent = scored({ salary: '', salary_min: null, salary_max: null, salary_currency: '' });
check(
  'an unstated salary is provisional, not ineligible',
  silent.eligibility === 'provisional',
  silent.detail.criteria.find((c) => c.criterion === 'salary')?.because
);
check(
  'and it leaves the fit denominator rather than counting as a miss',
  silent.fit === 0.8,
  `${silent.fit} — four of five decided, not four of six`
);
check(
  'while completeness records that something is missing',
  silent.completeness < 1 && silent.detail.missing.includes('salary'),
  String(silent.completeness)
);

// Same numbers, different money. There is no honest multiplier between a B2B
// rate and a permanent salary, so the answer is that it is not known.
const uopFloor = preferencesSchema.parse({
  ...savedPrefs,
  salary: { ...savedPrefs.salary, basis: 'uop' }
});
const incomparable = evaluate(
  offerRecordSchema.parse({
    id: 'b2b', work_mode: 'remote', contract_type: 'B2B',
    salary_min: 20000, salary_max: 25000, salary_currency: 'PLN', salary_period: 'month',
    skills: ['React'], first_seen_at: NOW, last_seen_at: NOW
  }),
  uopFloor
);
check(
  'a B2B figure against a UoP floor is unknown, not a pass',
  incomparable.detail.criteria.find((c) => c.criterion === 'salary')?.verdict === 'unknown',
  incomparable.detail.criteria.find((c) => c.criterion === 'salary')?.because
);

// The failure the ratio would have hidden: a posting that states one thing and
// matches it is not a better offer than one that states five and matches four.
const vague = scored({
  salary: '', salary_min: null, salary_max: null, salary_currency: '',
  contract_type: '', seniority: '', location: '', skills: []
});
check(
  'a vague posting reads as high fit and low completeness, not as a perfect match',
  vague.fit === 1 && vague.completeness === 0.43,
  `fit ${vague.fit}, completeness ${vague.completeness}`
);
check(
  'and the detail says which criteria could not be decided',
  vague.detail.criteria.filter((c) => c.verdict === 'unknown').length === 5,
  vague.detail.criteria.map((c) => `${c.criterion}=${c.verdict}`).join(' ')
);

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
/**
 * The names, not the count.
 *
 * This was `length === 3` and had gone stale silently: `translate_cv` made it
 * four and the check simply began failing with a message that named nothing.
 * Comparing the set says which capability is missing or unexpected, and adding
 * one is then a deliberate edit here rather than a mystery red line.
 */
const EXPECTED_CAPABILITIES = [
  'analyze_offer',
  'ask_profile',
  'draft_application',
  'extract_cv',
  'generate_evidence_summary',
  'translate_cv',
  'verify_recipient'
];

const listed = runtime
  .listCapabilities()
  .map((capability) => capability.name)
  .sort();

check(
  'capabilities are listed',
  listed.join(',') === EXPECTED_CAPABILITIES.join(','),
  listed.join(', ')
);
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
