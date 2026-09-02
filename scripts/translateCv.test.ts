/**
 * What a translation is allowed to change, and what it must never quietly lose.
 *
 * The smoke test proves `translate_cv` walks. It cannot prove anything about
 * the subject, because it answers every step from that step's own schema — so
 * every field it produces is the same placeholder, no field carries a digit,
 * and the guards that exist to catch a moved figure never see one.
 *
 * The reason those guards exist is the whole argument for this file. A clumsy
 * translation announces itself; a translation that drops a percentage, spells a
 * digit out, or returns four highlights where the source had five reads
 * perfectly well and is a false CV. The person sending it does not speak the
 * target language — that is why they asked — so nobody downstream is checking.
 * Everything here is either a fact that must survive the round trip untouched,
 * or a corruption that must end the run with the field named.
 *
 * `numberDrift` gets its own tests because it encodes a trade rather than a
 * rule, and a trade is worth pinning from both sides: a figure that moves
 * between clauses passes, and a figure that changes value does not.
 *
 * Mutations run, not assumed. Each was applied, the whole suite run, the
 * failures counted, and the mutation reverted:
 *
 *   `numberDrift` compares a sequence     7  a run returns the whole CV … /
 *                                             contact details … / an ongoing
 *                                             role … / an empty source field … /
 *                                             a figure that moves … / a number
 *                                             that changed … / with no document …
 *   `numberDrift` never reports drift     2  a figure that moves … /
 *                                            a number that changed …
 *   the empty-source short circuit gone   1  an empty source field is left empty
 *   a dropped field filled from the source 1 a dropped field fails the run …
 *   an ongoing end date is translated     1  an ongoing role stays ongoing …
 *   `sameLength` stops checking length    1  a list that came back the wrong …
 *   a job's skills come from the model    1  contact details, links and …
 *   the `sections` filter ignored         1  a narrowed run translates only …
 *   a tag that names only itself accepted 1  a language tag has to name …
 *   the missing-CV refusal removed        1  nothing stored and nothing passed …
 *   translation steps stop being critical 1  a section the model could not …
 *
 * The first row is the one to read twice. Weakening `numberDrift` to a sequence
 * comparison fails seven tests, and only two of them are about numbers — the
 * other five are ordinary "did the translation come back" assertions, failing
 * because a correct Polish bullet with its year fronted is refused and the run
 * dies. That is not a quirk of the fixture; it is what the guard did before it
 * was changed, measured against the same kind of sentence a person writes.
 *
 * The last row started as a survivor. Making every translation step degrade
 * instead of failing broke nothing, because the corruptions above are all
 * caught in `assemble` and the steps themselves never fail in those tests — so
 * the test that fails a step outright was written to close it, and the run is
 * expected to die rather than return a CV half in the source language.
 *
 * The smoke suite killed **nothing**: all eleven mutations leave `translate_cv`
 * planning, walking and checkpointing exactly as before. Every one of them is a
 * false CV.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { inputSchema, numberDrift } from '../src/capabilities/cv/translate.js';
import { CV_ID, CV_KIND, cvDocumentSchema } from '../src/capabilities/cv/document.js';
import { startRun } from '../src/runtime/run.js';
import { objectsFrom, spine, type Spine } from './support/spine.js';
import type { AiGateway, ObjectRequest, ObjectResult } from '../src/contracts/index.js';
import type { CvDocument } from '../src/capabilities/cv/document.js';

/* ---------------------------------------------------------------- fixtures */

/**
 * An English CV with figures in it, which is the point.
 *
 * Every number here is load-bearing somewhere below: `2019-03` and `2019-02`
 * for dates that must survive, `30%` and `2020` in one bullet for the clause
 * reordering that must be tolerated, `C1` for a level that looks like prose and
 * is not, and a `null` finish beside a real one so both branches of the end
 * date run. `thesis` and `mark` are empty because most people's are, and an
 * empty source field is the case that must not reach the model's answer at all.
 */
const SOURCE: CvDocument = cvDocumentSchema.parse({
  personal: {
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    phone: '+48 600 100 200',
    location: 'Warsaw, Poland',
    links: { github: 'https://github.test/ada' }
  },
  role_description: 'Backend engineer with 8 years on payment systems.',
  skills: {
    role: 'Backend Engineer',
    programming_languages: ['TypeScript'],
    frameworks: ['NestJS'],
    libraries_and_tools: ['PostgreSQL']
  },
  experience: [
    {
      company: 'Acme Sp. z o.o.',
      title: 'Senior Backend Engineer',
      started: '2019-03',
      finished: null,
      highlights: ['Increased throughput by 30% in 2020.', 'Mentored 2 engineers.'],
      skills: ['TypeScript']
    },
    {
      company: 'Globex',
      title: 'Engineer',
      started: '2016-01',
      finished: '2019-02',
      highlights: [],
      skills: []
    }
  ],
  education: [
    {
      university: 'University of Cambridge',
      degree: 'MSc Computer Science',
      started: '2012',
      finished: '2016',
      thesis: '',
      mark: ''
    }
  ],
  certificates: [
    { name: 'Certified Kubernetes Administrator', issuer: 'CNCF', started: '2022-05', finished: null }
  ],
  languages: [
    { name: 'Polish', level: 'native' },
    { name: 'English', level: 'C1' }
  ],
  sources: [{ kind: 'text', reference: 'cv.txt', imported_at: '2026-01-05T00:00:00.000Z' }]
});

/**
 * A faithful Polish translation, section by section.
 *
 * The first highlight fronts the year, which English trails — `30, 2020` in the
 * source and `2020, 30` here. That is not decoration: it is the exact shape
 * that a sequence comparison refuses and this one accepts, and it is why the
 * bullet is written the way a Pole would actually write it.
 *
 * Every `finished` says `present`, including the two entries whose source date
 * is real. Nothing reads it for an ongoing role, and stating it everywhere is
 * how a wrong answer would get through if `endDate` stopped distinguishing.
 */
const POLISH: Readonly<Record<string, Record<string, unknown>>> = {
  personal: { location: 'Warszawa, Polska' },
  // `summary`, not `role_description` — the wire name differs from the section
  // name on purpose, and the schema says why.
  role_description: {
    summary: 'Inżynier backendu z 8 latami pracy przy systemach płatności.'
  },
  skills: { role: 'Inżynier backendu' },
  experience: {
    experience: [
      {
        company: 'Acme Sp. z o.o.',
        title: 'Starszy inżynier backendu',
        started: '2019-03',
        finished: 'present',
        highlights: ['W 2020 roku zwiększyłem przepustowość o 30%.', 'Byłem mentorem 2 inżynierów.']
      },
      {
        company: 'Globex',
        title: 'Inżynier',
        started: '2016-01',
        finished: '2019-02',
        highlights: []
      }
    ]
  },
  education: {
    education: [
      {
        university: 'Uniwersytet Cambridge',
        degree: 'Magister informatyki',
        started: '2012',
        finished: '2016',
        // The source has neither. If these reach the document, the empty-source
        // short circuit is gone.
        thesis: 'Praca magisterska',
        mark: 'bardzo dobry'
      }
    ]
  },
  certificates: {
    certificates: [
      {
        name: 'Certyfikowany administrator Kubernetes',
        issuer: 'CNCF',
        started: '2022-05',
        finished: 'present'
      }
    ]
  },
  languages: {
    languages: [
      { name: 'polski', level: 'ojczysty' },
      { name: 'angielski', level: 'C1' }
    ]
  }
};

/** The Polish answers with one section replaced by something wrong. */
const spoiled = (
  section: string,
  answer: Record<string, unknown>
): Readonly<Record<string, Record<string, unknown>>> => ({ ...POLISH, [section]: answer });

const harness = async <T>(
  answers: Readonly<Record<string, Record<string, unknown>>>,
  body: (s: Spine) => Promise<T>
): Promise<T> => {
  const s = spine(capabilities, {
    ai: { generateObject: objectsFrom((step) => answers[step] ?? {}) }
  });

  try {
    return await body(s);
  } finally {
    s.dispose();
  }
};

const translate = (s: Spine, input: Record<string, unknown> = {}) =>
  startRun(s.deps, {
    capability: 'translate_cv',
    input: { source_language: 'en', target_language: 'pl', document: SOURCE, ...input }
  });

const documentOf = (data: Readonly<Record<string, unknown>>): CvDocument =>
  data.document as CvDocument;

/* ------------------------------------------------------ what reaches the model */

/**
 * The two things about the request itself that a real run showed are load-bearing.
 *
 * Both were found by running `translate_cv` against `gemma4:12b` and reading the
 * output, and neither is visible from the answer's shape — which is exactly why
 * they want a test. A fake gateway answers whatever it is asked for, so the
 * property name below is free to be wrong forever unless something asserts it.
 */
test('the summary is asked for under a name the model will not answer as itself', async () => {
  const asked: { step: string; keys: string[]; system: string }[] = [];

  const s = spine(capabilities, {
    ai: {
      generateObject: async <T,>(request: ObjectRequest<T>): Promise<ObjectResult<T>> => {
        const shape = (request.schema as unknown as { shape?: Record<string, unknown> }).shape;

        asked.push({
          step: request.step ?? '',
          keys: Object.keys(shape ?? {}),
          system: request.system
        });

        return { object: (POLISH[request.step ?? ''] ?? {}) as T, finishReason: 'stop', usage: {} };
      }
    }
  });

  try {
    await translate(s);
  } finally {
    s.dispose();
  }

  const summary = asked.find((entry) => entry.step === 'role_description');

  // Named `role_description`, this field came back as "You are a professional
  // translator who translates CV content from English to Polish…" on every
  // attempt: the model read the property name as an instruction to describe its
  // own role. The section is still called `role_description`; the wire name is
  // not, and `assemble` maps between them.
  assert.deepEqual(summary?.keys, ['summary']);

  // The rules used to illustrate the number rule with a Polish-to-English pair
  // inside an English-to-Polish instruction. That one clause cost the whole call
  // — `length`, zero characters — at a ceiling that answers without it.
  for (const entry of asked) {
    assert.ok(
      !/is "5 people"/.test(entry.system),
      `the worked example is back in the ${entry.step} rules`
    );
  }
});

/* --------------------------------------------------------- what must change */

test('a run returns the whole CV with every section in the target language', async () => {
  await harness(POLISH, async (s) => {
    const result = await translate(s);
    const document = documentOf(result.data);

    assert.equal(document.personal.location, 'Warszawa, Polska');
    assert.equal(document.role_description, 'Inżynier backendu z 8 latami pracy przy systemach płatności.');
    assert.equal(document.skills.role, 'Inżynier backendu');
    assert.equal(document.experience[0]?.title, 'Starszy inżynier backendu');
    assert.equal(document.education[0]?.university, 'Uniwersytet Cambridge');
    assert.equal(document.certificates[0]?.name, 'Certyfikowany administrator Kubernetes');
    assert.equal(document.languages[0]?.name, 'polski');

    assert.deepEqual(result.data.translated, [
      'personal',
      'role_description',
      'skills',
      'experience',
      'education',
      'certificates',
      'languages'
    ]);
    assert.equal(result.data.source_language, 'en');
    assert.equal(result.data.target_language, 'pl');
  });
});

/* ----------------------------------------------------- what must not change */

test('contact details, links and technology names are copied, never translated', async () => {
  await harness(POLISH, async (s) => {
    const document = documentOf((await translate(s)).data);

    // None of these is in any prompt. If one changes, something is sending the
    // model a field it was never supposed to see.
    assert.equal(document.personal.name, 'Ada Lovelace');
    assert.equal(document.personal.email, 'ada@example.test');
    assert.equal(document.personal.phone, '+48 600 100 200');
    assert.deepEqual(document.personal.links, { github: 'https://github.test/ada' });

    assert.deepEqual(document.skills.programming_languages, ['TypeScript']);
    assert.deepEqual(document.skills.frameworks, ['NestJS']);
    assert.deepEqual(document.skills.libraries_and_tools, ['PostgreSQL']);
    assert.deepEqual(document.experience[0]?.skills, ['TypeScript']);

    // Provenance belongs to the import that produced it, not to a translation.
    assert.deepEqual(document.sources, SOURCE.sources);
  });
});

test('an ongoing role stays ongoing, and a real end date survives', async () => {
  await harness(POLISH, async (s) => {
    const document = documentOf((await translate(s)).data);

    // The model said "present" for all three. Two of them are dates.
    assert.equal(document.experience[0]?.finished, null);
    assert.equal(document.certificates[0]?.finished, null);
    assert.equal(document.experience[1]?.finished, '2019-02');
    assert.equal(document.education[0]?.finished, '2016');

    assert.equal(document.experience[0]?.started, '2019-03');
    assert.equal(document.certificates[0]?.started, '2022-05');
  });
});

test('an empty source field is left empty, whatever the model returned for it', async () => {
  await harness(POLISH, async (s) => {
    const document = documentOf((await translate(s)).data);

    // The answers carry a thesis and a mark. The source has neither, so there
    // was nothing to translate and nothing may appear.
    assert.equal(document.education[0]?.thesis, '');
    assert.equal(document.education[0]?.mark, '');
  });
});

/* ------------------------------------------------------------ the guard rail */

test('a figure that moves between clauses is a translation, not a lie', () => {
  // The measured case. Polish fronts the time adverbial, English trails it, and
  // a sequence comparison called this correct bullet a corrupted one.
  assert.equal(
    numberDrift('Increased sales by 30% in 2020', 'W 2020 roku zwiększyłem sprzedaż o 30%'),
    null
  );

  // A figure that changed value, which is the failure worth catching.
  assert.equal(
    numberDrift('Mentored 12 engineers', 'Byłem mentorem 21 inżynierów'),
    '12 became 21'
  );
  assert.equal(numberDrift('Cut costs by 30%', 'Obniżyłem koszty'), '30 went missing');
  assert.equal(numberDrift('five people', '5 osób'), '5 was not in the source');

  // Admitted rather than fixed: a pure inversion holds the same two numbers and
  // passes here. Refusing every reordered bullet to catch it was the worse
  // trade, and this line is what says so out loud.
  assert.equal(numberDrift('from Python 2 to Python 3', 'z Pythona 3 do Pythona 2'), null);
});

test('a number that changed fails the run and names the figure', async () => {
  const answers = spoiled('experience', {
    experience: [
      {
        ...(POLISH.experience?.experience as Record<string, unknown>[])[0],
        highlights: ['W 2021 roku zwiększyłem przepustowość o 30%.', 'Byłem mentorem 2 inżynierów.']
      },
      (POLISH.experience?.experience as Record<string, unknown>[])[1]
    ]
  });

  await harness(answers, async (s) => {
    await assert.rejects(
      () => translate(s),
      /number in experience\.0\.highlights\.0: 2020 became 2021/
    );
  });
});

test('a dropped field fails the run and names it', async () => {
  await harness(spoiled('role_description', { summary: '   ' }), async (s) => {
    await assert.rejects(() => translate(s), /Translation dropped role_description/);
  });
});

test('a list that came back the wrong length fails the run', async () => {
  const shortened = spoiled('experience', {
    experience: [(POLISH.experience?.experience as Record<string, unknown>[])[0]]
  });

  await harness(shortened, async (s) => {
    await assert.rejects(() => translate(s), /returned 1 jobs where the source has 2/);
  });

  const miscounted = spoiled('experience', {
    experience: [
      {
        ...(POLISH.experience?.experience as Record<string, unknown>[])[0],
        highlights: ['W 2020 roku zwiększyłem przepustowość o 30%.']
      },
      (POLISH.experience?.experience as Record<string, unknown>[])[1]
    ]
  });

  await harness(miscounted, async (s) => {
    await assert.rejects(
      () => translate(s),
      /returned 1 highlights in experience\.0 where the source has 2/
    );
  });
});

test('a section the model could not answer ends the run, rather than half-translating', async () => {
  // Every translation step is critical, and this is the only test that says so.
  // Degrading instead would produce a CV with its summary still in English, a
  // run marked succeeded, and `translated` claiming the section was done — a
  // wrong answer that reads as a right one, which is the thing a person who
  // does not speak the target language cannot catch.
  const gateway: Partial<AiGateway> = {
    generateObject: async (request) => {
      if (request.step === 'role_description') throw new Error('the provider is down');
      return { object: (POLISH[request.step ?? ''] ?? {}) as never, finishReason: 'stop', usage: {} };
    }
  };

  const s = spine(capabilities, { ai: gateway });

  try {
    await assert.rejects(() => translate(s), /the provider is down/);
  } finally {
    s.dispose();
  }
});

/* -------------------------------------------------------------- the source */

test('with no document passed, the stored CV is what gets translated', async () => {
  await harness(POLISH, async (s) => {
    s.deps.documents.update(CV_ID, CV_KIND, () => SOURCE as never);

    const result = await startRun(s.deps, {
      capability: 'translate_cv',
      input: { source_language: 'en', target_language: 'pl' }
    });

    assert.equal(documentOf(result.data).skills.role, 'Inżynier backendu');

    // Nothing was written back. There is one CV document and no locale in its
    // key, so a translation that saved itself would destroy the original.
    const stored = cvDocumentSchema.parse(s.deps.documents.read(CV_ID)?.body);
    assert.equal(stored.skills.role, 'Backend Engineer');
    assert.equal(s.deps.documents.read(CV_ID)?.revision, 1);
  });
});

test('nothing stored and nothing passed is a refusal, not an empty CV', async () => {
  await harness(POLISH, async (s) => {
    await assert.rejects(
      () =>
        startRun(s.deps, {
          capability: 'translate_cv',
          input: { source_language: 'en', target_language: 'pl' }
        }),
      /no stored CV to translate/
    );
  });
});

/* ------------------------------------------------------------- the request */

test('a narrowed run translates only what was asked and says so', async () => {
  await harness(POLISH, async (s) => {
    const result = await translate(s, { sections: ['personal', 'languages'] });
    const document = documentOf(result.data);

    assert.deepEqual(result.data.translated, ['personal', 'languages']);
    assert.equal(document.personal.location, 'Warszawa, Polska');
    assert.equal(document.languages[1]?.level, 'C1');

    // Still English, and still present. Returning the whole CV is what makes
    // "four empty sections" distinguishable from "a person with no education".
    assert.equal(document.role_description, SOURCE.role_description);
    assert.equal(document.skills.role, 'Backend Engineer');
    assert.equal(document.experience[0]?.title, 'Senior Backend Engineer');

    // Two translation steps, plus the read and the assemble.
    assert.equal(result.outcomes.length, 4);
  });
});

test('a language tag has to name a language, and the two have to differ', () => {
  const parse = (source: string, target: string) =>
    inputSchema.safeParse({ source_language: source, target_language: target });

  assert.ok(parse('en', 'pl').success);
  assert.ok(parse('en', 'pt-BR').success);

  // Structurally valid, names nothing. `Intl` hands the tag back unchanged and
  // "translate into zz" would produce something rather than refuse.
  assert.equal(parse('en', 'zz').success, false);
  // Malformed: `Intl` throws, and the same check catches it.
  assert.equal(parse('en', 'not a tag').success, false);
  // A run with nothing to do, which is a mistake in the request, not an answer.
  assert.equal(parse('pl', 'pl').success, false);
});
