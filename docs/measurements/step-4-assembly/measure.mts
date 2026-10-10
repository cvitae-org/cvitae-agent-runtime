/**
 * Step 4's measurement: does a message answered from pieces attached to it do as
 * well as one answered by the model's own tools? A throwaway check, not part of
 * the repo: the real `ask_profile`, tools, assembly and record, gemma4:12b via
 * Ollama, the CV indexed as the app does. Local only; no `.env`, no key.
 *
 * Arms:  tools     no grounding, the model uses read_cv / search_profile
 *        once      the piece the question is about attached, tools still there
 *        selected  that piece attached, reach: selected (no tools)
 *        auto      auto: on, the runtime adds pieces it finds for the question
 *
 * Each sample is a fresh conversation. Scored: the answer holds every fact the
 * question asks for, and holds none of the traps (facts from elsewhere in the CV
 * that would be a wrong answer).
 *
 * Takes about 13 minutes a round (32 chats) on gemma4:12b here.
 *
 * Usage: MEASURE_ARMS=tools,once,selected,auto MEASURE_ROUNDS=3 \
 *   node --import tsx <this file> <runtime root> <out.json>
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const R = process.argv[2];
const OUT = process.argv[3];
if (!R || !OUT) throw new Error('usage: measure-assembly.mts <runtime root> <out.json>');
const MODEL = process.env.MEASURE_MODEL ?? 'gemma4:12b';
const ARMS = (process.env.MEASURE_ARMS ?? 'tools,once,selected,auto').split(',') as Arm[];
const ROUNDS = Number(process.env.MEASURE_ROUNDS ?? '2');

type Arm = 'tools' | 'once' | 'selected' | 'auto';

const { createHarness, silentLogger } = await import(`${R}/src/runtime/create.ts`);
const { createCvContextStore } = await import(`${R}/src/storage/sqlite/cv-contexts.ts`);
const { cvDocumentSchema } = await import(`${R}/src/capabilities/cv/document.ts`);
const { scratch } = await import(`${R}/scripts/support/db.ts`);
const { searchProfileTool } = await import(`${R}/src/tools/index.ts`);
const { readCvTool } = await import(`${R}/src/capabilities/cv/tools.ts`);

let calls: string[] = [];
for (const tool of [searchProfileTool, readCvTool]) {
  const execute = tool.execute;
  tool.execute = async (input: Record<string, unknown>, context: unknown) => {
    calls.push(`${tool.name}(${JSON.stringify(input)})`);
    return execute(input, context);
  };
}

type Question = {
  readonly id: string;
  readonly language: 'en' | 'pl';
  readonly text: string;
  /** The piece the question is about, as Studio would attach it. */
  readonly piece: string;
  /** Each group must match at least once. */
  readonly facts: RegExp[];
  /** None may match. */
  readonly traps: RegExp[];
};

const QUESTIONS: Question[] = [
  {
    id: 'acme', language: 'en', text: 'What did I achieve at Acme?', piece: 'experience/acme~senior-engineer',
    facts: [/billing|invoice/i, /60\s?%|postgres/i], traps: [/design system/i]
  },
  {
    id: 'acme', language: 'pl', text: 'Co osiągnęłam w Acme?', piece: 'experience/acme~senior-engineer',
    facts: [/billing|rozlicz|faktur|invoice/i, /60\s?%|postgres/i], traps: [/design system|system projektow/i]
  },
  {
    id: 'globex', language: 'en', text: 'Which technologies did I use at Globex?', piece: 'experience/globex~engineer',
    facts: [/typescript/i, /react/i], traps: [/\bgo\b|golang/i]
  },
  {
    id: 'globex', language: 'pl', text: 'Jakich technologii używałam w Globex?', piece: 'experience/globex~engineer',
    facts: [/typescript/i, /react/i], traps: [/\bgo\b|golang/i]
  },
  {
    id: 'languages', language: 'en', text: 'What level of English do I have?', piece: 'languages',
    facts: [/\bC1\b/], traps: [/\bB2\b|\bC2\b|native english/i]
  },
  {
    id: 'languages', language: 'pl', text: 'Na jakim poziomie znam angielski?', piece: 'languages',
    facts: [/\bC1\b/], traps: [/\bB2\b|\bC2\b/]
  },
  {
    id: 'education', language: 'en', text: 'Where did I study and what degree did I get?', piece: 'education',
    facts: [/AGH/i, /MSc|master|computer science/i], traps: []
  },
  {
    id: 'education', language: 'pl', text: 'Gdzie studiowałam i jaki mam dyplom?', piece: 'education',
    facts: [/AGH/i, /MSc|magist|informatyk|computer science/i], traps: []
  }
];

const s = scratch();
const cv = createCvContextStore(s.db).create(randomUUID(), 'en');
const harness = createHarness({
  databasePath: s.path,
  logger: silentLogger,
  indexRecovery: true,
  env: {
    AI_PROVIDER: 'local',
    AI_MODEL: MODEL,
    LOCAL_BASE_URL: 'http://localhost:11434/v1',
    EMBEDDING_PROVIDER: 'local',
    EMBEDDING_MODEL: 'nomic-embed-text'
  }
});

const doc = cvDocumentSchema.parse({
  personal: {
    name: 'Ada Nowak',
    email: 'ada.nowak@example.com',
    phone: '+48 600 100 200',
    location: 'Krakow',
    links: { github: 'https://github.com/adanowak' }
  },
  role_description: 'Backend engineer focused on billing systems and PostgreSQL performance.',
  skills: {
    role: 'Backend Engineer',
    groups: [
      { label: 'Languages', items: ['Go', 'TypeScript'] },
      { label: 'Databases', items: ['PostgreSQL', 'Redis'] }
    ]
  },
  experience: [
    {
      company: 'Acme', title: 'Senior Engineer', started: '2021', finished: null,
      highlights: ['Rewrote the billing pipeline in Go, cutting invoice latency by 60%.',
        'Tuned PostgreSQL queries and partitioning for the invoices table.'],
      skills: ['Go', 'PostgreSQL']
    },
    {
      company: 'Globex', title: 'Engineer', started: '2018', finished: '2021',
      highlights: ['Built the internal design system in TypeScript and React.'],
      skills: ['TypeScript', 'React']
    }
  ],
  education: [{ university: 'AGH University of Krakow', degree: 'MSc Computer Science', started: '2012', finished: '2017' }],
  languages: [{ name: 'Polish', level: 'native' }, { name: 'English', level: 'C1' }]
});
harness.profile.replaceContext(cv.id, doc, 0);
{
  const until = Date.now() + 180_000;
  while (harness.indexRecovery.indexed(cv.id).chunks === 0) {
    if (Date.now() > until) throw new Error(`index not built: ${JSON.stringify(harness.indexRecovery.status(cv.id))}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log(`indexed: ${JSON.stringify(harness.indexRecovery.indexed(cv.id))}`);
}

const groundingOf = (arm: Arm, question: Question) => {
  const ref = `cv:${cv.id}/${question.piece}`;
  switch (arm) {
    case 'tools': return undefined;
    case 'once': return { once: [ref] };
    case 'selected': return { once: [ref], reach: 'selected' };
    case 'auto': return { auto: 'on' };
  }
};

// In rounds, every arm and question once per round, so a stopped run is balanced.
const plan: { arm: Arm; question: Question }[] = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const question of QUESTIONS) for (const arm of ARMS) plan.push({ arm, question });
}

const results: Record<string, unknown>[] = [];
try {
  for (const [index, { arm, question }] of plan.entries()) {
    calls = [];
    const chat = harness.conversations.create({ kind: 'profile', id: cv.id });
    const runId = randomUUID();
    const started = Date.now();
    let answer = '';
    let failure = '';
    const grounding = groundingOf(arm, question);
    try {
      const result = await harness.run({
        runId, capability: 'ask_profile', contextId: cv.id, conversationId: chat.id,
        input: { question: question.text, history: [], summary: '', ...(grounding ? { grounding } : {}) }
      });
      answer = String((result.data as { answer?: unknown }).answer ?? '');
    } catch (error) {
      failure = error instanceof Error ? `${error.name}: ${(error as { code?: string }).code ?? ''} ${error.message}` : String(error);
    }
    const record = harness.groundingRecords.read(runId);
    const refs = (record?.entries ?? []).map((e: { ref: string; via: string; status: string }) => `${e.status} ${e.via} ${e.ref.replace(`cv:${cv.id}/`, '')}`);
    const right = !failure && question.facts.every((fact) => fact.test(answer));
    const trapped = question.traps.some((trap) => trap.test(answer));
    const row = {
      index, arm, id: question.id, language: question.language, question: question.text,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      failure, empty: !failure && answer.trim() === '',
      right, trapped, correct: right && !trapped,
      answer: answer.slice(0, 500), calls, refs
    };
    results.push(row);
    writeFileSync(OUT, JSON.stringify({ model: MODEL, arms: ARMS, rounds: ROUNDS, results }, null, 1));
    console.log(`${String(index + 1).padStart(3)}/${plan.length} ${arm.padEnd(8)} ${question.id.padEnd(9)} ${question.language} `
      + `${row.seconds}s correct=${row.correct}${trapped ? ' TRAP' : ''} calls=${calls.length} refs=${refs.length}`
      + `${failure ? ' FAILED ' + failure.slice(0, 140) : ''}${row.empty ? ' EMPTY' : ''}`);
  }
} finally {
  harness.close();
  s.dispose();
}
