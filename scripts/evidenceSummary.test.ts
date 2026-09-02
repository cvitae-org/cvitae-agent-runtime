/**
 * `generate_evidence_summary`, which is mostly a checker with a model call in
 * the middle.
 *
 * The capability's claim is that nothing reaches the caller unless a fact in
 * the CV supports it, so almost every test here is an attempt to get something
 * unsupported past the review. That is the right shape for this file: the
 * interesting behaviour is not what a good draft produces, it is what a
 * plausible bad one is stopped from producing — a rounded-up language level, a
 * year that appears in no fact, a sentence lifted whole from the previous
 * summary. Each of those is a real thing a model does when asked to persuade,
 * and each has a test.
 *
 * The refuse/drop split is asserted directly rather than implied, because it is
 * the design decision most likely to be flattened by a later reader into "throw
 * on everything" or "warn on everything". A claim that would mislead an
 * employer fails the run; a claim that is merely unusable is dropped and named.
 * Tests exist on both sides of that line.
 *
 * Mutations run, not assumed. Each was applied, the whole suite run, the
 * failures counted, and the mutation reverted:
 *
 *   number check removed                  1  a number absent from the cited …
 *   phone shape without the digit count   1  a date range survives redaction
 *   unknown ids treated as resolvable     1  an id that resolves to nothing …
 *   language check compares CEFR only     1  a level the cited fact does not …
 *   proficiency words checked everywhere  1  a proficiency word about a skill …
 *   fitWithin truncates to the ceiling    2  an overlong draft loses whole … /
 *                                            prose that cannot fit is refused …
 *   the floor warning dropped             1  a summary under the floor is …
 *   default aggregate (shallow merge)     1  the unchecked draft never reaches …
 *   the review step made non-critical     1  a draft that fails review fails …
 *   the draft step made non-critical      1  a failed model call is reported …
 *   the catalogue step made non-critical  1  a missing CV costs no model call
 *
 * Three of these are worth reading rather than counting. Replacing `fitWithin`'s
 * whole-sentence selection with a substring of the right length passes the
 * ceiling check and the floor check, and fails only on every claim still ending
 * in a full stop — which is the entire point of the function, and invisible to
 * a test that measured length alone.
 *
 * And the review-step mutation survived the first time it was run. Making that
 * step non-critical broke nothing, because no test had ever made the review
 * fail: the capability would have degraded instead, `aggregate` would have
 * found no reviewed step, and the run would have reported success with an empty
 * result — a summary the caller cannot distinguish from one that legitimately
 * came back short. `a draft that fails review fails the run` was written to
 * close that, and is the test the mutation now kills.
 *
 * The draft-step mutation survived too, for a subtler reason: making it
 * non-critical still failed the run, just with the wrong error. The review
 * would read no draft, find no cited claims in the empty string, and report
 * that the model returned none — so someone whose provider was unreachable
 * would be reading about citation format. `a failed model call is reported as
 * a failed model call` pins the message, not just the failure.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilities } from '../src/capabilities/index.js';
import { CV_ID, CV_KIND, cvDocumentSchema } from '../src/capabilities/cv/document.js';
import {
  catalogueOf,
  generateEvidenceSummary,
  inputSchema,
  requirementsOf
} from '../src/capabilities/cv/evidence.js';
import { parseClaims, review, withoutContacts } from '../src/capabilities/cv/claims.js';
import { startRun } from '../src/runtime/run.js';
import { spine, type Spine } from './support/spine.js';
import type { Fact, Requirement } from '../src/capabilities/cv/claims.js';
import type { AiGateway, TextRequest } from '../src/contracts/index.js';

/* ------------------------------------------------------------------ fixtures */

const CV = cvDocumentSchema.parse({
  personal: {
    name: 'Jan Kowalski',
    email: 'jan@kowalski.test',
    phone: '+48 601 234 567',
    location: 'Kraków',
    links: {}
  },
  role_description:
    'Frontend engineer with a long record of rebuilding checkout flows under load. '
    + 'Reach me on +48 601 234 567.',
  skills: {
    role: 'Senior Frontend Engineer',
    programming_languages: ['TypeScript'],
    frameworks: ['React'],
    libraries_and_tools: []
  },
  experience: [
    {
      company: 'Acme',
      title: 'Senior Frontend',
      started: '2020',
      finished: null,
      highlights: ['Rebuilt the checkout in React, cutting load time in half.'],
      skills: []
    }
  ],
  education: [],
  certificates: [],
  languages: [{ name: 'English', level: 'B2' }],
  sources: []
});

const OFFER = {
  position: 'Senior Frontend Engineer',
  company: 'Globex',
  required_skills: ['TypeScript', 'React'],
  responsibilities: ['Own the checkout experience']
};

const facts = (): Fact[] => catalogueOf(CV);
const requirements = (): Requirement[] => requirementsOf(OFFER);

/** The ceiling every review test runs under. 200 is the contract's floor. */
const MAX = 200;

const reviewed = (draft: string, maxChars = MAX) =>
  review(draft, { facts: facts(), requirements: requirements(), maxChars });

/**
 * A draft that should survive untouched.
 *
 * Long enough to clear the 60% floor at `MAX`, which is not incidental: a
 * fixture that only just parses would pass the citation tests and fail the
 * length one, and every test built on it would then be asserting two things at
 * once.
 */
const GOOD =
  'EVIDENCE(job:0,skill:0) REQUIREMENTS(req:0) :: Senior Frontend at Acme since 2020, working in '
  + 'TypeScript across the whole application.\n'
  + 'EVIDENCE(job:0:0) REQUIREMENTS(req:2) :: Rebuilt the checkout in React, cutting load time in half.';

/* ----------------------------------------------------------- the catalogue */

test('a fact id resolves to one part of the CV and nothing near it', () => {
  const byId = new Map(facts().map((fact) => [fact.id, fact.text]));

  assert.equal(byId.get('role'), 'Senior Frontend Engineer');
  assert.equal(byId.get('skill:0'), 'TypeScript');
  assert.equal(byId.get('skill:1'), 'React');
  assert.equal(byId.get('job:0'), 'Senior Frontend at Acme (2020–present)');
  assert.equal(byId.get('job:0:0'), 'Rebuilt the checkout in React, cutting load time in half.');
  assert.equal(byId.get('lang:0'), 'English — level B2');
});

test('an ongoing position reads as present, and an unstated end reads as nothing', () => {
  // `endish` has three states and two of them are falsy. A formatter that tests
  // truthiness collapses "ongoing" and "not stated" into the same output, and
  // the first is a claim the CV makes while the second is one it declines to.
  const ended = cvDocumentSchema.parse({
    ...CV,
    experience: CV.experience.map((entry) => ({ ...entry, started: '2018', finished: '2020' }))
  });

  assert.match(catalogueOf(ended).find((f) => f.id === 'job:0')?.text ?? '', /\(2018–2020\)/);
});

test('contacts are stripped from the catalogue before the model sees it', () => {
  const summary = facts().find((fact) => fact.id === 'summary')?.text ?? '';

  assert.doesNotMatch(summary, /601/);
  assert.match(summary, /\[removed\]/);
});

test('a date range survives redaction', () => {
  // The shape of a phone number and the shape of `2019-2023` are the same
  // shape. Redacting the second would strip years out of the evidence and then
  // refuse a claim that cited them — a check turning true statements into run
  // failures, which costs more than the leak it was guarding.
  assert.equal(withoutContacts('Worked there 2019-2023.'), 'Worked there 2019-2023.');
  assert.equal(withoutContacts('Call +48 601 234 567.'), 'Call [removed].');
});

test('required skills are catalogued before responsibilities', () => {
  // `analyze_offer` produces no priority field. Order is the only signal in the
  // data, and inventing a priority would assert something no step measured.
  const listed = requirements();

  assert.deepEqual(
    listed.map((entry) => `${entry.id}:${entry.category}`),
    ['req:0:skill', 'req:1:skill', 'req:2:responsibility']
  );
});

/* -------------------------------------------------------------- the protocol */

test('a marker line becomes a claim carrying its citations', () => {
  const [claim] = parseClaims('EVIDENCE(job:0,skill:0) REQUIREMENTS(req:0) :: Did the thing.');

  assert.equal(claim?.text, 'Did the thing.');
  assert.deepEqual(claim?.evidenceIds, ['job:0', 'skill:0']);
  assert.deepEqual(claim?.requirementIds, ['req:0']);
});

test('bullets and numbering around the marker are tolerated', () => {
  // A model told to write one claim per line will number them anyway. The
  // wrapping carries no meaning, so refusing it would fail a correct answer.
  assert.equal(
    parseClaims('- EVIDENCE(job:0) REQUIREMENTS(req:0) :: A.\n2) EVIDENCE(skill:0) REQUIREMENTS(req:1) :: B.')
      .length,
    2
  );
});

test('a wrapped line continues a claim only while that claim is unfinished', () => {
  const wrapped = parseClaims(
    'EVIDENCE(job:0) REQUIREMENTS(req:0) :: A sentence that ran\nover two lines.'
  );
  assert.equal(wrapped[0]?.text, 'A sentence that ran over two lines.');

  // The finished case is the one that matters: appending here would attach
  // uncited prose to a citation that never covered it, which is precisely the
  // thing the protocol exists to prevent.
  const finished = parseClaims(
    'EVIDENCE(job:0) REQUIREMENTS(req:0) :: A finished sentence.\nUncited prose.'
  );
  assert.equal(finished.length, 1);
  assert.equal(finished[0]?.text, 'A finished sentence.');
});

/* ------------------------------------------------------------ what is refused */

test('a good draft passes with nothing dropped', () => {
  const result = reviewed(GOOD);

  assert.equal(result.claims.length, 2);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.chars, result.claims.map((c) => c.text).join(' ').length);
});

test('a number absent from the cited evidence is refused', () => {
  // The specific failure: eight years of experience out of a CV that says four.
  // It reads well, it is unfalsifiable from the paragraph alone, and it is the
  // first thing an interviewer checks.
  assert.throws(
    () =>
      reviewed(
        'EVIDENCE(job:0) REQUIREMENTS(req:0) :: 8 years of frontend work since 2016.\n'
        + 'EVIDENCE(skill:0) REQUIREMENTS(req:1) :: Writes TypeScript daily.'
      ),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'step_failed');
      assert.match(error.message, /numbers/);
      // The message reaches a run record and a log. The CV does not.
      assert.doesNotMatch(error.message, /frontend work/);
      return true;
    }
  );
});

test('a number the cited fact does state is left alone', () => {
  assert.equal(reviewed(GOOD).claims[0]?.text.includes('2020'), true);
});

test('a claim citing nothing at all is refused, not weakened', () => {
  assert.throws(
    () =>
      reviewed(
        'EVIDENCE() REQUIREMENTS() :: A confident sentence about nothing.\n'
        + 'EVIDENCE(skill:0) REQUIREMENTS(req:0) :: Writes TypeScript daily.'
      ),
    /cites no fact that exists/
  );
});

test('an id that resolves to nothing is named without exposing the prose', () => {
  const result = reviewed(GOOD.replace('EVIDENCE(job:0,skill:0)', 'EVIDENCE(job:0,skill:0,job:99)'));

  assert.equal(result.claims.length, 2);
  assert.deepEqual(result.claims[0]?.evidenceIds, ['job:0', 'skill:0']);
  assert.match(result.warnings[0] ?? '', /cited 1 fact id that do not exist/);
  assert.doesNotMatch(result.warnings.join(' '), /Acme/);
});

test('a sentence copied whole from the previous summary is refused', () => {
  // The failure this catches is a model handed the old summary as evidence and
  // deciding the shortest route to a good sentence is the sentence already
  // written. The result looks fine and is not a summary aimed at this offer.
  assert.throws(
    () =>
      reviewed(
        'EVIDENCE(summary) REQUIREMENTS(req:0) :: Frontend engineer with a long record of '
        + 'rebuilding checkout flows under load.\n'
        + 'EVIDENCE(skill:0) REQUIREMENTS(req:1) :: Writes TypeScript daily.'
      ),
    /repeats a whole sentence/
  );
});

test('a contact detail in the output is refused', () => {
  assert.throws(
    () =>
      reviewed(
        'EVIDENCE(job:0) REQUIREMENTS(req:0) :: Reach me on +48 601 234 567 to discuss.\n'
        + 'EVIDENCE(skill:0) REQUIREMENTS(req:1) :: Writes TypeScript daily.'
      ),
    /contact detail/
  );
});

test('a summary under the floor is returned with a warning, not refused', () => {
  // Two valid claims, well inside the ceiling and far under the 60% floor. The
  // caller asked for a paragraph and got a caption — but a checked one, and
  // this capability has no second attempt to spend on making it longer.
  const result = reviewed(
    'EVIDENCE(skill:0) REQUIREMENTS(req:0) :: Writes TypeScript.\n'
    + 'EVIDENCE(skill:1) REQUIREMENTS(req:1) :: Writes React.',
    MAX
  );

  assert.equal(result.claims.length, 2);
  assert.match(result.warnings.join(' '), /short of the 120/);
});

test('fewer cited claims than the minimum is refused', () => {
  assert.throws(
    () => reviewed('EVIDENCE(skill:0) REQUIREMENTS(req:0) :: Writes TypeScript daily.'),
    /at least 2 are required/
  );
});

/* ------------------------------------------------------------- what is dropped */

test('a level the cited fact does not state drops the claim and says so', () => {
  // B2 is not fluent, and "fluent" is what a model writes when it is arguing.
  // The candidate is the one who finds out, in the interview, in that language.
  const result = reviewed(`${GOOD}\nEVIDENCE(lang:0) REQUIREMENTS(req:1) :: Fluent English speaker.`);

  assert.equal(result.claims.length, 2);
  assert.match(result.warnings.join(' '), /language level/);
});

test('a proficiency word about a skill is not read as a language level', () => {
  // "Advanced" is a language level in "advanced German" and an ordinary word
  // about depth in "advanced React work". Checking it everywhere would drop
  // true sentences about technical skill for the crime of describing it, and a
  // check that deletes true statements costs more than the leak it guards.
  const result = reviewed(
    `${GOOD}\nEVIDENCE(skill:1,job:0:0) REQUIREMENTS(req:1) :: Advanced React work on checkout.`
  );

  assert.equal(result.claims.length, 3);
  assert.equal(result.warnings.join(' ').includes('language level'), false);
});

test('an unfinished sentence is dropped, not repaired', () => {
  const result = reviewed(
    `${GOOD}\nEVIDENCE(skill:1) REQUIREMENTS(req:1) :: Extensive experience with.`
  );

  assert.equal(result.claims.length, 2);
  assert.match(result.warnings.join(' '), /does not finish/);
});

test('a repeated claim is dropped once', () => {
  const result = reviewed(`${GOOD}\n${GOOD.split('\n')[1]}`);

  assert.equal(result.claims.length, 2);
  assert.match(result.warnings.join(' '), /duplicate/);
});

test('an overlong draft loses whole sentences and keeps the first', () => {
  const long = [
    'EVIDENCE(job:0) REQUIREMENTS(req:0) :: Senior Frontend at Acme since 2020, leading the '
      + 'checkout rebuild from the first prototype through to release.',
    'EVIDENCE(skill:0) REQUIREMENTS(req:1) :: Writes TypeScript daily across the whole of the '
      + 'application, from the design system upwards.',
    'EVIDENCE(skill:1) REQUIREMENTS(req:1) :: Works in React on every surface the team owns, '
      + 'including the parts nobody enjoys.'
  ].join('\n');

  const result = reviewed(long);

  assert.ok(result.chars <= MAX, `${result.chars} characters is over the ceiling`);
  assert.ok(result.claims.length < 3, 'nothing was dropped');
  assert.match(result.claims[0]?.text ?? '', /^Senior Frontend at Acme/);
  // The whole reason this is a subset search and not a substring: every claim
  // that survives is still a sentence.
  for (const claim of result.claims) assert.match(claim.text, /[.!?]$/);
  assert.match(result.warnings.join(' '), /None was truncated/);
});

test('prose that cannot fit is refused rather than cut mid-sentence', () => {
  // Two sentences, each already most of the ceiling, and neither divisible
  // without cutting into it. Every subset is either under the minimum claim
  // count or over the ceiling, so there is nothing honest to return.
  const unfittable = [
    'EVIDENCE(skill:0) REQUIREMENTS(req:0) :: A very long sentence about the TypeScript work '
      + 'that will not fit anywhere at all, no matter which sentences are chosen to keep.',
    'EVIDENCE(skill:1) REQUIREMENTS(req:1) :: An equally long sentence about the React work '
      + 'that will not fit either, however generously the ceiling is read.'
  ].join('\n');

  assert.throws(() => reviewed(unfittable), /no whole-sentence subset/);
});

/* -------------------------------------------------------------------- the run */

type Asked = { readonly requests: TextRequest[] };

const harness = async <T>(
  options: { answer?: string },
  run: (s: Spine, asked: Asked) => Promise<T>
): Promise<T> => {
  const requests: TextRequest[] = [];

  const ai: Partial<AiGateway> = {
    generateText: async (request) => {
      requests.push(request);
      return { text: options.answer ?? GOOD, finishReason: 'stop', usage: {} };
    }
  };

  const s = spine(capabilities, { ai });

  try {
    return await run(s, { requests });
  } finally {
    s.dispose();
  }
};

const summarise = (s: Spine, input: Record<string, unknown> = {}) =>
  startRun(s.deps, {
    capability: 'generate_evidence_summary',
    input: { offer: OFFER, max_chars: MAX, ...input }
  });

const seed = (s: Spine) => s.deps.documents.update(CV_ID, CV_KIND, () => CV);

test('the capability is registered', () => {
  assert.equal(capabilities.generate_evidence_summary, generateEvidenceSummary);
});

test('an offer with no requirements is rejected before a run starts', () => {
  // There is nothing to argue against, so every claim would cite REQUIREMENTS()
  // and the paragraph would be a generic summary wearing citation markers.
  const parsed = inputSchema.safeParse({
    offer: { position: 'X', company: 'Y', required_skills: [], responsibilities: [] }
  });

  assert.equal(parsed.success, false);
});

test('the plan spends exactly one model call', async () => {
  await harness({}, async (s, asked) => {
    seed(s);
    const result = await summarise(s);

    assert.equal(asked.requests.length, 1);
    assert.equal(result.outcomes.length, 3, 'the plan gained or lost a step');

    // A clean answer produces a clean result. Without this the warning tests
    // below would still pass against a fixture that quietly warns on every
    // run, and "no warning" would stop meaning anything.
    const summary = result.data as unknown as { warnings: string[]; summary: string };
    assert.deepEqual(summary.warnings, []);
    assert.ok(summary.summary.length > 0);
  });
});

test('a missing CV costs no model call', async () => {
  await harness({}, async (s, asked) => {
    await assert.rejects(
      () => summarise(s),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, 'invalid_input');
        return true;
      }
    );

    assert.equal(asked.requests.length, 0, 'a model was paid to summarise nothing');
  });
});

test('a failed model call is reported as a failed model call', async () => {
  // The draft step is critical, and this is what that buys. Degraded, the run
  // would reach the review with no draft, and the review would report that the
  // model returned no cited claims — blaming the output for a call that never
  // produced one. The caller chasing an unreachable provider would be reading
  // about citation format.
  const ai: Partial<AiGateway> = {
    generateText: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    }
  };
  const s = spine(capabilities, { ai });

  try {
    seed(s);
    await assert.rejects(() => summarise(s), /ECONNREFUSED/);
  } finally {
    s.dispose();
  }
});

test('the prompt carries the ids the model is asked to cite', async () => {
  await harness({}, async (s, asked) => {
    seed(s);
    await summarise(s);

    const prompt = asked.requests[0]?.prompt ?? '';
    assert.match(prompt, /job:0:0 \| Rebuilt the checkout/);
    assert.match(prompt, /req:0 \| \(skill\) TypeScript/);
    // What the model cannot cite, it cannot leak.
    assert.doesNotMatch(prompt, /601 234 567/);
  });
});

test('the result names the CV revision it was written from', async () => {
  await harness({}, async (s) => {
    seed(s);
    const result = await summarise(s);
    const provenance = result.data.provenance as Record<string, unknown>;

    assert.equal(provenance.cv_revision, 1);
    assert.equal(provenance.provider_id, 'local');
    assert.equal(provenance.facts, facts().length);
  });
});

test('a summary of a passed document claims no revision', async () => {
  // Honest absence. A revision number on a document the store never saw would
  // point at whatever happened to be stored instead.
  await harness({}, async (s) => {
    seed(s);
    const result = await summarise(s, { document: CV });
    const provenance = result.data.provenance as Record<string, unknown>;

    assert.equal('cv_revision' in provenance, false);
  });
});

test('a draft that fails review fails the run', async () => {
  // The one degraded outcome there is no safe version of. A non-critical review
  // would let uncited prose fall out of the plan and the run would end
  // `succeeded` with nothing in it — which reads, from the caller's side,
  // exactly like a CV that had too little in it to summarise.
  await harness({ answer: 'A confident paragraph with no citation markers anywhere.' }, async (s) => {
    seed(s);

    await assert.rejects(
      () => summarise(s),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, 'step_failed');
        return true;
      }
    );

    const [run] = s.runs.list({ limit: 1 });
    assert.equal(run?.status, 'failed', 'an unreviewable draft produced a successful run');
  });
});

test('the unchecked draft never reaches the caller', async () => {
  await harness({}, async (s) => {
    seed(s);
    const result = await summarise(s);

    assert.equal('draft' in result.data, false, 'the raw model output was published');
    assert.equal('facts' in result.data, false, 'the working catalogue was published');
    assert.match(String(result.data.summary), /^Senior Frontend at Acme since 2020, working in/);
  });
});
