/**
 * Asking which of the saved offers fit the CV best.
 *
 * A message names some saved offers. The runtime turns them into a shortlist, each
 * offer into a short card, finds the parts of the CV that mention what the offers
 * ask for, and puts those in front of a model that has no tools. Every block the
 * model reads is a record entry, so a claim in the answer can be held against the
 * block it cites. Nothing here asks a model to decide anything, and nothing is random.
 *
 * The questions, in order:
 *
 *   untouched    a message that names no offers is the message it always was, byte
 *                for byte, and a runtime that keeps no offers sends the same
 *   shortlist    which of the offers named are compared, and which are left out and
 *                why; an excluded offer is never read at all
 *   cards        what an offer is shown as: short, the same every time, never half a
 *                skill, and a digest that says whether it changed
 *   the run      what the model is given and told, the entries that say so, and what
 *                the result says of it
 *   preferences  what the person says they want, as they said it, or that they said none
 *   evidence     which parts of the CV are found, how many, how much room they get, and
 *                that a part the pins already send is not sent twice
 *   refused      a message with nothing to compare, or no CV to compare with, is
 *                refused before any model is asked
 *   a wall       an offer or a part of the CV the conversation left out reaches no payload
 *   the Board    an offer that is on the Board is left out; one that is not, is not
 *   limits       what the offers come to counts against the conversation's limit
 *   the schema   what a message may carry, and that what it does not carry stays absent
 *   citations    the numbers in an answer, the entries they stand for, and the ones that
 *                stand for nothing
 *   a preview    says what a run would send, and its digest is the run's
 *   a wait       a run that waited is not given an offer that changed or was left out
 *   selection    a profile conversation may leave out a whole saved offer, and nothing finer
 *   the wire     the flag that announces it
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 148 were applied. The number is how many
 * tests failed. The counts are of the file as it stood before seven tests were added
 * for the ten mutations that first survived; those ten were run again with them, and
 * the two that are not killed by this file are named below.
 *
 * shortlist:
 *   an excluded offer is read from the shelf                   8
 *   no offer is excluded                                       8
 *   an offer that is not saved is not said                     6
 *   an offer on the Board is compared                          6
 *   an offer on the Board is not said                          6
 *   the oldest offers are compared                             12
 *   a tie goes to the larger id                                1
 *   a tie is left as the message named them                    1
 *   the limit is not applied                                   5
 *   one offer over the limit is compared                       5
 *   the first offer over the limit is not said                 5
 *   the offers on the Board are not counted as left out        1
 *   the offers compared are 26                                 2
 *
 * cards:
 *   a card may run one over its limit                          1
 *   a skill that does not fit is cut in half                   2
 *   a posting goes on a card however little room is left       1
 *   a posting is never on a card                               13
 *   a posting is cut in the middle of a word                   1
 *   a field is not clipped                                     1
 *   a field keeps the line breaks it came with                 1
 *   the digest does not say what skills are listed             1
 *   the digest moves when an offer is seen again               3
 *   the digest does not say which offer it is                  1
 *   what was shown is the digest of the offer and not of the card 2
 *   the digest does not see what the card did not show         1
 *
 * evidence:
 *   the personal details are evidence                          1
 *   a skill is found inside another word                       1
 *   a skill is found at the end of another word                1
 *   a skill is found at the start of another word              1
 *   a skill is matched with its case                           13
 *   a skill of one character is compared                       1
 *   a skill an offer lists twice counts twice                  1
 *   a skill that two offers list counts once                   1
 *   a part is not scored by how many skills it mentions        2
 *   a part that mentions few skills comes first                2
 *   a tie is broken against the order of the CV                3
 *   one more part than MAX_EVIDENCE is kept                    2
 *   the evidence is left best first                            5
 *   a part that does not fit is cut where it stops             1
 *   a part that fits exactly is left out                       1
 *   the room is not used up by what is kept                    5
 *   the cards and preferences take no room                     6
 *   the preferences take no room                               4
 *   the cards take no room                                     5
 *   the size is of what is asked and not of what is sent       5
 *   a blank line is not counted between blocks                 3
 *   a part a pin sent is sent again                            2
 *   a part a pin sent is not counted as found                  1
 *
 * the run: what is recorded:
 *   the preferences are recorded as the server's               1
 *   the preferences are recorded untrimmed                     1
 *   the preferences are recorded under another address         1
 *   a card is recorded without what was shown                  1
 *   a card is recorded as evidence                             8
 *   evidence is recorded as a pin                              6
 *   what an exclusion held back is not recorded                1
 *   what an exclusion held back is not said                    3
 *   an offer that is not saved is not said as gone             1
 *   the preferences are recorded last                          2
 *   a card is recorded under the offer's posting               9
 *   a whole offer is addressed as its card                     3
 *
 * refused: whether a message compares offers, and what it needs:
 *   an empty list is a message that compares offers            6
 *   a message with no offer to compare goes on                 3
 *   a message with no conversation goes on                     2
 *   a message with no offer to compare says it with a singular wrong 2
 *   what is left out is said in another order                  1
 *   an offer on the Board is not said when nothing is compared 1
 *   what is cut is not said when nothing is compared           1
 *   offers left out are not said when others are compared      4
 *   offers left out stop the message                           9
 *   a message that compares offers is not told what it needs   9
 *   a message that compares offers is not measured             6
 *   a message that compares nothing carries offers in its sizes 2
 *   a message that compares offers selects nothing and is refused 1
 *
 * the run: what a model is told:
 *   a message that compares offers has tools                   5
 *   a message that compares offers is told what it always was  5
 *   the prompt of a message that compares offers is the question 15
 *   the offers are not sent in the prompt                      19
 *   the offers are not recorded as sent                        3
 *   the offers are not recorded as sent without pieces         8
 *   the second thing assembled is not recorded                 3
 *   the result says nothing of the offers                      9
 *   the result says the offers left out are compared           2
 *   the result does not say how the preferences came           2
 *   the result lists only the pieces                           3
 *   the result says the offers blocked and not the pieces      2
 *
 * the run: the sections of the prompt:
 *   the preferences say what the host sent when it sent none   1
 *   the CV matching nothing is not said                        7
 *   the cards are labelled as the evidence is                  1
 *   the evidence is not budgeted by its own                    0 (equivalent: evidence is the last section, so the blocks end where it ends and an end to the slice says nothing)
 *   the cards come after the evidence                          7
 *   a model is told to cite when the answer is not asked to    4
 *   a model is not told to cite when it is asked to            2
 *   a model is told to cite when there is nothing to number    1
 *   the blocks are numbered from 2                             3
 *   every section is numbered from 1                           1
 *   the blocks are numbered when no one asked                  8
 *   the pieces are one block however many there are            1
 *   the pieces' numbering is not said to the outcomes          1
 *   the offers' numbering is not said to the outcomes          2
 *
 * citations:
 *   an answer is read for numbers when none were given         3
 *   a list of numbers is not read                              2
 *   a number is read for the entry before it                   4
 *   a number is read for the entry after the last              3
 *   zero is read for the last entry                            2
 *   an entry cited twice is said twice                         2
 *   a number that stands for nothing is said twice             2
 *   a number that stands for nothing is not said               3
 *   a number that stands for nothing is read for an entry      3
 *
 * limits:
 *   the offers do not count against the limit                  3
 *   the offers are not named in a refusal                      2
 *   the offers take no room from the pieces                    1
 *
 * the schema:
 *   a message may name 101 offers                              1
 *   a message that names too many offers does not say how many 1
 *   an offer named twice is compared twice                     2
 *   an empty id is accepted                                    1
 *   an id of 201 characters is accepted                        1
 *   preferences of 2001 characters are accepted                1
 *   preferences are not limited                                1
 *   a message that does not cite says so                       1
 *   a message that names no offers says so                     1
 *   cite is accepted as anything                               1
 *   the budget for offers is 31,000                            1
 *   a card is 501 characters                                   1
 *   nine parts of the CV are kept                              2
 *
 * a wait:
 *   a run that waited is not asked if the offers changed       2
 *   an offer that changed is not stale                         2
 *   an offer that changed is stale whatever it says            1
 *   an offer left out while the run waited is not stale        2
 *   an offer that is gone is not stale                         2
 *   an offer that went onto the Board is stale                 1
 *   an entry that was held back is held to what it was         1
 *   an entry of the CV is held to what an offer was            4
 *   the refusal to resume says it of the CV                    1
 *
 * a preview:
 *   a preview does not say which offers it compared            3
 *   a preview says the offers left out are compared            1
 *   a preview keeps the last thing grounded and not all        1
 *   a preview keeps the first thing grounded and not all       1
 *   a preview lists the offers' pieces first                   1
 *   a preview does not say what an exclusion held back         1
 *
 * selection, the real runtime, the wire:
 *   a conversation may leave out part of an offer              1
 *   a conversation may not leave out an offer                  2
 *   a conversation may leave out anything                      0 (killed in grounding-selection.test.ts (1), which asserts the same refusal for the other wells)
 *   a run that has no walls may compare offers                 2
 *   a run is given no offers                                   44
 *   the runtime reads no offers                                2
 *   the runtime says no offer is on the Board                  1
 *   the runtime says every offer is on the Board               2
 *   the runtime does not announce that it compares offers      1
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { Response } from '../src/adapters/ipc/channels.js';
import { inputSchema } from '../src/capabilities/askProfile.js';
import { FIT_LABELS, PREFERENCES_REF, citations, leftWords, staleOffers } from '../src/capabilities/cv/fit.js';
import { fitStep } from '../src/capabilities/cv/fit.js';
import { cardDigests, cardText } from '../src/capabilities/offers/card.js';
import { leftOut, shortlist } from '../src/capabilities/offers/shortlist.js';
import { COMPARE_LIMIT, MAX_OFFER_IDS, OFFERS_BUDGET, PREFERENCES_LIMIT, CARD_LIMIT, MAX_EVIDENCE } from '../src/context/ground.js';
import { overLimit, roomForPicks } from '../src/context/limits.js';
import { GROUNDED, isRunSuspension } from '../src/contracts/index.js';
import type { CapabilityMap, Grounded, OfferRecord, OfferShelf, RecordEntry } from '../src/contracts/index.js';
import { digest, parseRef } from '../src/grounding/index.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import { previewRun } from '../src/runtime/preview.js';
import type { Preview, PreviewMode } from '../src/runtime/preview.js';
import { resumeRun } from '../src/runtime/resume.js';
import { isPrepared, planDigestOf } from '../src/grounding/plan.js';
import { createBoardStore } from '../src/storage/sqlite/board.js';
import { createCvContextStore } from '../src/storage/sqlite/cv-contexts.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { CV_KIND } from '../src/capabilities/cv/document.js';
import { storedCv } from '../src/capabilities/cv/walls.js';
import { scratch } from './support/db.js';
import { CHAT, CHAT_RUN, CONTEXT, chat, cv, job, offer, ref, refusal, settle } from './support/chat.js';
import type { Chat, Request } from './support/chat.js';
import { noop, stage, transform } from './support/spine.js';

/* ---------------------------------------------------------------- fixtures */

const QUESTION = 'Which of these fits me best?';

/** A CV with three jobs and a skills section, so that offers can mention some of them and not others. */
const BODY = {
  ...cv([
    { ...job('Acme', 'Senior Engineer', 'Rewrote the billing pipeline in Python and Postgres.'), skills: ['Python'] as never[] },
    job('Globex', 'Engineer', 'Built Kubernetes tooling in Go.'),
    job('Initech', 'Analyst', 'Reported on sales with Excel.')
  ]),
  skills: {
    role: 'Engineer',
    groups: [{ label: 'Languages', items: ['Python', 'Go'] }],
    programming_languages: [],
    frameworks: [],
    libraries_and_tools: []
  }
};

const ACME = ref('experience/acme~senior-engineer');
const GLOBEX = ref('experience/globex~engineer');
const INITECH = ref('experience/initech~analyst');
const SKILLS = ref('overview/skills');

/** What the model reads of each part of the CV the offers below mention, written out. */
const ACME_TEXT =
  'Experience, Senior Engineer at Acme:\n2021 - present\n- Rewrote the billing pipeline in Python and Postgres.\nSkills: Python';
const GLOBEX_TEXT = 'Experience, Engineer at Globex:\n2021 - present\n- Built Kubernetes tooling in Go.';
const INITECH_TEXT = 'Experience, Analyst at Initech:\n2021 - present\n- Reported on sales with Excel.';
const SKILLS_TEXT = 'Skills:\nRole: Engineer\nLanguages: Python, Go';

const PY = offer('py', {
  position: 'Backend Engineer',
  company: 'Initech Labs',
  location: 'Krakow',
  workMode: 'hybrid',
  seniority: 'senior',
  contractType: 'B2B',
  salary: '20000 PLN',
  skills: ['Python', 'Postgres'],
  text: 'We build billing in Python for banks across Poland and need someone who owns it end to end.',
  lastSeenAt: 100
});
const GO = offer('go', {
  position: 'Platform Engineer',
  company: 'Umbrella',
  skills: ['Go', 'Kubernetes'],
  text: 'Run our clusters.',
  lastSeenAt: 90
});
const XL = offer('xl', { position: 'Analyst', company: 'Hooli', skills: ['Excel'], text: 'Spreadsheets all day.', lastSeenAt: 80 });
const RS = offer('rs', { position: 'Rust Developer', company: 'Pied Piper', skills: ['Rust'], text: 'Compress things.', lastSeenAt: 70 });

const PY_CARD = [
  'Offer: Backend Engineer at Initech Labs',
  'Where: Krakow, hybrid',
  'Level: senior, B2B',
  'Salary: 20000 PLN',
  'Skills: Python, Postgres',
  'Posting: We build billing in Python for banks across Poland and need someone who owns it end to end.'
].join('\n');
const GO_CARD = ['Offer: Platform Engineer at Umbrella', 'Skills: Go, Kubernetes', 'Posting: Run our clusters.'].join('\n');
const XL_CARD = ['Offer: Analyst at Hooli', 'Skills: Excel', 'Posting: Spreadsheets all day.'].join('\n');
const RS_CARD = ['Offer: Rust Developer at Pied Piper', 'Skills: Rust', 'Posting: Compress things.'].join('\n');

/** What a model that compares offers is told, as the runtime says it. */
const FIT_SYSTEM = [
  'You help the user decide which of their saved job offers fit their CV best.',
  'You have no tools. The offers, the parts of the CV that mention their skills, and the stated preferences are given below, and they are all you have.',
  'Answer in plain prose. Put the offers in order, best fit first, and say why. Name the employer or role in the CV that each claim came from.',
  'Base every statement on what is given below. If it does not say, say so plainly and stop.'
].join('\n');

const CITE_RULE =
  'Each part below starts with a number in square brackets. After a statement that rests on a part, write its number in square brackets, such as [2]. Write no number that is not given.';

const SECTION = {
  picks: 'SELECTED CV PARTS — SOURCE DATA',
  ...FIT_LABELS
};

/** Offers as discovery would have left them, saved into a chat's runtime. */
const world = (offers: readonly OfferRecord[] = [PY, GO, XL, RS], options: Parameters<typeof chat>[0] = {}): Chat => {
  const c = chat({ body: BODY as never, ...options });
  for (const each of offers) c.saveOffer(each);
  return c;
};

const message = (ids: readonly string[], grounding: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => ({
  question: QUESTION,
  ...input,
  grounding: { offerIds: ids, ...grounding }
});

/** The one model call a message makes when it chooses no tools. */
const loopOf = (c: Chat): Request => {
  const loops = c.requests.filter((request) => request.kind === 'loop');
  assert.equal(loops.length, 1, 'one model call was made');
  return loops[0] as Request;
};

/** Everything a model was sent, as one string, for saying that something was not in it. */
const everything = (c: Chat): string =>
  c.requests.map((request) => [request.system, request.prompt, ...request.history].join('\n')).join('\n');

/** What the model is given of a message, section by section, as `compose` puts them. */
const prompted = (...sections: string[]): string => [QUESTION, ...sections].join('\n\n');

const under = (label: string, ...blocks: string[]): string => `${label}:\n${blocks.join('\n\n')}`;
const NO_PREFERENCES = `${SECTION.preferences}:\n${SECTION.absent}`;
const NO_MATCH = `${SECTION.evidence}:\n${SECTION.unmatched}`;

const data = <T>(response: Response): T => {
  assert.ok(response.ok, `expected ok, got ${JSON.stringify(response)}`);
  return response.data as T;
};

const NONE_LEFT = { excluded: [], missing: [], board: [], cut: [] };

const preview = (c: Chat, mode: PreviewMode, input: Record<string, unknown>): Promise<Preview> =>
  previewRun(c.deps, { capability: 'ask_profile', input, ...CHAT_RUN, mode });

const count = (c: Chat, table: string): number =>
  (c.s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const WRITTEN = ['runs', 'run_steps', 'events', 'grounding_record', 'grounding_entry'] as const;
const written = (c: Chat): number[] => WRITTEN.map((table) => count(c, table));

const included = (entries: readonly RecordEntry[]): RecordEntry[] => entries.filter((entry) => entry.status === 'included');

/** The shelf a unit test hands `shortlist`, saying what it was asked. */
const shelfOf = (offers: readonly OfferRecord[], board: readonly string[] = []) => {
  const reads: string[][] = [];
  const shelf: OfferShelf = {
    read: (ids) => {
      reads.push([...ids]);
      return offers.filter((each) => ids.includes(each.id));
    },
    onBoard: (ids) => new Set(ids.filter((id) => board.includes(id)))
  };
  return { shelf, reads };
};

const WHOLE = (id: string) => parseRef(`offers:${id}`);

/* ---------------------------------------------------------------- untouched */

test('a message that names no offers is the message it always was, byte for byte, and a runtime that keeps no offers sends the same', async () => {
  const kept = world();
  const bare = world([], { offers: false });
  try {
    const inputs = [
      { question: QUESTION },
      { question: QUESTION, grounding: { once: [ACME] } },
      // None named: whatever else comes with the list is about offers that are not there.
      { question: QUESTION, grounding: { offerIds: [] } },
      { question: QUESTION, grounding: { offerIds: [], preferences: 'Remote only.', cite: true } },
      { question: QUESTION, grounding: { cite: true } }
    ];

    for (const each of [kept, bare]) {
      for (const input of inputs) await settle(each.begin(input));
    }

    assert.deepEqual(kept.requests, bare.requests);
    assert.deepEqual(
      kept.requests.map((request) => request.kind),
      ['plan', 'loop', 'plan', 'loop', 'plan', 'loop', 'plan', 'loop', 'plan', 'loop'],
      'the same model calls, each of them with a tool choice first'
    );
    for (const at of [1, 5, 7, 9]) assert.equal(kept.requests[at]?.prompt, QUESTION, `message ${at} sends the question and nothing else`);
    assert.deepEqual(kept.reads, [], 'no offer was read for a message that named none');
  } finally {
    kept.dispose();
    bare.dispose();
  }
});

test('the result of a message that names no offers says nothing of offers or of what was cited', async () => {
  const c = world();
  try {
    for (const grounding of [undefined, { offerIds: [] }, { offerIds: [], cite: true }, { cite: true }]) {
      const result = await settle(c.begin({ question: QUESTION, ...(grounding === undefined ? {} : { grounding }) }));
      assert.deepEqual(Object.keys(result.data).sort(), ['answer', 'model_steps']);
      assert.deepEqual(result.degraded, []);
    }
  } finally {
    c.dispose();
  }
});

test('a message that pins a piece and cites without naming offers numbers the piece, and one with nothing to number numbers nothing', async () => {
  const c = world([], { answer: () => 'It was billing [1], and also [2].' });
  try {
    const nothing = await settle(c.begin({ question: QUESTION, grounding: { cite: true } }));
    assert.equal(c.requests[1]?.prompt, QUESTION, 'cite with nothing to number changes nothing');
    assert.equal(c.requests[1]?.system.includes(CITE_RULE), false);
    assert.equal('cited' in nothing.data, false);
    assert.equal('unresolved' in nothing.data, false);

    c.pin(ACME);
    const pinned = await settle(c.begin({ question: QUESTION, grounding: { cite: true } }));
    assert.equal(c.requests[3]?.prompt, `${QUESTION}\n\n${SECTION.picks}:\n[1] ${ACME_TEXT}`);
    assert.ok(c.requests[3]?.system.endsWith(`\n${CITE_RULE}`));
    assert.deepEqual(pinned.data.cited, [ACME]);
    assert.deepEqual(pinned.data.unresolved, [2]);
  } finally {
    c.dispose();
  }
});

/* ---------------------------------------------------------------- shortlist */

test('an offer the conversation left out is never read, and is said first', () => {
  const { shelf, reads } = shelfOf([PY, GO]);
  const made = shortlist(['x', 'py', 'go'], shelf, [WHOLE('x')]);

  assert.deepEqual(reads, [['py', 'go']], 'only the ids no wall covers were asked of the shelf');
  assert.deepEqual(made.left.excluded, ['x']);
  assert.deepEqual(made.compared.map((each) => each.id), ['py', 'go']);
});

test('an offer that is not saved is said, in the order the message named them', () => {
  const { shelf } = shelfOf([PY]);
  const made = shortlist(['z', 'py', 'y', 'x'], shelf, []);

  assert.deepEqual(made.left.missing, ['z', 'y', 'x']);
  assert.deepEqual(made.compared.map((each) => each.id), ['py']);
});

test('an offer on the Board is left out and does not take a place among those compared', () => {
  const { shelf } = shelfOf([PY, GO, XL, RS], ['py']);
  const made = shortlist(['py', 'go', 'xl', 'rs'], shelf, [], 2);

  assert.deepEqual(made.left.board, ['py']);
  assert.deepEqual(made.compared.map((each) => each.id), ['go', 'xl'], 'the Board offer was the newest, and still not compared');
  assert.deepEqual(made.left.cut, ['rs']);
});

test('the offers compared are the ones seen most recently, and the rest are cut in a fixed order', () => {
  const at = (id: string, lastSeenAt: number) => offer(id, { lastSeenAt });
  const { shelf } = shelfOf([at('a', 3), at('b', 3), at('c', 4), at('d', 5), at('e', 5)]);
  const made = shortlist(['a', 'b', 'c', 'd', 'e'], shelf, [], 3);

  assert.deepEqual(made.compared.map((each) => each.id), ['d', 'e', 'c'], 'newest first, and a tie by the offer\'s id');
  assert.deepEqual(made.left.cut, ['a', 'b']);
  assert.equal(leftOut(made.left), 2);

  const again = shortlist(['e', 'd', 'c', 'b', 'a'], shelf, [], 3);
  assert.deepEqual(again, made, 'what the message named, in whatever order, is the same shortlist');
});

test('the shortlist keeps COMPARE_LIMIT offers by default', () => {
  const many = Array.from({ length: COMPARE_LIMIT + 3 }, (_, at) => offer(`o${String(at).padStart(2, '0')}`, { lastSeenAt: at }));
  const { shelf } = shelfOf(many);
  const made = shortlist(many.map((each) => each.id), shelf, []);

  assert.equal(made.compared.length, COMPARE_LIMIT);
  assert.deepEqual(made.left.cut, ['o02', 'o01', 'o00']);
  assert.equal(COMPARE_LIMIT, 25);
});

test('the reasons an offer is left out are four lists, and an offer is in at most one', () => {
  const { shelf } = shelfOf([PY, GO, XL, RS], ['go']);
  const made = shortlist(['py', 'go', 'xl', 'rs', 'nope', 'gone'], shelf, [WHOLE('gone'), WHOLE('rs')], 1);

  assert.deepEqual(made.left, { excluded: ['rs', 'gone'], missing: ['nope'], board: ['go'], cut: ['xl'] });
  assert.deepEqual(made.compared.map((each) => each.id), ['py']);
  assert.equal(leftOut(made.left), 5);
});

test('offers seen at the same moment are put in the order of their ids, whatever order the message named them in', () => {
  const asked = (ids: readonly string[]) => {
    // A shelf that answers in the order it is asked, as the saved offers do.
    const shelf: OfferShelf = {
      read: (named) => named.flatMap((id) => (ids.includes(id) ? [offer(id, { lastSeenAt: 7 })] : [])),
      onBoard: () => new Set()
    };
    return shortlist(ids, shelf, [], 2);
  };

  const made = asked(['c', 'a', 'd', 'b']);
  assert.deepEqual(made.compared.map((each) => each.id), ['a', 'b']);
  assert.deepEqual(made.left.cut, ['c', 'd']);
  assert.deepEqual(asked(['b', 'd', 'a', 'c']), made);
});

/* -------------------------------------------------------------------- cards */

test('a card says what an offer says, one line to a field, with the skills and the start of the posting', () => {
  assert.equal(cardText(PY), PY_CARD);
  assert.equal(cardText(GO), GO_CARD);
  assert.equal(cardText(offer('bare', { text: '' })), 'Offer: untitled');
  assert.equal(cardText(offer('bare')), 'Offer: untitled\nPosting: A posting.');
  assert.equal(cardText(offer('only-company', { company: '  Umbrella  ', text: '' })), 'Offer: Umbrella');
  assert.equal(
    cardText(offer('spaced', { position: 'Backend\n   Engineer', location: ' Krakow ', workMode: 'remote', text: '' })),
    'Offer: Backend Engineer\nWhere: Krakow, remote'
  );
});

test('a card is never more than CARD_LIMIT characters and never ends a skill or a word half way', () => {
  const prose = 'Our team builds and runs the billing platform used by banks across the country and expects every engineer to own what they ship. '.repeat(40);
  const skills = Array.from({ length: 120 }, (_, at) => `Technology${at}`);
  const long = (size: number) => 'w'.repeat(size);

  for (const size of [0, 10, 79, 80, 81, 200, 1_000]) {
    for (const each of [
      offer('long', { position: long(size), company: long(size), location: long(size), seniority: long(size), salary: long(size), skills, text: prose }),
      offer('few', { position: long(size), skills: ['Python'], text: prose }),
      offer('prose', { position: 'Engineer', text: prose })
    ]) {
      const card = cardText(each);
      assert.ok(card.length <= CARD_LIMIT, `${card.length} characters`);

      const line = card.split('\n').find((candidate) => candidate.startsWith('Skills: '));
      if (line !== undefined) {
        const shown = line.slice('Skills: '.length).split(', ');
        assert.deepEqual(shown, (each.skills ?? []).slice(0, shown.length), 'a prefix of the skills, each whole');
      }

      const posting = card.split('\n').find((candidate) => candidate.startsWith('Posting: '));
      if (posting !== undefined && posting.endsWith('…')) {
        const shown = posting.slice('Posting: '.length, -1);
        assert.ok(prose.trim().startsWith(shown), 'the start of the posting');
        assert.equal(prose.trim()[shown.length], ' ', 'and it stops at the end of a word');
      }
    }
  }
});

test('a posting is on a card only when there is room for enough of it to say something', () => {
  const skills = Array.from({ length: 70 }, (_, at) => `Skill${String(at).padStart(2, '0')}`);
  const withRoom = offer('room', { position: 'Engineer', skills: ['Python'], text: 'x'.repeat(40) + ' ' + 'y'.repeat(300) });
  assert.ok(cardText(withRoom).includes('\nPosting: '));

  // Skills that fill the card take the posting's place and the posting is left off whole.
  const full = offer('full', { position: 'Engineer', skills, text: 'A short posting that would have fitted if there were room, which there is not.' });
  const card = cardText(full);
  assert.ok(card.length <= CARD_LIMIT);
  assert.equal(card.includes('Posting:'), false);
  assert.ok(card.includes('Skill00'));
});

test('a card is as long as its limit allows to the last character, and the line break before a line counts toward it', () => {
  // "Offer: P", a line break and "Skills: " are 17 characters; the skills come to the rest.
  const first = 240;
  const rest = CARD_LIMIT - 17 - ', '.length - first;
  const made = (second: number) =>
    cardText(offer('edge', { position: 'P', skills: ['x'.repeat(first), 'y'.repeat(second)], text: '' }));

  const exact = made(rest);
  assert.equal(exact.length, CARD_LIMIT, 'both skills fit, and the card is the limit exactly');
  assert.equal(exact, `Offer: P\nSkills: ${'x'.repeat(first)}, ${'y'.repeat(rest)}`);

  const over = made(rest + 1);
  assert.equal(over, `Offer: P\nSkills: ${'x'.repeat(first)}`, 'one character more and the second skill is left off whole');
  assert.ok(over.length <= CARD_LIMIT);
});

test('the reasons offers are left out are said once each, in a fixed order, and a single one is a single one', () => {
  assert.equal(
    leftWords({ excluded: ['a'], missing: ['b'], board: ['c'], cut: ['d'] }),
    '1 is left out of this conversation, 1 not saved, 1 already on the Board, 1 beyond the ones compared'
  );
  assert.equal(leftWords({ excluded: ['a', 'b'], missing: [], board: [], cut: ['c', 'd', 'e'] }), '2 are left out of this conversation, 3 beyond the ones compared');
  assert.equal(leftWords(NONE_LEFT), '');
});

test('the labels of the sections are said in the words a measurement was made with', () => {
  assert.deepEqual(
    { ...FIT_LABELS },
    {
      preferences: 'PREFERENCES — SOURCE DATA',
      cards: 'SAVED OFFERS TO COMPARE — SOURCE DATA',
      evidence: 'PARTS OF THE CV THAT MENTION THEIR SKILLS — SOURCE DATA',
      absent: 'None were supplied.',
      unmatched: 'None of the skills the offers list appears in the CV.'
    }
  );
});

test('a digest says whether the offer changed, and what was shown says whether the card did', () => {
  const same = cardDigests(PY);
  assert.deepEqual(cardDigests({ ...PY }), same, 'the same offer');
  assert.equal(same.shown, digest(cardText(PY)));

  assert.deepEqual(cardDigests({ ...PY, lastSeenAt: 500, disposition: 'dismissed', processing: 'rated' }), same, 'seeing it again is not a change');
  assert.notEqual(cardDigests({ ...PY, skills: ['Python'] }).digest, same.digest);
  assert.notEqual(cardDigests({ ...PY, salary: '25000 PLN' }).digest, same.digest);
  assert.notEqual(cardDigests({ ...PY, location: 'Warsaw' }).digest, same.digest);

  // A change past what a card shows still changes the offer, and not the card.
  const prose = 'word '.repeat(300);
  const a = cardDigests(offer('p', { position: 'Engineer', text: prose }));
  const b = cardDigests(offer('p', { position: 'Engineer', text: `${prose}and more` }));
  assert.notEqual(a.digest, b.digest);
  assert.equal(a.shown, b.shown);
  assert.notEqual(cardDigests({ ...PY, id: 'other' }).digest, same.digest, 'which offer it is');
});

/* ------------------------------------------------------------------ the run */

test('a message that compares offers gives a model the cards and the parts of the CV that match, with no tools, and says so', async () => {
  const c = world();
  try {
    // Named in the order the person picked them, and compared by how recently they were seen.
    const run = c.begin(message(['go', 'py']));
    const result = await settle(run);

    assert.deepEqual(c.requests.map((request) => request.kind), ['loop'], 'nothing to choose among, so no tool choice was asked of a model');
    const loop = loopOf(c);
    assert.deepEqual(loop.tools, []);
    assert.equal(loop.system, FIT_SYSTEM);
    assert.equal(
      loop.prompt,
      prompted(
        NO_PREFERENCES,
        under(SECTION.cards, PY_CARD, GO_CARD),
        under(SECTION.evidence, SKILLS_TEXT, ACME_TEXT, GLOBEX_TEXT)
      )
    );

    assert.deepEqual(result.data.offers, { compared: ['py', 'go'], left: NONE_LEFT, preferences: 'absent' });
    assert.deepEqual(result.data.grounding, {
      included: ['offers:py/card', 'offers:go/card', SKILLS, ACME, GLOBEX],
      blocked: [],
      gone: [],
      suggested: []
    });
    assert.deepEqual(result.degraded, []);

    const py = c.offerStore.get('py') as OfferRecord;
    const go = c.offerStore.get('go') as OfferRecord;
    // What is digested is the CV as the store holds it, which is not the object a test wrote: it has its defaults.
    const stored = storedCv(c.s.deps.documents.read(CONTEXT) as never) as NonNullable<ReturnType<typeof storedCv>>;
    assert.deepEqual(
      included(c.entries(run)),
      [
        { ref: 'offers:py/card', ...cardDigests(py), status: 'included', origin: 'server', via: 'ground:offer' },
        { ref: 'offers:go/card', ...cardDigests(go), status: 'included', origin: 'server', via: 'ground:offer' },
        { ref: SKILLS, version: '1', digest: digest(stored.skills), status: 'included', origin: 'server', via: 'ground:evidence' },
        { ref: ACME, version: '1', digest: digest(stored.experience[0]), status: 'included', origin: 'server', via: 'ground:evidence' },
        { ref: GLOBEX, version: '1', digest: digest(stored.experience[1]), status: 'included', origin: 'server', via: 'ground:evidence' }
      ].map((entry) => JSON.parse(JSON.stringify(entry)) as RecordEntry)
    );
  } finally {
    c.dispose();
  }
});

test('a message that compares offers does not ask the model for tools whatever it says of reach, and a message about the CV alone keeps its own words', async () => {
  const c = world();
  try {
    await settle(c.begin(message(['py'], { reach: 'free' })));
    await settle(c.begin(message(['py'], { reach: 'selected' })));
    await settle(c.begin({ question: QUESTION, grounding: { once: [ACME] } }));

    const loops = c.requests.filter((request) => request.kind === 'loop');
    assert.equal(loops.length, 3);
    assert.equal(loops[0]?.system, FIT_SYSTEM);
    assert.equal(loops[1]?.system, FIT_SYSTEM, 'selected is what a comparison already is');
    assert.deepEqual([loops[0]?.tools, loops[1]?.tools], [[], []]);
    assert.notEqual(loops[2]?.system, FIT_SYSTEM);
    assert.deepEqual(loops[2]?.tools, ['search_profile', 'read_cv']);
  } finally {
    c.dispose();
  }
});

test('the history and the summary go with a comparison as they go with any message', async () => {
  const c = world();
  try {
    await settle(
      c.begin(message(['py'], {}, { summary: 'We spoke of remote work.', history: [{ role: 'user', text: 'Earlier question.' }] }))
    );
    const loop = loopOf(c);
    assert.ok(loop.system.startsWith(FIT_SYSTEM) || loop.system.includes(FIT_SYSTEM));
    assert.ok(loop.system.includes('We spoke of remote work.'));
    assert.deepEqual(loop.history, ['Earlier question.']);
  } finally {
    c.dispose();
  }
});

test('what the person said of the offers is in the prompt with the offers, and the posting a message carries goes with them', async () => {
  const c = world();
  try {
    await settle(c.begin(message(['xl'], {}, { offerText: 'The one I am looking at now.' })));
    const prompt = loopOf(c).prompt;
    assert.ok(prompt.includes(under(SECTION.cards, XL_CARD)));
    assert.ok(prompt.endsWith('CAPTURED JOB POSTING — SOURCE DATA:\nThe one I am looking at now.'));
  } finally {
    c.dispose();
  }
});

test('pieces the conversation pinned and the offers compared are both recorded, each once, the pieces first', async () => {
  const c = world();
  try {
    c.pin(GLOBEX);
    const run = c.begin(message(['py'], { once: [INITECH] }));
    const result = await settle(run);

    assert.deepEqual((result.data.grounding as { included: string[] }).included, [GLOBEX, INITECH, 'offers:py/card', SKILLS, ACME]);
    assert.deepEqual(
      included(c.entries(run)).map((entry) => [entry.ref, entry.via]),
      [
        [GLOBEX, 'ground:pin'],
        [INITECH, 'ground:once'],
        ['offers:py/card', 'ground:offer'],
        [SKILLS, 'ground:evidence'],
        [ACME, 'ground:evidence']
      ]
    );
    assert.equal(
      loopOf(c).prompt,
      prompted(
        under(SECTION.picks, GLOBEX_TEXT, INITECH_TEXT),
        NO_PREFERENCES,
        under(SECTION.cards, PY_CARD),
        under(SECTION.evidence, SKILLS_TEXT, ACME_TEXT)
      )
    );
  } finally {
    c.dispose();
  }
});

test('a message that compares offers asks the shelf once, for the ids it named', async () => {
  const c = world();
  try {
    await settle(c.begin(message(['py', 'go', 'py'])));
    // Once to plan the message's needs and size, once to assemble: never a read per offer.
    assert.ok(c.reads.length >= 1);
    for (const ids of c.reads) assert.deepEqual(ids, ['py', 'go'], 'each id once, in the order named');
  } finally {
    c.dispose();
  }
});

test('what was held back and what is gone is said for the pieces and the offers together, the pieces first', async () => {
  const c = world();
  try {
    const nowhere = ref('experience/nowhere~none');
    c.exclude(ACME, 'offers:xl');
    const result = await settle(c.begin(message(['py', 'xl', 'nope'], { once: [ACME, nowhere] })));
    const said = result.data.grounding as { blocked: string[]; gone: string[] };

    assert.deepEqual(said.blocked, [ACME, 'offers:xl']);
    assert.deepEqual(said.gone, [nowhere, 'offers:nope']);
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------- preferences */

test('preferences are put in front of the model as the person said them, and recorded as the host\'s own words', async () => {
  const c = world();
  try {
    const run = c.begin(message(['py'], { preferences: '  Remote only.\nNo on-call.  ' }));
    const result = await settle(run);

    assert.ok(loopOf(c).prompt.includes(`${SECTION.preferences}:\nRemote only.\nNo on-call.\n\n${SECTION.cards}:`));
    assert.deepEqual((result.data.offers as { preferences: string }).preferences, 'supplied');

    const [first] = included(c.entries(run));
    assert.deepEqual(first, {
      ref: PREFERENCES_REF,
      digest: digest('Remote only.\nNo on-call.'),
      status: 'included',
      origin: 'client',
      via: 'input'
    });
    assert.equal(PREFERENCES_REF, 'preferences:request');
  } finally {
    c.dispose();
  }
});

test('no preferences, or only blanks, is said to the model as none supplied, and records nothing', async () => {
  const c = world();
  try {
    for (const preferences of [undefined, '', '  \n\t ']) {
      const run = c.begin(message(['py'], preferences === undefined ? {} : { preferences }));
      const result = await settle(run);
      assert.equal((result.data.offers as { preferences: string }).preferences, 'absent');
      assert.equal(c.entries(run).some((entry) => entry.ref === PREFERENCES_REF), false);
    }
    for (const request of c.requests.filter((each) => each.kind === 'loop')) {
      assert.ok(request.prompt.includes(NO_PREFERENCES));
      assert.ok(request.prompt.startsWith(QUESTION + '\n\n' + NO_PREFERENCES + '\n\n' + SECTION.cards));
    }
  } finally {
    c.dispose();
  }
});

test('preferences are not a part of the CV and are not looked for in it, or in the offers', async () => {
  const c = world([offer('p', { position: 'Engineer', skills: ['Remote'], text: 'Remote' })]);
  try {
    await settle(c.begin(message(['p'], { preferences: 'Python, Go, Excel' })));
    // The skills an offer lists are what finds the CV's parts. What a person prefers is not.
    assert.ok(loopOf(c).prompt.includes(NO_MATCH));
  } finally {
    c.dispose();
  }
});

/* ----------------------------------------------------------------- evidence */

test('the CV\'s own words are found by the skills the offers list, whole words only, and put in the order of the CV', async () => {
  const body = {
    ...BODY,
    experience: [
      job('Alpha', 'Dev', 'Worked at Google on Django and Pythonic style.'),
      job('Beta', 'Dev', 'Wrote golang services and went home.'),
      job('Gamma', 'Dev', 'Wrote Go services.')
    ]
  };
  const c = chat({ body: body as never });
  c.saveOffer(offer('g', { position: 'Dev', skills: ['Go', 'Python'], text: 'Go.' }));
  try {
    await settle(c.begin(message(['g'])));
    const prompt = loopOf(c).prompt;
    const evidence = prompt.slice(prompt.indexOf(SECTION.evidence));

    assert.ok(evidence.includes('Gamma'), 'go is a word in "Wrote Go services."');
    assert.ok(evidence.includes(SKILLS_TEXT), 'and in the skills');
    assert.equal(evidence.includes('Alpha'), false, 'not inside Google, Django or Pythonic');
    assert.equal(evidence.includes('Beta'), false, 'not inside golang');
    assert.ok(evidence.indexOf(SKILLS_TEXT) < evidence.indexOf('Gamma'), 'the overview before the jobs, as the CV is');
  } finally {
    c.dispose();
  }
});

test('a skill is matched without regard to case, spacing, or how short it is written', async () => {
  const body = { ...BODY, experience: [job('Alpha', 'Dev', 'Built things in node.js and C++ and TYPESCRIPT, and used machine   learning.')] };
  const c = chat({ body: body as never });
  c.saveOffer(offer('s', { position: 'Dev', skills: ['  Machine Learning ', 'TypeScript', 'x', ''], text: '.' }));
  try {
    await settle(c.begin(message(['s'])));
    assert.ok(loopOf(c).prompt.includes('Experience, Dev at Alpha:'));
    // A skill of one character is not compared: it would match half the sentences there are.
    const none = chat({ body: { ...BODY, experience: [job('Alpha', 'Dev', 'Used x and y.')] } as never });
    none.saveOffer(offer('s', { position: 'Dev', skills: ['x'], text: '.' }));
    try {
      await settle(none.begin(message(['s'])));
      assert.ok(loopOf(none).prompt.includes(NO_MATCH));
    } finally {
      none.dispose();
    }
  } finally {
    c.dispose();
  }
});

test('a part that mentions more of the skills is chosen over one that mentions fewer, and MAX_EVIDENCE parts are kept', async () => {
  const jobs = Array.from({ length: 10 }, (_, at) =>
    job(`Co${at}`, 'Dev', at === 9 ? 'Used alpha, beta and gamma.' : at === 8 ? 'Used alpha and beta.' : 'Used alpha.')
  );
  const c = chat({ body: { ...BODY, skills: { ...BODY.skills, groups: [] }, experience: jobs } as never });
  c.saveOffer(offer('m', { position: 'Dev', skills: ['alpha', 'beta', 'gamma'], text: '.' }));
  try {
    const run = c.begin(message(['m']));
    await settle(run);

    const kept = included(c.entries(run)).filter((entry) => entry.via === 'ground:evidence').map((entry) => entry.ref);
    assert.equal(MAX_EVIDENCE, 8);
    assert.deepEqual(
      kept,
      [0, 1, 2, 3, 4, 5, 8, 9].map((at) => ref(`experience/co${at}~dev`)),
      'the two that mention more, and of the rest the first in the CV, and in the order of the CV'
    );
  } finally {
    c.dispose();
  }
});

test('the offers take the room the budget gives, and the evidence that does not fit is not cut but left out', async () => {
  const head = (company: string): number => `Experience, Dev at ${company}:\n2021 - present\n- `.length;
  const long = (company: string, size: number) => job(company, 'Dev', `python ${'x'.repeat(size - head(company) - 'python '.length)}`);
  const c = chat({ body: { ...BODY, skills: { ...BODY.skills, groups: [] }, experience: [0, 1, 2, 3].map((at) => long(`Co${at}`, 9_000)) } as never });
  c.saveOffer(offer('big', { position: 'Dev', skills: ['Python'], text: '.' }));
  try {
    const run = c.begin(message(['big']));
    await settle(run);

    const card = cardText(c.offerStore.get('big') as OfferRecord);
    const kept = included(c.entries(run)).filter((entry) => entry.via === 'ground:evidence').map((entry) => entry.ref);
    // 27,000 and the card and the blank lines fit; a fourth would not.
    assert.deepEqual(kept, [0, 1, 2].map((at) => ref(`experience/co${at}~dev`)));
    const sent = card.length + 3 * (9_000 + 2);
    assert.ok(sent <= OFFERS_BUDGET && sent + 9_002 > OFFERS_BUDGET);

    const fast = await preview(c, 'fast', message(['big']));
    assert.equal(fast.size.parts.offers, sent);
  } finally {
    c.dispose();
  }
});

test('a part of the CV that is pinned is sent once, with the pieces, and is not sent again as evidence', async () => {
  const c = world();
  try {
    c.pin(ACME);
    const run = c.begin(message(['py']));
    await settle(run);

    const prompt = loopOf(c).prompt;
    assert.equal(prompt.split(ACME_TEXT).length - 1, 1, 'once');
    assert.ok(prompt.includes(under(SECTION.picks, ACME_TEXT)));
    assert.ok(prompt.includes(under(SECTION.evidence, SKILLS_TEXT)), 'the rest of what matches is still evidence');
    assert.equal(included(c.entries(run)).filter((entry) => entry.ref === ACME).length, 1);

    // What is measured before a plan is never less than what is sent: the part is counted as if it were evidence.
    const fast = await preview(c, 'fast', message(['py']));
    const sent = [PY_CARD, SKILLS_TEXT].reduce((total, block) => total + block.length, 0) + 2;
    assert.equal(fast.size.parts.offers, sent + ACME_TEXT.length + 2);
    assert.equal(fast.size.parts.picks, ACME_TEXT.length);
  } finally {
    c.dispose();
  }
});

test('a part that mentions a skill that more offers list counts for more, and a skill listed twice by one offer counts once', async () => {
  const jobs = (last: string) => [
    ...Array.from({ length: 8 }, (_, at) => job(`Co${at}`, 'Dev', `Used beta${at}.`)),
    job('Co8', 'Dev', last)
  ];
  const world8 = (offers: OfferRecord[]) => {
    const c = chat({ body: { ...BODY, skills: { ...BODY.skills, groups: [] }, experience: jobs('Used alpha.') } as never });
    for (const each of offers) c.saveOffer(each);
    return c;
  };
  const betas = Array.from({ length: 8 }, (_, at) => `beta${at}`);
  const keptBy = (c: Chat, run: ReturnType<Chat['begin']>) =>
    included(c.entries(run)).filter((entry) => entry.via === 'ground:evidence').map((entry) => entry.ref);
  const refOf = (at: number) => ref(`experience/co${at}~dev`);

  // Two offers that list alpha: the part that mentions it scores twice, and the eight that
  // mention a beta once each cannot all stay.
  const two = world8([
    offer('one', { position: 'Dev', skills: ['alpha', ...betas], text: '.', lastSeenAt: 2 }),
    offer('two', { position: 'Dev', skills: ['alpha'], text: '.', lastSeenAt: 1 })
  ]);
  try {
    const run = two.begin(message(['one', 'two']));
    await settle(run);
    assert.deepEqual(keptBy(two, run), [0, 1, 2, 3, 4, 5, 6, 8].map(refOf));
  } finally {
    two.dispose();
  }

  // One offer that lists alpha three ways: still one skill, and a tie is the CV's order.
  const dup = world8([offer('d', { position: 'Dev', skills: ['alpha', 'Alpha', ' ALPHA ', ...betas], text: '.' })]);
  try {
    const run = dup.begin(message(['d']));
    await settle(run);
    assert.deepEqual(keptBy(dup, run), [0, 1, 2, 3, 4, 5, 6, 7].map(refOf));
  } finally {
    dup.dispose();
  }
});

test('the evidence takes the room the preferences and the cards leave, to the last character', async () => {
  const preferences = 'p'.repeat(100);
  const wanted = offer('b', { position: 'Dev', skills: ['Python'], text: '' });
  const fixed = preferences.length + cardText(wanted).length + 2;
  const head = 'Experience, Dev at Co:\n2021 - present\n- '.length;
  const body = (size: number) => ({
    ...BODY,
    skills: { ...BODY.skills, groups: [] },
    experience: [job('Co', 'Dev', `python ${'x'.repeat(size - head - 'python '.length)}`)]
  });

  for (const [over, fits] of [[0, true], [1, false]] as const) {
    const c = chat({ body: body(OFFERS_BUDGET - fixed - 2 + over) as never });
    c.saveOffer(wanted);
    try {
      const run = c.begin(message(['b'], { preferences }));
      await settle(run);
      const evidence = included(c.entries(run)).filter((entry) => entry.via === 'ground:evidence');
      assert.equal(evidence.length, fits ? 1 : 0, `${over} over the room`);
      assert.equal(loopOf(c).prompt.includes(NO_MATCH), !fits);

      const fast = await preview(c, 'fast', message(['b'], { preferences }));
      assert.equal(fast.size.parts.offers, fits ? OFFERS_BUDGET : fixed);
    } finally {
      c.dispose();
    }
  }
});

test('when every part of the CV that matches is already sent as a piece, the offers say nothing of the CV matching nothing', async () => {
  const c = world([offer('s', { position: 'Dev', skills: ['Postgres'], text: '' })]);
  try {
    c.pin(ACME);
    const run = c.begin(message(['s']));
    const result = await settle(run);

    assert.equal(
      loopOf(c).prompt,
      prompted(under(SECTION.picks, ACME_TEXT), NO_PREFERENCES, under(SECTION.cards, 'Offer: Dev\nSkills: Postgres'))
    );
    assert.deepEqual((result.data.grounding as { included: string[] }).included, [ACME, 'offers:s/card']);
    assert.deepEqual(included(c.entries(run)).map((entry) => entry.via), ['ground:pin', 'ground:offer']);
  } finally {
    c.dispose();
  }
});

test('offers that list no skill that the CV mentions give the model the cards and say that nothing matched', async () => {
  const c = world();
  try {
    const run = c.begin(message(['rs']));
    const result = await settle(run);

    assert.equal(loopOf(c).prompt, prompted(NO_PREFERENCES, under(SECTION.cards, RS_CARD), NO_MATCH));
    assert.deepEqual((result.data.grounding as { included: string[] }).included, ['offers:rs/card']);
    assert.deepEqual(included(c.entries(run)).map((entry) => entry.via), ['ground:offer']);

    const bare = world([offer('plain', { position: 'Engineer', text: 'No skills listed.' })]);
    try {
      await settle(bare.begin(message(['plain'])));
      assert.ok(loopOf(bare).prompt.endsWith(NO_MATCH));
    } finally {
      bare.dispose();
    }
  } finally {
    c.dispose();
  }
});

test('the personal details of the CV are never offered as evidence, whatever an offer lists', async () => {
  const c = world([offer('town', { position: 'Engineer', skills: ['Krakow', 'Ada', 'example.com', 'Personal'], text: '.' })]);
  try {
    await settle(c.begin(message(['town'])));
    const prompt = loopOf(c).prompt;
    assert.ok(prompt.includes(NO_MATCH));
    assert.equal(prompt.includes('ada@example.com'), false);
    assert.equal(prompt.includes('Personal details'), false);
  } finally {
    c.dispose();
  }
});

test('evidence is looked for in the CV now and not in the search index, which a message of this kind never asks', async () => {
  const c = world([PY], {
    search: async () => {
      throw new Error('the index must not be asked');
    }
  });
  try {
    await settle(c.begin(message(['py'])));
    assert.equal(c.searches.count, 0);
  } finally {
    c.dispose();
  }
});

test('with the same offers and the same CV the model is sent the same message, and an edit to the CV that no offer mentions changes none of it', async () => {
  const a = world();
  const b = world();
  try {
    await settle(a.begin(message(['py', 'go'])));
    await settle(b.begin(message(['py', 'go'])));
    assert.deepEqual(a.requests, b.requests);

    b.s.deps.documents.update(CONTEXT, CV_KIND, (body) => {
      (body as typeof BODY).experience[2]!.highlights = ['Reported on something else entirely.'];
      return body as never;
    });
    await settle(b.begin(message(['py', 'go'])));
    assert.deepEqual(b.requests[1], a.requests[0], 'a part no offer mentions is not in the message, so editing it changes nothing');
  } finally {
    a.dispose();
    b.dispose();
  }
});

/* ------------------------------------------------------------------ refused */

test('a message that names offers none of which can be compared is refused with the reasons, before any model is asked', async () => {
  const c = world();
  try {
    c.exclude('offers:py');
    c.board.add('go');

    const one = await refusal(c.begin(message(['py', 'nope'])));
    assert.deepEqual(one, {
      code: 'needs_unmet',
      message: 'offers: None of the 2 offers named can be compared: 1 is left out of this conversation, 1 not saved.'
    });

    const all = await refusal(c.begin(message(['py', 'nope', 'go'])));
    assert.equal(
      all.message,
      'offers: None of the 3 offers named can be compared: 1 is left out of this conversation, 1 not saved, 1 already on the Board.'
    );

    const many = world(Array.from({ length: 3 }, (_, at) => offer(`n${at}`)));
    try {
      many.exclude('offers:n0', 'offers:n1', 'offers:n2');
      const plural = await refusal(many.begin(message(['n0', 'n1', 'n2'])));
      assert.equal(plural.message, 'offers: None of the 3 offers named can be compared: 3 are left out of this conversation.');
      assert.deepEqual(many.requests, []);
    } finally {
      many.dispose();
    }

    const single = await refusal(c.begin(message(['nope'])));
    assert.equal(single.message, 'offers: None of the 1 offer named can be compared: 1 not saved.');

    assert.deepEqual(c.requests, [], 'no model was asked');
    assert.equal(c.reads.flat().includes('py'), false, 'and an offer that was left out was not read');
  } finally {
    c.dispose();
  }
});

test('a message that names offers in a run with no conversation to cut from, or no shelf, is refused and says why', async () => {
  const c = world();
  const bare = world([PY], { offers: false });
  try {
    const noConversation = await refusal(c.begin(message(['py']), 'ask_profile', { contextId: CONTEXT }));
    assert.deepEqual(noConversation, { code: 'needs_unmet', message: 'offers: Offers can be compared only in a conversation about a CV.' });

    const noShelf = await refusal(bare.begin(message(['py'])));
    assert.deepEqual(noShelf, { code: 'needs_unmet', message: 'offers: Offers can be compared only in a conversation about a CV.' });

    assert.deepEqual([...c.requests, ...bare.requests], []);
  } finally {
    c.dispose();
    bare.dispose();
  }
});

test('offers that are left out while others are compared are said, and do not stop the message', async () => {
  const c = world();
  try {
    c.exclude('offers:xl');
    c.board.add('rs');
    const run = c.begin(message(['py', 'xl', 'rs', 'nope', 'go']));
    const result = await settle(run);

    assert.deepEqual(result.data.offers, {
      compared: ['py', 'go'],
      left: { excluded: ['xl'], missing: ['nope'], board: ['rs'], cut: [] },
      preferences: 'absent'
    });
    assert.deepEqual(result.degraded, ['offers']);
    assert.deepEqual((result.data.grounding as { gone: string[] }).gone, ['offers:nope']);
    assert.deepEqual((result.data.grounding as { blocked: string[] }).blocked, ['offers:xl']);
  } finally {
    c.dispose();
  }
});

test('more offers than are compared are cut by how recently they were seen, and the rest are said', async () => {
  const many = Array.from({ length: COMPARE_LIMIT + 2 }, (_, at) =>
    offer(`o${String(at).padStart(2, '0')}`, { position: `Role ${at}`, lastSeenAt: 1_000 + at, skills: [] })
  );
  const c = world(many);
  try {
    const result = await settle(c.begin(message(many.map((each) => each.id))));
    const { compared, left } = result.data.offers as { compared: string[]; left: { cut: string[] } };

    assert.equal(compared.length, COMPARE_LIMIT);
    assert.equal(compared[0], 'o26', 'the newest first');
    assert.deepEqual(left.cut, ['o01', 'o00']);
    assert.deepEqual(result.degraded, ['offers']);
    assert.equal(loopOf(c).prompt.split('Offer: Role ').length - 1, COMPARE_LIMIT);
  } finally {
    c.dispose();
  }
});

/* -------------------------------------------------------------------- a wall */

test('an offer the conversation left out reaches no payload, is not read, and is recorded as held back', async () => {
  const canary = 'CANARY-OFFER-PY-4417';
  const c = world([{ ...PY, text: `${PY.text} ${canary}` }, GO]);
  try {
    c.exclude('offers:py');
    const run = c.begin(message(['py', 'go']));
    const result = await settle(run);

    assert.equal(everything(c).includes(canary), false);
    assert.equal(everything(c).includes('Backend Engineer'), false);
    assert.equal(c.reads.flat().includes('py'), false);
    assert.deepEqual(result.data.offers, {
      compared: ['go'],
      left: { ...NONE_LEFT, excluded: ['py'] },
      preferences: 'absent'
    });
    assert.deepEqual((result.data.grounding as { blocked: string[] }).blocked, ['offers:py']);

    const held = c.entries(run).filter((entry) => entry.status === 'blocked');
    assert.deepEqual(held.map((entry) => [entry.ref, entry.via]), [['offers:py', 'ground:offer']]);

    // The skills of an offer that was left out do not find parts of the CV for the offers that were not.
    assert.equal(loopOf(c).prompt.includes(ACME_TEXT), false);
    assert.ok(loopOf(c).prompt.includes(GLOBEX_TEXT));
  } finally {
    c.dispose();
  }
});

test('a part of the CV the conversation left out is not offered as evidence, and reaches no payload', async () => {
  const canary = 'CANARY-ACME-7731';
  const body = { ...BODY, experience: [job('Acme', 'Senior Engineer', `Rewrote billing in Python. ${canary}`), ...BODY.experience.slice(1)] };
  const c = chat({ body: body as never });
  c.saveOffer(PY);
  try {
    c.exclude(ACME);
    const run = c.begin(message(['py']));
    await settle(run);

    assert.equal(everything(c).includes(canary), false);
    assert.equal(included(c.entries(run)).some((entry) => entry.ref === ACME), false);
    assert.ok(loopOf(c).prompt.includes(under(SECTION.evidence, SKILLS_TEXT)), 'what is left still counts');

    const whole = chat({ body: body as never });
    whole.saveOffer(PY);
    try {
      whole.exclude(ref());
      await settle(whole.begin(message(['py'])));
      assert.ok(whole.requests.length === 1 && loopOf(whole).prompt.includes(NO_MATCH), 'the whole CV left out leaves nothing to match');
      assert.equal(everything(whole).includes(canary), false);
    } finally {
      whole.dispose();
    }
  } finally {
    c.dispose();
  }
});

test('an offer pinned nowhere and left out later is left out of the next message, and one that is put back is compared', async () => {
  const c = world();
  try {
    c.exclude('offers:py');
    const first = await settle(c.begin(message(['py', 'go'])));
    assert.deepEqual((first.data.offers as { compared: string[] }).compared, ['go']);

    const { revision } = c.selections.read(CHAT);
    c.selections.change(CHAT, { expectedRevision: revision, exclude: [], clear: ['offers:py'], pin: [], unpin: [] });
    const second = await settle(c.begin(message(['py', 'go'])));
    assert.deepEqual((second.data.offers as { compared: string[] }).compared, ['py', 'go']);
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------ the Board */

test('an offer on the Board is left out, and the Board is asked now and not when the runtime started', async () => {
  const c = world();
  try {
    const before = await settle(c.begin(message(['py', 'go'])));
    assert.deepEqual((before.data.offers as { compared: string[] }).compared, ['py', 'go']);

    c.board.add('py');
    const after = await settle(c.begin(message(['py', 'go'])));
    assert.deepEqual(after.data.offers, {
      compared: ['go'],
      left: { ...NONE_LEFT, board: ['py'] },
      preferences: 'absent'
    });
    assert.equal(everything(c).split('Offer: Backend Engineer').length - 1, 1, 'it was shown once, before it went onto the Board');
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------- limits */

/** The least a limit can be, so a message that tests one is padded with preferences up to it. */
const LEAST_LIMIT = 2_000;

test('what the offers come to counts against the limit, and a message over it is refused before a model is asked', async () => {
  const c = world();
  try {
    const blocks = [PY_CARD, GO_CARD, SKILLS_TEXT, ACME_TEXT, GLOBEX_TEXT];
    // Six blocks with the preferences, and a blank line between each pair.
    const base = blocks.reduce((total, block) => total + block.length, 0) + 2 * blocks.length;
    const padded = (size: number) => message(['py', 'go'], { preferences: 'p'.repeat(size - base) });

    // At the limit it is sent; a character over, it is not.
    c.limitStore.set(CHAT, LEAST_LIMIT);
    await settle(c.begin(padded(LEAST_LIMIT)));
    assert.equal(c.requests.length, 1);

    const over = await refusal(c.begin(padded(LEAST_LIMIT + 1)));
    assert.equal(over.code, 'context_limit');
    assert.equal(
      over.message,
      `The material for this message comes to ${(LEAST_LIMIT + 1).toLocaleString('en-US')} characters (offers ${(LEAST_LIMIT + 1).toLocaleString('en-US')}), and this conversation is limited to ${LEAST_LIMIT.toLocaleString('en-US')}. Unpin or detach something, or raise the limit.`
    );
    assert.equal(c.requests.length, 1, 'the second message asked no model');
  } finally {
    c.dispose();
  }
});

test('the offers are said in the sizes of a message that has them, and a message that has none carries the sizes it always did', async () => {
  const c = world();
  try {
    const plain = await preview(c, 'fast', { question: QUESTION });
    assert.deepEqual(plain.size, { parts: { history: 0, summary: 0, posting: 0, picks: 0 }, total: 0 });

    const sized = await preview(c, 'fast', {
      ...message(['py', 'go'], { preferences: 'Remote.' }, { history: [{ role: 'user', text: 'abc' }] })
    });
    const offers = 'Remote.'.length + PY_CARD.length + GO_CARD.length + [SKILLS_TEXT, ACME_TEXT, GLOBEX_TEXT].reduce((total, block) => total + block.length, 0) + 2 * 5;
    assert.deepEqual(sized.size, { parts: { history: 3, summary: 0, posting: 0, picks: 0, offers }, total: 3 + offers });
    assert.equal(sized.refusal, undefined);
  } finally {
    c.dispose();
  }
});

test('the offers take room from the pieces the runtime adds by itself, as the posting does, and are named in a refusal', () => {
  assert.equal(roomForPicks({ history: 100, summary: 0, posting: 0 }, 5_000), 4_900);
  assert.equal(roomForPicks({ history: 100, summary: 0, posting: 0, offers: 1_000 }, 5_000), 3_900);
  assert.equal(roomForPicks({ history: 0, summary: 0, posting: 0, offers: 9_000 }, 5_000), 0, 'never less than nothing');
  assert.equal(roomForPicks({ history: 0, summary: 0, posting: 0, offers: 1_000 }, undefined), roomForPicks({ history: 0, summary: 0, posting: 0 }, undefined));

  assert.equal(overLimit({ history: 0, summary: 0, picks: 0, posting: 0, offers: 600 }, 600), undefined);
  assert.match(overLimit({ history: 10, summary: 0, picks: 0, posting: 0, offers: 600 }, 600) ?? '', /\(history 10, offers 600\)/);
  assert.equal(
    overLimit({ history: 0, summary: 0, picks: 0, posting: 0 }, 5),
    undefined,
    'a message with no offers is held to its limit as it always was'
  );
});

test('the sizes are the ones the protocol states', () => {
  assert.deepEqual(
    { COMPARE_LIMIT, MAX_OFFER_IDS, PREFERENCES_LIMIT, CARD_LIMIT, OFFERS_BUDGET, MAX_EVIDENCE },
    { COMPARE_LIMIT: 25, MAX_OFFER_IDS: 100, PREFERENCES_LIMIT: 2_000, CARD_LIMIT: 500, OFFERS_BUDGET: 30_000, MAX_EVIDENCE: 8 }
  );
});

/* ---------------------------------------------------------------- the schema */

test('a message may name as many offers as MAX_OFFER_IDS, each once, and says no more than it is given', () => {
  const parse = (grounding: Record<string, unknown>) => inputSchema.safeParse({ question: QUESTION, grounding });
  const ids = (size: number) => Array.from({ length: size }, (_, at) => `offer-${at}`);

  assert.ok(parse({ offerIds: ids(MAX_OFFER_IDS) }).success);
  const over = parse({ offerIds: ids(MAX_OFFER_IDS + 1) });
  assert.ok(!over.success);
  assert.match(over.error.issues[0]?.message ?? '', /At most 100 offers/);
  assert.equal(MAX_OFFER_IDS, 100);

  assert.deepEqual(parse({ offerIds: ['a', 'b', 'a', 'c', 'b'] }).data?.grounding?.offerIds, ['a', 'b', 'c']);
  assert.ok(!parse({ offerIds: [''] }).success);
  assert.ok(!parse({ offerIds: ['x'.repeat(201)] }).success);
  assert.ok(parse({ offerIds: ['x'.repeat(200)] }).success);
  assert.ok(!parse({ offerIds: 'py' }).success);

  assert.ok(parse({ preferences: 'p'.repeat(PREFERENCES_LIMIT) }).success);
  assert.ok(!parse({ preferences: 'p'.repeat(PREFERENCES_LIMIT + 1) }).success);
  assert.equal(PREFERENCES_LIMIT, 2_000);
  assert.ok(!parse({ preferences: 4 }).success);

  assert.ok(parse({ cite: true }).success);
  assert.ok(parse({ cite: false }).success);
  assert.ok(!parse({ cite: 'yes' }).success);
  assert.ok(!parse({ cite: 1 }).success);
});

test('what a message does not carry stays absent, so a message stored with the fields it always had is stored with them', () => {
  const parsed = inputSchema.parse({ question: QUESTION, grounding: { once: [] } });
  assert.deepEqual(parsed.grounding, { once: [], reach: 'free', auto: 'off' });
  assert.equal('offerIds' in (parsed.grounding ?? {}), false);
  assert.equal('preferences' in (parsed.grounding ?? {}), false);
  assert.equal('cite' in (parsed.grounding ?? {}), false);

  assert.equal(inputSchema.parse({ question: QUESTION }).grounding, undefined);
});

/* ---------------------------------------------------------------- citations */

test('with cite, the blocks are numbered in the order they are recorded, and the rule that says what to do with the numbers is said once', async () => {
  const c = world();
  try {
    c.pin(GLOBEX);
    const run = c.begin(message(['py'], { cite: true, preferences: 'Remote.', once: [INITECH] }));
    await settle(run);

    assert.equal(
      loopOf(c).prompt,
      prompted(
        under(SECTION.picks, `[1] ${GLOBEX_TEXT}`, `[2] ${INITECH_TEXT}`),
        under(SECTION.preferences, '[3] Remote.'),
        under(SECTION.cards, `[4] ${PY_CARD}`),
        under(SECTION.evidence, `[5] ${SKILLS_TEXT}`, `[6] ${ACME_TEXT}`)
      )
    );
    assert.equal(loopOf(c).system, `${FIT_SYSTEM}\n${CITE_RULE}`);
    assert.equal(loopOf(c).system.split(CITE_RULE).length - 1, 1);

    // The number of a block is its place among what was recorded as included.
    assert.deepEqual(
      included(c.entries(run)).map((entry) => entry.ref),
      [GLOBEX, INITECH, PREFERENCES_REF, 'offers:py/card', SKILLS, ACME]
    );
  } finally {
    c.dispose();
  }
});

test('what is said of the preferences, and of the CV matching nothing, is the runtime\'s own and carries no number', async () => {
  const c = world();
  try {
    await settle(c.begin(message(['rs'], { cite: true })));
    assert.equal(loopOf(c).prompt, prompted(NO_PREFERENCES, under(SECTION.cards, `[1] ${RS_CARD}`), NO_MATCH));
  } finally {
    c.dispose();
  }
});

test('the numbers an answer uses are read back as the entries they stand for, and the ones that stand for nothing are said', async () => {
  const c = world([PY, GO], { answer: () => 'First [1], then [2, 9] and [3]. Not [0], [x], [1a] or [ ]. Again [1], [7] and [9].' });
  try {
    const run = c.begin(message(['py', 'go'], { cite: true }));
    const result = await settle(run);

    // Entries are, in order: the two cards, the skills, Acme, Globex.
    assert.deepEqual(result.data.cited, ['offers:py/card', 'offers:go/card', SKILLS]);
    assert.deepEqual(result.data.unresolved, [9, 0, 7]);
    assert.equal(result.data.answer, 'First [1], then [2, 9] and [3]. Not [0], [x], [1a] or [ ]. Again [1], [7] and [9].');
  } finally {
    c.dispose();
  }
});

test('an answer is read for numbers only when the blocks were numbered', async () => {
  const c = world([PY], { answer: () => 'See [1] and [2].' });
  try {
    const result = await settle(c.begin(message(['py'])));
    assert.equal('cited' in result.data, false);
    assert.equal('unresolved' in result.data, false);

    const asked = await settle(c.begin(message(['py'], { cite: true })));
    assert.deepEqual(asked.data.cited, ['offers:py/card', SKILLS]);

    const refused = await settle(c.begin(message(['py'], { cite: false })));
    assert.equal('cited' in refused.data, false);
    assert.equal(c.requests.filter((request) => request.kind === 'loop').at(-1)?.system, FIT_SYSTEM);
  } finally {
    c.dispose();
  }
});

test('citations reads one number, a list of numbers, and nothing else, and never invents an entry', () => {
  const entry = (at: number): RecordEntry => ({ ref: `cv:x/${at}`, digest: 'd', status: 'included', origin: 'server', via: 'ground:pin' });
  const entries = [entry(1), entry(2), entry(3)];

  assert.deepEqual(citations('[1]', entries), { cited: ['cv:x/1'], unresolved: [] });
  assert.deepEqual(citations('a [3,1] b [ 2 ]', entries), { cited: ['cv:x/3', 'cv:x/1'], unresolved: [] });
  assert.deepEqual(citations('[1 , 2 ,3]', entries), { cited: ['cv:x/1', 'cv:x/2', 'cv:x/3'], unresolved: [] });
  assert.deepEqual(citations('[4] [0] [4]', entries), { cited: [], unresolved: [4, 0] });
  assert.deepEqual(citations('[1][1][1]', entries), { cited: ['cv:x/1'], unresolved: [] });
  assert.deepEqual(citations('[a] [1a] [] [,] [1,] [-1] (1) 1', entries), { cited: [], unresolved: [] });
  assert.deepEqual(citations('anything', []), { cited: [], unresolved: [] });
  assert.deepEqual(citations('[1]', []), { cited: [], unresolved: [1] });
});

/* ------------------------------------------------------------------ a preview */

test('a preview of a message that compares offers asks no model, writes nothing, and a run after it is the run it would have been', async () => {
  const a = world();
  const b = world();
  try {
    const before = written(a);
    const input = message(['py', 'go'], { preferences: 'Remote.', cite: true });

    await preview(a, 'fast', input);
    await preview(a, 'full', input);
    assert.deepEqual(a.requests, [], 'no model was asked');
    assert.deepEqual(written(a), before, 'nothing was written where a run writes');

    await settle(a.begin(input));
    await settle(b.begin(input));
    assert.deepEqual(a.requests, b.requests);
  } finally {
    a.dispose();
    b.dispose();
  }
});

test('a full preview is what a run records before the model, its digest is the run\'s, and it says which offers it compared', async () => {
  const c = world();
  try {
    // A pin, so that two steps assemble and the preview has to say what both did.
    c.pin(GLOBEX);
    const input = message(['py', 'go', 'nope'], { preferences: 'Remote.' });
    const made = await preview(c, 'full', input);
    const run = c.begin(input);
    const result = await settle(run);

    const byRef = (a: RecordEntry, b: RecordEntry) => a.ref.localeCompare(b.ref);
    assert.deepEqual([...(made.entries ?? [])].sort(byRef), c.entries(run).filter(isPrepared).sort(byRef));
    assert.equal(made.planDigest, planDigestOf(c.entries(run)));
    assert.deepEqual(made.offers, result.data.offers);
    assert.deepEqual(made.grounding, result.data.grounding);
    assert.deepEqual(made.degraded, result.degraded);
    assert.deepEqual(made.degraded, ['offers']);
  } finally {
    c.dispose();
  }
});

test('a preview of a message that names no offers says nothing of offers', async () => {
  const c = world();
  try {
    for (const input of [{ question: QUESTION }, message([])]) {
      const made = await preview(c, 'full', input);
      assert.equal('offers' in made, false);
      assert.equal(made.size.parts.offers, undefined);
    }
  } finally {
    c.dispose();
  }
});

test('a preview refuses what a run refuses, in the same words, and has no digest', async () => {
  const c = world();
  try {
    c.exclude('offers:py');
    for (const mode of ['fast', 'full'] as const) {
      const made = await preview(c, mode, message(['py', 'nope']));
      const run = await refusal(c.begin(message(['py', 'nope'])));
      assert.deepEqual(made.refusal, run);
      assert.equal(made.planDigest, undefined);
    }

    c.limitStore.set(CHAT, LEAST_LIMIT);
    const limited = await preview(c, 'fast', message(['go', 'py'], { preferences: 'p'.repeat(PREFERENCES_LIMIT) }));
    assert.equal(limited.refusal?.code, 'context_limit');
    assert.equal(limited.limit, LEAST_LIMIT);
  } finally {
    c.dispose();
  }
});

test('the digest moves with what the model is given and nothing else', async () => {
  const c = world();
  try {
    const digestOf = async (input: Record<string, unknown> = message(['py'])): Promise<string> => {
      const made = await preview(c, 'full', input);
      assert.ok(made.planDigest);
      return made.planDigest;
    };
    const start = await digestOf();
    assert.equal(await digestOf(), start, 'asked twice');

    // Nothing the model is not given moves it.
    c.saveOffer({ ...GO, text: 'Changed.', skills: ['Java'] });
    assert.equal(await digestOf(), start, 'an offer that was not named');
    c.saveOffer({ ...PY, lastSeenAt: 999 });
    assert.equal(await digestOf(), start, 'an offer seen again');
    c.s.deps.documents.update(CONTEXT, CV_KIND, (body) => {
      (body as typeof BODY).experience[2]!.highlights = ['Something else entirely.'];
      return body as never;
    });
    assert.equal(await digestOf(), start, 'a part of the CV no offer mentions');
    assert.equal(await digestOf(message(['py'], { cite: true })), start, 'whether the answer is asked to cite');

    // Whatever it is given does.
    const edited = await digestOf(message(['py'], { preferences: 'Remote.' }));
    assert.notEqual(edited, start, 'preferences');
    assert.notEqual(await digestOf(message(['py', 'go'])), start, 'another offer');
    assert.equal(await digestOf(message(['go', 'py'])), await digestOf(message(['py', 'go'])), 'the same offers, named in another order');

    c.saveOffer({ ...PY, text: `${PY.text} And more.` });
    const reworded = await digestOf();
    assert.notEqual(reworded, start, 'what the posting says');

    c.saveOffer({ ...PY, skills: ['Python'], text: `${PY.text} And more.` });
    assert.notEqual(await digestOf(), reworded, 'what the offer lists');

    c.s.deps.documents.update(CONTEXT, CV_KIND, (body) => {
      (body as typeof BODY).experience[0]!.highlights = ['Rewrote it all in Python.'];
      return body as never;
    });
    assert.notEqual(await digestOf(), reworded, 'a part of the CV the offer mentions');
  } finally {
    c.dispose();
  }
});

test('a preview says what was held back and what is gone for the pieces and the offers together, as a run does', async () => {
  const c = world();
  try {
    const nowhere = ref('experience/nowhere~none');
    c.exclude(ACME, 'offers:xl');
    const input = message(['py', 'xl', 'nope'], { once: [ACME, nowhere] });
    const made = await preview(c, 'full', input);
    const result = await settle(c.begin(input));
    const said = made.grounding as unknown as { blocked: string[]; gone: string[] };

    assert.deepEqual(said.blocked, [ACME, 'offers:xl']);
    assert.deepEqual(said.gone, [nowhere, 'offers:nope']);
    assert.deepEqual(made.grounding, result.data.grounding);
  } finally {
    c.dispose();
  }
});

/* ------------------------------------------------------------------- a wait */

/** A run that compares offers, waits for a person, and then says what it was given. */
const holding = (ids: readonly string[]): CapabilityMap => ({
  probe: noop('probe', [
    stage('fit', [fitStep({ offerIds: [...ids] })]),
    stage('ask', [
      transform('confirm', async (context) => {
        const decision = context.approvals.request({ key: 'go', kind: 'confirm', question: 'Go on?', payload: {} });
        return { went: decision.status };
      })
    ]),
    stage('after', [transform('after', async (context) => ({ text: (context.completed.fit?.[GROUNDED] as Grounded).text }))])
  ])
});

const parked = async (c: Chat) => {
  const run = c.begin({}, 'probe');
  await assert.rejects(run.settled, (error: unknown) => isRunSuspension(error));
  const [approval] = c.s.approvals.pending(run.runId);
  assert.ok(approval);
  c.s.approvals.decide(approval.id, { status: 'granted', decision: { confirmed: true }, decidedAt: Date.now() });
  return run;
};

const resume = (c: Chat, runId: string) => resumeRun(c.deps, { runId }) as Promise<{ data: Record<string, unknown> }>;

test('a run that waited, when the offers are as they were, is given the same, and one that changed elsewhere is not troubled', async () => {
  const c = world([PY, GO], { probes: holding(['py']) });
  try {
    const run = await parked(c);
    c.saveOffer({ ...GO, text: 'Changed.' });
    c.saveOffer({ ...PY, lastSeenAt: 900 });
    c.exclude('offers:go');

    const result = await resume(c, run.runId);
    assert.ok((result.data.text as string).startsWith(PY_CARD));
  } finally {
    c.dispose();
  }
});

test('a run that waited is not given an offer that changed while it waited, and says which', async () => {
  const c = world([PY], { probes: holding(['py']) });
  try {
    const run = await parked(c);
    c.saveOffer({ ...PY, salary: '30000 PLN' });

    await assert.rejects(resume(c, run.runId), (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'grounding_stale');
      assert.equal(
        (error as Error).message,
        'What this run was given is out of date: offers:py/card. Ask again to send it as it is now.'
      );
      return true;
    });
    assert.equal(c.s.runs.get(run.runId)?.status, 'failed');
  } finally {
    c.dispose();
  }
});

test('a run that waited is not given an offer that was left out while it waited', async () => {
  const c = world([PY], { probes: holding(['py']) });
  try {
    const run = await parked(c);
    c.exclude('offers:py');
    await assert.rejects(resume(c, run.runId), (error: unknown) => (error as { code?: string }).code === 'grounding_stale');
  } finally {
    c.dispose();
  }
});

test('a run that waited is still given an offer that has gone onto the Board since, as it was approved', async () => {
  const c = world([PY], { probes: holding(['py']) });
  try {
    const run = await parked(c);
    c.board.add('py');
    const result = await resume(c, run.runId);
    assert.ok((result.data.text as string).includes(PY_CARD));
  } finally {
    c.dispose();
  }
});

test('what is stale is told apart from what is current, entry by entry', () => {
  const { shelf } = shelfOf([PY, GO]);
  const context = { offers: shelf, walls: { pieces: () => [WHOLE('go')] } };
  const card = (at: OfferRecord, over: Partial<RecordEntry> = {}): RecordEntry => ({
    ref: `offers:${at.id}/card`,
    digest: cardDigests(at).digest,
    status: 'included',
    origin: 'server',
    via: 'ground:offer',
    ...over
  });

  assert.deepEqual(staleOffers(context, [card(PY)]), []);
  assert.deepEqual(staleOffers(context, [card(PY, { digest: 'f'.repeat(16) })]), ['offers:py/card'], 'a digest that is not the offer\'s now');
  assert.deepEqual(staleOffers(context, [card(GO)]), ['offers:go/card'], 'left out');
  assert.deepEqual(staleOffers(context, [card(offer('ghost'))]), ['offers:ghost/card'], 'not saved any more');
  assert.deepEqual(staleOffers(context, [card(PY, { status: 'blocked' }), card(GO, { status: 'read' })]), [], 'only what was sent is held to what it was');
  assert.deepEqual(staleOffers(context, [{ ...card(PY), ref: 'cv:ctx/experience/acme~senior-engineer' }]), [], 'only offers');
  assert.deepEqual(staleOffers({ walls: undefined, offers: undefined }, [card(PY)]), ['offers:py/card'], 'no shelf to say it is as it was');
  assert.deepEqual(staleOffers(context, []), []);
});

/* ------------------------------------------------------------ a real runtime */

/** A real runtime over a file, with a CV, a conversation about it, and saved offers. */
const runtime = () => {
  const s = scratch();
  const harness = createHarness({
    databasePath: s.path,
    logger: silentLogger,
    // No model is reachable, whatever this machine happens to run.
    env: { LOCAL_BASE_URL: 'http://127.0.0.1:9' },
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });
  const context = createCvContextStore(s.db).create(randomUUID(), 'en');
  harness.profile.replaceContext(context.id, BODY as never, 0);
  const profile = harness.conversations.create({ kind: 'profile', id: context.id });
  for (const each of [PY, GO, XL, RS]) harness.offers.save(each);

  const dispatch = createDispatch(harness);
  // The Board's own store, over the same file: what a Board entry is, without the preparation a harness would start.
  const board = createBoardStore(s.db, createOfferStore(s.db), () => new Map());

  return {
    s,
    harness,
    dispatch,
    context,
    profile,
    board,
    ask: (grounding: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
      contextId: context.id,
      conversationId: profile.id,
      capability: 'ask_profile',
      input: { question: QUESTION, grounding },
      ...over
    }),
    dispose: () => {
      harness.close();
      s.dispose();
    }
  };
};

test('in a real runtime the offers are the saved ones, the Board is the Board, and an entry that is archived is not on it', async () => {
  const w = runtime();
  try {
    w.board.add({ offerId: 'go', operationId: randomUUID() });
    const archived = w.board.add({ offerId: 'xl', operationId: randomUUID() });
    w.s.db
      .prepare("UPDATE board_entries SET body = json_set(body, '$.archived', json('true')) WHERE id = ?")
      .run(archived.id);

    const made = data<Preview>(await w.dispatch('run.preview', { ...w.ask({ offerIds: ['py', 'go', 'xl', 'nope'] }), mode: 'full' }));

    assert.deepEqual(made.offers, {
      compared: ['py', 'xl'],
      left: { excluded: [], missing: ['nope'], board: ['go'], cut: [] },
      preferences: 'absent'
    });
    assert.deepEqual(made.degraded, ['offers']);
    assert.deepEqual(made.grounding?.included.slice(0, 2), ['offers:py/card', 'offers:xl/card']);
    assert.equal((w.s.db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n, 0, 'a preview made no run');
  } finally {
    w.dispose();
  }
});

test('in a real runtime an offer the conversation left out is left out, by the selection the host made', async () => {
  const w = runtime();
  try {
    data(await w.dispatch('selection.update', { conversationId: w.profile.id, expectedRevision: 0, exclude: ['offers:py'] }));

    const made = data<Preview>(await w.dispatch('run.preview', { ...w.ask({ offerIds: ['py', 'go'] }), mode: 'full' }));
    assert.deepEqual(made.offers?.compared, ['go']);
    assert.deepEqual(made.offers?.left.excluded, ['py']);
    assert.deepEqual(made.grounding?.blocked, ['offers:py']);

    const only = data<Preview>(await w.dispatch('run.preview', { ...w.ask({ offerIds: ['py'] }), mode: 'fast' }));
    assert.equal(only.refusal?.code, 'needs_unmet');
    assert.match(only.refusal?.message ?? '', /1 is left out of this conversation/);
  } finally {
    w.dispose();
  }
});

test('in a real runtime a message about a saved offer, which has no selection to cut from, cannot compare offers', async () => {
  const w = runtime();
  try {
    const snapshot = w.harness.offerSnapshots.capture({
      id: randomUUID(),
      offerId: 'py',
      contextId: w.context.id,
      expectedRevision: 1,
      expectedContextRevision: 1,
      expectedPhotoRevision: 0
    });
    const asked = {
      contextId: w.context.id,
      conversationId: snapshot.conversationId,
      offerSnapshotId: snapshot.id,
      capability: 'ask_profile',
      input: { question: QUESTION, grounding: { offerIds: ['go'] } }
    };
    const made = data<Preview>(await w.dispatch('run.preview', { ...asked, mode: 'fast' }));
    assert.equal(made.refusal?.code, 'needs_unmet');
    assert.match(made.refusal?.message ?? '', /Offers can be compared only in a conversation about a CV/);
  } finally {
    w.dispose();
  }
});

/* ---------------------------------------------------------------- selection */

test('a profile conversation may leave out a whole saved offer, which is there or is gone, and nothing finer', async () => {
  const w = runtime();
  try {
    const update = async (change: Record<string, unknown>, expectedRevision: number) =>
      w.dispatch('selection.update', { conversationId: w.profile.id, expectedRevision, ...change });

    const view = data<{ revision: number; exclusions: { ref: string; state: string }[] }>(
      await update({ exclude: ['offers:py', 'offers:not-saved'] }, 0)
    );
    assert.deepEqual(
      view.exclusions.map((entry) => `${entry.ref} ${entry.state}`).sort(),
      ['offers:not-saved gone', 'offers:py live']
    );

    for (const finer of ['offers:py/card', 'offers:py/posting', 'offers:py@2']) {
      const refused = await update({ exclude: [finer] }, view.revision);
      assert.ok(!refused.ok, `accepted ${finer}`);
      assert.equal((refused.error as { code: string }).code, 'invalid_selection');
    }
  } finally {
    w.dispose();
  }
});

/* ------------------------------------------------------------------- the wire */

test('the runtime announces that it compares offers, once, and what it stands on is still announced', async () => {
  const w = runtime();
  try {
    const { features } = data<{ features: string[] }>(await w.dispatch('protocol.get', {}));
    assert.equal(features.filter((feature) => feature === 'grounding-offers').length, 1);
    for (const feature of ['grounding-record', 'grounding-selection', 'grounding-assembly', 'grounding-budget', 'grounding-preview']) {
      assert.ok(features.includes(feature), feature);
    }
  } finally {
    w.dispose();
  }
});
