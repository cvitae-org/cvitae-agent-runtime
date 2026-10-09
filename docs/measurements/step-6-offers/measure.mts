/**
 * Step 6's measurement: "which of these offers fits my CV best?" through the real
 * runtime, as Studio asks it (`input.grounding.offerIds`, preferences, `cite`),
 * with gemma4:12b behind Ollama's OpenAI endpoint, as the app calls it. Local
 * only; no `.env`, no key.
 *
 * The 2026-10-06 attempt sent the runtime's prompt to Ollama's own `/api/chat`
 * and got empty text in 14 of 26 calls; this one goes the app's way.
 *
 * Scored per answer, with the same rules as that attempt:
 *   first      the offer named first is the best fit (Northwind)
 *   partial    the partial fit (Contoso) comes before every offer that does not fit
 *   cites      with cite on: the answer used numbers at all
 *   resolves   the runtime's own count of cited and unresolved numbers
 *   supported  a sentence citing a block shares a company name or skill with it
 *
 * Takes 1 to 8 minutes a chat on gemma4:12b here; N=8 is 32 chats, about 2.5 hours.
 *
 * Usage: MEASURE_N=8 node --import tsx <this file> <runtime root> <out.json>
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const R = process.argv[2];
const OUT = process.argv[3];
if (!R || !OUT) throw new Error('usage: measure-offers.mts <runtime root> <out.json>');
const MODEL = process.env.MEASURE_MODEL ?? 'gemma4:12b';
const N = Number(process.env.MEASURE_N ?? '8');

const { createHarness, silentLogger } = await import(`${R}/src/runtime/create.ts`);
const { createCvContextStore } = await import(`${R}/src/storage/sqlite/cv-contexts.ts`);
const { cvDocumentSchema } = await import(`${R}/src/capabilities/cv/document.ts`);
const { scratch } = await import(`${R}/scripts/support/db.ts`);

// The last chat request the runtime sent, to read the numbered blocks from.
let lastPrompt = '';
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/chat/completions') && typeof init?.body === 'string') {
    const body = JSON.parse(init.body) as { messages?: { role: string; content?: unknown }[] };
    lastPrompt = (body.messages ?? [])
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
      .join('\n\n');
  }
  return realFetch(input, init);
};

const job = (company: string, title: string, highlight: string) =>
  ({ company, title, started: '2021', finished: null, highlights: [highlight], skills: [] });

type Offer = { id: string; position: string; company: string; location: string; workMode: string; contractType?: string; skills: string[]; text: string; lastSeenAt: number };
type World = { name: 'en' | 'pl'; question: string; preferences: string; body: Record<string, unknown>; offers: Offer[] };

const NAMES = ['Northwind', 'Contoso', 'Fabrikam', 'Tailspin', 'Litware'];

const english: World = {
  name: 'en',
  question: 'Which of these offers fits my CV best?',
  preferences: 'Remote work, no on-call, B2B contract.',
  body: {
    personal: { name: 'Ada Example', email: 'ada@example.com', location: 'Krakow' },
    role_description: 'Backend engineer focused on billing systems.',
    experience: [
      job('Acme', 'Senior Backend Engineer', 'Built billing services in Python and Django on Postgres, and ran them on AWS.'),
      job('Globex', 'Engineer', 'Wrote Kubernetes tooling in Go for internal deploys.'),
      job('Initech', 'Analyst', 'Reported on sales with Excel.')
    ],
    skills: { role: 'Backend engineer', groups: [{ label: 'Languages', items: ['Python', 'Go'] }, { label: 'Tools', items: ['Postgres', 'Django', 'AWS', 'Kubernetes'] }] }
  },
  offers: [
    { id: 'a', position: 'Backend Engineer', company: 'Northwind Traders', location: 'Warsaw', workMode: 'remote', contractType: 'B2B', skills: ['Python', 'Django', 'Postgres'], text: 'Own our payments backend. You will build and run billing services used by thousands of merchants.', lastSeenAt: 50 },
    { id: 'b', position: 'Platform Engineer', company: 'Contoso', location: 'Krakow', workMode: 'hybrid', contractType: 'employment', skills: ['Go', 'Kubernetes', 'Terraform'], text: 'Run and improve our Kubernetes platform. On-call rotation one week in six.', lastSeenAt: 40 },
    { id: 'c', position: 'Data Analyst', company: 'Fabrikam', location: 'Gdansk', workMode: 'onsite', skills: ['Excel', 'Tableau', 'SQL'], text: 'Build dashboards and monthly reports for the sales team.', lastSeenAt: 30 },
    { id: 'd', position: 'Systems Developer', company: 'Tailspin', location: 'Wroclaw', workMode: 'onsite', skills: ['Rust', 'C++'], text: 'Write low level code for embedded devices.', lastSeenAt: 20 },
    { id: 'e', position: 'Java Architect', company: 'Litware', location: 'Poznan', workMode: 'onsite', skills: ['Java', 'Spring', 'Hibernate'], text: 'Design the architecture of our core Java services.', lastSeenAt: 10 }
  ]
};

const polish: World = {
  name: 'pl',
  question: 'Która z tych ofert najlepiej pasuje do mojego CV?',
  preferences: 'Praca zdalna, bez dyżurów, kontrakt B2B.',
  body: {
    personal: { name: 'Ada Example', email: 'ada@example.com', location: 'Kraków' },
    role_description: 'Inżynier backend skupiony na systemach rozliczeniowych.',
    experience: [
      job('Acme', 'Starszy inżynier backend', 'Zbudowałem usługi rozliczeniowe w Pythonie i Django na bazie Postgres, uruchomione na AWS.'),
      job('Globex', 'Inżynier', 'Napisałem narzędzia do wdrożeń w Go, działające na Kubernetes.'),
      job('Initech', 'Analityk', 'Przygotowywałem raporty sprzedażowe w Excelu.')
    ],
    skills: { role: 'Inżynier backend', groups: [{ label: 'Języki', items: ['Python', 'Go'] }, { label: 'Narzędzia', items: ['Postgres', 'Django', 'AWS', 'Kubernetes'] }] }
  },
  offers: [
    { id: 'a', position: 'Inżynier backend', company: 'Northwind Traders', location: 'Warszawa', workMode: 'remote', contractType: 'B2B', skills: ['Python', 'Django', 'Postgres'], text: 'Odpowiadasz za nasz backend płatności. Budujesz i utrzymujesz usługi rozliczeniowe używane przez tysiące sprzedawców.', lastSeenAt: 50 },
    { id: 'b', position: 'Inżynier platformy', company: 'Contoso', location: 'Kraków', workMode: 'hybrid', contractType: 'umowa o pracę', skills: ['Go', 'Kubernetes', 'Terraform'], text: 'Rozwijasz naszą platformę opartą o Kubernetes. Dyżury raz na sześć tygodni.', lastSeenAt: 40 },
    { id: 'c', position: 'Analityk danych', company: 'Fabrikam', location: 'Gdańsk', workMode: 'onsite', skills: ['Excel', 'Tableau', 'SQL'], text: 'Budujesz dashboardy i miesięczne raporty dla działu sprzedaży.', lastSeenAt: 30 },
    { id: 'd', position: 'Programista systemowy', company: 'Tailspin', location: 'Wrocław', workMode: 'onsite', skills: ['Rust', 'C++'], text: 'Piszesz niskopoziomowy kod dla urządzeń wbudowanych.', lastSeenAt: 20 },
    { id: 'e', position: 'Architekt Java', company: 'Litware', location: 'Poznań', workMode: 'onsite', skills: ['Java', 'Spring', 'Hibernate'], text: 'Projektujesz architekturę naszych głównych usług w Javie.', lastSeenAt: 10 }
  ]
};

const order = (answer: string): string[] =>
  NAMES.map((name) => ({ name, at: answer.toLowerCase().indexOf(name.toLowerCase()) }))
    .filter((each) => each.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((each) => each.name);

const blocksOf = (prompt: string): Map<number, string> => {
  const found = new Map<number, string>();
  for (const match of prompt.matchAll(/^\[(\d+)\] ([^\n]*(?:\n(?!\[\d+\] |\n)[^\n]*)*)/gm)) {
    found.set(Number(match[1]), (match[2] as string).toLowerCase());
  }
  return found;
};

const sentenceBefore = (answer: string, at: number): string => {
  const head = answer.slice(0, at);
  const start = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'), head.lastIndexOf('! '), head.lastIndexOf('? '), 0);
  return head.slice(start).toLowerCase();
};

const rows: Record<string, unknown>[] = [];
const plan: { world: World; cite: boolean }[] = [];
for (let at = 0; at < N; at++) for (const world of [english, polish]) for (const cite of [false, true]) plan.push({ world, cite });

for (const [index, { world, cite }] of plan.entries()) {
  const s = scratch();
  const cv = createCvContextStore(s.db).create(randomUUID(), world.name);
  const harness = createHarness({
    databasePath: s.path,
    logger: silentLogger,
    env: { AI_PROVIDER: 'local', AI_MODEL: MODEL, LOCAL_BASE_URL: 'http://localhost:11434/v1' }
  });
  try {
    harness.profile.replaceContext(cv.id, cvDocumentSchema.parse(world.body), 0);
    const ids: string[] = [];
    for (const each of world.offers) {
      const id = `${each.id}-${randomUUID().slice(0, 8)}`;
      ids.push(id);
      harness.offers.save({ ...each, id, firstSeenAt: 1, processing: 'fetched', disposition: 'active' });
    }
    const chat = harness.conversations.create({ kind: 'profile', id: cv.id });
    const runId = randomUUID();
    const started = Date.now();
    lastPrompt = '';
    let answer = '';
    let failure = '';
    let data: Record<string, unknown> = {};
    try {
      const result = await harness.run({
        runId, capability: 'ask_profile', contextId: cv.id, conversationId: chat.id,
        input: {
          question: world.question, history: [], summary: '',
          grounding: { offerIds: ids, preferences: world.preferences, ...(cite ? { cite: true } : {}) }
        }
      });
      data = (result.data ?? {}) as Record<string, unknown>;
      answer = String(data.answer ?? '');
    } catch (error) {
      failure = error instanceof Error ? `${error.name}: ${(error as { code?: string }).code ?? ''} ${error.message}` : String(error);
    }

    const ranked = order(answer);
    const blocks = blocksOf(lastPrompt);
    const key = [...world.offers.flatMap((each) => [...each.skills, each.company.split(' ')[0] as string]), 'Acme', 'Globex', 'Initech', 'AWS', 'remote', 'on-call', 'b2b', 'hybrid', 'onsite', 'zdaln', 'dyżur', 'hybryd', 'stacjonar']
      .map((term) => term.toLowerCase());
    let markers = 0;
    let supported = 0;
    for (const marker of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
      const sentence = sentenceBefore(answer, marker.index ?? 0);
      for (const part of (marker[1] as string).split(',')) {
        markers += 1;
        const block = blocks.get(Number(part));
        if (block !== undefined && key.some((term) => sentence.includes(term) && block.includes(term))) supported += 1;
      }
    }
    const citedField = data.cited as unknown;
    const cited = Array.isArray(citedField) ? citedField.length : (citedField as { cited?: unknown[] } | undefined)?.cited?.length ?? 0;
    const unresolvedField = (data.unresolved ?? (citedField as { unresolved?: unknown[] } | undefined)?.unresolved) as unknown[] | undefined;
    const unresolved = Array.isArray(unresolvedField) ? unresolvedField.length : 0;

    const row = {
      index, language: world.name, cite,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      failure, empty: !failure && answer.trim() === '',
      order: ranked,
      first: ranked[0] === 'Northwind',
      partial: ranked.includes('Contoso') && ['Fabrikam', 'Tailspin', 'Litware'].every((o) => !ranked.includes(o) || ranked.indexOf('Contoso') < ranked.indexOf(o)),
      markers, supported, cited, unresolved, blocks: blocks.size,
      compared: (data.offers as { compared?: unknown[] } | undefined)?.compared?.length,
      dataKeys: Object.keys(data),
      blockText: Object.fromEntries(blocks),
      answer
    };
    rows.push(row);
    writeFileSync(OUT, JSON.stringify({ model: MODEL, n: N, rows }, null, 1));
    console.log(`${String(index + 1).padStart(2)}/${plan.length} ${world.name} cite=${String(cite).padEnd(5)} ${row.seconds}s `
      + `${ranked.join('>') || '-'} first=${row.first} partial=${row.partial} markers=${markers} supported=${supported} `
      + `cited=${cited} unresolved=${unresolved}${row.empty ? ' EMPTY' : ''}${failure ? ' FAILED ' + failure.slice(0, 160) : ''}`);
  } finally {
    harness.close();
    s.dispose();
  }
}
