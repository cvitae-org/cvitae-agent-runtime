/**
 * A piece of the CV in a shorter form, for a message that would not otherwise fit.
 *
 * A message over its limit is refused, and nothing is cut to fit. A person who
 * would rather send the pieces shortened says so (`grounding.overflow: 'compact'`),
 * and then, and only then, the pieces that have a shorter form are sent in it, the
 * one that saves most first and no more of them than it takes. The questions, in
 * order:
 *
 *   the forms     each is a pure function of its piece, says in the piece what it
 *                 leaves out, and is never longer than what it stands for
 *   asked for     nothing is shortened unless asked, and nothing that is not over
 *   which, how    the largest saving first, as few as will do, never one named in
 *                 `full`, and a refusal after that says what was tried
 *   the record    the entry names the original and its digest, and says what was
 *                 shown; the preview and the plan say so as well
 *   the original  a piece that changes in a part the form does not show is a piece
 *                 that has changed
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. The number is how many tests failed.
 *
 * 83 were applied.
 *
 * the forms:
 *   an experience entry keeps three highlights                 14
 *   an experience entry keeps one highlight                    11
 *   a role description keeps 301 characters                    2
 *   a role description keeps 299 characters                    3
 *   skills keep seven of each group                            1
 *   skills keep five of each group                             1
 *   a form does not say what it leaves out                     13
 *   what is left out is said as joined with a comma            1
 *   one more is said as plural                                 2
 *   a count is not said in words                               5
 *   a role description ends where a sentence does, anywhere    2
 *   a role description ends where a sentence does, only in the last tenth 2
 *   a role description ends at a sentence of the first half    1
 *   a role description is cut through a word                   2
 *   a role description that ends on a space loses its last word 1
 *   a role description of 300 characters has a form            1
 *   a role description of 301 characters has none              1
 *   skills with no more than six have a form                   0 (equivalent: with nothing left out the form is the whole, and a form is kept only when it is shorter)
 *   skills count the more of the first group only              1
 *   skills lose their role                                     1
 *   skills keep every item of a group                          3
 *   an experience entry loses its dates                        3
 *   an experience entry loses its heading                      9
 *   an experience entry does not say its skills are left out   2
 *   an experience entry does not say its highlights are left out 21
 *   an experience entry that has skills only has no form       1
 *   an experience entry says how many highlights are left out wrongly 3
 *   an education entry without a thesis has a form             0 (equivalent: such a form is the whole entry, and a form is kept only when it is shorter)
 *   an education entry loses its mark                          2
 *   an education entry loses its dates                         1
 *   an education entry keeps its thesis                        3
 *   a certificate has a form                                   1
 *   a form that is as long as the whole is a form              1
 *   a form that is longer than the whole is a form             3
 *   an item that is not an object is read as a row             0 (equivalent: a primitive has no field the form reads, as an empty row has none)
 *
 * what is shortened, and in what order:
 *   a message is shortened without being asked                 4
 *   a message that asks to be shortened is shortened even when it fits 10
 *   a piece is shortened while the message is at its limit     8
 *   the smallest saving goes first                             8
 *   the latest of two that save the same goes first            2
 *   pieces are shortened in the order they are sent            1
 *   a piece named in full is shortened                         2
 *   a section named in full does not hold its entries          2
 *   what is named in full is the pieces of the first name only 1
 *   the saving is the length of the form                       5
 *   the size does not go down by what was saved                15
 *   the size goes down by twice what was saved                 8
 *   the block is not replaced by its form                      4
 *   the entry does not say what was shown                      7
 *   the entry says what was shown for a piece that was not shortened 4
 *   the entry's digest is of the form                          8
 *   the entry's shown is of the original                       7
 *   a piece is said to be shortened that was not               13
 *   a shortened piece is not said to be                        13
 *   a message that is shortened has a compacted that is always there 1
 *   a message that is shortened says nothing of it             11
 *   a form is made from the original and not from what the model is shown 0 (equivalent: a piece that is shown is shown whole, so what is shown of it is the original)
 *   a form of a list entry is made from the original           0 (equivalent: a piece that is shown is shown whole, so what is shown of it is the original)
 *   an overview piece has no form                              1
 *   a list piece has no form                                   16
 *
 * refusal after shortening:
 *   a refusal does not say shortening was tried                5
 *   a refusal always says shortening was tried                 5
 *   a refusal says how many were shortened wrongly             3
 *   the budget refusal does not say shortening was tried       2
 *   the limit refusal does not say shortening was tried        3
 *   the assembly is refused without counting what was shortened 1
 *   the size need is refused without counting what was shortened 4
 *
 * carrying the ask to the assembly, the size and the preview:
 *   the size of a message does not know it is shortened        1
 *   the size need does not know it is shortened                16
 *   overflow is not carried to the assembly                    16
 *   full is not carried to the assembly                        2
 *   overflow is not carried by the run                         14
 *   full is not carried by the run                             1
 *   the run does not say what was shortened                    9
 *   the run always says what was shortened                     1
 *   the preview does not say what was shortened                1
 *   the preview always says what was shortened                 1
 *   the input takes no overflow                                17
 *   the input takes any overflow                               1
 *   the input takes no full                                    3
 *   the input takes 13 pieces in full                          1
 *   the input takes 11 pieces in full                          1
 *   a piece named in full is kept as it was spelled            1
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { CV_KIND } from '../src/capabilities/cv/document.js';
import { assembleCv, staleCv } from '../src/capabilities/cv/assembly.js';
import { COMPACT_HIGHLIGHTS, COMPACT_SKILLS, COMPACT_TEXT, renderCompact } from '../src/capabilities/cv/compact.js';
import { render } from '../src/capabilities/cv/render.js';
import { PICKS_BUDGET, groundingSchema } from '../src/context/ground.js';
import { digest } from '../src/grounding/digest.js';
import { planDigestOf } from '../src/grounding/plan.js';
import { bindCvScope } from '../src/runtime/cv-scope.js';
import { previewRun } from '../src/runtime/preview.js';
import type { Preview } from '../src/runtime/preview.js';
import type { RecordEntry } from '../src/contracts/index.js';
import { CHAT_RUN, CONTEXT, chat, cv, ref, refusal, settle } from './support/chat.js';
import type { Chat } from './support/chat.js';

const QUESTION = 'What did I do with billing?';

/** A line of about as many characters as a person writes for one highlight. */
const said = (what: string): string => `${what} was a long piece of work that took a whole quarter.`;

const JOB = {
  company: 'Acme',
  title: 'Senior Engineer',
  started: '2021',
  finished: null as string | null,
  highlights: [said('One'), said('Two'), said('Three'), said('Four')],
  skills: ['Go', 'SQL']
};

const EDUCATION = {
  university: 'MIT',
  degree: 'BSc Computer Science',
  started: '2012',
  finished: '2016',
  thesis: 'Type systems for compilers, and the design of the checks that keep them honest',
  mark: '5.0'
};

/* ----------------------------------------------------------------- the forms */

test('an experience entry is its heading, its dates and its first two highlights, and says what it leaves out', () => {
  assert.equal(COMPACT_HIGHLIGHTS, 2);

  assert.equal(
    renderCompact('experience', JOB),
    `Experience, Senior Engineer at Acme:\n2021 - present\n- ${said('One')}\n- ${said('Two')}\n(shortened: 2 more highlights and its 2 skills not shown)`
  );
  assert.equal(
    renderCompact('experience', { ...JOB, finished: '2023', highlights: [said('One'), said('Two'), said('Three')], skills: ['Go'] }),
    `Experience, Senior Engineer at Acme:\n2021 - 2023\n- ${said('One')}\n- ${said('Two')}\n(shortened: 1 more highlight and its 1 skill not shown)`,
    'one is said in the singular'
  );
  assert.equal(
    renderCompact('experience', { ...JOB, highlights: [said('One'), said('Two'), said('Three')], skills: [] }),
    `Experience, Senior Engineer at Acme:\n2021 - present\n- ${said('One')}\n- ${said('Two')}\n(shortened: 1 more highlight not shown)`,
    'and what is not left out is not said'
  );
  assert.equal(
    renderCompact('experience', { ...JOB, highlights: [said('One'), said('Two')], skills: ['TypeScript', 'PostgreSQL', 'Kubernetes', 'Terraform'] }),
    `Experience, Senior Engineer at Acme:\n2021 - present\n- ${said('One')}\n- ${said('Two')}\n(shortened: its 4 skills not shown)`,
    'an entry with nothing but skills to leave out leaves them out'
  );
  assert.equal(
    renderCompact('experience', { ...JOB, company: '', title: '', started: '' }),
    `Experience, entry:\n? - present\n- ${said('One')}\n- ${said('Two')}\n(shortened: 2 more highlights and its 2 skills not shown)`,
    'an entry with no heading is named as the whole form names it'
  );
});

test('an education entry is its heading, its dates and its mark, and leaves out its thesis', () => {
  assert.equal(
    renderCompact('education', EDUCATION),
    'Education, BSc Computer Science, MIT:\n2012 - 2016\nMark: 5.0\n(shortened: its thesis not shown)'
  );
  assert.equal(
    renderCompact('education', { ...EDUCATION, mark: '' }),
    'Education, BSc Computer Science, MIT:\n2012 - 2016\n(shortened: its thesis not shown)',
    'with no mark there is none to keep'
  );
  assert.equal(renderCompact('education', { ...EDUCATION, thesis: '' }), undefined, 'with no thesis there is nothing to leave out');
});

test('a role description is its first sentences up to 300 characters, ending where a sentence ends when one ends in the second half of them', () => {
  assert.equal(COMPACT_TEXT, 300);
  const sentence = 'Backend engineer focused on billing systems and their money.';
  const body = Array.from({ length: 8 }, () => sentence).join(' ');
  assert.ok(body.length > 300);

  const form = renderCompact('overview/role_description', body) as string;
  const [head, middle, tail] = form.split('\n') as [string, string, string];
  assert.equal(head, 'Role description:');
  assert.equal(tail, '(shortened: the rest of it not shown)');
  assert.ok(middle.length <= 300 && middle.length > 150, 'about as much as the limit allows');
  assert.equal(middle, Array.from({ length: 4 }, () => sentence).join(' '), 'four whole sentences: a fifth does not end before 300');
  assert.ok(body.startsWith(middle));

  // No sentence ends in the second half: it is cut at a word, and not through one.
  const run = Array.from({ length: 100 }, () => 'engineering').join(' ');
  const cut = (renderCompact('overview/role_description', run) as string).split('\n')[1] as string;
  assert.ok(cut.length <= 300 && cut.length > 280);
  assert.ok(run.startsWith(cut));
  assert.equal(run[cut.length], ' ', 'at the end of a word');
  assert.equal(cut.endsWith(' '), false);

  // A sentence that ends only in the first half is not a reason to keep so little.
  const early = `Short start. ${'engineering '.repeat(40).trim()}`;
  assert.ok(early.length > 300);
  assert.ok(((renderCompact('overview/role_description', early) as string).split('\n')[1] as string).length > 150);

  assert.equal(renderCompact('overview/role_description', 'x'.repeat(300)), undefined, 'at the limit it is whole');
  assert.ok(renderCompact('overview/role_description', 'x'.repeat(400)) !== undefined, 'past it, it is not');
  assert.equal(renderCompact('overview/role_description', `  ${'x'.repeat(300)}  `), undefined, 'the blanks round it are not counted, as the piece does not carry them');
});

test('skills keep the role and the first six of each group, and say how many more there are', () => {
  assert.equal(COMPACT_SKILLS, 6);
  const names = (prefix: string, count: number): string[] => Array.from({ length: count }, (_, at) => `${prefix}${at + 1}Script`);

  const skills = {
    role: 'Engineer',
    groups: [
      { label: 'Languages', items: names('Type', 12) },
      { label: 'Tools', items: names('Tool', 3) },
      { label: 'Frameworks', items: names('Frame', 9) }
    ]
  };
  assert.equal(
    renderCompact('overview/skills', skills),
    [
      'Skills:',
      'Role: Engineer',
      `Languages: ${names('Type', 6).join(', ')}`,
      `Tools: ${names('Tool', 3).join(', ')}`,
      `Frameworks: ${names('Frame', 6).join(', ')}`,
      '(shortened: 9 more skills not shown)'
    ].join('\n'),
    'counted over the groups, and a group of three is as it was'
  );
  assert.equal(
    renderCompact('overview/skills', { groups: [{ items: names('Type', 14) }] }),
    `Skills:\nSkills: ${names('Type', 6).join(', ')}\n(shortened: 8 more skills not shown)`,
    'a group with no label is named as the whole form names it, and no role is no line'
  );
  assert.equal(renderCompact('overview/skills', { role: 'Engineer', groups: [{ label: 'Languages', items: names('Type', 6) }] }), undefined, 'six are six');
  assert.equal(
    renderCompact('overview/skills', { groups: [{ label: 'Languages', items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }] }),
    undefined,
    'one more that is shorter than the words that say so is not a form'
  );
});

test('a piece with no shorter form has none: the rest of the CV, a piece that is not a piece, and a form that would not be shorter', () => {
  assert.equal(renderCompact('overview/personal', { name: 'Ada', email: 'ada@example.com', phone: '', location: 'Krakow', links: {} }), undefined);
  assert.equal(renderCompact('certificates', { name: 'AWS Solutions Architect', issuer: 'Amazon', started: '2020', finished: '' }), undefined);
  assert.equal(renderCompact('languages', { name: 'Polish', level: 'native' }), undefined);
  assert.equal(renderCompact('summary', 'x'.repeat(2_000)), undefined, 'a section nobody wrote a form for');
  assert.equal(renderCompact('', JOB), undefined);

  assert.equal(renderCompact('experience', null), undefined);
  assert.equal(renderCompact('experience', 'a string'), undefined);
  assert.equal(renderCompact('education', undefined), undefined);
  assert.equal(renderCompact('overview/role_description', { not: 'a string' }), undefined);
  assert.equal(renderCompact('overview/skills', {}), undefined);

  // Highlights as short as the words that say they are left out: the form is longer, so it is not one.
  const brief = { ...JOB, highlights: ['a', 'b', 'c'], skills: [] };
  assert.ok(`${render('experience', brief)}`.length < ('Experience, Senior Engineer at Acme:\n2021 - present\n- a\n- b\n(shortened: 1 more highlight not shown)').length);
  assert.equal(renderCompact('experience', brief), undefined);
  assert.equal(renderCompact('experience', { ...JOB, highlights: [said('One'), said('Two')], skills: [] }), undefined, 'two highlights and no skills: nothing to leave out');
  assert.equal(renderCompact('experience', { ...JOB, highlights: [said('One'), said('Two')] }), undefined, 'two skills that are shorter than the words that say so are not worth leaving out');
  assert.equal(renderCompact('overview/role_description', 'x'.repeat(301)), undefined, 'a description a few characters past the limit: the form with its words would be longer');
});

test('a form is shorter than the piece it stands for, whatever the piece', () => {
  const pieces: [string, unknown][] = [
    ['experience', JOB],
    ['experience', { ...JOB, highlights: [said('One'), said('Two'), said('Three')], skills: [] }],
    ['experience', { ...JOB, highlights: Array.from({ length: 30 }, (_, at) => said(`No. ${at}`)) }],
    ['education', EDUCATION],
    ['overview/role_description', 'x'.repeat(2_000)],
    ['overview/role_description', 'engineering '.repeat(500)],
    ['overview/skills', { role: 'Engineer', groups: [{ label: 'Languages', items: Array.from({ length: 20 }, (_, at) => `Language${at}`) }] }]
  ];
  for (const [section, piece] of pieces) {
    const form = renderCompact(section, piece);
    assert.ok(form !== undefined, `${section} has a form`);
    assert.ok(form.length < render(section, piece).length, `${section}: ${form.length} is not under ${render(section, piece).length}`);
  }
});

test('a form is a pure function of its piece: the same piece gives the same bytes, and a piece that is shown differently gives different ones', () => {
  const again = JSON.parse(JSON.stringify(JOB)) as typeof JOB;
  assert.equal(renderCompact('experience', again), renderCompact('experience', JOB));
  assert.equal(renderCompact('experience', JOB), renderCompact('experience', JOB), 'and again');

  const shown = renderCompact('experience', JOB);
  // Everything the form shows, one at a time.
  const changes: Record<string, typeof JOB> = {
    company: { ...JOB, company: 'Globex' },
    title: { ...JOB, title: 'Engineer' },
    started: { ...JOB, started: '2020' },
    finished: { ...JOB, finished: '2023' },
    'the first highlight': { ...JOB, highlights: [said('Uno'), ...JOB.highlights.slice(1)] },
    'the second highlight': { ...JOB, highlights: [JOB.highlights[0] as string, said('Dos'), ...JOB.highlights.slice(2)] },
    'how many highlights it leaves out': { ...JOB, highlights: [...JOB.highlights, said('Five')] },
    'how many skills it leaves out': { ...JOB, skills: ['Go', 'SQL', 'Rust'] }
  };
  for (const [what, changed] of Object.entries(changes)) {
    assert.notEqual(renderCompact('experience', changed), shown, `${what} is in it`);
  }

  // Everything it leaves out does not move it: its text is not in the form, and its digest is in the entry.
  const hidden: Record<string, typeof JOB> = {
    'the third highlight': { ...JOB, highlights: [...JOB.highlights.slice(0, 2), said('Tres'), JOB.highlights[3] as string] },
    'the last highlight': { ...JOB, highlights: [...JOB.highlights.slice(0, 3), said('Quattro')] },
    'a skill': { ...JOB, skills: ['Go', 'Postgres'] }
  };
  for (const [what, changed] of Object.entries(hidden)) {
    assert.equal(renderCompact('experience', changed), shown, `${what} is not in it`);
    assert.notEqual(digest(changed), digest(JOB), `and it is a different piece`);
  }

  assert.notEqual(renderCompact('education', { ...EDUCATION, mark: '4.0' }), renderCompact('education', EDUCATION), 'the mark is in it');
  assert.equal(renderCompact('education', { ...EDUCATION, thesis: 'Another thesis, as long as the first one was, or longer than it was.' }), renderCompact('education', EDUCATION));
});

/* ------------------------------------------------------------------ the chat */

const OFFSET = (company: string): string => `experience/${company.toLowerCase()}~senior-engineer`;
const at = (company: string): string => ref(OFFSET(company));

/** A job of this many highlights of this many characters, whose company and title are the same length as its neighbours'. */
const job = (company: string, highlights: number, size: number, skills: string[] = []) => ({
  company,
  title: 'Senior Engineer',
  started: '2021',
  finished: null,
  highlights: Array.from({ length: highlights }, (_, index) => `${company} highlight ${index + 1} `.padEnd(size, '.')),
  skills
});

/** Three jobs: one that saves a lot, one that saves less, one that cannot be shortened. */
const THREE = [job('Alpha', 4, 300), job('Bravo', 3, 300), job('Chuck', 2, 300)];
const SIZE = (jobs: ReturnType<typeof job>[]): number => jobs.reduce((sum, each) => sum + render('experience', each).length, 0) + 2 * (jobs.length - 1);
const SAVED = (each: ReturnType<typeof job>): number => render('experience', each).length - (renderCompact('experience', each) as string).length;

const sent = (c: Chat): string => {
  const loop = c.requests.filter((each) => each.kind === 'loop').at(-1);
  return loop === undefined ? '' : `${loop.system}\n${loop.prompt}`;
};
const loops = (c: Chat): number => c.requests.filter((each) => each.kind === 'loop').length;

const message = (grounding: Record<string, unknown>, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  question: QUESTION,
  grounding,
  ...over
});

const preview = (c: Chat, grounding: Record<string, unknown>, mode: 'fast' | 'full' = 'full'): Promise<Preview> =>
  previewRun(c.deps, { capability: 'ask_profile', input: message(grounding), ...CHAT_RUN, mode });

const world = (jobs = THREE, limit?: number): Chat => {
  const c = chat({ body: cv(jobs as never) });
  if (limit !== undefined) c.limitStore.set(undefined, limit);
  return c;
};

const entryOf = (entries: readonly RecordEntry[], company: string): RecordEntry => {
  const found = entries.find((each) => each.ref === at(company));
  assert.ok(found, `no entry for ${company}`);
  return found;
};

test('the fixture is as big as the tests below say', () => {
  assert.ok(SIZE(THREE) > 2_700 && SIZE(THREE) < 3_000, String(SIZE(THREE)));
  assert.ok(SAVED(THREE[0]!) > SAVED(THREE[1]!), 'the first saves more than the second');
  assert.ok(SAVED(THREE[0]!) + SAVED(THREE[1]!) < SIZE(THREE) - 2_000, 'and both of them do not save enough to reach the floor');
  assert.equal(renderCompact('experience', THREE[2]), undefined);
});

/* ----------------------------------------------------------------- asked for */

test('a message over its limit is refused, as it always was, unless it asks to be shortened, and refusing is what asking for it says too', async () => {
  const c = world(THREE, SIZE(THREE) - 1 < 2_000 ? 2_000 : SIZE(THREE) - 1);
  try {
    const grounding = { once: [at('Alpha'), at('Bravo'), at('Chuck')] };

    const plain = await refusal(c.begin(message(grounding)));
    assert.equal(plain.code, 'context_limit');
    assert.doesNotMatch(plain.message, /shortening/i, 'it did not try');

    const said = await refusal(c.begin(message({ ...grounding, overflow: 'refuse' })));
    assert.deepEqual(said, plain, 'to refuse is what it does');
    assert.equal(loops(c), 0, 'and no model was asked');
  } finally {
    c.dispose();
  }
});

test('a message that is not over its limit is the message it was, byte for byte, whether it asks to be shortened or not', async () => {
  const worlds = [world(THREE, SIZE(THREE)), world(THREE, SIZE(THREE)), world(THREE, SIZE(THREE))];
  try {
    const grounding = { once: [at('Alpha'), at('Bravo'), at('Chuck')] };
    const asks = [grounding, { ...grounding, overflow: 'compact' }, { ...grounding, overflow: 'compact', full: [at('Alpha')] }];

    const runs = worlds.map((c, index) => c.begin(message(asks[index] as Record<string, unknown>)));
    const results = await Promise.all(runs.map((run) => settle(run)));

    const [bare, ...others] = worlds as [Chat, ...Chat[]];
    for (const other of others) assert.deepEqual(other.requests, bare.requests, 'what the model was asked');
    for (const result of results) assert.equal((result.data.grounding as { compacted?: unknown } | undefined)?.compacted, undefined, 'and nothing says it was shortened');

    const entries = (index: number): RecordEntry[] => [...worlds[index]!.entries(runs[index]!)];
    assert.deepEqual(entries(1), entries(0));
    assert.deepEqual(entries(2), entries(0));
    assert.ok(entries(0).some((each) => each.ref === at('Alpha')));
    assert.ok(entries(0).every((each) => each.shown === undefined), 'no entry says anything was left out of it');
  } finally {
    for (const c of worlds) c.dispose();
  }
});

/* ------------------------------------------------------------ which, and how */

const ALL = { once: [at('Alpha'), at('Bravo'), at('Chuck')] };

/** What the first pass shortens and no more: the limit is what the pieces come to, less what shortening the first saves. */
const AFTER_ALPHA = (): number => SIZE(THREE) - SAVED(THREE[0]!);
const AFTER_BOTH = (): number => SIZE(THREE) - SAVED(THREE[0]!) - SAVED(THREE[1]!);

test('a message that is over its limit and asks to be shortened has the piece that saves most shortened, and no other when that is enough', async () => {
  const c = world(THREE, AFTER_ALPHA());
  try {
    const run = c.begin(message({ ...ALL, overflow: 'compact' }));
    const { data } = await settle(run);

    assert.deepEqual((data.grounding as { compacted?: string[] }).compacted, [at('Alpha')]);
    const model = sent(c);
    assert.ok(model.includes(renderCompact('experience', THREE[0]) as string), 'Alpha as its form');
    assert.ok(!model.includes(THREE[0]!.highlights[2]!), 'and not the highlights it leaves out');
    assert.ok(!model.includes(THREE[0]!.highlights[3]!));
    assert.ok(model.includes(render('experience', THREE[1])), 'Bravo as it is');
    assert.ok(model.includes(render('experience', THREE[2])), 'and Chuck');
    assert.ok(model.includes('(shortened: 2 more highlights not shown)'), 'and the page says what it left out');
  } finally {
    c.dispose();
  }
});

test('a message one character under what shortening the first saves has the second shortened as well, and no third that has no form', async () => {
  const c = world(THREE, AFTER_ALPHA() - 1);
  try {
    const run = c.begin(message({ ...ALL, overflow: 'compact' }));
    const { data } = await settle(run);

    assert.deepEqual((data.grounding as { compacted?: string[] }).compacted, [at('Alpha'), at('Bravo')], 'largest saving first, in the order it was done');
    const model = sent(c);
    assert.ok(model.includes(renderCompact('experience', THREE[1]) as string));
    assert.ok(model.includes(render('experience', THREE[2])), 'what has no form is as it was');
    assert.equal(c.entries(run).filter((each) => each.shown !== undefined).length, 2);
  } finally {
    c.dispose();
  }
});

test('a message at its limit with the first shortened is not shortened a piece more, and the limit is what it was held to', async () => {
  const c = world(THREE, AFTER_BOTH());
  try {
    const run = c.begin(message({ ...ALL, overflow: 'compact' }));
    const { data } = await settle(run);
    assert.deepEqual((data.grounding as { compacted?: string[] }).compacted, [at('Alpha'), at('Bravo')]);
    assert.equal(loops(c), 1, 'and it was sent');
  } finally {
    c.dispose();
  }
});

test('two pieces that save the same are shortened in the order they are sent, and only as many as it takes', async () => {
  const jobs = [job('Delta', 4, 300), job('Echoo', 4, 300), job('Chuck', 2, 300)];
  assert.equal(SAVED(jobs[0]!), SAVED(jobs[1]!), 'they save the same');

  for (const order of [['Delta', 'Echoo'], ['Echoo', 'Delta']] as const) {
    const c = world(jobs, SIZE(jobs) - SAVED(jobs[0]!));
    try {
      const { data } = await settle(c.begin(message({ once: [...order.map(at), at('Chuck')], overflow: 'compact' })));
      const first = order[0];
      const second = order[1];

      assert.deepEqual((data.grounding as { compacted?: string[] }).compacted, [at(first)], `${first}, because it comes first`);
      const model = sent(c);
      assert.ok(model.indexOf(`${first} highlight 1`) < model.indexOf(`${second} highlight 1`), 'in the order they are sent');
      assert.ok(model.includes(`${second} highlight 4`), `${second} is whole`);
      assert.ok(!model.includes(`${first} highlight 4`), `${first} is not`);
    } finally {
      c.dispose();
    }
  }
});

test('a piece named in full is not shortened, whether it is named or its section is, and another is shortened in its place', async () => {
  const jobs = THREE;
  for (const [full, shortened] of [
    [[at('Alpha')], [at('Bravo')]],
    [[ref('experience')], []],
    [[ref('education'), at('Alpha')], [at('Bravo')]],
    [[ref('experience/nobody~senior-engineer')], [at('Alpha')]]
  ] as const) {
    // What it takes to fit with Alpha whole, when it is in `full`.
    const c = world(jobs, shortened.length === 0 ? 2_000 : shortened[0] === at('Alpha') ? AFTER_ALPHA() : SIZE(jobs) - SAVED(jobs[1]!));
    try {
      const run = c.begin(message({ ...ALL, overflow: 'compact', full }));
      if (shortened.length === 0) {
        const { code, message: text } = await refusal(run);
        assert.equal(code, 'context_limit', 'nothing may be shortened, so nothing is');
        assert.doesNotMatch(text, /shortening/i, 'and it is not said that it was tried');
        continue;
      }
      const { data } = await settle(run);
      assert.deepEqual((data.grounding as { compacted?: string[] }).compacted, shortened, JSON.stringify(full));
    } finally {
      c.dispose();
    }
  }
});

test('a section that is sent is shortened by its entries, and pins are shortened like what is chosen once', async () => {
  const c = world(THREE, AFTER_ALPHA());
  try {
    c.pin(ref('experience'));
    const run = c.begin(message({ overflow: 'compact' }));
    const { data } = await settle(run);
    assert.deepEqual((data.grounding as { compacted?: string[] }).compacted, [at('Alpha')], 'a pinned section: its largest entry');
    assert.equal(c.entries(run).filter((each) => each.shown !== undefined).length, 1);
  } finally {
    c.dispose();
  }
});

test('a message that cannot be made to fit by shortening is refused as it would have been, and says that it was tried', async () => {
  // The floor: 2,000. Both that can be shortened are, and the rest is still over.
  const c = world(THREE, 2_000);
  try {
    assert.ok(SIZE(THREE) - SAVED(THREE[0]!) - SAVED(THREE[1]!) > 2_000);
    const plain = await refusal(c.begin(message(ALL)));
    const tried = await refusal(c.begin(message({ ...ALL, overflow: 'compact' })));

    assert.equal(tried.code, 'context_limit', 'the same code');
    assert.equal(plain.code, 'context_limit');
    assert.match(tried.message, / Shortening 2 of them was not enough\.$/);
    assert.equal(loops(c), 0, 'no model was asked');
  } finally {
    c.dispose();
  }
});

test('the pieces own budget is refused the same way, with what shortening could not do said as well', async () => {
  // Four pieces of about 4,500 characters, 18,000 in all against 12,000: three shortened fit.
  const jobs = ['Alpha', 'Bravo', 'Chuck', 'Delta'].map((name) => job(name, 4, 1_100));
  const c = world(jobs);
  try {
    const refs = jobs.map((each) => at(each.company));
    const plain = await refusal(c.begin(message({ once: refs })));
    assert.equal(plain.code, 'grounding_budget');
    assert.doesNotMatch(plain.message, /shortening/i);

    const fitted = await settle(c.begin(message({ once: refs, overflow: 'compact' })));
    const compacted = (fitted.data.grounding as { compacted?: string[] }).compacted ?? [];
    assert.ok(compacted.length > 0 && compacted.length < refs.length, `${compacted.length} of ${refs.length}`);

    // Twelve is as many as a message may name, and shortened they are still too many.
    const many = Array.from({ length: 12 }, (_, index) => job(`Firm${String(index).padStart(2, '0')}`, 4, 1_100));
    const big = world(many);
    try {
      const all = many.map((each) => at(each.company));
      const tried = await refusal(big.begin(message({ once: all, overflow: 'compact' })));
      assert.equal(tried.code, 'grounding_budget');
      assert.match(tried.message, /Shortening \d+ of them was not enough\./);
      assert.match(tried.message, new RegExp(`at most ${PICKS_BUDGET} are sent`));
    } finally {
      big.dispose();
    }
  } finally {
    c.dispose();
  }
});

/* ---------------------------------------------------------------- the record */

const edit = (c: Chat, change: (body: { experience: ReturnType<typeof job>[] }) => unknown): void => {
  c.s.deps.documents.update(CONTEXT, CV_KIND, (body) => change(body as never) as never);
};

test('the record names the original of a piece that was shortened and what was shown of it, and a piece that was not has no such word', async () => {
  const whole = world(THREE);
  const short = world(THREE, AFTER_ALPHA());
  try {
    const was = whole.begin(message(ALL));
    const is = short.begin(message({ ...ALL, overflow: 'compact' }));
    await Promise.all([settle(was), settle(is)]);

    const [before, after] = [whole.entries(was), short.entries(is)];
    const form = renderCompact('experience', THREE[0]) as string;

    assert.equal(entryOf(before, 'Alpha').shown, undefined);
    const alpha = entryOf(after, 'Alpha');
    assert.equal(alpha.status, 'included', 'it was sent, and what it was made from is a piece that was sent');
    assert.equal(alpha.origin, 'server');
    assert.equal(alpha.digest, entryOf(before, 'Alpha').digest, 'the digest is the original, whole');
    assert.equal(alpha.shown, digest(form), 'and what the model read of it is the form');
    assert.equal(alpha.version, entryOf(before, 'Alpha').version);
    assert.equal(alpha.via, entryOf(before, 'Alpha').via);

    for (const company of ['Bravo', 'Chuck']) {
      assert.deepEqual(entryOf(after, company), entryOf(before, company), `${company} is as it was`);
      assert.equal(entryOf(after, company).shown, undefined);
    }
    assert.equal(after.length, before.length, 'no entry is added or taken away');
  } finally {
    whole.dispose();
    short.dispose();
  }
});

test('a form is made from the piece as it is now: no form is kept, and an edit shows in the next one', async () => {
  const c = world(THREE, AFTER_ALPHA());
  try {
    await settle(c.begin(message({ ...ALL, overflow: 'compact' })));
    assert.ok(sent(c).includes('Alpha highlight 1 '));

    edit(c, (body) => ({
      ...body,
      experience: body.experience.map((each) =>
        each.company === 'Alpha' ? { ...each, highlights: ['Alpha was rewritten. '.padEnd(300, '.'), ...each.highlights.slice(1)] } : each
      )
    }));
    const run = c.begin(message({ ...ALL, overflow: 'compact' }));
    await settle(run);

    assert.ok(sent(c).includes('Alpha was rewritten.'), 'the form says what it says now');
    assert.ok(!sent(c).includes('Alpha highlight 1 '), 'and not what it said');
    assert.equal(entryOf(c.entries(run), 'Alpha').shown, digest(renderCompact('experience', { ...THREE[0], highlights: ['Alpha was rewritten. '.padEnd(300, '.'), ...THREE[0]!.highlights.slice(1)] })));
  } finally {
    c.dispose();
  }
});

test('a piece that is excluded is not sent and is not counted, and so is not what is shortened to make room', async () => {
  const jobs = [job('Alpha', 4, 300), job('Bravo', 3, 300), job('Chuck', 2, 1_200)];
  const bravo = render('experience', jobs[1]).length + 2;
  const c = world(jobs, SIZE(jobs) - bravo - SAVED(jobs[0]!));
  try {
    c.exclude(at('Bravo'));
    const run = c.begin(message({ ...ALL, overflow: 'compact' }));
    const { data } = await settle(run);

    assert.deepEqual((data.grounding as { compacted?: string[] }).compacted, [at('Alpha')]);
    assert.deepEqual((data.grounding as { blocked?: string[] }).blocked, [at('Bravo')]);
    assert.ok(!sent(c).includes('Bravo highlight'), 'nothing of it was sent');
    assert.equal(entryOf(c.entries(run), 'Bravo').status, 'blocked');
    assert.equal(entryOf(c.entries(run), 'Bravo').shown, undefined);
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------- the preview, the plan */

test('a preview says which pieces would be sent shortened and how big the message is then, and refuses what shortening cannot fix', async () => {
  const c = world(THREE, AFTER_ALPHA());
  try {
    const refused = await preview(c, ALL, 'fast');
    assert.equal(refused.refusal?.code, 'context_limit');

    const fast = await preview(c, { ...ALL, overflow: 'compact' }, 'fast');
    assert.equal(fast.refusal, undefined, 'it would be sent');
    assert.equal(fast.size.total, AFTER_ALPHA(), 'at the size it would be then');

    const full = await preview(c, { ...ALL, overflow: 'compact' }, 'full');
    assert.deepEqual(full.grounding?.compacted, [at('Alpha')]);
    assert.deepEqual(full.grounding?.included, [at('Alpha'), at('Bravo'), at('Chuck')]);
    assert.equal(entryOf(full.entries ?? [], 'Alpha').shown, digest(renderCompact('experience', THREE[0]) as string));
    assert.equal(full.planDigest, planDigestOf(full.entries ?? []));

    const bare = await preview(c, ALL, 'full');
    assert.equal(bare.planDigest, undefined, 'a message that is refused has no plan');
    assert.equal(bare.grounding, undefined);

    c.limitStore.set(undefined, 2_000);
    const hopeless = await preview(c, { ...ALL, overflow: 'compact' }, 'full');
    assert.equal(hopeless.refusal?.code, 'context_limit');
    assert.match(hopeless.refusal?.message ?? '', / Shortening 2 of them was not enough\.$/);
    assert.equal(hopeless.planDigest, undefined);
    assert.equal(loops(c), 0, 'no model was asked');
  } finally {
    c.dispose();
  }
});

test('the plan of a message that is sent shortened moves with the original and with the form, and with nothing else', async () => {
  const c = world(THREE, AFTER_ALPHA());
  try {
    const ask = { ...ALL, overflow: 'compact' };
    const first = (await preview(c, ask)).planDigest;
    assert.ok(first);
    assert.equal((await preview(c, ask)).planDigest, first, 'the same message, the same plan');
    assert.equal((await preview(c, { overflow: 'compact', once: [...ALL.once].reverse() })).planDigest, first, 'in whatever order it is named');

    // A part the form does not show is a piece that has changed: the plan was made of its digest.
    edit(c, (body) => ({
      ...body,
      experience: body.experience.map((each) =>
        each.company === 'Alpha' ? { ...each, highlights: [...each.highlights.slice(0, 3), 'Alpha, at the end. '.padEnd(300, '.')] } : each
      )
    }));
    const hidden = (await preview(c, ask)).planDigest;
    assert.ok(hidden);
    assert.notEqual(hidden, first, 'the original is another piece');
    const entries = (await preview(c, ask)).entries ?? [];
    assert.equal(entryOf(entries, 'Alpha').shown, digest(renderCompact('experience', THREE[0])), 'though what was shown of it is the same');

    edit(c, (body) => ({
      ...body,
      experience: body.experience.map((each) => (each.company === 'Alpha' ? { ...each, highlights: ['Alpha, at the start. '.padEnd(300, '.'), ...each.highlights.slice(1)] } : each))
    }));
    const shown = (await preview(c, ask)).planDigest;
    assert.ok(shown && shown !== first && shown !== hidden, 'and so is a part it shows');
  } finally {
    c.dispose();
  }
});

test('a shortened piece is checked against the original when a run is resumed: a part that was left out and has changed is a piece that has changed', async () => {
  const c = world(THREE, AFTER_ALPHA());
  try {
    const run = c.begin(message({ ...ALL, overflow: 'compact' }));
    await settle(run);
    const entries = c.entries(run);
    const walls = { pieces: () => [] };
    // As a run reads it: the documents of the CV the conversation belongs to.
    const stale = (): string[] => staleCv({ documents: (c.deps.scopeCv?.(CONTEXT) as unknown as { documents: never }).documents, walls } as never, entries);

    assert.deepEqual(stale(), [], 'as it was');

    edit(c, (body) => ({
      ...body,
      experience: body.experience.map((each) =>
        each.company === 'Alpha' ? { ...each, highlights: [...each.highlights.slice(0, 3), 'Alpha, at the end. '.padEnd(300, '.')] } : each
      )
    }));
    assert.deepEqual(stale(), [at('Alpha')], 'the one change that the form would not have shown');
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------ the edges */

const description = (body: string): string => (renderCompact('overview/role_description', body) as string).split('\n')[1] as string;

test('a role description is cut where a sentence ends only when one ends in the second half of what is kept, and otherwise at a word, whole, and not through one', () => {
  // A sentence that ends early (after 84 of the 300) is not a reason to keep so little.
  const early = `${'Early words '.repeat(7).trim()}. ${'engineering '.repeat(40).trim()}`;
  assert.equal(early.indexOf('.'), 83);
  assert.ok(description(early).length > 280, `${description(early).length}`);

  // The limit falls inside a word: the word is left out, and what is kept ends where a word does.
  const inside = Array.from({ length: 60 }, () => 'engineer').join(' ');
  assert.notEqual(inside[300], ' ', 'the limit falls in a word');
  assert.notEqual(inside[299], ' ');
  const cut = description(inside);
  assert.ok(inside.startsWith(cut) && cut.length > 280 && cut.length <= 300, `${cut.length}`);
  assert.equal(inside[cut.length], ' ', 'and what is left out begins with a space');

  // The limit falls on a space: the word before it is whole, and it stays.
  const flush = Array.from({ length: 60 }, () => 'engine').join(' ');
  assert.equal(flush[300], ' ');
  assert.equal(description(flush), flush.slice(0, 300));

  // A sentence that ends in the second half is where it is cut, even when more words would have fitted.
  const late = `${'Late words '.repeat(20).trim()}. ${'engineering '.repeat(40).trim()}`;
  assert.equal(late.indexOf('.'), 219);
  assert.equal(description(late), late.slice(0, 220));
});

test('a description is whole at 300 characters and is not at 301, whatever its last word is, and a form is made only when it is the shorter', () => {
  // Words of one letter and then one long word, so that cutting at a word leaves little.
  const long = (size: number): string => `${'a '.repeat(10)}${'x'.repeat(size - 20)}`;
  assert.equal(long(300).length, 300);
  assert.equal(renderCompact('overview/role_description', long(300)), undefined, 'at the limit it is whole, though it could be cut');
  assert.ok(renderCompact('overview/role_description', long(301)) !== undefined, 'and one more is not');

  // As long as the whole is not shorter than it: a third highlight as long as the words that say it is left out.
  const third = (size: number) => ({ ...JOB, highlights: [said('One'), said('Two'), 'x'.repeat(size)], skills: [] });
  assert.equal(renderCompact('experience', third(36)), undefined, 'a form that is longer is not one');
  assert.equal(renderCompact('experience', third(37)), undefined, 'and one as long is not one either');
  assert.ok(renderCompact('experience', third(38)) !== undefined, 'one character shorter than the whole is');
  assert.equal(render('experience', third(37)).length, (renderCompact('experience', third(38)) as string).length, 'which is as long as the whole that was one short');
});

/* ------------------------------------------------------ the overview, and the limits */

test('a role description and the skills are shortened like an entry when they are what is over, the one that saves more first', async () => {
  const words = Array.from({ length: 420 }, (_, index) => `word${index}`).join(' ');
  const skills = {
    role: 'Engineer',
    groups: [{ label: 'Languages', items: Array.from({ length: 200 }, (_, index) => `Language${index}`) }]
  };
  const body = { ...cv([job('Alpha', 1, 100)] as never), role_description: `${words}.`, skills: { ...cv().skills, ...skills } };
  const c = chat({ body });
  try {
    const role = ref('overview/role_description');
    const all = ref('overview/skills');
    const whole = render('overview/role_description', body.role_description).length + render('overview/skills', body.skills).length + 2;
    const small = renderCompact('overview/role_description', body.role_description) as string;
    const few = renderCompact('overview/skills', body.skills) as string;
    const saves = (section: string, piece: unknown, form: string): number => render(section, piece).length - form.length;
    assert.ok(saves('overview/role_description', body.role_description, small) > saves('overview/skills', body.skills, few), 'the description is the larger saving');
    assert.ok(whole - saves('overview/role_description', body.role_description, small) > 2_000, 'and shortening it alone is not enough');
    assert.ok(small.length < 400 && few.length < 400);

    c.limitStore.set(undefined, 2_000);
    const refs = [role, all];
    const run = c.begin(message({ once: refs, overflow: 'compact' }));
    const { data } = await settle(run);
    assert.deepEqual((data.grounding as { compacted?: string[] }).compacted, [role, all], 'the piece that saves most is first, and both are needed here');
    assert.ok(sent(c).includes(small) && sent(c).includes(few));
    assert.equal(c.entries(run).filter((each) => each.shown !== undefined).length, 2);
  } finally {
    c.dispose();
  }
});

/* -------------------------------------------------------------- the assembly itself */

test('the assembly is held to what shortening could not do too, says so in the same words, and says nothing of it when nothing was shortened', async () => {
  const many = Array.from({ length: 12 }, (_, index) => job(`Firm${String(index).padStart(2, '0')}`, 4, 1_100));
  const c = world(many);
  try {
    const ports = bindCvScope(CONTEXT, { documents: c.s.deps.documents, retrieval: { search: async () => [] }, index: c.s.deps.index });
    const context = { ...ports, signal: new AbortController().signal, contextId: CONTEXT };
    const all = many.map((each) => at(each.company));

    // Called itself, as a run does once its plan is made: the size was measured before, and a document may have changed since.
    await assert.rejects(
      assembleCv({ pins: [], once: all, overflow: 'compact', auto: 'off', question: QUESTION }, context),
      (error: { code?: string; message?: string }) => error.code === 'grounding_budget' && / Shortening \d+ of them was not enough\. Unpin/.test(error.message ?? '')
    );
    await assert.rejects(
      assembleCv({ pins: [], once: all, auto: 'off', question: QUESTION }, context),
      (error: { code?: string; message?: string }) => error.code === 'grounding_budget' && !/Shortening/.test(error.message ?? ''),
      'asked for nothing, nothing was tried'
    );

    const grounded = await assembleCv({ pins: [], once: all.slice(0, 2), overflow: 'compact', auto: 'off', question: QUESTION }, context);
    assert.equal(grounded.entries.length, 2);
    assert.equal('compacted' in grounded, false, 'asked for, and not needed: the word is not there');

    const four = await assembleCv({ pins: [], once: all.slice(0, 4), overflow: 'compact', auto: 'off', question: QUESTION }, context);
    assert.equal('compacted' in four, true, 'and when it was, it is');
    assert.deepEqual(four.compacted, ['Firm00', 'Firm01', 'Firm02'].map(at).slice(0, four.compacted?.length), 'earliest first when they save the same');
  } finally {
    c.dispose();
  }
});

test('what a message names whole is held to before any model is asked, in the measurement and in a preview, as it is in the assembly', async () => {
  const c = world(THREE, 2_000);
  try {
    const whole = { ...ALL, overflow: 'compact', full: [ref('experience')] };

    const refused = await refusal(c.begin(message(whole)));
    assert.equal(refused.code, 'context_limit');
    assert.doesNotMatch(refused.message, /shortening/i);
    assert.equal(c.requests.length, 0, 'not even the plan was asked for');

    const seen = await preview(c, whole, 'fast');
    assert.equal(seen.refusal?.code, 'context_limit');
    assert.doesNotMatch(seen.refusal?.message ?? '', /shortening/i, 'and it is not said that it was tried');
    assert.equal(c.requests.length, 0);

    // The same message, naming nothing whole, is one that shortening is tried for.
    const tried = await preview(c, { ...ALL, overflow: 'compact' }, 'fast');
    assert.match(tried.refusal?.message ?? '', /Shortening 2 of them was not enough\.$/);
  } finally {
    c.dispose();
  }
});

test('a preview of a message that is not shortened does not say that it is, and one that would be does', async () => {
  const c = world(THREE, SIZE(THREE));
  try {
    const fits = await preview(c, { ...ALL, overflow: 'compact' }, 'full');
    assert.equal(fits.refusal, undefined);
    assert.ok(fits.grounding !== undefined);
    assert.equal('compacted' in fits.grounding, false, 'nothing was left out of any of it');
    assert.equal(c.requests.length, 0);
  } finally {
    c.dispose();
  }
});

/* -------------------------------------------------------------------- the input */

test('what a message may say of shortening: a mode that exists, and at most twelve pieces, named and not versions of them, and held once each', () => {
  const parse = (grounding: unknown) => groundingSchema.safeParse(grounding);
  const firm = (index: number): string => ref(`experience/firm${String(index).padStart(2, '0')}~engineer`);
  const twelve = Array.from({ length: 12 }, (_, index) => firm(index));

  assert.equal(parse({ overflow: 'compact' }).success, true);
  assert.equal(parse({ overflow: 'refuse' }).success, true);
  assert.equal(parse({ overflow: 'shrink' }).success, false, 'a mode there is not');
  assert.equal(parse({ overflow: '' }).success, false);
  assert.deepEqual(Object.keys(parse({}).data ?? {}).sort(), ['auto', 'once', 'reach'], 'a message that says nothing of it is stored as it was');

  assert.equal(parse({ full: twelve }).success, true, 'twelve');
  assert.equal(parse({ full: [...twelve, firm(12)] }).success, false, 'thirteen');
  assert.equal(parse({ full: Array.from({ length: 11 }, (_, index) => firm(index)) }).success, true, 'eleven');
  assert.equal(parse({ full: ['not a piece'] }).success, false);
  assert.equal(parse({ full: [`${firm(0)}@2`] }).success, false, 'a piece is named and not a version of it');
  assert.equal(parse({ full: [''] }).success, false);

  const kept = parse({ full: [firm(0), firm(1), firm(0)] });
  assert.deepEqual(kept.data?.full, [firm(0), firm(1)], 'once each, in the order they were named');
});
