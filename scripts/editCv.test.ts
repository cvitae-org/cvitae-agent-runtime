/**
 * What an instruction is allowed to change, and what it must never reach.
 *
 * `edit_cv` is the only capability that takes prose about the CV and returns a
 * CV, which makes it the one place where a confused or steered model could
 * rewrite somebody's employment history. Two things keep that bounded, and both
 * are invisible from the answer's shape — a fake gateway answers whatever it is
 * asked for, so nothing here is enforced by the types:
 *
 * - **One section is sent and one section comes back.** An instruction about
 *   skills never has the jobs in front of it, so it cannot lose one.
 * - **Nothing is written.** The run proposes; the caller saves. There is no
 *   revision history yet, so a write from prose would be unrecoverable.
 *
 * The rest is the sentinel — `present` for an end date that has not arrived,
 * because a small model asked for a nullable string writes the word — and the
 * two ways an answer can be shaped wrongly enough that a caller must not be
 * handed it.
 *
 * Mutations run, not assumed. Each was applied, this file run, the failures
 * counted, and the mutation reverted. Every one killed exactly one test:
 *
 *   the whole document goes in the prompt      an instruction about one section
 *   `merge` starts from an empty document      only the routed section changes
 *   the `present` sentinel is left alone       an end date that has not arrived
 *   the proposal is written to the store       a proposal is not a save
 *   `changed` is always true                   an answer that changes nothing
 *   the `section` input is routed anyway       a caller that names the section
 *   an unroutable answer picks section one     an instruction that fits no …
 *   the per-section parse is dropped           a section the model reshaped
 *   the revise step degrades                   a model that cannot answer
 *   nothing stored is refused                  with nothing stored …
 *
 * Two of those are worth the note.
 *
 * Dropping the per-section parse does not let a bad section through — the
 * whole-document parse under it refuses the body as well. What it loses is the
 * sentence: a zod message for a top-level mismatch is `expected array, received
 * string` with an empty path, which does not say which section and is the only
 * part a person reading the failure can act on. So that test pins the wording,
 * not the refusal.
 *
 * And a degrading revise step still ends the run, because `merge` refuses an
 * answer that is not there. The difference is the message — "the provider is
 * down" against "the edit produced nothing" — and only the first sends anybody
 * to the right place. That test pins the message for the same reason.
 *
 * An instruction is a follow-up rather than a first one, and those mutations
 * are about where the conversation goes and where it must not:
 *
 *   routing sees only the instruction         a follow-up is routed from …
 *   the revision sees only the instruction    the section being revised is …
 *   the conversation follows the instruction  the conversation is context …
 *   the background line is always added       a first instruction is sent …
 *   the conversation is always assembled      a first instruction is sent …
 *   the history ceiling is dropped            more conversation than the …
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { CV_ID, CV_KIND, cvDocumentSchema } from '../src/capabilities/cv/document.js';
import { startRun } from '../src/runtime/run.js';
import { spine, type Spine } from './support/spine.js';
import type { CvDocument } from '../src/capabilities/cv/document.js';
import type { ObjectRequest, ObjectResult } from '../src/contracts/index.js';

/* ---------------------------------------------------------------- fixtures */

/**
 * A CV with something in every section, and both end-date states in it.
 *
 * The two jobs matter more than the rest: most of this file is about the second
 * one still being there afterwards.
 */
const STORED: CvDocument = cvDocumentSchema.parse({
  personal: {
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    phone: '',
    location: 'Warsaw',
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
      company: 'Acme',
      title: 'Senior Backend Engineer',
      started: '2019-03',
      finished: null,
      highlights: ['Increased throughput by 30%.'],
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
    { university: 'Cambridge', degree: 'MSc Computer Science', started: '2012', finished: '2016' }
  ],
  certificates: [{ name: 'CKA', issuer: 'CNCF', started: '2022-05', finished: null }],
  languages: [{ name: 'Polish', level: 'native' }],
  sources: [{ kind: 'text', reference: 'cv.txt', imported_at: '2026-01-05T00:00:00.000Z' }]
});

/**
 * Every model answer the tests use, keyed by the step that asks for it.
 *
 * `route` is the section pick, and the rest are section revisions. Each one is
 * the *whole* section, because that is what the capability asks for — an answer
 * carrying only the entry the instruction mentioned is a deletion of the rest,
 * and there is a test for that below.
 */
const ANSWERS: Readonly<Record<string, Record<string, unknown>>> = {
  route: { section: 'skills', reason: 'It names a programming language.' },
  skills: {
    skills: {
      role: 'Backend Engineer',
      programming_languages: ['TypeScript', 'Ruby'],
      frameworks: ['NestJS'],
      libraries_and_tools: ['PostgreSQL']
    }
  },
  personal: {
    personal: {
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      phone: '+48 600 100 200',
      location: 'Berlin',
      links: { github: 'https://github.test/ada' }
    }
  },
  role_description: { summary: 'Backend engineer with 9 years on payment systems.' },
  experience: {
    experience: [
      {
        company: 'Acme',
        title: 'Staff Backend Engineer',
        started: '2019-03',
        // The sentinel, on a job that has not ended. If this reaches the
        // document as a string, every ongoing role acquires an end date whose
        // value is the word "present".
        finished: 'present',
        highlights: ['Increased throughput by 30%.'],
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
    ]
  },
  languages: { languages: [{ name: 'Polish', level: 'native' }, { name: 'English', level: 'C1' }] }
};

const answering = (
  over: Readonly<Record<string, Record<string, unknown>>> = {}
): Spine['deps']['effects']['ai']['generateObject'] => {
  const answers = { ...ANSWERS, ...over };
  return async <T,>(request: ObjectRequest<T>): Promise<ObjectResult<T>> => ({
    object: (answers[request.step ?? ''] ?? {}) as T,
    finishReason: 'stop',
    usage: {}
  });
};

const harness = async <T>(
  body: (s: Spine) => Promise<T>,
  over: Readonly<Record<string, Record<string, unknown>>> = {}
): Promise<T> => {
  const s = spine(capabilities, { ai: { generateObject: answering(over) } });
  try {
    return await body(s);
  } finally {
    s.dispose();
  }
};

const edit = (s: Spine, input: Record<string, unknown>) =>
  startRun(s.deps, { capability: 'edit_cv', input: { document: STORED, ...input } });

const documentOf = (data: Readonly<Record<string, unknown>>): CvDocument =>
  data.document as CvDocument;

/** Every request the run made, in order, with what the model was actually told. */
type Seen = { readonly step: string; readonly system: string; readonly prompt: string };

const recorded = async (
  input: Record<string, unknown>,
  over: Readonly<Record<string, Record<string, unknown>>> = {}
): Promise<Seen[]> => {
  const answers = { ...ANSWERS, ...over };
  const seen: Seen[] = [];

  const s = spine(capabilities, {
    ai: {
      generateObject: async <T,>(request: ObjectRequest<T>): Promise<ObjectResult<T>> => {
        seen.push({
          step: request.step ?? '',
          system: request.system,
          prompt: request.prompt
        });
        return { object: (answers[request.step ?? ''] ?? {}) as T, finishReason: 'stop', usage: {} };
      }
    }
  });

  try {
    await edit(s, input);
  } finally {
    s.dispose();
  }

  return seen;
};

/** A conversation an instruction like "make it shorter" is unreadable without. */
const EARLIER = {
  history: [
    { role: 'user', text: 'How long is my summary?' },
    { role: 'assistant', text: 'Three paragraphs, about 90 words.' }
  ],
  summary: 'GOAL: a CV that fits one page.'
};

/* -------------------------------------------------- what reaches the model */

test('an instruction about one section is sent that section and nothing else', async () => {
  const prompts: { step: string; prompt: string }[] = [];

  const s = spine(capabilities, {
    ai: {
      generateObject: async <T,>(request: ObjectRequest<T>): Promise<ObjectResult<T>> => {
        prompts.push({ step: request.step ?? '', prompt: request.prompt });
        return { object: (ANSWERS[request.step ?? ''] ?? {}) as T, finishReason: 'stop', usage: {} };
      }
    }
  });

  try {
    await edit(s, { instruction: 'Add Ruby to my programming languages.' });
  } finally {
    s.dispose();
  }

  const revise = prompts.find((entry) => entry.step === 'skills');
  assert.ok(revise, 'the skills step never ran');

  // The blast radius, stated as an assertion. A model that cannot see the
  // employment history cannot rewrite it, however the instruction is worded and
  // whatever the CV was extracted from.
  assert.match(revise.prompt, /Ruby/);
  assert.match(revise.prompt, /TypeScript/);
  assert.ok(!revise.prompt.includes('Acme'), 'the jobs went into a prompt about skills');
  assert.ok(!revise.prompt.includes('Cambridge'), 'the degrees went into a prompt about skills');
  assert.ok(!revise.prompt.includes('cv.txt'), 'the provenance went into a prompt about skills');
});

test('a caller that names the section does not pay for a routing call', async () => {
  const steps: string[] = [];

  const s = spine(capabilities, {
    ai: {
      generateObject: async <T,>(request: ObjectRequest<T>): Promise<ObjectResult<T>> => {
        steps.push(request.step ?? '');
        return { object: (ANSWERS[request.step ?? ''] ?? {}) as T, finishReason: 'stop', usage: {} };
      }
    }
  });

  try {
    // A panel where somebody clicked into Contact details already knows. Asking
    // a model to work it out again is a provider request against a quota to
    // learn something the click said.
    const result = await edit(s, { instruction: 'I moved to Berlin.', section: 'personal' });
    assert.equal(documentOf(result.data).personal.location, 'Berlin');
  } finally {
    s.dispose();
  }

  assert.deepEqual(steps, ['personal']);
});

/* --------------------------------------------------------- what must change */

test('the instruction reaches the section the model routed it to', async () => {
  await harness(async (s) => {
    const result = await edit(s, { instruction: 'Add Ruby to my programming languages.' });

    assert.equal(result.data.section, 'skills');
    assert.equal(result.data.changed, true);
    assert.deepEqual(documentOf(result.data).skills.programming_languages, [
      'TypeScript',
      'Ruby'
    ]);
  });
});

test('an end date that has not arrived comes back as null, and a real one survives', async () => {
  await harness(
    async (s) => {
      const document = documentOf(
        (await edit(s, { instruction: 'I am a staff engineer at Acme now.' })).data
      );

      assert.equal(document.experience[0]?.title, 'Staff Backend Engineer');
      // The model wrote the word. The document's schema has three states and
      // this is the one a string cannot carry.
      assert.equal(document.experience[0]?.finished, null);
      assert.equal(document.experience[1]?.finished, '2019-02');
    },
    { route: { section: 'experience', reason: 'It names a job title.' } }
  );
});

/* ----------------------------------------------------- what must not change */

test('only the routed section changes', async () => {
  await harness(async (s) => {
    const document = documentOf(
      (await edit(s, { instruction: 'Add Ruby to my programming languages.' })).data
    );

    // The answers above also carry a personal section, a summary, an experience
    // list and a languages list. None of them was routed to, so none of them may
    // appear — a merge that took every key the model happened to answer would
    // move this person to Berlin for asking about Ruby.
    assert.equal(document.personal.location, 'Warsaw');
    assert.equal(document.personal.phone, '');
    assert.equal(document.role_description, STORED.role_description);
    assert.deepEqual(document.experience, STORED.experience);
    assert.deepEqual(document.education, STORED.education);
    assert.deepEqual(document.certificates, STORED.certificates);
    assert.deepEqual(document.languages, STORED.languages);

    // Neither of these is the model's to restate. `version` says which schema
    // the body was written against, and `sources` is where the facts came from.
    assert.equal(document.version, 1);
    assert.deepEqual(document.sources, STORED.sources);
  });
});

test('a proposal is not a save', async () => {
  await harness(async (s) => {
    s.deps.documents.update(CV_ID, CV_KIND, () => STORED as never);

    await startRun(s.deps, {
      capability: 'edit_cv',
      input: { instruction: 'Add Ruby to my programming languages.' }
    });

    // The point of the whole capability. There is no revision history yet, so a
    // write from prose could not be undone; the caller shows the difference and
    // saves it through the same channel a manual edit uses.
    const stored = cvDocumentSchema.parse(s.deps.documents.read(CV_ID)?.body);
    assert.deepEqual(stored.skills.programming_languages, ['TypeScript']);
  });
});

test('an answer that changes nothing says so', async () => {
  await harness(
    async (s) => {
      const result = await edit(s, { instruction: 'Add Ruby to my programming languages.' });

      // Distinguishable from an edit that worked, so a caller can say "nothing
      // changed" rather than showing an empty diff and letting somebody press
      // Apply on it.
      assert.equal(result.data.changed, false);
      assert.deepEqual(documentOf(result.data).skills, STORED.skills);
    },
    { skills: { skills: STORED.skills } }
  );
});

test('a shortened list is proposed, not refused', async () => {
  await harness(
    async (s) => {
      const document = documentOf((await edit(s, { instruction: 'Remove the Globex job.' })).data);

      // Deliberately allowed. "Remove the Globex job" is a real instruction and
      // a model dropping a job it was not asked about looks identical from
      // here, so the check is the person who sees the difference before saving
      // — which is only a safe answer because nothing has been written.
      assert.equal(document.experience.length, 1);
      assert.equal(document.experience[0]?.company, 'Acme');
    },
    {
      route: { section: 'experience', reason: 'It names a job.' },
      experience: {
        experience: [
          {
            company: 'Acme',
            title: 'Senior Backend Engineer',
            started: '2019-03',
            finished: 'present',
            highlights: ['Increased throughput by 30%.'],
            skills: ['TypeScript']
          }
        ]
      }
    }
  );
});

/* --------------------------------------------------------------- refusals */

test('an instruction that fits no section is refused, and says which exist', async () => {
  await harness(
    async (s) => {
      await assert.rejects(
        () => edit(s, { instruction: 'Make it better.' }),
        // Naming the sections is the only thing the caller can act on. Picking
        // one anyway would edit a section nobody asked about.
        /Could not tell which part of the CV to change.*role_description/s
      );
    },
    { route: { section: 'everything', reason: 'All of it.' } }
  );
});

test('a section the model reshaped fails the run rather than reaching the caller', async () => {
  await harness(
    async (s) => {
      // A string where the document wants a list of entries. The step schema is
      // the model's contract and the document schema is the store's, and this
      // is parsed against both — the caller is about to save whatever comes
      // back, so a body that is not a CV must not come back at all.
      // Named, and the name is the assertion. Without the per-section check
      // the whole-document parse below it still refuses the body, with a
      // message whose path happens to start `languages` — true and unreadable.
      await assert.rejects(
        () => edit(s, { instruction: 'I speak English too.' }),
        /The edit to languages is not a usable section/
      );
    },
    {
      route: { section: 'languages', reason: 'It names a spoken language.' },
      languages: { languages: 'Polish, English' }
    }
  );
});

test('a model that cannot answer ends the run instead of proposing the CV unchanged', async () => {
  const s = spine(capabilities, {
    ai: {
      generateObject: async <T,>(request: ObjectRequest<T>): Promise<ObjectResult<T>> => {
        if (request.step === 'route') {
          return { object: ANSWERS.route as T, finishReason: 'stop', usage: {} };
        }
        throw new Error('the provider is down');
      }
    }
  });

  try {
    // The reason it says why, and not just that it failed. A degrading revise
    // step reaches `merge` with no answer, which refuses too — so the run dies
    // either way and the difference is the message: "the edit produced nothing"
    // sends somebody looking at their CV for a problem that is in the
    // provider.
    await assert.rejects(() => edit(s, { instruction: 'Add Ruby.' }), /the provider is down/);
  } finally {
    s.dispose();
  }
});

/* -------------------------------------------------------------- the blank CV */

test('with nothing stored, the edit is proposed over an empty document', async () => {
  await harness(
    async (s) => {
      const result = await startRun(s.deps, {
        capability: 'edit_cv',
        input: { instruction: 'My name is Ada Lovelace and I am in Berlin.' }
      });

      // Where this parts company with `translate_cv`, which refuses: there is
      // nothing to translate without a CV, and dictating the first line of one
      // is a reasonable way to begin. Nothing is written either way.
      const document = documentOf(result.data);
      assert.equal(document.personal.name, 'Ada Lovelace');
      assert.equal(document.personal.location, 'Berlin');
      assert.deepEqual(document.experience, []);
      assert.deepEqual(document.sources, []);
    },
    { route: { section: 'personal', reason: 'It names a person and a city.' } }
  );
});


/* ---------------------------------------------------------- what came before */

test('a follow-up is routed from what came before it, not from the sentence alone', async () => {
  const seen = await recorded(
    { instruction: 'Make it shorter.', ...EARLIER },
    { route: { section: 'role_description', reason: 'The summary is what is long.' } }
  );

  const route = seen.find((entry) => entry.step === 'route');
  assert.ok(route, 'the routing step never ran');

  // "Make it shorter" names no section. Routed from that sentence alone this is
  // a choice between seven made from an instruction with no subject, and
  // whichever it lands on is then rewritten from the same sentence.
  assert.match(route.prompt, /Three paragraphs, about 90 words\./);
  assert.match(route.prompt, /GOAL: a CV that fits one page\./);
  assert.match(route.prompt, /INSTRUCTION:\nMake it shorter\./);
});

test('the section being revised is told what came before it, as context and not as the task', async () => {
  const seen = await recorded(
    { instruction: 'Make it shorter.', ...EARLIER },
    { route: { section: 'role_description', reason: 'The summary is what is long.' } }
  );

  const revise = seen.find((entry) => entry.step === 'role_description');
  assert.ok(revise, 'the revise step never ran');

  const earlier = revise.prompt.indexOf('Three paragraphs, about 90 words.');
  const current = revise.prompt.indexOf('CURRENT SUMMARY');
  const instruction = revise.prompt.indexOf('INSTRUCTION:');

  // Ordered, not merely present. The instruction is the task and sits last,
  // next to where the answer starts, with the section it applies to
  // immediately before it; what was said earlier is context and sits ahead of
  // both.
  assert.ok(earlier >= 0, 'the conversation never reached the revision');
  assert.ok(earlier < current, 'the conversation came after the section');
  assert.ok(current < instruction, 'the instruction came before the section');

  // And it is named as background. The conversation of an editing chat is a
  // list of instructions that have already been applied, and a model reading
  // them as outstanding applies them a second time.
  assert.match(revise.system, /The conversation is background\. Apply only the instruction\./);
});

test('a first instruction is sent exactly what it was sent before this existed', async () => {
  const seen = await recorded({ instruction: 'Add Ruby to my programming languages.' });

  // The routing prompt was measured 6 of 6 on a local model and the note above
  // it says to leave the wording alone. This is how it stays left alone: with
  // nothing to say, `labelled` returns nothing and `compose` drops it, so the
  // first instruction of a conversation is the prompt that was measured.
  for (const entry of seen) {
    assert.ok(
      !entry.prompt.includes('THE CONVERSATION SO FAR'),
      `${entry.step} was given an empty conversation to read`
    );
    assert.ok(
      !entry.prompt.includes('EARLIER IN THIS CONVERSATION'),
      `${entry.step} was given an empty note to read`
    );
    assert.ok(
      !entry.system.includes('The conversation is background'),
      `${entry.step} was told to ignore a conversation it was never given`
    );
  }

  assert.ok(seen[0]?.prompt.startsWith('INSTRUCTION:'), 'the routing prompt gained a preamble');
});

test('more conversation than the ceiling is refused, not quietly trimmed', async () => {
  await harness(async (s) => {
    await assert.rejects(
      edit(s, {
        instruction: 'Make it shorter.',
        // Two turns, well inside the count and far outside the size. Trimmed
        // here this would answer a different question than the caller believes
        // it asked — and the caller is the one holding the transcript, so it is
        // the only party that knows which turns are droppable.
        history: [
          { role: 'user', text: 'x'.repeat(4_000) },
          { role: 'assistant', text: 'y'.repeat(4_000) }
        ]
      }),
      /at most 6000 characters/i
    );
  });
});
