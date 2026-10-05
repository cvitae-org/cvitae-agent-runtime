/**
 * What a discovery conversation excludes, and the discovery chat behind it.
 *
 * A discovery conversation excludes whole saved offers (`offers:<id>`). The walls
 * those exclusions become are tested where they bite in a CV conversation
 * (`grounding-walls.test.ts`, `grounding-history.test.ts`). This file asks the
 * same of the discovery chat, which keeps its own turns: an offer is cut out of
 * what a turn is accepted over, out of what its queries run over, out of what a
 * collection brings back, and an answer written while the offer was in is not
 * handed back to a model afterwards.
 *
 * The canary is a string that only an excluded offer holds. A test that says it
 * reached no payload scans every prompt the model was sent, and the same test
 * without the exclusion sees it, so a scan that cannot see is not what passes.
 *
 * In the order of the tests:
 *
 *   the scope         an excluded offer is not counted, retrieved or sent; with
 *                     nothing excluded a turn is what it was
 *   the history       an earlier answer built on the offer is not handed back, nor
 *                     one built on that, however far back; one it did not reach
 *                     stays; what is withheld stays in the conversation the person
 *                     reads, and comes back when the exclusion is cleared
 *   what is unknown   a message with no run, a run with no turn, a turn from before
 *                     turns were traced: withheld while anything is excluded
 *   the queries       the SQL a model plans runs over what is left, and the answer
 *                     and the artifact leave the offer out
 *   the collection    an offer a collection finds again stays out of the scope, and
 *                     one it collected is part of what the turn could have read
 *   the wiring        the same through the harness, over a database on disk,
 *                     across a restart
 *   the migration     a turn from before it reads as untraced
 *
 * Mutations run, not assumed. Each was applied alone, this file run, the failing
 * tests counted, and the mutation reverted. 36 were applied and every one broke
 * at least one test. The number is how many tests failed.
 *
 * Two edits were not counted. The size of the window an older turn is taken to
 * have been given cannot be told from one turn's worth: every later turn is given
 * the withheld one in turn, so the chain reaches them anyway. And the collection
 * port is handed the exclusions in `create.ts` by one arrow that only a turn that
 * collects from the boards runs, which needs a planning model; each side is tested
 * on its own (the store's `excluded`, the port's `excluded` argument).
 *
 * which turns an exclusion reaches (discovery-walls.ts):
 *   nothing excluded still withholds what is unknown 1
 *   an offer wall is read as every other           10
 *   an older turn is given no window               2
 *   an older turn that collected is known          1
 *   a turn that held the offer is not withheld     7
 *   a traced turn is read by the window            4
 *   a turn given a withheld one is not withheld    4
 *   a turn that names itself is handed over        1
 *   an older turn with no messages is read as given nothing 1
 *   a run with no turn is not withheld             1
 *   a turn whose messages are gone is not judged   1
 *   a message's run is not judged                  1
 *
 * the scope and the history of a turn (discovery-chat.ts):
 *   a turn is accepted over every offer            6
 *   an excluded offer is cut the wrong way round   9
 *   an excluded offer is cut from nothing          9
 *   nothing is withheld from the history           5
 *   the history is cut to six before it is withheld from 1
 *   a withheld turn's messages are handed back     5
 *   a message with no run is handed back           1
 *   a turn does not record what it was given       2
 *   what a turn was given is recorded newest first 2
 *   a new turn is not traced                       5
 *   the offers a turn cut are not recorded         1
 *   what the conversation excludes is not said     1
 *   the scope of a turn is not cut to what it was accepted over 1
 *   the scope of a turn is not cut to what is excluded now 1
 *   an offer a turn collected is not part of its membership 1
 *   an offer a turn collected is not placed after the others 1
 *
 * the queries and the collection:
 *   the query runs over the snapshot the host captured 3
 *   the query runs over the whole search           3
 *   a collection captures what it found again      1
 *   a snapshot keeps what it is told to leave out  1
 *
 * the harness:
 *   the harness reads no walls for a discovery conversation 1
 *   the harness does not narrow what a model queries 1
 *
 * the migration:
 *   a turn from before the migration reads as traced 1
 *
 * the history with nothing excluded:
 *   the history is cut of messages with no run when nothing is excluded 1
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import { emptyDiscoveryQuery } from '../src/contracts/discovery-query.js';
import type { DiscoveryAnswerContext, DiscoverySqlArtifact } from '../src/contracts/discovery-chat.js';
import type { DiscoveryBoardId, DiscoverySource } from '../src/contracts/discovery.js';
import type { DiscoveryChatRequest } from '../src/contracts/discovery-search.js';
import type { PieceRef } from '../src/contracts/index.js';
import { askDiscovery } from '../src/capabilities/askDiscovery.js';
import { askDiscoverySql } from '../src/capabilities/askDiscoverySql.js';
import { createAiGateway } from '../src/effects/ai.js';
import { parseRef } from '../src/grounding/index.js';
import { createHarness, silentLogger } from '../src/runtime/create.js';
import { createDiscoveryChatService } from '../src/runtime/discovery-chat.js';
import { bindDiscoveryScope } from '../src/runtime/discovery-scope.js';
import { createDiscoverySqlPort } from '../src/runtime/discovery-sql.js';
import { createDiscoveryService } from '../src/runtime/discovery.js';
import { createCollectionPort } from '../src/runtime/offer-collection.js';
import { createOfferQueryService } from '../src/runtime/offer-query.js';
import { beginRun } from '../src/runtime/run.js';
import { createConversationStore } from '../src/storage/sqlite/conversations.js';
import { createDiscoveryCatalogue } from '../src/storage/sqlite/discovery.js';
import { createDiscoveryChatStore } from '../src/storage/sqlite/discovery-chat.js';
import { createDiscoverySearchStore } from '../src/storage/sqlite/discovery-searches.js';
import { withheldRuns } from '../src/storage/sqlite/discovery-walls.js';
import { migrate, migrations } from '../src/storage/sqlite/migrate.js';
import { createOfferQueryStore } from '../src/storage/sqlite/offer-query-store.js';
import { createOfferStore } from '../src/storage/sqlite/offers.js';
import { open } from '../src/storage/sqlite/open.js';
import { scratch } from './support/db.js';
import { fakeResolver } from './support/models.js';
import { spine } from './support/spine.js';

/* ---------------------------------------------------------------- fixtures */

const CANARY = 'CANARY-7c41e0';
const FIRST = 'QUESTION-FIRST';
const SECOND = 'QUESTION-SECOND';
const THIRD = 'QUESTION-THIRD';
const ANSWER = 'ANSWER-MARKER';

const walled = (...ids: string[]): PieceRef[] => ids.map((id) => parseRef(`offers:${id}`));

type Offer = { id: string; text?: string; low?: number };

/** The legacy path, which asks over the members a turn was accepted with. */
const legacy = () => {
  const s = spine({});
  const offers = createOfferStore(s.db);
  const searches = createDiscoverySearchStore(s.db, offers);
  const conversations = createConversationStore(s.db);
  let walls: PieceRef[] = [];
  const store = createDiscoveryChatStore(s.db, conversations, Date.now, undefined, () => walls);
  const prompts: string[] = [];
  const model = fakeResolver({
    extractAnswer: JSON.stringify({ ...emptyDiscoveryQuery(), termGroups: [['React']] }),
    answer: `${ANSWER} [1].`,
    onCall: (prompt) => prompts.push(prompt)
  });
  const ai = createAiGateway({ resolver: model.resolver, logger: s.log });
  const handles: Promise<unknown>[] = [];
  const service = createDiscoveryChatService(store, (scope, signal, onText) => {
    const scoped = bindDiscoveryScope({ ...s.deps, effects: { ...s.deps.effects, ai } });
    const handle = beginRun(
      {
        ...scoped,
        capabilities: { ask_discovery: askDiscovery(scope, (captured, query) => store.retrieve(captured, query)) },
        deltas: (delta) => onText(delta.text),
        finish: (id, result, commit) => store.finish(id, result, commit)
      },
      { capability: 'ask_discovery', input: { question: scope.request.question }, runId: scope.request.runId, signal }
    );
    handles.push(handle.settled.catch(() => undefined));
    return handle;
  });

  searches.create('a', 'react', ['vacancies']);

  const f = {
    s,
    store,
    service,
    searches,
    prompts,
    model,
    /** Saves offers into the search. The text of each is what the model reads of it. */
    add(list: Offer[]) {
      for (const { id, text, low } of list) {
        offers.sight(
          [
            {
              id,
              position: 'React Engineer',
              company: `Company ${id}`,
              text: `React public description. ${text ?? ''}`,
              salary: `${low ?? 20000} PLN/month`,
              salaryReading: { min: low ?? 20000, max: (low ?? 20000) + 5000, currency: 'PLN', period: 'month' }
            }
          ],
          1
        );
      }
      searches.add('a', list.map(({ id }) => ({ offer: offers.get(id)! })));
    },
    exclude(...ids: string[]) {
      walls = walled(...ids);
    },
    request(runId: string, question: string, filtered = false): DiscoveryChatRequest {
      return {
        searchId: 'a',
        conversationId: service.get('a').conversationId,
        runId,
        question,
        scope: filtered ? 'filtered' : 'all',
        filterRevision: filtered ? 1 : 0,
        language: 'en'
      };
    },
    async ask(runId: string, question: string, filtered = false) {
      const before = prompts.length;
      service.send(f.request(runId, question, filtered));
      await Promise.all(handles);
      return prompts.slice(before).join('\n');
    },
    context: (runId: string): DiscoveryAnswerContext =>
      JSON.parse((s.db.prepare('SELECT evidence FROM discovery_chat_turns WHERE run_id=?').get(runId) as { evidence: string }).evidence),
    members: (runId: string) =>
      (s.db.prepare('SELECT offer_id FROM discovery_turn_members WHERE run_id=? ORDER BY offer_id').all(runId) as { offer_id: string }[]).map(
        (row) => row.offer_id
      ),
    held: () => [...withheldRuns(s.db, service.get('a').conversationId, walls)].sort(),
    close() {
      service.close();
      s.dispose();
    }
  };

  return f;
};

type Legacy = ReturnType<typeof legacy>;

/** The production path: the model plans SQL, and it runs over a captured snapshot. */
const planned = () => {
  const s = spine({});
  const offers = createOfferStore(s.db);
  const searches = createDiscoverySearchStore(s.db, offers);
  const queries = createOfferQueryStore(s.db);
  const service = createOfferQueryService(queries);
  let walls: PieceRef[] = [];
  const store = createDiscoveryChatStore(s.db, createConversationStore(s.db), Date.now, queries, () => walls);
  const prompts: string[] = [];
  const sql = 'SELECT o.offer_id,o.role FROM offers o ORDER BY o.offer_id';
  const model = fakeResolver({
    extractAnswer: JSON.stringify({ sql, params: [], clarification: null, extraction: null }),
    answer: 'Published role [1].',
    onCall: (prompt) => prompts.push(prompt)
  });
  const ai = createAiGateway({ resolver: model.resolver, logger: s.log });
  const handles: Promise<unknown>[] = [];
  const chat = createDiscoveryChatService(store, (scope, signal) => {
    const handle = beginRun(
      {
        ...bindDiscoveryScope({ ...s.deps, effects: { ...s.deps.effects, ai } }),
        timeoutMs: 10000,
        capabilities: { ask_discovery: askDiscoverySql(scope, createDiscoverySqlPort(service, queries, store.recordSql, undefined, undefined, store.scope)) },
        finish: (id, result, commit) => store.finish(id, result, commit)
      },
      { capability: 'ask_discovery', input: { question: scope.request.question }, runId: scope.request.runId, signal }
    );
    handles.push(handle.settled.catch(() => undefined));
    return handle;
  });

  searches.create('s', 'React', ['vacancies']);
  for (let i = 0; i < 3; i += 1) {
    offers.sight([{ id: `o${i}`, position: 'Fallback', text: 'Description.' }], 1);
    searches.add('s', [{ offer: offers.get(`o${i}`)!, listing: { url: 'https://example.test/job', title: 'Published', titleSource: 'board', board: 'vacancies' } }]);
  }
  // What the model is shown of an offer is what it states: the canary is in the title of o0.
  for (const row of s.db.prepare('SELECT id,value FROM discovery_offer_evidence').all() as { id: string; value: string }[]) {
    const evidence = JSON.parse(row.value);
    evidence.offer.stated = { title: evidence.offer.id === 'o0' ? `Published ${CANARY}` : 'Published React' };
    s.db.prepare('UPDATE discovery_offer_evidence SET value=? WHERE id=?').run(JSON.stringify(evidence), row.id);
  }

  const request = async (runId: string, question = 'Find roles'): Promise<DiscoveryChatRequest> => {
    const captured = await service.context('s', { kind: 'search', searchId: 's' });
    return {
      version: 2,
      searchId: 's',
      conversationId: chat.get('s').conversationId,
      runId,
      question,
      scope: 'all',
      filterRevision: 0,
      language: 'en',
      snapshotId: captured.snapshotId,
      scopeRevision: captured.scopeRevision!
    };
  };

  return {
    s,
    offers,
    searches,
    queries,
    service,
    store,
    chat,
    prompts,
    model,
    exclude(...ids: string[]) {
      walls = walled(...ids);
    },
    held: (...ids: string[]) => [...withheldRuns(s.db, chat.get('s').conversationId, walled(...ids))].sort(),
    request,
    /** Sends a turn, waits for it, and says what the model was sent while it ran. */
    async ask(runId: string, question?: string) {
      const before = prompts.length;
      const sent = await request(runId, question);
      chat.send(sent);
      await Promise.all(handles);
      return { request: sent, prompts: prompts.slice(before).join('\n') };
    },
    artifact: () => (chat.get('s').messages.at(-1) as unknown as { queryArtifact: DiscoverySqlArtifact }).queryArtifact,
    close() {
      chat.close();
      service.close();
      s.dispose();
    }
  };
};

const sealed = async (f: Legacy | ReturnType<typeof planned>, work: () => Promise<void>) => {
  try {
    await work();
  } finally {
    f.close();
  }
};

/* ---------------------------------------------------------------- the scope */

test('an excluded offer is not counted, retrieved or sent to the model; with nothing excluded a turn is what it was', async () => {
  const f = legacy();

  await sealed(f, async () => {
    f.add([{ id: 'one' }, { id: 'two', text: CANARY }]);

    const whole = await f.ask('open', FIRST);
    assert.ok(whole.includes(CANARY), 'the scan cannot see the canary, so it proves nothing');
    assert.equal(f.context('open').scopeCount, 2);
    assert.deepEqual(f.members('open'), ['one', 'two']);
    assert.equal(f.context('open').withheldOffers, undefined);
    assert.deepEqual(f.context('open').evidence.map((each) => each.reference.offerId).sort(), ['one', 'two']);

    assert.deepEqual([...f.store.excluded('a')], []);
    f.exclude('two');
    assert.deepEqual([...f.store.excluded('a')], ['two']);
    const cut = await f.ask('closed', SECOND);
    assert.ok(!cut.includes(CANARY), 'the canary reached the model');
    assert.equal(f.context('closed').scopeCount, 1);
    assert.deepEqual(f.members('closed'), ['one']);
    assert.deepEqual(f.context('closed').evidence.map((each) => each.reference.offerId), ['one']);
    // The earlier turn is a record of what it was accepted over, and stays so.
    assert.deepEqual(f.members('open'), ['one', 'two']);
  });
});

test('an exclusion that names offers outside the search changes nothing', async () => {
  const f = legacy();

  await sealed(f, async () => {
    f.add([{ id: 'one' }, { id: 'two', text: CANARY }]);
    f.exclude('elsewhere');

    const sent = await f.ask('r', FIRST);
    assert.ok(sent.includes(CANARY));
    assert.equal(f.context('r').scopeCount, 2);
    assert.deepEqual(f.members('r'), ['one', 'two']);
  });
});

/* -------------------------------------------------------------- the history */

test('an answer written before the exclusion is not handed back, and stays in the conversation', async () => {
  const f = legacy();

  await sealed(f, async () => {
    f.add([{ id: 'one' }, { id: 'two', text: CANARY }]);

    await f.ask('first', FIRST);
    const kept = await f.ask('second', SECOND);
    assert.ok(kept.includes(FIRST), 'with nothing excluded the history is given');
    assert.ok(kept.includes(ANSWER));

    f.exclude('two');
    const cut = await f.ask('third', THIRD);
    assert.ok(!cut.includes(FIRST) && !cut.includes(SECOND), 'an answer built on the offer was handed back');
    assert.ok(!cut.includes(ANSWER));
    assert.ok(!cut.includes(CANARY));
    assert.deepEqual(f.context('third').history, []);
    assert.deepEqual(f.context('third').previousReferences, []);
    assert.deepEqual(f.context('third').historyRuns, []);

    // The person still reads all of it.
    assert.deepEqual(
      f.service.get('a').messages.filter((message) => message.role === 'user').map((message) => message.text),
      [FIRST, SECOND, THIRD]
    );
    assert.equal(f.service.get('a').messages.length, 6);
    assert.deepEqual(f.held(), ['first', 'second']);

    // And it comes back with the exclusion cleared.
    f.exclude();
    assert.deepEqual(f.held(), []);
    const back = await f.ask('fourth', 'QUESTION-FOURTH');
    assert.ok(back.includes(FIRST) && back.includes(THIRD));
  });
});

test('an answer built on a withheld one is withheld however far back, and one the exclusion did not reach stays', async () => {
  const f = legacy();

  await sealed(f, async () => {
    f.add([{ id: 'one' }, { id: 'two', text: CANARY, low: 5000 }]);

    // Over both offers, then over what a filter leaves: the offer is in the first scope only.
    await f.ask('first', FIRST);
    f.searches.filters('a', { minimum: 20000 }, 0);
    await f.ask('second', SECOND, true);
    await f.ask('third', THIRD, true);
    assert.deepEqual(f.members('second'), ['one']);
    assert.deepEqual(f.context('second').historyRuns, ['first']);
    assert.deepEqual(f.context('third').historyRuns, ['first', 'second']);

    f.exclude('two');
    // Not one of them names the offer after the first, and the second and third are withheld all the same.
    assert.deepEqual(f.held(), ['first', 'second', 'third']);

    const sent = await f.ask('fourth', 'QUESTION-FOURTH', true);
    for (const marker of [FIRST, SECOND, THIRD, ANSWER]) assert.ok(!sent.includes(marker), `${marker} reached the model`);
    assert.deepEqual(f.context('fourth').historyRuns, []);

    // A turn that was given nothing withheld is not withheld, and the taint does not run on for ever.
    const fifth = await f.ask('fifth', 'QUESTION-FIFTH', true);
    assert.ok(fifth.includes('QUESTION-FOURTH'), 'a clean turn was held back');
    assert.deepEqual(f.held(), ['first', 'second', 'third']);
  });
});

test('an exclusion reaches only the turns that held the offer, and the turns given them', async () => {
  const f = legacy();

  await sealed(f, async () => {
    f.add([{ id: 'one' }, { id: 'two' }]);
    await f.ask('first', FIRST);
    f.add([{ id: 'three', text: CANARY }]);
    // More turns that hold the offer than the model is ever given of a conversation.
    await f.ask('second', SECOND);
    await f.ask('second-b', 'QUESTION-SECOND-B');
    await f.ask('second-c', 'QUESTION-SECOND-C');
    await f.ask('second-d', 'QUESTION-SECOND-D');

    f.exclude('three');
    assert.deepEqual(f.held(), ['second', 'second-b', 'second-c', 'second-d']);
    assert.deepEqual(f.members('first'), ['one', 'two']);
    assert.deepEqual(f.members('second'), ['one', 'three', 'two']);

    const sent = await f.ask('third', THIRD);
    assert.ok(sent.includes(FIRST), 'a turn that never held the offer was held back');
    assert.ok(!sent.includes(SECOND) && !sent.includes(CANARY));
    assert.deepEqual(f.context('third').historyRuns, ['first']);
  });
});

test('what an exclusion reaches in an aggregate is the scope it was computed over, not the offers it names', async () => {
  const f = legacy();

  await sealed(f, async () => {
    f.add([{ id: 'one' }, { id: 'two', text: CANARY }]);
    await f.ask('first', FIRST);

    // The answer names no offer but "one"; the scope it was computed over had "two" in it.
    f.s.db.prepare("UPDATE messages SET text = 'Both pay the same.' WHERE run_id = 'first' AND role = 'assistant'").run();
    f.exclude('two');
    assert.deepEqual(f.held(), ['first']);
  });
});

/* ------------------------------------------------------------ what is unknown */

test('a message that belongs to no run is withheld while anything is excluded, and so is the turn given it', async () => {
  const f = legacy();

  await sealed(f, async () => {
    f.add([{ id: 'one' }, { id: 'two' }]);
    await f.ask('first', FIRST);
    await f.ask('second', SECOND);

    // The run behind the first answer is gone, as when it is deleted: its messages have none.
    f.s.db.prepare("UPDATE messages SET run_id = NULL WHERE run_id = 'first'").run();
    assert.deepEqual(f.held(), [], 'nothing is excluded, so nothing is withheld');

    // The next turn is given it, since nothing is excluded to say it should not be.
    await f.ask('third', THIRD);
    assert.deepEqual(f.context('third').historyRuns, [null, 'second']);

    f.exclude('elsewhere');
    assert.deepEqual(f.held(), ['third']);

    // And what is given with something excluded leaves it out, and what has no run with it.
    const sent = await f.ask('fourth', 'QUESTION-FOURTH');
    assert.ok(!sent.includes(FIRST), 'a message with no run was handed back');
    assert.ok(!sent.includes(THIRD), 'a turn given it was handed back');
    assert.ok(sent.includes(SECOND));
    assert.deepEqual(f.context('fourth').historyRuns, ['second']);
    assert.deepEqual(f.held(), ['third']);
  });
});

test('a run with no turn is withheld, and a turn from before turns were traced is judged by what was before it', async () => {
  const f = legacy();

  await sealed(f, async () => {
    f.add([{ id: 'one' }, { id: 'two' }]);
    await f.ask('first', FIRST);
    await f.ask('second', SECOND);
    await f.ask('third', THIRD);
    f.exclude('elsewhere');
    assert.deepEqual(f.held(), []);

    // Turns made before turns were traced did not write down what they were given.
    f.s.db.prepare("UPDATE discovery_chat_turns SET traced = 0 WHERE run_id IN ('first','second','third')").run();
    assert.deepEqual(f.held(), [], 'an older turn that was given nothing withheld is withheld');

    // One that collected offers did not write them down: unknown, and so is whatever was given it.
    f.s.db.prepare("UPDATE discovery_chat_turns SET evidence = json_set(evidence, '$.collection', json('{}')) WHERE run_id = 'second'").run();
    assert.deepEqual(f.held(), ['second', 'third']);

    // A run whose turn is gone.
    f.s.db.prepare("DELETE FROM discovery_chat_turns WHERE run_id = 'first'").run();
    assert.deepEqual(f.held(), ['first', 'second', 'third']);

    // None of it matters while nothing is excluded.
    f.exclude();
    assert.deepEqual(f.held(), []);
  });
});

test('a turn that names itself as what it was given, and an older turn whose messages are gone, are withheld', async () => {
  const f = legacy();

  await sealed(f, async () => {
    f.add([{ id: 'one' }, { id: 'two' }]);
    await f.ask('first', FIRST);
    await f.ask('second', SECOND);
    f.exclude('elsewhere');
    assert.deepEqual(f.held(), []);

    f.s.db.prepare("UPDATE discovery_chat_turns SET evidence = json_set(evidence, '$.historyRuns', json('[\"second\"]')) WHERE run_id = 'second'").run();
    assert.deepEqual(f.held(), ['second']);

    f.s.db.prepare("UPDATE discovery_chat_turns SET evidence = json_set(evidence, '$.historyRuns', json('[]')) WHERE run_id = 'second'").run();
    assert.deepEqual(f.held(), []);

    // An older turn does not say what it was given, and with its messages gone there is no window to read.
    f.s.db.prepare("UPDATE discovery_chat_turns SET traced = 0 WHERE run_id = 'first'").run();
    f.s.db.prepare("DELETE FROM messages WHERE run_id = 'first'").run();
    assert.deepEqual(f.held(), ['first']);
  });
});

test('an older turn is judged by what came before it, not after', async () => {
  const f = legacy();

  await sealed(f, async () => {
    f.add([{ id: 'one' }, { id: 'two' }]);
    for (const run of ['a', 'b', 'c', 'd']) await f.ask(run, `QUESTION-${run}`);
    f.s.db.prepare('UPDATE discovery_chat_turns SET traced = 0').run();
    // The offer was in the scope of "c" only.
    f.s.db.prepare("DELETE FROM discovery_turn_members WHERE offer_id = 'two' AND run_id <> 'c'").run();
    f.exclude('two');

    assert.deepEqual(f.held(), ['c', 'd']);
  });
});

/* ---------------------------------------------------------------- the queries */

test('the SQL a model plans runs over what is left, and neither the answer nor the artifact has the offer', async () => {
  const f = planned();

  await sealed(f, async () => {
    const whole = await f.ask('open');
    assert.ok(whole.prompts.includes(CANARY), 'the scan cannot see the canary, so it proves nothing');
    assert.deepEqual(f.artifact().rows.map((row) => row[0]), ['o0', 'o1', 'o2']);

    f.exclude('o0');
    const cut = await f.ask('closed');
    assert.ok(!cut.prompts.includes(CANARY), 'the canary reached the model');

    const artifact = f.artifact();
    assert.deepEqual(artifact.rows.map((row) => row[0]), ['o1', 'o2']);
    assert.ok(!JSON.stringify(artifact).includes(CANARY));
    // The snapshot the model queried is not the one the host captured, and holds what is left.
    assert.notEqual(artifact.snapshotId, cut.request.snapshotId);
    assert.deepEqual(f.queries.members('s', artifact.snapshotId).map((member) => member.offer_id), ['o1', 'o2']);

    const turn = f.s.db.prepare('SELECT scope_count AS n, evidence FROM discovery_chat_turns WHERE run_id = ?').get('closed') as { n: number; evidence: string };
    assert.equal(turn.n, 2);
    assert.equal(JSON.parse(turn.evidence).withheldOffers, 1);
    assert.deepEqual(
      (f.s.db.prepare('SELECT offer_id FROM discovery_turn_members WHERE run_id = ? ORDER BY offer_id').all('closed') as { offer_id: string }[]).map((row) => row.offer_id),
      ['o1', 'o2']
    );

    // What a turn may query is what it was accepted over, less what is excluded by then.
    const accepted = JSON.parse(turn.evidence) as DiscoveryAnswerContext;
    const context = { ...accepted, queryContext: { ...accepted.queryContext!, snapshotId: cut.request.snapshotId!, scopeRevision: cut.request.scopeRevision! } };
    assert.deepEqual(f.queries.members('s', context.queryContext.snapshotId).map((member) => member.offer_id), ['o0', 'o1', 'o2']);
    const scope = () => f.store.scope(context).map((member) => member.offer_id);
    assert.deepEqual(scope(), ['o1', 'o2']);
    f.exclude();
    assert.deepEqual(scope(), ['o1', 'o2'], 'an offer cut when the turn was accepted came back');
    f.exclude('o1');
    assert.deepEqual(scope(), ['o2'], 'an offer excluded since the turn was accepted stayed in');
  });
});

test('a count counts what is left, and with nothing excluded it is the snapshot the host captured', async () => {
  const f = planned();

  await sealed(f, async () => {
    const counted = async (runId: string) => {
      const sent = await f.ask(runId, 'How many offers?');
      const answer = f.chat.get('s').messages.at(-1) as unknown as { text: string; queryArtifact: DiscoverySqlArtifact };
      return { ...sent, answer };
    };

    const all = await counted('c1');
    assert.match(all.answer.text, /3 saved/);
    assert.equal(all.answer.queryArtifact.snapshotId, all.request.snapshotId);

    f.exclude('o1', 'o2');
    const some = await counted('c2');
    assert.match(some.answer.text, /1 saved/);
    assert.notEqual(some.answer.queryArtifact.snapshotId, some.request.snapshotId);

    f.exclude();
    assert.match((await counted('c3')).answer.text, /3 saved/);
  });
});

/* ------------------------------------------------------------- the collection */

const batch = (q: Parameters<DiscoverySource['search']>[0]) => ({
  status: 'ok' as const,
  data: {
    version: 1 as const,
    board: q.board,
    items: [0, 1].map((i) => ({ board: q.board, url: `https://vacancies.example/offers/${q.board}-${i}`, title: 'React engineer', titleSource: 'board' as const })),
    nextCursor: null,
    hasMore: false,
    coverage: 'sitemap' as const,
    retrievedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    effectiveFilters: [],
    unsupportedFilters: [],
    limitations: []
  }
});

const collected = (excluded?: (searchId: string) => ReadonlySet<string>) => {
  const s = spine({});
  const offers = createOfferStore(s.db);
  const searches = createDiscoverySearchStore(s.db, offers);
  const queries = createOfferQueryStore(s.db);
  searches.create('s', 'Original phrase', ['vacancies' as DiscoveryBoardId]);
  const discovery = createDiscoveryService(
    createDiscoveryCatalogue(s.db, offers),
    { boards: async () => ({ version: 1, boards: [] }), search: async (q) => batch(q) },
    Date.now,
    searches
  );
  const port = createCollectionPort(discovery, searches, queries, async () => undefined, { searchMs: 2000, detailsMs: 1000 }, excluded);
  const context = async (): Promise<DiscoveryAnswerContext> => {
    const scope = { kind: 'search' as const, searchId: 's' };
    const snapshot = await queries.capture('s', scope, new AbortController().signal);
    return {
      request: { version: 2, collection: true, runId: 'r', searchId: 's', conversationId: 'c', question: 'Find new React offers', scope: 'all', filterRevision: 0, language: 'en' },
      queryContext: { scope, snapshotId: snapshot.id, scopeRevision: snapshot.fingerprint! },
      scopeCount: 0,
      revision: 1,
      evidence: [],
      history: []
    };
  };

  return { s, queries, port, context, close: () => { discovery.close(); s.dispose(); } };
};

test('an offer a collection finds again stays out of the scope it captures', async () => {
  const first = collected();
  let ids: string[] = [];

  try {
    const result = await first.port.run(await first.context(), 'React', new AbortController().signal, () => {});
    ids = first.queries.members('s', result.queryContext!.snapshotId).map((member) => member.offer_id);
    assert.equal(ids.length, 2);
    assert.equal(result.scopeCount, 2);
  } finally {
    first.close();
  }

  const second = collected((searchId) => new Set(searchId === 's' ? [ids[0]!] : []));

  try {
    const result = await second.port.run(await second.context(), 'React', new AbortController().signal, () => {});
    const held = second.queries.members('s', result.queryContext!.snapshotId).map((member) => member.offer_id);
    assert.equal(held.length, 1);
    assert.ok(!held.includes(ids[0]!), 'the excluded offer is in the scope the collection captured');
    assert.equal(result.scopeCount, 1);
  } finally {
    second.close();
  }

  // A conversation that excludes another search's offer is not affected.
  const third = collected(() => new Set());

  try {
    const result = await third.port.run(await third.context(), 'React', new AbortController().signal, () => {});
    assert.equal(result.scopeCount, 2);
  } finally {
    third.close();
  }
});

test('an offer a turn collected is part of what the turn could have read, so excluding it later withholds the turn', async () => {
  const f = planned();

  await sealed(f, async () => {
    await f.ask('first');
    assert.deepEqual(f.held('o9'), [], 'nothing is withheld for an offer no turn held');

    // A collection that went on to bring an offer into the search: the turn's context is the snapshot taken after.
    f.offers.sight([{ id: 'o9', position: 'Fallback', text: 'Description.' }], 2);
    f.searches.add('s', [{ offer: f.offers.get('o9')!, listing: { url: 'https://example.test/job', title: 'Published', titleSource: 'board', board: 'vacancies' } }]);
    const scope = { kind: 'search' as const, searchId: 's' };
    const snapshot = await f.queries.capture('s', scope, new AbortController().signal);
    const stored = (f.s.db.prepare('SELECT evidence FROM discovery_chat_turns WHERE run_id = ?').get('first') as { evidence: string }).evidence;
    const context = JSON.parse(stored) as DiscoveryAnswerContext;
    f.store.recordSql({
      ...context,
      collection: { status: 'complete' } as DiscoveryAnswerContext['collection'],
      queryContext: { scope, snapshotId: snapshot.id, scopeRevision: snapshot.fingerprint! }
    });

    const members = (f.s.db.prepare('SELECT offer_id FROM discovery_turn_members WHERE run_id = ? ORDER BY ordinal').all('first') as { offer_id: string }[]).map((row) => row.offer_id);
    assert.deepEqual(members, ['o0', 'o1', 'o2', 'o9']);
    assert.deepEqual(f.held('o9'), ['first']);
    assert.deepEqual(f.held('o1'), ['first']);
    assert.deepEqual(f.held('elsewhere'), []);
  });
});

/* ------------------------------------------------------------------- the wiring */

const start = (path: string) =>
  createHarness({
    databasePath: path,
    capabilities: {},
    logger: silentLogger,
    env: {},
    probe: () => Promise.reject(new Error('no local server in these tests'))
  });

test('through the harness an exclusion changes what a turn counts, and holds across a restart', async () => {
  const s = scratch();
  const offers = createOfferStore(s.db);
  const searches = createDiscoverySearchStore(s.db, offers);
  searches.create('s', 'React', ['vacancies']);
  for (let i = 0; i < 3; i += 1) {
    offers.sight([{ id: `o${i}`, position: 'Fallback', text: 'Description.' }], 1);
    searches.add('s', [{ offer: offers.get(`o${i}`)!, listing: { url: 'https://example.test/job', title: 'Published', titleSource: 'board', board: 'vacancies' } }]);
  }

  let harness = start(s.path);
  let dispatch = createDispatch(harness);

  try {
    const conversationId = harness.discoveryChat.get('s').conversationId;
    let answered = 0;
    const count = async (runId: string) => {
      const captured = await harness.offerQueries.context('s', { kind: 'search', searchId: 's' });
      const sent = await dispatch('discovery.chat.start', {
        version: 2,
        searchId: 's',
        conversationId,
        runId,
        question: 'How many offers?',
        scope: 'all',
        filterRevision: 0,
        language: 'en',
        snapshotId: captured.snapshotId,
        scopeRevision: captured.scopeRevision
      });
      assert.ok(sent.ok, JSON.stringify(sent));
      answered += 1;
      const answers = () => harness.discoveryChat.get('s').messages.filter((message) => message.role === 'assistant');
      for (let i = 0; i < 300 && answers().length < answered; i += 1) await delay(10);
      assert.equal(answers().length, answered, `${runId} was not answered`);
      return answers().at(-1)!.text;
    };

    assert.match(await count('c1'), /3 saved/);

    const excluded = await dispatch('selection.update', { conversationId, expectedRevision: 0, exclude: ['offers:o0'] });
    assert.ok(excluded.ok, JSON.stringify(excluded));
    assert.match(await count('c2'), /2 saved/);

    const turn = s.db.prepare('SELECT scope_count AS n, evidence FROM discovery_chat_turns WHERE run_id = ?').get('c2') as { n: number; evidence: string };
    assert.equal(turn.n, 2);
    assert.equal(JSON.parse(turn.evidence).withheldOffers, 1);
    assert.deepEqual(
      (s.db.prepare('SELECT offer_id FROM discovery_turn_members WHERE run_id = ? ORDER BY offer_id').all('c2') as { offer_id: string }[]).map((row) => row.offer_id),
      ['o1', 'o2']
    );

    harness.close();
    harness = start(s.path);
    dispatch = createDispatch(harness);
    assert.match(await count('c3'), /2 saved/);

    const cleared = await dispatch('selection.update', { conversationId, expectedRevision: 1, clear: ['offers:o0'] });
    assert.ok(cleared.ok, JSON.stringify(cleared));
    assert.match(await count('c4'), /3 saved/);
  } finally {
    harness.close();
    s.dispose();
  }
});

/* ---------------------------------------------------------------- the migration */

test('the migration reads a turn from before it as untraced, and one made after as traced', () => {
  const db = open(':memory:');

  try {
    migrate(db, migrations.filter((step) => step.version <= 41));
    const offers = createOfferStore(db);
    const searches = createDiscoverySearchStore(db, offers);
    const conversations = createConversationStore(db);
    searches.create('old', 'React', ['vacancies']);
    const conversation = conversations.open({ kind: 'discovery', id: 'old' });
    db.prepare('INSERT INTO discovery_chat_turns(run_id,search_id,conversation_id,request,created_at) VALUES(?,?,?,?,?)').run('r', 'old', conversation.id, '{}', 1);

    migrate(db);

    assert.deepEqual(db.prepare('SELECT traced FROM discovery_chat_turns WHERE run_id = ?').get('r'), { traced: 0 });
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});
