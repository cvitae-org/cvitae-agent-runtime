import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCapture } from '@cvitae/job-pages';
import { createHarness } from '../src/runtime/create.js';
import { createDispatch } from '../src/adapters/ipc/dispatch.js';
import type { ImportReceipt } from '../src/storage/sqlite/browser-imports.js';

const setup = (databasePath = ':memory:') => createHarness({ databasePath, env: {}, scraperUrl: '' });
const child = (id: string, boardId = 'bulldogjob', mode = 'browser') => ({ id, boardId, mode, label: boardId });
const group = (h: ReturnType<typeof setup>, id: string, phrase = 'React', boardId = 'bulldogjob') =>
  h.discoverySearches.createBatch({ phrase, children: [child(id, boardId)] });
const base = 'https://bulldogjob.pl/companies/jobs';
const capture = (title = 'React engineer', n = 1) => validateCapture({ version: 1, url: base, title: 'Jobs', kind: 'listing',
  items: [{ board: 'bulldogjob', external_id: String(n), url: `${base}/${n}-role`, title, completeness: 'listing' }] });
const target = { tabId: 1, documentId: 'document', url: base };
const preview = (h: ReturnType<typeof setup>, id: string, session = 'studio:one', value = capture()) =>
  h.browser.dispatch(session, 'capture.preview', { capture: value, target }, id) as { captureId: string; targetSearchId: string };
const request = (captureId: string) => ({ captureId, operationId: randomUUID(), selected: [0], target });

test('batch creation is atomic and idempotent, preserves legacy searches, and advertises its capability', async () => {
  const h = setup();
  try {
    const dispatch = createDispatch(h);
    const input = { phrase: 'React', children: [child('one'), child('two', 'justjoin', 'automatic')] };
    const first = h.discoverySearches.createBatch(input);
    assert.deepEqual(first, h.discoverySearches.createBatch(input));
    assert.deepEqual(first.items.map(s => s.boards), [['bulldogjob'], ['justjoin']]);
    assert.equal(first.items[0]!.boardThread!.mode, 'browser');
    assert.equal(first.items[1]!.sourceMode, 'live');
    assert.throws(() => h.discoverySearches.createBatch({ phrase: 'Angular', children: [child('new'), child('two', 'justjoin', 'automatic')] }), /another query/);
    assert.throws(() => h.discoverySearches.get('new'), /does not exist/);
    assert.throws(() => h.discoverySearches.createBatch({ phrase: 'React', children: [child('dup'), child('dup', 'justjoin')] }));
    h.discoverySearches.create('legacy', 'Old', ['justjoin', 'pracuj']);
    assert.equal(h.discoverySearches.get('legacy').boardThread, undefined);
    assert.equal(h.discoverySearches.get('legacy').boards.length, 2);
    h.discoverySearches.delete('one');
    assert.throws(() => h.discoverySearches.createBatch(input), /deleted/);
    assert.match(JSON.stringify(await dispatch('protocol.get', {})), /discovery-board-threads-v1/);
    const blocked = await dispatch('discovery.start', { keyword: 'React', boards: ['bulldogjob'], searchId: 'two-browser', schemaVersion: 2 });
    assert.ok(blocked); // Normal availability errors remain handled by the dispatch envelope.
    group(h, 'browser');
    const browser = await dispatch('discovery.start', { keyword: 'React', boards: ['bulldogjob'], searchId: 'browser', schemaVersion: 2 });
    assert.match(JSON.stringify(browser), /browser_capture_required/);
  } finally { h.close(); }
});

test('captures are scoped to immutable destinations and saved keyword rules; generic imports remain separate', () => {
  const h = setup();
  try {
    group(h, 'react'); group(h, 'angular', 'Angular');
    const p = preview(h, 'react');
    assert.equal(p.targetSearchId, 'react');
    const commit = request(p.captureId);
    assert.throws(() => h.browser.dispatch('studio:one', 'import.commit', commit, 'angular'), /destination changed/);
    const receipt = h.browser.dispatch('studio:one', 'import.commit', commit, 'react') as ImportReceipt;
    assert.equal(receipt.collectionId, 'react');
    assert.equal(receipt.targetSearchId, 'react');
    assert.equal(h.discoverySearches.get('react').count, 1);
    assert.equal(h.discoverySearches.get('angular').count, 0);
    assert.equal(h.browser.store.collection(), null);
    assert.deepEqual(h.browser.dispatch('studio:one', 'import.commit', commit, 'react'), receipt);
    assert.throws(() => h.browser.dispatch('studio:one', 'import.commit', commit, 'angular'), /different import/);
    const excluded = preview(h, 'angular', 'studio:two');
    h.browser.dispatch('studio:two', 'import.commit', request(excluded.captureId), 'angular');
    assert.equal(h.discoverySearches.get('angular').count, 0);
    const generic = h.browser.dispatch('extension', 'capture.preview', { capture: capture(), target }) as { captureId: string };
    h.browser.dispatch('extension', 'import.commit', request(generic.captureId));
    assert.equal(h.browser.store.collection()!.count, 1);
    assert.notEqual(h.browser.store.collection()!.id, 'react');
  } finally { h.close(); }
});

test('wrong-board and deleted destinations fail atomically, and unknown dates go to review', () => {
  const h = setup();
  try {
    group(h, 'wrong', 'React', 'justjoin');
    const wrong = preview(h, 'wrong');
    assert.throws(() => h.browser.dispatch('studio:one', 'import.commit', request(wrong.captureId), 'wrong'), /destination search board/);
    assert.equal(h.discoverySearches.get('wrong').count, 0);
    assert.equal(h.browser.store.poll(0).imports.length, 0);
    group(h, 'deleted');
    const deleted = preview(h, 'deleted'); h.discoverySearches.delete('deleted');
    assert.throws(() => h.browser.dispatch('studio:one', 'import.commit', request(deleted.captureId), 'deleted'), /does not exist/);
    h.discoverySearches.createBatch({ phrase: 'React', maxPublishedAgeDays: 30, children: [child('recent')] });
    const recent = preview(h, 'recent');
    h.browser.dispatch('studio:one', 'import.commit', request(recent.captureId), 'recent');
    assert.equal(h.discoverySearches.get('recent').count, 0);
    assert.equal(h.discoverySearches.get('recent').reviewCount, 1);
  } finally { h.close(); }
});

test('collected pages retain their destination and recover a lost commit reply after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'discovery-groups-'));
  let h = setup(join(directory, 'test.db'));
  const session = 'studio:' + randomUUID();
  try {
    group(h, 'react'); group(h, 'other');
    const draft = h.browser.dispatch(session, 'collection.start', { target }, 'react') as { collectionId: string };
    h.browser.dispatch(session, 'collection.append', { collectionId: draft.collectionId, capture: capture(), target }, 'react');
    const commit = { collectionId: draft.collectionId, operationId: randomUUID(), selected: [0] };
    assert.throws(() => h.browser.dispatch(session, 'collection.commit', commit, 'other'), /destination changed/);
    const receipt = h.browser.dispatch(session, 'collection.commit', commit, 'react') as ImportReceipt;
    assert.equal(receipt.collectionId, 'react');
    assert.equal(h.discoverySearches.get('other').count, 0);
    h.close(); h = setup(join(directory, 'test.db'));
    assert.deepEqual(h.browser.dispatch('studio:reopened', 'collection.commit', commit, 'react'), receipt);
    assert.equal(h.discoverySearches.get('react').count, 1);
    assert.equal(h.browser.store.poll(0).imports[0]!.targetSearchId, 'react');
  } finally { h.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('completed sessions do not exhaust capacity after repeated keyword folders', () => {
  const h = setup();
  try {
    for (let n = 0; n < 45; n++) {
      const session = h.discovery.start({ keyword: 'React', boards: ['justjoin'], pageSize: 30, sourceMode: 'cache' });
      assert.equal(h.discovery.poll(session.id).boards[0]!.status, 'exhausted');
    }
  } finally { h.close(); }
});
